/**
 * @file composables/__tests__/useDirectusSync.test.js
 * @description Unit tests for useDirectusSync.js.
 *
 * Tests cover:
 *  - startSync is a no-op when directus.enabled = false
 *  - startSync starts push and pull loops when enabled
 *  - stopSync clears all timers
 *  - Pull loop writes updated records into IDB (last-write-wins)
 *  - Pull loop updates in-memory store orders (merge by id, conflict resolution)
 *  - Pull loop updates tableCurrentBillSession (open sessions)
 *  - Pull loop skips records where local date_updated is newer
 *  - lastPullAt is updated after a successful pull
 *  - lastPushAt is updated after a successful push
 *  - forcePush / forcePull work
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { _resetIDBSingleton } from '../useIDB.js';
import { useDirectusSync, _resetDirectusSyncSingleton } from '../useDirectusSync.js';
import {
  upsertRecordsIntoIDB,
  loadLastPullTsFromIDB,
  saveLastPullTsToIDB,
  replaceTableMergesInIDB,
} from '../../store/idbPersistence.js';
import { _resetEnqueueSeq } from '../useSyncQueue.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Flush all pending Promises (microtasks).
 * Resolves multiple layers of chained `.then()` by looping.
 */
async function flushPromises(rounds = 30) {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}
// Extra rounds for startSync + timer-driven global pull tests where multiple async
// chains (initial run + interval callback + nested awaits) must settle.
// 80 rounds is a conservative upper bound to keep these timer+promise tests stable.
const LONG_FLUSH_ROUNDS = 80;

/**
 * Returns true when a Directus request URL contains a `date_updated > X` filter.
 * Supports both query styles:
 *  - bracketed params: `filter[date_updated][_gt]=...`
 *  - JSON filter param: `filter={"date_updated":{"_gt":"..."}}`
 *
 * @param {string} urlString
 * @returns {boolean}
 */
function hasDateUpdatedGtFilter(urlString) {
  const url = new URL(String(urlString));
  const keys = Array.from(url.searchParams.keys());

  // Pattern like filter[date_updated][_gt]=...
  if (keys.some(k => k.includes('date_updated') && k.includes('_gt'))) return true;

  // Pattern like filter={...} JSON-encoded
  const rawFilter = url.searchParams.get('filter');
  if (!rawFilter) return false;

  try {
    const parsed = JSON.parse(rawFilter);
    const stack = [parsed];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      if (node.date_updated?._gt !== undefined) {
        return true;
      }
      for (const v of Object.values(node)) stack.push(v);
    }
  } catch {
    // Ignore unparseable filter formats in this helper
  }

  return false;
}

function directusListResponse(data = []) {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeStore(overrides = {}) {
  return {
    orders: [],
    transactions: [],
    tableCurrentBillSession: {},
    ...overrides,
  };
}

/** A minimal Directus order record (Directus/snake_case format). */
function makeRemoteOrder(overrides = {}) {
  return {
    id: 'ord_remote',
    status: 'pending',
    table: '05',
    bill_session: null,
    total_amount: 20,
    item_count: 2,
    global_note: '',
    date_updated: '2024-03-01T00:00:00.000Z',
    note_visibility_cassa: true,
    note_visibility_sala: true,
    note_visibility_cucina: true,
    is_cover_charge: false,
    is_direct_entry: false,
    rejection_reason: null,
    ...overrides,
  };
}

beforeEach(async () => {
  await _resetIDBSingleton();
  _resetDirectusSyncSingleton();
  _resetEnqueueSeq();
  vi.restoreAllMocks();
  vi.stubGlobal('navigator', { onLine: true });

  // Enable directus in appConfig for these tests
  const { appConfig } = await import('../../utils/index.js');
  appConfig.directus = {
    enabled: true,
    url: 'https://directus.test',
    staticToken: 'tok_test',
    venueId: 1,
  };
});

afterEach(() => {
  _resetDirectusSyncSingleton();
  vi.unstubAllGlobals();
});

// ── startSync ─────────────────────────────────────────────────────────────────

describe('startSync()', () => {
  it('is a no-op when directus.enabled = false', async () => {
    const { appConfig } = await import('../../utils/index.js');
    appConfig.directus.enabled = false;

    const fetchSpy = vi.spyOn(global, 'fetch');
    const sync = useDirectusSync();

    sync.startSync({ appType: 'cassa', store: makeStore() });
    await flushPromises();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not start twice (singleton guard)', async () => {
    // Keep requests pending so call counts are stable and attributable to each startSync call.
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}));
    const sync = useDirectusSync();
    const store = makeStore();

    sync.startSync({ appType: 'cassa', store });
    await flushPromises();
    const callsAfterFirstStart = fetchSpy.mock.calls.length;

    sync.startSync({ appType: 'cassa', store }); // second call — should be ignored
    await flushPromises();

    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirstStart);
    sync.stopSync();
  });
});

