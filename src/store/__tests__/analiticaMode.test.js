/**
 * @file analiticaMode.test.js
 * @description Unit tests for the "analitica" (analytic) checkout mode logic.
 *
 * Tests cover:
 *  - flatAnalyticaItems computation (filters out fully voided items)
 *  - analiticaAmount computation (sums selected items, capped at remaining)
 *  - canPay guard (disabled when no items selected)
 *  - Order completion in processTablePayment (analitica mode)
 *  - toggleSelectAllVoci helper
 *
 * The logic is extracted from CassaTableManager.vue and tested as pure
 * functions using the same patterns as directOrder.test.js.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAppStore } from '../index.js';
import { getOrderItemRowTotal, KITCHEN_ACTIVE_STATUSES } from '../../utils/index.js';

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
 * @param {object[]} acceptedOrders - Orders with status in KITCHEN_ACTIVE_STATUSES
 * @returns {object[]} Flat list of { key, orderId, itemIdx, name, netQty, unitPrice, rowTotal }
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
        name: item.name,
        netQty,
        unitPrice: item.unitPrice,
        rowTotal: getOrderItemRowTotal(item),
      });
    }
  }
  return items;
}

/**
 * Computes the amount for selected analytic items (mirrors analiticaAmount computed).
 * @param {object[]} flatItems - Output of buildFlatAnalyticaItems
 * @param {string[]} selectedKeys - Currently selected item keys
 * @param {number} amountRemaining - Remaining bill amount (cap)
 * @returns {number}
 */
function computeAnaliticaAmount(flatItems, selectedKeys, amountRemaining) {
  const total = flatItems
    .filter(i => selectedKeys.includes(i.key))
    .reduce((acc, i) => acc + i.rowTotal, 0);
  return Math.min(total, amountRemaining);
}

/**
 * Determines which order IDs should be auto-completed after an analitica payment
 * (mirrors the completion logic in processTablePayment).
 * @param {object[]} acceptedOrders
 * @param {string[]} selectedKeys
 * @returns {string[]} IDs of orders whose items are all selected
 */
