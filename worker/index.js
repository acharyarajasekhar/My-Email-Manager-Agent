// worker/index.js — Cloudflare Worker entry point.
//
// Handles real-time Slack HTTP only. Scheduled email checks and long-running
// cleanup jobs run in GitHub Actions; this worker triggers them via
// workflow_dispatch when a slash command is received.
//
// HTTP routes (Slack interactions):
//   POST /slack/actions           — button clicks (Delete / Mark as Read / Dismiss)
//   POST /slack/commands/check    — /email-check <accountId> [timeframe] (triggers GHA email-check.yml)
//   POST /slack/commands/reset    — /email-reset (triggers GHA state-reset.yml)
//   POST /slack/commands/cleanup  — /email-cleanup (triggers GHA cleanup.yml)
//   POST /slack/commands/purge    — /email-purge (triggers GHA purge.yml)
//   POST /slack/commands/accounts  — /email-accounts (lists all account IDs → email addresses)
//   GET  /health                  — liveness probe
//
// CF secrets required (wrangler secret put <NAME>):
//   SLACK_SIGNING_SECRET
//   GITHUB_TOKEN              — PAT with `workflow` scope (triggers GHA workflows)
//
//   Per account (repeat for N = 1, 2, ...):
//   ACCOUNT_N_GMAIL_CLIENT_ID
//   ACCOUNT_N_GMAIL_CLIENT_SECRET
//   ACCOUNT_N_GMAIL_REFRESH_TOKEN
//   ACCOUNT_N_SLACK_WEBHOOK_URL
//   ACCOUNT_N_EMAIL
//
// CF KV namespace:
//   EMAIL_KV  — token cache + rate-limit counters

import { verifySignature, parseSlackBody, jsonResp, ackText, replaceMessage } from './slack.js';

// ─────────────────────────────────────────────────────────────────────────────
// Structured logger — output visible via `wrangler tail` or `npm run worker:tail`
// ─────────────────────────────────────────────────────────────────────────────
function log(ctx, msg, data) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ctx, msg, ...data }));
}
function logError(ctx, msg, err, extra) {
  console.error(JSON.stringify({ ts: new Date().toISOString(), ctx, msg, error: err?.message, stack: err?.stack, ...extra }));
}
import {
  getAccessToken, invalidateToken,
  deleteEmail, markAsRead, archiveEmail,
} from './gmail.js';

// ─────────────────────────────────────────────────────────────────────────────
// Main CF Worker export
// ─────────────────────────────────────────────────────────────────────────────

