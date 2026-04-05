/**
 * @file tableMerge.test.js
 * @description Unit tests for the revised mergeTableOrders, moveTableOrders and
 * splitTableOrders store functions, as well as getTableStatus behaviour for
 * merged (master/slave) tables.
 *
 * Key behaviours under test:
 *  - moveTableOrders: works for both free and occupied targets
 *  - mergeTableOrders: orders stay on source table, tableMergedInto is set,
 *    both tables remain occupied
 *  - getTableStatus for slave: delegates to master status
 *  - getTableStatus for master: includes slave orders in total
 *  - splitTableOrders: restores independent session for slave
 *  - Bug fix: merging open table with paid table updates totals correctly
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAppStore } from '../index.js';

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

let _ordIdx = 0;
function makeOrder(tableId, status, totalAmount, billSessionId = null) {
  const id = `ord_t${++_ordIdx}`;
  return {
    id,
    table: tableId,
    billSessionId: billSessionId ?? `sess_auto_${id}`,
    status,
    orderItems: [],
    totalAmount,
    itemCount: 1,
    globalNote: '',
    noteVisibility: { cassa: true, sala: true, cucina: true },
    isDirectEntry: false,
  };
}

function makeTransaction(tableId, amountPaid, billSessionId = null) {
  return {
    id: `txn_${Math.random().toString(36).slice(2)}`,
    tableId,
    billSessionId,
    amountPaid,
    tipAmount: 0,
    method: 'cash',
    operationType: 'payment',
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// moveTableOrders — free target (existing behaviour preserved)
// ---------------------------------------------------------------------------

describe('moveTableOrders() — to a free table', () => {
  it('moves active orders to target and source becomes free', () => {
    const store = useAppStore();
    const ord = makeOrder('T1', 'accepted', 20);
    store.addOrder(ord);
    store.moveTableOrders('T1', 'T2');
    expect(store.orders.find(o => o.id === ord.id).table).toBe('T2');
    expect(store.getTableStatus('T1').status).toBe('free');
    expect(store.getTableStatus('T2').status).toBe('occupied');
  });

  it('does NOT move completed or rejected orders', () => {
    const store = useAppStore();
    const completed = makeOrder('T1', 'completed', 15);
    store.addOrder(completed);
    store.moveTableOrders('T1', 'T2');
    // completed stays on T1
    expect(store.orders.find(o => o.id === completed.id).table).toBe('T1');
  });
});

// ---------------------------------------------------------------------------
// moveTableOrders — occupied target (new feature: merge via sposta)
// ---------------------------------------------------------------------------

describe('moveTableOrders() — to an occupied table (bill merge)', () => {
  it('moves source orders to occupied target and retags to target session', () => {
    const store = useAppStore();
    const sessionA = store.openTableSession('A', 2, 0);
    const sessionB = store.openTableSession('B', 2, 0);
    const ordA = makeOrder('A', 'accepted', 10, sessionA);
    const ordB = makeOrder('B', 'accepted', 20, sessionB);
    store.addOrder(ordA);
    store.addOrder(ordB);

    store.moveTableOrders('A', 'B');

    // ordA now belongs to B and is retagged to B's session
    const movedOrd = store.orders.find(o => o.id === ordA.id);
    expect(movedOrd.table).toBe('B');
    expect(movedOrd.billSessionId).toBe(sessionB);

    // B remains occupied with both orders
    const statusB = store.getTableStatus('B');
    expect(statusB.status).toBe('occupied');
    expect(statusB.total).toBe(30);
  });

  it('moves source transactions to target when target already has a session', () => {
    const store = useAppStore();
    const sessionA = store.openTableSession('A', 2, 0);
    const sessionB = store.openTableSession('B', 2, 0);
    const ordA = makeOrder('A', 'accepted', 30, sessionA);
    const txnA = makeTransaction('A', 10, sessionA);
    store.addOrder(ordA);
    store.addTransaction(txnA);

    store.moveTableOrders('A', 'B');

    // Transaction moved to B and retagged
    const movedTxn = store.transactions.find(t => t.id === txnA.id);
    expect(movedTxn.tableId).toBe('B');
    expect(movedTxn.billSessionId).toBe(sessionB);
  });
});

// ---------------------------------------------------------------------------
// mergeTableOrders — new Unisci behaviour
// ---------------------------------------------------------------------------

describe('mergeTableOrders() — orders stay on source, both tables remain occupied', () => {
  it('source orders stay on source table (o.table unchanged)', () => {
    const store = useAppStore();
    const sessA = store.openTableSession('A', 2, 0);
    const sessB = store.openTableSession('B', 2, 0);
    const ordA = makeOrder('A', 'accepted', 15, sessA);
    const ordB = makeOrder('B', 'accepted', 25, sessB);
    store.addOrder(ordA);
    store.addOrder(ordB);

    store.mergeTableOrders('A', 'B'); // merge A (slave) into B (master)

    // A's order stays on A
    expect(store.orders.find(o => o.id === ordA.id).table).toBe('A');
  });

  it('source orders are retagged to master bill session', () => {
    const store = useAppStore();
    const sessA = store.openTableSession('A', 2, 0);
    const sessB = store.openTableSession('B', 2, 0);
    const ordA = makeOrder('A', 'accepted', 15, sessA);
    store.addOrder(ordA);
    store.addOrder(makeOrder('B', 'accepted', 25, sessB));

    store.mergeTableOrders('A', 'B');

    expect(store.orders.find(o => o.id === ordA.id).billSessionId).toBe(sessB);
  });

  it('records tableMergedInto[source] = master', () => {
    const store = useAppStore();
    store.openTableSession('A', 2, 0);
    store.openTableSession('B', 2, 0);
    store.addOrder(makeOrder('A', 'accepted', 10, store.tableCurrentBillSession['A'].billSessionId));
    store.addOrder(makeOrder('B', 'accepted', 20, store.tableCurrentBillSession['B'].billSessionId));

    store.mergeTableOrders('A', 'B');

    expect(store.tableMergedInto['A']).toBe('B');
  });

  it('slave table shows as occupied (not free) after merge', () => {
    const store = useAppStore();
    const sessA = store.openTableSession('A', 2, 0);
    const sessB = store.openTableSession('B', 2, 0);
    store.addOrder(makeOrder('A', 'accepted', 12, sessA));
    store.addOrder(makeOrder('B', 'accepted', 18, sessB));

    store.mergeTableOrders('A', 'B');

    const slaveStatus = store.getTableStatus('A');
    expect(slaveStatus.status).not.toBe('free');
  });

  it('master getTableStatus includes slave orders in total', () => {
    const store = useAppStore();
    const sessA = store.openTableSession('A', 2, 0);
    const sessB = store.openTableSession('B', 2, 0);
    store.addOrder(makeOrder('A', 'accepted', 10, sessA));
    store.addOrder(makeOrder('B', 'accepted', 20, sessB));

    store.mergeTableOrders('A', 'B');

    const masterStatus = store.getTableStatus('B');
    expect(masterStatus.total).toBe(30);
    expect(masterStatus.remaining).toBe(30);
  });

  it('slave transactions move to master table', () => {
    const store = useAppStore();
    const sessA = store.openTableSession('A', 2, 0);
    const sessB = store.openTableSession('B', 2, 0);
    const ordA = makeOrder('A', 'accepted', 20, sessA);
    store.addOrder(ordA);
    store.addOrder(makeOrder('B', 'accepted', 30, sessB));
    const txnA = makeTransaction('A', 10, sessA);
    store.addTransaction(txnA);

    store.mergeTableOrders('A', 'B');

    const movedTxn = store.transactions.find(t => t.id === txnA.id);
    expect(movedTxn.tableId).toBe('B');
    expect(movedTxn.billSessionId).toBe(sessB);
  });

  it('slave source has no current bill session after merge', () => {
    const store = useAppStore();
    const sessA = store.openTableSession('A', 2, 0);
    const sessB = store.openTableSession('B', 2, 0);
    store.addOrder(makeOrder('A', 'accepted', 10, sessA));
    store.addOrder(makeOrder('B', 'accepted', 20, sessB));

    store.mergeTableOrders('A', 'B');

    expect(store.tableCurrentBillSession['A']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// mergeTableOrders — bug fix: merging with a paid table
// ---------------------------------------------------------------------------

describe('mergeTableOrders() — bug fix: paid table + open table', () => {
  it('after merging open slave into paid master, master total increases and remaining > 0', () => {
    const store = useAppStore();
    // Master (B): paid — has an order fully paid
    const sessB = store.openTableSession('B', 2, 0);
    const ordBPaid = makeOrder('B', 'accepted', 30, sessB);
    store.addOrder(ordBPaid);
    store.addTransaction(makeTransaction('B', 30, sessB)); // fully paid

    // Initially B is "paid"
    expect(store.getTableStatus('B').status).toBe('paid');

    // Slave (A): open — unpaid order
    const sessA = store.openTableSession('A', 2, 0);
    const ordAOpen = makeOrder('A', 'accepted', 15, sessA);
    store.addOrder(ordAOpen);

    // Merge A (slave) into B (master)
    store.mergeTableOrders('A', 'B');

    const masterStatus = store.getTableStatus('B');
    expect(masterStatus.total).toBeGreaterThan(0);
    expect(masterStatus.remaining).toBeGreaterThan(0);
    expect(masterStatus.status).not.toBe('paid'); // should now be occupied
  });

  it('after merging paid slave into open master, remaining correctly reflects only unpaid portion', () => {
    const store = useAppStore();
    // Master (B): open — unpaid
    const sessB = store.openTableSession('B', 2, 0);
    const ordBOpen = makeOrder('B', 'accepted', 20, sessB);
    store.addOrder(ordBOpen);

    // Slave (A): paid — fully paid order
    const sessA = store.openTableSession('A', 2, 0);
    const ordAPaid = makeOrder('A', 'accepted', 10, sessA);
    store.addOrder(ordAPaid);
    store.addTransaction(makeTransaction('A', 10, sessA));
    expect(store.getTableStatus('A').status).toBe('paid');

    // Merge A (paid slave) into B (open master)
    store.mergeTableOrders('A', 'B');

    const masterStatus = store.getTableStatus('B');
    // B's session total: B's original order (20) + A's order (now retagged to B session, 10) = 30
    // A's payment (10) moves to B
    // remaining = 30 - 10 = 20
    expect(masterStatus.total).toBe(30);
    expect(masterStatus.remaining).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// getTableStatus — slave mirrors master status
// ---------------------------------------------------------------------------

describe('getTableStatus() — slave mirrors master', () => {
  it('slave shows paid status when master is paid', () => {
    const store = useAppStore();
    const sessA = store.openTableSession('A', 2, 0);
    const sessB = store.openTableSession('B', 2, 0);
    store.addOrder(makeOrder('A', 'accepted', 10, sessA));
    store.addOrder(makeOrder('B', 'accepted', 20, sessB));

    store.mergeTableOrders('A', 'B'); // A slave of B

    // Pay B's combined bill (30)
    store.addTransaction(makeTransaction('B', 30, sessB));

    const slaveStatus = store.getTableStatus('A');
    expect(slaveStatus.status).toBe('paid');
    expect(slaveStatus.remaining).toBe(0);
  });

  it('slave free when it has no active orders', () => {
    const store = useAppStore();
    const sessA = store.openTableSession('A', 2, 0);
    const sessB = store.openTableSession('B', 2, 0);
    // A has only a completed order (not active)
    store.addOrder(makeOrder('A', 'completed', 10, sessA));
    store.addOrder(makeOrder('B', 'accepted', 20, sessB));

    store.mergeTableOrders('A', 'B');

    const slaveStatus = store.getTableStatus('A');
    // Slave has no active orders → free
    expect(slaveStatus.status).toBe('free');
  });
});

// ---------------------------------------------------------------------------
// splitTableOrders — restore slave independence
// ---------------------------------------------------------------------------

describe('splitTableOrders()', () => {
  it('restores independent session for slave and removes from tableMergedInto', () => {
    const store = useAppStore();
    const sessA = store.openTableSession('A', 2, 0);
    const sessB = store.openTableSession('B', 2, 0);
    const ordA = makeOrder('A', 'accepted', 10, sessA);
    store.addOrder(ordA);
    store.addOrder(makeOrder('B', 'accepted', 20, sessB));

    store.mergeTableOrders('A', 'B'); // A becomes slave

    expect(store.tableMergedInto['A']).toBe('B');

    store.splitTableOrders('B', 'A'); // split A back out

    expect(store.tableMergedInto['A']).toBeUndefined();
    expect(store.tableCurrentBillSession['A']).toBeDefined();
  });

  it('split orders are retagged to slave new session', () => {
    const store = useAppStore();
    const sessA = store.openTableSession('A', 2, 0);
    const sessB = store.openTableSession('B', 2, 0);
    const ordA = makeOrder('A', 'accepted', 10, sessA);
    store.addOrder(ordA);
    store.addOrder(makeOrder('B', 'accepted', 20, sessB));

    store.mergeTableOrders('A', 'B');
    // ordA is now tagged to sessB

    store.splitTableOrders('B', 'A');

    const newSessA = store.tableCurrentBillSession['A']?.billSessionId;
    expect(newSessA).toBeDefined();
    // ordA should now have A's new session
    expect(store.orders.find(o => o.id === ordA.id).billSessionId).toBe(newSessA);
  });

  it('after split, slave and master have independent statuses', () => {
    const store = useAppStore();
    const sessA = store.openTableSession('A', 2, 0);
    const sessB = store.openTableSession('B', 2, 0);
    store.addOrder(makeOrder('A', 'accepted', 10, sessA));
    store.addOrder(makeOrder('B', 'accepted', 20, sessB));

    store.mergeTableOrders('A', 'B');
    store.splitTableOrders('B', 'A');

    const statusA = store.getTableStatus('A');
    const statusB = store.getTableStatus('B');
    expect(statusA.status).toBe('occupied');
    expect(statusB.status).toBe('occupied');
    expect(statusA.total).toBe(10);
    expect(statusB.total).toBe(20);
  });

  it('is a no-op when slave is not merged into master', () => {
    const store = useAppStore();
    const sessA = store.openTableSession('A', 2, 0);
    store.addOrder(makeOrder('A', 'accepted', 10, sessA));

    // Call split without prior merge — should not crash or change state
    expect(() => store.splitTableOrders('B', 'A')).not.toThrow();
    expect(store.tableMergedInto['A']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// mergeTableOrders — chain merge: slave-of-slave flattening
// ---------------------------------------------------------------------------

describe('mergeTableOrders() — chain: slave-of-slave flattening', () => {
  it('merging C (already slave of B) into A re-parents C to A', () => {
    const store = useAppStore();
    const sessA = store.openTableSession('A', 2, 0);
    const sessB = store.openTableSession('B', 2, 0);
    const sessC = store.openTableSession('C', 2, 0);
    store.addOrder(makeOrder('A', 'accepted', 5, sessA));
    store.addOrder(makeOrder('B', 'accepted', 10, sessB));
    store.addOrder(makeOrder('C', 'accepted', 15, sessC));

    // First: C becomes slave of B
    store.mergeTableOrders('C', 'B');
    expect(store.tableMergedInto['C']).toBe('B');

    // Then: B becomes slave of A
    store.mergeTableOrders('B', 'A');

    // B's slaves (C) should now be slaves of A too
    expect(store.tableMergedInto['B']).toBe('A');
    // C is re-parented to A
    expect(store.tableMergedInto['C']).toBe('A');
  });
});
