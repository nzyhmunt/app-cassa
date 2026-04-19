import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const {
  runtime,
  saveStateToIDBMock,
  upsertBillSessionInIDBMock,
  closeBillSessionInIDBMock,
  enqueueMock,
} = vi.hoisted(() => {
  const runtimeState = {
    store: null,
    snapshots: [],
  };

  return {
    runtime: runtimeState,
    saveStateToIDBMock: vi.fn(async (payload) => {
      runtimeState.snapshots.push({
        type: 'save-state',
        payload,
        ordersLenAtCall: runtimeState.store?.orders?.length ?? 0,
        transactionsLenAtCall: runtimeState.store?.transactions?.length ?? 0,
        cashMovementsLenAtCall: runtimeState.store?.cashMovements?.length ?? 0,
      });
    }),
    upsertBillSessionInIDBMock: vi.fn(async (session) => {
      runtimeState.snapshots.push({
        type: 'upsert-bill-session',
        session,
        sessionAtCall: runtimeState.store?.tableCurrentBillSession?.[session.table] ?? null,
      });
    }),
    closeBillSessionInIDBMock: vi.fn(async () => {}),
    enqueueMock: vi.fn((collection, operation, recordId, payload) => {
      runtimeState.snapshots.push({
        type: 'enqueue',
        collection,
        operation,
        recordId,
        payload,
      });
    }),
  };
});

vi.mock('../persistence/operations.js', async () => {
  const actual = await vi.importActual('../persistence/operations.js');
  return {
    ...actual,
    saveStateToIDB: saveStateToIDBMock,
    upsertBillSessionInIDB: upsertBillSessionInIDBMock,
    closeBillSessionInIDB: closeBillSessionInIDBMock,
  };
});

vi.mock('../../composables/useSyncQueue.js', async () => {
  const actual = await vi.importActual('../../composables/useSyncQueue.js');
  return {
    ...actual,
    enqueue: enqueueMock,
  };
});

import { useAppStore } from '../index.js';

function makeOrder(id, table = 'T1', status = 'pending') {
  return {
    id,
    table,
    billSessionId: 'sess_1',
    status,
    time: '19:00',
    totalAmount: 10,
    itemCount: 1,
    dietaryPreferences: {},
    globalNote: '',
    noteVisibility: { cassa: true, sala: true, cucina: true },
    orderItems: [],
  };
}

function makeOrderWithItems(id, table = 'T1', status = 'accepted') {
  return {
    id,
    table,
    billSessionId: 'sess_1',
    status,
    time: '19:00',
    totalAmount: 20,
    itemCount: 2,
    dietaryPreferences: {},
    globalNote: '',
    noteVisibility: { cassa: true, sala: true, cucina: true },
    orderItems: [
      { uid: 'item_1', dishId: 'd1', name: 'Pasta', unitPrice: 10, quantity: 2, voidedQuantity: 0, notes: [], modifiers: [] },
    ],
  };
}

function makeOrderWithVoidedItem(id, table = 'T1', status = 'accepted') {
  return {
    id, table,
    billSessionId: 'sess_1', status, time: '19:00',
    totalAmount: 20, itemCount: 2, dietaryPreferences: {}, globalNote: '',
    noteVisibility: { cassa: true, sala: true, cucina: true },
    orderItems: [
      { uid: 'item_1', dishId: 'd1', name: 'Pasta', unitPrice: 10, quantity: 2, voidedQuantity: 1, notes: [], modifiers: [] },
    ],
  };
}

function makeOrderWithModifiers(id, table = 'T1', status = 'accepted') {
  return {
    id, table,
    billSessionId: 'sess_1', status, time: '19:00',
    totalAmount: 20, itemCount: 2, dietaryPreferences: {}, globalNote: '',
    noteVisibility: { cassa: true, sala: true, cucina: true },
    orderItems: [
      {
        uid: 'item_1', dishId: 'd1', name: 'Pasta', unitPrice: 10, quantity: 2, voidedQuantity: 0, notes: [],
        modifiers: [{ uid: 'mod_1', name: 'Extra', quantity: 2, unitPrice: 1, voidedQuantity: 0 }],
      },
    ],
  };
}

