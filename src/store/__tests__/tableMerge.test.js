/**
 * @file tableMerge.test.js
 * @description Unit tests for the revised mergeTableOrders, moveTableOrders and
 * detachSlaveTable store function, as well as getTableStatus behaviour for
 * merged (master/slave) tables.
 *
 * Key behaviours under test:
 *  - moveTableOrders: works for both free and occupied targets
 *  - mergeTableOrders: orders physically move to master, tableMergedInto is set,
 *    slave delegates status to master
 *  - getTableStatus for slave: delegates entirely to master status
 *  - getTableStatus for master: all orders are on master naturally
 *  - detachSlaveTable: removes merge mapping; opens slave session only if slave has orders
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
  it('moves active orders to target and source becomes free', async () => {
    const store = useAppStore();
    const ord = makeOrder('T1', 'accepted', 20);
    await store.addOrder(ord);
    store.moveTableOrders('T1', 'T2');
    expect(store.orders.find(o => o.id === ord.id).table).toBe('T2');
    expect(store.getTableStatus('T1').status).toBe('free');
    expect(store.getTableStatus('T2').status).toBe('occupied');
  });

  it('does NOT move completed or rejected orders', async () => {
    const store = useAppStore();
    const completed = makeOrder('T1', 'completed', 15);
    await store.addOrder(completed);
    store.moveTableOrders('T1', 'T2');
    // completed stays on T1
    expect(store.orders.find(o => o.id === completed.id).table).toBe('T1');
  });
});

// ---------------------------------------------------------------------------
// moveTableOrders — occupied target (new feature: merge via sposta)
// ---------------------------------------------------------------------------

describe('moveTableOrders() — to an occupied table (bill merge)', () => {
  it('moves source orders to occupied target and retags to target session', async () => {
    const store = useAppStore();
    const sessionA = await store.openTableSession('A', 2, 0);
    const sessionB = await store.openTableSession('B', 2, 0);
    const ordA = makeOrder('A', 'accepted', 10, sessionA);
    const ordB = makeOrder('B', 'accepted', 20, sessionB);
    await store.addOrder(ordA);
    await store.addOrder(ordB);

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

  it('moves source transactions to target when target already has a session', async () => {
    const store = useAppStore();
    const sessionA = await store.openTableSession('A', 2, 0);
    const sessionB = await store.openTableSession('B', 2, 0);
    const ordA = makeOrder('A', 'accepted', 30, sessionA);
    const txnA = makeTransaction('A', 10, sessionA);
    await store.addOrder(ordA);
    await store.addTransaction(txnA);

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

describe('mergeTableOrders() — orders physically move to master, both tables remain occupied', () => {
  it('source orders move to master table (o.table = masterTableId)', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);
    const sessB = await store.openTableSession('B', 2, 0);
    const ordA = makeOrder('A', 'accepted', 15, sessA);
    const ordB = makeOrder('B', 'accepted', 25, sessB);
    await store.addOrder(ordA);
    await store.addOrder(ordB);

    await store.mergeTableOrders('A', 'B'); // merge A (slave) into B (master)

    // A's order now belongs to B
    expect(store.orders.find(o => o.id === ordA.id).table).toBe('B');
  });

  it('source orders are tagged to master bill session', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);
    const sessB = await store.openTableSession('B', 2, 0);
    const ordA = makeOrder('A', 'accepted', 15, sessA);
    await store.addOrder(ordA);
    await store.addOrder(makeOrder('B', 'accepted', 25, sessB));

    await store.mergeTableOrders('A', 'B');

    const movedOrd = store.orders.find(o => o.id === ordA.id);
    expect(movedOrd.billSessionId).toBe(sessB);
    expect(movedOrd.table).toBe('B');
  });

  it('records tableMergedInto[source] = master', async () => {
    const store = useAppStore();
    await store.openTableSession('A', 2, 0);
    await store.openTableSession('B', 2, 0);
    await store.addOrder(makeOrder('A', 'accepted', 10, store.tableCurrentBillSession['A'].billSessionId));
    await store.addOrder(makeOrder('B', 'accepted', 20, store.tableCurrentBillSession['B'].billSessionId));

    await store.mergeTableOrders('A', 'B');

    expect(store.tableMergedInto['A']).toBe('B');
  });

  it('slave table shows as occupied (not free) after merge', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);
    const sessB = await store.openTableSession('B', 2, 0);
    await store.addOrder(makeOrder('A', 'accepted', 12, sessA));
    await store.addOrder(makeOrder('B', 'accepted', 18, sessB));

    await store.mergeTableOrders('A', 'B');

    const slaveStatus = store.getTableStatus('A');
    expect(slaveStatus.status).not.toBe('free');
  });

  it('master getTableStatus includes slave orders in total', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);
    const sessB = await store.openTableSession('B', 2, 0);
    await store.addOrder(makeOrder('A', 'accepted', 10, sessA));
    await store.addOrder(makeOrder('B', 'accepted', 20, sessB));

    await store.mergeTableOrders('A', 'B');

    const masterStatus = store.getTableStatus('B');
    expect(masterStatus.total).toBe(30);
    expect(masterStatus.remaining).toBe(30);
  });

  it('slave transactions move to master table', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);
    const sessB = await store.openTableSession('B', 2, 0);
    const ordA = makeOrder('A', 'accepted', 20, sessA);
    await store.addOrder(ordA);
    await store.addOrder(makeOrder('B', 'accepted', 30, sessB));
    const txnA = makeTransaction('A', 10, sessA);
    await store.addTransaction(txnA);

    await store.mergeTableOrders('A', 'B');

    const movedTxn = store.transactions.find(t => t.id === txnA.id);
    expect(movedTxn.tableId).toBe('B');
    expect(movedTxn.billSessionId).toBe(sessB);
  });

  it('slave source has no current bill session after merge', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);
    const sessB = await store.openTableSession('B', 2, 0);
    await store.addOrder(makeOrder('A', 'accepted', 10, sessA));
    await store.addOrder(makeOrder('B', 'accepted', 20, sessB));

    await store.mergeTableOrders('A', 'B');

    expect(store.tableCurrentBillSession['A']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// mergeTableOrders — bug fix: merging with a paid table
// ---------------------------------------------------------------------------

describe('mergeTableOrders() — bug fix: paid table + open table', () => {
  it('after merging open slave into paid master, master total increases and remaining > 0', async () => {
    const store = useAppStore();
    // Master (B): paid — has an order fully paid
    const sessB = await store.openTableSession('B', 2, 0);
    const ordBPaid = makeOrder('B', 'accepted', 30, sessB);
    await store.addOrder(ordBPaid);
    await store.addTransaction(makeTransaction('B', 30, sessB)); // fully paid

    // Initially B is "paid"
    expect(store.getTableStatus('B').status).toBe('paid');

    // Slave (A): open — unpaid order
    const sessA = await store.openTableSession('A', 2, 0);
    const ordAOpen = makeOrder('A', 'accepted', 15, sessA);
    await store.addOrder(ordAOpen);

    // Merge A (slave) into B (master)
    await store.mergeTableOrders('A', 'B');

    const masterStatus = store.getTableStatus('B');
    expect(masterStatus.total).toBeGreaterThan(0);
    expect(masterStatus.remaining).toBeGreaterThan(0);
    expect(masterStatus.status).not.toBe('paid'); // should now be occupied
  });

  it('after merging paid slave into open master, remaining correctly reflects only unpaid portion', async () => {
    const store = useAppStore();
    // Master (B): open — unpaid
    const sessB = await store.openTableSession('B', 2, 0);
    const ordBOpen = makeOrder('B', 'accepted', 20, sessB);
    await store.addOrder(ordBOpen);

    // Slave (A): paid — fully paid order
    const sessA = await store.openTableSession('A', 2, 0);
    const ordAPaid = makeOrder('A', 'accepted', 10, sessA);
    await store.addOrder(ordAPaid);
    await store.addTransaction(makeTransaction('A', 10, sessA));
    expect(store.getTableStatus('A').status).toBe('paid');

    // Merge A (paid slave) into B (open master)
    await store.mergeTableOrders('A', 'B');

    const masterStatus = store.getTableStatus('B');
    // B's session total: B's original order (20) + A's order (now retagged to B session, 10) = 30
    // A's payment (10) moves to B
    // remaining = 30 - 10 = 20
    expect(masterStatus.total).toBe(30);
    expect(masterStatus.remaining).toBe(20);
  });

  it('historical orders from older sessions are NOT pulled into master when merging', async () => {
    const store = useAppStore();
    // Table A: had a previous session (oldSess) with a completed order — already closed
    const oldSessA = await store.openTableSession('A', 2, 0);
    const oldOrd = makeOrder('A', 'completed', 50, oldSessA);
    await store.addOrder(oldOrd);
    // Simulate session close: remove session entry (order stays as historical)
    const next = { ...store.tableCurrentBillSession };
    delete next['A'];
    store.$patch({ tableCurrentBillSession: next });

    // Table A: new session starts
    const newSessA = await store.openTableSession('A', 2, 0);
    const newOrd = makeOrder('A', 'accepted', 25, newSessA);
    await store.addOrder(newOrd);

    // Table B: open session
    const sessB = await store.openTableSession('B', 2, 0);
    const ordB = makeOrder('B', 'accepted', 10, sessB);
    await store.addOrder(ordB);

    // Merge A (slave) into B (master)
    await store.mergeTableOrders('A', 'B');

    // Only the current-session order (25) should be on master; historical order stays on A
    const masterStatus = store.getTableStatus('B');
    // B had 10; A contributed 25 (current session only)
    expect(masterStatus.total).toBe(35);
    expect(masterStatus.remaining).toBe(35);

    // Historical order must still be on table A (not moved to master)
    const historicalOrder = store.orders.find(o => o.id === oldOrd.id);
    expect(historicalOrder.table).toBe('A');
    expect(historicalOrder.billSessionId).toBe(oldSessA);
  });

  it('source has no session entry but has both active and historical completed orders: only active orders are moved', async () => {
    const store = useAppStore();
    // Table A: historical completed order with an old closed session.
    // We simulate a "closed" session by adding a completed order tagged to a
    // manually-assigned session ID, without calling openTableSession (so
    // tableCurrentBillSession['A'] is never set). This is the simplest way to
    // guarantee that srcSession is undefined when mergeTableOrders runs.
    const oldFakeSessionId = 'old-sess-A-closed';
    const historicalOrd = {
      id: 'ord_historical_no_sess',
      table: 'A',
      billSessionId: oldFakeSessionId,
      status: 'completed',
      orderItems: [],
      totalAmount: 50,
      itemCount: 1,
      globalNote: '',
      noteVisibility: { cassa: true, sala: true, cucina: true },
      isDirectEntry: false,
    };
    await store.addOrder(historicalOrd);

    // Table A: active pending order with no bill session (created without opening a session)
    const activeOrd = {
      id: 'ord_active_no_sess',
      table: 'A',
      billSessionId: null,
      status: 'pending',
      orderItems: [],
      totalAmount: 15,
      itemCount: 1,
      globalNote: '',
      noteVisibility: { cassa: true, sala: true, cucina: true },
      isDirectEntry: false,
    };
    await store.addOrder(activeOrd);

    // Table B: open session
    const sessB = await store.openTableSession('B', 2, 0);
    const ordB = makeOrder('B', 'accepted', 10, sessB);
    await store.addOrder(ordB);

    // Merge A (no session entry at all) into B
    await store.mergeTableOrders('A', 'B');

    // The active (pending) order must have moved to master
    const movedActive = store.orders.find(o => o.id === activeOrd.id);
    expect(movedActive.table).toBe('B');

    // The historical completed order must NOT have moved
    const stayedHistorical = store.orders.find(o => o.id === historicalOrd.id);
    expect(stayedHistorical.table).toBe('A');
    expect(stayedHistorical.billSessionId).toBe(oldFakeSessionId);
  });
});

// ---------------------------------------------------------------------------
// getTableStatus — slave mirrors master status
// ---------------------------------------------------------------------------

describe('getTableStatus() — slave mirrors master', () => {
  it('slave shows paid status when master is paid', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);
    const sessB = await store.openTableSession('B', 2, 0);
    await store.addOrder(makeOrder('A', 'accepted', 10, sessA));
    await store.addOrder(makeOrder('B', 'accepted', 20, sessB));

    await store.mergeTableOrders('A', 'B'); // A slave of B; ordA moves to B

    // Pay B's combined bill (30 — both orders are now on B)
    await store.addTransaction(makeTransaction('B', 30, sessB));

    const slaveStatus = store.getTableStatus('A');
    expect(slaveStatus.status).toBe('paid');
    expect(slaveStatus.remaining).toBe(0);
  });

  it('slave mirrors occupied status when master has active orders', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);
    const sessB = await store.openTableSession('B', 2, 0);
    await store.addOrder(makeOrder('A', 'accepted', 10, sessA));
    await store.addOrder(makeOrder('B', 'accepted', 20, sessB));

    await store.mergeTableOrders('A', 'B');

    // Master B has active orders → slave A mirrors that status
    const slaveStatus = store.getTableStatus('A');
    expect(slaveStatus.status).toBe('occupied');
    expect(slaveStatus.isMergedSlave).toBe(true);
    expect(slaveStatus.masterTableId).toBe('B');
  });
});

// ---------------------------------------------------------------------------
// changeOrderStatus — session lifecycle with merged tables
// ---------------------------------------------------------------------------

describe('changeOrderStatus() — session lifecycle with merged tables', () => {
  it('does not clear master session when one order completes but another is still active', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);
    const sessB = await store.openTableSession('B', 2, 0);
    const ordA = makeOrder('A', 'accepted', 10, sessA);
    const ordB = makeOrder('B', 'accepted', 20, sessB);
    await store.addOrder(ordA);
    await store.addOrder(ordB);

    // A becomes slave of B; both orders are now on B
    await store.mergeTableOrders('A', 'B');
    expect(store.tableMergedInto['A']).toBe('B');

    // Complete one of B's orders — the other is still active
    await store.changeOrderStatus(ordB, 'completed');

    // Master B session must still be alive (ordA is still active on B)
    expect(store.tableCurrentBillSession['B']).toBeDefined();
  });

  it('clears master session and slave mapping when all orders are completed', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);
    const sessB = await store.openTableSession('B', 2, 0);
    const ordA = makeOrder('A', 'accepted', 10, sessA);
    const ordB = makeOrder('B', 'accepted', 20, sessB);
    await store.addOrder(ordA);
    await store.addOrder(ordB);

    await store.mergeTableOrders('A', 'B');

    // Complete first order — B still has the second one active
    await store.changeOrderStatus(ordA, 'completed');
    expect(store.tableCurrentBillSession['B']).toBeDefined();

    // Complete second order — no more active orders on B
    await store.changeOrderStatus(ordB, 'completed');
    // Master session must be cleared
    expect(store.tableCurrentBillSession['B']).toBeUndefined();
    expect(store.tableOccupiedAt['B']).toBeUndefined();
    // Slave mapping for A must also be cleared (master is now free)
    expect(store.tableMergedInto['A']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// detachSlaveTable — restore slave independence
// ---------------------------------------------------------------------------

describe('detachSlaveTable()', () => {
  it('removes from tableMergedInto after split; slave is free since all its orders moved to master', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);
    const sessB = await store.openTableSession('B', 2, 0);
    const ordA = makeOrder('A', 'accepted', 10, sessA);
    await store.addOrder(ordA);
    await store.addOrder(makeOrder('B', 'accepted', 20, sessB));

    await store.mergeTableOrders('A', 'B'); // A becomes slave; ordA moves to B

    expect(store.tableMergedInto['A']).toBe('B');

    await store.detachSlaveTable('B', 'A'); // split A back out

    expect(store.tableMergedInto['A']).toBeUndefined();
    // A has no orders (they moved to B on merge), so no session is opened
    expect(store.tableCurrentBillSession['A']).toBeUndefined();
    // A is free
    expect(store.getTableStatus('A').status).toBe('free');
  });

  it('detachSlaveTable alone does not open a session for slave (no orders on slave)', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);
    const sessB = await store.openTableSession('B', 2, 0);
    const ordA = makeOrder('A', 'accepted', 10, sessA);
    await store.addOrder(ordA);
    await store.addOrder(makeOrder('B', 'accepted', 20, sessB));

    await store.mergeTableOrders('A', 'B'); // ordA moves to B
    await store.detachSlaveTable('B', 'A'); // detach A

    // A has no orders on it, so detachSlaveTable must NOT open a session
    expect(store.tableCurrentBillSession['A']).toBeUndefined();
    expect(store.getTableStatus('A').status).toBe('free');
  });

  it('after split, slave is free and master retains all orders', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);
    const sessB = await store.openTableSession('B', 2, 0);
    await store.addOrder(makeOrder('A', 'accepted', 10, sessA));
    await store.addOrder(makeOrder('B', 'accepted', 20, sessB));

    await store.mergeTableOrders('A', 'B'); // ordA moves to B; B has both orders (30)
    await store.detachSlaveTable('B', 'A'); // detach A

    const statusA = store.getTableStatus('A');
    const statusB = store.getTableStatus('B');
    // A is free (its orders moved to B on merge and weren't moved back)
    expect(statusA.status).toBe('free');
    // B retains all orders
    expect(statusB.status).toBe('occupied');
    expect(statusB.total).toBe(30);
  });

  it('is a no-op when slave is not merged into master', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);
    await store.addOrder(makeOrder('A', 'accepted', 10, sessA));

    // Call split without prior merge — should not crash or change state
    await expect(store.detachSlaveTable('B', 'A')).resolves.not.toThrow();
    expect(store.tableMergedInto['A']).toBeUndefined();
  });

  it('after merge, orders on master are on master\'s session; split does not retag master orders', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);
    const sessB = await store.openTableSession('B', 2, 0);
    const completedOrdA = makeOrder('A', 'completed', 10, sessA);
    const activeOrdA = makeOrder('A', 'accepted', 5, sessA);
    await store.addOrder(completedOrdA);
    await store.addOrder(activeOrdA);
    await store.addOrder(makeOrder('B', 'accepted', 20, sessB));

    await store.mergeTableOrders('A', 'B');
    // After merge: both A orders moved to B and tagged to sessB
    expect(store.orders.find(o => o.id === completedOrdA.id).table).toBe('B');
    expect(store.orders.find(o => o.id === completedOrdA.id).billSessionId).toBe(sessB);
    expect(store.orders.find(o => o.id === activeOrdA.id).table).toBe('B');

    await store.detachSlaveTable('B', 'A');

    // A has no orders (not moved back) — A is free
    const statusA = store.getTableStatus('A');
    expect(statusA.status).toBe('free');
    // B retains all orders: completed (10) + active (5) + B's own (20) = 35 in session
    const statusB = store.getTableStatus('B');
    expect(statusB.total).toBe(35);
  });
});

// ---------------------------------------------------------------------------
// mergeTableOrders — chain merge: slave-of-slave flattening
// ---------------------------------------------------------------------------

describe('mergeTableOrders() — chain: slave-of-slave flattening', () => {
  it('merging C (already slave of B) into A re-parents C to A', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);
    const sessB = await store.openTableSession('B', 2, 0);
    const sessC = await store.openTableSession('C', 2, 0);
    await store.addOrder(makeOrder('A', 'accepted', 5, sessA));
    await store.addOrder(makeOrder('B', 'accepted', 10, sessB));
    await store.addOrder(makeOrder('C', 'accepted', 15, sessC));

    // First: C becomes slave of B
    await store.mergeTableOrders('C', 'B');
    expect(store.tableMergedInto['C']).toBe('B');

    // Then: B becomes slave of A
    await store.mergeTableOrders('B', 'A');

    // B's slaves (C) should now be slaves of A too
    expect(store.tableMergedInto['B']).toBe('A');
    // C is re-parented to A
    expect(store.tableMergedInto['C']).toBe('A');
  });

  it('after chain-merge A includes orders from B and C in total', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);
    const sessB = await store.openTableSession('B', 2, 0);
    const sessC = await store.openTableSession('C', 2, 0);
    await store.addOrder(makeOrder('A', 'accepted', 5, sessA));
    await store.addOrder(makeOrder('B', 'accepted', 10, sessB));
    await store.addOrder(makeOrder('C', 'accepted', 15, sessC));

    // C → slave of B, B → slave of A
    await store.mergeTableOrders('C', 'B');
    await store.mergeTableOrders('B', 'A');

    const masterStatus = store.getTableStatus('A');
    // Master total must include A (5) + B (10) + C (15) = 30
    expect(masterStatus.total).toBe(30);
    expect(masterStatus.remaining).toBe(30);
    expect(masterStatus.status).toBe('occupied');
  });
});

// ---------------------------------------------------------------------------
// splitItemsToTable — item-level quantity split
// ---------------------------------------------------------------------------

describe('splitItemsToTable()', () => {
  function makeOrderWithItems(tableId, status, billSessionId, ...itemDefs) {
    // itemDefs: [{ name, unitPrice, quantity }]
    const orderItems = itemDefs.map(def => ({
      uid: 'uid_' + Math.random().toString(36).slice(2, 9),
      dishId: 'dish_' + def.name,
      name: def.name,
      unitPrice: def.unitPrice,
      quantity: def.quantity,
      voidedQuantity: 0,
      notes: [],
      modifiers: [],
    }));
    const totalAmount = orderItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
    return {
      id: 'ord_' + Math.random().toString(36).slice(2, 9),
      table: tableId,
      billSessionId,
      status,
      orderItems,
      totalAmount,
      itemCount: orderItems.reduce((s, i) => s + i.quantity, 0),
      globalNote: '',
      noteVisibility: { cassa: true, sala: true, cucina: true },
      isDirectEntry: false,
    };
  }

  it('moves selected item quantities from source to target, reducing quantity on source (no storno)', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);
    const ord = makeOrderWithItems('A', 'accepted', sessA,
      { name: 'Pizza', unitPrice: 10, quantity: 2 },
      { name: 'Pasta', unitPrice: 8, quantity: 1 },
    );
    await store.addOrder(ord);

    const itemQtyMap = { [`${ord.id}__${ord.orderItems[0].uid}`]: 1 }; // move 1 pizza
    await store.splitItemsToTable('A', 'B', itemQtyMap);

    // Source pizza item has its quantity reduced (no storno/voidedQuantity)
    const sourceOrd = store.orders.find(o => o.id === ord.id);
    expect(sourceOrd.orderItems[0].quantity).toBe(1); // quantity reduced by 1
    expect(sourceOrd.orderItems[0].voidedQuantity).toBe(0); // NOT voided — no storno

    // Target has a new direct order with 1 pizza
    const targetOrd = store.orders.find(o => o.table === 'B');
    expect(targetOrd).toBeDefined();
    expect(targetOrd.orderItems[0].name).toBe('Pizza');
    expect(targetOrd.orderItems[0].quantity).toBe(1);
  });

  it('source order total is updated after split', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);
    const ord = makeOrderWithItems('A', 'accepted', sessA,
      { name: 'Pizza', unitPrice: 12, quantity: 2 },
    );
    await store.addOrder(ord);

    const itemQtyMap = { [`${ord.id}__${ord.orderItems[0].uid}`]: 1 };
    await store.splitItemsToTable('A', 'B', itemQtyMap);

    const sourceOrd = store.orders.find(o => o.id === ord.id);
    expect(sourceOrd.totalAmount).toBe(12); // only 1 pizza remaining
  });

  it('creates target session if target has no session', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);
    const ord = makeOrderWithItems('A', 'accepted', sessA,
      { name: 'Vino', unitPrice: 5, quantity: 1 },
    );
    await store.addOrder(ord);

    const itemQtyMap = { [`${ord.id}__${ord.orderItems[0].uid}`]: 1 };

    expect(store.tableCurrentBillSession['B']).toBeUndefined();
    await store.splitItemsToTable('A', 'B', itemQtyMap);
    expect(store.tableCurrentBillSession['B']).toBeDefined();
  });

  it('returns false and does nothing when itemQtyMap has no matching items', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);
    const ord = makeOrderWithItems('A', 'accepted', sessA, { name: 'Acqua', unitPrice: 2, quantity: 1 });
    await store.addOrder(ord);

    const result = await store.splitItemsToTable('A', 'B', { 'nonexistent__key': 1 });
    expect(result).toBe(false);
    expect(store.orders.filter(o => o.table === 'B').length).toBe(0);
  });

  it('returns false and does nothing when source has a pending order', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);
    // One pending order (not yet accepted by kitchen)
    const pendingOrd = makeOrderWithItems('A', 'pending', sessA, { name: 'Pizza', unitPrice: 10, quantity: 2 });
    await store.addOrder(pendingOrd);

    const itemQtyMap = { [`${pendingOrd.id}__${pendingOrd.orderItems[0].uid}`]: 1 };
    const result = await store.splitItemsToTable('A', 'B', itemQtyMap);

    expect(result).toBe(false);
    // Source order is unchanged
    expect(store.orders.find(o => o.id === pendingOrd.id).orderItems[0].quantity).toBe(2);
    // No orders or session created on B
    expect(store.orders.filter(o => o.table === 'B').length).toBe(0);
    expect(store.tableCurrentBillSession['B']).toBeUndefined();
  });

  it('returns false when source has a mix of pending and accepted orders', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);
    const acceptedOrd = makeOrderWithItems('A', 'accepted', sessA, { name: 'Acqua', unitPrice: 2, quantity: 1 });
    const pendingOrd = makeOrderWithItems('A', 'pending', sessA, { name: 'Pizza', unitPrice: 10, quantity: 1 });
    await store.addOrder(acceptedOrd);
    await store.addOrder(pendingOrd);

    // Attempting to split the accepted item is still blocked because pending order exists
    const itemQtyMap = { [`${acceptedOrd.id}__${acceptedOrd.orderItems[0].uid}`]: 1 };
    const result = await store.splitItemsToTable('A', 'B', itemQtyMap);

    expect(result).toBe(false);
    expect(store.orders.filter(o => o.table === 'B').length).toBe(0);
  });

  it('clamps moveQty to netQty (cannot move more than available)', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);
    const ord = makeOrderWithItems('A', 'accepted', sessA,
      { name: 'Birra', unitPrice: 4, quantity: 2 },
    );
    await store.addOrder(ord);

    // Try to move 5 (more than the 2 available)
    const itemQtyMap = { [`${ord.id}__${ord.orderItems[0].uid}`]: 5 };
    await store.splitItemsToTable('A', 'B', itemQtyMap);

    const targetOrd = store.orders.find(o => o.table === 'B');
    expect(targetOrd.orderItems[0].quantity).toBe(2); // clamped to 2
  });

  it('full flow: split slave back out — detach first, then move items from master to slave', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);
    const sessB = await store.openTableSession('B', 2, 0);
    const ordA = makeOrderWithItems('A', 'accepted', sessA,
      { name: 'Pizza', unitPrice: 10, quantity: 2 },
      { name: 'Pasta', unitPrice: 8, quantity: 1 },
    );
    const ordB = makeOrderWithItems('B', 'accepted', sessB,
      { name: 'Bistecca', unitPrice: 20, quantity: 1 },
    );
    await store.addOrder(ordA);
    await store.addOrder(ordB);

    // Merge A into B — ordA (pizza x2, pasta x1) physically moves to B
    await store.mergeTableOrders('A', 'B');

    // ordA is now on B
    expect(store.orders.find(o => o.id === ordA.id).table).toBe('B');

    // Correct split flow in new model:
    // 1. Detach A from the merge (A becomes free again)
    await store.detachSlaveTable('B', 'A');
    expect(store.tableMergedInto['A']).toBeUndefined();

    // 2. Move 1 pizza from master B to now-free slave A
    const pizzaKey = `${ordA.id}__${ordA.orderItems[0].uid}`;
    await store.splitItemsToTable('B', 'A', { [pizzaKey]: 1 });

    // A is now independent with 1 pizza (direct order)
    expect(store.tableCurrentBillSession['A']).toBeDefined();
    const newAOrd = store.orders.find(o => o.table === 'A' && o.isDirectEntry);
    expect(newAOrd).toBeDefined();
    expect(newAOrd.orderItems.some(i => i.name === 'Pizza')).toBe(true);

    // ordA on B has 1 pizza with quantity reduced (no storno)
    const bOrdA = store.orders.find(o => o.id === ordA.id);
    expect(bOrdA.orderItems[0].quantity).toBe(1); // quantity reduced
    expect(bOrdA.orderItems[0].voidedQuantity).toBe(0); // NOT voided — no storno

    // A and B are now independent
    expect(store.getTableStatus('A').status).toBe('occupied');
    expect(store.getTableStatus('B').status).toBe('occupied');
  });

  it('single table split: moves selected items to a free target table', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);
    const ord = makeOrderWithItems('A', 'accepted', sessA,
      { name: 'Pizza', unitPrice: 10, quantity: 2 },
      { name: 'Acqua', unitPrice: 2, quantity: 1 },
    );
    await store.addOrder(ord);

    // Move 1 pizza to table B (free table, no prior session)
    const pizzaKey = `${ord.id}__${ord.orderItems[0].uid}`;
    await store.splitItemsToTable('A', 'B', { [pizzaKey]: 1 });

    const statusA = store.getTableStatus('A');
    const statusB = store.getTableStatus('B');

    // A still occupied (has remaining items)
    expect(statusA.status).toBe('occupied');
    // B now occupied with 1 pizza
    expect(statusB.status).toBe('occupied');

    const bOrd = store.orders.find(o => o.table === 'B');
    expect(bOrd.orderItems[0].name).toBe('Pizza');
    expect(bOrd.orderItems[0].quantity).toBe(1);
  });

  it('preserves combined pricing invariant when splitting an item with partially-voided modifiers', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);

    // Build an order manually to set modifier.price and correct totalAmount.
    // Item: 2 Burgers × €10 = €20 base
    // Modifier Cheese: price=3, quantity=2, voidedQuantity=1 → charge = max(0,2-1)*3 = 3
    // Modifier Bacon:  price=2, quantity=2, voidedQuantity=0 → charge = max(0,2-0)*2 = 4
    // Combined total = 20 + 3 + 4 = 27
    const itemUid = 'item_burger';
    const ord = {
      id: 'ord_mod_test',
      table: 'A',
      billSessionId: sessA,
      status: 'accepted',
      orderItems: [{
        uid: itemUid,
        dishId: 'dish_burger',
        name: 'Burger',
        unitPrice: 10,
        quantity: 2,
        voidedQuantity: 0,
        notes: [],
        modifiers: [
          { name: 'Cheese', price: 3, quantity: 2, voidedQuantity: 1 },
          { name: 'Bacon',  price: 2, quantity: 2, voidedQuantity: 0 },
        ],
      }],
      totalAmount: 27,
      itemCount: 2,
      globalNote: '',
      noteVisibility: { cassa: true, sala: true, cucina: true },
      isDirectEntry: false,
    };
    await store.addOrder(ord);

    // Split 1 of 2 Burgers to table B
    const itemQtyMap = { [`ord_mod_test__${itemUid}`]: 1 };
    await store.splitItemsToTable('A', 'B', itemQtyMap);

    const sourceOrd = store.orders.find(o => o.id === 'ord_mod_test');
    const targetOrd = store.orders.find(o => o.table === 'B');

    expect(sourceOrd).toBeDefined();
    expect(targetOrd).toBeDefined();

    // Source: 1 Burger active — quantity reduced, no storno (voidedQuantity unchanged)
    expect(sourceOrd.orderItems[0].quantity).toBe(1); // reduced by 1
    expect(sourceOrd.orderItems[0].voidedQuantity).toBe(0); // NOT voided — no storno
    // Source Cheese modifier stays at voidedQuantity=1 (already set; capped to new qty=1)
    expect(sourceOrd.orderItems[0].modifiers[0].voidedQuantity).toBe(1);
    // Source Bacon modifier stays at voidedQuantity=0; active=1, charge=max(0,1-0)*2=2
    expect(sourceOrd.orderItems[0].modifiers[1].voidedQuantity).toBe(0);
    // Source total = 10 + 0 + 2 = 12
    expect(sourceOrd.totalAmount).toBe(12);

    // Target: 1 Burger; Cheese targetVoided = max(0, 1 - sourceActiveAfter=1) = 0
    expect(targetOrd.orderItems[0].name).toBe('Burger');
    expect(targetOrd.orderItems[0].quantity).toBe(1);
    expect(targetOrd.orderItems[0].modifiers[0].name).toBe('Cheese');
    expect(targetOrd.orderItems[0].modifiers[0].voidedQuantity).toBe(0);
    expect(targetOrd.orderItems[0].modifiers[1].name).toBe('Bacon');
    expect(targetOrd.orderItems[0].modifiers[1].voidedQuantity).toBe(0);
    // Target total = 10 + max(0,1-0)*3 + max(0,1-0)*2 = 10 + 3 + 2 = 15
    expect(targetOrd.totalAmount).toBe(15);

    // Combined must equal original total (27)
    expect(sourceOrd.totalAmount + targetOrd.totalAmount).toBe(27);
  });

  it('fully-voided modifier does not resurface on target after split', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);

    // 2 items, modifier fully voided (voidedQty=2) — modifier contributes €0
    const itemUid = 'item_test';
    const ord = {
      id: 'ord_fullvoid',
      table: 'A',
      billSessionId: sessA,
      status: 'accepted',
      orderItems: [{
        uid: itemUid,
        dishId: 'dish_x',
        name: 'Piatto',
        unitPrice: 8,
        quantity: 2,
        voidedQuantity: 0,
        notes: [],
        modifiers: [
          { name: 'Extra', price: 5, quantity: 2, voidedQuantity: 2 }, // fully voided
        ],
      }],
      totalAmount: 16, // 2×8, modifier contributes 0
      itemCount: 2,
      globalNote: '',
      noteVisibility: { cassa: true, sala: true, cucina: true },
      isDirectEntry: false,
    };
    await store.addOrder(ord);

    // Split 1 item to B
    await store.splitItemsToTable('A', 'B', { [`ord_fullvoid__${itemUid}`]: 1 });

    const sourceOrd = store.orders.find(o => o.id === 'ord_fullvoid');
    const targetOrd = store.orders.find(o => o.table === 'B');

    // Source: item quantity=1 (reduced), modifier voidedQty capped to 1; charge=max(0,1-1)*5=0
    expect(sourceOrd.totalAmount).toBe(8);
    // Target: targetModVoided = max(0, 2 - sourceActiveAfter=1) = 1; charge=max(0,1-1)=0
    expect(targetOrd.orderItems[0].modifiers[0].voidedQuantity).toBe(1);
    expect(targetOrd.totalAmount).toBe(8);
    // Combined = 8 + 8 = 16 (original, modifier remains 0 contribution)
    expect(sourceOrd.totalAmount + targetOrd.totalAmount).toBe(16);
  });

  it('moving ALL items of an order physically relocates the order — no storno on source', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);
    const ord = makeOrderWithItems('A', 'accepted', sessA,
      { name: 'Pizza', unitPrice: 10, quantity: 2 },
    );
    await store.addOrder(ord);

    // Move all 2 pizzas to B
    const result = await store.splitItemsToTable('A', 'B', { [`${ord.id}__${ord.orderItems[0].uid}`]: 2 });

    expect(result).toBe(true);

    // The original order is physically on B now (no copy, no void)
    const movedOrd = store.orders.find(o => o.id === ord.id);
    expect(movedOrd.table).toBe('B');
    expect(movedOrd.orderItems[0].voidedQuantity).toBe(0); // NOT voided — no storno
    expect(movedOrd.orderItems[0].quantity).toBe(2);       // quantity unchanged

    // Exactly one order exists on B (the relocated one, no duplicates)
    const activeOnB = store.orders.filter(
      o => o.table === 'B' && o.status !== 'completed' && o.status !== 'rejected',
    );
    expect(activeOnB.length).toBe(1);
    expect(activeOnB[0].id).toBe(ord.id);

    // No active orders remain on A
    const activeOnA = store.orders.filter(
      o => o.table === 'A' && o.status !== 'completed' && o.status !== 'rejected',
    );
    expect(activeOnA.length).toBe(0);

    // A is free, B is occupied
    expect(store.getTableStatus('A').status).toBe('free');
    expect(store.getTableStatus('B').status).toBe('occupied');
  });

  it('source session is cleaned up when all orders are physically moved away', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);
    const ord = makeOrderWithItems('A', 'accepted', sessA,
      { name: 'Acqua', unitPrice: 2, quantity: 1 },
    );
    await store.addOrder(ord);

    // Mark A as bill-requested
    store.setBillRequested('A', true);
    expect(store.billRequestedTables.has('A')).toBe(true);

    // Move the only item to B (full order move)
    await store.splitItemsToTable('A', 'B', { [`${ord.id}__${ord.orderItems[0].uid}`]: 1 });

    // The moved order is on B with B's session ID
    const sessB = store.tableCurrentBillSession['B'];
    expect(sessB).toBeDefined();
    const movedOrd = store.orders.find(o => o.id === ord.id);
    expect(movedOrd.table).toBe('B');
    expect(movedOrd.billSessionId).toBe(sessB.billSessionId);

    // A's session and occupancy state should be cleared
    expect(store.tableCurrentBillSession['A']).toBeUndefined();
    expect(store.tableOccupiedAt['A']).toBeUndefined();
    expect(store.billRequestedTables.has('A')).toBe(false);
  });

  it('current-session transactions are retagged to target when all orders are physically relocated', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);
    const ord = makeOrderWithItems('A', 'accepted', sessA,
      { name: 'Acqua', unitPrice: 2, quantity: 1 },
    );
    await store.addOrder(ord);

    // Record a partial payment on A before the move
    const txn = makeTransaction('A', 1, sessA);
    await store.addTransaction(txn);
    expect(store.transactions.find(t => t.id === txn.id).tableId).toBe('A');

    // Move the only item to B (full order → physical relocation)
    await store.splitItemsToTable('A', 'B', { [`${ord.id}__${ord.orderItems[0].uid}`]: 1 });

    // The transaction should now be retagged to B and its new session
    const sessB = store.tableCurrentBillSession['B'];
    expect(sessB).toBeDefined();
    const migratedTxn = store.transactions.find(t => t.id === txn.id);
    expect(migratedTxn.tableId).toBe('B');
    expect(migratedTxn.billSessionId).toBe(sessB.billSessionId);
  });

  it('partial and full moves from the same source: partial-move orders have quantity reduced, full-move orders relocate', async () => {
    const store = useAppStore();
    const sessA = await store.openTableSession('A', 2, 0);
    const ordFull = makeOrderWithItems('A', 'accepted', sessA,
      { name: 'Pizza', unitPrice: 10, quantity: 1 }, // will be fully moved
    );
    const ordPartial = makeOrderWithItems('A', 'accepted', sessA,
      { name: 'Birra', unitPrice: 4, quantity: 2 },  // only 1 of 2 will move
    );
    await store.addOrder(ordFull);
    await store.addOrder(ordPartial);

    const qtyMap = {
      [`${ordFull.id}__${ordFull.orderItems[0].uid}`]: 1,    // full move
      [`${ordPartial.id}__${ordPartial.orderItems[0].uid}`]: 1, // partial move
    };
    await store.splitItemsToTable('A', 'B', qtyMap);

    // ordFull is physically on B — no void
    expect(store.orders.find(o => o.id === ordFull.id).table).toBe('B');
    expect(store.orders.find(o => o.id === ordFull.id).orderItems[0].voidedQuantity).toBe(0);

    // ordPartial remains on A with quantity reduced (no storno)
    expect(store.orders.find(o => o.id === ordPartial.id).table).toBe('A');
    expect(store.orders.find(o => o.id === ordPartial.id).orderItems[0].quantity).toBe(1); // reduced
    expect(store.orders.find(o => o.id === ordPartial.id).orderItems[0].voidedQuantity).toBe(0); // no storno

    // B also has a new direct order for the partially moved Birra
    const directOnB = store.orders.find(o => o.table === 'B' && o.isDirectEntry);
    expect(directOnB).toBeDefined();
    expect(directOnB.orderItems.some(i => i.name === 'Birra' && i.quantity === 1)).toBe(true);

    // A still has the partial order, B is occupied
    expect(store.getTableStatus('A').status).toBe('occupied');
    expect(store.getTableStatus('B').status).toBe('occupied');
  });
});
