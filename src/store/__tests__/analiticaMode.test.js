/**
 * @file analiticaMode.test.js
 * @description Unit tests for the "analitica" (analytic) checkout mode logic.
 *
 * Tests cover:
 *  - flatAnalyticaItems computation (base items + paid modifiers as separate rows)
 *  - analiticaAmount computation (qty map, capped at remaining)
 *  - canPay guard (disabled when all qtys are 0)
 *  - Order completion in processTablePayment (requires qty === netQty for all rows)
 *  - incrementAnalitica / decrementAnalitica helpers
 *  - toggleSelectAllVoci helper (sets all to max / all to 0)
 *  - Direct entry items (isDirectEntry flag)
 *
 * The logic is extracted from CassaTableManager.vue and tested as pure
 * functions using the same patterns as directOrder.test.js.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAppStore } from '../index.js';
import { getOrderItemRowTotal } from '../../utils/index.js';

// Prevent real network requests while loading the menu
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Helpers mirroring CassaTableManager.vue logic
// ---------------------------------------------------------------------------

/**
 * Builds the flat list of individually selectable items (mirrors flatAnalyticaItems computed).
 * Each base item row shows its unit price only (not including modifier surcharges).
 * Each paid modifier appears as a separate sub-row.
 */
function buildFlatAnalyticaItems(acceptedOrders) {
  const items = [];
  for (const ord of acceptedOrders) {
    for (let idx = 0; idx < ord.orderItems.length; idx++) {
      const item = ord.orderItems[idx];
      const netQty = item.quantity - (item.voidedQuantity || 0);
      if (netQty <= 0) continue;

      items.push({
        key: `${ord.id}__${idx}`,
        orderId: ord.id,
        itemIdx: idx,
        modIdx: null,
        name: item.name,
        netQty,
        unitPrice: item.unitPrice,
        rowTotal: item.unitPrice * netQty,
        isDirectEntry: ord.isDirectEntry || false,
        isModifier: false,
      });

      for (let modIdx = 0; modIdx < (item.modifiers || []).length; modIdx++) {
        const mod = item.modifiers[modIdx];
        if ((mod.price || 0) <= 0) continue;
        const modNetQty = Math.max(0, netQty - (mod.voidedQuantity || 0));
        if (modNetQty <= 0) continue;
        items.push({
          key: `${ord.id}__${idx}__mod__${modIdx}`,
          orderId: ord.id,
          itemIdx: idx,
          modIdx,
          name: mod.name,
          netQty: modNetQty,
          unitPrice: mod.price,
          rowTotal: mod.price * modNetQty,
          isDirectEntry: ord.isDirectEntry || false,
          isModifier: true,
        });
      }
    }
  }
  return items;
}

/**
 * Computes the amount for selected analytic items (mirrors analiticaAmount computed).
 * @param {object[]} flatItems - Output of buildFlatAnalyticaItems
 * @param {object} qtyMap - { key: selectedQty } map (mirrors analiticaQty)
 */
function computeAnaliticaAmount(flatItems, qtyMap) {
  return flatItems.reduce((acc, i) => {
    const qty = qtyMap[i.key] || 0;
    return acc + i.unitPrice * qty;
  }, 0);
}

/**
 * Returns true when the uncapped selected total exceeds the remaining bill.
 * Mirrors analiticaSelectionExceedsRemaining computed.
 */
function selectionExceedsRemaining(flatItems, qtyMap, amountRemaining) {
  return computeAnaliticaAmount(flatItems, qtyMap) > amountRemaining;
}

/**
 * Determines which order IDs should be auto-completed after an analitica payment.
 * An order is completed only when selectedQty === netQty for every item/modifier row.
 */
function getOrdersToComplete(acceptedOrders, flatItems, qtyMap) {
  const toComplete = [];
  for (const ord of acceptedOrders) {
    const ordItems = flatItems.filter(i => i.orderId === ord.id);
    const allFullySelected = ordItems.length > 0 &&
      ordItems.every(i => (qtyMap[i.key] || 0) >= i.netQty);
    if (allFullySelected) toComplete.push(ord.id);
  }
  return toComplete;
}

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
// Tests: buildFlatAnalyticaItems — base items
// ---------------------------------------------------------------------------

