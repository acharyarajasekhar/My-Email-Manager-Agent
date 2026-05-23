'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const { StateManager } = require('../../src/services/state');

function tempFile(suffix = '') {
  return path.join(os.tmpdir(), `state-test-${Date.now()}${suffix}.json`);
}

describe('StateManager', () => {
  let filePath;
  let sm;

  beforeEach(() => {
    filePath = tempFile();
    sm = new StateManager(filePath, 1);
  });

  afterEach(() => {
    try { fs.unlinkSync(filePath); } catch { /* already gone */ }
  });

  describe('load()', () => {
    it('returns epoch-0 default state when file does not exist', () => {
      const state = sm.load();
      expect(state.lastCheckTimestamp).toBe(0);
      expect(state.status).toBe('initial');
      expect(state.emailsProcessed).toBe(0);
    });

    it('returns persisted state from disk', () => {
      sm.save({ lastCheckTime: '2026-05-01T00:00:00.000Z', status: 'success' });
      const state = sm.load();
      expect(state.lastCheckTime).toBe('2026-05-01T00:00:00.000Z');
      expect(state.status).toBe('success');
    });
  });

  describe('save()', () => {
    it('merges partial patch with existing state', () => {
      sm.save({ emailsProcessed: 10, status: 'success' });
      sm.save({ emailsProcessed: 20 });
      const state = sm.load();
      expect(state.emailsProcessed).toBe(20);
    });

    it('sets version to 2', () => {
      sm.save({ status: 'success' });
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      expect(raw.version).toBe(2);
    });

    it('keeps accountId from constructor', () => {
      sm.save({ status: 'success' });
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      expect(raw.accountId).toBe(1);
    });

    it('syncs lastCheckTimestamp when lastCheckTime is provided', () => {
      const iso = '2026-05-23T12:00:00.000Z';
      sm.save({ lastCheckTime: iso });
      const state = sm.load();
      expect(state.lastCheckTimestamp).toBe(new Date(iso).getTime());
    });
  });

  describe('getLastCheckTime()', () => {
    it('returns a Date for epoch-0 on fresh file', () => {
      const dt = sm.getLastCheckTime();
      expect(dt).toBeInstanceOf(Date);
      expect(dt.getTime()).toBe(0);
    });

    it('returns the correct Date after markSuccess', () => {
      const checkTime = new Date('2026-05-23T12:00:00.000Z');
      sm.markSuccess(checkTime, 5);
      expect(sm.getLastCheckTime().toISOString()).toBe(checkTime.toISOString());
    });
  });

  describe('markSuccess()', () => {
    it('advances the checkpoint', () => {
      const checkTime = new Date('2026-05-23T12:00:00.000Z');
      sm.markSuccess(checkTime, 7);
      const state = sm.load();
      expect(state.lastCheckTime).toBe(checkTime.toISOString());
      expect(state.emailCountLastCheck).toBe(7);
      expect(state.status).toBe('success');
    });

    it('accumulates emailsProcessed across calls', () => {
      const t1 = new Date('2026-05-23T10:00:00.000Z');
      const t2 = new Date('2026-05-23T13:00:00.000Z');
      sm.markSuccess(t1, 5);
      sm.markSuccess(t2, 8);
      const state = sm.load();
      expect(state.emailsProcessed).toBe(13);
    });
  });

  describe('markFailed()', () => {
    it('does NOT advance the checkpoint', () => {
      const checkTime = new Date('2026-05-01T00:00:00.000Z');
      sm.markSuccess(checkTime, 3);
      sm.markFailed(new Error('network error'));

      const state = sm.load();
      // Checkpoint unchanged
      expect(state.lastCheckTime).toBe(checkTime.toISOString());
      expect(state.status).toBe('failed');
    });

    it('records the error message', () => {
      sm.markFailed(new Error('something broke'));
      const state = sm.load();
      expect(state.lastErrorMessage).toBe('something broke');
    });

    it('handles undefined error gracefully', () => {
      expect(() => sm.markFailed()).not.toThrow();
      const state = sm.load();
      expect(state.lastErrorMessage).toBe('Unknown error');
    });
  });

  describe('resetTo()', () => {
    it('sets the checkpoint to the given date', () => {
      const resetDate = new Date('2026-04-01T00:00:00.000Z');
      sm.resetTo(resetDate, { resetBy: 'alice', reason: '/email-reset 7d' });
      const state = sm.load();
      expect(state.lastCheckTime).toBe(resetDate.toISOString());
      expect(state.status).toBe('reset');
      expect(state.resetBy).toBe('alice');
      expect(state.resetReason).toBe('/email-reset 7d');
    });

    it('allows reset without meta', () => {
      const resetDate = new Date('2026-04-01T00:00:00.000Z');
      expect(() => sm.resetTo(resetDate)).not.toThrow();
    });
  });

  describe('v1 → v2 migration', () => {
    it('migrates legacy { gmail: "ISO" } format', () => {
      const legacyTime = '2026-04-15T08:00:00.000Z';
      const legacy = { gmail: legacyTime };
      fs.writeFileSync(filePath, JSON.stringify(legacy));

      const state = sm.load();
      expect(state.lastCheckTime).toBe(legacyTime);
      expect(state.lastCheckTimestamp).toBe(new Date(legacyTime).getTime());
      expect(state.status).toBe('migrated');
      expect(state.version).toBe(2);
    });

    it('migrates legacy { lastCheck: "ISO" } format', () => {
      const legacyTime = '2026-03-10T05:30:00.000Z';
      fs.writeFileSync(filePath, JSON.stringify({ lastCheck: legacyTime }));

      const state = sm.load();
      expect(state.lastCheckTime).toBe(legacyTime);
      expect(state.status).toBe('migrated');
    });

    it('migrates state with version != 2 as legacy', () => {
      const legacyTime = '2026-02-01T12:00:00.000Z';
      fs.writeFileSync(filePath, JSON.stringify({ version: 1, lastCheckTime: legacyTime }));

      const state = sm.load();
      expect(state.lastCheckTime).toBe(legacyTime);
      expect(state.status).toBe('migrated');
    });
  });
});
