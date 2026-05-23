'use strict';

const { parseTimeframe, parseDateRange } = require('../utils/timeParser');
const { categorizeEmail, getCleanupAction, CLEANUP_ACTIONS } = require('../utils/categories');
const { RateLimiter } = require('../utils/rateLimiter');

const CLEANUP_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
const BATCH_SIZE = 10;
const PROGRESS_EVERY = 50;

// Module-level singleton; override via _setRateLimiter() in tests.
let _rateLimiter = new RateLimiter();

/**
 * Handle a /email-cleanup Slack slash command.
 *
 * Sends an immediate acknowledgment to Slack (required within 3 s),
 * then runs the actual batch cleanup asynchronously, posting progress
 * and a final summary via the Slack response_url.
 *
 * @param {object} opts
 * @param {string}       opts.text          - e.g. "7d" | "24h" | "2026-05-15 2026-05-22"
 * @param {string}       [opts.userId]
 * @param {string}       [opts.userName]
 * @param {GmailService} opts.gmailService
 * @param {SlackService} opts.slackService
 * @param {string}       [opts.responseUrl] - Slack response_url for async follow-ups
 * @param {number|null}  [opts.accountId]
 * @param {number}       [opts.maxEmails=500]
 * @param {boolean}      [opts.dryRun=false]
 * @returns {object} Immediate Slack acknowledgment payload
 */
async function handleCleanup({
  text,
  userId,
  userName,
  gmailService,
  slackService,
  responseUrl = null,
  accountId = null,
  maxEmails = 500,
  dryRun = false,
}) {
  const input = (text || '').trim();
  if (!input) {
    return _errorResponse(
      'Please provide a timeframe. Examples: `7d`, `24h`, `2026-05-15 2026-05-22`'
    );
  }

  // Rate limit: one cleanup per 24 hours per account
  const key = `cleanup:account-${accountId ?? 'default'}`;
  const { allowed, remainingMs } = _rateLimiter.check(key, CLEANUP_COOLDOWN_MS);
  if (!allowed) {
    const hours = Math.ceil(remainingMs / 3_600_000);
    return _errorResponse(
      `Rate limit: one cleanup per 24 hours. Try again in ${hours} hour(s).`
    );
  }

  // Parse timeframe
  let from, to;
  try {
    const parts = input.split(/\s+/);
    if (parts.length >= 2 && /^\d{4}-/.test(parts[0]) && /^\d{4}-/.test(parts[1])) {
      ({ from, to } = parseDateRange(parts[0], parts[1]));
    } else {
      from = parseTimeframe(parts[0]);
      to = new Date();
    }
  } catch (err) {
    _rateLimiter.clear(key); // Don't penalise user errors
    return _errorResponse(`Invalid timeframe — ${err.message}`);
  }

  const requestedBy = userName || userId || 'unknown';
  const dryNote = dryRun ? ' _(dry-run — no changes will be made)_' : '';

  // Fire-and-forget background job
  setImmediate(() => {
    _runJob({
      from, to, input, gmailService, slackService,
      responseUrl, maxEmails, dryRun, requestedBy,
    }).catch((err) => {
      console.error('[Cleanup] Job failed:', err.message);
      if (responseUrl) {
        slackService
          .respondToUrl(responseUrl, { response_type: 'ephemeral', text: `❌ Cleanup failed: ${err.message}` })
          .catch(() => {});
      }
    });
  });

  return {
    response_type: 'ephemeral',
    text: `🧹 Starting cleanup for *${input}*${dryNote}...\n_${require('../utils/timezone').formatDate(from)} → ${require('../utils/timezone').formatDate(to)}_`,
  };
}

// ─── Background job ───────────────────────────────────────────────────────────

async function _runJob({
  from, to, input, gmailService, slackService,
  responseUrl, maxEmails, dryRun, requestedBy,
}) {
  const post = async (text) => {
    if (responseUrl) {
      await slackService
        .respondToUrl(responseUrl, { response_type: 'ephemeral', text })
        .catch(() => {});
    }
  };

  await post(`🔍 Fetching emails from *${require('../utils/timezone').formatDate(from)}* → *${require('../utils/timezone').formatDate(to)}*...`);

  const emails = await gmailService.fetchEmailsInRange(from, to, maxEmails);
  if (emails.length === 0) {
    await post(`✅ No emails found for timeframe *${input}*.`);
    return;
  }

  await post(`📊 Found *${emails.length}* email(s). Categorising and processing...`);

  const stats = {
    total: emails.length,
    deleted: 0,
    archived: 0,
    flagged: 0,
    skipped: 0,
    errors: 0,
    byCategory: {},
  };

  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (email) => {
        const category = categorizeEmail(email);
        const action = getCleanupAction(category);

        stats.byCategory[category] = (stats.byCategory[category] ?? 0) + 1;

        if (dryRun) {
          stats[_statKey(action)] += 1;
          return;
        }

        try {
          if (action === CLEANUP_ACTIONS.DELETE) {
            await gmailService.deleteEmail(email.id);
            stats.deleted += 1;
          } else if (action === CLEANUP_ACTIONS.ARCHIVE) {
            await gmailService.archiveEmail(email.id);
            stats.archived += 1;
          } else if (action === CLEANUP_ACTIONS.FLAG) {
            stats.flagged += 1; // Keep; manual review
          } else {
            stats.skipped += 1;
          }
        } catch (err) {
          console.error(`[Cleanup] Error on email ${email.id}:`, err.message);
          stats.errors += 1;
        }
      })
    );

    // Periodic progress update
    const processed = Math.min(i + BATCH_SIZE, emails.length);
    if (processed > 0 && processed % PROGRESS_EVERY === 0 && processed < emails.length) {
      await post(`⏳ Processed ${processed}/${emails.length} emails...`);
    }

    // Brief pause between batches to stay within Gmail API rate limits
    if (i + BATCH_SIZE < emails.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  await post(_buildSummary(stats, input, requestedBy, dryRun));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _statKey(action) {
  if (action === CLEANUP_ACTIONS.DELETE) return 'deleted';
  if (action === CLEANUP_ACTIONS.ARCHIVE) return 'archived';
  if (action === CLEANUP_ACTIONS.FLAG) return 'flagged';
  return 'skipped';
}

function _buildSummary(stats, input, requestedBy, dryRun) {
  const categoryLines = Object.entries(stats.byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, n]) => `  • ${cat}: ${n}`)
    .join('\n');

  const lines = [
    `📊 *Cleanup Complete!*${dryRun ? ' _(Dry Run — no changes made)_' : ''}`,
    `Timeframe: *${input}* | Requested by: ${requestedBy}`,
    '',
    `Total: ${stats.total}`,
    `✅ Deleted: ${stats.deleted}`,
    `📦 Archived: ${stats.archived}`,
    `🚩 Flagged for review: ${stats.flagged}`,
    `⏭️ Skipped: ${stats.skipped}`,
    stats.errors > 0 ? `⚠️ Errors: ${stats.errors}` : null,
    '',
    '*By category:*',
    categoryLines || '  (none)',
  ].filter((l) => l !== null);

  return lines.join('\n');
}

/**
 * Override the module-level RateLimiter (test helper).
 *
 * @param {RateLimiter} limiter
 */
function _setRateLimiter(limiter) {
  _rateLimiter = limiter;
}

function _errorResponse(message) {
  return { response_type: 'ephemeral', text: `❌ ${message}` };
}

module.exports = { handleCleanup, _setRateLimiter };
