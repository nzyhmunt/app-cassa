import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAppStore } from '../index.js';

// Prevent real network requests while loading the menu
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false,
    status: 503,
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// addDirectOrder()
// ---------------------------------------------------------------------------
describe('addDirectOrder()', () => {
  beforeEach(() => {
    // Use a fresh Pinia instance (without the persistedstate plugin) for each test
    setActivePinia(createPinia());
  });

  it('creates an order with isDirectEntry=true', () => {
    const store = useAppStore();
    const items = [
      { uid: 'test_1', dishId: 'cafe_1', name: 'Caffè', unitPrice: 1.50, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ];
    const result = store.addDirectOrder('01', 'session_abc', items);

    expect(result).not.toBeNull();
    expect(result.isDirectEntry).toBe(true);
  });

  it('sets the order status to accepted immediately', () => {
    const store = useAppStore();
    const items = [
      { uid: 'test_2', dishId: 'srv_1', name: 'Costo Servizio', unitPrice: 5.00, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ];
    const result = store.addDirectOrder('02', 'session_xyz', items);

    expect(result.status).toBe('accepted');
  });

  it('correctly attaches table and billSessionId to the order', () => {
    const store = useAppStore();
    const items = [
      { uid: 'test_3', dishId: 'bev_1', name: 'Acqua', unitPrice: 2.00, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ];
    const result = store.addDirectOrder('05', 'bill_999', items);

    expect(result.table).toBe('05');
    expect(result.billSessionId).toBe('bill_999');
  });

  it('calculates totalAmount from the provided items', () => {
    const store = useAppStore();
    const items = [
      { uid: 'test_4a', dishId: 'bev_1', name: 'Acqua', unitPrice: 2.00, quantity: 2, voidedQuantity: 0, notes: [], modifiers: [] },
      { uid: 'test_4b', dishId: 'cafe_1', name: 'Caffè', unitPrice: 1.50, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ];
    const result = store.addDirectOrder('01', 'session_abc', items);

    expect(result.totalAmount).toBeCloseTo(5.50, 2);
  });

  it('adds the order to the store orders list', () => {
    const store = useAppStore();
    const initialCount = store.orders.length;
    const items = [
      { uid: 'test_5', dishId: 'cafe_1', name: 'Caffè', unitPrice: 1.50, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ];

    store.addDirectOrder('03', 'session_direct', items);

    expect(store.orders.length).toBe(initialCount + 1);
    const added = store.orders.find(o => o.isDirectEntry && o.table === '03');
    expect(added).toBeDefined();
  });

  it('returns null and does not add an order when items array is empty', () => {
    const store = useAppStore();
    const initialCount = store.orders.length;

    const result = store.addDirectOrder('01', 'session_abc', []);

    expect(result).toBeNull();
    expect(store.orders.length).toBe(initialCount);
  });

  it('returns null when tableId is falsy', () => {
    const store = useAppStore();
    const items = [
      { uid: 'test_7', dishId: 'cafe_1', name: 'Caffè', unitPrice: 1.50, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ];

    const result = store.addDirectOrder('', 'session_abc', items);
    expect(result).toBeNull();
  });

  it('accepts null billSessionId', () => {
    const store = useAppStore();
    const items = [
      { uid: 'test_8', dishId: 'cafe_1', name: 'Caffè', unitPrice: 1.50, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ];

    const result = store.addDirectOrder('01', null, items);

    expect(result).not.toBeNull();
    expect(result.billSessionId).toBeNull();
  });

  it('makes a deep copy of items so the original array is not mutated', () => {
    const store = useAppStore();
    const items = [
      { uid: 'test_9', dishId: 'cafe_1', name: 'Caffè', unitPrice: 1.50, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ];
    const originalItem = items[0];

    const result = store.addDirectOrder('01', 'session_copy', items);

    expect(result.orderItems[0]).not.toBe(originalItem);
    expect(result.orderItems[0].name).toBe('Caffè');
  });

  it('direct order is included in getTableStatus total when accepted', () => {
    const store = useAppStore();
    store.openTableSession('04', 2, 0);
    const session = store.tableCurrentBillSession['04'];

    store.addDirectOrder('04', session.billSessionId, [
      { uid: 'test_10', dishId: 'cafe_1', name: 'Caffè', unitPrice: 2.00, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ]);

    const { total } = store.getTableStatus('04');
    expect(total).toBeCloseTo(2.00, 2);
  });
});
