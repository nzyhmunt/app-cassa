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

  it('sets itemCount to the sum of active (non-voided) quantities', () => {
    const store = useAppStore();
    const items = [
      { uid: 'test_11a', dishId: 'bev_1', name: 'Acqua', unitPrice: 2.00, quantity: 3, voidedQuantity: 0, notes: [], modifiers: [] },
      { uid: 'test_11b', dishId: 'cafe_1', name: 'Caffè', unitPrice: 1.50, quantity: 2, voidedQuantity: 0, notes: [], modifiers: [] },
    ];
    const result = store.addDirectOrder('01', 'session_abc', items);

    expect(result.itemCount).toBe(5);
  });

  it('voidedQuantity reduces itemCount and totalAmount', () => {
    const store = useAppStore();
    const items = [
      { uid: 'test_12', dishId: 'bev_1', name: 'Acqua', unitPrice: 2.00, quantity: 3, voidedQuantity: 1, notes: [], modifiers: [] },
    ];
    const result = store.addDirectOrder('01', 'session_abc', items);

    // active = 3 - 1 = 2
    expect(result.itemCount).toBe(2);
    expect(result.totalAmount).toBeCloseTo(4.00, 2);
  });

  it('two direct orders for the same table and session stack in getTableStatus total', () => {
    const store = useAppStore();
    store.openTableSession('06', 2, 0);
    const session = store.tableCurrentBillSession['06'];

    store.addDirectOrder('06', session.billSessionId, [
      { uid: 'test_13a', dishId: 'bev_1', name: 'Acqua', unitPrice: 2.00, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ]);
    store.addDirectOrder('06', session.billSessionId, [
      { uid: 'test_13b', dishId: 'cafe_1', name: 'Caffè', unitPrice: 1.50, quantity: 2, voidedQuantity: 0, notes: [], modifiers: [] },
    ]);

    const { total } = store.getTableStatus('06');
    expect(total).toBeCloseTo(5.00, 2);
  });

  it('leaves the table status as occupied (not pending) after creation', () => {
    const store = useAppStore();
    store.openTableSession('07', 2, 0);
    const session = store.tableCurrentBillSession['07'];

    store.addDirectOrder('07', session.billSessionId, [
      { uid: 'test_14', dishId: 'cafe_1', name: 'Caffè', unitPrice: 1.50, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ]);

    const { status } = store.getTableStatus('07');
    expect(status).toBe('occupied');
  });

  it('assigns a unique string id prefixed with "ord_"', () => {
    const store = useAppStore();
    const items = [
      { uid: 'test_15', dishId: 'cafe_1', name: 'Caffè', unitPrice: 1.50, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ];
    const result = store.addDirectOrder('01', 'session_abc', items);

    expect(typeof result.id).toBe('string');
    expect(result.id).toMatch(/^ord_/);
  });

  it('two successive calls produce different order ids', () => {
    const store = useAppStore();
    const items = [
      { uid: 'test_16', dishId: 'cafe_1', name: 'Caffè', unitPrice: 1.50, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ];

    const a = store.addDirectOrder('01', 'session_abc', items);
    const b = store.addDirectOrder('01', 'session_abc', items);

    expect(a.id).not.toBe(b.id);
  });
});

// ---------------------------------------------------------------------------
// Cover charge via Sala (regression: must use addDirectOrder, not addOrder)
// ---------------------------------------------------------------------------
describe('cover charge via Sala app', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('cover charge created with addDirectOrder has isDirectEntry=true', () => {
    const store = useAppStore();
    store.openTableSession('01', 2, 0);
    const session = store.tableCurrentBillSession['01'];

    const coverItems = [
      { uid: 'cop_a_test', dishId: 'coperto_adulto', name: 'Coperto', unitPrice: 2.00, quantity: 2, voidedQuantity: 0, notes: [] },
    ];
    const coverOrder = store.addDirectOrder('01', session.billSessionId, coverItems);
    if (coverOrder) coverOrder.isCoverCharge = true;

    expect(coverOrder).not.toBeNull();
    expect(coverOrder.isDirectEntry).toBe(true);
    expect(coverOrder.isCoverCharge).toBe(true);
    expect(coverOrder.status).toBe('accepted');
  });

  it('cover charge created with addDirectOrder does not appear as pending (kitchen-bound)', () => {
    const store = useAppStore();
    store.openTableSession('02', 3, 1);
    const session = store.tableCurrentBillSession['02'];

    const coverItems = [
      { uid: 'cop_a_r', dishId: 'coperto_adulto', name: 'Coperto', unitPrice: 2.00, quantity: 3, voidedQuantity: 0, notes: [] },
      { uid: 'cop_c_r', dishId: 'coperto_bambino', name: 'Coperto bambino', unitPrice: 1.00, quantity: 1, voidedQuantity: 0, notes: [] },
    ];
    const coverOrder = store.addDirectOrder('02', session.billSessionId, coverItems);
    if (coverOrder) coverOrder.isCoverCharge = true;

    // Must NOT be pending — pending orders would be routed to the kitchen queue
    expect(coverOrder.status).not.toBe('pending');
    expect(coverOrder.isDirectEntry).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Kitchen exclusion — direct orders from Cassa must NOT appear in kitchen views
// Reproduces the filter used by CucinaView.vue computed properties to prevent
// regressions: store.orders.filter(o => [...statuses].includes(o.status) && !o.isDirectEntry)
// ---------------------------------------------------------------------------
describe('kitchen exclusion for direct orders', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('direct order is excluded from the kitchen accepted-orders queue', () => {
    const store = useAppStore();
    store.addDirectOrder('01', 'session_k1', [
      { uid: 'k_1', dishId: 'cafe_1', name: 'Caffè', unitPrice: 1.50, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ]);

    // This mirrors the CucinaView pendingOrders / allKitchenOrders filter
    const kitchenOrders = store.orders.filter(
      o => ['accepted', 'preparing', 'ready'].includes(o.status) && !o.isDirectEntry,
    );
    expect(kitchenOrders).toHaveLength(0);
  });

  it('regular order IS visible to the kitchen while direct order is not', () => {
    const store = useAppStore();

    // Regular comanda: starts pending (kitchen-bound)
    store.openTableSession('03', 2, 0);
    const session = store.tableCurrentBillSession['03'];
    const regularOrder = {
      id: 'ord_reg_test',
      table: '03',
      billSessionId: session.billSessionId,
      status: 'accepted',
      time: '19:00',
      totalAmount: 10,
      itemCount: 1,
      dietaryPreferences: {},
      orderItems: [
        { uid: 'reg_1', dishId: 'pri_1', name: 'Pasta', unitPrice: 10, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
      ],
      globalNote: '',
      noteVisibility: { cassa: true, sala: true, cucina: true },
    };
    store.addOrder(regularOrder);

    // Direct voce: should bypass kitchen
    store.addDirectOrder('03', session.billSessionId, [
      { uid: 'd_1', dishId: 'cafe_1', name: 'Caffè', unitPrice: 1.50, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ]);

    const kitchenOrders = store.orders.filter(
      o => ['accepted', 'preparing', 'ready'].includes(o.status) && !o.isDirectEntry,
    );
    expect(kitchenOrders).toHaveLength(1);
    expect(kitchenOrders[0].id).toBe('ord_reg_test');
  });

  it('multiple direct orders from Cassa are all excluded from every kitchen status queue', () => {
    const store = useAppStore();
    const items = [
      { uid: 'mk_1', dishId: 'bev_1', name: 'Acqua', unitPrice: 2.00, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ];

    store.addDirectOrder('05', 'sess_a', items);
    store.addDirectOrder('06', 'sess_b', items);
    store.addDirectOrder('07', 'sess_c', items);

    // Simulate the CucinaView accepted / preparing / ready / delivered filters
    const accepted  = store.orders.filter(o => o.status === 'accepted'  && !o.isDirectEntry);
    const preparing = store.orders.filter(o => o.status === 'preparing' && !o.isDirectEntry);
    const ready     = store.orders.filter(o => o.status === 'ready'     && !o.isDirectEntry);
    const delivered = store.orders.filter(o => o.status === 'delivered' && !o.isDirectEntry);

    expect(accepted).toHaveLength(0);
    expect(preparing).toHaveLength(0);
    expect(ready).toHaveLength(0);
    expect(delivered).toHaveLength(0);
  });
});
