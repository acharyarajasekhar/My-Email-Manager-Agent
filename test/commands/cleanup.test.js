'use strict';

const { handleCleanup, _setRateLimiter } = require('../../src/commands/cleanup');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRateLimiter({ allowed = true } = {}) {
  return {
    check: jest.fn().mockReturnValue({ allowed, remainingMs: allowed ? 0 : 86_400_000 }),
    clear: jest.fn(),
  };
}

function makeGmailService(emails = []) {
  return {
    fetchEmailsInRange: jest.fn().mockResolvedValue(emails),
    deleteEmail: jest.fn().mockResolvedValue(),
    archiveEmail: jest.fn().mockResolvedValue(),
  };
}

function makeSlackService() {
  return {
    send: jest.fn().mockResolvedValue(),
    respondToUrl: jest.fn().mockResolvedValue(),
  };
}

// Install permissive rate limiter before each test
beforeEach(() => {
  _setRateLimiter(makeRateLimiter({ allowed: true }));
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('handleCleanup()', () => {
  describe('input validation', () => {
    it('returns error for empty text', async () => {
      const res = await handleCleanup({
        text: '',
        gmailService: makeGmailService(),
        slackService: makeSlackService(),
      });
      expect(res.response_type).toBe('ephemeral');
      expect(res.text).toMatch(/provide a timeframe/i);
    });

    it('returns error for invalid timeframe and clears rate-limit slot', async () => {
      const mockLimiter = makeRateLimiter({ allowed: true });
      _setRateLimiter(mockLimiter);

      const res = await handleCleanup({
        text: 'notadate',
        gmailService: makeGmailService(),
        slackService: makeSlackService(),
      });
      expect(res.text).toMatch(/invalid timeframe/i);
      expect(mockLimiter.clear).toHaveBeenCalled();
    });
  });

  describe('rate limiting', () => {
    it('returns rate-limit error when blocked', async () => {
      _setRateLimiter(makeRateLimiter({ allowed: false }));

      const res = await handleCleanup({
        text: '7d',
        gmailService: makeGmailService(),
        slackService: makeSlackService(),
      });
      expect(res.text).toMatch(/rate limit/i);
    });
  });

  describe('successful ack', () => {
    it('returns an immediate acknowledgment message for "7d"', async () => {
      const res = await handleCleanup({
        text: '7d',
        userId: 'U123',
        userName: 'alice',
        gmailService: makeGmailService(),
        slackService: makeSlackService(),
        responseUrl: 'https://hooks.slack.com/response',
      });

      expect(res.response_type).toBe('ephemeral');
      expect(res.text).toMatch(/7d/);
    });

    it('notes dry-run in the ack message when --dry-run flag present in text', async () => {
      // Note: handleCleanup receives pre-stripped text; dryRun is a separate boolean
      const res = await handleCleanup({
        text: '7d',
        gmailService: makeGmailService(),
        slackService: makeSlackService(),
        dryRun: true,
      });

      expect(res.text).toMatch(/dry.?run/i);
    });

    it('schedules background job via setImmediate (not resolved in ack)', async () => {
      const spy = jest.spyOn(global, 'setImmediate');

      await handleCleanup({
        text: '24h',
        gmailService: makeGmailService(),
        slackService: makeSlackService(),
        responseUrl: 'https://hooks.slack.com/response',
      });

      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });
  });

  describe('date-range parsing', () => {
    it('parses "2026-05-15 2026-05-22" as a date range', async () => {
      // We can't intercept the from/to directly, but can verify no error is returned
      const res = await handleCleanup({
        text: '2026-05-15 2026-05-22',
        gmailService: makeGmailService(),
        slackService: makeSlackService(),
      });

      // Should be an ack (not an error)
      expect(res.response_type).toBe('ephemeral');
      expect(res.text).not.toMatch(/invalid/i);
    });

    it('returns error when range dates are reversed', async () => {
      const mockLimiter = makeRateLimiter({ allowed: true });
      _setRateLimiter(mockLimiter);

      const res = await handleCleanup({
        text: '2026-05-22 2026-05-15', // reversed
        gmailService: makeGmailService(),
        slackService: makeSlackService(),
      });

      expect(res.text).toMatch(/invalid/i);
      expect(mockLimiter.clear).toHaveBeenCalled();
    });
  });
});
