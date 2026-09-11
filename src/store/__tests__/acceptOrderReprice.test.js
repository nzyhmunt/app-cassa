/**
 * @file acceptOrderReprice.test.js
 * @description Unit tests for the price-recompute-on-accept boundary.
 *
 * The self-order client builds its order payload using menu-trusted prices, but
 * a tampered client can POST directly to Directus with a forged `unit_price`.
 * `acceptOrderWithReprice` recomputes every unit_price/modifier price from the
 * menu of record (IDB menu_items first, then the public menu.json) and persists
 * the authoritative prices to IDB + Directus before flipping the order to
 * 'accepted'. Orders referencing dishes NOT in the menu are blocked.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { _resetIDBSingleton, getDB } from '../../composables/useIDB.js';
import { initStoreFromIDB, useOrderStore } from '../index.js';
import { _resetListeners } from '../persistence/eventBus.js';

function flushIDB(rounds = 3) {
  return Array.from({ length: rounds }).reduce(
    (p) => p.then(() => new Promise((r) => setImmediate(r))),
    Promise.resolve(),
  );
}

function makeOrder({ id = 'ord_1', table = 'T1', items = [] } = {}) {
  return {
    id,
    table,
    billSessionId: `sess_${id}`,
    status: 'pending',
    time: '12:00',
    total_amount: 0,
    totalAmount: 0,
    item_count: 0,
    itemCount: 0,
    globalNote: '',
    noteVisibility: { cassa: true, sala: true, cucina: true },
    dietaryPreferences: {},
    orderItems: items,
    isDirectEntry: false,
  };
}

beforeEach(async () => {
  await _resetIDBSingleton();
  _resetListeners();
  setActivePinia(createPinia());
  // No network menu fetch should be needed — IDB is seeded with menu_items.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await flushIDB();
  _resetListeners();
  await _resetIDBSingleton();
});

async function seedMenuItems(items) {
  const db = await getDB();
  await Promise.all(items.map((it) => db.put('menu_items', it)));
}

async function seedMenuModifiers(modifiers) {
  const db = await getDB();
  await Promise.all(modifiers.map((m) => db.put('menu_modifiers', m)));
}

describe('repriceOrderFromMenu — IDB menu source', () => {
  it('overwrites a forged unit_price with the menu price', async () => {
    await seedMenuItems([
      { id: 'ant_1', name: 'Bruschetta', price: 3 },
      { id: 'pri_1', name: 'Pasta', price: 12 },
    ]);
    const store = useOrderStore();
    await initStoreFromIDB();

    const order = makeOrder({
      items: [
        // Forged price (0) — must be overwritten with the menu price (3).
        { uid: 'r_1', dishId: 'ant_1', dish: 'ant_1', name: 'Bruschetta', unitPrice: 0, unit_price: 0, quantity: 2, voidedQuantity: 0, notes: [], modifiers: [] },
        { uid: 'r_2', dishId: 'pri_1', dish: 'pri_1', name: 'Pasta', unitPrice: 99, unit_price: 99, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
      ],
    });
    await store.addOrder(order);

    const result = await store.repriceOrderFromMenu(order);
    expect(result.repriced).toBe(true);
    expect(result.source).toBe('idb');
    expect(order.orderItems[0].unitPrice).toBe(3);
    expect(order.orderItems[0].unit_price).toBe(3);
    expect(order.orderItems[1].unitPrice).toBe(12);
    // Totals recomputed: 3*2 + 12*1 = 18
    expect(order.totalAmount).toBe(18);
  });

  it('reprices modifier prices from the menu, ignoring forged values', async () => {
    await seedMenuItems([{ id: 'pri_1', name: 'Pasta', price: 12 }]);
    await seedMenuModifiers([{ id: 'mod_1', name: 'Extra', price: 1.5 }]);
    const store = useOrderStore();
    await initStoreFromIDB();

    const order = makeOrder({
      items: [
        {
          uid: 'r_1', dishId: 'pri_1', dish: 'pri_1', name: 'Pasta',
          unitPrice: 12, unit_price: 12, quantity: 1, voidedQuantity: 0, notes: [],
          modifiers: [{ id: 'mod_1', name: 'Extra', price: 0 }],
        },
      ],
    });
    await store.addOrder(order);

    const result = await store.repriceOrderFromMenu(order);
    expect(result.repriced).toBe(true);
    expect(order.orderItems[0].modifiers[0].price).toBe(1.5);
    // 12 + 1.5 = 13.5
    expect(order.totalAmount).toBe(13.5);
  });

  it('reports unresolved dishes present in the order but not in the menu', async () => {
    await seedMenuItems([{ id: 'ant_1', name: 'Bruschetta', price: 3 }]);
    const store = useOrderStore();
    await initStoreFromIDB();

    const order = makeOrder({
      items: [
        { uid: 'r_1', dishId: 'ant_1', dish: 'ant_1', name: 'Bruschetta', unitPrice: 3, unit_price: 3, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
        // Unknown dish — a tampered payload with a fake id.
        { uid: 'r_2', dishId: 'fake_dish', dish: 'fake_dish', name: 'Free', unitPrice: 0, unit_price: 0, quantity: 9, voidedQuantity: 0, notes: [], modifiers: [] },
      ],
    });
    await store.addOrder(order);

    const result = await store.repriceOrderFromMenu(order);
    expect(result.unresolvedDishes).toEqual(['fake_dish']);
  });

  it('returns source "none" and skips repricing when no menu is available', async () => {
    // No menu_items seeded, and fetch is stubbed to fail — no authoritative source.
    const store = useOrderStore();
    await initStoreFromIDB();

    const order = makeOrder({
      items: [
        { uid: 'r_1', dishId: 'ant_1', dish: 'ant_1', name: 'Bruschetta', unitPrice: 0, unit_price: 0, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
      ],
    });
    await store.addOrder(order);

    const result = await store.repriceOrderFromMenu(order);
    expect(result.source).toBe('none');
    expect(result.repriced).toBe(false);
    // Price left untouched because there was nothing to recompute from.
    expect(order.orderItems[0].unitPrice).toBe(0);
  });
});

describe('repriceOrderFromMenu — menu.json fallback source', () => {
  it('falls back to the public menu.json when IDB has no menu_items', async () => {
    // No menu_items in IDB; fetch returns the flat nanawork menu shape.
    const menuJson = {
      Antipasti: [{ id: 'ant_1', name: 'Bruschetta', price: 3, modifiers: [{ id: 'mod_1', name: 'Extra', price: 1 }] }],
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => menuJson,
    })));
    const store = useOrderStore();
    await initStoreFromIDB();

    const order = makeOrder({
      items: [
        {
          uid: 'r_1', dishId: 'ant_1', dish: 'ant_1', name: 'Bruschetta',
          unitPrice: 0, unit_price: 0, quantity: 1, voidedQuantity: 0, notes: [],
          modifiers: [{ id: 'mod_1', name: 'Extra', price: 0 }],
        },
      ],
    });
    await store.addOrder(order);

    const result = await store.repriceOrderFromMenu(order);
    expect(result.source).toBe('json');
    expect(result.repriced).toBe(true);
    expect(order.orderItems[0].unitPrice).toBe(3);
    expect(order.orderItems[0].modifiers[0].price).toBe(1);
    expect(order.totalAmount).toBe(4);
  });

  it('handles the wrapped menu shape { categories, items: { Cat: [...] } }', async () => {
    // No menu_items in IDB; fetch returns the WRAPPED shape used elsewhere in
    // the self-order codebase, where `items` is an OBJECT keyed by category
    // (not an array). The previous implementation rejected this shape and
    // silently fell back to source='none'.
    const wrappedMenu = {
      categories: [{ name: 'Antipasti' }],
      items: {
        Antipasti: [{ id: 'ant_1', name: 'Bruschetta', price: 3, modifiers: [{ id: 'mod_1', name: 'Extra', price: 1 }] }],
      },
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => wrappedMenu,
    })));
    const store = useOrderStore();
    await initStoreFromIDB();

    const order = makeOrder({
      items: [
        {
          uid: 'r_1', dishId: 'ant_1', dish: 'ant_1', name: 'Bruschetta',
          unitPrice: 0, unit_price: 0, quantity: 1, voidedQuantity: 0, notes: [],
          modifiers: [{ id: 'mod_1', name: 'Extra', price: 0 }],
        },
      ],
    });
    await store.addOrder(order);

    const result = await store.repriceOrderFromMenu(order);
    // Must resolve the authoritative price from the wrapped items object,
    // NOT silently fall back to source='none'.
    expect(result.source).toBe('json');
    expect(result.repriced).toBe(true);
    expect(order.orderItems[0].unitPrice).toBe(3);
    expect(order.orderItems[0].modifiers[0].price).toBe(1);
    expect(order.totalAmount).toBe(4);
  });
});

describe('acceptOrderWithReprice — full accept flow', () => {
  it('reprices, persists, and flips status to accepted', async () => {
    await seedMenuItems([{ id: 'ant_1', name: 'Bruschetta', price: 3 }]);
    const store = useOrderStore();
    await initStoreFromIDB();

    const order = makeOrder({
      items: [
        { uid: 'r_1', dishId: 'ant_1', dish: 'ant_1', name: 'Bruschetta', unitPrice: 0, unit_price: 0, quantity: 2, voidedQuantity: 0, notes: [], modifiers: [] },
      ],
    });
    await store.addOrder(order);

    const result = await store.acceptOrderWithReprice(order);
    expect(result.ok).toBe(true);

    const accepted = store.orders.find((o) => o.id === 'ord_1');
    expect(accepted.status).toBe('accepted');
    // Price corrected and persisted in reactive state.
    expect(accepted.orderItems[0].unitPrice).toBe(3);
    expect(accepted.totalAmount).toBe(6);
  });

  it('blocks acceptance when the order references unknown dishes', async () => {
    await seedMenuItems([{ id: 'ant_1', name: 'Bruschetta', price: 3 }]);
    const store = useOrderStore();
    await initStoreFromIDB();

    const order = makeOrder({
      items: [
        { uid: 'r_1', dishId: 'ant_1', dish: 'ant_1', name: 'Bruschetta', unitPrice: 3, unit_price: 3, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
        { uid: 'r_2', dishId: 'fake_dish', dish: 'fake_dish', name: 'Free', unitPrice: 0, unit_price: 0, quantity: 9, voidedQuantity: 0, notes: [], modifiers: [] },
      ],
    });
    await store.addOrder(order);

    const result = await store.acceptOrderWithReprice(order);
    expect(result.ok).toBe(false);
    expect(result.unresolvedDishes).toEqual(['fake_dish']);
    // Status must remain pending — the order was NOT sent to the kitchen.
    const stillPending = store.orders.find((o) => o.id === 'ord_1');
    expect(stillPending.status).toBe('pending');
  });

  it('accepts as-is when no menu source is available (source none)', async () => {
    const store = useOrderStore();
    await initStoreFromIDB();

    const order = makeOrder({
      items: [
        { uid: 'r_1', dishId: 'ant_1', dish: 'ant_1', name: 'Bruschetta', unitPrice: 5, unit_price: 5, quantity: 2, voidedQuantity: 0, notes: [], modifiers: [] },
      ],
    });
    await store.addOrder(order);

    const result = await store.acceptOrderWithReprice(order);
    expect(result.ok).toBe(true);
    expect(result.source).toBe('none');
    // Prices left as-is (no authoritative source), status still flips.
    const accepted = store.orders.find((o) => o.id === 'ord_1');
    expect(accepted.status).toBe('accepted');
    expect(accepted.orderItems[0].unitPrice).toBe(5);
  });
});
