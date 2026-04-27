/**
 * @file store/__tests__/syncLogs.test.js
 * @description Unit tests for src/store/persistence/syncLogs.js.
 *
 * Tests cover:
 *  - addSyncLog() persists a record and fires the sync-logs:changed CustomEvent
 *  - getSyncLogs() returns entries sorted most-recent first
 *  - getSyncLogs(limit) honours the optional cap
 *  - clearSyncLogs() removes all entries and fires sync-logs:changed
 *  - exportSyncLogs() returns all entries without a cap
 *  - Smart retention — success bucket: excess successes are evicted (keeps newest 100)
 *  - Smart retention — error bucket numeric cap: excess errors evicted (keeps newest 200)
 *  - Smart retention — error bucket time window: recent errors kept even beyond count cap
 *  - Smart retention — bucket independence: flood of successes never evicts errors
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { _resetIDBSingleton } from '../../composables/useIDB.js';
import {
  addSyncLog,
  getSyncLogs,
  clearSyncLogs,
  exportSyncLogs,
  SYNC_LOGS_MAX_SUCCESS,
  SYNC_LOGS_MAX_ERRORS,
  SYNC_LOGS_ERROR_RETENTION_MS,
} from '../persistence/syncLogs.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal success entry */
function makeSuccess(overrides = {}) {
  return {
    direction: 'OUT',
    type: 'PUSH',
    endpoint: '/items/orders',
    payload: null,
    response: null,
    status: 'success',
    statusCode: 200,
    durationMs: 42,
    ...overrides,
  };
}

/** Minimal error entry */
function makeError(overrides = {}) {
  return {
    direction: 'IN',
    type: 'PULL',
    endpoint: '/items/transactions',
    payload: null,
    response: null,
    status: 'error',
    statusCode: 500,
    durationMs: 10,
    ...overrides,
  };
}

/**
 * Add `count` success entries in sequence.
 * Each entry gets a unique endpoint so they are distinguishable.
 */
async function addSuccesses(count, base = 0) {
  for (let i = 0; i < count; i++) {
    await addSyncLog(makeSuccess({ endpoint: `/items/orders_${base + i}` }));
  }
}

/**
 * Add `count` error entries in sequence.
 */
async function addErrors(count, base = 0) {
  for (let i = 0; i < count; i++) {
    await addSyncLog(makeError({ endpoint: `/items/errors_${base + i}` }));
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  await _resetIDBSingleton();
  vi.restoreAllMocks();
});

