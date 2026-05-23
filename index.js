'use strict';

require('dotenv').config();

const { loadConfig, loadAccounts } = require('./src/config');
const { StateManager } = require('./src/services/state');
const { GmailService } = require('./src/services/gmail');
const { SlackService } = require('./src/services/slack');
const { generateSummary } = require('./utils/summarizer');

/**
 * Check for new emails and send Slack notifications.
 * Checkpoint is advanced only after all emails are processed — crash-safe.
 *
 * @param {object}       config
 * @param {StateManager} stateManager
 * @param {GmailService} gmailService
 * @param {SlackService} slackService
 */
async function checkEmails(config, stateManager, gmailService, slackService, fromOverride = null) {
  const accountTag = config.app.email ? ` (${config.app.email})` : '';
  console.log(`[${new Date().toISOString()}] 📨 Checking emails${accountTag}...`);

  const since = fromOverride ?? stateManager.getLastCheckTime();
  if (fromOverride) console.log(`[override] Using --from override: ${since.toISOString()}`);
  const checkStart = new Date();
  let emails;

  try {
    emails = await gmailService.fetchEmailsSince(since, 50);
  } catch (err) {
    console.error('Error fetching emails:', err.message);
    stateManager.markFailed(err);
    await slackService.send(`❌ *Email fetch failed*\n${err.message}`).catch(() => {});
    return;
  }

  for (const email of emails) {
    try {
      email.preview = await generateSummary(email.snippet, config.app.summarizerEngine, {
        model: config.app.ollamaModel,
        baseUrl: config.app.ollamaBaseUrl,
      });
    } catch (err) {
      console.error(`Failed to summarize email "${email.subject}":`, err.message);
      email.preview = { summary: email.snippet?.substring(0, 200) || 'No preview available', action: 'Review' };
    }

    const message = config.app.enableInteractiveButtons
      ? slackService.formatEmailWithButtons(email)
      : slackService.formatEmail(email);

    try {
      await slackService.send(message);
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.error(`Failed to send "${email.subject}" to Slack:`, err.message);
    }
  }

  stateManager.markSuccess(checkStart, emails.length);
  console.log(`✅ Check complete — ${emails.length} email(s)${accountTag}`);

  if (emails.length === 0) {
    const sinceStr = since.getTime() === 0 ? 'the beginning' : since.toUTCString();
    const label = config.app.email ? ` _(${config.app.email})_` : '';
    await slackService
      .send(`✅ *No new emails*${label} since ${sinceStr}`)
      .catch(() => {});
  }
}

/**
 * Run a single email check for one specific account ID.
 *
 * @param {number} accountId
 */
async function checkAccount(accountId, fromOverride = null) {
  const cfg   = loadConfig(accountId);
  const sm    = new StateManager(cfg.app.stateFile, accountId);
  const gmail = new GmailService(cfg.gmail);
  const slack = new SlackService(null, cfg.slack.botToken, cfg.slack.channelId, cfg.app.email || `#${accountId}`, accountId);
  await checkEmails(cfg, sm, gmail, slack, fromOverride);
}

/**
 * Run checks for every account listed in accounts.json, sequentially.
 * Logs progress and continues past individual account failures so one bad
 * account does not block the others.
 */
async function checkAllAccounts() {
  const accounts = loadAccounts();
  if (accounts.length === 0) {
    console.error('No accounts found in accounts.json. Add at least one { "id": N } entry.');
    process.exit(1);
  }

  console.log(`🔁 Running check for ${accounts.length} account(s): ${accounts.map((a) => a.id).join(', ')}`);
  let failed = 0;
  for (const acct of accounts) {
    try {
      await checkAccount(acct.id);
    } catch (err) {
      console.error(`❌ Account ${acct.id} failed: ${err.message}`);
      failed += 1;
    }
  }
  if (failed > 0) {
    console.error(`⚠️  ${failed}/${accounts.length} account(s) failed.`);
    process.exit(1);
  }
  console.log(`✅ All ${accounts.length} account(s) checked successfully.`);
}

/**
 * Main entry point. Run modes via first CLI arg:
 *   node index.js check                              — check every account then exit
 *   node index.js check-account <id>                 — check one account then exit
 *   node index.js cleanup <id> <timeframe> [--dry-run] — run cleanup batch then exit
 *   node index.js reset-state <id> <timeframe>       — reset email checkpoint then exit
 *   node index.js delete <id> <emailId>              — delete one email then exit
 *   (no arg)                                         — start scheduler loop
 */
