'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const { RateLimiter } = require('../../src/utils/rateLimiter');

function tempFile() {
  return path.join(os.tmpdir(), `rate-limits-test-${Date.now()}-${Math.random()}.json`);
}

describe('RateLimiter', () => {
  let filePath;
  let limiter;

  beforeEach(() => {
    filePath = tempFile();
    limiter = new RateLimiter(filePath);
  });

  afterEach(() => {
    try { fs.unlinkSync(filePath); } catch { /* already gone */ }
  });

  describe('check()', () => {
    it('allows first use of a key', () => {
      const result = limiter.check('reset:account-1', 3_600_000);
      expect(result.allowed).toBe(true);
      expect(result.remainingMs).toBe(0);
    });

    it('blocks second use within cooldown', () => {
      limiter.check('reset:account-1', 3_600_000);
      const result = limiter.check('reset:account-1', 3_600_000);
      expect(result.allowed).toBe(false);
      expect(result.remainingMs).toBeGreaterThan(0);
    });

    it('remainingMs is approximately the cooldown when called immediately after', () => {
      limiter.check('mykey', 60_000);
      const { remainingMs } = limiter.check('mykey', 60_000);
      // Should be close to 60_000; allow 500ms of execution slop
      expect(remainingMs).toBeGreaterThan(59_000);
      expect(remainingMs).toBeLessThanOrEqual(60_000);
    });

    it('allows use after cooldown has elapsed', () => {
      // Use a very short cooldown (0ms) — should allow immediately
      const r1 = limiter.check('fast', 0);
      const r2 = limiter.check('fast', 0);
      expect(r1.allowed).toBe(true);
      expect(r2.allowed).toBe(true);
    });

    it('different keys are independent', () => {
      limiter.check('key-a', 3_600_000);
      const result = limiter.check('key-b', 3_600_000);
      expect(result.allowed).toBe(true);
    });

    it('persists state to disk', () => {
      limiter.check('persist-key', 3_600_000);
      // Create a new limiter from same file — should still be blocked
      const limiter2 = new RateLimiter(filePath);
      const result = limiter2.check('persist-key', 3_600_000);
      expect(result.allowed).toBe(false);
    });
  });

  describe('clear()', () => {
    it('allows use again after clear()', () => {
      limiter.check('reset-key', 3_600_000);
      limiter.clear('reset-key');
      const result = limiter.check('reset-key', 3_600_000);
      expect(result.allowed).toBe(true);
    });

    it('clearing a non-existent key does not throw', () => {
      expect(() => limiter.clear('does-not-exist')).not.toThrow();
    });

    it('persists the cleared key to disk', () => {
      limiter.check('clear-persist', 3_600_000);
      limiter.clear('clear-persist');

      const limiter2 = new RateLimiter(filePath);
      const result = limiter2.check('clear-persist', 3_600_000);
      expect(result.allowed).toBe(true);
    });
  });

  describe('file handling', () => {
    it('starts with empty state when file does not exist', () => {
      const newFile = tempFile(); // file does not exist yet
      const l = new RateLimiter(newFile);
      expect(l.check('any', 3_600_000).allowed).toBe(true);
      try { fs.unlinkSync(newFile); } catch {}
    });

    it('recovers gracefully from corrupt JSON file', () => {
      fs.writeFileSync(filePath, 'THIS IS NOT JSON', 'utf8');
      const l = new RateLimiter(filePath);
      expect(l.check('any', 3_600_000).allowed).toBe(true);
    });
  });
});
