/**
 * @file orderTotalModifiers.test.js
 *
 * Regression tests for the bug where `tableTotalAmount` (and each order's
 * `totalAmount`) did NOT include paid modifier (variant) prices after an app
 * reload or after a Directus sync refresh.
 *
 * Root cause: `mapOrderFromDirectus` reads `total_amount ?? totalAmount`
 * (snake_case first). After the first `mapOrderFromDirectus` call the order
 * gains a `total_amount` field. Subsequent `updateOrderTotals` calls only
 * update the camelCase `totalAmount`, leaving `total_amount` stale. On the
 * next reload `mapOrderFromDirectus` picks up the stale `total_amount` and
 * modifier prices are silently dropped.
 *
 * Fix: after loading orders from IDB (both at startup via `initStoreFromIDB`
 * and during sync-refresh via `refreshOperationalStateFromIDB`), call
 * `updateOrderTotals` to recompute totals from `orderItems`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { _resetIDBSingleton } from '../../composables/useIDB.js';
import { saveStateToIDB } from '../idbPersistence.js';
import { initStoreFromIDB, useOrderStore } from '../index.js';

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds an order object that simulates what is stored in IDB after the
 * following sequence:
 *   1. Order created (items without modifiers) → total_amount saved = baseTotal
 *   2. User adds a paid modifier via the note modal → updateOrderTotals updates
 *      `totalAmount` (camelCase) but NOT `total_amount` (snake_case)
 *   3. Debounced IDB save persists the object with the stale `total_amount`
 *
 * The stale `total_amount` represents the bug state; the correct total
 * (including modifier prices) is derivable from `orderItems`.
 */
function makeOrderWithStaleTotal({
  id = 'ord_1',
  table = 'T1',
  billSessionId = 'sess_1',
  status = 'accepted',
  unitPrice = 8,
  quantity = 2,
  modifierPrice = 1.5,
} = {}) {
  // totalWithoutMod = unitPrice * quantity (stale, without modifier)
  const staleTotal = unitPrice * quantity;
  // Correct total = (unitPrice + modifierPrice) * quantity
  const correctTotal = (unitPrice + modifierPrice) * quantity;

  return {
    id,
    table,
    billSessionId,
    status,
    time: '12:00',
    // Stale snake_case field (set by a previous mapOrderFromDirectus call,
    // NOT updated by updateOrderTotals).
    total_amount: staleTotal,
    // Correct camelCase field (set by updateOrderTotals after modifier was added).
    totalAmount: correctTotal,
    item_count: quantity,
    itemCount: quantity,
    globalNote: '',
    noteVisibility: { cassa: true, sala: true, cucina: true },
    dietaryPreferences: {},
    orderItems: [
      {
        uid: 'item_1',
        dishId: 'd1',
        name: 'Pasta',
        unitPrice,
        quantity,
        voidedQuantity: 0,
        notes: [],
        // Paid modifier added by the user via the note/variant modal.
        modifiers: [{ name: 'Extra', price: modifierPrice }],
      },
    ],
    isDirectEntry: false,
  };
}

// ── setup ─────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  await _resetIDBSingleton();
  setActivePinia(createPinia());
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── initStoreFromIDB ──────────────────────────────────────────────────────────

