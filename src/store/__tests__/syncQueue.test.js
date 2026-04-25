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
 *  - drainQueue() retries RECORD_NOT_UNIQUE (HTTP 400) create as PATCH
 *  - drainQueue() retries HTTP 409 create as PATCH (proxy/fallback compatibility)
 *  - drainQueue() increments attempts on failure and abandons after MAX_ATTEMPTS
 *  - drainQueue() blocks same-record operations after a failure (preserves ordering)
 *  - drainQueue() blocks same-record operations even when entry is abandoned
 *  - drainQueue() continues with unrelated records after a failure (no full-queue block)
 *  - drainQueue() blocks child collection entries when parent transaction create fails
 *  - drainQueue() blocks daily_closure_by_method when parent daily_closures fails
 *  - drainQueue() blocks orders create when parent bill_session create fails
 *  - drainQueue() blocks transactions create when parent bill_session create fails
 *  - drainQueue() does NOT block children when parent fails with an UPDATE (record already in Directus)
 *  - drainQueue() strips local-only fields (_sync_status, orderItems)
 *  - drainQueue() returns push/failed/abandoned counts
 *  - drainQueue() returns offline:false when all entries succeed
 *  - drainQueue() returns offline:true and halts when network error (no attempts burned)
 *  - drainQueue() stops after partial success on mid-drain network error
 *  - drainQueue() does NOT set offline:true for HTTP 4xx/5xx errors
 *  - drainQueue() processes entries with fewer attempts first (BFS ordering)
 *  - drainQueue() defers child entry (attempts=0) until parent (attempts>0) is pushed
 *  - drainQueue() cascade-abandons child entries when parent CREATE reaches MAX_ATTEMPTS
 *  - drainQueue() does NOT cascade-abandon children when parent fails with a non-final error
 *  - drainQueue() does NOT block children via failedCreates when parent CREATE gets RECORD_NOT_UNIQUE and fallback PATCH fails
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
import * as persistenceOps from '../persistence/operations.js';

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

  it('injects only venue_user_created from auth session on create for audit-enabled collections', async () => {
    await persistenceOps.saveAuthSessionToIDB('vu_pin_1');
    await enqueue('orders', 'create', 'ord_audit_1', { id: 'ord_audit_1', status: 'pending' });

    const entries = await getPendingEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].payload).toMatchObject({
      id: 'ord_audit_1',
      venue_user_created: 'vu_pin_1',
    });
    expect(entries[0].payload.venue_user_updated).toBeUndefined();
  });

  it('injects only venue_user_updated from auth session on update for audit-enabled collections', async () => {
    await persistenceOps.saveAuthSessionToIDB('vu_pin_2');
    await enqueue('transactions', 'update', 'txn_audit_1', { amountPaid: 20 });

    const entries = await getPendingEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].payload.venue_user_created).toBeUndefined();
    expect(entries[0].payload.venue_user_updated).toBe('vu_pin_2');
  });

  it('does not override explicit venue_user audit fields in payload', async () => {
    await persistenceOps.saveAuthSessionToIDB('vu_pin_3');
    await enqueue('daily_closures', 'create', 'close_audit_1', {
      id: 'close_audit_1',
      venue_user_created: 'vu_manual_created',
      venue_user_updated: 'vu_manual_updated',
    });

    const entries = await getPendingEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].payload.venue_user_created).toBe('vu_manual_created');
    expect(entries[0].payload.venue_user_updated).toBe('vu_manual_updated');
  });

  it('does not override explicit camelCase venue user audit fields in payload', async () => {
    await persistenceOps.saveAuthSessionToIDB('vu_pin_4');
    await enqueue('daily_closures', 'create', 'close_audit_2', {
      id: 'close_audit_2',
      venueUserCreated: 'vu_manual_created_cc',
      venueUserUpdated: 'vu_manual_updated_cc',
    });

    const entries = await getPendingEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].payload.venueUserCreated).toBe('vu_manual_created_cc');
    expect(entries[0].payload.venueUserUpdated).toBe('vu_manual_updated_cc');
    expect(entries[0].payload.venue_user_created).toBeUndefined();
    expect(entries[0].payload.venue_user_updated).toBeUndefined();
  });

  it('skips auth-session lookup when venue user audit enrichment cannot apply', async () => {
    const loadSpy = vi.spyOn(persistenceOps, 'loadAuthSessionFromIDB');
    await enqueue('orders', 'delete', 'ord_skip_1', { id: 'ord_skip_1' });
    await enqueue('menu_items', 'create', 'item_skip_1', { id: 'item_skip_1' });
    await enqueue('orders', 'create', 'ord_skip_2', null);
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it('skips auth-session lookup when relevant audit fields are already present', async () => {
    const loadSpy = vi.spyOn(persistenceOps, 'loadAuthSessionFromIDB');
    await enqueue('orders', 'create', 'ord_skip_3', {
      id: 'ord_skip_3',
      venue_user_created: 'vu_manual_created',
    });
    await enqueue('orders', 'update', 'ord_skip_4', {
      venueUserUpdated: 'vu_manual_updated',
    });
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it('loads auth-session when relevant audit fields are missing', async () => {
    const loadSpy = vi.spyOn(persistenceOps, 'loadAuthSessionFromIDB');
    await enqueue('orders', 'create', 'ord_load_1', { id: 'ord_load_1' });
    await enqueue('orders', 'update', 'ord_load_2', { status: 'accepted' });
    expect(loadSpy).toHaveBeenCalledTimes(2);
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

  it('sets order FK on nested order_items when payload has no id (partial update)', async () => {
    // Reproduces: "Validation failed for field 'order' at 'order_items'. Value can't be null."
    // The order ID lives in record_id; the partial-update payload does NOT carry `id`.
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse(200, { data: {} }));
    await enqueue('orders', 'update', 'ord_partial_1', {
      venue_user_updated: 'usr_1',
      orderItems: [
        { uid: 'item_a', dishId: 'dish_1', name: 'Tagliere', unitPrice: 13, quantity: 1, notes: [], voidedQuantity: 0, modifiers: [], course: 'insieme' },
        { uid: 'item_b', dishId: 'dish_2', name: 'Carbonara', unitPrice: 13, quantity: 1, notes: [], voidedQuantity: 0, modifiers: [], course: 'insieme' },
      ],
      totalAmount: 26,
      itemCount: 2,
    });

    await drainQueue(FAKE_CFG);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(Array.isArray(body.order_items)).toBe(true);
    expect(body.order_items).toHaveLength(2);
    for (const item of body.order_items) {
      expect(item.order).toBe('ord_partial_1');
    }
  });

  it('retries RECORD_NOT_UNIQUE (HTTP 400) create as PATCH', async () => {
    // Directus signals duplicate primary key with HTTP 400 and error code
    // RECORD_NOT_UNIQUE (not 409).  drainQueue must detect this and retry as PATCH.
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(mockResponse(400, { errors: [{ message: 'Value for field "id" in collection "orders" has to be unique.', extensions: { code: 'RECORD_NOT_UNIQUE', collection: 'orders', field: 'id', primaryKey: true } }] }))
      .mockResolvedValueOnce(mockResponse(200, {}));

    await enqueue('orders', 'create', 'ord_1', { id: 'ord_1' });
    const result = await drainQueue(FAKE_CFG);

    expect(result.pushed).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const secondCall = fetchSpy.mock.calls[1];
    expect(secondCall[0]).toContain('/items/orders/ord_1');
    expect(secondCall[1].method).toBe('PATCH');
  });

  it('retries HTTP 409 create as PATCH (proxy/fallback compatibility)', async () => {
    // HTTP 409 is kept as a fallback for proxies or future Directus versions.
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(mockResponse(409, { errors: [] }))
      .mockResolvedValueOnce(mockResponse(200, {}));

    await enqueue('orders', 'create', 'ord_409fallback', { id: 'ord_409fallback' });
    const result = await drainQueue(FAKE_CFG);

    expect(result.pushed).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const secondCall = fetchSpy.mock.calls[1];
    expect(secondCall[0]).toContain('/items/orders/ord_409fallback');
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

  it('blocks subsequent operations on the same record after a failure to preserve ordering', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('network'));
    await enqueue('orders', 'create', 'ord_1', { id: 'ord_1' });
    await enqueue('orders', 'update', 'ord_1', { status: 'accepted' });

    const result = await drainQueue(FAKE_CFG);

    // create failed → update for the same record is skipped (not attempted)
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

  it('continues processing unrelated entries after a failure', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('network'))          // ord_1 create fails
      .mockResolvedValueOnce(mockResponse(201, {}));        // ord_2 create succeeds

    await enqueue('orders', 'create', 'ord_1', { id: 'ord_1' });
    await enqueue('orders', 'create', 'ord_2', { id: 'ord_2' }); // different record

    const result = await drainQueue(FAKE_CFG);

    // ord_1 failed but ord_2 (different record) should still be pushed
    expect(result.pushed).toBe(1);
    expect(result.failed).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const entries = await getPendingEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].record_id).toBe('ord_1');
    expect(entries[0].attempts).toBe(1);
  });

  it('skips later operations on the failed record but continues with unrelated entries', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('network'))          // ord_1 create fails
      .mockResolvedValueOnce(mockResponse(201, {}));        // ord_2 create succeeds
    // ord_1 update should be skipped (blocked), ord_2 create should succeed

    await enqueue('orders', 'create', 'ord_1', { id: 'ord_1' });
    await enqueue('orders', 'update', 'ord_1', { status: 'accepted' }); // blocked by failed create
    await enqueue('orders', 'create', 'ord_2', { id: 'ord_2' });       // different record, unblocked

    const result = await drainQueue(FAKE_CFG);

    expect(result.pushed).toBe(1);   // ord_2 succeeded
    expect(result.failed).toBe(1);   // ord_1 create failed
    expect(fetchSpy).toHaveBeenCalledTimes(2); // ord_1 create + ord_2 create (ord_1 update skipped)

    const entries = await getPendingEntries();
    expect(entries).toHaveLength(2); // ord_1 create + ord_1 update remain
    expect(entries[0].record_id).toBe('ord_1');
    expect(entries[0].operation).toBe('create');
    expect(entries[0].attempts).toBe(1);
    expect(entries[1].record_id).toBe('ord_1');
    expect(entries[1].operation).toBe('update');
    expect(entries[1].attempts).toBe(0); // update was skipped, not attempted
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
    expect(result).toEqual({ pushed: 0, failed: 0, abandoned: 0, pushedIds: [], offline: false });
  });

  it('populates pushedIds with collection and recordId for each successful push', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve(mockResponse(201, {})),
    );
    await enqueue('orders', 'create', 'ord_pushed_1', { id: 'ord_pushed_1' });
    await enqueue('bill_sessions', 'update', 'bill_pushed_1', { id: 'bill_pushed_1', status: 'open' });

    const result = await drainQueue(FAKE_CFG);

    expect(result.pushed).toBe(2);
    expect(result.pushedIds).toHaveLength(2);
    expect(result.pushedIds).toEqual(
      expect.arrayContaining([
        { collection: 'orders', recordId: 'ord_pushed_1' },
        { collection: 'bill_sessions', recordId: 'bill_pushed_1' },
      ]),
    );
  });

  it('does not include skipped or failed entries in pushedIds', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network'));
    // bill_sessions delete is a domain-status skip (no fetch call, pushed++ but NOT in pushedIds)
    await enqueue('bill_sessions', 'delete', 'bill_skip_1', null);
    // orders create that fails (network error)
    await enqueue('orders', 'create', 'ord_fail_1', { id: 'ord_fail_1' });

    const result = await drainQueue(FAKE_CFG);

    expect(result.pushedIds).toEqual([]);
  });

  it('sends Authorization header', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse(201, {}));
    await enqueue('orders', 'create', 'ord_1', { id: 'ord_1' });
    await drainQueue(FAKE_CFG);

    const { headers } = fetchSpy.mock.calls[0][1];
    expect(headers.Authorization).toBe('Bearer tok_test');
  });

  it('blocks same-record operations even when the parent entry is abandoned (MAX_ATTEMPTS)', async () => {
    // Seed attempts so next drain triggers abandon (attempts already at MAX_ATTEMPTS - 1)
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network'));

    await enqueue('orders', 'create', 'ord_abandon_1', { id: 'ord_abandon_1' });
    await enqueue('orders', 'update', 'ord_abandon_1', { status: 'accepted' }); // must stay blocked

    // Exhaust retry budget so the create is abandoned on this drain
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      await drainQueue(FAKE_CFG);
    }
    const finalResult = await drainQueue(FAKE_CFG);

    // The create was abandoned (removed), but the update must still be in the queue
    // untouched (attempts === 0) because it was blocked the whole time.
    expect(finalResult.abandoned).toBe(1);
    const entries = await getPendingEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].operation).toBe('update');
    expect(entries[0].attempts).toBe(0);
  });

  it('blocks child collection entries when parent transaction create fails', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('network'))    // transactions:txn_1 create fails
      .mockResolvedValueOnce(mockResponse(201, {}));  // a different, unrelated entry succeeds

    await enqueue('transactions', 'create', 'txn_1', { id: 'txn_1', amount_paid: 10 });
    // Child refs depend on the parent FK "transaction === 'txn_1'"
    await enqueue('transaction_order_refs', 'create', 'ref_1', { id: 'ref_1', transaction: 'txn_1', order: 'ord_1' });
    await enqueue('transaction_voce_refs',  'create', 'ref_2', { id: 'ref_2', transaction: 'txn_1', voce_key: 'v1', qty: 1 });
    // Unrelated entry for a different transaction — must NOT be blocked
    await enqueue('transactions', 'create', 'txn_2', { id: 'txn_2', amount_paid: 20 });

    const result = await drainQueue(FAKE_CFG);

    // txn_1 failed → ref_1 and ref_2 skipped; txn_2 pushed
    expect(result.pushed).toBe(1);
    expect(result.failed).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2); // txn_1 (failed) + txn_2 (ok); refs skipped

    const entries = await getPendingEntries();
    expect(entries).toHaveLength(3); // txn_1 + ref_1 + ref_2 remain
    const remaining = entries.map(e => e.record_id);
    expect(remaining).toContain('txn_1');
    expect(remaining).toContain('ref_1');
    expect(remaining).toContain('ref_2');

    // Refs must NOT have been attempted (attempts still 0)
    const ref1 = entries.find(e => e.record_id === 'ref_1');
    const ref2 = entries.find(e => e.record_id === 'ref_2');
    expect(ref1.attempts).toBe(0);
    expect(ref2.attempts).toBe(0);
  });

  it('blocks transaction_order_refs when the referenced order (secondary FK) has failed', async () => {
    // Scenario: orders:create fails (HTTP error, not network) while
    // transactions:create succeeds.  The transaction_order_refs entry depends
    // on BOTH the parent transaction AND the referenced order.  Even though the
    // transaction was pushed, the ref must be skipped because orders:ord_1 is
    // in blockedKeys.
    // Use a plain Error (not TypeError) so _pushEntry treats this as an
    // application-level failure that burns a retry attempt but does NOT
    // trigger the offline-halt path (which only fires on TypeError).
    vi.spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('HTTP 400 Bad Request')) // orders:create fails
      .mockImplementation(() => Promise.resolve(mockResponse(201, {})));

    await enqueue('orders', 'create', 'ord_1', { id: 'ord_1' });
    await enqueue('transactions', 'create', 'txn_1', { id: 'txn_1', amount_paid: 10 });
    // ref depends on BOTH transactions:txn_1 AND orders:ord_1
    await enqueue('transaction_order_refs', 'create', 'ref_1', { id: 'ref_1', transaction: 'txn_1', order: 'ord_1' });

    const result = await drainQueue(FAKE_CFG);

    // ord_1 failed, txn_1 pushed (no bill_session dep, no block), ref_1 skipped (orders:ord_1 blocked)
    expect(result.pushed).toBe(1);
    expect(result.failed).toBe(1);

    const entries = await getPendingEntries();
    expect(entries).toHaveLength(2); // ord_1 + ref_1 remain
    const ref = entries.find(e => e.record_id === 'ref_1');
    expect(ref.attempts).toBe(0); // blocked via secondary FK — no attempts burned
  });

  it('blocks daily_closure_by_method entries when parent daily_closures create fails', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('network'));

    await enqueue('daily_closures', 'create', 'close_1', { id: 'close_1' });
    await enqueue('daily_closure_by_method', 'create', 'cbm_1', { id: 'cbm_1', daily_closure: 'close_1', amount: 50 });

    const result = await drainQueue(FAKE_CFG);

    expect(result.pushed).toBe(0);
    expect(result.failed).toBe(1);

    const entries = await getPendingEntries();
    expect(entries).toHaveLength(2);
    const cbm = entries.find(e => e.record_id === 'cbm_1');
    expect(cbm.attempts).toBe(0); // was blocked, never attempted
  });

  it('blocks orders create when parent bill_session create fails', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('network'));

    await enqueue('bill_sessions', 'create', 'bill_1', { id: 'bill_1', table: 'T1', status: 'open' });
    // order references the bill_session via camelCase billSessionId (raw queue payload)
    await enqueue('orders', 'create', 'ord_1', { id: 'ord_1', table: 'T1', billSessionId: 'bill_1' });

    const result = await drainQueue(FAKE_CFG);

    expect(result.pushed).toBe(0);
    expect(result.failed).toBe(1);

    const entries = await getPendingEntries();
    expect(entries).toHaveLength(2);
    const ord = entries.find(e => e.record_id === 'ord_1');
    expect(ord.attempts).toBe(0); // blocked, never attempted
  });

  it('blocks transactions create when parent bill_session create fails', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('network'));

    await enqueue('bill_sessions', 'create', 'bill_2', { id: 'bill_2', table: 'T2', status: 'open' });
    await enqueue('transactions', 'create', 'txn_2', { id: 'txn_2', billSessionId: 'bill_2', amount_paid: 20 });

    const result = await drainQueue(FAKE_CFG);

    expect(result.pushed).toBe(0);
    expect(result.failed).toBe(1);

    const entries = await getPendingEntries();
    expect(entries).toHaveLength(2);
    const txn = entries.find(e => e.record_id === 'txn_2');
    expect(txn.attempts).toBe(0); // blocked, never attempted
  });

  it('does NOT block child entries when the parent fails with an UPDATE (record already in Directus)', async () => {
    // Scenario: orders:update fails (parent record already exists in Directus from a
    // previous successful CREATE).  transaction_order_refs that reference ord_1 via FK
    // 'order' should NOT be blocked — the FK is already satisfied even though the
    // UPDATE fails.  Only failed CREATE operations (record doesn't exist yet) should
    // gate children.
    vi.spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('HTTP 400 Bad Request')) // orders:update fails
      .mockImplementation(() => Promise.resolve(mockResponse(201, {})));  // refs succeed

    // Simulate parent already existing in Directus: only enqueue an UPDATE (no pending CREATE)
    await enqueue('orders', 'update', 'ord_1', { status: 'accepted' });
    // Child ref references ord_1 via FK 'order' — ord_1 already exists in Directus
    await enqueue('transaction_order_refs', 'create', 'ref_1', {
      id: 'ref_1', transaction: 'txn_1', order: 'ord_1',
    });

    const result = await drainQueue(FAKE_CFG);

    // orders:update failed → ord_1 in blockedKeys but NOT in failedCreates (UPDATE,
    // not CREATE) → ref_1 must NOT be gated because the parent op is an UPDATE
    // (record already exists in Directus) not a CREATE.
    expect(result.pushed).toBe(1); // ref_1 pushed successfully
    expect(result.failed).toBe(1); // orders:update failed

    const entries = await getPendingEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].record_id).toBe('ord_1');
    expect(entries[0].operation).toBe('update');
    // ref_1 was pushed, not deferred
    expect(entries.find(e => e.record_id === 'ref_1')).toBeUndefined();
  });

  it('does NOT block child UPDATE/DELETE entries when parent CREATE is pending', async () => {
    // FK gating only applies to child CREATE entries.  An UPDATE or DELETE on a
    // child collection must proceed even when the same parent record has a pending
    // CREATE (the child record already exists in Directus; only new child records
    // need to wait for the parent to be created first).
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('server error')) // bill_sessions:create fails
      .mockResolvedValueOnce(mockResponse(200, {}));    // orders:update succeeds

    await enqueue('bill_sessions', 'create', 'bill_upd', { id: 'bill_upd', table: 'T_U', status: 'open' });
    // Child UPDATE — the order already exists in Directus; this is just an update
    await enqueue('orders', 'update', 'ord_upd', { id: 'ord_upd', billSessionId: 'bill_upd', status: 'accepted' });

    const result = await drainQueue(FAKE_CFG);

    // bill_sessions:create failed (attempts++), orders:update should succeed
    expect(result.failed).toBe(1);
    expect(result.pushed).toBe(1); // orders:update not gated, pushed through

    // The orders:update fetch call must have been made (2 calls total)
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const entries = await getPendingEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].record_id).toBe('bill_upd'); // only the CREATE remains
  });
});

