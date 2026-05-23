'use strict';

const { handleReset, _setRateLimiter } = require('../../src/commands/reset');

// ─── Mock StateManager ────────────────────────────────────────────────────────

function makeStateMgr(overrides = {}) {
  return {
    load: jest.fn().mockReturnValue({
      lastCheckTime: '2026-05-01T00:00:00.000Z',
      status: 'success',
    }),
    resetTo: jest.fn().mockReturnValue({}),
    ...overrides,
  };
}

// ─── Mock RateLimiter ─────────────────────────────────────────────────────────

function makeRateLimiter({ allowed = true } = {}) {
  return {
    check: jest.fn().mockReturnValue({ allowed, remainingMs: allowed ? 0 : 3_600_000 }),
    clear: jest.fn(),
  };
}

// Install permissive rate limiter before each test
beforeEach(() => {
  _setRateLimiter(makeRateLimiter({ allowed: true }));
});

describe('handleReset()', () => {
  describe('input validation', () => {
    it('returns error when text is empty', async () => {
      const res = await handleReset({ text: '', stateManager: makeStateMgr() });
      expect(res.response_type).toBe('ephemeral');
      expect(res.text).toMatch(/provide a timeframe/i);
    });

    it('returns error when text is only whitespace', async () => {
      const res = await handleReset({ text: '   ', stateManager: makeStateMgr() });
      expect(res.text).toMatch(/provide a timeframe/i);
    });

    it('returns error for invalid timeframe and clears rate-limit slot', async () => {
      const mockLimiter = makeRateLimiter({ allowed: true });
      _setRateLimiter(mockLimiter);

      const res = await handleReset({ text: 'banana', stateManager: makeStateMgr() });
      expect(res.text).toMatch(/invalid timeframe/i);
      expect(mockLimiter.clear).toHaveBeenCalled();
    });
  });

  describe('rate limiting', () => {
    it('returns rate-limit error when limiter blocks', async () => {
      _setRateLimiter(makeRateLimiter({ allowed: false }));
      const res = await handleReset({ text: '24h', stateManager: makeStateMgr() });
      expect(res.text).toMatch(/rate limit/i);
    });
  });

  describe('successful reset', () => {
    it('calls stateManager.resetTo with a Date when "24h" is given', async () => {
      const sm = makeStateMgr();
      const res = await handleReset({
        text: '24h',
        userId: 'U123',
        userName: 'alice',
        stateManager: sm,
        accountId: 1,
      });

      expect(sm.resetTo).toHaveBeenCalledTimes(1);
      const [date, meta] = sm.resetTo.mock.calls[0];
      expect(date).toBeInstanceOf(Date);
      // The date should be approximately 24h ago (within 5s tolerance)
      const expected = Date.now() - 24 * 3_600_000;
      expect(Math.abs(date.getTime() - expected)).toBeLessThan(5000);
      expect(meta.resetBy).toBe('alice');
    });

    it('returns Block Kit blocks on success (not plain text)', async () => {
      const res = await handleReset({ text: '7d', stateManager: makeStateMgr() });
      expect(res.blocks).toBeDefined();
      expect(Array.isArray(res.blocks)).toBe(true);
      expect(res.response_type).toBe('ephemeral');
    });

    it('uses userId as fallback when userName is absent', async () => {
      const sm = makeStateMgr();
      await handleReset({ text: '24h', userId: 'U456', stateManager: sm });
      const [, meta] = sm.resetTo.mock.calls[0];
      expect(meta.resetBy).toBe('U456');
    });

    it('handles accountId=null (default account)', async () => {
      const sm = makeStateMgr();
      const res = await handleReset({ text: '7d', stateManager: sm, accountId: null });
      expect(res.blocks).toBeDefined();
    });
  });
});
