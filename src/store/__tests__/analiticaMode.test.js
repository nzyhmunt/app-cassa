/**
 * @file analiticaMode.test.js
 * @description Unit tests for the "analitica" (analytic) checkout mode logic.
 *
 * Tests cover:
 *  - flatAnalyticaItems computation (base items + paid modifiers as separate rows)
 *  - analiticaAmount computation (sums selected items, capped at remaining)
 *  - canPay guard (disabled when no items selected)
 *  - Order completion in processTablePayment (requires all items AND modifiers selected)
 *  - toggleSelectAllVoci helper
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
// Helpers mirroring CassaTableManager.vue logic (updated with modifier support)
// ---------------------------------------------------------------------------

/**
 * Builds the flat list of individually selectable items (mirrors flatAnalyticaItems computed).
 * Base items show only their unit price; paid modifiers appear as separate sub-rows.
 */
function buildFlatAnalyticaItems(acceptedOrders) {
  const items = [];
  for (const ord of acceptedOrders) {
    for (let idx = 0; idx < ord.orderItems.length; idx++) {
      const item = ord.orderItems[idx];
      const netQty = item.quantity - (item.voidedQuantity || 0);
      if (netQty <= 0) continue;

      // Base item — unit price only, no modifier surcharges
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

      // Paid modifiers as individually selectable sub-rows
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
 */
function computeAnaliticaAmount(flatItems, selectedKeys, amountRemaining) {
  const total = flatItems
    .filter(i => selectedKeys.includes(i.key))
    .reduce((acc, i) => acc + i.rowTotal, 0);
  return Math.min(total, amountRemaining);
}

/**
 * Determines which order IDs should be auto-completed after an analitica payment.
 * An order is completed only when ALL its non-voided items AND paid modifiers are selected.
 */
function getOrdersToComplete(acceptedOrders, selectedKeys) {
  const toComplete = [];
  for (const ord of acceptedOrders) {
    const payableKeys = [];
    for (let idx = 0; idx < ord.orderItems.length; idx++) {
      const item = ord.orderItems[idx];
      const netQty = item.quantity - (item.voidedQuantity || 0);
      if (netQty <= 0) continue;
      payableKeys.push(`${ord.id}__${idx}`);
      for (let modIdx = 0; modIdx < (item.modifiers || []).length; modIdx++) {
        const mod = item.modifiers[modIdx];
        if ((mod.price || 0) <= 0) continue;
        const modNetQty = Math.max(0, netQty - (mod.voidedQuantity || 0));
        if (modNetQty <= 0) continue;
        payableKeys.push(`${ord.id}__${idx}__mod__${modIdx}`);
      }
    }
    const allSelected = payableKeys.length > 0 && payableKeys.every(k => selectedKeys.includes(k));
    if (allSelected) toComplete.push(ord.id);
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
    // 1 base + 2 modifiers = 3 entries
    expect(flat).toHaveLength(3);
    expect(flat.filter(i => i.isModifier)).toHaveLength(2);
  });

  it('skips free (price=0) modifiers', () => {
    const item = makeItem('Pasta', 10.00, 1, 0, [
      makeMod('Senza sale', 0), // free note-style mod
      makeMod('Extra cheese', 1.00), // paid
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

  it('computes modifier rowTotal as price × modNetQty', () => {
    // 3 items, 1 modifier voided → modNetQty = 3 - 1 = 2
    const item = makeItem('Pasta', 8.00, 3, 0, [makeMod('Formaggio', 1.00, 1)]);
    const ord = makeOrder('ord_1', [item]);
    const flat = buildFlatAnalyticaItems([ord]);
    const modRow = flat.find(i => i.isModifier);
    expect(modRow.netQty).toBe(2);
    expect(modRow.rowTotal).toBeCloseTo(2.00, 2);
  });

  it('does not show modifier rows when the parent item is fully voided', () => {
    const item = makeItem('Pizza', 10.00, 2, 2, [makeMod('Mozzarella', 1.50)]);
    const ord = makeOrder('ord_1', [item]);
    const flat = buildFlatAnalyticaItems([ord]);
    // Parent voided → parent excluded → no modifier rows either
    expect(flat).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: computeAnaliticaAmount
// ---------------------------------------------------------------------------

describe('computeAnaliticaAmount()', () => {
  it('returns 0 when no items are selected', () => {
    const ord = makeOrder('ord_1', [makeItem('Caffè', 1.50, 2)]);
    const flat = buildFlatAnalyticaItems([ord]);
    expect(computeAnaliticaAmount(flat, [], 100)).toBe(0);
  });

  it('sums rowTotal of selected base items', () => {
    const ord = makeOrder('ord_1', [
      makeItem('Caffè', 1.50, 2), // base rowTotal = 3.00
      makeItem('Acqua', 2.00, 1), // base rowTotal = 2.00
    ]);
    const flat = buildFlatAnalyticaItems([ord]);
    const amount = computeAnaliticaAmount(flat, [flat[0].key], 100);
    expect(amount).toBeCloseTo(3.00, 2);
  });

  it('sums base item and its modifier when both selected', () => {
    const item = makeItem('Pizza', 10.00, 1, 0, [makeMod('Mozzarella', 1.50)]);
    const ord = makeOrder('ord_1', [item]);
    const flat = buildFlatAnalyticaItems([ord]);
    const allKeys = flat.map(i => i.key);
    const amount = computeAnaliticaAmount(flat, allKeys, 100);
    // 10.00 base + 1.50 modifier = 11.50
    expect(amount).toBeCloseTo(11.50, 2);
  });

  it('allows selecting modifier without base item', () => {
    const item = makeItem('Pizza', 10.00, 1, 0, [makeMod('Mozzarella', 1.50)]);
    const ord = makeOrder('ord_1', [item]);
    const flat = buildFlatAnalyticaItems([ord]);
    const modKey = flat.find(i => i.isModifier).key;
    const amount = computeAnaliticaAmount(flat, [modKey], 100);
    expect(amount).toBeCloseTo(1.50, 2);
  });

  it('is capped by the remaining bill amount', () => {
    const ord = makeOrder('ord_1', [
      makeItem('Bistecca', 25.00, 1),
      makeItem('Vino', 15.00, 1),
    ]);
    const flat = buildFlatAnalyticaItems([ord]);
    const amount = computeAnaliticaAmount(flat, [flat[0].key, flat[1].key], 35.00);
    expect(amount).toBeCloseTo(35.00, 2);
  });
});

// ---------------------------------------------------------------------------
// Tests: canPay guard for analitica mode
// ---------------------------------------------------------------------------

describe('canPay guard for analitica mode', () => {
  const BILL_SETTLED_THRESHOLD = 0.01;

  it('returns false when no items are selected', () => {
    const canPay = (() => {
      if (15.00 <= BILL_SETTLED_THRESHOLD) return false;
      if ([].length === 0) return false;
      return true;
    })();
    expect(canPay).toBe(false);
  });

  it('returns true when at least one item is selected', () => {
    const canPay = (() => {
      if (15.00 <= BILL_SETTLED_THRESHOLD) return false;
      if (['ord_1__0'].length === 0) return false;
      return true;
    })();
    expect(canPay).toBe(true);
  });

  it('returns false when the remaining bill is at or below the settled threshold', () => {
    const canPay = (() => {
      if (0.005 <= BILL_SETTLED_THRESHOLD) return false;
      if (['ord_1__0'].length === 0) return false;
      return true;
    })();
    expect(canPay).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: getOrdersToComplete (includes modifier key check)
// ---------------------------------------------------------------------------

describe('getOrdersToComplete()', () => {
  it('marks an order complete when all items (no modifiers) are selected', () => {
    const ord = makeOrder('ord_1', [
      makeItem('Pasta', 10.00, 1),
      makeItem('Vino', 8.00, 1),
    ]);
    const flat = buildFlatAnalyticaItems([ord]);
    const toComplete = getOrdersToComplete([ord], flat.map(i => i.key));
    expect(toComplete).toContain('ord_1');
  });

  it('does NOT mark complete when only some items are selected (no modifiers)', () => {
    const ord = makeOrder('ord_1', [
      makeItem('Pasta', 10.00, 1),
      makeItem('Vino', 8.00, 1),
    ]);
    const flat = buildFlatAnalyticaItems([ord]);
    const toComplete = getOrdersToComplete([ord], [flat[0].key]);
    expect(toComplete).not.toContain('ord_1');
  });

  it('does NOT mark complete when base item is selected but paid modifier is not', () => {
    const item = makeItem('Pizza', 10.00, 1, 0, [makeMod('Mozzarella', 1.50)]);
    const ord = makeOrder('ord_1', [item]);
    const flat = buildFlatAnalyticaItems([ord]);
    const baseKey = flat.find(i => !i.isModifier).key;
    // Only base selected, not the modifier
    const toComplete = getOrdersToComplete([ord], [baseKey]);
    expect(toComplete).not.toContain('ord_1');
  });

  it('marks complete when base item AND all paid modifiers are selected', () => {
    const item = makeItem('Pizza', 10.00, 1, 0, [makeMod('Mozzarella', 1.50)]);
    const ord = makeOrder('ord_1', [item]);
    const flat = buildFlatAnalyticaItems([ord]);
    const toComplete = getOrdersToComplete([ord], flat.map(i => i.key));
    expect(toComplete).toContain('ord_1');
  });

  it('ignores fully voided items/modifiers when checking completeness', () => {
    const ord = makeOrder('ord_1', [
      makeItem('Caffè', 1.50, 2, 2), // fully voided → excluded from payableKeys
      makeItem('Acqua', 2.00, 1, 0),
    ]);
    const flat = buildFlatAnalyticaItems([ord]);
    expect(flat).toHaveLength(1); // only Acqua
    const toComplete = getOrdersToComplete([ord], [flat[0].key]);
    expect(toComplete).toContain('ord_1');
  });

  it('marks only the fully-covered order across multiple orders', () => {
    const ord1 = makeOrder('ord_1', [makeItem('Pasta', 10.00, 1)]);
    const ord2 = makeOrder('ord_2', [
      makeItem('Bistecca', 18.00, 1),
      makeItem('Vino', 8.00, 1),
    ]);
    const flat1 = buildFlatAnalyticaItems([ord1]);
    const flat2 = buildFlatAnalyticaItems([ord2]);
    // Select all of ord1 and only the first item of ord2
    const selectedKeys = [flat1[0].key, flat2[0].key];
    const toComplete = getOrdersToComplete([ord1, ord2], selectedKeys);
    expect(toComplete).toContain('ord_1');
    expect(toComplete).not.toContain('ord_2');
  });
});

// ---------------------------------------------------------------------------
// Tests: toggleSelectAllVoci logic
// ---------------------------------------------------------------------------

describe('toggleSelectAllVoci logic', () => {
  it('selects all items (including modifiers) when none are selected', () => {
    const item = makeItem('Pizza', 10.00, 1, 0, [makeMod('Mozzarella', 1.50)]);
    const ord = makeOrder('ord_1', [item]);
    const flat = buildFlatAnalyticaItems([ord]);
    let selected = [];
    selected = selected.length === flat.length ? [] : flat.map(i => i.key);
    expect(selected).toHaveLength(flat.length); // base + modifier
  });

  it('deselects all items when all are selected', () => {
    const ord = makeOrder('ord_1', [makeItem('Pasta', 10.00, 1)]);
    const flat = buildFlatAnalyticaItems([ord]);
    let selected = flat.map(i => i.key);
    selected = selected.length === flat.length ? [] : flat.map(i => i.key);
    expect(selected).toHaveLength(0);
  });

  it('selects all when only some items are selected (partial → all)', () => {
    const ord = makeOrder('ord_1', [makeItem('Pasta', 10.00, 1), makeItem('Vino', 8.00, 1)]);
    const flat = buildFlatAnalyticaItems([ord]);
    let selected = [flat[0].key];
    selected = selected.length === flat.length ? [] : flat.map(i => i.key);
    expect(selected).toHaveLength(flat.length);
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
      vociRefs: ['ord_1__0', 'ord_1__0__mod__0'],
      orderRefs: ['ord_1'],
      timestamp: new Date().toISOString(),
    });

    expect(store.transactions).toHaveLength(1);
    const txn = store.transactions[0];
    expect(txn.operationType).toBe('analitica');
    expect(txn.amountPaid).toBeCloseTo(15.00, 2);
    expect(txn.vociRefs).toEqual(['ord_1__0', 'ord_1__0__mod__0']);
  });

  it('records modifier keys in vociRefs alongside base item key', () => {
    const store = useAppStore();
    const billSessionId = store.openTableSession('T1', 2, 0);

    const items = [
      {
        uid: 'u1', dishId: 'd1', name: 'Pizza', unitPrice: 10.00,
        quantity: 1, voidedQuantity: 0, notes: [],
        modifiers: [{ name: 'Mozzarella', price: 1.50, voidedQuantity: 0 }],
      },
    ];
    const ord = store.addDirectOrder('T1', billSessionId, items);

    const baseKey = `${ord.id}__0`;
    const modKey = `${ord.id}__0__mod__0`;

    store.addTransaction({
      transactionId: 'txn_mod',
      tableId: 'T1',
      billSessionId,
      paymentMethod: 'Contanti',
      operationType: 'analitica',
      amountPaid: 11.50,
      vociRefs: [baseKey, modKey],
      orderRefs: [ord.id],
      timestamp: new Date().toISOString(),
    });

    const txn = store.transactions.find(t => t.transactionId === 'txn_mod');
    expect(txn).toBeDefined();
    expect(txn.vociRefs).toContain(baseKey);
    expect(txn.vociRefs).toContain(modKey);
    expect(txn.amountPaid).toBeCloseTo(11.50, 2);
  });
});
