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
  it('addOrder invokes IDB persistence before reactive mutation and enqueue', () => {
    const store = useAppStore();
    runtime.store = store;
    const order = makeOrder('ord_1');

    store.addOrder(order);
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

  it('changeOrderStatus persists projected state before mutating order and enqueueing', () => {
    const store = useAppStore();
    runtime.store = store;
    const order = makeOrder('ord_2', 'T2', 'pending');
    store.orders = [order];
    runtime.snapshots = [];
    vi.clearAllMocks();

    store.changeOrderStatus(order, 'accepted');
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
  });

  it('addTransaction writes projected transactions first, then updates state and queue', () => {
    const store = useAppStore();
    runtime.store = store;
    store.setBillRequested('T3', true);
    runtime.snapshots = [];
    vi.clearAllMocks();

    store.addTransaction({
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

  it('openTableSession persists bill session to IDB before state mutation and enqueue', () => {
    const store = useAppStore();
    runtime.store = store;

    const billSessionId = store.openTableSession('T4', 2, 1);

    const upsertSnapshot = runtime.snapshots.find((entry) => entry.type === 'upsert-bill-session');
    expect(upsertSnapshot.sessionAtCall).toBeNull();
    expect(store.tableCurrentBillSession.T4.billSessionId).toBe(billSessionId);

    const upsertCall = upsertBillSessionInIDBMock.mock.invocationCallOrder[0];
    const enqueueCall = enqueueMock.mock.invocationCallOrder.find((_, idx) => (
      enqueueMock.mock.calls[idx][0] === 'bill_sessions' && enqueueMock.mock.calls[idx][1] === 'create'
    ));
    expect(upsertCall).toBeLessThan(enqueueCall);
  });

  it('addCashMovement saves to IDB before updating reactive state and enqueue', () => {
    const store = useAppStore();
    runtime.store = store;

    store.addCashMovement('in', 15, 'Test');
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