// ── Offline halt ──────────────────────────────────────────────────────────────

describe('drainQueue() — offline halt', () => {
  it('returns offline:false when all entries succeed', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse(201, {}));
    await enqueue('orders', 'create', 'ord_1', { id: 'ord_1' });

    const result = await drainQueue(FAKE_CFG);

    expect(result.offline).toBe(false);
    expect(result.pushed).toBe(1);
  });

  it('returns offline:true and halts when the first entry gets a network error', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await enqueue('orders', 'create', 'ord_1', { id: 'ord_1' });
    await enqueue('orders', 'create', 'ord_2', { id: 'ord_2' });
    await enqueue('orders', 'create', 'ord_3', { id: 'ord_3' });

    const result = await drainQueue(FAKE_CFG);

    expect(result.offline).toBe(true);
    expect(result.pushed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.abandoned).toBe(0);
    // All entries remain untouched (attempts still 0)
    const entries = await getPendingEntries();
    expect(entries).toHaveLength(3);
    for (const e of entries) expect(e.attempts).toBe(0);
  });

  it('returns offline:true and stops after partial success when a network error occurs mid-drain', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(mockResponse(201, {}))  // ord_1 succeeds
      .mockRejectedValue(new TypeError('Failed to fetch')); // ord_2 → network error

    await enqueue('orders', 'create', 'ord_1', { id: 'ord_1' });
    await enqueue('orders', 'create', 'ord_2', { id: 'ord_2' });
    await enqueue('orders', 'create', 'ord_3', { id: 'ord_3' });

    const result = await drainQueue(FAKE_CFG);

    expect(result.offline).toBe(true);
    expect(result.pushed).toBe(1);
    expect(result.failed).toBe(0);  // network errors do NOT count as failed
    expect(result.abandoned).toBe(0);

    // ord_1 was removed; ord_2 and ord_3 remain untouched
    const entries = await getPendingEntries();
    expect(entries).toHaveLength(2);
    for (const e of entries) expect(e.attempts).toBe(0);
  });

  it('does NOT set offline:true for server-level HTTP errors (4xx/5xx)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse(400, { errors: [{ message: 'Bad Request' }] }));

    await enqueue('orders', 'create', 'ord_1', { id: 'ord_1' });

    const result = await drainQueue(FAKE_CFG);

    expect(result.offline).toBe(false);
    expect(result.failed).toBe(1);
    const entries = await getPendingEntries();
    expect(entries[0].attempts).toBe(1); // attempt counter IS incremented for HTTP errors
  });
});