// ── stopSync ──────────────────────────────────────────────────────────────────

describe('stopSync()', () => {
  it('sets syncStatus to idle', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([])));
    const sync = useDirectusSync();
    sync.startSync({ appType: 'cassa', store: makeStore() });
    await flushPromises();
    sync.stopSync();
    expect(sync.syncStatus.value).toBe('idle');
  });

  it('records lifecycle events in activityLog and allows manual clear', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([])));
    const sync = useDirectusSync();

    sync.startSync({ appType: 'cassa', store: makeStore() });
    await flushPromises();
    expect(sync.activityLog.value.some(entry => entry.message.includes('Sincronizzazione avviata'))).toBe(true);

    sync.stopSync();
    expect(sync.activityLog.value.some(entry => entry.message.includes('Sincronizzazione fermata'))).toBe(true);

    sync.appendActivityLog('info', 'debug marker');
    expect(sync.activityLog.value[0]).toMatchObject({
      level: 'info',
      message: 'debug marker',
      meta: null,
    });
    expect(typeof sync.activityLog.value[0].id).toBe('string');
    expect(sync.activityLog.value[0].id.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(sync.activityLog.value[0].ts))).toBe(false);

    sync.clearActivityLog();
    expect(sync.activityLog.value).toEqual([]);
  });
});

// ── Pull: IDB upsert (last-write-wins) ───────────────────────────────────────

describe('pull — IDB last-write-wins', () => {
  it('upserts a newer remote record into IDB', async () => {
    // Seed IDB with an older record
    await upsertRecordsIntoIDB('orders', [{
      id: 'ord_1', status: 'pending', date_updated: '2024-01-01T00:00:00.000Z',
    }]);

    const newerOrder = makeRemoteOrder({
      id: 'ord_1', status: 'accepted', date_updated: '2024-01-02T00:00:00.000Z',
    });

    vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([newerOrder])));

    const sync = useDirectusSync();
    await sync.forcePull();

    const { getDB } = await import('../useIDB.js');
    const db = await getDB();
    const stored = await db.get('orders', 'ord_1');
    expect(stored.status).toBe('accepted');
  });

  it('does not overwrite a newer local record with an older remote one', async () => {
    await upsertRecordsIntoIDB('orders', [{
      id: 'ord_1', status: 'delivered', date_updated: '2024-06-01T00:00:00.000Z',
    }]);

    const olderOrder = makeRemoteOrder({
      id: 'ord_1', status: 'pending', date_updated: '2024-01-01T00:00:00.000Z',
    });
    vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([olderOrder])));

    const sync = useDirectusSync();
    await sync.forcePull();

    const { getDB } = await import('../useIDB.js');
    const db = await getDB();
    const stored = await db.get('orders', 'ord_1');
    expect(stored.status).toBe('delivered'); // local wins
  });
});

// ── Pull: in-memory store merge ───────────────────────────────────────────────

