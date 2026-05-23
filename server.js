'use strict';

require('dotenv').config();

const express = require('express');
const crypto = require('crypto');

const { loadConfig } = require('./src/config');
const { StateManager } = require('./src/services/state');
const { GmailService } = require('./src/services/gmail');
const { SlackService } = require('./src/services/slack');
const { handleReset } = require('./src/commands/reset');
const { handleCleanup } = require('./src/commands/cleanup');

const app = express();
const PORT               = parseInt(process.env.PORT, 10) || 3000;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const MAX_EMAILS_PER_CLEANUP = parseInt(process.env.MAX_EMAILS_PER_CLEANUP, 10) || 500;

// ─── Raw body capture (required for Slack signature verification) ─────────────

app.use(
  express.json({
    verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); },
  })
);
app.use(
  express.urlencoded({
    extended: true,
    verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); },
  })
);

// ─── Slack signature verification middleware ──────────────────────────────────

function verifySlackSignature(req, res, next) {
  if (!SLACK_SIGNING_SECRET) {
    console.warn('⚠️  SLACK_SIGNING_SECRET not set — skipping signature verification');
    return next();
  }

  const timestamp = req.headers['x-slack-request-timestamp'];
  const signature = req.headers['x-slack-signature'];

  if (!timestamp || !signature) {
    return res.status(401).send('Unauthorized: Missing Slack signature headers');
  }

  // Reject requests older than 5 minutes (replay attack prevention)
  const age = Math.abs(Math.floor(Date.now() / 1000) - parseInt(timestamp, 10));
  if (age > 300) {
    return res.status(401).send('Unauthorized: Request timestamp too old');
  }

  const base = `v0:${timestamp}:${req.rawBody ?? ''}`;
  const expected = 'v0=' + crypto.createHmac('sha256', SLACK_SIGNING_SECRET).update(base).digest('hex');

  let signaturesMatch = false;
  try {
    signaturesMatch = crypto.timingSafeEqual(
      Buffer.from(signature, 'utf8'),
      Buffer.from(expected, 'utf8')
    );
  } catch {
    // Buffer lengths differ → signatures cannot match
  }

  if (!signaturesMatch) {
    return res.status(401).send('Unauthorized: Invalid signature');
  }

  next();
}

// ─── Helper: build Gmail + Slack service from per-account context ─────────────

function _buildServices(accountId) {
  if (!accountId) throw new Error('accountId is required');
  const cfg         = loadConfig(accountId);
  const gmailService = new GmailService(cfg.gmail);
  const slackService = new SlackService(cfg.slack.webhookUrl, `account-${accountId}`, accountId);
  const stateManager = new StateManager(cfg.app.stateFile, accountId);
  return { gmailService, slackService, stateManager, acctCfg: cfg };
}

// ─── POST /slack/actions — interactive button handler ────────────────────────