// ── BFS retry ordering ────────────────────────────────────────────────────────

describe('drainQueue() — BFS fair-retry ordering', () => {
  it('processes entries with fewer attempts first (BFS ordering for independent records)', async () => {
    // Chain: first call fails (server error, not a network TypeError), all subsequent succeed.
    // Note: mockImplementation creates a fresh Response for each call (Response body is
    // a one-time-read stream; mockResolvedValue would reuse the same instance).
    vi.spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('server error 500'))
      .mockImplementation(() => Promise.resolve(mockResponse(201, {})));

    // Drain 1: ord_A fails → attempts becomes 1
    await enqueue('orders', 'create', 'ord_A', { id: 'ord_A' });
    await drainQueue(FAKE_CFG);

    // Now enqueue ord_B (fresh, attempts=0) after A has already failed once
    await enqueue('orders', 'create', 'ord_B', { id: 'ord_B' });

    // Queue: ord_A(1), ord_B(0). BFS should try ord_B before ord_A.
    const result = await drainQueue(FAKE_CFG);

    expect(result.pushed).toBe(2);
    expect(result.failed).toBe(0);
    // ord_B (attempts=0) should appear before ord_A (attempts=1) in pushedIds
    const bIdx = result.pushedIds.findIndex(p => p.recordId === 'ord_B');
    const aIdx = result.pushedIds.findIndex(p => p.recordId === 'ord_A');
    expect(bIdx).toBeLessThan(aIdx);
  });

  it('defers a child entry (attempts=0) when its parent (attempts>0) has not been pushed yet this cycle', async () => {
    // Chain: first call fails (server error, not a network TypeError), all subsequent succeed.
    // Note: mockImplementation creates a fresh Response for each call (Response body is
    // a one-time-read stream; mockResolvedValue would reuse the same instance).
    vi.spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('server error'))
      .mockImplementation(() => Promise.resolve(mockResponse(201, {})));

    // Drain 1: bill_1 fails → attempts becomes 1; ord_1 was blocked, still at 0
    await enqueue('bill_sessions', 'create', 'bill_1', { id: 'bill_1', table: 'T1', status: 'open' });
    await enqueue('orders', 'create', 'ord_1', { id: 'ord_1', table: 'T1', billSessionId: 'bill_1' });
    await drainQueue(FAKE_CFG); // bill_1 fails (1), ord_1 blocked (0)

    // Drain 2: bill_1(1), ord_1(0). Group BFS would sort ord_1 before bill_1.
    // But pendingSet guard must defer ord_1 until bill_1 is processed.
    const result = await drainQueue(FAKE_CFG);

    // bill_1 should be pushed; ord_1 should be deferred (still in queue)
    // because when ord_1 is evaluated (first in BFS order), bill_1 hasn't
    // been pushed yet in this cycle.
    expect(result.pushed).toBe(1); // only bill_1 pushed
    const entries = await getPendingEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].record_id).toBe('ord_1');
    expect(entries[0].attempts).toBe(0); // not burned — was deferred

    // Drain 3: bill_1 no longer in queue; ord_1 can be pushed freely
    const result3 = await drainQueue(FAKE_CFG);
    expect(result3.pushed).toBe(1);
    expect(result3.failed).toBe(0);
    const remaining = await getPendingEntries();
    expect(remaining).toHaveLength(0);
  });

  it('group with failed gate entry (attempts>0) is sorted after a fully fresh group (not treated as "never tried")', async () => {
    // Verifies the firstAttempts fix: a group whose gate entry has attempts=1 but
    // later entries still have attempts=0 must NOT steal BFS priority from a fresh
    // group (gate=0).  With the old minAttempts approach, min(1,0)=0 would make the
    // retried group appear as "never tried", incorrectly jumping ahead.
    vi.spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('server error'))   // ord_A create fails
      .mockImplementation(() => Promise.resolve(mockResponse(201, {})));

    // Drain 1: ord_A create fails → ord_A.create.attempts = 1
    await enqueue('orders', 'create', 'ord_A', { id: 'ord_A' });
    await drainQueue(FAKE_CFG);

    // Now add an update for ord_A (gate=1, update=0) and a fresh ord_B (gate=0).
    await enqueue('orders', 'update', 'ord_A', { status: 'updated' });
    await enqueue('orders', 'create', 'ord_B', { id: 'ord_B' });

    // Queue now:
    //   ord_A group: [create(1), update(0)] → firstAttempts = 1
    //   ord_B group: [create(0)]            → firstAttempts = 0
    // BFS must process ord_B before ord_A group.
    const result = await drainQueue(FAKE_CFG);

    expect(result.pushed).toBe(3); // ord_B.create + ord_A.create + ord_A.update
    // ord_B (firstAttempts=0) must appear before ord_A entries in pushedIds
    const bIdx = result.pushedIds.findIndex(p => p.recordId === 'ord_B');
    const aIdx = result.pushedIds.findIndex(p => p.recordId === 'ord_A');
    expect(bIdx).toBeLessThan(aIdx);
  });

  it('cascade-abandons child entries when parent CREATE reaches MAX_ATTEMPTS', async () => {
    // When a parent CREATE is permanently abandoned, any in-queue children that
    // FK-reference that parent are also immediately removed from the queue so
    // they do not waste retry budget and spam the failed-call log with
    // FK-not-found errors that will never resolve.
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('server error'));

    // Parent: bill_sessions CREATE that will be abandoned
    await enqueue('bill_sessions', 'create', 'bill_X', { id: 'bill_X', table: 'T99', status: 'open' });
    // Direct child: orders references bill_sessions via billSessionId
    await enqueue('orders', 'create', 'ord_X', { id: 'ord_X', billSessionId: 'bill_X' });
    // Transitive grandchild: transaction_order_refs references orders via "order" FK
    await enqueue('transaction_order_refs', 'create', 'ref_X', { id: 'ref_X', transaction: 'txn_other', order: 'ord_X' });

    // Drain MAX_ATTEMPTS-1 times so bill_X is about to be abandoned.
    // ord_X and ref_X are shielded by the pendingCreates guard and stay at 0.
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      await drainQueue(FAKE_CFG);
    }

    // Add an unrelated order AFTER the retry cycles so it has 0 attempts
    // and its bill_sessions (bill_other) is NOT in failedCreates — it must
    // survive the cascade and stay in the queue.
    await enqueue('orders', 'create', 'ord_unrelated', { id: 'ord_unrelated', billSessionId: 'bill_other' });

    // Final drain: bill_X hits MAX_ATTEMPTS → abandon + cascade
    const result = await drainQueue(FAKE_CFG);

    // bill_X itself + ord_X (direct child) + ref_X (transitive grandchild) all abandoned
    expect(result.abandoned).toBe(3);
    // ord_unrelated failed (only 1 attempt so far) but not abandoned
    expect(result.failed).toBe(1);

    // Only ord_unrelated (different bill_session) should remain in the queue
    const remaining = await getPendingEntries();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].record_id).toBe('ord_unrelated');
    expect(remaining[0].attempts).toBe(1); // burned once, not cascade-affected

    // All three abandoned entries must appear in the failed-call log with abandoned=true
    const failedCalls = await getFailedSyncCalls();
    const abandonedIds = failedCalls.filter(c => c.abandoned).map(c => c.record_id);
    expect(abandonedIds).toContain('bill_X');
    expect(abandonedIds).toContain('ord_X');
    expect(abandonedIds).toContain('ref_X');
    expect(abandonedIds).not.toContain('ord_unrelated');
  });

  it('does NOT cascade-abandon children of a sibling parent that only failed non-fatally in the same cycle', async () => {
    // Regression test for the scoping of the cascade-abandon scan:
    // When parent_A is permanently abandoned and parent_B fails non-fatally in
    // the SAME drain cycle, children of parent_B must NOT be cascade-abandoned.
    // (The fix: use a local cascadeAbandoned set seeded with parent_A's key,
    //  instead of the global failedCreates that contains BOTH parent keys.)
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('server error'));

    // Parent A: already has MAX_ATTEMPTS-1 attempts → will be abandoned next drain
    await enqueue('bill_sessions', 'create', 'bill_A', { id: 'bill_A', table: 'T_A', status: 'open' });
    await enqueue('orders', 'create', 'ord_A_child', { id: 'ord_A_child', billSessionId: 'bill_A' });

    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      await drainQueue(FAKE_CFG);
    }
    // bill_A.attempts = MAX_ATTEMPTS-1 now; ord_A_child.attempts = 0 (blocked)

    // Parent B: only 0 attempts — will fail non-fatally in this drain
    await enqueue('bill_sessions', 'create', 'bill_B', { id: 'bill_B', table: 'T_B', status: 'open' });
    await enqueue('orders', 'create', 'ord_B_child', { id: 'ord_B_child', billSessionId: 'bill_B' });

    // Final drain: bill_A hits MAX_ATTEMPTS → cascade abandons ord_A_child
    //              bill_B fails (attempts=1) → must NOT cascade-abandon ord_B_child
    const result = await drainQueue(FAKE_CFG);

    // bill_A + ord_A_child cascade-abandoned = 2; bill_B failed non-fatally = 1
    expect(result.abandoned).toBe(2);
    expect(result.failed).toBe(1);

    // ord_B_child must remain in the queue untouched (attempts=0, blocked this cycle)
    const remaining = await getPendingEntries();
    const bChild = remaining.find(e => e.record_id === 'ord_B_child');
    expect(bChild).toBeDefined();
    expect(bChild.attempts).toBe(0);

    // Only A-side entries should appear in the failed-call log as abandoned
    const failedCalls = await getFailedSyncCalls();
    const abandonedIds = failedCalls.filter(c => c.abandoned).map(c => c.record_id);
    expect(abandonedIds).toContain('bill_A');
    expect(abandonedIds).toContain('ord_A_child');
    expect(abandonedIds).not.toContain('bill_B');
    expect(abandonedIds).not.toContain('ord_B_child');
  });

  it('does NOT cascade-abandon children when parent fails with a non-final error', async () => {
    // Cascade only triggers on final abandon (MAX_ATTEMPTS reached).
    // A non-final failure must leave children in the queue untouched (attempts 0).
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('server error'));

    await enqueue('bill_sessions', 'create', 'bill_Y', { id: 'bill_Y', table: 'T98', status: 'open' });
    await enqueue('orders', 'create', 'ord_Y', { id: 'ord_Y', billSessionId: 'bill_Y' });

    // Only one drain — bill_Y gets attempts=1 (not yet abandoned)
    const result = await drainQueue(FAKE_CFG);

    expect(result.abandoned).toBe(0);
    expect(result.failed).toBe(1); // bill_Y incremented
    const entries = await getPendingEntries();
    // Both entries must still be in the queue
    expect(entries).toHaveLength(2);
    const ordEntry = entries.find(e => e.record_id === 'ord_Y');
    expect(ordEntry.attempts).toBe(0); // not burned — blocked but not cascade-abandoned
  });

  it('does NOT block children via failedCreates when parent CREATE gets RECORD_NOT_UNIQUE and fallback PATCH fails', async () => {
    // Scenario: the parent CREATE receives HTTP 400 RECORD_NOT_UNIQUE (duplicate
    // — record already exists in Directus from a previous push).  The fallback
    // PATCH then fails (e.g. permission error).  The record IS in Directus, so
    // child FK entries remain satisfiable and must NOT be deferred via
    // failedCreates or cascade-abandoned.
    const fetchSpy = vi.spyOn(global, 'fetch')
      // bill_sessions:create → 400 RECORD_NOT_UNIQUE (already exists)
      .mockResolvedValueOnce(mockResponse(400, { errors: [{ message: 'Value for field "id" in collection "bill_sessions" has to be unique.', extensions: { code: 'RECORD_NOT_UNIQUE', collection: 'bill_sessions', field: 'id', primaryKey: true } }] }))
      // bill_sessions:create fallback PATCH → 403 permission error
      .mockResolvedValueOnce(mockResponse(403, { errors: [{ message: 'Forbidden', extensions: { code: 'FORBIDDEN' } }] }))
      // orders:create → success (record exists in Directus, FK satisfied)
      .mockResolvedValueOnce(mockResponse(200, {}));

    await enqueue('bill_sessions', 'create', 'bill_409', { id: 'bill_409', table: 'T1', status: 'open' });
    await enqueue('orders', 'create', 'ord_409', { id: 'ord_409', billSessionId: 'bill_409' });

    const result = await drainQueue(FAKE_CFG);

    // bill_sessions:create failed (attempts++), orders:create succeeded
    expect(result.failed).toBe(1);
    expect(result.pushed).toBe(1);
    expect(result.abandoned).toBe(0);

    // ord_409 must have been pushed (FK satisfied because record exists via RECORD_NOT_UNIQUE)
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const thirdCall = fetchSpy.mock.calls[2];
    expect(thirdCall[0]).toContain('/items/orders');

    // bill_sessions:create is still in queue (incremented), orders is gone
    const remaining = await getPendingEntries();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].record_id).toBe('bill_409');
    expect(remaining[0].attempts).toBe(1);
  });
});