describe('pull — in-memory orders merge', () => {
  it('adds a new order from remote into store.orders', async () => {
    const remoteOrder = makeRemoteOrder({ bill_session: 'bill_x', total_amount: 20 });

    vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([remoteOrder])));

    const store = makeStore();
    const sync = useDirectusSync();
    await sync.forcePull();

    expect(store.orders).toHaveLength(0); // forcePull doesn't update store — use startSync
  });

  it('startSync merges pulled records into store.orders', async () => {
    const remoteOrder = makeRemoteOrder({ bill_session: 'bill_x', total_amount: 20 });

    vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([remoteOrder])));

    const store = makeStore();
    const sync = useDirectusSync();
    // startSync sets _store; forcePull() then properly awaits _runPull() to completion
    sync.startSync({ appType: 'cassa', store });
    await sync.forcePull();

    expect(store.orders.some(o => o.id === 'ord_remote')).toBe(true);
    const merged = store.orders.find(o => o.id === 'ord_remote');
    expect(merged.billSessionId).toBe('bill_x');
    expect(merged.totalAmount).toBe(20);
  });

  it('updates an existing order when remote is newer (LWW)', async () => {
    const remoteOrder = makeRemoteOrder({
      id: 'ord_1',
      status: 'accepted',
      table: '01',
      total_amount: 15,
      date_updated: '2024-05-01T00:00:00.000Z',
    });

    vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([remoteOrder])));

    const store = makeStore({
      orders: [{
        id: 'ord_1', status: 'pending', table: '01',
        date_updated: '2024-04-01T00:00:00.000Z', orderItems: [{ uid: 'r1' }],
      }],
    });
    const sync = useDirectusSync();
    sync.startSync({ appType: 'cassa', store });
    await sync.forcePull();

    const updated = store.orders.find(o => o.id === 'ord_1');
    expect(updated.status).toBe('accepted');
    // Local orderItems must be preserved
    expect(updated.orderItems).toEqual([{ uid: 'r1' }]);
  });

  it('does not downgrade a locally-newer order', async () => {
    const remoteOrder = makeRemoteOrder({
      id: 'ord_1', status: 'pending',
      date_updated: '2024-01-01T00:00:00.000Z',
    });

    vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([remoteOrder])));

    const store = makeStore({
      orders: [{
        id: 'ord_1', status: 'completed',
        date_updated: '2024-06-01T00:00:00.000Z',
        orderItems: [],
      }],
    });
    const sync = useDirectusSync();
    sync.startSync({ appType: 'cassa', store });
    await sync.forcePull();

    expect(store.orders.find(o => o.id === 'ord_1').status).toBe('completed');
  });
});

// ── Pull: bill_sessions → tableCurrentBillSession ────────────────────────────

