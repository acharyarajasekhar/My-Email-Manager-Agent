'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Load configuration for one account.
 *
 * Credentials are always read from prefixed env vars: ACCOUNT_1_GMAIL_CLIENT_ID, etc.
 * Use loadAccounts() to get the list of account IDs from accounts.json.
 *
 * @param {number} accountId
 */
function loadConfig(accountId) {
  if (!accountId) throw new Error('accountId is required — use loadAccounts() to iterate accounts');
  const id = typeof accountId === 'string' ? parseInt(accountId, 10) : accountId;
  const prefix = `ACCOUNT_${id}_`;

  const gmail = {
    clientId:     process.env[`${prefix}GMAIL_CLIENT_ID`],
    clientSecret: process.env[`${prefix}GMAIL_CLIENT_SECRET`],
    redirectUrl:  process.env[`${prefix}GMAIL_REDIRECT_URL`] || 'urn:ietf:wg:oauth:2.0:oob',
    accessToken:  process.env[`${prefix}GMAIL_ACCESS_TOKEN`],
    refreshToken: process.env[`${prefix}GMAIL_REFRESH_TOKEN`],
  };

  const slack = {
    webhookUrl:    process.env[`${prefix}SLACK_WEBHOOK_URL`],
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    botToken:      process.env.SLACK_BOT_TOKEN,
    channelId:     process.env[`${prefix}SLACK_CHANNEL_ID`],
  };

  const email = process.env[`${prefix}EMAIL`] || null;

  const app = {
    accountId: id,
    email,
    checkInterval: parseInt(process.env.EMAIL_CHECK_INTERVAL, 10) || 3 * 60 * 60 * 1000,
    stateFile: `.last-email-check-account-${id}.json`,
    emailPreviewLength: 2000,
    summarizerEngine: process.env.SUMMARIZER_ENGINE || 'natural',
    ollamaModel: process.env.OLLAMA_MODEL || 'mistral',
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    enableInteractiveButtons: process.env.ENABLE_INTERACTIVE_BUTTONS !== 'false',
    serverWebhookUrl: process.env.SERVER_WEBHOOK_URL || 'http://localhost:3000/slack/actions',
    port: parseInt(process.env.PORT, 10) || 3000,
    maxEmailsPerCleanup: parseInt(process.env.MAX_EMAILS_PER_CLEANUP, 10) || 500,
    slackCommandCooldownSecs: parseInt(process.env.SLACK_COMMAND_COOLDOWN, 10) || 3600,
    timezone: process.env.TZ || 'Asia/Kolkata',
  };

  return { gmail, slack, app };
}

/**
 * Load the accounts list from accounts.json.
 * PII (email, slack_channel) is NOT stored in the file — it is read from
 * ACCOUNT_N_EMAIL and ACCOUNT_N_SLACK_CHANNEL env vars and merged in here.
 *
 * Throws if accounts.json is missing, invalid, or contains no accounts.
 */
function loadAccounts() {
  const filePath = path.join(process.cwd(), 'accounts.json');
  if (!fs.existsSync(filePath)) {
    throw new Error(
      'accounts.json not found — create it with at least one account: {"accounts":[{"id":1}]}'
    );
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`accounts.json is invalid JSON: ${err.message}`);
  }
  const accounts = Array.isArray(data.accounts) ? data.accounts : [];
  if (accounts.length === 0) {
    throw new Error('accounts.json must contain at least one account');
  }
  return accounts.map((acct) => ({
    ...acct,
    email:         process.env[`ACCOUNT_${acct.id}_EMAIL`]          || acct.email          || null,
    slack_channel: process.env[`ACCOUNT_${acct.id}_SLACK_CHANNEL`]  || acct.slack_channel  || null,
  }));
}

/**
 * Validate required Gmail credentials.
 * Throws an error listing any missing keys.
 *
 * @param {object} gmail
 * @throws {Error}
 */
function validateGmailCredentials(gmail) {
  const required = ['clientId', 'clientSecret', 'accessToken', 'refreshToken'];
  const missing = required.filter((k) => !gmail[k]);
  if (missing.length > 0) {
    const error = new Error(`Missing Gmail credentials: ${missing.join(', ')}`);
    error.code = 'MISSING_CREDENTIALS';
    throw error;
  }
}

module.exports = { loadConfig, loadAccounts, validateGmailCredentials };
