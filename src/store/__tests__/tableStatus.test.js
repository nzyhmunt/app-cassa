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

  it('returns free when all orders are completed', () => {
    const store = useAppStore();
    store.addOrder(makeOrder('ord1', 'T1', 'completed', 20));
    const result = store.getTableStatus('T1');
    expect(result.status).toBe('free');
  });

  it('returns free when all orders are rejected', () => {
    const store = useAppStore();
    store.addOrder(makeOrder('ord1', 'T1', 'rejected', 20));
    const result = store.getTableStatus('T1');
    expect(result.status).toBe('free');
  });
});

// ---------------------------------------------------------------------------
// Tests: pending status
// ---------------------------------------------------------------------------

describe('getTableStatus() — pending', () => {
  it('returns pending when at least one order has status pending', () => {
    const store = useAppStore();
    store.addOrder(makeOrder('ord1', 'T1', 'pending', 15));
    const result = store.getTableStatus('T1');
    expect(result.status).toBe('pending');
  });

  it('pending takes precedence over paid (remaining=0 but pending order exists)', () => {
    const store = useAppStore();
    store.addOrder(makeOrder('ord1', 'T1', 'pending', 10));
    store.addOrder(makeOrder('ord2', 'T1', 'accepted', 10));
    // Pay the accepted order fully — remaining = 0, but pending order still active
    store.addTransaction(makeTransaction('T1', 10));
    const result = store.getTableStatus('T1');
    // pending takes priority: a pending order is still in flight
    expect(result.status).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// Tests: paid status
// ---------------------------------------------------------------------------

describe('getTableStatus() — paid', () => {
  it('returns paid when remaining === 0 and no pending orders', () => {
    const store = useAppStore();
    store.addOrder(makeOrder('ord1', 'T1', 'accepted', 25));
    store.addTransaction(makeTransaction('T1', 25));
    const result = store.getTableStatus('T1');
    expect(result.status).toBe('paid');
    expect(result.remaining).toBe(0);
  });

  it('returns paid even when bill_requested is set if remaining === 0', () => {
    const store = useAppStore();
    store.addOrder(makeOrder('ord1', 'T1', 'accepted', 30));
    store.addTransaction(makeTransaction('T1', 30));
    store.setBillRequested('T1', true);
    // paid takes precedence over bill_requested
    const result = store.getTableStatus('T1');
    expect(result.status).toBe('paid');
  });

  it('does NOT return paid when remaining > 0', () => {
    const store = useAppStore();
    store.addOrder(makeOrder('ord1', 'T1', 'accepted', 40));
    store.addTransaction(makeTransaction('T1', 20));
    const result = store.getTableStatus('T1');
    expect(result.status).not.toBe('paid');
    expect(result.remaining).toBe(20);
  });

  it('returns paid total and remaining correctly', () => {
    const store = useAppStore();
    store.addOrder(makeOrder('ord1', 'T1', 'accepted', 50));
    store.addTransaction(makeTransaction('T1', 50));
    const result = store.getTableStatus('T1');
    expect(result.total).toBe(50);
    expect(result.remaining).toBe(0);
  });

  it('remaining is clamped to 0 even when overpaid', () => {
    const store = useAppStore();
    store.addOrder(makeOrder('ord1', 'T1', 'accepted', 30));
    store.addTransaction(makeTransaction('T1', 40)); // overpaid
    const result = store.getTableStatus('T1');
    expect(result.remaining).toBe(0);
    expect(result.status).toBe('paid');
  });
});

// ---------------------------------------------------------------------------
// Tests: bill_requested status
// ---------------------------------------------------------------------------

describe('getTableStatus() — bill_requested', () => {
  it('returns bill_requested when bill is requested and remaining > 0', () => {
    const store = useAppStore();
    store.addOrder(makeOrder('ord1', 'T1', 'accepted', 45));
    store.setBillRequested('T1', true);
    const result = store.getTableStatus('T1');
    expect(result.status).toBe('bill_requested');
  });

  it('does NOT return bill_requested when remaining === 0 (becomes paid)', () => {
    const store = useAppStore();
    store.addOrder(makeOrder('ord1', 'T1', 'accepted', 45));
    store.addTransaction(makeTransaction('T1', 45));
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
  it('returns occupied when orders are active and not fully paid', () => {
    const store = useAppStore();
    store.addOrder(makeOrder('ord1', 'T1', 'accepted', 60));
    const result = store.getTableStatus('T1');
    expect(result.status).toBe('occupied');
    expect(result.remaining).toBe(60);
  });

  it('returns occupied with partial payment (remaining > 0)', () => {
    const store = useAppStore();
    store.addOrder(makeOrder('ord1', 'T1', 'preparing', 80));
    store.addTransaction(makeTransaction('T1', 30));
    const result = store.getTableStatus('T1');
    expect(result.status).toBe('occupied');
    expect(result.remaining).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Tests: status precedence (summary)
// ---------------------------------------------------------------------------

describe('getTableStatus() — status precedence', () => {
  it('precedence: pending > paid', () => {
    const store = useAppStore();
    // One accepted order fully paid (→ paid candidate) + one pending order
    store.addOrder(makeOrder('ord1', 'T1', 'accepted', 20));
    store.addOrder(makeOrder('ord2', 'T1', 'pending', 0));
    store.addTransaction(makeTransaction('T1', 20));
    expect(store.getTableStatus('T1').status).toBe('pending');
  });

  it('precedence: paid > bill_requested', () => {
    const store = useAppStore();
    store.addOrder(makeOrder('ord1', 'T1', 'accepted', 20));
    store.addTransaction(makeTransaction('T1', 20));
    store.setBillRequested('T1', true);
    expect(store.getTableStatus('T1').status).toBe('paid');
  });

  it('precedence: bill_requested > occupied', () => {
    const store = useAppStore();
    store.addOrder(makeOrder('ord1', 'T1', 'accepted', 20));
    store.setBillRequested('T1', true);
    expect(store.getTableStatus('T1').status).toBe('bill_requested');
  });
});
