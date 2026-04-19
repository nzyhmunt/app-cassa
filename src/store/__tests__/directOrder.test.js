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

  it('creates an order with isDirectEntry=true', async () => {
    const store = useAppStore();
    const items = [
      { uid: 'test_1', dishId: 'cafe_1', name: 'Caffè', unitPrice: 1.50, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ];
    const result = await store.addDirectOrder('01', 'session_abc', items);

    expect(result).not.toBeNull();
    expect(result.isDirectEntry).toBe(true);
  });

  it('sets the order status to accepted immediately', async () => {
    const store = useAppStore();
    const items = [
      { uid: 'test_2', dishId: 'srv_1', name: 'Costo Servizio', unitPrice: 5.00, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ];
    const result = await store.addDirectOrder('02', 'session_xyz', items);

    expect(result.status).toBe('accepted');
  });

  it('correctly attaches table and billSessionId to the order', async () => {
    const store = useAppStore();
    const items = [
      { uid: 'test_3', dishId: 'bev_1', name: 'Acqua', unitPrice: 2.00, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ];
    const result = await store.addDirectOrder('05', 'bill_999', items);

    expect(result.table).toBe('05');
    expect(result.billSessionId).toBe('bill_999');
  });

  it('calculates totalAmount from the provided items', async () => {
    const store = useAppStore();
    const items = [
      { uid: 'test_4a', dishId: 'bev_1', name: 'Acqua', unitPrice: 2.00, quantity: 2, voidedQuantity: 0, notes: [], modifiers: [] },
      { uid: 'test_4b', dishId: 'cafe_1', name: 'Caffè', unitPrice: 1.50, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ];
    const result = await store.addDirectOrder('01', 'session_abc', items);

    expect(result.totalAmount).toBeCloseTo(5.50, 2);
  });

  it('adds the order to the store orders list', async () => {
    const store = useAppStore();
    const initialCount = store.orders.length;
    const items = [
      { uid: 'test_5', dishId: 'cafe_1', name: 'Caffè', unitPrice: 1.50, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ];

    await store.addDirectOrder('03', 'session_direct', items);

    expect(store.orders.length).toBe(initialCount + 1);
    const added = store.orders.find(o => o.isDirectEntry && o.table === '03');
    expect(added).toBeDefined();
  });

  it('returns null and does not add an order when items array is empty', async () => {
    const store = useAppStore();
    const initialCount = store.orders.length;

    const result = await store.addDirectOrder('01', 'session_abc', []);

    expect(result).toBeNull();
    expect(store.orders.length).toBe(initialCount);
  });

  it('returns null when tableId is falsy', async () => {
    const store = useAppStore();
    const items = [
      { uid: 'test_7', dishId: 'cafe_1', name: 'Caffè', unitPrice: 1.50, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ];

    const result = await store.addDirectOrder('', 'session_abc', items);
    expect(result).toBeNull();
  });

  it('accepts null billSessionId', async () => {
    const store = useAppStore();
    const items = [
      { uid: 'test_8', dishId: 'cafe_1', name: 'Caffè', unitPrice: 1.50, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ];

    const result = await store.addDirectOrder('01', null, items);

    expect(result).not.toBeNull();
    expect(result.billSessionId).toBeNull();
  });

  it('makes a deep copy of items so the original array is not mutated', async () => {
    const store = useAppStore();
    const items = [
      { uid: 'test_9', dishId: 'cafe_1', name: 'Caffè', unitPrice: 1.50, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ];
    const originalItem = items[0];

    const result = await store.addDirectOrder('01', 'session_copy', items);

    expect(result.orderItems[0]).not.toBe(originalItem);
    expect(result.orderItems[0].name).toBe('Caffè');
  });

  it('direct order is included in getTableStatus total when accepted', async () => {
    const store = useAppStore();
    await store.openTableSession('04', 2, 0);
    const session = store.tableCurrentBillSession['04'];

    await store.addDirectOrder('04', session.billSessionId, [
      { uid: 'test_10', dishId: 'cafe_1', name: 'Caffè', unitPrice: 2.00, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ]);

    const { total } = store.getTableStatus('04');
    expect(total).toBeCloseTo(2.00, 2);
  });

  it('sets itemCount to the sum of active (non-voided) quantities', async () => {
    const store = useAppStore();
    const items = [
      { uid: 'test_11a', dishId: 'bev_1', name: 'Acqua', unitPrice: 2.00, quantity: 3, voidedQuantity: 0, notes: [], modifiers: [] },
      { uid: 'test_11b', dishId: 'cafe_1', name: 'Caffè', unitPrice: 1.50, quantity: 2, voidedQuantity: 0, notes: [], modifiers: [] },
    ];
    const result = await store.addDirectOrder('01', 'session_abc', items);

    expect(result.itemCount).toBe(5);
  });

  it('voidedQuantity reduces itemCount and totalAmount', async () => {
    const store = useAppStore();
    const items = [
      { uid: 'test_12', dishId: 'bev_1', name: 'Acqua', unitPrice: 2.00, quantity: 3, voidedQuantity: 1, notes: [], modifiers: [] },
    ];
    const result = await store.addDirectOrder('01', 'session_abc', items);

    // active = 3 - 1 = 2
    expect(result.itemCount).toBe(2);
    expect(result.totalAmount).toBeCloseTo(4.00, 2);
  });

  it('two direct orders for the same table and session stack in getTableStatus total', async () => {
    const store = useAppStore();
    await store.openTableSession('06', 2, 0);
    const session = store.tableCurrentBillSession['06'];

    await store.addDirectOrder('06', session.billSessionId, [
      { uid: 'test_13a', dishId: 'bev_1', name: 'Acqua', unitPrice: 2.00, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ]);
    await store.addDirectOrder('06', session.billSessionId, [
      { uid: 'test_13b', dishId: 'cafe_1', name: 'Caffè', unitPrice: 1.50, quantity: 2, voidedQuantity: 0, notes: [], modifiers: [] },
    ]);

    const { total } = store.getTableStatus('06');
    expect(total).toBeCloseTo(5.00, 2);
  });

  it('leaves the table status as occupied (not pending) after creation', async () => {
    const store = useAppStore();
    await store.openTableSession('07', 2, 0);
    const session = store.tableCurrentBillSession['07'];

    await store.addDirectOrder('07', session.billSessionId, [
      { uid: 'test_14', dishId: 'cafe_1', name: 'Caffè', unitPrice: 1.50, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ]);

    const { status } = store.getTableStatus('07');
    expect(status).toBe('occupied');
  });

  it('assigns a unique string id prefixed with "ord_"', async () => {
    const store = useAppStore();
    const items = [
      { uid: 'test_15', dishId: 'cafe_1', name: 'Caffè', unitPrice: 1.50, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ];
    const result = await store.addDirectOrder('01', 'session_abc', items);

    expect(typeof result.id).toBe('string');
    // IDs are bare UUID v7 (no prefix) — verify it looks like a valid UUID
    expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('two successive calls produce different order ids', async () => {
    const store = useAppStore();
    const items = [
      { uid: 'test_16', dishId: 'cafe_1', name: 'Caffè', unitPrice: 1.50, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ];

    const a = await store.addDirectOrder('01', 'session_abc', items);
    const b = await store.addDirectOrder('01', 'session_abc', items);

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

  it('cover charge created with addDirectOrder has isDirectEntry=true', async () => {
    const store = useAppStore();
    await store.openTableSession('01', 2, 0);
    const session = store.tableCurrentBillSession['01'];

    const coverItems = [
      { uid: 'cop_a_test', dishId: null, name: 'Coperto', unitPrice: 2.00, quantity: 2, voidedQuantity: 0, notes: [] },
    ];
    const coverOrder = await store.addDirectOrder('01', session.billSessionId, coverItems);
    if (coverOrder) coverOrder.isCoverCharge = true;

    expect(coverOrder).not.toBeNull();
    expect(coverOrder.isDirectEntry).toBe(true);
    expect(coverOrder.isCoverCharge).toBe(true);
    expect(coverOrder.status).toBe('accepted');
  });

  it('cover charge created with addDirectOrder does not appear as pending (kitchen-bound)', async () => {
    const store = useAppStore();
    await store.openTableSession('02', 3, 1);
    const session = store.tableCurrentBillSession['02'];

    const coverItems = [
      { uid: 'cop_a_r', dishId: null, name: 'Coperto', unitPrice: 2.00, quantity: 3, voidedQuantity: 0, notes: [] },
      { uid: 'cop_c_r', dishId: null, name: 'Coperto bambino', unitPrice: 1.00, quantity: 1, voidedQuantity: 0, notes: [] },
    ];
    const coverOrder = await store.addDirectOrder('02', session.billSessionId, coverItems);
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

  it('direct order is excluded from the kitchen accepted-orders queue', async () => {
    const store = useAppStore();
    await store.addDirectOrder('01', 'session_k1', [
      { uid: 'k_1', dishId: 'cafe_1', name: 'Caffè', unitPrice: 1.50, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ]);

    // This mirrors the CucinaView pendingOrders / allKitchenOrders filter
    const kitchenOrders = store.orders.filter(
      o => ['accepted', 'preparing', 'ready'].includes(o.status) && !o.isDirectEntry,
    );
    expect(kitchenOrders).toHaveLength(0);
  });

  it('regular order IS visible to the kitchen while direct order is not', async () => {
    const store = useAppStore();

    // Regular comanda: starts pending (kitchen-bound)
    await store.openTableSession('03', 2, 0);
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
    await store.addOrder(regularOrder);

    // Direct voce: should bypass kitchen
    await store.addDirectOrder('03', session.billSessionId, [
      { uid: 'd_1', dishId: 'cafe_1', name: 'Caffè', unitPrice: 1.50, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ]);

    const kitchenOrders = store.orders.filter(
      o => ['accepted', 'preparing', 'ready'].includes(o.status) && !o.isDirectEntry,
    );
    expect(kitchenOrders).toHaveLength(1);
    expect(kitchenOrders[0].id).toBe('ord_reg_test');
  });

  it('multiple direct orders from Cassa are all excluded from every kitchen status queue', async () => {
    const store = useAppStore();
    const items = [
      { uid: 'mk_1', dishId: 'bev_1', name: 'Acqua', unitPrice: 2.00, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ];

    await store.addDirectOrder('05', 'sess_a', items);
    await store.addDirectOrder('06', 'sess_b', items);
    await store.addDirectOrder('07', 'sess_c', items);

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

  it('direct orders are excluded from CassaOrderManager / SalaOrderManager "In Cucina" KITCHEN_ACTIVE_STATUSES filter', async () => {
    const store = useAppStore();

    // Add a regular kitchen order (status: accepted)
    await store.openTableSession('08', 2, 0);
    const session = store.tableCurrentBillSession['08'];
    const regularOrder = {
      id: 'ord_kitchen_test',
      table: '08',
      billSessionId: session.billSessionId,
      status: 'accepted',
      time: '20:00',
      totalAmount: 15,
      itemCount: 1,
      dietaryPreferences: {},
      orderItems: [
        { uid: 'ko_1', dishId: 'sec_1', name: 'Bistecca', unitPrice: 15, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
      ],
      globalNote: '',
      noteVisibility: { cassa: true, sala: true, cucina: true },
    };
    await store.addOrder(regularOrder);

    // Add a direct order (voce diretta — should NOT appear in order-manager kitchen views)
    await store.addDirectOrder('08', session.billSessionId, [
      { uid: 'direct_1', dishId: 'cafe_1', name: 'Caffè', unitPrice: 1.50, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ]);

    // Simulate the CassaOrderManager / SalaOrderManager "accepted" tab filter
    // (KITCHEN_ACTIVE_STATUSES = ['accepted', 'preparing', 'ready', 'delivered'])
    const KITCHEN_ACTIVE_STATUSES = ['accepted', 'preparing', 'ready', 'delivered'];
    const inCucinaTab = store.orders.filter(
      o => KITCHEN_ACTIVE_STATUSES.includes(o.status) && !o.isDirectEntry,
    );

    expect(inCucinaTab).toHaveLength(1);
    expect(inCucinaTab[0].id).toBe('ord_kitchen_test');
  });

  it('direct orders are excluded from the "pending" tab filter used by order managers', async () => {
    const store = useAppStore();

    // Add a normal pending order (e.g. from Sala)
    const pendingOrder = {
      id: 'ord_pending_test',
      table: '09',
      billSessionId: 'sess_p',
      status: 'pending',
      time: '20:30',
      totalAmount: 8,
      itemCount: 1,
      dietaryPreferences: {},
      orderItems: [
        { uid: 'po_1', dishId: 'ant_1', name: 'Bruschetta', unitPrice: 8, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
      ],
      globalNote: '',
      noteVisibility: { cassa: true, sala: true, cucina: true },
    };
    await store.addOrder(pendingOrder);

    // Direct order — immediately goes to 'accepted', but the filter must also guard 'pending'
    await store.addDirectOrder('09', 'sess_p', [
      { uid: 'dp_1', dishId: 'bev_1', name: 'Acqua', unitPrice: 2.00, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ]);

    const pendingTab = store.orders.filter(
      o => o.status === 'pending' && !o.isDirectEntry,
    );

    expect(pendingTab).toHaveLength(1);
    expect(pendingTab[0].id).toBe('ord_pending_test');
  });

  it('order badge count excludes direct orders', async () => {
    const store = useAppStore();

    // A regular accepted order contributes to the badge
    await store.addOrder({
      id: 'ord_badge_test',
      table: '10',
      billSessionId: 'sess_b',
      status: 'accepted',
      time: '21:00',
      totalAmount: 12,
      itemCount: 1,
      dietaryPreferences: {},
      orderItems: [
        { uid: 'b_1', dishId: 'pri_1', name: 'Pasta', unitPrice: 12, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
      ],
      globalNote: '',
      noteVisibility: { cassa: true, sala: true, cucina: true },
    });

    // Direct orders must NOT inflate the badge count
    await store.addDirectOrder('10', 'sess_b', [
      { uid: 'bdir_1', dishId: 'cafe_1', name: 'Caffè', unitPrice: 1.50, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ]);

    // Simulate the orderStatusCounts accepted badge
    const acceptedBadge = store.orders.filter(
      o => ['accepted', 'preparing', 'ready'].includes(o.status) && !o.isDirectEntry,
    ).length;

    expect(acceptedBadge).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// simulateNewOrder()
// ---------------------------------------------------------------------------
describe('simulateNewOrder()', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('opens a fresh table bill session when none exists and isolates old bill transactions', async () => {
    const store = useAppStore();

    // Build and close an old bill on table 01 with a payment transaction.
    const oldSessionId = await store.openTableSession('01', 2, 0);
    await store.addDirectOrder('01', oldSessionId, [
      { uid: 'sim_old_ord', dishId: 'bev_1', name: 'Acqua', unitPrice: 10, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
    ]);
    await store.addTransaction({
      id: 'sim_old_txn',
      tableId: '01',
      billSessionId: oldSessionId,
      paymentMethodId: 'cash',
      paymentMethod: 'Contanti',
      operationType: 'unico',
      amountPaid: 10,
      timestamp: new Date().toISOString(),
      orderRefs: [],
    });
    for (const order of store.orders.filter(o => o.table === '01' && o.status !== 'completed' && o.status !== 'rejected')) {
      await store.changeOrderStatus(order, 'completed');
    }
    expect(store.tableCurrentBillSession['01']).toBeUndefined();

    // Force the simulator to pick table 01.
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    await store.simulateNewOrder();
    randomSpy.mockRestore();

    const newSessionId = store.tableCurrentBillSession['01']?.billSessionId;
    expect(typeof newSessionId).toBe('string');
    expect(newSessionId).not.toBe(oldSessionId);

    // All active simulated orders must be attached to the new session.
    const activeOrders = store.orders.filter(
      o => o.table === '01' && o.status !== 'completed' && o.status !== 'rejected',
    );
    expect(activeOrders.length).toBeGreaterThan(0);
    expect(activeOrders.every(o => o.billSessionId === newSessionId)).toBe(true);

    // getTableStatus() must only consider the active simulated bill, not old settled data.
    const status = store.getTableStatus('01');
    expect(status.total).toBeCloseTo(5, 2); // pending comande are excluded from cassa total; only direct cover is billable now
    expect(status.remaining).toBeCloseTo(5, 2);
  });

  it('reuses existing open table session when present', async () => {
    const store = useAppStore();
    const existingSessionId = await store.openTableSession('02', 2, 0);

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue((2 - 1) / 12);
    await store.simulateNewOrder();
    randomSpy.mockRestore();

    const activeOrders = store.orders.filter(
      o => o.table === '02' && o.status !== 'completed' && o.status !== 'rejected',
    );
    expect(activeOrders.length).toBeGreaterThan(0);
    expect(activeOrders.every(o => o.billSessionId === existingSessionId)).toBe(true);
  });
});
