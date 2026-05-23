'use strict';

/**
 * Email category identifiers.
 */
const CATEGORIES = Object.freeze({
  MARKETING: 'marketing',
  PROMOTION: 'promotion',
  NEWSLETTER: 'newsletter',
  SOCIAL: 'social',
  BANK: 'bank',
  INVESTMENT: 'investment',
  RECEIPT: 'receipt',
  INSURANCE: 'insurance',
  TICKETS: 'tickets',
  OTP: 'otp',
  ACCOUNT_ALERT: 'account_alert',
  ACCOUNT_MANAGEMENT: 'account_management',
  NORMAL: 'normal',
});

/**
 * Cleanup actions that can be applied to each category.
 */
const CLEANUP_ACTIONS = Object.freeze({
  DELETE: 'delete',
  ARCHIVE: 'archive',
  FLAG: 'flag',    // Keep for manual review
  SKIP: 'skip',    // No action
});

/**
 * Keywords matched against lowercased "subject + snippet + from" string.
 * OTP is highest priority (time-sensitive); order within the loop matters.
 */
const CATEGORY_KEYWORDS = {
  [CATEGORIES.OTP]: [
    'otp', 'one-time password', 'verification code', 'confirm identity',
    '2fa', 'two-factor', 'login code', 'auth code',
  ],
  [CATEGORIES.BANK]: [
    'transaction alert', 'debit alert', 'credit alert', 'withdrawal',
    'deposit', 'account balance', 'bank statement', 'net banking',
  ],
  [CATEGORIES.ACCOUNT_ALERT]: [
    'suspicious activity', 'unauthorized access', 'account security',
    'verify your account', 'account locked', 'password changed',
  ],
  [CATEGORIES.MARKETING]: [
    'sale', 'flash sale', 'offer', 'discount', 'limited time',
    'buy now', 'shop now', 'exclusive deal', 'special offer',
  ],
  [CATEGORIES.PROMOTION]: [
    'promo', 'coupon', 'cashback', 'reward points', 'voucher', 'redeem',
  ],
  [CATEGORIES.NEWSLETTER]: [
    'newsletter', 'weekly digest', 'monthly report', 'unsubscribe',
    'you are receiving this',
  ],
  [CATEGORIES.SOCIAL]: [
    'facebook', 'twitter', 'linkedin', 'instagram', 'new connection',
    'new follower', 'mentioned you', 'tagged you',
  ],
  [CATEGORIES.INVESTMENT]: [
    'portfolio', 'dividend', 'mutual fund', 'stock alert', 'trading',
    'broker', 'shares', 'nse', 'bse', 'nav update',
  ],
  [CATEGORIES.RECEIPT]: [
    'receipt', 'invoice', 'order confirmation', 'payment received',
    'order #', 'your order', 'shipment tracking',
  ],
  [CATEGORIES.INSURANCE]: [
    'insurance', 'policy renewal', 'claim', 'premium due', 'coverage',
    'beneficiary',
  ],
  [CATEGORIES.TICKETS]: [
    'event ticket', 'concert', 'booking confirmation', 'reservation',
    'eventbrite', 'bookmyshow',
  ],
  [CATEGORIES.ACCOUNT_MANAGEMENT]: [
    'account update', 'profile update', 'subscription renewal',
    'account settings', 'account information changed',
  ],
};

/**
 * Default cleanup action per category.
 */
const CATEGORY_ACTIONS = {
  [CATEGORIES.MARKETING]: CLEANUP_ACTIONS.DELETE,
  [CATEGORIES.PROMOTION]: CLEANUP_ACTIONS.DELETE,
  [CATEGORIES.NEWSLETTER]: CLEANUP_ACTIONS.DELETE,
  [CATEGORIES.SOCIAL]: CLEANUP_ACTIONS.DELETE,
  [CATEGORIES.OTP]: CLEANUP_ACTIONS.DELETE,
  [CATEGORIES.BANK]: CLEANUP_ACTIONS.ARCHIVE,
  [CATEGORIES.INVESTMENT]: CLEANUP_ACTIONS.ARCHIVE,
  [CATEGORIES.RECEIPT]: CLEANUP_ACTIONS.ARCHIVE,
  [CATEGORIES.ACCOUNT_MANAGEMENT]: CLEANUP_ACTIONS.ARCHIVE,
  [CATEGORIES.ACCOUNT_ALERT]: CLEANUP_ACTIONS.ARCHIVE,
  [CATEGORIES.INSURANCE]: CLEANUP_ACTIONS.FLAG,
  [CATEGORIES.TICKETS]: CLEANUP_ACTIONS.FLAG,
  [CATEGORIES.NORMAL]: CLEANUP_ACTIONS.SKIP,
};

/**
 * Categorise an email based on subject, snippet, and sender.
 * Returns the first matching category, or NORMAL if nothing matches.
 *
 * @param {{ subject?: string, snippet?: string, from?: string }} email
 * @returns {string} A value from CATEGORIES
 */
function categorizeEmail({ subject = '', snippet = '', from = '' }) {
  const text = `${subject} ${snippet} ${from}`.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (_matchesAny(text, keywords)) return category;
  }
  return CATEGORIES.NORMAL;
}

/**
 * Return the cleanup action for a given category.
 *
 * @param {string} category
 * @returns {string} A value from CLEANUP_ACTIONS
 */
function getCleanupAction(category) {
  return CATEGORY_ACTIONS[category] ?? CLEANUP_ACTIONS.SKIP;
}

// ─── Private ─────────────────────────────────────────────────────────────────

function _matchesAny(text, keywords) {
  return keywords.some((kw) => text.includes(kw));
}

module.exports = { CATEGORIES, CLEANUP_ACTIONS, CATEGORY_ACTIONS, categorizeEmail, getCleanupAction };
