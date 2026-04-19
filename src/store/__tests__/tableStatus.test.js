/**
 * @file tableStatus.test.js
 * @description Unit tests for store.getTableStatus() — status precedence, paid logic,
 * and interactions with bill_requested.
 *
 * Status precedence (highest → lowest):
 *   pending > paid > bill_requested > occupied
 * A table is 'free' when it has no active (non-completed, non-rejected) orders.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAppStore } from '../index.js';

// Prevent real network requests while loading the menu
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOrder(id, tableId, status, totalAmount) {
  return {
    id,
    table: tableId,
    billSessionId: `sess_${id}`,
    status,
    orderItems: [],
    totalAmount,
    itemCount: 1,
    globalNote: '',
    noteVisibility: { cassa: true, sala: true, cucina: true },
    isDirectEntry: false,
  };
}

function makeTransaction(tableId, amountPaid) {
  return {
    id: `txn_${Math.random().toString(36).slice(2)}`,
    tableId,
    amountPaid,
    tipAmount: 0,
    method: 'cash',
    operationType: 'payment',
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Tests: free status
// ---------------------------------------------------------------------------

describe('getTableStatus() — free', () => {
  it('returns free when no orders exist for the table', () => {
    const store = useAppStore();
    const result = store.getTableStatus('T1');
    expect(result.status).toBe('free');
    expect(result.total).toBe(0);
    expect(result.remaining).toBe(0);
  });

  it('returns free when all orders are completed', async () => {
    const store = useAppStore();
    await store.addOrder(makeOrder('ord1', 'T1', 'completed', 20));
    const result = store.getTableStatus('T1');
    expect(result.status).toBe('free');
  });

  it('returns free when all orders are rejected', async () => {
    const store = useAppStore();
    await store.addOrder(makeOrder('ord1', 'T1', 'rejected', 20));
    const result = store.getTableStatus('T1');
    expect(result.status).toBe('free');
  });
});

// ---------------------------------------------------------------------------
// Tests: pending status
// ---------------------------------------------------------------------------

describe('getTableStatus() — pending', () => {
  it('returns pending when at least one order has status pending', async () => {
    const store = useAppStore();
    await store.addOrder(makeOrder('ord1', 'T1', 'pending', 15));
    const result = store.getTableStatus('T1');
    expect(result.status).toBe('pending');
  });

  it('pending takes precedence over paid (remaining=0 but pending order exists)', async () => {
    const store = useAppStore();
    await store.addOrder(makeOrder('ord1', 'T1', 'pending', 10));
    await store.addOrder(makeOrder('ord2', 'T1', 'accepted', 10));
    // Pay the accepted order fully — remaining = 0, but pending order still active
    await store.addTransaction(makeTransaction('T1', 10));
    const result = store.getTableStatus('T1');
    // pending takes priority: a pending order is still in flight
    expect(result.status).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// Tests: paid status
// ---------------------------------------------------------------------------

describe('getTableStatus() — paid', () => {
  it('returns paid when remaining === 0 and no pending orders', async () => {
    const store = useAppStore();
    await store.addOrder(makeOrder('ord1', 'T1', 'accepted', 25));
    await store.addTransaction(makeTransaction('T1', 25));
    const result = store.getTableStatus('T1');
    expect(result.status).toBe('paid');
    expect(result.remaining).toBe(0);
  });

  it('returns paid even when bill_requested is set if remaining === 0', async () => {
    const store = useAppStore();
    await store.addOrder(makeOrder('ord1', 'T1', 'accepted', 30));
    await store.addTransaction(makeTransaction('T1', 30));
    store.setBillRequested('T1', true);
    // paid takes precedence over bill_requested
    const result = store.getTableStatus('T1');
    expect(result.status).toBe('paid');
  });

  it('does NOT return paid when remaining > 0', async () => {
    const store = useAppStore();
    await store.addOrder(makeOrder('ord1', 'T1', 'accepted', 40));
    await store.addTransaction(makeTransaction('T1', 20));
    const result = store.getTableStatus('T1');
    expect(result.status).not.toBe('paid');
    expect(result.remaining).toBe(20);
  });

  it('returns paid total and remaining correctly', async () => {
    const store = useAppStore();
    await store.addOrder(makeOrder('ord1', 'T1', 'accepted', 50));
    await store.addTransaction(makeTransaction('T1', 50));
    const result = store.getTableStatus('T1');
    expect(result.total).toBe(50);
    expect(result.remaining).toBe(0);
  });

  it('remaining is clamped to 0 even when overpaid', async () => {
    const store = useAppStore();
    await store.addOrder(makeOrder('ord1', 'T1', 'accepted', 30));
    await store.addTransaction(makeTransaction('T1', 40)); // overpaid
    const result = store.getTableStatus('T1');
    expect(result.remaining).toBe(0);
    expect(result.status).toBe('paid');
  });
});

// ---------------------------------------------------------------------------
// Tests: bill_requested status
// ---------------------------------------------------------------------------

describe('getTableStatus() — bill_requested', () => {
  it('returns bill_requested when bill is requested and remaining > 0', async () => {
    const store = useAppStore();
    await store.addOrder(makeOrder('ord1', 'T1', 'accepted', 45));
    store.setBillRequested('T1', true);
    const result = store.getTableStatus('T1');
    expect(result.status).toBe('bill_requested');
  });

  it('does NOT return bill_requested when remaining === 0 (becomes paid)', async () => {
    const store = useAppStore();
    await store.addOrder(makeOrder('ord1', 'T1', 'accepted', 45));
    await store.addTransaction(makeTransaction('T1', 45));
    store.setBillRequested('T1', true);
    const result = store.getTableStatus('T1');
    expect(result.status).toBe('paid');
    expect(result.status).not.toBe('bill_requested');
  });
});

// ---------------------------------------------------------------------------
// Tests: occupied status
// ---------------------------------------------------------------------------

describe('getTableStatus() — occupied', () => {
  it('returns occupied when orders are active and not fully paid', async () => {
    const store = useAppStore();
    await store.addOrder(makeOrder('ord1', 'T1', 'accepted', 60));
    const result = store.getTableStatus('T1');
    expect(result.status).toBe('occupied');
    expect(result.remaining).toBe(60);
  });

  it('returns occupied with partial payment (remaining > 0)', async () => {
    const store = useAppStore();
    await store.addOrder(makeOrder('ord1', 'T1', 'preparing', 80));
    await store.addTransaction(makeTransaction('T1', 30));
    const result = store.getTableStatus('T1');
    expect(result.status).toBe('occupied');
    expect(result.remaining).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Tests: multi-session isolation
// ---------------------------------------------------------------------------

describe('getTableStatus() — multi-session isolation', () => {
  it('does not count old-session transactions against the current session balance', async () => {
    const store = useAppStore();

    // Session 1: customer orders, pays, table is cleared when order completes
    const sess1 = await store.openTableSession('T1', 2, 0);
    const ord1 = { ...makeOrder('ord1', 'T1', 'accepted', 30), billSessionId: sess1 };
    await store.addOrder(ord1);
    await store.addTransaction({ ...makeTransaction('T1', 30), billSessionId: sess1 });
    // Completing the order triggers changeOrderStatus which clears the session
    await store.changeOrderStatus(store.orders.find(o => o.id === 'ord1'), 'completed');
    expect(store.tableCurrentBillSession['T1']).toBeUndefined();

    // Session 2: new customer sits, new order (not yet paid)
    const sess2 = await store.openTableSession('T1', 2, 0);
    const ord2 = { ...makeOrder('ord2', 'T1', 'accepted', 50), billSessionId: sess2 };
    await store.addOrder(ord2);

    // Old-session payment ($30) must NOT reduce session 2's balance
    const result = store.getTableStatus('T1');
    expect(result.status).toBe('occupied');
    expect(result.total).toBe(50);
    expect(result.remaining).toBe(50);
  });

  it('correctly shows paid when only the current session transactions cover the current total', async () => {
    const store = useAppStore();

    // Session 1: paid and cleared
    const sess1 = await store.openTableSession('T1', 2, 0);
    const ord1 = { ...makeOrder('ord1', 'T1', 'accepted', 30), billSessionId: sess1 };
    await store.addOrder(ord1);
    await store.addTransaction({ ...makeTransaction('T1', 30), billSessionId: sess1 });
    await store.changeOrderStatus(store.orders.find(o => o.id === 'ord1'), 'completed');

    // Session 2: new customer with $40 order, also fully paid
    const sess2 = await store.openTableSession('T1', 2, 0);
    const ord2 = { ...makeOrder('ord2', 'T1', 'accepted', 40), billSessionId: sess2 };
    await store.addOrder(ord2);
    await store.addTransaction({ ...makeTransaction('T1', 40), billSessionId: sess2 });

    const result = store.getTableStatus('T1');
    expect(result.status).toBe('paid');
    expect(result.total).toBe(40);
    expect(result.remaining).toBe(0);
  });

  it('ignores old-session pending orders when evaluating current table status', async () => {
    const store = useAppStore();

    const sess1 = await store.openTableSession('T1', 2, 0);
    await store.addOrder({ ...makeOrder('ord_old_pending', 'T1', 'pending', 12), billSessionId: sess1 });
    // Keep historical pending row as simulated legacy data, then switch to a fresh active session.
    const nextSessions = { ...store.tableCurrentBillSession };
    delete nextSessions.T1;
    store.tableCurrentBillSession = nextSessions;

    const sess2 = await store.openTableSession('T1', 2, 0);
    await store.addDirectOrder('T1', sess2, [
      { uid: 'cover_1', dishId: null, name: 'Coperto', unitPrice: 2.5, quantity: 2, voidedQuantity: 0, notes: [], modifiers: [] },
    ]);

    const result = store.getTableStatus('T1');
    expect(result.status).toBe('occupied');
    expect(result.total).toBeCloseTo(5, 2);
    expect(result.remaining).toBeCloseTo(5, 2);
  });
});

// ---------------------------------------------------------------------------
// Tests: status precedence (summary)
// ---------------------------------------------------------------------------

describe('getTableStatus() — status precedence', () => {
  it('precedence: pending > paid', async () => {
    const store = useAppStore();
    // One accepted order fully paid (→ paid candidate) + one pending order
    await store.addOrder(makeOrder('ord1', 'T1', 'accepted', 20));
    await store.addOrder(makeOrder('ord2', 'T1', 'pending', 0));
    await store.addTransaction(makeTransaction('T1', 20));
    expect(store.getTableStatus('T1').status).toBe('pending');
  });

  it('precedence: paid > bill_requested', async () => {
    const store = useAppStore();
    await store.addOrder(makeOrder('ord1', 'T1', 'accepted', 20));
    await store.addTransaction(makeTransaction('T1', 20));
    store.setBillRequested('T1', true);
    expect(store.getTableStatus('T1').status).toBe('paid');
  });

  it('precedence: bill_requested > occupied', async () => {
    const store = useAppStore();
    await store.addOrder(makeOrder('ord1', 'T1', 'accepted', 20));
    store.setBillRequested('T1', true);
    expect(store.getTableStatus('T1').status).toBe('bill_requested');
  });
});
