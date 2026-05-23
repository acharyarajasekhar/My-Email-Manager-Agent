'use strict';

/**
 * Parse a human-readable timeframe string into a Date representing
 * "this far back from now".
 *
 * Supported formats:
 *   "24h"              → 24 hours ago
 *   "7d"               → 7 days ago
 *   "2026-05-20"       → Start of that UTC day
 *   "2026-05-20 14:30" → Specific UTC date + time
 *
 * Validated range: minimum 1 hour, maximum 90 days in the past.
 *
 * @param {string} input
 * @param {Date} [now] - Reference point (defaults to current time; useful for testing)
 * @returns {Date}
 * @throws {Error} when the format is unrecognised or out of allowed range
 */
function parseTimeframe(input, now = new Date()) {
  if (!input || typeof input !== 'string') {
    throw new Error('Timeframe must be a non-empty string');
  }
  const str = input.trim();

  // Hours: "24h"
  const hoursMatch = str.match(/^(\d+)h$/i);
  if (hoursMatch) {
    const hours = parseInt(hoursMatch[1], 10);
    _validateMinutes(hours * 60);
    return new Date(now.getTime() - hours * 3_600_000);
  }

  // Days: "7d"
  const daysMatch = str.match(/^(\d+)d$/i);
  if (daysMatch) {
    const days = parseInt(daysMatch[1], 10);
    _validateMinutes(days * 1440);
    return new Date(now.getTime() - days * 86_400_000);
  }

  // Date + time: "2026-05-20 14:30" or "2026-05-20T14:30" or "2026-05-20T14:30:00Z"
  const dateTimeMatch = str.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?Z?$/);
  if (dateTimeMatch) {
    const secs = dateTimeMatch[3] || ':00';
    const dt = new Date(`${dateTimeMatch[1]}T${dateTimeMatch[2]}${secs}Z`);
    if (isNaN(dt.getTime())) throw new Error(`Invalid date/time: "${str}"`);
    _validateDateRange(dt, now);
    return dt;
  }

  // Date only: "2026-05-20"
  const dateMatch = str.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (dateMatch) {
    const dt = new Date(`${dateMatch[1]}T00:00:00Z`);
    if (isNaN(dt.getTime())) throw new Error(`Invalid date: "${str}"`);
    _validateDateRange(dt, now);
    return dt;
  }

  throw new Error(
    `Unrecognised timeframe: "${str}". Use formats like "24h", "7d", or "2026-05-20"`
  );
}

/**
 * Parse a date range from two separate strings.
 * The second argument can be another date string or absent (defaults to now).
 *
 * @param {string} fromStr
 * @param {string|null} [toStr]
 * @param {Date} [now]
 * @returns {{ from: Date, to: Date }}
 */
function parseDateRange(fromStr, toStr = null, now = new Date()) {
  const from = parseTimeframe(fromStr, now);
  const to = toStr ? parseTimeframe(toStr, now) : now;
  if (from >= to) throw new Error('"from" date must be before "to" date');
  return { from, to };
}

/**
 * Format a Date as a Gmail "after:" query token: "YYYY/MM/DD".
 *
 * @param {Date} date
 * @returns {string}
 */
function toGmailDateString(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

// ─── Private helpers ─────────────────────────────────────────────────────────

const MIN_MINUTES = 60;          // 1 hour
const MAX_MINUTES = 90 * 1440;   // 90 days

function _validateMinutes(minutes) {
  if (minutes < MIN_MINUTES) throw new Error('Minimum timeframe is 1 hour');
  if (minutes > MAX_MINUTES) throw new Error('Maximum timeframe is 90 days');
}

function _validateDateRange(date, now) {
  const minDate = new Date(now.getTime() - MAX_MINUTES * 60_000);
  if (date < minDate) throw new Error('Date is too far in the past (max 90 days)');
  if (date > now) throw new Error('Date cannot be in the future');
}

module.exports = { parseTimeframe, parseDateRange, toGmailDateString };