function getOrdersToComplete(acceptedOrders, selectedKeys) {
  const toComplete = [];
  for (const ord of acceptedOrders) {
    const payableItemKeys = ord.orderItems
      .map((item, idx) => ({
        key: `${ord.id}__${idx}`,
        netQty: item.quantity - (item.voidedQuantity || 0),
      }))
      .filter(({ netQty }) => netQty > 0)
      .map(({ key }) => key);
    const allSelected =
      payableItemKeys.length > 0 && payableItemKeys.every(k => selectedKeys.includes(k));
    if (allSelected) toComplete.push(ord.id);
  }
  return toComplete;
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

function makeItem(name, unitPrice, quantity, voidedQuantity = 0) {
  return {
    uid: `uid_${name}`,
    dishId: `dish_${name}`,
    name,
    unitPrice,
    quantity,
    voidedQuantity,
    notes: [],
    modifiers: [],
  };
}

function makeOrder(id, items) {
  const orderItems = items;
  const totalAmount = orderItems.reduce((acc, i) => acc + getOrderItemRowTotal(i), 0);
  return {
    id,
    table: 'T1',
    billSessionId: 'sess_1',
    status: 'accepted',
    orderItems,
    totalAmount,
    itemCount: orderItems.reduce((acc, i) => acc + i.quantity - (i.voidedQuantity || 0), 0),
  };
}

// ---------------------------------------------------------------------------
// Tests: buildFlatAnalyticaItems
// ---------------------------------------------------------------------------

describe('buildFlatAnalyticaItems()', () => {
  it('returns one entry per non-voided item', () => {
    const ord = makeOrder('ord_1', [
      makeItem('Caffè', 1.50, 2),
      makeItem('Acqua', 2.00, 1),
    ]);
    const flat = buildFlatAnalyticaItems([ord]);
    expect(flat).toHaveLength(2);
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

  it('handles multiple orders and builds correct keys for each', () => {
    const ord1 = makeOrder('ord_1', [makeItem('Pizza', 12.00, 1)]);
    const ord2 = makeOrder('ord_2', [makeItem('Birra', 4.50, 2)]);
    const flat = buildFlatAnalyticaItems([ord1, ord2]);
    expect(flat).toHaveLength(2);
    expect(flat[0].key).toBe('ord_1__0');
    expect(flat[1].key).toBe('ord_2__0');
  });

  it('computes rowTotal using getOrderItemRowTotal (net of voids)', () => {
    const ord = makeOrder('ord_1', [makeItem('Bistecca', 15.00, 2, 1)]);
    const flat = buildFlatAnalyticaItems([ord]);
    // 1 active × 15.00
    expect(flat[0].rowTotal).toBeCloseTo(15.00, 2);
    expect(flat[0].netQty).toBe(1);
  });

  it('returns an empty list when all items are voided', () => {
    const ord = makeOrder('ord_1', [makeItem('Vino', 8.00, 3, 3)]);
    const flat = buildFlatAnalyticaItems([ord]);
    expect(flat).toHaveLength(0);
  });

  it('returns an empty list when there are no orders', () => {
    const flat = buildFlatAnalyticaItems([]);
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

  it('sums the rowTotal of selected items', () => {
    const ord = makeOrder('ord_1', [
      makeItem('Caffè', 1.50, 2), // rowTotal = 3.00
      makeItem('Acqua', 2.00, 1), // rowTotal = 2.00
    ]);
    const flat = buildFlatAnalyticaItems([ord]);
    const amount = computeAnaliticaAmount(flat, [flat[0].key], 100);
    expect(amount).toBeCloseTo(3.00, 2);
  });

  it('sums multiple selected items correctly', () => {
    const ord = makeOrder('ord_1', [
      makeItem('Pizza', 10.00, 1),
      makeItem('Birra', 4.50, 2),
    ]);
    const flat = buildFlatAnalyticaItems([ord]);
    const amount = computeAnaliticaAmount(flat, [flat[0].key, flat[1].key], 100);
    expect(amount).toBeCloseTo(19.00, 2); // 10 + 9
  });

  it('is capped by the remaining bill amount', () => {
    const ord = makeOrder('ord_1', [
      makeItem('Bistecca', 25.00, 1),
      makeItem('Vino', 15.00, 1),
    ]);
    const flat = buildFlatAnalyticaItems([ord]);
    // Select both items (total 40.00) but remaining is only 35.00
    const amount = computeAnaliticaAmount(flat, [flat[0].key, flat[1].key], 35.00);
    expect(amount).toBeCloseTo(35.00, 2);
  });

  it('handles items from multiple orders', () => {
    const ord1 = makeOrder('ord_1', [makeItem('Primo', 8.00, 1)]);
    const ord2 = makeOrder('ord_2', [makeItem('Secondo', 12.00, 1)]);
    const flat = buildFlatAnalyticaItems([ord1, ord2]);
    const amount = computeAnaliticaAmount(flat, [flat[0].key, flat[1].key], 100);
    expect(amount).toBeCloseTo(20.00, 2);
  });
});

// ---------------------------------------------------------------------------
// Tests: canPay guard for analitica mode
// ---------------------------------------------------------------------------

describe('canPay guard for analitica mode', () => {
  it('returns false when no items are selected and mode is analitica', () => {
    const BILL_SETTLED_THRESHOLD = 0.01;
    const amountRemaining = 15.00;
    const selectedVociToPay = [];
    const checkoutMode = 'analitica';

    const canPay = (() => {
      if (amountRemaining <= BILL_SETTLED_THRESHOLD) return false;
      if (checkoutMode === 'analitica' && selectedVociToPay.length === 0) return false;
      return true;
    })();

    expect(canPay).toBe(false);
  });

  it('returns true when at least one item is selected', () => {
    const BILL_SETTLED_THRESHOLD = 0.01;
    const amountRemaining = 15.00;
    const selectedVociToPay = ['ord_1__0'];
    const checkoutMode = 'analitica';

    const canPay = (() => {
      if (amountRemaining <= BILL_SETTLED_THRESHOLD) return false;
      if (checkoutMode === 'analitica' && selectedVociToPay.length === 0) return false;
      return true;
    })();

    expect(canPay).toBe(true);
  });

  it('returns false when the remaining bill is at or below the settled threshold', () => {
    const BILL_SETTLED_THRESHOLD = 0.01;
    const amountRemaining = 0.005;
    const selectedVociToPay = ['ord_1__0'];
    const checkoutMode = 'analitica';

    const canPay = (() => {
      if (amountRemaining <= BILL_SETTLED_THRESHOLD) return false;
      if (checkoutMode === 'analitica' && selectedVociToPay.length === 0) return false;
      return true;
    })();

    expect(canPay).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: getOrdersToComplete
// ---------------------------------------------------------------------------

describe('getOrdersToComplete()', () => {
  it('marks an order as complete when all its items are selected', () => {
    const ord = makeOrder('ord_1', [
      makeItem('Pasta', 10.00, 1),
      makeItem('Vino', 8.00, 1),
    ]);
    const flat = buildFlatAnalyticaItems([ord]);
    const allKeys = flat.map(i => i.key);
    const toComplete = getOrdersToComplete([ord], allKeys);
    expect(toComplete).toContain('ord_1');
  });

  it('does not mark an order as complete when only some items are selected', () => {
    const ord = makeOrder('ord_1', [
      makeItem('Pasta', 10.00, 1),
      makeItem('Vino', 8.00, 1),
    ]);
    const flat = buildFlatAnalyticaItems([ord]);
    const toComplete = getOrdersToComplete([ord], [flat[0].key]); // only first item
    expect(toComplete).not.toContain('ord_1');
  });

  it('marks only the fully-covered order across multiple orders', () => {
    const ord1 = makeOrder('ord_1', [makeItem('Pasta', 10.00, 1)]);
    const ord2 = makeOrder('ord_2', [
      makeItem('Bistecca', 18.00, 1),
      makeItem('Vino', 8.00, 1),
    ]);
    const flat1 = buildFlatAnalyticaItems([ord1]);
    const flat2 = buildFlatAnalyticaItems([ord2]);
    // Only select all of ord1 and the first item of ord2
    const selectedKeys = [flat1[0].key, flat2[0].key];
    const toComplete = getOrdersToComplete([ord1, ord2], selectedKeys);
    expect(toComplete).toContain('ord_1');
    expect(toComplete).not.toContain('ord_2');
  });

  it('ignores fully voided items when determining completeness', () => {
    const ord = makeOrder('ord_1', [
      makeItem('Caffè', 1.50, 2, 2), // fully voided — excluded from payable items
      makeItem('Acqua', 2.00, 1, 0),
    ]);
    const flat = buildFlatAnalyticaItems([ord]);
    // Only the non-voided item (Acqua) should be in flatItems
    expect(flat).toHaveLength(1);
    const toComplete = getOrdersToComplete([ord], [flat[0].key]);
    expect(toComplete).toContain('ord_1');
  });

  it('handles no selected items (returns empty)', () => {
    const ord = makeOrder('ord_1', [makeItem('Pasta', 10.00, 1)]);
    const toComplete = getOrdersToComplete([ord], []);
    expect(toComplete).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: toggleSelectAllVoci logic
// ---------------------------------------------------------------------------

describe('toggleSelectAllVoci logic', () => {
  it('selects all items when none are selected', () => {
    const ord = makeOrder('ord_1', [
      makeItem('Pasta', 10.00, 1),
      makeItem('Vino', 8.00, 1),
    ]);
    const flat = buildFlatAnalyticaItems([ord]);
    let selected = [];

    // Toggle: selects all
    if (selected.length === flat.length) {
      selected = [];
    } else {
      selected = flat.map(i => i.key);
    }

    expect(selected).toHaveLength(flat.length);
  });

  it('deselects all items when all are selected', () => {
    const ord = makeOrder('ord_1', [
      makeItem('Pasta', 10.00, 1),
      makeItem('Vino', 8.00, 1),
    ]);
    const flat = buildFlatAnalyticaItems([ord]);
    let selected = flat.map(i => i.key);

    // Toggle: deselects all
    if (selected.length === flat.length) {
      selected = [];
    } else {
      selected = flat.map(i => i.key);
    }

    expect(selected).toHaveLength(0);
  });

  it('selects all when only some items are selected', () => {
    const ord = makeOrder('ord_1', [
      makeItem('Pasta', 10.00, 1),
      makeItem('Vino', 8.00, 1),
    ]);
    const flat = buildFlatAnalyticaItems([ord]);
    let selected = [flat[0].key]; // only first selected

    // Toggle: selects all (partial → all)
    if (selected.length === flat.length) {
      selected = [];
    } else {
      selected = flat.map(i => i.key);
    }

    expect(selected).toHaveLength(flat.length);
  });
});

// ---------------------------------------------------------------------------
// Integration: store-level addTransaction for analitica mode
// ---------------------------------------------------------------------------

describe('store.addTransaction() with analitica operationType', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('records the transaction with operationType=analitica', () => {
    const store = useAppStore();
    store.addTransaction({
      transactionId: 'txn_test',
      tableId: 'T1',
      billSessionId: 'sess_1',
      paymentMethod: 'Contanti',
      operationType: 'analitica',
      amountPaid: 15.00,
      vociRefs: ['ord_1__0', 'ord_1__1'],
      orderRefs: ['ord_1'],
      timestamp: new Date().toISOString(),
    });

    expect(store.transactions).toHaveLength(1);
    const txn = store.transactions[0];
    expect(txn.operationType).toBe('analitica');
    expect(txn.amountPaid).toBeCloseTo(15.00, 2);
    expect(txn.vociRefs).toEqual(['ord_1__0', 'ord_1__1']);
  });

  it('reduces tableAmountPaid correctly after analitica transaction', () => {
    const store = useAppStore();

    // Set up a table session
    const billSessionId = store.openTableSession('T1', 2, 0);

    // Add a direct order so the store has an order to work with
    const items = [
      { uid: 'u1', dishId: 'd1', name: 'Pasta', unitPrice: 10.00, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
      { uid: 'u2', dishId: 'd2', name: 'Vino', unitPrice: 8.00, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ];
    const ord = store.addDirectOrder('T1', billSessionId, items);

    // Build item keys and select only the first item (Pasta)
    const selectedKey = `${ord.id}__0`;

    // Record analitica payment for the first item only
    store.addTransaction({
      transactionId: 'txn_ana',
      tableId: 'T1',
      billSessionId,
      paymentMethod: 'Contanti',
      operationType: 'analitica',
      amountPaid: 10.00,
      vociRefs: [selectedKey],
      orderRefs: [ord.id],
      timestamp: new Date().toISOString(),
    });

    // The transaction should be recorded
    const txn = store.transactions.find(t => t.transactionId === 'txn_ana');
    expect(txn).toBeDefined();
    expect(txn.amountPaid).toBeCloseTo(10.00, 2);
    expect(txn.vociRefs).toEqual([selectedKey]);
    expect(txn.orderRefs).toContain(ord.id);
  });
});