export default {
  // ── HTTP handler — Slack webhooks ────────────────────────────────────────
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    log('req', `${request.method} ${url.pathname}`, { cf_ray: request.headers.get('cf-ray') });

    if (request.method === 'GET' && url.pathname === '/health') {
      return jsonResp({ status: 'ok', timestamp: new Date().toISOString() });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // Read body once — body can only be consumed once in a Worker
    const rawBody = await request.text();

    // Verify Slack signature (skip only if secret not configured, e.g. local dev)
    if (env.SLACK_SIGNING_SECRET) {
      const valid = await verifySignature(request, rawBody, env.SLACK_SIGNING_SECRET);
      if (!valid) {
        log('sig', 'Slack signature verification FAILED', { path: url.pathname });
        return new Response('Unauthorized', { status: 401 });
      }
      log('sig', 'Slack signature verified OK');
    } else {
      log('sig', 'Signature check skipped (SLACK_SIGNING_SECRET not set — dev mode)');
    }

    if (url.pathname === '/slack/actions') {
      return handleSlackAction(rawBody, env);
    }

    if (url.pathname === '/slack/commands/reset') {
      return handleResetCommand(rawBody, env);
    }

    if (url.pathname === '/slack/commands/cleanup') {
      const body    = parseSlackBody(rawBody);
      const dryRun  = (body.text || '').includes('--dry-run');
      const cleaned = (body.text || '').replace('--dry-run', '').trim();
      const parts   = cleaned.split(/\s+/);
      const acctId  = Number(parts[0]);
      const tfText  = parts.slice(1).join(' ').trim();
      log('cleanup', 'Slash command received', { raw_text: body.text, acctId, tfText, dryRun, user: body.user_name });
      if (!acctId || isNaN(acctId)) {
        log('cleanup', 'Rejected — missing/invalid accountId');
        return ackText('Usage: `/email-cleanup <accountId> <timeframe> [--dry-run]`\nExample: `/email-cleanup 1 7d`');
      }
      if (!tfText) {
        log('cleanup', 'Rejected — missing timeframe', { acctId });
        return ackText('❌ Please provide a timeframe. Example: `/email-cleanup 1 7d`');
      }
      try { _parseTimeframe(tfText); } catch (err) {
        log('cleanup', 'Rejected — invalid timeframe', { tfText, reason: err.message });
        return ackText(`❌ Invalid timeframe — ${err.message}`);
      }
      const rlKey = `cleanup:${acctId}`;
      const { allowed, remainingMs } = await _checkRateLimit(env.EMAIL_KV, rlKey, 24 * 60 * 60_000, env.RATE_LIMIT_ENABLED !== 'false');
      if (!allowed) {
        log('cleanup', 'Rate-limited', { acctId, remainingMs });
        return ackText(`❌ Rate limit: one cleanup per 24 h. Try again in ${Math.ceil(remainingMs / 3_600_000)} h.`);
      }
      const inputs = { account_id: String(acctId), timeframe: tfText, dry_run: String(dryRun) };
      log('cleanup', 'Triggering GHA cleanup.yml', { inputs });
      try {
        await triggerGitHubWorkflow(env, 'cleanup.yml', inputs);
        log('cleanup', 'GHA cleanup.yml triggered successfully', { inputs });
      } catch (err) {
        await _clearRateLimit(env.EMAIL_KV, rlKey);
        logError('cleanup', 'Failed to trigger GHA cleanup.yml', err, { inputs });
        return ackText(`❌ Failed to trigger cleanup: ${err.message}`);
      }
      return ackText(`🧹 Cleanup started for account *${_accountEmail(env, acctId)}*, timeframe *${tfText}*${dryRun ? ' _(dry-run)_' : ''}…\nResults will be posted to Slack shortly.`);
    }

    if (url.pathname === '/slack/commands/check') {
      const body   = parseSlackBody(rawBody);
      const parts  = (body.text || '').trim().split(/\s+/);
      const acctId = Number(parts[0]);
      const fromText = parts.slice(1).join(' ').trim();
      log('check', 'Slash command received', { raw_text: body.text, acctId, fromText, user: body.user_name });
      if (!acctId || isNaN(acctId)) {
        log('check', 'Rejected — missing/invalid accountId');
        return ackText('Usage: `/email-check <accountId> [timeframe]`\nExamples: `/email-check 1` or `/email-check 1 24h`');
      }
      if (fromText) {
        try { _parseTimeframe(fromText); } catch (err) {
          log('check', 'Rejected — invalid timeframe', { fromText, reason: err.message });
          return ackText(`❌ Invalid timeframe — ${err.message}`);
        }
      }
      const rlKey = `check:${acctId}`;
      const { allowed, remainingMs } = await _checkRateLimit(env.EMAIL_KV, rlKey, 5 * 60_000, env.RATE_LIMIT_ENABLED !== 'false');
      if (!allowed) {
        log('check', 'Rate-limited', { acctId, remainingMs });
        return ackText(`❌ Rate limit: one manual check per 5 min. Try again in ${Math.ceil(remainingMs / 1000)} s.`);
      }
      const inputs = { account_id: String(acctId), ...(fromText ? { from_timeframe: fromText } : {}) };
      log('check', 'Triggering GHA email-check.yml', { inputs });
      try {
        await triggerGitHubWorkflow(env, 'email-check.yml', inputs);
        log('check', 'GHA email-check.yml triggered successfully', { inputs });
      } catch (err) {
        await _clearRateLimit(env.EMAIL_KV, rlKey);
        logError('check', 'Failed to trigger GHA email-check.yml', err, { inputs });
        return ackText(`❌ Failed to trigger check: ${err.message}`);
      }
      const fromLabel = fromText ? ` from *${fromText}*` : ' from last checkpoint';
      return ackText(`🔍 Checking emails for account *${_accountEmail(env, acctId)}*${fromLabel}…\nResults will be posted here shortly.`);
    }

    if (url.pathname === '/slack/commands/purge') {
      const body      = parseSlackBody(rawBody);
      const channelId = body.channel_id;
      log('purge', 'Slash command received', { channelId, user: body.user_name });
      const rlKey = `purge:${channelId}`;
      const { allowed, remainingMs } = await _checkRateLimit(env.EMAIL_KV, rlKey, 5 * 60_000, env.RATE_LIMIT_ENABLED !== 'false');
      if (!allowed) {
        log('purge', 'Rate-limited', { channelId, remainingMs });
        return ackText(`❌ Rate limit: one purge per 5 min. Try again in ${Math.ceil(remainingMs / 1000)} s.`);
      }
      const inputs = { channel_id: channelId };
      log('purge', 'Triggering GHA purge.yml', { inputs });
      try {
        await triggerGitHubWorkflow(env, 'purge.yml', inputs);
        log('purge', 'GHA purge.yml triggered successfully', { inputs });
      } catch (err) {
        await _clearRateLimit(env.EMAIL_KV, rlKey);
        logError('purge', 'Failed to trigger GHA purge.yml', err, { inputs });
        return ackText(`❌ Failed to trigger purge: ${err.message}`);
      }
      return ackText(`🗑️ Channel purge started… results will be posted to Slack shortly.`);
    }

    if (url.pathname === '/slack/commands/accounts') {
      log('accounts', 'Slash command received', { user: parseSlackBody(rawBody).user_name });
      const accounts = _listAccounts(env);
      if (!accounts.length) return ackText('❌ No accounts configured (no `ACCOUNT_N_EMAIL` secrets found).');
      const lines = accounts.map(({ id, email }) => `• *${id}* — ${email}`).join('\n');
      return ackText(`📋 *Configured accounts:*\n${lines}`);
    }

    return new Response('Not Found', { status: 404 });
  },
};


