/**
 * @file store/__tests__/syncQueue.test.js
 * @description Unit tests for useSyncQueue.js — specifically `drainQueue()`.
 *
 * Tests cover:
 *  - enqueue() adds entries to IDB sync_queue
 *  - drainQueue() POSTs create operations to Directus
 *  - drainQueue() PATCHes update operations
 *  - drainQueue() skips deletes on domain-status collections
 *  - drainQueue() soft-deletes on soft-delete collections
 *  - drainQueue() hard-deletes junction collection records
 *  - drainQueue() retries 409 create as PATCH
 *  - drainQueue() increments attempts on failure and abandons after MAX_ATTEMPTS
 *  - drainQueue() strips local-only fields (_sync_status, orderItems)
 *  - drainQueue() returns push/failed/abandoned counts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { _resetIDBSingleton } from '../../composables/useIDB.js';
import {
  enqueue,
  getPendingEntries,
  getFailedSyncCalls,
  drainQueue,
  MAX_ATTEMPTS,
  _resetEnqueueSeq,
} from '../../composables/useSyncQueue.js';

// Pass _backoffMs:0 to skip exponential back-off delays in all tests.
const FAKE_CFG = { url: 'https://directus.test', staticToken: 'tok_test', _backoffMs: 0 };

// Helper: build a mock Response
function mockResponse(status, body = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(async () => {
  await _resetIDBSingleton();
  _resetEnqueueSeq();
  vi.restoreAllMocks();
  vi.stubGlobal('navigator', { ...navigator, onLine: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── enqueue ───────────────────────────────────────────────────────────────────

describe('enqueue()', () => {
  it('dispatches a sync-queue enqueue event', async () => {
    const listener = vi.fn();
    window.addEventListener('sync-queue:enqueue', listener);
    try {
      await enqueue('orders', 'create', 'ord_evt_1', { id: 'ord_evt_1' });
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('sync-queue:enqueue', listener);
    }
  });

  it('adds an entry to the sync_queue', async () => {
    await enqueue('orders', 'create', 'ord_1', { id: 'ord_1', status: 'pending' });
    const entries = await getPendingEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].collection).toBe('orders');
    expect(entries[0].operation).toBe('create');
    expect(entries[0].record_id).toBe('ord_1');
    expect(entries[0].attempts).toBe(0);
  });

  it('enqueues multiple entries in order', async () => {
    await enqueue('orders', 'create', 'ord_1', { id: 'ord_1' });
    await enqueue('orders', 'update', 'ord_1', { status: 'accepted' });
    const entries = await getPendingEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].operation).toBe('create');
    expect(entries[1].operation).toBe('update');
  });
});

// ── drainQueue ───────────────────────────────────────────────────────────────

describe('drainQueue()', () => {
  it('POSTs create operations and removes entry on success', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse(201, { data: { id: 'ord_1' } }));
    await enqueue('orders', 'create', 'ord_1', { id: 'ord_1', status: 'pending' });

    const result = await drainQueue(FAKE_CFG);

    expect(result.pushed).toBe(1);
    expect(result.failed).toBe(0);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toContain('/items/orders');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toMatchObject({ id: 'ord_1', status: 'pending' });

    const remaining = await getPendingEntries();
    expect(remaining).toHaveLength(0);
  });

  it('PATCHes update operations', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse(200, { data: { id: 'ord_1' } }));
    await enqueue('orders', 'update', 'ord_1', { status: 'accepted' });

    await drainQueue(FAKE_CFG);

    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toContain('/items/orders/ord_1');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toMatchObject({ status: 'accepted' });
    expect(JSON.parse(opts.body).total_amount).toBeUndefined();
    expect(JSON.parse(opts.body).item_count).toBeUndefined();
    expect(JSON.parse(opts.body).order_time).toBeUndefined();
  });

  it('strips _sync_status and orderItems from payload', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse(201, {}));
    await enqueue('orders', 'create', 'ord_1', {
      id: 'ord_1',
      status: 'pending',
      _sync_status: 'pending',
      orderItems: [{ uid: 'r1', name: 'Test' }],
    });

    await drainQueue(FAKE_CFG);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body._sync_status).toBeUndefined();
    expect(body.orderItems).toBeUndefined();
    expect(body.id).toBe('ord_1');
  });

  it('maps orders payload through canonical mapper fields', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse(201, {}));
    await enqueue('orders', 'create', 'ord_1', {
      id: 'ord_1',
      time: '10:15',
      noteVisibility: { cassa: false, sala: true, cucina: false },
      dietaryPreferences: { diete: ['vegana'], allergeni: ['glutine'] },
    });

    await drainQueue(FAKE_CFG);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.order_time).toBe('10:15');
    expect(body.note_visibility_cassa).toBe(false);
    expect(body.note_visibility_sala).toBe(true);
    expect(body.note_visibility_cucina).toBe(false);
    expect(body.dietary_diets).toEqual(['vegana']);
    expect(body.dietary_allergens).toEqual(['glutine']);
    expect(body.time).toBeUndefined();
    expect(body.noteVisibility).toBeUndefined();
    expect(body.dietaryPreferences).toBeUndefined();
  });

  it('maps bill_sessions payload with canonical adults/children fields', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse(201, {}));
    await enqueue('bill_sessions', 'create', 'bill_1', {
      id: 'bill_1',
      table: 'T1',
      adults: 3,
      children: 1,
    });

    await drainQueue(FAKE_CFG);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.adults).toBe(3);
    expect(body.children).toBe(1);
  });

  it.each([
    {
      collection: 'bill_sessions',
      recordId: 'bill_1',
      payload: { id: 'bill_1', table: 'T1', adults: 3, children: 1 },
    },
    {
      collection: 'orders',
      recordId: 'ord_1',
      payload: {
        id: 'ord_1',
        table: 'T1',
        status: 'pending',
        order_time: '10:15',
        total_amount: 10,
        item_count: 1,
      },
    },
    {
      collection: 'transactions',
      recordId: 'txn_venue_1',
      payload: {
        id: 'txn_venue_1',
        table: 'T1',
        operation_type: 'unico',
        amount_paid: 10,
      },
    },
    {
      collection: 'cash_movements',
      recordId: 'mov_venue_1',
      payload: {
        id: 'mov_venue_1',
        type: 'deposit',
        amount: 10,
        reason: 'test',
      },
    },
    {
      collection: 'daily_closures',
      recordId: 'close_venue_1',
      payload: {
        id: 'close_venue_1',
        closure_type: 'Z',
      },
    },
  ])('injects venue for $collection create when missing and cfg.venueId is available', async ({ collection, recordId, payload }) => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse(201, {}));
    await enqueue(collection, 'create', recordId, payload);

    await drainQueue({ ...FAKE_CFG, venueId: 77 });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.venue).toBe(77);
  });

  it('does not inject venue for collections without venue field', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse(201, {}));
    await enqueue('transaction_order_refs', 'create', 'ref_1', {
      id: 'ref_1',
      transaction: 'txn_1',
      order: 'ord_1',
    });

    await drainQueue({ ...FAKE_CFG, venueId: 77 });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.venue).toBeUndefined();
  });

  it('maps transaction payment methods to Directus relation ids', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse(201, {}));
    await enqueue('transactions', 'create', 'txn_1', {
      id: 'txn_1',
      tableId: 'T1',
      billSessionId: 'bill_1',
      paymentMethodId: 'cash',
      paymentMethod: 'Contanti',
      operationType: 'unico',
      amountPaid: 25,
    });

    await drainQueue(FAKE_CFG);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.payment_method).toBe('cash');
    expect(body.paymentMethod).toBeUndefined();
    expect(body.paymentMethodId).toBeUndefined();
  });

  it('does not inject adults/children on sparse bill_sessions update', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse(200, { data: { id: 'bill_1' } }));
    await enqueue('bill_sessions', 'update', 'bill_1', {
      status: 'closed',
      closed_at: '2026-01-01T10:00:00.000Z',
    });

    await drainQueue(FAKE_CFG);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.status).toBe('closed');
    expect(body.closed_at).toBe('2026-01-01T10:00:00.000Z');
    expect(body.adults).toBeUndefined();
    expect(body.children).toBeUndefined();
  });

  it('retries 409 create as PATCH', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(mockResponse(409, { errors: [] }))
      .mockResolvedValueOnce(mockResponse(200, {}));

    await enqueue('orders', 'create', 'ord_1', { id: 'ord_1' });
    const result = await drainQueue(FAKE_CFG);

    expect(result.pushed).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const secondCall = fetchSpy.mock.calls[1];
    expect(secondCall[0]).toContain('/items/orders/ord_1');
    expect(secondCall[1].method).toBe('PATCH');
  });

  it('skips hard DELETE on domain-status collections (bill_sessions)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    await enqueue('bill_sessions', 'delete', 'bill_1', null);
    const result = await drainQueue(FAKE_CFG);

    // Should be treated as 'skip' — no fetch call, removed from queue
    expect(result.pushed).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await getPendingEntries()).toHaveLength(0);
  });

  it('soft-deletes records in soft-delete collections (transactions)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse(200, {}));
    await enqueue('transactions', 'delete', 'mov_1', null);
    await drainQueue(FAKE_CFG);

    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toContain('/items/transactions/mov_1');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toMatchObject({ status: 'archived' });
  });

  it('hard-deletes junction collection records (transaction_order_refs)', async () => {
    // 204 No Content is standard for DELETE, but jsdom Response requires 200-599 excluding 204
    // Use 200 as a proxy for the successful DELETE response
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    await enqueue('transaction_order_refs', 'delete', 'ref_1', null);
    const result = await drainQueue(FAKE_CFG);

    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toContain('/items/transaction_order_refs/ref_1');
    expect(opts.method).toBe('DELETE');
    expect(result.pushed).toBe(1);
  });

  it('increments attempts on network failure', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network'));
    await enqueue('orders', 'create', 'ord_1', { id: 'ord_1' });

    const result = await drainQueue(FAKE_CFG);

    expect(result.failed).toBe(1);
    const entries = await getPendingEntries();
    expect(entries[0].attempts).toBe(1);
  });

  it('stops processing remaining entries after first failure to preserve order', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('network'));
    await enqueue('orders', 'create', 'ord_1', { id: 'ord_1' });
    await enqueue('orders', 'update', 'ord_1', { status: 'accepted' });

    const result = await drainQueue(FAKE_CFG);

    expect(result.pushed).toBe(0);
    expect(result.failed).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const entries = await getPendingEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].operation).toBe('create');
    expect(entries[0].attempts).toBe(1);
    expect(entries[1].operation).toBe('update');
    expect(entries[1].attempts).toBe(0);
  });

  it('abandons entry after MAX_ATTEMPTS and removes from queue', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network'));

    await enqueue('orders', 'create', 'ord_1', { id: 'ord_1' });

    // Drain MAX_ATTEMPTS times to exhaust the retry budget (backoffMs=0)
    let result;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      result = await drainQueue(FAKE_CFG);
    }

    // On the last drain the entry should have been abandoned
    const entries = await getPendingEntries();
    expect(entries).toHaveLength(0);
    expect(result.abandoned).toBe(1);
  });

  it('persists failed-call history even after queue entry is abandoned', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network'));
    await enqueue('orders', 'create', 'ord_failed_history', { id: 'ord_failed_history' });

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await drainQueue(FAKE_CFG);
    }

    expect(await getPendingEntries()).toHaveLength(0);
    const failedCalls = await getFailedSyncCalls();
    expect(failedCalls.length).toBeGreaterThan(0);
    expect(failedCalls[0]).toMatchObject({
      collection: 'orders',
      operation: 'create',
      record_id: 'ord_failed_history',
    });
    expect(failedCalls.some((call) => call.abandoned === true)).toBe(true);
  });

  it('returns { pushed, failed, abandoned } correctly', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(mockResponse(200, {}))   // success for ord_1
      .mockRejectedValueOnce(new Error('net'));         // fail for ord_2

    await enqueue('orders', 'update', 'ord_1', { status: 'accepted' });
    await enqueue('orders', 'update', 'ord_2', { status: 'preparing' });

    const result = await drainQueue(FAKE_CFG);
    expect(result.pushed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.abandoned).toBe(0);
  });

  it('returns immediately when queue is empty', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    const result = await drainQueue(FAKE_CFG);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ pushed: 0, failed: 0, abandoned: 0, pushedIds: [] });
  });

  it('sends Authorization header', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse(201, {}));
    await enqueue('orders', 'create', 'ord_1', { id: 'ord_1' });
    await drainQueue(FAKE_CFG);

    const { headers } = fetchSpy.mock.calls[0][1];
    expect(headers.Authorization).toBe('Bearer tok_test');
  });
});
