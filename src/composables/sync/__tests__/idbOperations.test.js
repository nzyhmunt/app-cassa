/**
 * @file composables/sync/__tests__/idbOperations.test.js
 * @description Targeted unit tests for idbOperations.js — LWW conflict
 * resolution logic tested in isolation, without the full sync test harness.
 *
 * Tests cover:
 *  - LWW: incoming item newer than IDB → overwrites
 *  - LWW: incoming item older than IDB → skipped
 *  - LWW: IDB has no existing record → always writes
 *  - LWW: null date_updated falls back to writing (no-data wins over null)
 *  - Atomicity: both order_items and parent orders store updated in one call
 *  - affectedOrderIds: returned set contains parent order IDs
 *  - Empty input: returns zeros without touching IDB
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { _resetIDBSingleton } from '../../useIDB.js';
import { _atomicOrderItemsUpsertAndMerge, _preparePullRecordsForIDB } from '../idbOperations.js';
import { _recentlyPushed, _registerPushedEchoes } from '../echoSuppression.js';

beforeEach(async () => {
  await _resetIDBSingleton();
  _recentlyPushed.clear();
});

afterEach(() => {
  _recentlyPushed.clear();
});

describe('_atomicOrderItemsUpsertAndMerge — LWW', () => {
  it('writes item and parent order when no existing record exists', async () => {
    const { getDB } = await import('../../useIDB.js');
    const db = await getDB();

    await db.put('orders', {
      id: 'ord_new',
      status: 'accepted',
      orderItems: [],
      date_updated: '2024-01-01T00:00:00.000Z',
    });

    const item = {
      id: 'oi_new',
      order: 'ord_new',
      orderId: 'ord_new',
      name: 'Caffè',
      quantity: 1,
      unitPrice: 1.5,
      date_updated: '2024-06-01T00:00:00.000Z',
    };

    const result = await _atomicOrderItemsUpsertAndMerge([item], []);
    expect(result.orderItemsWritten).toBe(1);
    expect(result.ordersWritten).toBe(1);

    const stored = await db.get('order_items', 'oi_new');
    expect(stored).toBeDefined();
    expect(stored.name).toBe('Caffè');

    const order = await db.get('orders', 'ord_new');
    expect(order.orderItems).toHaveLength(1);
  });

  it('overwrites when incoming date_updated is strictly newer', async () => {
    const { getDB } = await import('../../useIDB.js');
    const db = await getDB();

    await db.put('order_items', {
      id: 'oi_lww',
      order: 'ord_lww',
      orderId: 'ord_lww',
      name: 'Old Name',
      quantity: 1,
      date_updated: '2024-01-01T00:00:00.000Z',
    });
    await db.put('orders', {
      id: 'ord_lww',
      orderItems: [{ id: 'oi_lww', name: 'Old Name', quantity: 1 }],
      date_updated: '2024-01-01T00:00:00.000Z',
    });

    const newerItem = {
      id: 'oi_lww',
      order: 'ord_lww',
      orderId: 'ord_lww',
      name: 'New Name',
      quantity: 2,
      date_updated: '2024-12-01T00:00:00.000Z',
    };

    const result = await _atomicOrderItemsUpsertAndMerge([newerItem], []);
    expect(result.orderItemsWritten).toBe(1);

    const stored = await db.get('order_items', 'oi_lww');
    expect(stored.name).toBe('New Name');
    expect(stored.quantity).toBe(2);
  });

  it('skips (LWW) when incoming date_updated is older than IDB record', async () => {
    const { getDB } = await import('../../useIDB.js');
    const db = await getDB();

    await db.put('order_items', {
      id: 'oi_lww2',
      order: 'ord_lww2',
      orderId: 'ord_lww2',
      name: 'Current Name',
      quantity: 3,
      date_updated: '2024-12-01T00:00:00.000Z',
    });
    await db.put('orders', {
      id: 'ord_lww2',
      orderItems: [{ id: 'oi_lww2', name: 'Current Name', quantity: 3 }],
      date_updated: '2024-12-01T00:00:00.000Z',
    });

    const olderItem = {
      id: 'oi_lww2',
      order: 'ord_lww2',
      orderId: 'ord_lww2',
      name: 'Stale Name',
      quantity: 1,
      date_updated: '2024-01-01T00:00:00.000Z',
    };

    const result = await _atomicOrderItemsUpsertAndMerge([olderItem], []);
    expect(result.orderItemsWritten).toBe(0);

    const stored = await db.get('order_items', 'oi_lww2');
    expect(stored.name).toBe('Current Name');
    expect(stored.quantity).toBe(3);
  });

  it('writes when incoming has date_updated and existing has null date_updated', async () => {
    const { getDB } = await import('../../useIDB.js');
    const db = await getDB();

    await db.put('order_items', {
      id: 'oi_null',
      order: 'ord_null',
      orderId: 'ord_null',
      name: 'No Date',
      date_updated: null,
    });
    await db.put('orders', {
      id: 'ord_null',
      orderItems: [{ id: 'oi_null', name: 'No Date' }],
      date_updated: null,
    });

    const incomingWithDate = {
      id: 'oi_null',
      order: 'ord_null',
      orderId: 'ord_null',
      name: 'Has Date',
      date_updated: '2024-01-01T00:00:00.000Z',
    };

    const result = await _atomicOrderItemsUpsertAndMerge([incomingWithDate], []);
    expect(result.orderItemsWritten).toBe(1);

    const stored = await db.get('order_items', 'oi_null');
    expect(stored.name).toBe('Has Date');
  });
});

describe('_atomicOrderItemsUpsertAndMerge — affectedOrderIds', () => {
  it('returns the set of parent order IDs that were written', async () => {
    const { getDB } = await import('../../useIDB.js');
    const db = await getDB();

    await db.put('orders', { id: 'ord_aff1', orderItems: [], date_updated: '2024-01-01T00:00:00.000Z' });
    await db.put('orders', { id: 'ord_aff2', orderItems: [], date_updated: '2024-01-01T00:00:00.000Z' });

    const items = [
      { id: 'oi_a1', order: 'ord_aff1', orderId: 'ord_aff1', name: 'A1', date_updated: '2025-01-01T00:00:00.000Z' },
      { id: 'oi_a2', order: 'ord_aff2', orderId: 'ord_aff2', name: 'A2', date_updated: '2025-01-01T00:00:00.000Z' },
    ];

    const result = await _atomicOrderItemsUpsertAndMerge(items, []);
    expect(result.affectedOrderIds).toBeInstanceOf(Set);
    expect(result.affectedOrderIds.has('ord_aff1')).toBe(true);
    expect(result.affectedOrderIds.has('ord_aff2')).toBe(true);
  });

  it('does not include order IDs for skipped (LWW) items', async () => {
    const { getDB } = await import('../../useIDB.js');
    const db = await getDB();

    const existingItem = { id: 'oi_skip', name: 'Newer', date_updated: '2025-12-01T00:00:00.000Z', quantity: 3 };
    await db.put('order_items', {
      ...existingItem,
      order: 'ord_skip',
      orderId: 'ord_skip',
    });
    // Seed the parent order with the existing item already embedded.
    // When Phase 2 tries to merge the older incoming item, LWW comparison
    // prevents overwrite, orderItems stays identical → ordersWritten stays 0.
    await db.put('orders', {
      id: 'ord_skip',
      orderItems: [existingItem],
      date_updated: '2024-01-01T00:00:00.000Z',
    });

    const olderItem = {
      id: 'oi_skip',
      order: 'ord_skip',
      orderId: 'ord_skip',
      name: 'Older',
      date_updated: '2024-01-01T00:00:00.000Z',
    };

    const result = await _atomicOrderItemsUpsertAndMerge([olderItem], []);
    expect(result.orderItemsWritten).toBe(0);
    expect(result.affectedOrderIds.size).toBe(0);
  });
});

describe('_atomicOrderItemsUpsertAndMerge — edge cases', () => {
  it('returns zeros without touching IDB for empty input', async () => {
    const result = await _atomicOrderItemsUpsertAndMerge([]);
    expect(result).toEqual({ orderItemsWritten: 0, ordersWritten: 0, affectedOrderIds: new Set() });
  });

  it('handles undefined/null items in array gracefully', async () => {
    const result = await _atomicOrderItemsUpsertAndMerge([null, undefined]);
    expect(result.orderItemsWritten).toBe(0);
  });
});

// ─── _preparePullRecordsForIDB — echo-suppression guard ───────────────────

describe('_preparePullRecordsForIDB — echo-suppression guard for orders', () => {
  const TS0 = '2024-01-01T10:00:00.000Z';
  const TS1 = '2024-01-01T10:01:00.000Z'; // strictly newer

  // Local order after void: voidedQuantity=1, totals reflect the local mutation.
  const localOrder = {
    id: 'ord_echo',
    date_updated: TS0,
    orderItems: [{ id: 'oi_1', voidedQuantity: 1, voided_quantity: 1, quantity: 2 }],
    totalAmount: 10,
    total_amount: 10,
    itemCount: 1,
    item_count: 1,
  };

  // Server order (stale): voidedQuantity=0, server totals pre-date the void.
  const directusOrder = (dateUpdated = TS0) => ({
    id: 'ord_echo',
    date_updated: dateUpdated,
    orderItems: [{ id: 'oi_1', voidedQuantity: 0, voided_quantity: 0, quantity: 2 }],
    totalAmount: 24,
    total_amount: 24,
    itemCount: 2,
    item_count: 2,
  });

  it('preserves local orderItems and totals when order is echo-suppressed and incoming has same timestamp', async () => {
    // Simulate a local void: local IDB has voidedQuantity=1 and local totals, server still has stale values.
    _registerPushedEchoes([{ collection: 'orders', recordId: 'ord_echo' }], 5000);
    const state = { orders: [localOrder] };

    const { records } = await _preparePullRecordsForIDB('orders', [directusOrder(TS0)], state);

    expect(records[0].orderItems[0].voidedQuantity).toBe(1);
    expect(records[0].totalAmount).toBe(10);
    expect(records[0].itemCount).toBe(1);
  });

  it('preserves local orderItems and totals when order is echo-suppressed and incoming is older', async () => {
    _registerPushedEchoes([{ collection: 'orders', recordId: 'ord_echo' }], 5000);
    const olderOrder = directusOrder('2023-12-31T00:00:00.000Z');
    const state = { orders: [localOrder] };

    const { records } = await _preparePullRecordsForIDB('orders', [olderOrder], state);

    expect(records[0].orderItems[0].voidedQuantity).toBe(1);
    expect(records[0].totalAmount).toBe(10);
    expect(records[0].itemCount).toBe(1);
  });

  it('allows incoming orderItems and totals through when incoming is strictly newer (cross-device update)', async () => {
    // Incoming has TS1 > TS0 (local) → cross-device update must win even if echo-suppressed.
    _registerPushedEchoes([{ collection: 'orders', recordId: 'ord_echo' }], 5000);
    const state = { orders: [localOrder] };

    const { records } = await _preparePullRecordsForIDB('orders', [directusOrder(TS1)], state);

    expect(records[0].orderItems[0].voidedQuantity).toBe(0);
    expect(records[0].totalAmount).toBe(24);
    expect(records[0].itemCount).toBe(2);
  });

  it('incoming orderItems and totals win when order is NOT echo-suppressed (no pending push)', async () => {
    // No echo suppression registered → existing behaviour: incoming wins.
    const state = { orders: [localOrder] };

    const { records } = await _preparePullRecordsForIDB('orders', [directusOrder(TS0)], state);

    expect(records[0].orderItems[0].voidedQuantity).toBe(0);
    expect(records[0].totalAmount).toBe(24);
    expect(records[0].itemCount).toBe(2);
  });

  it('still preserves local orderItems and totals when incoming has no orderItems (pre-existing guard)', async () => {
    const noItemsOrder = {
      id: 'ord_echo',
      date_updated: TS1,
      orderItems: [],
      totalAmount: 24,
      total_amount: 24,
      itemCount: 2,
      item_count: 2,
    };
    const state = { orders: [localOrder] };

    const { records } = await _preparePullRecordsForIDB('orders', [noItemsOrder], state);

    expect(records[0].orderItems[0].voidedQuantity).toBe(1);
    expect(records[0].totalAmount).toBe(10);
    expect(records[0].itemCount).toBe(1);
  });

  it('excludes record from write batch when echo-suppressed and cachedState has empty orderItems', async () => {
    // Regression for "inserimento comanda" rollback: addItemsToOrder writes items to
    // real IDB and enqueues a push, but the REST pull's cachedState was captured BEFORE
    // saveStateToIDB completed, leaving existing.orderItems = [] in the snapshot.
    // The server also returns orderItems = [] (PATCH not yet processed).
    // Without the fix, _preparePullRecordsForIDB would return incoming (stale empty),
    // and upsertRecordsIntoIDB would overwrite the real IDB state (with the new items).
    _registerPushedEchoes([{ collection: 'orders', recordId: 'ord_echo' }], 5000);
    const emptyOrder = {
      id: 'ord_echo',
      date_updated: TS0,
      orderItems: [], // stale cachedState — items were added AFTER this snapshot
      totalAmount: 0,
      total_amount: 0,
      itemCount: 0,
      item_count: 0,
    };
    const incomingFromServer = {
      id: 'ord_echo',
      date_updated: TS0,
      orderItems: [{ id: 'oi_1', quantity: 2 }], // non-empty — a *different* scenario
      totalAmount: 10,
      total_amount: 10,
      itemCount: 1,
      item_count: 1,
    };
    const state = { orders: [emptyOrder] };

    const { records } = await _preparePullRecordsForIDB('orders', [incomingFromServer], state);

    // The record should be excluded from the write batch (null filtered out) so that
    // the real IDB state (which may have items not visible in cachedState) is preserved.
    expect(records).toHaveLength(0);
  });

  it('allows cross-device update through even when cachedState has empty orderItems', async () => {
    // If another device made a strictly-newer update during our echo window, it must
    // not be blocked even when cachedState is stale with empty items.
    _registerPushedEchoes([{ collection: 'orders', recordId: 'ord_echo' }], 5000);
    const emptyOrder = {
      id: 'ord_echo',
      date_updated: TS0,
      orderItems: [],
    };
    const crossDeviceIncoming = {
      id: 'ord_echo',
      date_updated: TS1, // strictly newer → cross-device update
      orderItems: [{ id: 'oi_2', quantity: 1 }],
      totalAmount: 5,
      total_amount: 5,
      itemCount: 1,
      item_count: 1,
    };
    const state = { orders: [emptyOrder] };

    const { records } = await _preparePullRecordsForIDB('orders', [crossDeviceIncoming], state);

    // Cross-device update is strictly newer → must win even during echo window.
    expect(records).toHaveLength(1);
    expect(records[0].orderItems[0].id).toBe('oi_2');
    expect(records[0].totalAmount).toBe(5);
  });

  it('returns input unchanged when state snapshot is null (bill_sessions path)', async () => {
    // bill_sessions is handled by its own branch; passing state=null forces the early
    // return and asserts the reference is preserved (no extra allocation).
    const records = [{ id: 'bs_1', opened_at: '2024-01-01T00:00:00.000Z' }];
    const { records: out } = await _preparePullRecordsForIDB('bill_sessions', records, null);
    expect(out).toBe(records);
  });
});