describe('initStoreFromIDB — paid modifiers survive reload', () => {
  it('recomputes totalAmount from orderItems, ignoring stale total_amount', async () => {
    const order = makeOrderWithStaleTotal();
    // stale total_amount = 16, correct total (with modifier) = 19
    expect(order.total_amount).toBe(16);
    expect(order.totalAmount).toBe(19);

    await saveStateToIDB({ orders: [order] });

    const pinia = createPinia();
    setActivePinia(pinia);
    await initStoreFromIDB(pinia);

    const store = useOrderStore(pinia);
    expect(store.orders).toHaveLength(1);
    // After reload the total must include the modifier price (1.5 × 2 = 3).
    expect(store.orders[0].totalAmount).toBeCloseTo(19, 5);
  });

  it('sets totalAmount = 0 for an order with no active items', async () => {
    const order = {
      id: 'ord_empty',
      table: 'T2',
      billSessionId: 'sess_2',
      status: 'accepted',
      time: '12:00',
      total_amount: 42,   // stale
      totalAmount: 42,
      item_count: 0,
      itemCount: 0,
      globalNote: '',
      noteVisibility: { cassa: true, sala: true, cucina: true },
      dietaryPreferences: {},
      orderItems: [],
      isDirectEntry: false,
    };

    await saveStateToIDB({ orders: [order] });

    const pinia = createPinia();
    setActivePinia(pinia);
    await initStoreFromIDB(pinia);

    const store = useOrderStore(pinia);
    expect(store.orders).toHaveLength(1);
    expect(store.orders[0].totalAmount).toBe(0);
  });

  it('correctly handles multiple orders, some with and some without modifiers', async () => {
    const orderWithMod = makeOrderWithStaleTotal({ id: 'ord_mod', table: 'T1' });
    const orderWithoutMod = {
      id: 'ord_plain',
      table: 'T2',
      billSessionId: 'sess_2',
      status: 'accepted',
      time: '12:00',
      total_amount: 20,
      totalAmount: 20,
      item_count: 2,
      itemCount: 2,
      globalNote: '',
      noteVisibility: { cassa: true, sala: true, cucina: true },
      dietaryPreferences: {},
      orderItems: [
        { uid: 'p1', dishId: 'd2', name: 'Insalata', unitPrice: 10, quantity: 2, voidedQuantity: 0, notes: [], modifiers: [] },
      ],
      isDirectEntry: false,
    };

    await saveStateToIDB({ orders: [orderWithMod, orderWithoutMod] });

    const pinia = createPinia();
    setActivePinia(pinia);
    await initStoreFromIDB(pinia);

    const store = useOrderStore(pinia);
    const loaded = store.orders;
    const mod = loaded.find(o => o.id === 'ord_mod');
    const plain = loaded.find(o => o.id === 'ord_plain');

    // mod: unitPrice=8, qty=2, modifierPrice=1.5 → (8+1.5)*2 = 19
    expect(mod.totalAmount).toBeCloseTo(19, 5);
    // plain: unitPrice=10, qty=2 → 20 (unchanged)
    expect(plain.totalAmount).toBeCloseTo(20, 5);
  });
});

// ── refreshOperationalStateFromIDB ───────────────────────────────────────────

describe('refreshOperationalStateFromIDB — paid modifiers survive sync refresh', () => {
  it('recomputes totalAmount from orderItems after Directus sync overwrites total_amount', async () => {
    const order = makeOrderWithStaleTotal();
    // Simulate IDB state after Directus sync: total_amount = server value
    // (not including modifier prices), but orderItems preserved locally.
    await saveStateToIDB({ orders: [order] });

    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useOrderStore(pinia);

    await store.refreshOperationalStateFromIDB({ collection: 'orders' });

    expect(store.orders).toHaveLength(1);
    expect(store.orders[0].totalAmount).toBeCloseTo(19, 5);
  });

  it('handles an order with a voided modifier correctly', async () => {
    // active modifier qty = quantity - voidedQuantity = 2 - 1 = 1
    // totalAmount = 8*2 + 1.5*1 = 17.5
    const order = {
      id: 'ord_voided_mod',
      table: 'T3',
      billSessionId: 'sess_3',
      status: 'accepted',
      time: '12:00',
      total_amount: 16, // stale
      totalAmount: 16,
      item_count: 2,
      itemCount: 2,
      globalNote: '',
      noteVisibility: { cassa: true, sala: true, cucina: true },
      dietaryPreferences: {},
      orderItems: [
        {
          uid: 'item_v',
          dishId: 'd3',
          name: 'Pizza',
          unitPrice: 8,
          quantity: 2,
          voidedQuantity: 0,
          notes: [],
          modifiers: [{ name: 'Extra', price: 1.5, voidedQuantity: 1 }],
        },
      ],
      isDirectEntry: false,
    };

    await saveStateToIDB({ orders: [order] });

    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useOrderStore(pinia);

    await store.refreshOperationalStateFromIDB({ collection: 'orders' });

    expect(store.orders).toHaveLength(1);
    // active items = 2, active modifier qty = 2 - 1 = 1
    // total = 8*2 + 1.5*1 = 17.5
    expect(store.orders[0].totalAmount).toBeCloseTo(17.5, 5);
  });

  it('does not affect non-order collections', async () => {
    await saveStateToIDB({
      orders: [],
      cashBalance: 42.5,
    });

    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useOrderStore(pinia);

    await store.refreshOperationalStateFromIDB({ collection: 'cashBalance' });

    expect(store.cashBalance).toBe(42.5);
  });
});
