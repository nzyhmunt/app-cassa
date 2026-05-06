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

import { describe, it, expect, beforeEach } from 'vitest';
import { _resetIDBSingleton } from '../../useIDB.js';
import { _atomicOrderItemsUpsertAndMerge } from '../idbOperations.js';

beforeEach(async () => {
  await _resetIDBSingleton();
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

// ── _preparePullRecordsForIDB — IDB order_items lookup for new orders ─────────

import { vi } from 'vitest';
import { _preparePullRecordsForIDB } from '../idbOperations.js';

describe('_preparePullRecordsForIDB — new-order IDB item lookup', () => {
  it('populates orderItems from IDB for a new order whose items were already pulled', async () => {
    const { getDB } = await import('../../useIDB.js');
    const db = await getDB();

    // Seed the order_items store as if a prior pull cycle already fetched the item.
    const storedItem = {
      id: 'oi_seed',
      order: 'ord_new',
      orderId: 'ord_new',
      name: 'Pizza',
      quantity: 1,
      unitPrice: 8,
      modifiers: [],
      date_updated: '2024-06-01T00:00:00.000Z',
    };
    await db.put('order_items', storedItem);

    // Simulate an orders REST response where order_items are returned as string IDs.
    const incomingOrder = {
      id: 'ord_new',
      status: 'accepted',
      table: '03',
      // Raw string IDs from the API (field expansion not honoured by the server).
      order_items: ['oi_seed'],
      // After mapOrderFromDirectus, string IDs are filtered out → empty array.
      orderItems: [],
      date_updated: '2024-06-01T00:00:00.000Z',
    };

    // null state = no existing orders in IDB (fresh/incremental scenario).
    const { records } = await _preparePullRecordsForIDB('orders', [incomingOrder], null);

    expect(records).toHaveLength(1);
    expect(records[0].orderItems).toHaveLength(1);
    expect(records[0].orderItems[0].id).toBe('oi_seed');
    expect(records[0].orderItems[0].name).toBe('Pizza');
  });

  it('leaves orderItems empty when the order_items IDB store has no matching records', async () => {
    const incomingOrder = {
      id: 'ord_fresh',
      status: 'pending',
      table: '01',
      order_items: ['oi_missing'],
      orderItems: [],
      date_updated: null,
    };

    const { records } = await _preparePullRecordsForIDB('orders', [incomingOrder], null);

    expect(records).toHaveLength(1);
    expect(records[0].orderItems).toEqual([]);
  });

  it('preserves existing orderItems for a known order even when order_items are string IDs', async () => {
    const existingOrderItems = [{ id: 'oi_x', name: 'Gelato', quantity: 2 }];
    const state = {
      orders: [{
        id: 'ord_known',
        status: 'pending',
        orderItems: existingOrderItems,
        date_updated: '2024-01-01T00:00:00.000Z',
      }],
      tableCurrentBillSession: {},
    };

    const incomingOrder = {
      id: 'ord_known',
      status: 'accepted',
      order_items: ['oi_x'],
      orderItems: [],
      date_updated: '2024-06-01T00:00:00.000Z',
    };

    const { records } = await _preparePullRecordsForIDB('orders', [incomingOrder], state);

    expect(records).toHaveLength(1);
    // Known order — items must be restored from state, not from IDB lookup.
    expect(records[0].orderItems).toEqual(existingOrderItems);
    expect(records[0].status).toBe('accepted');
  });

  it('does not open a DB connection when the incoming order has no string IDs in order_items', async () => {
    const getDBModule = await import('../../useIDB.js');
    const getDBSpy = vi.spyOn(getDBModule, 'getDB');

    const incomingOrder = {
      id: 'ord_no_items',
      status: 'pending',
      table: '07',
      order_items: [],
      orderItems: [],
      date_updated: null,
    };

    const { records } = await _preparePullRecordsForIDB('orders', [incomingOrder], null);

    expect(records[0].orderItems).toEqual([]);
    // getDB should NOT be called when there are no string IDs to look up.
    expect(getDBSpy).not.toHaveBeenCalled();
  });
});