// ─────────────────────────────────────────────────────────────────────────────
// Slack interactive action handler (button clicks)
// ─────────────────────────────────────────────────────────────────────────────

async function handleSlackAction(rawBody, env) {
  const payload = parseSlackBody(rawBody);
  log('action', 'Parsed Slack payload', { type: payload.type, user: payload.user?.username });

  if (payload.type !== 'block_actions') {
    log('action', 'Ignoring non-block_actions payload', { type: payload.type });
    return jsonResp({ ok: true });
  }

  const action = payload.actions?.[0];
  if (!action) {
    log('action', 'No actions in payload — ignoring');
    return jsonResp({ ok: true });
  }

  const actionId = action.action_id ?? '';
  log('action', 'Processing action', { actionId, value: action.value });

  // Validate action ID format — prevents spoofed action IDs
  if (!/^(delete|read|clear)_gmail_[a-zA-Z0-9_-]+$/.test(actionId)) {
    log('action', 'Rejected — actionId failed validation', { actionId });
    return jsonResp({ ok: true });
  }

  // Button value is encoded as "accountId|emailId" (always required)
  const raw = action.value ?? '';
  if (!raw.includes('|')) {
    log('action', 'Rejected — button value missing accountId separator', { value: raw });
    return ackText('❌ Missing account ID in button payload. Re-run the email check to get updated buttons.');
  }
  const [accountPart, emailPart] = raw.split('|', 2);
  const accountId = Number(accountPart);
  const emailId   = emailPart ?? '';

  if (!accountId || isNaN(accountId)) {
    log('action', 'Rejected — invalid accountId', { accountPart });
    return ackText('❌ Invalid account ID in action payload.');
  }

  if (!emailId || !/^[a-zA-Z0-9_-]+$/.test(emailId)) {
    log('action', 'Rejected — invalid emailId', { emailId });
    return ackText('❌ Invalid email ID in action payload.');
  }

  log('action', 'Validated', { actionId, accountId, emailId });

  const prefix = _accountPrefix(accountId);
  let token;
  try {
    log('action', 'Fetching Gmail access token', { accountId });
    token = await getAccessToken(env, env.EMAIL_KV, prefix);
    log('action', 'Gmail access token obtained', { accountId });
  } catch (err) {
    logError('action', 'Token fetch failed', err, { accountId });
    return ackText(`❌ Authentication failed: ${err.message}`);
  }

  // Get message details for updating (not deleting/modifying the message)
  const channelId = payload.channel?.id;
  const messageTs = payload.message?.ts;
  if (!channelId || !messageTs) {
    log('action', 'Warning: missing channel/message info for update', { channelId, messageTs });
  }

  try {
    if (actionId.startsWith('delete_gmail_')) {
      log('action', 'Calling Gmail delete', { emailId, accountId });
      await deleteEmail(token, emailId);
      log('action', 'Gmail delete successful', { emailId, accountId });
      // Update the message in Slack to indicate deletion
      if (channelId && messageTs) {
        await _updateSlackMessage(env.SLACK_BOT_TOKEN, channelId, messageTs, '🗑️ Email moved to trash.');
      }
      return jsonResp({ ok: true });
    }
    if (actionId.startsWith('read_gmail_')) {
      log('action', 'Calling Gmail markAsRead', { emailId, accountId });
      await markAsRead(token, emailId);
      log('action', 'Gmail markAsRead successful', { emailId, accountId });
      if (channelId && messageTs) {
        await _updateSlackMessage(env.SLACK_BOT_TOKEN, channelId, messageTs, '✅ Marked as read.');
      }
      return jsonResp({ ok: true });
    }
    if (actionId.startsWith('clear_gmail_')) {
      log('action', 'Dismiss — no Gmail call needed', { emailId, accountId });
      if (channelId && messageTs) {
        await _updateSlackMessage(env.SLACK_BOT_TOKEN, channelId, messageTs, '✕ Dismissed.');
      }
      return jsonResp({ ok: true });
    }
  } catch (err) {
    logError('action', 'Gmail API call failed', err, { actionId, emailId, accountId, status: err.status });
    if (err.status === 401 || err.status === 403) {
      log('action', 'Invalidating cached token due to auth error', { accountId });
      await invalidateToken(env.EMAIL_KV, prefix);
    }
    return ackText(`❌ Action failed: ${err.message}`);
  }

  return jsonResp({ ok: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// /email-reset slash command handler — triggers GHA state-reset.yml
// ─────────────────────────────────────────────────────────────────────────────

async function handleResetCommand(rawBody, env) {
  const body  = parseSlackBody(rawBody);
  const parts = (body.text ?? '').trim().split(/\s+/);
  log('reset', 'Slash command received', { raw_text: body.text, user: body.user_name });

  // First token must be the numeric account ID: /email-reset <accountId> <timeframe>
  const accountId = Number(parts[0]);
  if (!accountId || isNaN(accountId)) {
    log('reset', 'Rejected — missing/invalid accountId');
    return ackText('Usage: `/email-reset <accountId> <timeframe>`\nExample: `/email-reset 1 24h`');
  }
  const text = parts.slice(1).join(' ').trim();

  if (!text) {
    log('reset', 'Rejected — missing timeframe', { accountId });
    return ackText('❌ Please provide a timeframe. Examples: `24h`, `7d`, `2026-05-20`');
  }

  // Validate timeframe locally before spending a GHA run
  try {
    const resolved = _parseTimeframe(text);
    log('reset', 'Timeframe validated', { accountId, text, resolvedTo: resolved.toISOString() });
  } catch (err) {
    log('reset', 'Rejected — invalid timeframe', { accountId, text, reason: err.message });
    return ackText(`❌ Invalid timeframe — ${err.message}`);
  }

  const rlKey = `reset:${accountId}`;
  const { allowed, remainingMs } = await _checkRateLimit(env.EMAIL_KV, rlKey, 60 * 60_000, env.RATE_LIMIT_ENABLED !== 'false');
  if (!allowed) {
    log('reset', 'Rate-limited', { accountId, remainingMs });
    return ackText(`❌ Rate limit: one reset per hour. Try again in ${Math.ceil(remainingMs / 60_000)} min.`);
  }

  const inputs = { account_id: String(accountId), timeframe: text };
  log('reset', 'Triggering GHA state-reset.yml', { inputs });
  try {
    await triggerGitHubWorkflow(env, 'state-reset.yml', inputs);
    log('reset', 'GHA state-reset.yml triggered successfully', { inputs });
  } catch (err) {
    await _clearRateLimit(env.EMAIL_KV, rlKey);
    logError('reset', 'Failed to trigger GHA state-reset.yml', err, { inputs });
    return ackText(`❌ Failed to trigger state reset: ${err.message}`);
  }

  return ackText(`⏳ Resetting email state for account *${_accountEmail(env, accountId)}* to *${text}*…\nResults will be posted to Slack shortly.`);
}




// ─────────────────────────────────────────────────────────────────────────────
// Account helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Post a confirmation message for button action. */
async function _updateSlackMessage(botToken, channelId, messageTs, confirmText) {
  if (!botToken) return; // Fallback if no bot token
  try {
    // Post confirmation message in the same channel
    const postResp = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: channelId, text: confirmText }),
    });
    const postResult = await postResp.json();
    if (!postResult.ok) {
      logError('action', 'chat.postMessage failed', new Error(postResult.error), { channelId });
    } else {
      log('action', 'Confirmation message posted', { channelId });
    }
  } catch (err) {
    logError('action', 'Failed to post confirmation', err, { channelId, messageTs });
  }
}