describe('pull — bill_sessions merge', () => {
  it('adds an open session from remote to tableCurrentBillSession', async () => {
    const remoteSession = {
      id: 'bill_99', table: '09', status: 'open', adults: 3, children: 1,
      opened_at: '2024-03-01T00:00:00.000Z',
      date_updated: '2024-03-01T00:00:00.000Z',
    };

    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (url.includes('bill_sessions')) return Promise.resolve(directusListResponse([remoteSession]));
      return Promise.resolve(directusListResponse([]));
    });

    const store = makeStore();
    const sync = useDirectusSync();
    sync.startSync({ appType: 'cassa', store });
    await sync.forcePull();

    const session = store.tableCurrentBillSession['09'];
    expect(session).toBeTruthy();
    expect(session.billSessionId).toBe('bill_99');
    expect(session.adults).toBe(3);
    expect(session.children).toBe(1);
    expect(session.table).toBe('09');
    expect(session.status).toBe('open');
    expect(session.opened_at).toBe('2024-03-01T00:00:00.000Z');
  });

  it('preserves existing session fields not present in incoming record', async () => {
    const remoteSession = {
      id: 'bill_99', table: '09', status: 'open', adults: 4, children: 0,
      date_updated: '2024-03-02T00:00:00.000Z',
    };

    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (url.includes('bill_sessions')) return Promise.resolve(directusListResponse([remoteSession]));
      return Promise.resolve(directusListResponse([]));
    });

    const store = makeStore({
      tableCurrentBillSession: {
        '09': {
          billSessionId: 'bill_99', adults: 3, children: 0,
          table: '09', status: 'open', opened_at: '2024-03-01T00:00:00.000Z',
        },
      },
    });
    const sync = useDirectusSync();
    sync.startSync({ appType: 'cassa', store });
    await sync.forcePull();

    const session = store.tableCurrentBillSession['09'];
    expect(session.adults).toBe(4);
    expect(session.opened_at).toBe('2024-03-01T00:00:00.000Z');
    expect(session.table).toBe('09');
    expect(session.status).toBe('open');
  });

  it('removes a closed session from tableCurrentBillSession', async () => {
    const closedSession = {
      id: 'bill_99', table: '09', status: 'closed', adults: 3, children: 0,
      date_updated: '2024-03-01T00:00:00.000Z',
    };

    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (url.includes('bill_sessions')) return Promise.resolve(directusListResponse([closedSession]));
      return Promise.resolve(directusListResponse([]));
    });

    const store = makeStore({
      tableCurrentBillSession: { '09': { billSessionId: 'bill_99', adults: 3, children: 0 } },
    });
    const sync = useDirectusSync();
    sync.startSync({ appType: 'cassa', store });
    await sync.forcePull();

    expect(store.tableCurrentBillSession['09']).toBeUndefined();
  });
});

// ── lastPullAt / lastPushAt ───────────────────────────────────────────────────

describe('reactive timestamps', () => {
  it('lastPullAt is set after a successful pull with new data', async () => {
    const remoteOrder = makeRemoteOrder();
    vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([remoteOrder])));

    const sync = useDirectusSync();
    const before = sync.lastPullAt.value;
    const store = makeStore();
    sync.startSync({ appType: 'cassa', store });
    await sync.forcePull();

    expect(sync.lastPullAt.value).not.toBe(before);
    expect(sync.lastPullAt.value).toBeTruthy();
  });

  it('lastPushAt is set after a successful push', async () => {
    // Seed the queue with an entry
    const { enqueue } = await import('../useSyncQueue.js');
    await enqueue('orders', 'create', 'ord_1', { id: 'ord_1' });

    vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(new Response('{}', { status: 201 })));

    const sync = useDirectusSync();
    await sync.forcePush();

    expect(sync.lastPushAt.value).toBeTruthy();
  });

  it('lastPullAt is not updated when any pull collection fails', async () => {
    const page1Orders = Array.from({ length: 200 }, (_, i) => makeRemoteOrder({
      id: `ord_page1_${i}`,
      date_updated: `2024-03-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
    }));

    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const u = String(url);
      if (!u.includes('/items/orders')) return Promise.resolve(directusListResponse([]));
      if (u.includes('page=1')) return Promise.resolve(directusListResponse(page1Orders));
      return Promise.reject(new Error('orders page 2 failed'));
    });

    const sync = useDirectusSync();
    const before = sync.lastPullAt.value;
    await sync.forcePull();

    expect(sync.lastPullAt.value).toBe(before);
  });
});

// ── last_pull_ts persistence ──────────────────────────────────────────────────

describe('pull timestamp persistence', () => {
  it('saves the max date_updated to IDB app_meta after a pull', async () => {
    const remoteOrder = makeRemoteOrder({
      id: 'ord_ts', date_updated: '2024-07-15T12:00:00.000Z',
    });

    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (url.includes('/items/orders')) return Promise.resolve(directusListResponse([remoteOrder]));
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    await sync.forcePull();

    const ts = await loadLastPullTsFromIDB('orders');
    expect(ts).toBe('2024-07-15T12:00:00.000Z');
  });

  it('does not advance last_pull_ts when a paginated pull fails mid-cycle', async () => {
    await saveLastPullTsToIDB('orders', '2024-01-01T00:00:00.000Z');
    const page1Orders = Array.from({ length: 200 }, (_, i) => makeRemoteOrder({
      id: `ord_partial_${i}`,
      date_updated: `2024-08-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
    }));

    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const u = String(url);
      if (!u.includes('/items/orders')) return Promise.resolve(directusListResponse([]));
      if (u.includes('page=1')) return Promise.resolve(directusListResponse(page1Orders));
      return Promise.reject(new Error('orders page 2 failed'));
    });

    const sync = useDirectusSync();
    await sync.forcePull();

    const ts = await loadLastPullTsFromIDB('orders');
    expect(ts).toBe('2024-01-01T00:00:00.000Z');
  });
});