afterEach(() => {
  // Ensure fake timers (if activated in a test) are always restored
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── addSyncLog ────────────────────────────────────────────────────────────────

describe('addSyncLog()', () => {
  it('persists a record in the store', async () => {
    await addSyncLog(makeSuccess());
    const logs = await getSyncLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('success');
    expect(logs[0].endpoint).toBe('/items/orders');
    expect(logs[0].timestamp).toBeDefined();
  });

  it('stamps a timestamp on the record', async () => {
    const before = new Date().toISOString();
    await addSyncLog(makeSuccess());
    const after = new Date().toISOString();
    const [log] = await getSyncLogs();
    expect(log.timestamp >= before).toBe(true);
    expect(log.timestamp <= after).toBe(true);
  });

  it('fires the sync-logs:changed CustomEvent after write', async () => {
    const listener = vi.fn();
    window.addEventListener('sync-logs:changed', listener);
    try {
      await addSyncLog(makeSuccess());
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('sync-logs:changed', listener);
    }
  });

  it('applies default field values when omitted', async () => {
    await addSyncLog({});
    const [log] = await getSyncLogs();
    expect(log.direction).toBe('OUT');
    expect(log.type).toBe('PUSH');
    expect(log.status).toBe('success');
    expect(log.endpoint).toBeNull();
    expect(log.payload).toBeNull();
    expect(log.response).toBeNull();
    expect(log.statusCode).toBeNull();
    expect(log.durationMs).toBeNull();
  });
});

// ── getSyncLogs ───────────────────────────────────────────────────────────────

describe('getSyncLogs()', () => {
  it('returns an empty array when the store is empty', async () => {
    const logs = await getSyncLogs();
    expect(logs).toEqual([]);
  });

  it('returns entries sorted most-recent first', async () => {
    await addSyncLog(makeSuccess({ endpoint: '/items/first' }));
    await addSyncLog(makeSuccess({ endpoint: '/items/second' }));
    await addSyncLog(makeSuccess({ endpoint: '/items/third' }));
    const logs = await getSyncLogs();
    // Most recent is last inserted
    expect(logs[0].endpoint).toBe('/items/third');
    expect(logs[1].endpoint).toBe('/items/second');
    expect(logs[2].endpoint).toBe('/items/first');
  });

  it('honours the optional limit parameter', async () => {
    await addSuccesses(5);
    const logs = await getSyncLogs(2);
    expect(logs).toHaveLength(2);
  });

  it('returns all entries when limit is omitted', async () => {
    await addSuccesses(10);
    const logs = await getSyncLogs();
    expect(logs).toHaveLength(10);
  });
});

// ── clearSyncLogs ─────────────────────────────────────────────────────────────

describe('clearSyncLogs()', () => {
  it('removes all entries', async () => {
    await addSuccesses(5);
    await clearSyncLogs();
    const logs = await getSyncLogs();
    expect(logs).toEqual([]);
  });

  it('fires the sync-logs:changed CustomEvent', async () => {
    const listener = vi.fn();
    window.addEventListener('sync-logs:changed', listener);
    try {
      await clearSyncLogs();
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('sync-logs:changed', listener);
    }
  });
});

// ── exportSyncLogs ────────────────────────────────────────────────────────────

describe('exportSyncLogs()', () => {
  it('returns all entries without any cap', async () => {
    await addSuccesses(10);
    const exported = await exportSyncLogs();
    expect(exported).toHaveLength(10);
  });

  it('returns entries sorted most-recent first', async () => {
    await addSyncLog(makeSuccess({ endpoint: '/items/alpha' }));
    await addSyncLog(makeSuccess({ endpoint: '/items/beta' }));
    const exported = await exportSyncLogs();
    expect(exported[0].endpoint).toBe('/items/beta');
    expect(exported[1].endpoint).toBe('/items/alpha');
  });
});

// ── Smart Retention ───────────────────────────────────────────────────────────

describe('Smart Retention — success bucket', () => {
  it(`keeps at most ${SYNC_LOGS_MAX_SUCCESS} successful entries`, async () => {
    await addSuccesses(SYNC_LOGS_MAX_SUCCESS + 10);
    const all = await getSyncLogs();
    const successes = all.filter(l => l.status === 'success');
    expect(successes.length).toBeLessThanOrEqual(SYNC_LOGS_MAX_SUCCESS);
  });

  it('retains the NEWEST successes when over the cap', async () => {
    const total = SYNC_LOGS_MAX_SUCCESS + 5;
    for (let i = 0; i < total; i++) {
      await addSyncLog(makeSuccess({ endpoint: `/items/s_${i}` }));
    }
    const all = await getSyncLogs();
    const successes = all.filter(l => l.status === 'success');
    // The oldest ones (s_0 … s_4) should have been purged
    const endpoints = successes.map(l => l.endpoint);
    for (let i = 0; i < 5; i++) {
      expect(endpoints).not.toContain(`/items/s_${i}`);
    }
    // The newest ones (s_5 … s_total-1) must still be present
    for (let i = 5; i < total; i++) {
      expect(endpoints).toContain(`/items/s_${i}`);
    }
  });
});

describe('Smart Retention — error bucket (numeric cap)', () => {
  // The count cap only applies to errors that are also OUTSIDE the 48 h time window.
  // Entries must be "stale" (older than 48 h) to be subject to the numeric limit.

  it('evicts old errors beyond the count cap', async () => {
    // Add SYNC_LOGS_MAX_ERRORS + 5 errors with a stale timestamp (50 h ago).
    // Only fake `Date` so IDB async operations are not affected.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() - 50 * 60 * 60 * 1000);
    await addErrors(SYNC_LOGS_MAX_ERRORS + 5);
    vi.useRealTimers();
    // Add one current entry to trigger purge with a cutoff that classifies the
    // stale entries as "old" (outside the 48 h window).
    await addSyncLog(makeError({ endpoint: '/items/trigger' }));

    const all = await getSyncLogs();
    const errors = all.filter(l => l.status === 'error');
    expect(errors.length).toBeLessThanOrEqual(SYNC_LOGS_MAX_ERRORS);
  });

  it('retains the NEWEST errors when count cap is enforced', async () => {
    // Add 5 stale errors (only fake `Date` to keep IDB async working)
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() - 50 * 60 * 60 * 1000);
    for (let i = 0; i < 5; i++) {
      await addSyncLog(makeError({ endpoint: `/items/old_${i}` }));
    }
    vi.useRealTimers();
    // Add SYNC_LOGS_MAX_ERRORS recent errors to overflow the combined total
    for (let i = 0; i < SYNC_LOGS_MAX_ERRORS; i++) {
      await addSyncLog(makeError({ endpoint: `/items/new_${i}` }));
    }

    const all = await getSyncLogs();
    const errorEndpoints = all.filter(l => l.status === 'error').map(l => l.endpoint);

    // All 5 stale errors must have been evicted (they are old and outside the newest cap)
    for (let i = 0; i < 5; i++) {
      expect(errorEndpoints).not.toContain(`/items/old_${i}`);
    }
    // The newest recent errors must still be present
    for (let i = SYNC_LOGS_MAX_ERRORS - 5; i < SYNC_LOGS_MAX_ERRORS; i++) {
      expect(errorEndpoints).toContain(`/items/new_${i}`);
    }
  });
});

describe('Smart Retention — error bucket (time window)', () => {
  it('keeps recent errors even when the numeric cap is exceeded', async () => {
    // Add more errors than the cap, but all with a recent timestamp (within 48 h).
    // Since addSyncLog stamps `now` we just add a handful of extra ones — they should all survive.
    await addErrors(SYNC_LOGS_MAX_ERRORS + 3);
    const all = await getSyncLogs();
    const errors = all.filter(l => l.status === 'error');
    // All added within the retention window, so NONE should be evicted
    expect(errors.length).toBe(SYNC_LOGS_MAX_ERRORS + 3);
  });

  it('evicts errors that are BOTH old AND outside the numeric cap', async () => {
    // Add SYNC_LOGS_MAX_ERRORS + 5 errors with a stale timestamp (50 h ago).
    // Only fake `Date` to avoid blocking IDB Promise chains.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() - 50 * 60 * 60 * 1000);
    for (let i = 0; i < SYNC_LOGS_MAX_ERRORS + 5; i++) {
      await addSyncLog(makeError({ endpoint: `/items/old_e_${i}` }));
    }
    vi.useRealTimers();

    // Trigger purge at real "now" so the stale entries are classified as old
    await addSyncLog(makeError({ endpoint: '/items/trigger' }));

    const all = await getSyncLogs();
    const errors = all.filter(l => l.status === 'error');
    // Old entries beyond the cap must be evicted
    expect(errors.length).toBeLessThanOrEqual(SYNC_LOGS_MAX_ERRORS);
  });
});

describe('Smart Retention — bucket independence', () => {
  it('does not evict errors when the success bucket overflows', async () => {
    // Add some errors first
    await addErrors(5);
    // Then flood with successes beyond the cap
    await addSuccesses(SYNC_LOGS_MAX_SUCCESS + 20);

    const all = await getSyncLogs();
    const errors = all.filter(l => l.status === 'error');
    // All 5 errors must still be present
    expect(errors).toHaveLength(5);
  });

  it('does not evict successes when the error bucket overflows', async () => {
    // Add some successes first
    await addSuccesses(10);
    // Then add errors to overflow the error cap
    // (add just enough to not trigger success eviction)
    await addErrors(SYNC_LOGS_MAX_ERRORS + 5);

    const all = await getSyncLogs();
    const successes = all.filter(l => l.status === 'success');
    // All 10 successes must still be present (10 < SYNC_LOGS_MAX_SUCCESS)
    expect(successes).toHaveLength(10);
  });
});
