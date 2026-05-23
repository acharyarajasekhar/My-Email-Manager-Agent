'use strict';

const axios = require('axios');
const { retryWithBackoff } = require('../utils/retry');

/**
 * Slack service — posting messages and building Block Kit payloads.
 *
 * Supports two posting modes:
 * 1. Incoming Webhooks (legacy, higher customization, can't delete messages)
 * 2. Bot token + chat.postMessage (newer, can delete messages, fixed bot identity)
 *
 * If both webhookUrl and botToken are provided, uses botToken.
 *
 * @param {string|null} webhookUrl - Incoming webhook URL (fallback/legacy)
 * @param {string|null} botToken   - Slack bot token (preferred)
 * @param {string|null} channelId  - Slack channel ID (required if botToken provided)
 * @param {string|null} [accountLabel] - e.g. "alice@gmail.com" or "account-1"
 * @param {number|null} [accountId]    - Numeric account ID for button values
 */
class SlackService {
  constructor(webhookUrl = null, botToken = null, channelId = null, accountLabel = null, accountId = null) {
    // Support legacy signature: SlackService(webhookUrl, accountLabel, accountId)
    if (typeof botToken === 'string' && !botToken.startsWith('xoxb-') && !channelId) {
      // Legacy call: SlackService(webhookUrl, accountLabel, accountId)
      accountLabel = botToken;
      accountId = channelId;
      botToken = null;
      channelId = null;
    }

    if (!webhookUrl && !botToken) {
      throw new Error('Either webhookUrl (legacy) or botToken (recommended) is required');
    }

    this._webhookUrl   = webhookUrl;
    this._botToken     = botToken;
    this._channelId    = channelId;
    this._accountLabel = accountLabel;
    this._accountId    = accountId;

    // Validate bot token setup
    if (this._botToken && !this._channelId) {
      throw new Error('channelId is required when using botToken');
    }
  }

  /**
   * Post a message to Slack via webhook or bot token.
   * Accepts either a plain string or a Block Kit payload object.
   *
   * @param {string|object} message
   */
  async send(message) {
    if (this._botToken) {
      return this._sendViaBot(message);
    } else {
      return this._sendViaWebhook(message);
    }
  }

  /**
   * Post via incoming webhook (legacy, can't delete).
   * @private
   */
  async _sendViaWebhook(message) {
    const payload =
      typeof message === 'string'
        ? { text: this._labelText(message) }
        : message;
    await retryWithBackoff(() => axios.post(this._webhookUrl, payload), 3, 1000);
  }

  /**
   * Post via bot token using chat.postMessage API (can delete).
   * @private
   */
  async _sendViaBot(message) {
    const payload = typeof message === 'string'
      ? { text: this._labelText(message) }
      : message;

    const body = {
      channel: this._channelId,
      ...payload,
    };

    const postMessage = () =>
      axios.post('https://slack.com/api/chat.postMessage', body, {
        headers: { Authorization: `Bearer ${this._botToken}` },
      });

    const response = await retryWithBackoff(postMessage, 3, 1000);
    const data = response.data;

    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error}`);
    }
  }

  /**
   * Reply via a Slack response_url (slash commands / interactive actions).
   *
   * @param {string} responseUrl
   * @param {object} payload
   */
  async respondToUrl(responseUrl, payload) {
    await retryWithBackoff(() => axios.post(responseUrl, payload), 2, 500);
  }

  /**
   * Format an email as plain-text Slack mrkdwn.
   *
   * @param {object} email - { from, subject, timestamp, preview }
   * @returns {string}
   */
  formatEmail(email) {
    const tz = require('../utils/timezone');
    const icon = email.preview?.type === 'marketing' ? '📢' : '📌';
    const type = email.preview?.type === 'marketing' ? 'Marketing' : 'Email';
    const received = email.timestamp
      ? tz.formatDate(email.timestamp)
      : 'Unknown';
    const accountLine = this._accountLabel ? `*Account:* ${this._accountLabel}\n` : '';

    let msg = `📧 ${icon} ${type}\n\n`;
    msg += accountLine;
    msg += `*From:* ${email.from}\n`;
    msg += `*Subject:* ${email.subject}\n`;
    msg += `*Received:* ${received}\n\n`;

    if (email.preview?.type === 'marketing') {
      msg += `_${email.preview?.summary || 'Marketing/Promotional email'}_\n`;
    } else {
      msg += `*Summary:*\n${email.preview?.summary || 'No summary'}\n\n`;
      msg += `*Action:* ${email.preview?.action || 'Review'}\n`;
    }
    return msg;
  }

  /**
   * Format an email as a Block Kit payload with action buttons.
   *
   * @param {object} email - { id, from, subject, timestamp, preview }
   * @returns {object} Block Kit payload
   */
  formatEmailWithButtons(email) {
    const tz = require('../utils/timezone');
    const icon = email.preview?.type === 'marketing' ? '📢' : '📌';
    const type = email.preview?.type === 'marketing' ? 'Marketing' : 'Email';
    const received = email.timestamp
      ? tz.formatDate(email.timestamp)
      : 'Unknown';
    const isMarketing = email.preview?.type === 'marketing';
    const accountPrefix = this._accountLabel ? `[${this._accountLabel}] ` : '';

    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `📧 ${icon} ${accountPrefix}${type}` },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*From:*\n${email.from}` },
          { type: 'mrkdwn', text: `*Received:*\n${received}` },
        ],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Subject:*\n${email.subject}` },
      },
    ];

    if (isMarketing) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `_${email.preview?.summary || 'Marketing/Promotional email'}_`,
        },
      });
    } else {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Summary:*\n${email.preview?.summary || 'No summary available'}`,
        },
      });
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Action Required:*\n${email.preview?.action || 'Review the email'}`,
        },
      });
    }

    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Delete', emoji: true },
          value: this._accountId ? `${this._accountId}|${email.id}` : email.id,
          action_id: `delete_gmail_${email.id}`,
          confirm: {
            title: { type: 'plain_text', text: 'Delete Email?' },
            text: { type: 'mrkdwn', text: 'This will move the email to trash.' },
            confirm: { type: 'plain_text', text: 'Delete' },
            deny: { type: 'plain_text', text: 'Cancel' },
          },
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Mark as Read', emoji: true },
          value: this._accountId ? `${this._accountId}|${email.id}` : email.id,
          action_id: `read_gmail_${email.id}`,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Dismiss', emoji: true },
          value: this._accountId ? `${this._accountId}|${email.id}` : email.id,
          action_id: `clear_gmail_${email.id}`,
        },
      ],
    });

    blocks.push({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `_${require('../utils/timezone').formatDate(new Date())}_` },
      ],
    });

    return { blocks };
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  _labelText(text) {
    return this._accountLabel ? `[${this._accountLabel}] ${text}` : text;
  }
}

module.exports = { SlackService };