describe('buildFlatAnalyticaItems() — base items', () => {
  it('returns one entry per non-voided item when there are no modifiers', () => {
    const ord = makeOrder('ord_1', [
      makeItem('Caffè', 1.50, 2),
      makeItem('Acqua', 2.00, 1),
    ]);
    const flat = buildFlatAnalyticaItems([ord]);
    expect(flat).toHaveLength(2);
    expect(flat.every(i => !i.isModifier)).toBe(true);
  });

  it('excludes fully voided items (netQty <= 0)', () => {
    const ord = makeOrder('ord_1', [
      makeItem('Caffè', 1.50, 2, 2), // fully voided
      makeItem('Acqua', 2.00, 1, 0),
    ]);
    const flat = buildFlatAnalyticaItems([ord]);
    expect(flat).toHaveLength(1);
    expect(flat[0].name).toBe('Acqua');
  });

  it('generates unique keys in the form orderId__itemIdx', () => {
    const ord = makeOrder('ord_abc', [
      makeItem('Pasta', 10.00, 1),
      makeItem('Vino', 8.00, 1),
    ]);
    const flat = buildFlatAnalyticaItems([ord]);
    expect(flat[0].key).toBe('ord_abc__0');
    expect(flat[1].key).toBe('ord_abc__1');
  });

  it('base item rowTotal uses only unitPrice × netQty (not modifiers)', () => {
    const item = makeItem('Pizza', 10.00, 2, 0, [makeMod('Mozzarella', 1.50)]);
    const ord = makeOrder('ord_1', [item]);
    const flat = buildFlatAnalyticaItems([ord]);
    const baseRow = flat.find(i => !i.isModifier);
    // Should be 2 × 10.00 = 20.00, NOT 2 × 11.50 = 23.00
    expect(baseRow.rowTotal).toBeCloseTo(20.00, 2);
  });

  it('marks direct-entry order items with isDirectEntry=true', () => {
    const ord = makeOrder('ord_d', [makeItem('Caffè', 1.50, 1)], true);
    const flat = buildFlatAnalyticaItems([ord]);
    expect(flat[0].isDirectEntry).toBe(true);
    expect(flat[0].isModifier).toBe(false);
  });

  it('returns an empty list when all items are voided', () => {
    const ord = makeOrder('ord_1', [makeItem('Vino', 8.00, 3, 3)]);
    expect(buildFlatAnalyticaItems([ord])).toHaveLength(0);
  });

  it('returns an empty list when there are no orders', () => {
    expect(buildFlatAnalyticaItems([])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: buildFlatAnalyticaItems — paid modifiers
// ---------------------------------------------------------------------------

describe('buildFlatAnalyticaItems() — paid modifiers (variazioni)', () => {
  it('adds a separate sub-row for each paid modifier', () => {
    const item = makeItem('Pizza', 10.00, 1, 0, [
      makeMod('Mozzarella', 1.50),
      makeMod('Funghi', 2.00),
    ]);
    const ord = makeOrder('ord_1', [item]);
    const flat = buildFlatAnalyticaItems([ord]);
    expect(flat).toHaveLength(3);
    expect(flat.filter(i => i.isModifier)).toHaveLength(2);
  });

  it('skips free (price=0) modifiers', () => {
    const item = makeItem('Pasta', 10.00, 1, 0, [
      makeMod('Senza sale', 0),
      makeMod('Extra cheese', 1.00),
    ]);
    const ord = makeOrder('ord_1', [item]);
    const flat = buildFlatAnalyticaItems([ord]);
    expect(flat.filter(i => i.isModifier)).toHaveLength(1);
    expect(flat.find(i => i.isModifier).name).toBe('Extra cheese');
  });

  it('skips fully voided modifiers', () => {
    const item = makeItem('Pizza', 10.00, 2, 0, [
      makeMod('Mozzarella', 1.50, 2), // voidedQuantity = netQty → fully voided
    ]);
    const ord = makeOrder('ord_1', [item]);
    const flat = buildFlatAnalyticaItems([ord]);
    expect(flat.filter(i => i.isModifier)).toHaveLength(0);
  });

  it('uses key format orderId__itemIdx__mod__modIdx for modifiers', () => {
    const item = makeItem('Pizza', 10.00, 1, 0, [makeMod('Mozzarella', 1.50)]);
    const ord = makeOrder('ord_x', [item]);
    const flat = buildFlatAnalyticaItems([ord]);
    const modRow = flat.find(i => i.isModifier);
    expect(modRow.key).toBe('ord_x__0__mod__0');
  });
});

// ---------------------------------------------------------------------------
// Tests: computeAnaliticaAmount (qty-map based)
// ---------------------------------------------------------------------------

describe('computeAnaliticaAmount()', () => {
  it('returns 0 when all qtys are 0', () => {
    const ord = makeOrder('ord_1', [makeItem('Caffè', 1.50, 2)]);
    const flat = buildFlatAnalyticaItems([ord]);
    expect(computeAnaliticaAmount(flat, {})).toBe(0);
  });

  it('computes total for partial qty selection of a single item', () => {
    // Item has netQty=2; user selects qty=1
    const ord = makeOrder('ord_1', [makeItem('Caffè', 1.50, 2)]);
    const flat = buildFlatAnalyticaItems([ord]);
    const qtyMap = { [flat[0].key]: 1 }; // select 1 of 2
    expect(computeAnaliticaAmount(flat, qtyMap)).toBeCloseTo(1.50, 2);
  });

  it('computes total for full qty selection', () => {
    const ord = makeOrder('ord_1', [makeItem('Caffè', 1.50, 2)]);
    const flat = buildFlatAnalyticaItems([ord]);
    const qtyMap = { [flat[0].key]: 2 }; // select all 2
    expect(computeAnaliticaAmount(flat, qtyMap)).toBeCloseTo(3.00, 2);
  });

  it('sums base item and partial modifier qty', () => {
    const item = makeItem('Pizza', 10.00, 2, 0, [makeMod('Mozzarella', 1.50)]);
    const ord = makeOrder('ord_1', [item]);
    const flat = buildFlatAnalyticaItems([ord]);
    const baseKey = flat.find(i => !i.isModifier).key;
    const modKey = flat.find(i => i.isModifier).key;
    // Pay 1 pizza base + 1 modifier
    const qtyMap = { [baseKey]: 1, [modKey]: 1 };
    expect(computeAnaliticaAmount(flat, qtyMap)).toBeCloseTo(11.50, 2);
  });

  it('allows selecting modifier qty without base item', () => {
    const item = makeItem('Pizza', 10.00, 1, 0, [makeMod('Mozzarella', 1.50)]);
    const ord = makeOrder('ord_1', [item]);
    const flat = buildFlatAnalyticaItems([ord]);
    const modKey = flat.find(i => i.isModifier).key;
    expect(computeAnaliticaAmount(flat, { [modKey]: 1 })).toBeCloseTo(1.50, 2);
  });

  it('returns the real uncapped total even when it exceeds the remaining bill', () => {
    const ord = makeOrder('ord_1', [
      makeItem('Bistecca', 25.00, 1),
      makeItem('Vino', 15.00, 1),
    ]);
    const flat = buildFlatAnalyticaItems([ord]);
    const qtyMap = { [flat[0].key]: 1, [flat[1].key]: 1 };
    // Total = 40.00, which exceeds a hypothetical remaining of 35.00
    expect(computeAnaliticaAmount(flat, qtyMap)).toBeCloseTo(40.00, 2);
    // The guard against overpayment is in selectionExceedsRemaining / canPay
    expect(selectionExceedsRemaining(flat, qtyMap, 35.00)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: canPay guard for analitica mode
// ---------------------------------------------------------------------------

describe('canPay guard for analitica mode', () => {
  const BILL_SETTLED_THRESHOLD = 0.01;

  function canPay(remaining, flatItems, qtyMap) {
    if (remaining <= BILL_SETTLED_THRESHOLD) return false;
    if (!flatItems.some(i => (qtyMap[i.key] || 0) > 0)) return false;
    if (selectionExceedsRemaining(flatItems, qtyMap, remaining)) return false;
    return true;
  }

  it('returns false when all qtys are 0', () => {
    const ord = makeOrder('ord_1', [makeItem('Caffè', 1.50, 2)]);
    const flat = buildFlatAnalyticaItems([ord]);
    expect(canPay(15.00, flat, {})).toBe(false);
  });

  it('returns true when at least one item has qty > 0 and total ≤ remaining', () => {
    const ord = makeOrder('ord_1', [makeItem('Caffè', 1.50, 2)]);
    const flat = buildFlatAnalyticaItems([ord]);
    expect(canPay(15.00, flat, { [flat[0].key]: 1 })).toBe(true);
  });

  it('returns false when the remaining bill is at or below the settled threshold', () => {
    const ord = makeOrder('ord_1', [makeItem('Caffè', 1.50, 2)]);
    const flat = buildFlatAnalyticaItems([ord]);
    expect(canPay(0.005, flat, { [flat[0].key]: 2 })).toBe(false);
  });

  it('returns false when the selected total exceeds the remaining bill', () => {
    const ord = makeOrder('ord_1', [
      makeItem('Bistecca', 25.00, 1),
      makeItem('Vino', 15.00, 1),
    ]);
    const flat = buildFlatAnalyticaItems([ord]);
    // Both selected = 40.00, but only 35.00 remaining
    const qtyMap = { [flat[0].key]: 1, [flat[1].key]: 1 };
    expect(canPay(35.00, flat, qtyMap)).toBe(false);
  });

  it('returns true when the selected total exactly equals the remaining bill', () => {
    const ord = makeOrder('ord_1', [
      makeItem('Bistecca', 25.00, 1),
      makeItem('Vino', 15.00, 1),
    ]);
    const flat = buildFlatAnalyticaItems([ord]);
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
    const flat = buildFlatAnalyticaItems([ord]);
    const qtyMap = {};
    for (const i of flat) qtyMap[i.key] = i.netQty;
    expect(getOrdersToComplete([ord], flat, qtyMap)).toContain('ord_1');
  });

  it('does NOT mark complete when only some items have full qty', () => {
    const ord = makeOrder('ord_1', [
      makeItem('Pasta', 10.00, 1),
      makeItem('Vino', 8.00, 1),
    ]);
    const flat = buildFlatAnalyticaItems([ord]);
    // Only select the first item fully
    const qtyMap = { [flat[0].key]: flat[0].netQty };
    expect(getOrdersToComplete([ord], flat, qtyMap)).not.toContain('ord_1');
  });

  it('does NOT mark complete when base qty < netQty', () => {
    const ord = makeOrder('ord_1', [makeItem('Pasta', 10.00, 3)]);
    const flat = buildFlatAnalyticaItems([ord]);
    const qtyMap = { [flat[0].key]: 2 }; // 2 of 3
    expect(getOrdersToComplete([ord], flat, qtyMap)).not.toContain('ord_1');
  });

  it('does NOT mark complete when base item is full but paid modifier is 0', () => {
    const item = makeItem('Pizza', 10.00, 1, 0, [makeMod('Mozzarella', 1.50)]);
    const ord = makeOrder('ord_1', [item]);
    const flat = buildFlatAnalyticaItems([ord]);
    const baseKey = flat.find(i => !i.isModifier).key;
    const qtyMap = { [baseKey]: 1 }; // only base, not modifier
    expect(getOrdersToComplete([ord], flat, qtyMap)).not.toContain('ord_1');
  });

  it('marks complete when both base AND modifier have full qty', () => {
    const item = makeItem('Pizza', 10.00, 1, 0, [makeMod('Mozzarella', 1.50)]);
    const ord = makeOrder('ord_1', [item]);
    const flat = buildFlatAnalyticaItems([ord]);
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
    const flat1 = buildFlatAnalyticaItems([ord1]);
    const flat2 = buildFlatAnalyticaItems([ord2]);
    const allFlat = [...flat1, ...flat2];
    // Full qty for ord1, partial for ord2
    const qtyMap = { [flat1[0].key]: flat1[0].netQty, [flat2[0].key]: flat2[0].netQty };
    const toComplete = getOrdersToComplete([ord1, ord2], allFlat, qtyMap);
    expect(toComplete).toContain('ord_1');
    expect(toComplete).not.toContain('ord_2');
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
    const flat = buildFlatAnalyticaItems([ord]);
    const result = toggleSelectAll(flat, {});
    for (const i of flat) expect(result[i.key]).toBe(i.netQty);
  });

  it('clears all when all are at max qty', () => {
    const ord = makeOrder('ord_1', [makeItem('Pasta', 10.00, 1)]);
    const flat = buildFlatAnalyticaItems([ord]);
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
    const flat = buildFlatAnalyticaItems([ord]);
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
    store.addTransaction({
      transactionId: 'txn_test',
      tableId: 'T1',
      billSessionId: 'sess_1',
      paymentMethod: 'Contanti',
      operationType: 'analitica',
      amountPaid: 15.00,
      vociRefs: [{ key: 'ord_1__0', qty: 1 }, { key: 'ord_1__0__mod__0', qty: 1 }],
      orderRefs: ['ord_1'],
      timestamp: new Date().toISOString(),
    });

    expect(store.transactions).toHaveLength(1);
    const txn = store.transactions[0];
    expect(txn.operationType).toBe('analitica');
    expect(txn.amountPaid).toBeCloseTo(15.00, 2);
    expect(txn.vociRefs[0]).toMatchObject({ key: 'ord_1__0', qty: 1 });
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

    const baseKey = `${ord.id}__0`;
    const modKey = `${ord.id}__0__mod__0`;

    // Pay only 1 of 2 pizzas and 1 of 2 modifier rows
    store.addTransaction({
      transactionId: 'txn_partial',
      tableId: 'T1',
      billSessionId,
      paymentMethod: 'Contanti',
      operationType: 'analitica',
      amountPaid: 11.50,
      vociRefs: [{ key: baseKey, qty: 1 }, { key: modKey, qty: 1 }],
      orderRefs: [ord.id],
      timestamp: new Date().toISOString(),
    });

    const txn = store.transactions.find(t => t.transactionId === 'txn_partial');
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
