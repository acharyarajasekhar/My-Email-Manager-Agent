'use strict';

/**
 * Timezone utilities for consistent IST (Indian Standard Time) formatting.
 * Timezone is configurable via TZ environment variable (default: Asia/Kolkata).
 */

const TZ = process.env.TZ || 'Asia/Kolkata';

/**
 * Format a date to localized string in configured timezone.
 * Default: IST (Asia/Kolkata)
 *
 * @param {Date|string|number} date - Date object, ISO string, or timestamp
 * @returns {string} Formatted date string in configured timezone
 */
function formatDate(date) {
  try {
    const d = typeof date === 'string' || typeof date === 'number' 
      ? new Date(date) 
      : date;
    
    if (isNaN(d.getTime())) return 'Invalid Date';
    
    return d.toLocaleString('en-IN', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  } catch (err) {
    return String(date);
  }
}

/**
 * Get current time in configured timezone.
 * @returns {string} Current time formatted in configured timezone
 */
function now() {
  return formatDate(new Date());
}

/**
 * Get timezone abbreviation (e.g., 'IST' for Asia/Kolkata).
 * @returns {string} Timezone abbreviation
 */
function getTimezoneAbbr() {
  const formatter = new Intl.DateTimeFormat('en-IN', {
    timeZone: TZ,
    timeZoneName: 'short',
  });
  
  const parts = formatter.formatToParts(new Date());
  const tzPart = parts.find(p => p.type === 'timeZoneName');
  return tzPart ? tzPart.value : TZ;
}

module.exports = { formatDate, now, getTimezoneAbbr, TZ };