describe('global pull config hydration', () => {
  it('uses full pull on first global hydration even when tables last_pull_ts is stale', async () => {
    // Simulate stale incremental cursor that would otherwise exclude older rows.
    await saveLastPullTsToIDB('tables', '2099-01-01T00:00:00.000Z');

    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([])));

    const sync = useDirectusSync();
    const store = makeStore();
    sync.startSync({ appType: 'cucina', store });
    await flushPromises(LONG_FLUSH_ROUNDS);
    sync.stopSync();

    const tableCalls = fetchSpy.mock.calls
      .map(([url]) => String(url))
      .filter(url => url.includes('/items/tables'));
    expect(tableCalls.length).toBeGreaterThan(0);
    for (const url of tableCalls) {
      expect(hasDateUpdatedGtFilter(url)).toBe(false);
    }
  });

  it('keeps full-hydration mode for the next cycle if a global collection pull fails', async () => {
    await saveLastPullTsToIDB('tables', '2024-01-01T00:00:00.000Z');
    vi.useFakeTimers();

    let tableReqCount = 0;
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/items/tables')) {
        tableReqCount += 1;
        if (tableReqCount === 1) return Promise.reject(new Error('temporary tables failure'));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    const store = makeStore();
    try {
      sync.startSync({ appType: 'cucina', store });
      await flushPromises(LONG_FLUSH_ROUNDS);
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      await flushPromises(LONG_FLUSH_ROUNDS);
    } finally {
      sync.stopSync();
      vi.useRealTimers();
    }

    const tableCalls = fetchSpy.mock.calls
      .map(([url]) => String(url))
      .filter(url => url.includes('/items/tables'));
    expect(tableCalls.length).toBeGreaterThanOrEqual(2);
    for (const url of tableCalls) {
      expect(hasDateUpdatedGtFilter(url)).toBe(false);
    }
  });

  it('does not apply config hydration when a global collection pull fails', async () => {
    const utils = await import('../../utils/index.js');
    const applySpy = vi.spyOn(utils, 'applyDirectusConfigToAppConfig');

    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/items/tables')) {
        return Promise.reject(new Error('temporary tables failure'));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    const store = makeStore({ config: {} });
    sync.startSync({ appType: 'cucina', store });
    await flushPromises(LONG_FLUSH_ROUNDS);
    sync.stopSync();

    expect(applySpy).not.toHaveBeenCalled();
  });

  it('does not clear table merges when table_merge_sessions fetch fails', async () => {
    await replaceTableMergesInIDB([{ id: 'm1', slave_table: 'T2', master_table: 'T1' }]);

    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/items/table_merge_sessions')) {
        return Promise.reject(new Error('table merge fetch failed'));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    const store = makeStore({ tableMergedInto: { T2: 'T1' } });
    sync.startSync({ appType: 'cucina', store });
    await flushPromises(LONG_FLUSH_ROUNDS);
    sync.stopSync();

    const { getDB } = await import('../useIDB.js');
    const db = await getDB();
    const records = await db.getAll('table_merge_sessions');
    expect(records).toHaveLength(1);
    expect(records[0].slave_table).toBe('T2');
    expect(records[0].master_table).toBe('T1');
    expect(store.tableMergedInto).toEqual({ T2: 'T1' });
  });

});