/** Returns the email address for an account, falling back to "#<id>" if not set. */
function _accountEmail(env, id) {
  return env[`ACCOUNT_${id}_EMAIL`] || `#${id}`;
}

/** Returns all configured accounts by scanning ACCOUNT_N_EMAIL secrets (checks 1–20). */
function _listAccounts(env) {
  const accounts = [];
  for (let n = 1; n <= 20; n++) {
    const email = env[`ACCOUNT_${n}_EMAIL`];
    if (email) accounts.push({ id: n, email });
  }
  return accounts;
}

async function _checkRateLimit(kv, key, cooldownMs, enabled = true) {
  if (!enabled) return { allowed: true, remainingMs: 0 };
  const raw      = await kv.get(`rl:${key}`).catch(() => null);
  const lastUsed = raw ? Number(raw) : 0;
  const elapsed  = Date.now() - lastUsed;
  if (elapsed < cooldownMs) return { allowed: false, remainingMs: cooldownMs - elapsed };
  await kv.put(`rl:${key}`, String(Date.now()), { expirationTtl: Math.ceil(cooldownMs / 1000) }).catch(() => {});
  return { allowed: true, remainingMs: 0 };
}

async function _clearRateLimit(kv, key) {
  await kv.delete(`rl:${key}`).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeframe parser (mirrors src/utils/timeParser.js — inline for ES module compat)
// ─────────────────────────────────────────────────────────────────────────────

function _parseTimeframe(input, now = new Date()) {
  const s = input.trim();
  const h = s.match(/^(\d+)h$/i);
  if (h) {
    const hrs = +h[1];
    if (hrs < 1)      throw new Error('Minimum is 1 hour');
    if (hrs > 90 * 24) throw new Error('Maximum is 90 days');
    return new Date(now - hrs * 3_600_000);
  }
  const d = s.match(/^(\d+)d$/i);
  if (d) {
    const days = +d[1];
    if (days < 1)  throw new Error('Minimum is 1 day');
    if (days > 90) throw new Error('Maximum is 90 days');
    return new Date(now - days * 86_400_000);
  }
  const dt = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?Z?$/);
  if (dt) {
    const parsed = new Date(`${dt[1]}T${dt[2]}${dt[3] ?? ':00'}Z`);
    if (isNaN(parsed)) throw new Error(`Invalid date/time: "${s}"`);
    if (parsed > now)  throw new Error('Date cannot be in the future');
    return parsed;
  }
  const date = s.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (date) {
    const parsed = new Date(`${date[1]}T00:00:00Z`);
    if (isNaN(parsed)) throw new Error(`Invalid date: "${s}"`);
    if (parsed > now)  throw new Error('Date cannot be in the future');
    return parsed;
  }
  throw new Error(`Unrecognised format: "${s}". Use "24h", "7d", or "2026-05-20"`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Misc helpers
// ─────────────────────────────────────────────────────────────────────────────

function _accountPrefix(accountId) {
  return `ACCOUNT_${accountId}_`;
}

// ─────────────────────────────────────────────────────────────────────────────
// GitHub Actions workflow_dispatch trigger
// ─────────────────────────────────────────────────────────────────────────────

async function triggerGitHubWorkflow(env, workflow, inputs) {
  const owner = env.GITHUB_OWNER;
  const repo  = env.GITHUB_REPO;

  if (!owner || !repo) throw new Error('GITHUB_OWNER / GITHUB_REPO not configured in wrangler.toml [vars]');
  if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN secret is not set (run: wrangler secret put GITHUB_TOKEN)');

  const url  = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`;
  const body = JSON.stringify({ ref: 'main', inputs });

  log('gha', 'Dispatching workflow', { workflow, owner, repo, inputs, url });

  let resp;
  try {
    resp = await fetch(url, {
      method:  'POST',
      headers: {
        'Authorization':        `Bearer ${env.GITHUB_TOKEN}`,
        'Accept':               'application/vnd.github+json',
        'Content-Type':         'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent':           'email-manager-worker/1.0',
      },
      body,
    });
  } catch (networkErr) {
    logError('gha', 'Network error calling GitHub API', networkErr, { workflow, url });
    throw new Error(`GitHub API unreachable: ${networkErr.message}`);
  }

  const responseText = await resp.text();
  log('gha', 'GitHub API response', { workflow, status: resp.status, body: responseText || '(empty)' });

  // 204 No Content = workflow queued successfully
  if (resp.status === 204) {
    log('gha', 'Workflow queued successfully', { workflow, inputs });
    return;
  }

  // Any other status is an error — extract GitHub's message if available
  let detail = responseText;
  try { detail = JSON.parse(responseText)?.message ?? responseText; } catch { /* keep raw text */ }
  const err = new Error(`GitHub API error ${resp.status}: ${detail}`);
  err.status = resp.status;
  logError('gha', 'Workflow dispatch failed', err, { workflow, inputs, status: resp.status, responseBody: responseText });
  throw err;
}

