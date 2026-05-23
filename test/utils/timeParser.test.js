'use strict';

const { parseTimeframe, parseDateRange, toGmailDateString } = require('../../src/utils/timeParser');

describe('parseTimeframe', () => {
  // Fixed reference point: 2026-06-01T12:00:00.000Z
  const NOW = new Date('2026-06-01T12:00:00.000Z');

  describe('relative durations', () => {
    it('parses "24h" to 24 hours ago', () => {
      const result = parseTimeframe('24h', NOW);
      expect(result.getTime()).toBe(NOW.getTime() - 24 * 3_600_000);
    });

    it('parses "1h" (minimum)', () => {
      const result = parseTimeframe('1h', NOW);
      expect(result.getTime()).toBe(NOW.getTime() - 3_600_000);
    });

    it('parses "7d" to 7 days ago', () => {
      const result = parseTimeframe('7d', NOW);
      expect(result.getTime()).toBe(NOW.getTime() - 7 * 86_400_000);
    });

    it('parses "30d"', () => {
      const result = parseTimeframe('30d', NOW);
      expect(result.getTime()).toBe(NOW.getTime() - 30 * 86_400_000);
    });

    it('is case-insensitive: "7D" works', () => {
      const result = parseTimeframe('7D', NOW);
      expect(result.getTime()).toBe(NOW.getTime() - 7 * 86_400_000);
    });
  });

  describe('absolute date formats', () => {
    it('parses "2026-05-20" to midnight UTC on that day', () => {
      const result = parseTimeframe('2026-05-20', NOW);
      expect(result.toISOString()).toBe('2026-05-20T00:00:00.000Z');
    });

    it('parses "2026-05-20 14:30" to 14:30 UTC', () => {
      const result = parseTimeframe('2026-05-20 14:30', NOW);
      expect(result.toISOString()).toBe('2026-05-20T14:30:00.000Z');
    });

    it('parses "2026-05-20T14:30" (T separator)', () => {
      const result = parseTimeframe('2026-05-20T14:30', NOW);
      expect(result.toISOString()).toBe('2026-05-20T14:30:00.000Z');
    });

    it('parses "2026-05-20T14:30:00Z" (full ISO)', () => {
      const result = parseTimeframe('2026-05-20T14:30:00Z', NOW);
      expect(result.toISOString()).toBe('2026-05-20T14:30:00.000Z');
    });
  });

  describe('validation errors', () => {
    it('throws for empty string', () => {
      expect(() => parseTimeframe('', NOW)).toThrow();
    });

    it('throws for null input', () => {
      expect(() => parseTimeframe(null, NOW)).toThrow();
    });

    it('throws for "0h" (below 1 hour minimum)', () => {
      expect(() => parseTimeframe('0h', NOW)).toThrow('Minimum timeframe is 1 hour');
    });

    it('throws for "91d" (over 90 day maximum)', () => {
      expect(() => parseTimeframe('91d', NOW)).toThrow('Maximum timeframe is 90 days');
    });

    it('throws for future date', () => {
      expect(() => parseTimeframe('2030-01-01', NOW)).toThrow('future');
    });

    it('throws for date > 90 days ago', () => {
      expect(() => parseTimeframe('2020-01-01', NOW)).toThrow('too far in the past');
    });

    it('throws for unrecognised format "banana"', () => {
      expect(() => parseTimeframe('banana', NOW)).toThrow('Unrecognised');
    });
  });
});

describe('parseDateRange', () => {
  const NOW = new Date('2026-06-01T12:00:00.000Z');

  it('returns { from, to: now } when toStr is null', () => {
    const { from, to } = parseDateRange('7d', null, NOW);
    expect(from.getTime()).toBe(NOW.getTime() - 7 * 86_400_000);
    expect(to.getTime()).toBe(NOW.getTime());
  });

  it('parses "2026-05-15" and "2026-05-22" as a range', () => {
    const { from, to } = parseDateRange('2026-05-15', '2026-05-22', NOW);
    expect(from.toISOString()).toBe('2026-05-15T00:00:00.000Z');
    expect(to.toISOString()).toBe('2026-05-22T00:00:00.000Z');
  });

  it('throws when from >= to', () => {
    expect(() => parseDateRange('2026-05-22', '2026-05-15', NOW)).toThrow('"from" date must be before');
  });
});

describe('toGmailDateString', () => {
  it('formats date as YYYY/MM/DD', () => {
    const date = new Date('2026-05-07T00:00:00.000Z');
    expect(toGmailDateString(date)).toBe('2026/05/07');
  });

  it('pads single-digit month and day', () => {
    const date = new Date('2026-01-03T00:00:00.000Z');
    expect(toGmailDateString(date)).toBe('2026/01/03');
  });
});