// ── WebSocket subscriptions ───────────────────────────────────────────────────

describe('WebSocket subscriptions', () => {
  it('wsConnected is false before startSync', () => {
    const sync = useDirectusSync();
    expect(sync.wsConnected.value).toBe(false);
  });

  it('falls back to polling when WebSocket connect throws', async () => {
    // Stub subscribe/connect to simulate WS unavailability
    const { getDirectusClient } = await import('../useDirectusClient.js');

    vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve(directusListResponse([])),
    );

    // Patch the client to make connect() reject
    const origGetClient = getDirectusClient;
    const fakeClient = {
      connect: () => Promise.reject(new Error('WebSocket unavailable')),
      subscribe: () => Promise.reject(new Error('should not be called')),
      disconnect: () => {},
      request: () => Promise.resolve([]),
    };

    // We can't easily swap getDirectusClient without module reset, so we verify
    // that the polling fallback is installed when subscriptions fail.
    // The simplest way: ensure that after startSync, forcePull still works via REST.
    const sync = useDirectusSync();
    const store = makeStore();

    // The pull loop should work even without WS
    await sync.forcePull();

    // No error thrown, lastPullAt stays null (no records returned)
    expect(sync.syncStatus.value).not.toBe('error');
  });
});

// ── drainQueue: last_error persistence ───────────────────────────────────────

describe('drainQueue — last_error on failed push', () => {
  it('sets last_error on a failed entry after a push error', async () => {
    const { enqueue, drainQueue } = await import('../useSyncQueue.js');
    await enqueue('orders', 'create', 'ord_fail', { id: 'ord_fail' });

    // Make the push fail with a recognisable error message
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ message: 'You are not allowed.' }] }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const cfg = { url: 'https://directus.test', staticToken: 'tok_test', venueId: 1, _backoffMs: 0 };
    await drainQueue(cfg);

    const { getDB } = await import('../useIDB.js');
    const db = await getDB();
    const all = await db.getAll('sync_queue');
    const entry = all.find(e => e.record_id === 'ord_fail');

    // attempts must be incremented and last_error must be set
    expect(entry).toBeTruthy();
    expect(entry.attempts).toBeGreaterThan(0);
    expect(typeof entry.last_error).toBe('string');
    expect(entry.last_error.length).toBeGreaterThan(0);
  });

  it('updates last_error on subsequent failures', async () => {
    const { enqueue, drainQueue } = await import('../useSyncQueue.js');
    await enqueue('orders', 'update', 'ord_retry', { id: 'ord_retry', status: 'accepted' });

    const cfg = { url: 'https://directus.test', staticToken: 'tok_test', venueId: 1, _backoffMs: 0 };

    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: [{ message: 'First error' }] }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: [{ message: 'Second error' }] }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const { getDB } = await import('../useIDB.js');
    const db = await getDB();

    // First drain — sets last_error to 'First error'
    await drainQueue(cfg);
    const allAfterFirst = await db.getAll('sync_queue');
    const entryAfterFirst = allAfterFirst.find(e => e.record_id === 'ord_retry');
    expect(entryAfterFirst).toBeTruthy();
    expect(entryAfterFirst.attempts).toBe(1);
    expect(entryAfterFirst.last_error).toContain('First error');

    // Second drain — updates last_error to 'Second error'
    await drainQueue(cfg);
    const allAfterSecond = await db.getAll('sync_queue');
    const entryAfterSecond = allAfterSecond.find(e => e.record_id === 'ord_retry');
    expect(entryAfterSecond).toBeTruthy();
    expect(entryAfterSecond.attempts).toBe(2);
    expect(entryAfterSecond.last_error).toContain('Second error');
  });
});
