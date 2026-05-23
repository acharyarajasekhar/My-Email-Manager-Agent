'use strict';

const fs = require('fs');
const path = require('path');

const STATE_VERSION = 2;

/**
 * Manages the persistent email checkpoint state file.
 *
 * Design principle:
 *   The checkpoint is ONLY advanced after emails are successfully processed.
 *   If the process crashes mid-run, the next run will re-query from the same
 *   checkpoint — ensuring no emails are missed without producing duplicates
 *   (Gmail deduplicates by message ID within a single Slack channel).
 *
 * State file schema (v2):
 * {
 *   "version": 2,
 *   "lastCheckTime": "2026-05-23T12:00:00.000Z",   ← ISO 8601 UTC
 *   "lastCheckTimestamp": 1716462000000,             ← Unix ms (redundant but handy)
 *   "accountId": 1,
 *   "emailCountLastCheck": 5,
 *   "emailsProcessed": 127,
 *   "status": "success" | "failed" | "reset" | "initial" | "migrated",
 *   "nextScheduledCheck": "2026-05-23T15:00:00.000Z"   ← informational
 * }
 */
class StateManager {
  /**
   * @param {string} filePath - Path to the state JSON file
   * @param {number|null} [accountId]
   */
  constructor(filePath, accountId = null) {
    this._filePath = path.resolve(filePath);
    this._accountId = accountId;
  }

  /**
   * Load state from disk.
   * Returns a default epoch-0 state when the file does not exist.
   */
  load() {
    try {
      if (fs.existsSync(this._filePath)) {
        const raw = JSON.parse(fs.readFileSync(this._filePath, 'utf8'));
        return this._migrate(raw);
      }
    } catch (err) {
      console.error(`[State] Failed to load ${this._filePath}:`, err.message);
    }
    return this._defaultState();
  }

  /**
   * Persist a partial state patch to disk.
   * Merges with the existing state so callers only supply changed fields.
   *
   * @param {object} patch
   * @returns {object} Full merged state that was written
   */
  save(patch) {
    const current = this.load();
    const updated = {
      ...current,
      ...patch,
      version: STATE_VERSION,
      accountId: this._accountId ?? current.accountId,
    };
    // Keep ISO string and Unix timestamp in sync
    if (updated.lastCheckTime && patch.lastCheckTime && !patch.lastCheckTimestamp) {
      updated.lastCheckTimestamp = new Date(updated.lastCheckTime).getTime();
    }
    try {
      fs.writeFileSync(this._filePath, JSON.stringify(updated, null, 2));
    } catch (err) {
      console.error(`[State] Failed to save ${this._filePath}:`, err.message);
      throw err;
    }
    return updated;
  }

  /**
   * Return the Date of the last successful checkpoint (used as Gmail "after:" boundary).
   */
  getLastCheckTime() {
    const { lastCheckTime } = this.load();
    return new Date(lastCheckTime);
  }

  /**
   * Advance the checkpoint after successful processing.
   *
   * @param {Date} checkTime  - The start time of the successful check run
   * @param {number} emailCount - Number of emails fetched this run
   * @returns {object} Updated state
   */
  markSuccess(checkTime, emailCount) {
    const prev = this.load();
    return this.save({
      lastCheckTime: checkTime.toISOString(),
      lastCheckTimestamp: checkTime.getTime(),
      emailCountLastCheck: emailCount,
      emailsProcessed: (prev.emailsProcessed ?? 0) + emailCount,
      status: 'success',
      lastErrorMessage: undefined,
      lastErrorTime: undefined,
    });
  }

  /**
   * Record a failed check WITHOUT advancing the checkpoint.
   * The next run will re-query from the same starting point.
   *
   * @param {Error} [error]
   * @returns {object} Updated state
   */
  markFailed(error) {
    const { lastCheckTime } = this.load();
    return this.save({
      lastCheckTime,            // Intentionally unchanged
      status: 'failed',
      lastErrorMessage: error?.message ?? 'Unknown error',
      lastErrorTime: new Date().toISOString(),
    });
  }

  /**
   * Reset the checkpoint to a specific date.
   * Used by the /email-reset Slack command.
   *
   * @param {Date} date
   * @param {{ resetBy?: string, reason?: string }} [meta]
   * @returns {object} Updated state
   */
  resetTo(date, { resetBy, reason } = {}) {
    return this.save({
      lastCheckTime: date.toISOString(),
      lastCheckTimestamp: date.getTime(),
      status: 'reset',
      resetBy: resetBy ?? null,
      resetReason: reason ?? null,
      resetTimestamp: new Date().toISOString(),
    });
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  _defaultState() {
    return {
      version: STATE_VERSION,
      lastCheckTime: new Date(0).toISOString(),
      lastCheckTimestamp: 0,
      accountId: this._accountId,
      emailCountLastCheck: 0,
      emailsProcessed: 0,
      status: 'initial',
    };
  }

  /**
   * Migrate legacy v1 state format ({ gmail: "..." } or { lastCheck: "..." }).
   */
  _migrate(raw) {
    if (raw.version === STATE_VERSION) return raw;
    const legacyTime = raw.gmail || raw.lastCheck || raw.lastCheckTime;
    const defaults = this._defaultState();
    return {
      ...defaults,
      lastCheckTime: legacyTime || defaults.lastCheckTime,
      lastCheckTimestamp: legacyTime ? new Date(legacyTime).getTime() : 0,
      status: 'migrated',
    };
  }
}

module.exports = { StateManager };
