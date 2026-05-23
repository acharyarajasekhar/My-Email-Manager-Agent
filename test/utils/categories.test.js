'use strict';

const {
  CATEGORIES,
  CLEANUP_ACTIONS,
  CATEGORY_ACTIONS,
  categorizeEmail,
  getCleanupAction,
} = require('../../src/utils/categories');

describe('categorizeEmail', () => {
  describe('OTP detection (highest priority)', () => {
    it('detects "OTP" in subject', () => {
      expect(categorizeEmail({ subject: 'Your OTP is 123456' })).toBe(CATEGORIES.OTP);
    });

    it('detects "2fa" in subject', () => {
      expect(categorizeEmail({ subject: 'Two-factor 2FA login code' })).toBe(CATEGORIES.OTP);
    });

    it('detects "verification code" in snippet', () => {
      expect(categorizeEmail({ snippet: 'Your verification code is 998877' })).toBe(CATEGORIES.OTP);
    });
  });

  describe('Bank detection', () => {
    it('detects "debit alert"', () => {
      expect(categorizeEmail({ subject: 'Debit Alert: INR 5,000 withdrawn' })).toBe(CATEGORIES.BANK);
    });

    it('detects "account balance" in snippet', () => {
      expect(categorizeEmail({ snippet: 'Your account balance is ₹12,345' })).toBe(CATEGORIES.BANK);
    });
  });

  describe('Marketing detection', () => {
    it('detects "flash sale"', () => {
      expect(categorizeEmail({ subject: 'Flash sale — 50% off everything!' })).toBe(CATEGORIES.MARKETING);
    });

    it('detects "buy now"', () => {
      expect(categorizeEmail({ subject: 'Buy now before the offer ends' })).toBe(CATEGORIES.MARKETING);
    });
  });

  describe('Newsletter detection', () => {
    it('detects "newsletter"', () => {
      expect(categorizeEmail({ subject: 'Weekly newsletter: top stories' })).toBe(CATEGORIES.NEWSLETTER);
    });

    it('detects "unsubscribe" in snippet', () => {
      expect(categorizeEmail({ snippet: 'To unsubscribe from this list, click here' })).toBe(CATEGORIES.NEWSLETTER);
    });
  });

  describe('Social detection', () => {
    it('detects "new follower"', () => {
      expect(categorizeEmail({ subject: 'You have a new follower on Twitter' })).toBe(CATEGORIES.SOCIAL);
    });

    it('detects "tagged you"', () => {
      expect(categorizeEmail({ snippet: 'Alice tagged you in a photo on Facebook' })).toBe(CATEGORIES.SOCIAL);
    });
  });

  describe('Insurance detection', () => {
    it('detects "policy renewal"', () => {
      expect(categorizeEmail({ subject: 'Your policy renewal is due this month' })).toBe(CATEGORIES.INSURANCE);
    });
  });

  describe('Tickets detection', () => {
    it('detects "booking confirmation"', () => {
      expect(categorizeEmail({ subject: 'Booking confirmation — Coldplay Mumbai 2026' })).toBe(CATEGORIES.TICKETS);
    });

    it('detects "event ticket"', () => {
      expect(categorizeEmail({ subject: 'Your event ticket is ready' })).toBe(CATEGORIES.TICKETS);
    });
  });

  describe('Receipt detection', () => {
    it('detects "order confirmation"', () => {
      expect(categorizeEmail({ subject: 'Order confirmation #12345' })).toBe(CATEGORIES.RECEIPT);
    });

    it('detects "invoice"', () => {
      expect(categorizeEmail({ subject: 'Invoice #INV-2026-001 from Acme Corp' })).toBe(CATEGORIES.RECEIPT);
    });
  });

  describe('Normal fallback', () => {
    it('returns NORMAL when no keyword matches', () => {
      expect(categorizeEmail({ subject: 'Hey, want to grab coffee?', snippet: 'Let me know if 3pm works.' })).toBe(CATEGORIES.NORMAL);
    });

    it('returns NORMAL for empty email', () => {
      expect(categorizeEmail({})).toBe(CATEGORIES.NORMAL);
    });
  });

  describe('Priority ordering', () => {
    it('OTP wins over BANK when both keywords present', () => {
      // "otp" and "account balance" both in subject — OTP should win (listed first in CATEGORY_KEYWORDS)
      expect(categorizeEmail({ subject: 'OTP for account balance verification' })).toBe(CATEGORIES.OTP);
    });
  });
});

describe('getCleanupAction', () => {
  it('returns DELETE for marketing', () => {
    expect(getCleanupAction(CATEGORIES.MARKETING)).toBe(CLEANUP_ACTIONS.DELETE);
  });

  it('returns DELETE for newsletter', () => {
    expect(getCleanupAction(CATEGORIES.NEWSLETTER)).toBe(CLEANUP_ACTIONS.DELETE);
  });

  it('returns DELETE for social', () => {
    expect(getCleanupAction(CATEGORIES.SOCIAL)).toBe(CLEANUP_ACTIONS.DELETE);
  });

  it('returns DELETE for OTP', () => {
    expect(getCleanupAction(CATEGORIES.OTP)).toBe(CLEANUP_ACTIONS.DELETE);
  });

  it('returns ARCHIVE for bank', () => {
    expect(getCleanupAction(CATEGORIES.BANK)).toBe(CLEANUP_ACTIONS.ARCHIVE);
  });

  it('returns ARCHIVE for investment', () => {
    expect(getCleanupAction(CATEGORIES.INVESTMENT)).toBe(CLEANUP_ACTIONS.ARCHIVE);
  });

  it('returns ARCHIVE for receipt', () => {
    expect(getCleanupAction(CATEGORIES.RECEIPT)).toBe(CLEANUP_ACTIONS.ARCHIVE);
  });

  it('returns FLAG for insurance', () => {
    expect(getCleanupAction(CATEGORIES.INSURANCE)).toBe(CLEANUP_ACTIONS.FLAG);
  });

  it('returns FLAG for tickets', () => {
    expect(getCleanupAction(CATEGORIES.TICKETS)).toBe(CLEANUP_ACTIONS.FLAG);
  });

  it('returns SKIP for normal', () => {
    expect(getCleanupAction(CATEGORIES.NORMAL)).toBe(CLEANUP_ACTIONS.SKIP);
  });

  it('returns SKIP for unknown category', () => {
    expect(getCleanupAction('unknown_category')).toBe(CLEANUP_ACTIONS.SKIP);
  });
});

describe('CATEGORY_ACTIONS completeness', () => {
  it('every non-NORMAL category has an action defined', () => {
    const definedCategories = Object.values(CATEGORIES).filter(c => c !== CATEGORIES.NORMAL);
    for (const category of definedCategories) {
      expect(CATEGORY_ACTIONS).toHaveProperty(category);
      expect(Object.values(CLEANUP_ACTIONS)).toContain(CATEGORY_ACTIONS[category]);
    }
  });
});
