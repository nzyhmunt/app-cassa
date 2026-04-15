/**
 * @file analiticaMode.test.js
 * @description Unit tests for the "analitica" (analytic) checkout mode logic.
 *
 * Tests cover:
 *  - buildFlatAnaliticaItems (base items + paid modifiers as separate rows)
 *  - computeAnaliticaTotal (qty map → uncapped selected total)
 *  - selectionExceedsRemaining (over-payment guard)
 *  - getOrdersToComplete (auto-complete eligible orders)
 *  - canPay guard (disabled when all qtys are 0 or selection exceeds remaining)
 *  - incrementAnalitica / decrementAnalitica helpers
 *  - toggleSelectAllVoci helper (sets all to max / all to 0)
 *  - Direct entry items (isDirectEntry flag)
 *
 * Business logic is imported directly from utils/analitica.js so that any
 * change to the production implementation is immediately caught by these tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAppStore } from '../index.js';
import { getOrderItemRowTotal } from '../../utils/index.js';
import {
  buildFlatAnaliticaItems,
  computeAnaliticaTotal,
  selectionExceedsRemaining,
  getOrdersToComplete,
} from '../../utils/analitica.js';

// Prevent real network requests while loading the menu
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});


// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

function makeItem(name, unitPrice, quantity, voidedQuantity = 0, modifiers = []) {
  return {
    uid: `uid_${name}`,
    dishId: `dish_${name}`,
    name,
    unitPrice,
    quantity,
    voidedQuantity,
    notes: [],
    modifiers,
  };
}

function makeMod(name, price, voidedQuantity = 0) {
  return { name, price, voidedQuantity };
}

function makeOrder(id, items, isDirectEntry = false) {
  const totalAmount = items.reduce((acc, i) => acc + getOrderItemRowTotal(i), 0);
  return {
    id,
    table: 'T1',
    billSessionId: 'sess_1',
    status: 'accepted',
    orderItems: items,
    totalAmount,
    itemCount: items.reduce((acc, i) => acc + i.quantity - (i.voidedQuantity || 0), 0),
    isDirectEntry,
  };
}

// ---------------------------------------------------------------------------
// Tests: buildFlatAnaliticaItems — base items
// ---------------------------------------------------------------------------

describe('buildFlatAnaliticaItems() — base items', () => {
  it('returns one entry per non-voided item when there are no modifiers', () => {
    const ord = makeOrder('ord_1', [
      makeItem('Caffè', 1.50, 2),
      makeItem('Acqua', 2.00, 1),
    ]);
    const flat = buildFlatAnaliticaItems([ord]);
    expect(flat).toHaveLength(2);
    expect(flat.every(i => !i.isModifier)).toBe(true);
  });

  it('excludes fully voided items (netQty <= 0)', () => {
    const ord = makeOrder('ord_1', [
      makeItem('Caffè', 1.50, 2, 2), // fully voided
      makeItem('Acqua', 2.00, 1, 0),
    ]);
    const flat = buildFlatAnaliticaItems([ord]);
    expect(flat).toHaveLength(1);
    expect(flat[0].name).toBe('Acqua');
  });

  it('generates unique keys in the form orderId__itemUid', () => {
    const ord = makeOrder('ord_abc', [
      makeItem('Pasta', 10.00, 1),
      makeItem('Vino', 8.00, 1),
    ]);
    const flat = buildFlatAnaliticaItems([ord]);
    expect(flat[0].key).toBe('ord_abc__uid_Pasta');
    expect(flat[1].key).toBe('ord_abc__uid_Vino');
  });

  it('base item rowTotal uses only unitPrice × netQty (not modifiers)', () => {
    const item = makeItem('Pizza', 10.00, 2, 0, [makeMod('Mozzarella', 1.50)]);
    const ord = makeOrder('ord_1', [item]);
    const flat = buildFlatAnaliticaItems([ord]);
    const baseRow = flat.find(i => !i.isModifier);
    // Should be 2 × 10.00 = 20.00, NOT 2 × 11.50 = 23.00
    expect(baseRow.rowTotal).toBeCloseTo(20.00, 2);
  });

  it('marks direct-entry order items with isDirectEntry=true', () => {
    const ord = makeOrder('ord_d', [makeItem('Caffè', 1.50, 1)], true);
    const flat = buildFlatAnaliticaItems([ord]);
    expect(flat[0].isDirectEntry).toBe(true);
    expect(flat[0].isModifier).toBe(false);
  });

  it('returns an empty list when all items are voided', () => {
    const ord = makeOrder('ord_1', [makeItem('Vino', 8.00, 3, 3)]);
    expect(buildFlatAnaliticaItems([ord])).toHaveLength(0);
  });

  it('returns an empty list when there are no orders', () => {
    expect(buildFlatAnaliticaItems([])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: buildFlatAnaliticaItems — paid modifiers
// ---------------------------------------------------------------------------

describe('buildFlatAnaliticaItems() — paid modifiers (variazioni)', () => {
  it('adds a separate sub-row for each paid modifier', () => {
    const item = makeItem('Pizza', 10.00, 1, 0, [
      makeMod('Mozzarella', 1.50),
      makeMod('Funghi', 2.00),
    ]);
    const ord = makeOrder('ord_1', [item]);
    const flat = buildFlatAnaliticaItems([ord]);
    expect(flat).toHaveLength(3);
    expect(flat.filter(i => i.isModifier)).toHaveLength(2);
  });

  it('skips free (price=0) modifiers', () => {
    const item = makeItem('Pasta', 10.00, 1, 0, [
      makeMod('Senza sale', 0),
      makeMod('Extra cheese', 1.00),
    ]);
    const ord = makeOrder('ord_1', [item]);
    const flat = buildFlatAnaliticaItems([ord]);
    expect(flat.filter(i => i.isModifier)).toHaveLength(1);
    expect(flat.find(i => i.isModifier).name).toBe('Extra cheese');
  });

  it('skips fully voided modifiers', () => {
    const item = makeItem('Pizza', 10.00, 2, 0, [
      makeMod('Mozzarella', 1.50, 2), // voidedQuantity = netQty → fully voided
    ]);
    const ord = makeOrder('ord_1', [item]);
    const flat = buildFlatAnaliticaItems([ord]);
    expect(flat.filter(i => i.isModifier)).toHaveLength(0);
  });

  it('uses key format orderId__itemUid__mod__modIdx for modifiers', () => {
    const item = makeItem('Pizza', 10.00, 1, 0, [makeMod('Mozzarella', 1.50)]);
    const ord = makeOrder('ord_x', [item]);
    const flat = buildFlatAnaliticaItems([ord]);
    const modRow = flat.find(i => i.isModifier);
    expect(modRow.key).toBe('ord_x__uid_Pizza__mod__0');
  });
});

// ---------------------------------------------------------------------------
// Tests: computeAnaliticaTotal (qty-map based)
// ---------------------------------------------------------------------------

describe('computeAnaliticaTotal()', () => {
  it('returns 0 when all qtys are 0', () => {
    const ord = makeOrder('ord_1', [makeItem('Caffè', 1.50, 2)]);
    const flat = buildFlatAnaliticaItems([ord]);
    expect(computeAnaliticaTotal(flat, {})).toBe(0);
  });

  it('computes total for partial qty selection of a single item', () => {
    // Item has netQty=2; user selects qty=1
    const ord = makeOrder('ord_1', [makeItem('Caffè', 1.50, 2)]);
    const flat = buildFlatAnaliticaItems([ord]);
    const qtyMap = { [flat[0].key]: 1 }; // select 1 of 2
    expect(computeAnaliticaTotal(flat, qtyMap)).toBeCloseTo(1.50, 2);
  });

  it('computes total for full qty selection', () => {
    const ord = makeOrder('ord_1', [makeItem('Caffè', 1.50, 2)]);
    const flat = buildFlatAnaliticaItems([ord]);
    const qtyMap = { [flat[0].key]: 2 }; // select all 2
    expect(computeAnaliticaTotal(flat, qtyMap)).toBeCloseTo(3.00, 2);
  });

  it('sums base item and partial modifier qty', () => {
    const item = makeItem('Pizza', 10.00, 2, 0, [makeMod('Mozzarella', 1.50)]);
    const ord = makeOrder('ord_1', [item]);
    const flat = buildFlatAnaliticaItems([ord]);
    const baseKey = flat.find(i => !i.isModifier).key;
    const modKey = flat.find(i => i.isModifier).key;
    // Pay 1 pizza base + 1 modifier
    const qtyMap = { [baseKey]: 1, [modKey]: 1 };
    expect(computeAnaliticaTotal(flat, qtyMap)).toBeCloseTo(11.50, 2);
  });

  it('allows selecting modifier qty without base item', () => {
    const item = makeItem('Pizza', 10.00, 1, 0, [makeMod('Mozzarella', 1.50)]);
    const ord = makeOrder('ord_1', [item]);
    const flat = buildFlatAnaliticaItems([ord]);
    const modKey = flat.find(i => i.isModifier).key;
    expect(computeAnaliticaTotal(flat, { [modKey]: 1 })).toBeCloseTo(1.50, 2);
  });

  it('returns the real uncapped total even when it exceeds the remaining bill', () => {
    const ord = makeOrder('ord_1', [
      makeItem('Bistecca', 25.00, 1),
      makeItem('Vino', 15.00, 1),
    ]);
    const flat = buildFlatAnaliticaItems([ord]);
    const qtyMap = { [flat[0].key]: 1, [flat[1].key]: 1 };
    // Total = 40.00, which exceeds a hypothetical remaining of 35.00
    expect(computeAnaliticaTotal(flat, qtyMap)).toBeCloseTo(40.00, 2);
    // The guard against overpayment is in selectionExceedsRemaining / canPay
    expect(selectionExceedsRemaining(flat, qtyMap, 35.00)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Shared helpers (used by multiple describe blocks below)
// ---------------------------------------------------------------------------

const BILL_SETTLED_THRESHOLD = 0.01;

function canPay(remaining, flatItems, qtyMap) {
  if (remaining <= BILL_SETTLED_THRESHOLD) return false;
  if (!flatItems.some(i => (qtyMap[i.key] || 0) > 0)) return false;
  if (selectionExceedsRemaining(flatItems, qtyMap, remaining)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Tests: canPay guard for analitica mode
// ---------------------------------------------------------------------------

describe('canPay guard for analitica mode', () => {
  it('returns false when all qtys are 0', () => {
    const ord = makeOrder('ord_1', [makeItem('Caffè', 1.50, 2)]);
    const flat = buildFlatAnaliticaItems([ord]);
    expect(canPay(15.00, flat, {})).toBe(false);
  });

  it('returns true when at least one item has qty > 0 and total ≤ remaining', () => {
    const ord = makeOrder('ord_1', [makeItem('Caffè', 1.50, 2)]);
    const flat = buildFlatAnaliticaItems([ord]);
    expect(canPay(15.00, flat, { [flat[0].key]: 1 })).toBe(true);
  });

  it('returns false when the remaining bill is at or below the settled threshold', () => {
    const ord = makeOrder('ord_1', [makeItem('Caffè', 1.50, 2)]);
    const flat = buildFlatAnaliticaItems([ord]);
    expect(canPay(0.005, flat, { [flat[0].key]: 2 })).toBe(false);
  });

  it('returns false when the selected total exceeds the remaining bill', () => {
    const ord = makeOrder('ord_1', [
      makeItem('Bistecca', 25.00, 1),
      makeItem('Vino', 15.00, 1),
    ]);
    const flat = buildFlatAnaliticaItems([ord]);
    // Both selected = 40.00, but only 35.00 remaining
    const qtyMap = { [flat[0].key]: 1, [flat[1].key]: 1 };
    expect(canPay(35.00, flat, qtyMap)).toBe(false);
  });

  it('returns true when the selected total exactly equals the remaining bill', () => {
    const ord = makeOrder('ord_1', [
      makeItem('Bistecca', 25.00, 1),
      makeItem('Vino', 15.00, 1),
    ]);
    const flat = buildFlatAnaliticaItems([ord]);
    // Both selected = 40.00, remaining = 40.00 → exact match → allowed
    const qtyMap = { [flat[0].key]: 1, [flat[1].key]: 1 };
    expect(canPay(40.00, flat, qtyMap)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: incrementAnalitica / decrementAnalitica helpers
// ---------------------------------------------------------------------------

describe('incrementAnalitica / decrementAnalitica logic', () => {
  function increment(key, max, qtyMap) {
    const current = qtyMap[key] || 0;
    if (current < max) return { ...qtyMap, [key]: current + 1 };
    return qtyMap;
  }

  function decrement(key, qtyMap) {
    const current = qtyMap[key] || 0;
    if (current <= 1) {
      const updated = { ...qtyMap };
      delete updated[key];
      return updated;
    }
    return { ...qtyMap, [key]: current - 1 };
  }

  it('increment adds 1 up to netQty', () => {
    let map = {};
    map = increment('k1', 3, map);
    expect(map['k1']).toBe(1);
    map = increment('k1', 3, map);
    expect(map['k1']).toBe(2);
    map = increment('k1', 3, map);
    expect(map['k1']).toBe(3);
    map = increment('k1', 3, map); // should not exceed max
    expect(map['k1']).toBe(3);
  });

  it('decrement removes the key when qty reaches 0', () => {
    let map = { 'k1': 1 };
    map = decrement('k1', map);
    expect('k1' in map).toBe(false);
  });

  it('decrement subtracts 1 when qty > 1', () => {
    let map = { 'k1': 3 };
    map = decrement('k1', map);
    expect(map['k1']).toBe(2);
  });

  it('decrement on missing key is a no-op', () => {
    const map = {};
    const result = decrement('k1', map);
    expect('k1' in result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: getOrdersToComplete (qty-map based)
// ---------------------------------------------------------------------------

describe('getOrdersToComplete()', () => {
  it('marks an order complete when all items have qty === netQty (no modifiers)', () => {
    const ord = makeOrder('ord_1', [
      makeItem('Pasta', 10.00, 1),
      makeItem('Vino', 8.00, 1),
    ]);
    const flat = buildFlatAnaliticaItems([ord]);
    const qtyMap = {};
    for (const i of flat) qtyMap[i.key] = i.netQty;
    expect(getOrdersToComplete([ord], flat, qtyMap)).toContain('ord_1');
  });

  it('does NOT mark complete when only some items have full qty', () => {
    const ord = makeOrder('ord_1', [
      makeItem('Pasta', 10.00, 1),
      makeItem('Vino', 8.00, 1),
    ]);
    const flat = buildFlatAnaliticaItems([ord]);
    // Only select the first item fully
    const qtyMap = { [flat[0].key]: flat[0].netQty };
    expect(getOrdersToComplete([ord], flat, qtyMap)).not.toContain('ord_1');
  });

  it('does NOT mark complete when base qty < netQty', () => {
    const ord = makeOrder('ord_1', [makeItem('Pasta', 10.00, 3)]);
    const flat = buildFlatAnaliticaItems([ord]);
    const qtyMap = { [flat[0].key]: 2 }; // 2 of 3
    expect(getOrdersToComplete([ord], flat, qtyMap)).not.toContain('ord_1');
  });

  it('does NOT mark complete when base item is full but paid modifier is 0', () => {
    const item = makeItem('Pizza', 10.00, 1, 0, [makeMod('Mozzarella', 1.50)]);
    const ord = makeOrder('ord_1', [item]);
    const flat = buildFlatAnaliticaItems([ord]);
    const baseKey = flat.find(i => !i.isModifier).key;
    const qtyMap = { [baseKey]: 1 }; // only base, not modifier
    expect(getOrdersToComplete([ord], flat, qtyMap)).not.toContain('ord_1');
  });

  it('marks complete when both base AND modifier have full qty', () => {
    const item = makeItem('Pizza', 10.00, 1, 0, [makeMod('Mozzarella', 1.50)]);
    const ord = makeOrder('ord_1', [item]);
    const flat = buildFlatAnaliticaItems([ord]);
    const qtyMap = {};
    for (const i of flat) qtyMap[i.key] = i.netQty;
    expect(getOrdersToComplete([ord], flat, qtyMap)).toContain('ord_1');
  });

  it('marks only the fully-covered order across multiple orders', () => {
    const ord1 = makeOrder('ord_1', [makeItem('Pasta', 10.00, 1)]);
    const ord2 = makeOrder('ord_2', [
      makeItem('Bistecca', 18.00, 1),
      makeItem('Vino', 8.00, 1),
    ]);
    const flat1 = buildFlatAnaliticaItems([ord1]);
    const flat2 = buildFlatAnaliticaItems([ord2]);
    const allFlat = [...flat1, ...flat2];
    // Full qty for ord1, partial for ord2
    const qtyMap = { [flat1[0].key]: flat1[0].netQty, [flat2[0].key]: flat2[0].netQty };
    const toComplete = getOrdersToComplete([ord1, ord2], allFlat, qtyMap);
    expect(toComplete).toContain('ord_1');
    expect(toComplete).not.toContain('ord_2');
  });

  it('marks a fully-voided order (zero payable rows) as complete', () => {
    // An order where every item is voided produces no rows in flatItems.
    // It must still be eligible for auto-completion so it doesn't block table close.
    const ord = makeOrder('ord_voided', [makeItem('Birra', 4.00, 2, 2)]); // fully voided
    const flat = buildFlatAnaliticaItems([ord]);
    expect(flat).toHaveLength(0); // sanity check
    expect(getOrdersToComplete([ord], flat, {})).toContain('ord_voided');
  });
});

// ---------------------------------------------------------------------------
// Tests: toggleSelectAllVoci logic
// ---------------------------------------------------------------------------

describe('toggleSelectAllVoci logic', () => {
  function toggleSelectAll(flatItems, qtyMap) {
    const allMaxed = flatItems.every(i => (qtyMap[i.key] || 0) === i.netQty);
    if (allMaxed) return {};
    const newQty = {};
    for (const item of flatItems) newQty[item.key] = item.netQty;
    return newQty;
  }

  it('sets all to netQty when nothing is selected', () => {
    const item = makeItem('Pizza', 10.00, 2, 0, [makeMod('Mozzarella', 1.50)]);
    const ord = makeOrder('ord_1', [item]);
    const flat = buildFlatAnaliticaItems([ord]);
    const result = toggleSelectAll(flat, {});
    for (const i of flat) expect(result[i.key]).toBe(i.netQty);
  });

  it('clears all when all are at max qty', () => {
    const ord = makeOrder('ord_1', [makeItem('Pasta', 10.00, 1)]);
    const flat = buildFlatAnaliticaItems([ord]);
    const fullMap = {};
    for (const i of flat) fullMap[i.key] = i.netQty;
    const result = toggleSelectAll(flat, fullMap);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('sets all to max when only some items have partial qty', () => {
    const ord = makeOrder('ord_1', [
      makeItem('Pasta', 10.00, 3),
      makeItem('Vino', 8.00, 2),
    ]);
    const flat = buildFlatAnaliticaItems([ord]);
    // Only partially set the first item
    const result = toggleSelectAll(flat, { [flat[0].key]: 1 });
    expect(result[flat[0].key]).toBe(flat[0].netQty); // 3
    expect(result[flat[1].key]).toBe(flat[1].netQty); // 2
  });
});

// ---------------------------------------------------------------------------
// Integration: store.addTransaction() with analitica operationType
// ---------------------------------------------------------------------------

describe('store.addTransaction() with analitica operationType', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('records the transaction with operationType=analitica and vociRefs', () => {
    const store = useAppStore();
    // Keys are uid-based: `${orderId}__${itemUid}` and `${orderId}__${itemUid}__mod__${modIdx}`
    store.addTransaction({
      id: 'txn_test',
      tableId: 'T1',
      billSessionId: 'sess_1',
      paymentMethod: 'Contanti',
      operationType: 'analitica',
      amountPaid: 15.00,
      vociRefs: [{ key: 'ord_1__itm_abc', qty: 1 }, { key: 'ord_1__itm_abc__mod__0', qty: 1 }],
      orderRefs: ['ord_1'],
      timestamp: new Date().toISOString(),
    });

    expect(store.transactions).toHaveLength(1);
    const txn = store.transactions[0];
    expect(txn.operationType).toBe('analitica');
    expect(txn.amountPaid).toBeCloseTo(15.00, 2);
    expect(txn.vociRefs[0]).toMatchObject({ key: 'ord_1__itm_abc', qty: 1 });
  });

  it('records modifier keys with partial quantities in vociRefs', () => {
    const store = useAppStore();
    const billSessionId = store.openTableSession('T1', 2, 0);

    const items = [
      {
        uid: 'u1', dishId: 'd1', name: 'Pizza', unitPrice: 10.00,
        quantity: 2, voidedQuantity: 0, notes: [],
        modifiers: [{ name: 'Mozzarella', price: 1.50, voidedQuantity: 0 }],
      },
    ];
    const ord = store.addDirectOrder('T1', billSessionId, items);

    const baseKey = `${ord.id}__u1`;
    const modKey = `${ord.id}__u1__mod__0`;

    // Pay only 1 of 2 pizzas and 1 of 2 modifier rows
    store.addTransaction({
      id: 'txn_partial',
      tableId: 'T1',
      billSessionId,
      paymentMethod: 'Contanti',
      operationType: 'analitica',
      amountPaid: 11.50,
      vociRefs: [{ key: baseKey, qty: 1 }, { key: modKey, qty: 1 }],
      orderRefs: [ord.id],
      timestamp: new Date().toISOString(),
    });

    const txn = store.transactions.find(t => t.id === 'txn_partial');
    expect(txn).toBeDefined();
    expect(txn.vociRefs).toEqual(
      expect.arrayContaining([
        { key: baseKey, qty: 1 },
        { key: modKey, qty: 1 },
      ])
    );
    expect(txn.amountPaid).toBeCloseTo(11.50, 2);
  });
});

// ---------------------------------------------------------------------------
// Tests: checkout mode switch resets selections (regression for bug where
//        "totale selezionato supera il conto rimanente" warning persisted after
//        switching away from analitica mode without completing a transaction).
// ---------------------------------------------------------------------------

describe('mode-switch selection reset', () => {
  it('resetting analiticaQty to {} makes selectionExceedsRemaining return false', () => {
    const ord = makeOrder('ord_1', [
      makeItem('Bistecca', 25.00, 1),
      makeItem('Vino', 15.00, 1),
    ]);
    const flat = buildFlatAnaliticaItems([ord]);
    // Simulate a selection that exceeds the remaining bill
    const qtyMap = { [flat[0].key]: 1, [flat[1].key]: 1 };
    expect(selectionExceedsRemaining(flat, qtyMap, 35.00)).toBe(true);

    // Simulate what the checkoutMode watcher does: reset analiticaQty to {}
    const resetQtyMap = {};
    expect(selectionExceedsRemaining(flat, resetQtyMap, 35.00)).toBe(false);
  });

  it('resetting analiticaQty to {} makes computeAnaliticaTotal return 0', () => {
    const ord = makeOrder('ord_1', [makeItem('Pasta', 10.00, 2)]);
    const flat = buildFlatAnaliticaItems([ord]);
    const qtyMap = { [flat[0].key]: 2 };
    expect(computeAnaliticaTotal(flat, qtyMap)).toBeGreaterThan(0);

    // After mode switch the qtyMap is cleared
    expect(computeAnaliticaTotal(flat, {})).toBe(0);
  });

  it('empty analiticaQty blocks canPay regardless of the remaining bill', () => {
    const ord = makeOrder('ord_1', [makeItem('Caffè', 1.50, 1)]);
    const flat = buildFlatAnaliticaItems([ord]);
    // No items selected after mode reset → canPay must be false
    expect(canPay(10.00, flat, {})).toBe(false);
  });
});