async function main() {
  const [, , command, ...args] = process.argv;

  if (command === 'check') {
    await checkAllAccounts();
    return;
  }

  if (command === 'check-account') {
    const fromIdx = args.indexOf('--from');
    const fromText = fromIdx >= 0 ? args.slice(fromIdx + 1).join(' ').trim() : null;
    const cleanArgs = fromIdx >= 0 ? args.slice(0, fromIdx) : args;
    const accountId = parseInt(cleanArgs[0], 10);
    if (!accountId || isNaN(accountId)) {
      console.error('Usage: node index.js check-account <accountId> [--from <timeframe>]');
      process.exit(1);
    }
    let fromOverride = null;
    if (fromText) {
      const { parseTimeframe } = require('./src/utils/timeParser');
      try {
        fromOverride = parseTimeframe(fromText);
        console.log(`📅 --from override: ${fromText} → ${fromOverride.toISOString()}`);
      } catch (err) {
        console.error(`Invalid --from timeframe: ${err.message}`);
        process.exit(1);
      }
    }
    await checkAccount(accountId, fromOverride);
    return;
  }

  if (command === 'cleanup') {
    const [accountIdStr, ...rest] = args;
    const dryRun    = rest.includes('--dry-run');
    const timeframe = rest.filter(a => a !== '--dry-run').join(' ').trim();
    if (!accountIdStr || !timeframe) {
      console.error('Usage: node index.js cleanup <accountId> <timeframe> [--dry-run]');
      process.exit(1);
    }
    const accountId = parseInt(accountIdStr, 10);
    if (isNaN(accountId)) {
      console.error(`Invalid accountId: ${accountIdStr}`);
      process.exit(1);
    }
    const cfg          = loadConfig(accountId);
    const gmailService = new GmailService(cfg.gmail);
    const slackService = new SlackService(null, cfg.slack.botToken, cfg.slack.channelId, cfg.app.email || `#${accountId}`, accountId);
    const { handleCleanup } = require('./src/commands/cleanup');
    const ack = await handleCleanup({
      text:        timeframe,
      userId:      'github-actions',
      userName:    'github-actions[bot]',
      gmailService,
      slackService,
      responseUrl: cfg.slack.webhookUrl,
      accountId,
      maxEmails:   parseInt(process.env.MAX_EMAILS_PER_CLEANUP, 10) || 500,
      dryRun,
    });
    if (ack.text?.startsWith('❌')) {
      console.error(ack.text);
      process.exit(1);
    }
    console.log(ack.text);
    // setImmediate-queued _runJob will complete before process exits
    return;
  }

  if (command === 'reset-state') {
    const [accountIdStr, ...rest] = args;
    const timeframe = rest.join(' ').trim();
    if (!accountIdStr || !timeframe) {
      console.error('Usage: node index.js reset-state <accountId> <timeframe>');
      process.exit(1);
    }
    const accountId = parseInt(accountIdStr, 10);
    if (isNaN(accountId)) {
      console.error(`Invalid accountId: ${accountIdStr}`);
      process.exit(1);
    }
    const { parseTimeframe } = require('./src/utils/timeParser');
    let newDate;
    try {
      newDate = parseTimeframe(timeframe);
    } catch (err) {
      console.error(`Invalid timeframe: ${err.message}`);
      process.exit(1);
    }
    const cfg   = loadConfig(accountId);
    const sm    = new StateManager(cfg.app.stateFile, accountId);
    sm.resetTo(newDate, { resetBy: 'github-actions', reason: `CLI reset to ${timeframe}` });
    const slack = new SlackService(null, cfg.slack.botToken, cfg.slack.channelId, cfg.app.email || `#${accountId}`, accountId);
    const email = cfg.app.email || `#${accountId}`;
    await slack.send(`✅ State reset for *${email}* to *${timeframe}* (${newDate.toUTCString()})`);
    console.log(`✅ State reset to ${newDate.toUTCString()}`);
    return;
  }

  if (command === 'delete') {
    const [accountIdStr, emailId] = args;
    if (!accountIdStr || !emailId) {
      console.error('Usage: node index.js delete <accountId> <emailId>');
      process.exit(1);
    }
    const accountId = parseInt(accountIdStr, 10);
    try {
      const cfg          = loadConfig(accountId);
      const gmailService = new GmailService(cfg.gmail);
      const slackService = new SlackService(null, cfg.slack.botToken, cfg.slack.channelId, cfg.app.email || `#${accountId}`, accountId);
      await gmailService.deleteEmail(emailId);
      await slackService.send(`✅ Email \`${emailId}\` moved to trash`);
    } catch (err) {
      console.error(`❌ Failed to delete \`${emailId}\`: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  // Scheduler mode — runs checkAllAccounts() on a recurring interval
  const interval = parseInt(process.env.EMAIL_CHECK_INTERVAL, 10) || 3 * 60 * 60 * 1000;
  const accounts = loadAccounts();
  let intervalHandle = null;
  const shutdown = async (signal) => {
    console.log(`\n📍 ${signal} — shutting down...`);
    if (intervalHandle) clearInterval(intervalHandle);
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => { console.error('Uncaught:', err.message); shutdown('uncaughtException'); });
  process.on('unhandledRejection', (r) => { console.error('Unhandled rejection:', r); shutdown('unhandledRejection'); });

  await checkAllAccounts();
  intervalHandle = setInterval(checkAllAccounts, interval);
  console.log(`⏰ Scheduler running — interval: ${interval / 60_000} min, accounts: ${accounts.map((a) => a.id).join(', ')}`);
}

main().catch((err) => { console.error('Fatal:', err.message); process.exit(1); });