function makeOrderWithVoidedModifier(id, table = 'T1', status = 'accepted') {
  return {
    id, table,
    billSessionId: 'sess_1', status, time: '19:00',
    totalAmount: 20, itemCount: 2, dietaryPreferences: {}, globalNote: '',
    noteVisibility: { cassa: true, sala: true, cucina: true },
    orderItems: [
      {
        uid: 'item_1', dishId: 'd1', name: 'Pasta', unitPrice: 10, quantity: 2, voidedQuantity: 0, notes: [],
        modifiers: [{ uid: 'mod_1', name: 'Extra', quantity: 2, unitPrice: 1, voidedQuantity: 1 }],
      },
    ],
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
  setActivePinia(createPinia());
  runtime.store = null;
  runtime.snapshots = [];
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('P0-1 write order (IDB-first)', () => {
  it('addOrder invokes IDB persistence before reactive mutation and enqueue', async () => {
    const store = useAppStore();
    runtime.store = store;
    const order = makeOrder('ord_1');

    await store.addOrder(order);
    vi.advanceTimersByTime(200);

    const saveSnapshot = runtime.snapshots.find((entry) => entry.type === 'save-state');
    expect(saveSnapshot.ordersLenAtCall).toBe(0);
    expect(saveSnapshot.payload.orders).toHaveLength(1);
    expect(store.orders).toHaveLength(1);

    const saveCall = saveStateToIDBMock.mock.invocationCallOrder[0];
    const enqueueCall = enqueueMock.mock.invocationCallOrder[0];
    expect(saveCall).toBeLessThan(enqueueCall);
    expect(saveStateToIDBMock).toHaveBeenCalledTimes(1);
  });

  it('changeOrderStatus persists projected state before mutating order and enqueueing', async () => {
    const store = useAppStore();
    runtime.store = store;
    const order = makeOrder('ord_2', 'T2', 'pending');
    store.orders = [order];
    runtime.snapshots = [];
    vi.clearAllMocks();

    await store.changeOrderStatus(order, 'accepted');
    vi.advanceTimersByTime(200);

    const saveSnapshot = runtime.snapshots.find((entry) => entry.type === 'save-state');
    expect(saveSnapshot.ordersLenAtCall).toBe(1);
    expect(store.orders[0].status).toBe('accepted');

    const saveCall = saveStateToIDBMock.mock.invocationCallOrder[0];
    const enqueueCall = enqueueMock.mock.invocationCallOrder.find((_, idx) => (
      enqueueMock.mock.calls[idx][0] === 'orders' && enqueueMock.mock.calls[idx][1] === 'update'
    ));
    expect(saveCall).toBeLessThan(enqueueCall);
    expect(saveStateToIDBMock).toHaveBeenCalledTimes(1);
    const statusUpdateCall = enqueueMock.mock.calls.find(
      ([collection, operation]) => collection === 'orders' && operation === 'update',
    );
    expect(statusUpdateCall?.[3]).toEqual({ status: 'accepted', rejectionReason: null });
  });

  it('addTransaction writes projected transactions first, then updates state and queue', async () => {
    const store = useAppStore();
    runtime.store = store;
    store.setBillRequested('T3', true);
    runtime.snapshots = [];
    vi.clearAllMocks();

    await store.addTransaction({
      id: 'txn_1',
      tableId: 'T3',
      amountPaid: 10,
      tipAmount: 0,
      paymentMethod: 'Contanti',
      operationType: 'payment',
      timestamp: new Date().toISOString(),
    });
    vi.advanceTimersByTime(200);

    const saveSnapshot = runtime.snapshots.find((entry) => entry.type === 'save-state');
    expect(saveSnapshot.transactionsLenAtCall).toBe(0);
    expect(saveSnapshot.payload.transactions).toHaveLength(1);
    expect(store.transactions).toHaveLength(1);
    expect(store.billRequestedTables.has('T3')).toBe(false);

    const saveCall = saveStateToIDBMock.mock.invocationCallOrder[0];
    const enqueueCall = enqueueMock.mock.invocationCallOrder.find((_, idx) => (
      enqueueMock.mock.calls[idx][0] === 'transactions' && enqueueMock.mock.calls[idx][1] === 'create'
    ));
    expect(saveCall).toBeLessThan(enqueueCall);
    expect(saveStateToIDBMock).toHaveBeenCalledTimes(1);
  });

  it('openTableSession persists bill session to IDB before state mutation and enqueue', async () => {
    const store = useAppStore();
    runtime.store = store;

    const billSessionId = await store.openTableSession('T4', 2, 1);

    const upsertSnapshot = runtime.snapshots.find((entry) => entry.type === 'upsert-bill-session');
    expect(upsertSnapshot.sessionAtCall).toBeNull();
    expect(store.tableCurrentBillSession.T4.billSessionId).toBe(billSessionId);

    const upsertCall = upsertBillSessionInIDBMock.mock.invocationCallOrder[0];
    const enqueueCall = enqueueMock.mock.invocationCallOrder.find((_, idx) => (
      enqueueMock.mock.calls[idx][0] === 'bill_sessions' && enqueueMock.mock.calls[idx][1] === 'create'
    ));
    expect(upsertCall).toBeLessThan(enqueueCall);
  });

  it('addCashMovement saves to IDB before updating reactive state and enqueue', async () => {
    const store = useAppStore();
    runtime.store = store;

    await store.addCashMovement('in', 15, 'Test');
    vi.advanceTimersByTime(200);

    const saveSnapshot = runtime.snapshots.find((entry) => entry.type === 'save-state');
    expect(saveSnapshot.cashMovementsLenAtCall).toBe(0);
    expect(saveSnapshot.payload.cashMovements).toHaveLength(1);
    expect(store.cashMovements).toHaveLength(1);

    const saveCall = saveStateToIDBMock.mock.invocationCallOrder[0];
    const enqueueCall = enqueueMock.mock.invocationCallOrder.find((_, idx) => (
      enqueueMock.mock.calls[idx][0] === 'cash_movements' && enqueueMock.mock.calls[idx][1] === 'create'
    ));
    expect(saveCall).toBeLessThan(enqueueCall);
    expect(saveStateToIDBMock).toHaveBeenCalledTimes(1);
  });
});

describe('P0-1 IDB rejection — state must not mutate when IDB write fails', () => {
  const idbError = new Error('IDB write failed');

  it('addOrder does not mutate orders when IDB rejects', async () => {
    const store = useAppStore();
    saveStateToIDBMock.mockRejectedValueOnce(idbError);

    await expect(store.addOrder(makeOrder('ord_fail'))).rejects.toThrow('IDB write failed');
    expect(store.orders).toHaveLength(0);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('changeOrderStatus does not mutate order when IDB rejects', async () => {
    const store = useAppStore();
    const order = makeOrder('ord_fail2', 'T5', 'pending');
    store.orders = [order];
    saveStateToIDBMock.mockRejectedValueOnce(idbError);

    await expect(store.changeOrderStatus(order, 'accepted')).rejects.toThrow('IDB write failed');
    expect(store.orders[0].status).toBe('pending');
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('addCashMovement does not mutate cashMovements when IDB rejects', async () => {
    const store = useAppStore();
    saveStateToIDBMock.mockRejectedValueOnce(idbError);

    await expect(store.addCashMovement('in', 20, 'Test')).rejects.toThrow('IDB write failed');
    expect(store.cashMovements).toHaveLength(0);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('openTableSession does not mutate tableCurrentBillSession when IDB rejects', async () => {
    const store = useAppStore();
    upsertBillSessionInIDBMock.mockRejectedValueOnce(idbError);

    await expect(store.openTableSession('T6', 1, 0)).rejects.toThrow('IDB write failed');
    expect(store.tableCurrentBillSession['T6']).toBeUndefined();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('addTransaction does not mutate transactions when IDB rejects', async () => {
    const store = useAppStore();
    saveStateToIDBMock.mockRejectedValueOnce(idbError);

    await expect(store.addTransaction({
      id: 'txn_fail',
      tableId: 'T7',
      amountPaid: 10,
      tipAmount: 0,
      paymentMethod: 'Contanti',
      operationType: 'payment',
      timestamp: new Date().toISOString(),
    })).rejects.toThrow('IDB write failed');
    expect(store.transactions).toHaveLength(0);
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});

describe('P0-2 IDB-first — order item mutations', () => {
  it('updateQtyGlobal saves projected order to IDB before reactive mutation and enqueue', async () => {
    const store = useAppStore();
    runtime.store = store;
    const order = makeOrderWithItems('ord_qty', 'T1', 'pending');
    await store.addOrder(order);
    runtime.snapshots = [];
    vi.clearAllMocks();

    const liveOrder = store.orders.find(o => o.id === 'ord_qty');
    await store.updateQtyGlobal(liveOrder, 0, 1);
    vi.advanceTimersByTime(200);

    const saveSnapshot = runtime.snapshots.find(e => e.type === 'save-state');
    expect(saveSnapshot).toBeDefined();
    // IDB was called with the updated quantity before orders.value was mutated
    expect(saveSnapshot.payload.orders[0].orderItems[0].quantity).toBe(3);

    const saveCall = saveStateToIDBMock.mock.invocationCallOrder[0];
    const enqueueCall = enqueueMock.mock.invocationCallOrder[0];
    expect(saveCall).toBeLessThan(enqueueCall);
    expect(saveStateToIDBMock).toHaveBeenCalledTimes(1);
    const [, , , payload] = enqueueMock.mock.calls[0];
    expect(Object.keys(payload).sort()).toEqual(['itemCount', 'orderItems', 'totalAmount']);
    expect(payload.orderItems).not.toBe(store.orders[0].orderItems);
  });

  it('updateQtyGlobal does not mutate orders when IDB rejects', async () => {
    const store = useAppStore();
    const order = makeOrderWithItems('ord_qty_fail', 'T1', 'pending');
    store.orders = [order];
    saveStateToIDBMock.mockRejectedValueOnce(new Error('IDB write failed'));

    const result = await store.updateQtyGlobal(order, 0, 1);
    expect(result).toBe(false);
    // quantity must remain unchanged
    expect(store.orders[0].orderItems[0].quantity).toBe(2);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('voidOrderItems saves projected state to IDB before reactive mutation', async () => {
    const store = useAppStore();
    runtime.store = store;
    const order = makeOrderWithItems('ord_void');
    await store.addOrder(order);
    runtime.snapshots = [];
    vi.clearAllMocks();

    const liveOrder = store.orders.find(o => o.id === 'ord_void');
    await store.voidOrderItems(liveOrder, 0, 1);
    vi.advanceTimersByTime(200);

    const saveSnapshot = runtime.snapshots.find(e => e.type === 'save-state');
    expect(saveSnapshot).toBeDefined();
    expect(saveSnapshot.payload.orders[0].orderItems[0].voidedQuantity).toBe(1);

    const saveCall = saveStateToIDBMock.mock.invocationCallOrder[0];
    const enqueueCall = enqueueMock.mock.invocationCallOrder[0];
    expect(saveCall).toBeLessThan(enqueueCall);
    expect(saveStateToIDBMock).toHaveBeenCalledTimes(1);
    const [, , , payload] = enqueueMock.mock.calls[0];
    expect(Object.keys(payload).sort()).toEqual(['itemCount', 'orderItems', 'totalAmount']);
  });

  it('removeRowGlobal removes item in IDB before reactive mutation', async () => {
    const store = useAppStore();
    runtime.store = store;
    const order = makeOrderWithItems('ord_remove', 'T1', 'pending');
    await store.addOrder(order);
    runtime.snapshots = [];
    vi.clearAllMocks();

    const liveOrder = store.orders.find(o => o.id === 'ord_remove');
    await store.removeRowGlobal(liveOrder, 0);
    vi.advanceTimersByTime(200);

    const saveSnapshot = runtime.snapshots.find(e => e.type === 'save-state');
    expect(saveSnapshot).toBeDefined();
    expect(saveSnapshot.payload.orders[0].orderItems).toHaveLength(0);

    const saveCall = saveStateToIDBMock.mock.invocationCallOrder[0];
    const enqueueCall = enqueueMock.mock.invocationCallOrder[0];
    expect(saveCall).toBeLessThan(enqueueCall);
    expect(saveStateToIDBMock).toHaveBeenCalledTimes(1);
    const [, , , payload] = enqueueMock.mock.calls[0];
    expect(Object.keys(payload).sort()).toEqual(['itemCount', 'orderItems', 'totalAmount']);
  });

  it('removeRowGlobal returns false and leaves state unchanged when IDB rejects', async () => {
    const store = useAppStore();
    const order = makeOrderWithItems('ord_remove_fail', 'T1', 'pending');
    store.orders = [order];
    saveStateToIDBMock.mockRejectedValueOnce(new Error('IDB fail'));

    const result = await store.removeRowGlobal(order, 0);
    expect(result).toBe(false);
    expect(store.orders[0].orderItems).toHaveLength(1);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('restoreOrderItems saves projected state to IDB before reactive mutation', async () => {
    const store = useAppStore();
    runtime.store = store;
    const order = makeOrderWithVoidedItem('ord_restore');
    await store.addOrder(order);
    runtime.snapshots = [];
    vi.clearAllMocks();

    const liveOrder = store.orders.find(o => o.id === 'ord_restore');
    await store.restoreOrderItems(liveOrder, 0, 1);
    vi.advanceTimersByTime(200);

    const saveSnapshot = runtime.snapshots.find(e => e.type === 'save-state');
    expect(saveSnapshot).toBeDefined();
    expect(saveSnapshot.payload.orders[0].orderItems[0].voidedQuantity).toBe(0);

    const saveCall = saveStateToIDBMock.mock.invocationCallOrder[0];
    const enqueueCall = enqueueMock.mock.invocationCallOrder[0];
    expect(saveCall).toBeLessThan(enqueueCall);
    expect(saveStateToIDBMock).toHaveBeenCalledTimes(1);
    const [, , , payload] = enqueueMock.mock.calls[0];
    expect(Object.keys(payload).sort()).toEqual(['itemCount', 'orderItems', 'totalAmount']);
  });

  it('restoreOrderItems returns false and leaves state unchanged when IDB rejects', async () => {
    const store = useAppStore();
    const order = makeOrderWithVoidedItem('ord_restore_fail');
    store.orders = [order];
    saveStateToIDBMock.mockRejectedValueOnce(new Error('IDB fail'));

    const result = await store.restoreOrderItems(order, 0, 1);
    expect(result).toBe(false);
    expect(store.orders[0].orderItems[0].voidedQuantity).toBe(1);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('voidModifier saves projected state to IDB before reactive mutation', async () => {
    const store = useAppStore();
    runtime.store = store;
    const order = makeOrderWithModifiers('ord_vmod');
    await store.addOrder(order);
    runtime.snapshots = [];
    vi.clearAllMocks();

    const liveOrder = store.orders.find(o => o.id === 'ord_vmod');
    await store.voidModifier(liveOrder, 0, 0, 1);
    vi.advanceTimersByTime(200);

    const saveSnapshot = runtime.snapshots.find(e => e.type === 'save-state');
    expect(saveSnapshot).toBeDefined();
    expect(saveSnapshot.payload.orders[0].orderItems[0].modifiers[0].voidedQuantity).toBe(1);

    const saveCall = saveStateToIDBMock.mock.invocationCallOrder[0];
    const enqueueCall = enqueueMock.mock.invocationCallOrder[0];
    expect(saveCall).toBeLessThan(enqueueCall);
    expect(saveStateToIDBMock).toHaveBeenCalledTimes(1);
    const [, , , payload] = enqueueMock.mock.calls[0];
    expect(Object.keys(payload).sort()).toEqual(['itemCount', 'orderItems', 'totalAmount']);
  });

  it('voidModifier returns false and leaves state unchanged when IDB rejects', async () => {
    const store = useAppStore();
    const order = makeOrderWithModifiers('ord_vmod_fail');
    store.orders = [order];
    saveStateToIDBMock.mockRejectedValueOnce(new Error('IDB fail'));

    const result = await store.voidModifier(order, 0, 0, 1);
    expect(result).toBe(false);
    expect(store.orders[0].orderItems[0].modifiers[0].voidedQuantity).toBe(0);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('restoreModifier saves projected state to IDB before reactive mutation', async () => {
    const store = useAppStore();
    runtime.store = store;
    const order = makeOrderWithVoidedModifier('ord_rmod');
    await store.addOrder(order);
    runtime.snapshots = [];
    vi.clearAllMocks();

    const liveOrder = store.orders.find(o => o.id === 'ord_rmod');
    await store.restoreModifier(liveOrder, 0, 0, 1);
    vi.advanceTimersByTime(200);

    const saveSnapshot = runtime.snapshots.find(e => e.type === 'save-state');
    expect(saveSnapshot).toBeDefined();
    expect(saveSnapshot.payload.orders[0].orderItems[0].modifiers[0].voidedQuantity).toBe(0);

    const saveCall = saveStateToIDBMock.mock.invocationCallOrder[0];
    const enqueueCall = enqueueMock.mock.invocationCallOrder[0];
    expect(saveCall).toBeLessThan(enqueueCall);
    expect(saveStateToIDBMock).toHaveBeenCalledTimes(1);
    const [, , , payload] = enqueueMock.mock.calls[0];
    expect(Object.keys(payload).sort()).toEqual(['itemCount', 'orderItems', 'totalAmount']);
  });

  it('restoreModifier returns false and leaves state unchanged when IDB rejects', async () => {
    const store = useAppStore();
    const order = makeOrderWithVoidedModifier('ord_rmod_fail');
    store.orders = [order];
    saveStateToIDBMock.mockRejectedValueOnce(new Error('IDB fail'));

    const result = await store.restoreModifier(order, 0, 0, 1);
    expect(result).toBe(false);
    expect(store.orders[0].orderItems[0].modifiers[0].voidedQuantity).toBe(1);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('setItemKitchenReady saves projected state to IDB before reactive mutation', async () => {
    const store = useAppStore();
    runtime.store = store;
    const order = makeOrderWithItems('ord_kitchen');
    await store.addOrder(order);
    runtime.snapshots = [];
    vi.clearAllMocks();

    const liveOrder = store.orders.find(o => o.id === 'ord_kitchen');
    await store.setItemKitchenReady(liveOrder, 0, true);
    vi.advanceTimersByTime(200);

    const saveSnapshot = runtime.snapshots.find(e => e.type === 'save-state');
    expect(saveSnapshot).toBeDefined();
    expect(saveSnapshot.payload.orders[0].orderItems[0].kitchenReady).toBe(true);

    const saveCall = saveStateToIDBMock.mock.invocationCallOrder[0];
    const enqueueCall = enqueueMock.mock.invocationCallOrder[0];
    expect(saveCall).toBeLessThan(enqueueCall);
    expect(saveStateToIDBMock).toHaveBeenCalledTimes(1);
    const [, , , payload] = enqueueMock.mock.calls[0];
    expect(Object.keys(payload).sort()).toEqual(['itemCount', 'orderItems', 'totalAmount']);
  });

  it('setItemKitchenReady returns false and leaves state unchanged when IDB rejects', async () => {
    const store = useAppStore();
    const order = makeOrderWithItems('ord_kitchen_fail');
    store.orders = [order];
    saveStateToIDBMock.mockRejectedValueOnce(new Error('IDB fail'));

    const result = await store.setItemKitchenReady(order, 0, true);
    expect(result).toBe(false);
    expect(store.orders[0].orderItems[0].kitchenReady).toBeFalsy();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('setBillRequested initiates IDB write before reactive state update', () => {
    const store = useAppStore();
    runtime.store = store;

    store.setBillRequested('T_bill', true);
    // Advance timers: confirm no watcher-driven debounced save fires on top of the explicit write.
    vi.advanceTimersByTime(200);

    // saveStateToIDB should have been called with the new Set
    expect(saveStateToIDBMock).toHaveBeenCalledTimes(1);
    const [payload] = saveStateToIDBMock.mock.calls[0];
    expect(payload.billRequestedTables.has('T_bill')).toBe(true);
    expect(store.billRequestedTables.has('T_bill')).toBe(true);
  });

  it('setCashBalance initiates IDB write before reactive state update', () => {
    const store = useAppStore();
    runtime.store = store;

    store.setFondoCassa(250);
    // Advance timers: confirm no watcher-driven debounced save fires on top of the explicit write.
    vi.advanceTimersByTime(200);

    expect(saveStateToIDBMock).toHaveBeenCalledTimes(1);
    const [payload] = saveStateToIDBMock.mock.calls[0];
    expect(payload.cashBalance).toBe(250);
    expect(store.cashBalance).toBe(250);
  });
});

describe('sync queue propagation — table mutations', () => {
  it('moveTableOrders to occupied target enqueues moved orders/transactions and bill-session updates', async () => {
    const store = useAppStore();
    runtime.store = store;
    const sessA = await store.openTableSession('A', 2, 0);
    const sessB = await store.openTableSession('B', 2, 0);
    const ordA = makeOrder('ord_move_occ', 'A', 'accepted');
    ordA.billSessionId = sessA;
    await store.addOrder(ordA);
    await store.addTransaction({
      id: 'txn_move_occ',
      tableId: 'A',
      billSessionId: sessA,
      amountPaid: 10,
      tipAmount: 0,
      paymentMethod: 'Contanti',
      operationType: 'payment',
      timestamp: new Date().toISOString(),
    });

    runtime.snapshots = [];
    vi.clearAllMocks();

    await store.moveTableOrders('A', 'B');

    const saveCallOrder = saveStateToIDBMock.mock.invocationCallOrder[0];
    const firstEnqueueOrder = enqueueMock.mock.invocationCallOrder[0];
    expect(saveCallOrder).toBeLessThan(firstEnqueueOrder);
    const firstUpsertCallOrder = upsertBillSessionInIDBMock.mock.invocationCallOrder[0];
    expect(saveCallOrder).toBeLessThan(firstUpsertCallOrder);

    const orderUpdateCall = enqueueMock.mock.calls.find(
      ([collection, operation, recordId]) => collection === 'orders' && operation === 'update' && recordId === ordA.id,
    );
    expect(orderUpdateCall?.[3]).toEqual({ table: 'B', billSessionId: sessB });

    const txnUpdateCall = enqueueMock.mock.calls.find(
      ([collection, operation, recordId]) => collection === 'transactions' && operation === 'update' && recordId === 'txn_move_occ',
    );
    expect(txnUpdateCall?.[3]).toEqual({ tableId: 'B', billSessionId: sessB });

    const targetSessionUpdate = enqueueMock.mock.calls.find(
      ([collection, operation, recordId]) => collection === 'bill_sessions' && operation === 'update' && recordId === sessB,
    );
    expect(targetSessionUpdate?.[3]).toMatchObject({ adults: 4, children: 0 });

    const sourceSessionClose = enqueueMock.mock.calls.find(
      ([collection, operation, recordId]) => collection === 'bill_sessions' && operation === 'update' && recordId === sessA,
    );
    expect(sourceSessionClose?.[3]?.status).toBe('closed');
    expect(typeof sourceSessionClose?.[3]?.closed_at).toBe('string');
    expect(upsertBillSessionInIDBMock).toHaveBeenCalledWith(expect.objectContaining({
      billSessionId: sessB,
      table: 'B',
      adults: 4,
      children: 0,
    }));
    expect(closeBillSessionInIDBMock).toHaveBeenCalledWith(sessA);
  });

  it('moveTableOrders to free target enqueues bill-session table retag', async () => {
    const store = useAppStore();
    runtime.store = store;
    const sessA = await store.openTableSession('A', 2, 1);
    const ordA = makeOrder('ord_move_free', 'A', 'accepted');
    ordA.billSessionId = sessA;
    await store.addOrder(ordA);

    runtime.snapshots = [];
    vi.clearAllMocks();

    await store.moveTableOrders('A', 'B');

    const sourceSessionUpdate = enqueueMock.mock.calls.find(
      ([collection, operation, recordId]) => collection === 'bill_sessions' && operation === 'update' && recordId === sessA,
    );
    expect(sourceSessionUpdate?.[3]).toEqual({ table: 'B' });
    expect(upsertBillSessionInIDBMock).toHaveBeenCalledWith(expect.objectContaining({
      billSessionId: sessA,
      table: 'B',
    }));
  });

  it('moveTableOrders keeps local reactive state but suppresses sync enqueue when saveStateToIDB fails', async () => {
    const store = useAppStore();
    runtime.store = store;
    const sessA = await store.openTableSession('A', 2, 0);
    const sessB = await store.openTableSession('B', 2, 0);
    const ordA = makeOrder('ord_move_fail', 'A', 'accepted');
    ordA.billSessionId = sessA;
    await store.addOrder(ordA);
    await store.addTransaction({
      id: 'txn_move_fail',
      tableId: 'A',
      billSessionId: sessA,
      amountPaid: 10,
      tipAmount: 0,
      paymentMethod: 'Contanti',
      operationType: 'payment',
      timestamp: new Date().toISOString(),
    });

    runtime.snapshots = [];
    vi.clearAllMocks();
    saveStateToIDBMock.mockRejectedValueOnce(new Error('IDB fail'));

    await store.moveTableOrders('A', 'B');

    expect(enqueueMock).not.toHaveBeenCalled();
    expect(upsertBillSessionInIDBMock).not.toHaveBeenCalled();
    expect(closeBillSessionInIDBMock).not.toHaveBeenCalled();
    expect(store.orders.find(o => o.id === ordA.id)?.table).toBe('B');
    expect(store.orders.find(o => o.id === ordA.id)?.billSessionId).toBe(sessB);
  });

  it('mergeTableOrders enqueues moved orders/transactions and bill-session updates', async () => {
    const store = useAppStore();
    runtime.store = store;
    const sessA = await store.openTableSession('A', 2, 1);
    const sessB = await store.openTableSession('B', 1, 0);
    const ordA = makeOrder('ord_merge', 'A', 'accepted');
    ordA.billSessionId = sessA;
    await store.addOrder(ordA);
    await store.addTransaction({
      id: 'txn_merge',
      tableId: 'A',
      billSessionId: sessA,
      amountPaid: 15,
      tipAmount: 0,
      paymentMethod: 'Contanti',
      operationType: 'payment',
      timestamp: new Date().toISOString(),
    });

    runtime.snapshots = [];
    vi.clearAllMocks();

    await store.mergeTableOrders('A', 'B');

    const saveCallOrder = saveStateToIDBMock.mock.invocationCallOrder[0];
    const firstEnqueueOrder = enqueueMock.mock.invocationCallOrder[0];
    expect(saveCallOrder).toBeLessThan(firstEnqueueOrder);

    const movedOrderUpdate = enqueueMock.mock.calls.find(
      ([collection, operation, recordId]) => collection === 'orders' && operation === 'update' && recordId === ordA.id,
    );
    expect(movedOrderUpdate?.[3]).toEqual({ table: 'B', billSessionId: sessB });

    const movedTxnUpdate = enqueueMock.mock.calls.find(
      ([collection, operation, recordId]) => collection === 'transactions' && operation === 'update' && recordId === 'txn_merge',
    );
    expect(movedTxnUpdate?.[3]).toEqual({ tableId: 'B', billSessionId: sessB });

    const targetSessionUpdate = enqueueMock.mock.calls.find(
      ([collection, operation, recordId]) => collection === 'bill_sessions' && operation === 'update' && recordId === sessB,
    );
    expect(targetSessionUpdate?.[3]).toMatchObject({ adults: 3, children: 1 });

    const sourceSessionClose = enqueueMock.mock.calls.find(
      ([collection, operation, recordId]) => collection === 'bill_sessions' && operation === 'update' && recordId === sessA,
    );
    expect(sourceSessionClose?.[3]?.status).toBe('closed');
    expect(closeBillSessionInIDBMock).toHaveBeenCalledWith(sessA);
    expect(upsertBillSessionInIDBMock).toHaveBeenCalledWith(expect.objectContaining({
      billSessionId: sessB,
      table: 'B',
      adults: 3,
      children: 1,
    }));
  });

  it('mergeTableOrders with new target session does not enqueue when projected IDB save fails', async () => {
    const store = useAppStore();
    runtime.store = store;
    const sessA = await store.openTableSession('A', 2, 0);
    const ordA = makeOrder('ord_merge_fail', 'A', 'accepted');
    ordA.billSessionId = sessA;
    await store.addOrder(ordA);
    await store.addTransaction({
      id: 'txn_merge_fail',
      tableId: 'A',
      billSessionId: sessA,
      amountPaid: 12,
      tipAmount: 0,
      paymentMethod: 'Contanti',
      operationType: 'payment',
      timestamp: new Date().toISOString(),
    });

    runtime.snapshots = [];
    vi.clearAllMocks();
    saveStateToIDBMock.mockRejectedValueOnce(new Error('IDB fail'));

    await store.mergeTableOrders('A', 'B');

    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('detachSlaveTable with slave orders enqueues order billSession retag', async () => {
    const store = useAppStore();
    runtime.store = store;
    const masterSessionId = await store.openTableSession('B', 2, 0);
    const ordSlave = makeOrder('ord_detach', 'A', 'accepted');
    ordSlave.billSessionId = masterSessionId;
    await store.addOrder(ordSlave);
    store.tableMergedInto = { A: 'B' };

    runtime.snapshots = [];
    vi.clearAllMocks();

    await store.detachSlaveTable('B', 'A');

    const orderUpdateCall = enqueueMock.mock.calls.find(
      ([collection, operation, recordId]) => collection === 'orders' && operation === 'update' && recordId === ordSlave.id,
    );
    expect(orderUpdateCall?.[3]).toEqual({
      billSessionId: store.tableCurrentBillSession.A?.billSessionId,
    });
    expect(orderUpdateCall?.[3]?.billSessionId).not.toBe(masterSessionId);
  });

  it('splitItemsToTable enqueues source order patch on partial split', async () => {
    const store = useAppStore();
    runtime.store = store;
    const sessA = await store.openTableSession('A', 2, 0);
    const sessB = await store.openTableSession('B', 2, 0);
    const ord = makeOrderWithItems('ord_split_partial', 'A', 'accepted');
    ord.billSessionId = sessA;
    await store.addOrder(ord);

    runtime.snapshots = [];
    vi.clearAllMocks();

    await store.splitItemsToTable('A', 'B', { [`${ord.id}__item_1`]: 1 });

    const saveCallOrder = saveStateToIDBMock.mock.invocationCallOrder[0];
    const firstEnqueueOrder = enqueueMock.mock.invocationCallOrder[0];
    expect(saveCallOrder).toBeLessThan(firstEnqueueOrder);

    const orderUpdateCall = enqueueMock.mock.calls.find(
      ([collection, operation, recordId]) => collection === 'orders' && operation === 'update' && recordId === ord.id,
    );
    expect(orderUpdateCall?.[3]).toEqual({
      orderItems: expect.arrayContaining([
        expect.objectContaining({ uid: 'item_1', quantity: 1 }),
      ]),
      totalAmount: 10,
      itemCount: 1,
    });
  });

  it('splitItemsToTable full split enqueues moved order/transactions and closes emptied source session', async () => {
    const store = useAppStore();
    runtime.store = store;
    const sessA = await store.openTableSession('A', 2, 0);
    const sessB = await store.openTableSession('B', 2, 0);
    const ord = makeOrderWithItems('ord_split_full', 'A', 'accepted');
    ord.billSessionId = sessA;
    ord.orderItems[0].quantity = 1;
    ord.totalAmount = 10;
    ord.itemCount = 1;
    await store.addOrder(ord);
    await store.addTransaction({
      id: 'txn_split_full',
      tableId: 'A',
      billSessionId: sessA,
      amountPaid: 5,
      tipAmount: 0,
      paymentMethod: 'Contanti',
      operationType: 'payment',
      timestamp: new Date().toISOString(),
    });

    runtime.snapshots = [];
    vi.clearAllMocks();

    await store.splitItemsToTable('A', 'B', { [`${ord.id}__item_1`]: 1 });

    const movedOrderUpdate = enqueueMock.mock.calls.find(
      ([collection, operation, recordId]) => collection === 'orders' && operation === 'update' && recordId === ord.id,
    );
    expect(movedOrderUpdate?.[3]?.table).toBe('B');
    expect(movedOrderUpdate?.[3]?.billSessionId).toBe(sessB);

    const movedTxnUpdate = enqueueMock.mock.calls.find(
      ([collection, operation, recordId]) => collection === 'transactions' && operation === 'update' && recordId === 'txn_split_full',
    );
    expect(movedTxnUpdate?.[3]).toEqual({ tableId: 'B', billSessionId: sessB });

    const sourceSessionClose = enqueueMock.mock.calls.find(
      ([collection, operation, recordId]) => collection === 'bill_sessions' && operation === 'update' && recordId === sessA,
    );
    expect(sourceSessionClose?.[3]?.status).toBe('closed');
    expect(typeof sourceSessionClose?.[3]?.closed_at).toBe('string');
    expect(closeBillSessionInIDBMock).toHaveBeenCalledWith(sessA);
  });

  it('splitItemsToTable returns false and skips enqueue/addDirectOrder when projected IDB save fails', async () => {
    const store = useAppStore();
    runtime.store = store;
    const sessA = await store.openTableSession('A', 2, 0);
    const ord = makeOrderWithItems('ord_split_fail', 'A', 'accepted');
    ord.billSessionId = sessA;
    await store.addOrder(ord);

    runtime.snapshots = [];
    vi.clearAllMocks();
    saveStateToIDBMock.mockRejectedValueOnce(new Error('IDB fail'));

    const result = await store.splitItemsToTable('A', 'B', { [`${ord.id}__item_1`]: 1 });

    expect(result).toBe(false);
    expect(enqueueMock).not.toHaveBeenCalled();
    const sourceOrder = store.orders.find(o => o.id === ord.id);
    expect(sourceOrder?.table).toBe('A');
    expect(sourceOrder?.orderItems?.find(i => i.uid === 'item_1')?.quantity).toBe(2);
    expect(store.orders.some(o => o.table === 'B')).toBe(false);
  });
});
