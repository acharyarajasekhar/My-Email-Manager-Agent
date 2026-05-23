'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_FILE = '.rate-limits.json';

/**
 * File-backed rate limiter.
 * Persists last-used timestamps to survive process restarts.
 *
 * Usage:
 *   const limiter = new RateLimiter();
 *   const { allowed, remainingMs } = limiter.check('reset:account-1', 3_600_000);
 */
class RateLimiter {
  /**
   * @param {string} [filePath] - Override for the backing JSON file path (useful in tests)
   */
  constructor(filePath = path.join(process.cwd(), DEFAULT_FILE)) {
    this._filePath = filePath;
    this._data = this._load();
  }

  /**
   * Check whether a keyed operation is allowed; record usage if so.
   *
   * @param {string} key        - Unique key, e.g. "reset:account-1"
   * @param {number} cooldownMs - Minimum milliseconds between allowed uses
   * @returns {{ allowed: boolean, remainingMs: number }}
   */
  check(key, cooldownMs) {
    const now = Date.now();
    const lastUsed = this._data[key] ?? 0;
    const elapsed = now - lastUsed;

    if (elapsed < cooldownMs) {
      return { allowed: false, remainingMs: cooldownMs - elapsed };
    }

    this._data[key] = now;
    this._save();
    return { allowed: true, remainingMs: 0 };
  }

  /**
   * Reset a specific key (admin override / test helper).
   *
   * @param {string} key
   */
  clear(key) {
    delete this._data[key];
    this._save();
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  _load() {
    try {
      if (fs.existsSync(this._filePath)) {
        return JSON.parse(fs.readFileSync(this._filePath, 'utf8'));
      }
    } catch {
      // Corrupt file — start fresh
    }
    return {};
  }

  _save() {
    try {
      fs.writeFileSync(this._filePath, JSON.stringify(this._data, null, 2));
    } catch {
      // Best-effort; don't crash the process on write failures
    }
  }
}

module.exports = { RateLimiter };
