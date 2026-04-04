/**
 * @file tableStatus.test.js
 * @description Unit tests for store.getTableStatus() — status precedence, saldato logic,
 * and interactions with conto_richiesto.
 *
 * Status precedence (highest → lowest):
 *   pending > saldato > conto_richiesto > occupied
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

  it('pending takes precedence over saldato (remaining=0 but pending order exists)', () => {
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
// Tests: saldato status
// ---------------------------------------------------------------------------

describe('getTableStatus() — saldato', () => {
  it('returns saldato when remaining === 0 and no pending orders', () => {
    const store = useAppStore();
    store.addOrder(makeOrder('ord1', 'T1', 'accepted', 25));
    store.addTransaction(makeTransaction('T1', 25));
    const result = store.getTableStatus('T1');
    expect(result.status).toBe('saldato');
    expect(result.remaining).toBe(0);
  });

  it('returns saldato even when conto_richiesto is set if remaining === 0', () => {
    const store = useAppStore();
    store.addOrder(makeOrder('ord1', 'T1', 'accepted', 30));
    store.addTransaction(makeTransaction('T1', 30));
    store.setBillRequested('T1', true);
    // saldato takes precedence over conto_richiesto
    const result = store.getTableStatus('T1');
    expect(result.status).toBe('saldato');
  });

  it('does NOT return saldato when remaining > 0', () => {
    const store = useAppStore();
    store.addOrder(makeOrder('ord1', 'T1', 'accepted', 40));
    store.addTransaction(makeTransaction('T1', 20));
    const result = store.getTableStatus('T1');
    expect(result.status).not.toBe('saldato');
    expect(result.remaining).toBe(20);
  });

  it('returns saldato total and remaining correctly', () => {
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
    expect(result.status).toBe('saldato');
  });
});

// ---------------------------------------------------------------------------
// Tests: conto_richiesto status
// ---------------------------------------------------------------------------

describe('getTableStatus() — conto_richiesto', () => {
  it('returns conto_richiesto when bill is requested and remaining > 0', () => {
    const store = useAppStore();
    store.addOrder(makeOrder('ord1', 'T1', 'accepted', 45));
    store.setBillRequested('T1', true);
    const result = store.getTableStatus('T1');
    expect(result.status).toBe('conto_richiesto');
  });

  it('does NOT return conto_richiesto when remaining === 0 (becomes saldato)', () => {
    const store = useAppStore();
    store.addOrder(makeOrder('ord1', 'T1', 'accepted', 45));
    store.addTransaction(makeTransaction('T1', 45));
    store.setBillRequested('T1', true);
    const result = store.getTableStatus('T1');
    expect(result.status).toBe('saldato');
    expect(result.status).not.toBe('conto_richiesto');
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
  it('precedence: pending > saldato', () => {
    const store = useAppStore();
    // One accepted order fully paid (→ saldato candidate) + one pending order
    store.addOrder(makeOrder('ord1', 'T1', 'accepted', 20));
    store.addOrder(makeOrder('ord2', 'T1', 'pending', 0));
    store.addTransaction(makeTransaction('T1', 20));
    expect(store.getTableStatus('T1').status).toBe('pending');
  });

  it('precedence: saldato > conto_richiesto', () => {
    const store = useAppStore();
    store.addOrder(makeOrder('ord1', 'T1', 'accepted', 20));
    store.addTransaction(makeTransaction('T1', 20));
    store.setBillRequested('T1', true);
    expect(store.getTableStatus('T1').status).toBe('saldato');
  });

  it('precedence: conto_richiesto > occupied', () => {
    const store = useAppStore();
    store.addOrder(makeOrder('ord1', 'T1', 'accepted', 20));
    store.setBillRequested('T1', true);
    expect(store.getTableStatus('T1').status).toBe('conto_richiesto');
  });
});
