'use strict';

const { google } = require('googleapis');
const { retryWithBackoff } = require('../utils/retry');
const { validateGmailCredentials } = require('../config');
const { sanitizeContent } = require('../../utils/summarizer');

/**
 * Gmail service — wraps all Google Gmail API operations.
 *
 * The client is lazily initialised and cached after the first call.
 * All mutating operations use retryWithBackoff for transient failure resilience.
 */
class GmailService {
  /**
   * @param {object} gmailConfig
   * @param {string} gmailConfig.clientId
   * @param {string} gmailConfig.clientSecret
   * @param {string} gmailConfig.redirectUrl
   * @param {string} gmailConfig.accessToken
   * @param {string} gmailConfig.refreshToken
   */
  constructor(gmailConfig) {
    validateGmailCredentials(gmailConfig);
    this._config = gmailConfig;
    this._client = null;
  }

  /**
   * Return the cached Gmail API client, initialising it on first call.
   *
   * @returns {Promise<object>} googleapis Gmail v1 client
   */
  async getClient() {
    if (this._client) return this._client;

    const auth = new google.auth.OAuth2(
      this._config.clientId,
      this._config.clientSecret,
      this._config.redirectUrl
    );
    auth.setCredentials({
      access_token: this._config.accessToken,
      refresh_token: this._config.refreshToken,
    });
    this._client = google.gmail({ version: 'v1', auth });
    return this._client;
  }

  /**
   * Fetch emails received strictly after a given Date.
   *
   * Uses a Unix-timestamp "after:" query (time-based, not flag-based)
   * so the result is deterministic regardless of read/unread status.
   *
   * @param {Date} since
   * @param {number} [maxResults=50]
   * @returns {Promise<Array<{id, from, subject, snippet, timestamp}>>}
   */
  async fetchEmailsSince(since, maxResults = 50) {
    const gmail = await this.getClient();
    const afterTs = Math.floor(since.getTime() / 1000);
    // Gmail does not return results for after:0 (epoch). Fall back to last 30 days
    // on first run (no prior state) so the initial check is always meaningful.
    const query = afterTs > 0 ? `after:${afterTs}` : 'newer_than:30d';

    const listResp = await retryWithBackoff(
      () => gmail.users.messages.list({ userId: 'me', q: query, maxResults }),
      3,
      1000
    );

    if (!listResp.data.messages?.length) return [];

    const emails = [];
    for (const { id } of listResp.data.messages) {
      const msg = await retryWithBackoff(
        () => gmail.users.messages.get({ userId: 'me', id, format: 'full' }),
        3,
        1000
      );
      emails.push(this._parseMessage(id, msg.data));
    }
    return emails;
  }

  /**
   * Fetch emails in a date range (used by batch cleanup).
   * Uses metadata-only format for efficiency (snippet + headers, no body).
   *
   * @param {Date} from
   * @param {Date} to
   * @param {number} [maxResults=500]
   * @returns {Promise<Array>}
   */
  async fetchEmailsInRange(from, to, maxResults = 500) {
    const gmail = await this.getClient();
    const afterTs = Math.floor(from.getTime() / 1000);
    const beforeTs = Math.floor(to.getTime() / 1000);
    const query = `after:${afterTs} before:${beforeTs}`;

    const listResp = await retryWithBackoff(
      () => gmail.users.messages.list({ userId: 'me', q: query, maxResults }),
      3,
      1000
    );

    if (!listResp.data.messages?.length) return [];

    const emails = [];
    for (const { id } of listResp.data.messages) {
      const msg = await retryWithBackoff(
        () =>
          gmail.users.messages.get({
            userId: 'me',
            id,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject'],
          }),
        3,
        1000
      );
      emails.push(this._parseMessage(id, msg.data));
    }
    return emails;
  }

  /**
   * Move an email to trash (removes INBOX label, adds TRASH).
   *
   * @param {string} emailId
   */
  async deleteEmail(emailId) {
    const gmail = await this.getClient();
    await retryWithBackoff(
      () =>
        gmail.users.messages.modify({
          userId: 'me',
          id: emailId,
          requestBody: { removeLabelIds: ['INBOX'], addLabelIds: ['TRASH'] },
        }),
      3,
      1000
    );
  }

  /**
   * Remove the UNREAD label from an email.
   *
   * @param {string} emailId
   */
  async markAsRead(emailId) {
    const gmail = await this.getClient();
    await retryWithBackoff(
      () =>
        gmail.users.messages.modify({
          userId: 'me',
          id: emailId,
          requestBody: { removeLabelIds: ['UNREAD'] },
        }),
      3,
      1000
    );
  }

  /**
   * Archive an email by removing the INBOX label (keeps it in All Mail).
   *
   * @param {string} emailId
   */
  async archiveEmail(emailId) {
    const gmail = await this.getClient();
    await retryWithBackoff(
      () =>
        gmail.users.messages.modify({
          userId: 'me',
          id: emailId,
          requestBody: { removeLabelIds: ['INBOX'] },
        }),
      3,
      1000
    );
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  _parseMessage(id, data) {
    const headers = data.payload?.headers ?? [];
    const from = headers.find((h) => h.name === 'From')?.value || 'Unknown';
    const subject = headers.find((h) => h.name === 'Subject')?.value || '(No Subject)';
    const snippet = sanitizeContent(data.snippet || '');
    const timestamp = new Date(parseInt(data.internalDate ?? '0', 10));
    return { id, from, subject, snippet, timestamp };
  }
}

module.exports = { GmailService };