app.post('/slack/actions', verifySlackSignature, async (req, res) => {
  try {
    let payload;
    if (req.body.payload) {
      payload = typeof req.body.payload === 'string'
        ? JSON.parse(req.body.payload)
        : req.body.payload;
    } else if (req.body.actions) {
      payload = req.body;
    } else {
      return res.status(400).send('Missing payload');
    }

    if (!Array.isArray(payload.actions) || payload.actions.length === 0) {
      return res.status(400).send('No actions in payload');
    }

    const action = payload.actions[0];

    // Button value is "accountId|emailId" — both parts required
    const raw = action.value ?? '';
    if (!raw.includes('|')) {
      return res.status(400).send('Invalid action payload: missing account ID in button value');
    }
    const [accountPart, emailPart] = raw.split('|', 2);
    const accountId = parseInt(accountPart, 10);
    const emailId   = emailPart;

    if (!accountId || isNaN(accountId)) {
      return res.status(400).send('Invalid account ID in button value');
    }
    if (!emailId || !/^[a-zA-Z0-9_-]+$/.test(emailId)) {
      return res.status(400).send('Invalid email ID');
    }
    if (!action.action_id || !/^(delete|read|clear)_gmail_/.test(action.action_id)) {
      return res.status(400).send('Invalid action');
    }

    const { gmailService } = _buildServices(accountId);

    let resultText;

    if (action.action_id.startsWith('delete_gmail_')) {
      await gmailService.deleteEmail(emailId);
      resultText = '✅ Email moved to trash';
    } else if (action.action_id.startsWith('read_gmail_')) {
      await gmailService.markAsRead(emailId);
      resultText = '✅ Marked as read';
    } else if (action.action_id.startsWith('clear_gmail_')) {
      if (payload.response_url) {
        await _postResponseUrl(payload.response_url, { delete_original: true });
      }
      return res.status(200).send('OK');
    }

    if (payload.response_url && resultText) {
      await _postResponseUrl(payload.response_url, {
        text: resultText,
        response_type: 'ephemeral',
        replace_original: true,
      });
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('Error in /slack/actions:', err.message);
    res.status(500).send('Internal error');
  }
});

// ─── POST /slack/commands/reset — /email-reset slash command ─────────────────

app.post('/slack/commands/reset', verifySlackSignature, async (req, res) => {
  try {
    const { text = '', user_id, user_name, response_url } = req.body;
    const accountId = req.body.account_id ? parseInt(req.body.account_id, 10) : null;
    const { stateManager } = _buildServices(accountId);

    const response = await handleReset({
      text,
      userId: user_id,
      userName: user_name,
      stateManager,
      accountId,
    });

    // Respond immediately; if there's a response_url, also send there
    res.status(200).json(response);

    if (response_url) {
      await _postResponseUrl(response_url, response).catch(() => {});
    }
  } catch (err) {
    console.error('Error in /slack/commands/reset:', err.message);
    res.status(200).json({ response_type: 'ephemeral', text: `❌ Reset failed: ${err.message}` });
  }
});

// ─── POST /slack/commands/cleanup — /email-cleanup slash command ──────────────

app.post('/slack/commands/cleanup', verifySlackSignature, async (req, res) => {
  try {
    const { text = '', user_id, user_name, response_url } = req.body;
    const accountId = req.body.account_id ? parseInt(req.body.account_id, 10) : null;
    const dryRun = (text || '').includes('--dry-run');
    const cleanText = (text || '').replace('--dry-run', '').trim();

    const { gmailService, slackService } = _buildServices(accountId);

    const ack = await handleCleanup({
      text: cleanText,
      userId: user_id,
      userName: user_name,
      gmailService,
      slackService,
      responseUrl: response_url || null,
      accountId,
      maxEmails: MAX_EMAILS_PER_CLEANUP,
      dryRun,
    });

    res.status(200).json(ack);
  } catch (err) {
    console.error('Error in /slack/commands/cleanup:', err.message);
    res.status(200).json({ response_type: 'ephemeral', text: `❌ Cleanup failed: ${err.message}` });
  }
});

// ─── GET /health ──────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── 404 & global error handler ──────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.path });
});

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err.message);
  res.status(err.status ?? 500).json({ error: 'Internal Server Error' });
});

// ─── Server startup + graceful shutdown ──────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`   POST /slack/actions`);
  console.log(`   POST /slack/commands/reset`);
  console.log(`   POST /slack/commands/cleanup`);
  console.log(`   GET  /health`);
});

async function shutdown(signal) {
  console.log(`\n📍 ${signal} — shutting down...`);
  server.close(() => {
    console.log('✅ HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => { console.error('Shutdown timeout'); process.exit(1); }, 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => { console.error('Uncaught:', err.message); shutdown('uncaughtException'); });
process.on('unhandledRejection', (r) => { console.error('Unhandled rejection:', r); shutdown('unhandledRejection'); });

// ─── Private helpers ──────────────────────────────────────────────────────────

async function _postResponseUrl(url, payload) {
  const axios = require('axios');
  await axios.post(url, payload);
}

module.exports = { app }; // exported for testing

