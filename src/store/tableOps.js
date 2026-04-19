/**
 * @file store/tableOps.js
 * @description Factory for table-level operations: move, merge, split orders between tables.
 *
 * Usage: call `makeTableOps(state, helpers)` inside the Pinia store definition.
 * All parameters are the reactive refs / helper functions already defined in the store.
 */
import { saveStateToIDB, upsertBillSessionInIDB, closeBillSessionInIDB } from './persistence/operations.js';
import { updateOrderTotals } from '../utils/index.js';
import { newShortId } from './storeUtils.js';

/**
 * @param {object} state   – Reactive refs: orders, transactions, tableCurrentBillSession,
 *                           tableOccupiedAt, billRequestedTables, tableMergedInto
 * @param {object} helpers – Store functions: addDirectOrder, openTableSession,
 *                           getTableStatus, setBillRequested, slaveIdsOf, resolveMaster,
 *                           updateBillRequestedState
 */
export function makeTableOps(state, helpers) {
  const {
    orders, transactions,
    tableCurrentBillSession, tableOccupiedAt,
    billRequestedTables, tableMergedInto,
  } = state;
  const {
    addDirectOrder, openTableSession, getTableStatus, setBillRequested,
    slaveIdsOf, resolveMaster,
    updateBillRequestedState = null,
    enqueueOrderUpdate = () => {},
    enqueueTransactionUpdate = () => {},
    enqueueBillSessionUpdate = () => {},
    enqueueBillSessionCreate = () => {},
  } = helpers;

  const _deepEqual = (left, right) => {
    if (left === right) return true;
    if (left == null || right == null) return left === right;
    if (typeof left !== typeof right) return false;
    if (typeof left !== 'object') return false;
    if (Array.isArray(left) !== Array.isArray(right)) return false;

    if (Array.isArray(left)) {
      if (left.length !== right.length) return false;
      for (let i = 0; i < left.length; i += 1) {
        if (!_deepEqual(left[i], right[i])) return false;
      }
      return true;
    }

    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    for (const key of leftKeys) {
      if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
      if (!_deepEqual(left[key], right[key])) return false;
    }
    return true;
  };

  const _buildOrderSyncPatch = (prev, next) => {
    if (!prev || !next) return null;
    const payload = {};
    if (prev.table !== next.table) payload.table = next.table;
    if ((prev.billSessionId ?? null) !== (next.billSessionId ?? null)) {
      payload.billSessionId = next.billSessionId ?? null;
    }
    if (!_deepEqual(prev.orderItems ?? [], next.orderItems ?? [])) {
      payload.orderItems = next.orderItems;
    }
    if ((prev.totalAmount ?? null) !== (next.totalAmount ?? null)) {
      payload.totalAmount = next.totalAmount ?? null;
    }
    if ((prev.itemCount ?? null) !== (next.itemCount ?? null)) {
      payload.itemCount = next.itemCount ?? null;
    }
    return payload;
  };

  const _ordersUnchangedForSync = (prev, next) => {
    if (!prev || !next) return false;
    const payload = _buildOrderSyncPatch(prev, next);
    return payload !== null && Object.keys(payload).length === 0;
  };

  const _enqueueChangedOrders = (previousOrders, nextOrders) => {
    const prevById = new Map();
    for (const order of (previousOrders || [])) {
      prevById.set(String(order.id), order);
    }
    (nextOrders || []).forEach((order) => {
      const prev = prevById.get(String(order.id));
      if (!prev) return;
      if (_ordersUnchangedForSync(prev, order)) return;
      const payload = _buildOrderSyncPatch(prev, order);
      enqueueOrderUpdate(order.id, payload);
    });
  };

  const _enqueueChangedTransactions = (previousTransactions, nextTransactions) => {
    const prevById = new Map();
    for (const txn of (previousTransactions || [])) {
      prevById.set(String(txn.id), txn);
    }
    (nextTransactions || []).forEach((txn) => {
      const prev = prevById.get(String(txn.id));
      if (!prev) return;
      if (
        prev.tableId === txn.tableId &&
        (prev.billSessionId ?? null) === (txn.billSessionId ?? null)
      ) return;
      enqueueTransactionUpdate(txn);
    });
  };

  const _persistBillSessionPatchesToIDB = async (billSessionPatches, nextTCS) => {
    if (!Array.isArray(billSessionPatches) || billSessionPatches.length === 0) return;

    const sessionsById = new Map(
      Object.values(nextTCS || {})
        .filter((session) => session?.billSessionId)
        .map((session) => [session.billSessionId, session]),
    );

    for (const { billSessionId, payload } of billSessionPatches) {
      if (!billSessionId || !payload || typeof payload !== 'object') continue;
      if (payload.status === 'closed') {
        await closeBillSessionInIDB(billSessionId);
        continue;
      }
      const session = sessionsById.get(billSessionId);
      if (session) {
        await upsertBillSessionInIDB(session);
      }
    }
  };

  const _addBillSessionPatch = (billSessionPatches, billSessionId, payload) => {
    if (!billSessionId || !payload || typeof payload !== 'object') return;
    billSessionPatches.push({ billSessionId, payload });
  };

  const _cloneSession = (session) => {
    const plainSession = session ? { ...session } : session;
    try {
      return structuredClone(plainSession);
    } catch (_) {
      console.warn('[Store] Falling back to JSON clone for bill session projection');
      return JSON.parse(JSON.stringify(plainSession));
    }
  };

  // ── Floor-plan display helpers (private) ─────────────────────────────────
  //
  // tableMergedInto is used *exclusively* for the floor-plan "ghost-occupied"
  // display: a slave table delegates its status to the master so that the
  // cashier sees both tables as occupied even though all billing data lives on
  // the master. Writes may happen from these helpers or from billing flows
  // below via projected objects + assignment; the invariant is that reactive
  // state is assigned only after the corresponding IDB update is prepared/saved.

  /**
   * Removes the floor-plan ghost-occupied link for slaveId (no-op if not linked).
   * @param {string} slaveId
   */
  function _unlinkSlave(slaveId) {
    if (tableMergedInto.value[slaveId] == null) return;
    const next = { ...tableMergedInto.value };
    delete next[slaveId];
    tableMergedInto.value = next;
  }

  // ── _relocateOnArrays (private pure helper) ──────────────────────────────

  /**
   * Moves active orders from srcTableId → dstTableId on the given plain arrays.
   * Works on projected (plain object) copies rather than reactive refs so the
   * caller can save the result to IDB before assigning it back to the reactive
   * refs (IDB-first invariant).
   *
   * If srcSessionId is provided, only orders and transactions for that session are moved.
   * If srcSessionId is null, all non-completed/rejected orders move (transactions retagged
   * by tableId only, with billSessionId set to dstSessionId when provided).
   *
   * @param {string} srcTableId
   * @param {string} dstTableId
   * @param {string|null} srcSessionId
   * @param {string|null} dstSessionId
   * @param {object[]} ordersArr  - plain order objects (mutated in place on the projected copies)
   * @param {object[]} txnsArr    - plain transaction objects (mutated in place on the projected copies)
   *
   * NOTE: mutation is intentional — callers pass shallow-copy arrays (not reactive refs) so
   * they can accumulate all changes in one pass before persisting to IDB (IDB-first pattern).
   */
  function _relocateOnArrays(srcTableId, dstTableId, srcSessionId, dstSessionId, ordersArr, txnsArr) {
    ordersArr.forEach(o => {
      if (o.table !== srcTableId || o.status === 'rejected') return;
      if (srcSessionId ? o.billSessionId !== srcSessionId : o.status === 'completed') return;
      o.table = dstTableId;
      if (dstSessionId) o.billSessionId = dstSessionId;
    });
    if (srcSessionId) {
      txnsArr.forEach(t => {
        if (t.tableId === srcTableId && t.billSessionId === srcSessionId) {
          t.tableId = dstTableId;
          t.billSessionId = dstSessionId;
        }
      });
    } else {
      // When there is no source session context, only retag tableId.
      // Only assign dstSessionId to transactions that have no existing session
      // (t.billSessionId == null) to avoid corrupting historical/closed-bill
      // transactions that already carry their own billSessionId.
      txnsArr.forEach(t => {
        if (t.tableId === srcTableId) {
          t.tableId = dstTableId;
          if (dstSessionId && t.billSessionId == null) t.billSessionId = dstSessionId;
        }
      });
    }
  }

  // ── moveTableOrders ──────────────────────────────────────────────────────

  async function moveTableOrders(fromTableId, toTableId) {
    const previousOrders = orders.value;
    const previousTransactions = transactions.value;
    const billSessionPatches = [];
    let persistedToIDB = false;
    // Build projected copies of every piece of state that will change, so we
    // can persist to IDB *before* touching any reactive ref (IDB-first invariant).
    const nextOrders = orders.value.map(o => ({ ...o }));
    const nextTransactions = transactions.value.map(t => ({ ...t }));
    const nextOccupiedAt = { ...tableOccupiedAt.value };
    const nextTCS = { ...tableCurrentBillSession.value };
    const nextMergedInto = { ...tableMergedInto.value };
    const nextBillRequested = new Set(billRequestedTables.value);

    // occupied-at transfer
    if (nextOccupiedAt[fromTableId] && !nextOccupiedAt[toTableId]) {
      nextOccupiedAt[toTableId] = nextOccupiedAt[fromTableId];
    }
    delete nextOccupiedAt[fromTableId];

    // bill-requested transfer
    if (nextBillRequested.has(fromTableId)) {
      nextBillRequested.delete(fromTableId);
      nextBillRequested.add(toTableId);
    }

    // floor-plan display: clear stale merge link on destination, re-point slaves
    // of the source to the resolved destination, clear source's own slave link.
    delete nextMergedInto[toTableId];
    const resolvedTarget = resolveMaster(toTableId);
    slaveIdsOf(fromTableId).forEach(slaveId => { nextMergedInto[slaveId] = resolvedTarget; });
    delete nextMergedInto[fromTableId];

    // billing sessions + order relocation
    const srcSession = nextTCS[fromTableId];
    const destSession = nextTCS[toTableId];
    const srcSessionId = srcSession?.billSessionId;
    const destSessionId = destSession?.billSessionId;

    if (srcSession && destSession) {
      _relocateOnArrays(fromTableId, toTableId, srcSessionId, destSessionId, nextOrders, nextTransactions);
      nextTCS[toTableId] = {
        ...nextTCS[toTableId],
        adults: nextTCS[toTableId].adults + nextTCS[fromTableId].adults,
        children: nextTCS[toTableId].children + nextTCS[fromTableId].children,
      };
      delete nextTCS[fromTableId];
      _addBillSessionPatch(billSessionPatches, destSessionId, {
        adults: nextTCS[toTableId].adults,
        children: nextTCS[toTableId].children,
      });
      _addBillSessionPatch(billSessionPatches, srcSessionId, {
        status: 'closed',
        closed_at: new Date().toISOString(),
      });
    } else if (srcSession) {
      _relocateOnArrays(fromTableId, toTableId, null, srcSessionId, nextOrders, nextTransactions);
      const projectedSrcSession = _cloneSession(nextTCS[fromTableId]);
      projectedSrcSession.table = toTableId;
      nextTCS[toTableId] = projectedSrcSession;
      delete nextTCS[fromTableId];
      _addBillSessionPatch(billSessionPatches, srcSessionId, {
        table: toTableId,
      });
    } else {
      _relocateOnArrays(fromTableId, toTableId, null, destSessionId, nextOrders, nextTransactions);
    }

    // IDB-first: persist projected state before any reactive assignment.
    // On IDB failure we log a warning but still proceed with the reactive
    // update so the UI remains usable in offline/degraded mode. The periodic
    // debounced save (watcher in store/index.js) will retry the write shortly.
    try {
      await saveStateToIDB({
        orders: nextOrders,
        transactions: nextTransactions,
        tableCurrentBillSession: nextTCS,
        tableOccupiedAt: nextOccupiedAt,
        tableMergedInto: nextMergedInto,
        billRequestedTables: nextBillRequested,
      });
      await _persistBillSessionPatchesToIDB(billSessionPatches, nextTCS);
      persistedToIDB = true;
    } catch (err) {
      console.warn('[Store] moveTableOrders IDB save failed:', err);
    }

    // Assign reactive refs after IDB write completes.
    orders.value = nextOrders;
    transactions.value = nextTransactions;
    tableCurrentBillSession.value = nextTCS;
    tableOccupiedAt.value = nextOccupiedAt;
    tableMergedInto.value = nextMergedInto;
    // Apply the projected bill-requested state directly to the reactive ref when a
    // reactive-only helper is available; otherwise fall back to setBillRequested
    // (which issues its own IDB write — redundant but safe).
    if (updateBillRequestedState) {
      billRequestedTables.value = nextBillRequested;
    } else {
      if (billRequestedTables.value.has(fromTableId)) setBillRequested(fromTableId, false);
      if (nextBillRequested.has(toTableId)) setBillRequested(toTableId, true);
    }

    if (persistedToIDB) {
      _enqueueChangedOrders(previousOrders, nextOrders);
      _enqueueChangedTransactions(previousTransactions, nextTransactions);
      billSessionPatches.forEach(({ billSessionId, payload }) => enqueueBillSessionUpdate(billSessionId, payload));
    }
  }

  // ── mergeTableOrders ─────────────────────────────────────────────────────

  async function mergeTableOrders(sourceTableId, targetTableId) {
    const previousOrders = orders.value;
    const previousTransactions = transactions.value;
    const billSessionPatches = [];
    let createdTargetSession = null;
    let persistedToIDB = false;
    const resolvedTargetId = resolveMaster(targetTableId);
    if (sourceTableId === resolvedTargetId) return;

    // ── Billing: ensure target has an open session ───────────────────────────
    // openTableSession is already IDB-first (upsertBillSessionInIDB before reactive update).
    if (!tableCurrentBillSession.value[resolvedTargetId]) {
      await openTableSession(resolvedTargetId, 0, 0, { enqueueSync: false });
      createdTargetSession = _cloneSession(tableCurrentBillSession.value[resolvedTargetId]);
    }
    const targetSessionId = tableCurrentBillSession.value[resolvedTargetId].billSessionId;

    // Build projected copies of the remaining state that will change.
    const nextOrders = orders.value.map(o => ({ ...o }));
    const nextTransactions = transactions.value.map(t => ({ ...t }));
    const nextOccupiedAt = { ...tableOccupiedAt.value };
    const nextTCS = { ...tableCurrentBillSession.value };
    const nextMergedInto = { ...tableMergedInto.value };
    const nextBillRequested = new Set(billRequestedTables.value);

    // floor-plan display: re-point source's slaves to the new master, clear
    // source's own slave link (it is about to become a slave itself below).
    const srcSlaves = slaveIdsOf(sourceTableId);
    srcSlaves.forEach(slaveId => { nextMergedInto[slaveId] = resolvedTargetId; });
    delete nextMergedInto[sourceTableId];

    // billing: move current-session orders and transactions to master
    const srcSession = nextTCS[sourceTableId];
    const srcSessionId = srcSession?.billSessionId;
    _relocateOnArrays(sourceTableId, resolvedTargetId, srcSessionId, targetSessionId, nextOrders, nextTransactions);

    if (nextOccupiedAt[sourceTableId]) {
      const srcTime = nextOccupiedAt[sourceTableId];
      const tgtTime = nextOccupiedAt[resolvedTargetId];
      if (!tgtTime || new Date(srcTime) < new Date(tgtTime)) {
        nextOccupiedAt[resolvedTargetId] = srcTime;
      }
      delete nextOccupiedAt[sourceTableId];
    }
    srcSlaves.forEach(slaveId => { delete nextOccupiedAt[slaveId]; });

    nextTCS[resolvedTargetId] = {
      ...nextTCS[resolvedTargetId],
      adults: (nextTCS[resolvedTargetId]?.adults ?? 0) + (srcSession?.adults ?? 0),
      children: (nextTCS[resolvedTargetId]?.children ?? 0) + (srcSession?.children ?? 0),
    };
    delete nextTCS[sourceTableId];
    if (targetSessionId) {
      _addBillSessionPatch(billSessionPatches, targetSessionId, {
        adults: nextTCS[resolvedTargetId].adults,
        children: nextTCS[resolvedTargetId].children,
      });
    }
    if (srcSessionId) {
      _addBillSessionPatch(billSessionPatches, srcSessionId, {
        status: 'closed',
        closed_at: new Date().toISOString(),
      });
    }

    nextBillRequested.delete(sourceTableId);

    // floor-plan display: mark source as ghost-occupied slave of the master
    nextMergedInto[sourceTableId] = resolvedTargetId;

    // IDB-first: persist projected state before any reactive assignment.
    // On IDB failure we log and proceed (offline resilience — watcher retries).
    try {
      await saveStateToIDB({
        orders: nextOrders,
        transactions: nextTransactions,
        tableCurrentBillSession: nextTCS,
        tableOccupiedAt: nextOccupiedAt,
        tableMergedInto: nextMergedInto,
        billRequestedTables: nextBillRequested,
      });
      await _persistBillSessionPatchesToIDB(billSessionPatches, nextTCS);
      persistedToIDB = true;
    } catch (err) {
      console.warn('[Store] mergeTableOrders IDB save failed:', err);
    }

    // Assign reactive refs after IDB write completes.
    orders.value = nextOrders;
    transactions.value = nextTransactions;
    tableCurrentBillSession.value = nextTCS;
    tableOccupiedAt.value = nextOccupiedAt;
    tableMergedInto.value = nextMergedInto;
    if (updateBillRequestedState) {
      billRequestedTables.value = nextBillRequested;
    } else {
      setBillRequested(sourceTableId, false);
    }

    if (persistedToIDB) {
      if (createdTargetSession) enqueueBillSessionCreate(createdTargetSession);
      _enqueueChangedOrders(previousOrders, nextOrders);
      _enqueueChangedTransactions(previousTransactions, nextTransactions);
      billSessionPatches.forEach(({ billSessionId, payload }) => enqueueBillSessionUpdate(billSessionId, payload));
    }
  }

  // ── detachSlaveTable ──────────────────────────────────────────────────────

  async function detachSlaveTable(masterTableId, slaveTableId) {
    if (tableMergedInto.value[slaveTableId] !== masterTableId) return;

    const slaveHasOrders = orders.value.some(
      o => o.table === slaveTableId && o.status !== 'completed' && o.status !== 'rejected',
    );
    const previousOrders = orders.value;
    let persistedToIDB = false;

    // openTableSession is already IDB-first (upsertBillSessionInIDB before reactive update).
    let newSessionId = null;
    if (slaveHasOrders) {
      newSessionId = await openTableSession(slaveTableId, 0, 0);
    }

    // Project state changes on copies.
    const nextMergedInto = { ...tableMergedInto.value };
    delete nextMergedInto[slaveTableId];

    const nextOrders = slaveHasOrders
      ? orders.value.map(o => {
        if (o.table === slaveTableId && o.status !== 'completed' && o.status !== 'rejected') {
          return { ...o, billSessionId: newSessionId };
        }
        return o;
      })
      : orders.value;

    // IDB-first: persist projected state before any reactive assignment.
    // On IDB failure we log and proceed (offline resilience — watcher retries).
    const stateToSave = { tableMergedInto: nextMergedInto };
    if (slaveHasOrders) stateToSave.orders = nextOrders;
    try {
      await saveStateToIDB(stateToSave);
      persistedToIDB = true;
    } catch (err) {
      console.warn('[Store] detachSlaveTable IDB save failed:', err);
    }

    // Assign reactive refs after IDB write completes.
    tableMergedInto.value = nextMergedInto;
    if (slaveHasOrders) orders.value = nextOrders;
    if (persistedToIDB && slaveHasOrders) _enqueueChangedOrders(previousOrders, nextOrders);
  }

  // ── splitItemsToTable ────────────────────────────────────────────────────

  /**
   * Moves selected item quantities from one table to another at the item level.
   *
   * - itemQtyMap: { key: qtyToMove } where key = `${orderId}__${itemUid}`
   * - Blocks if the source has any pending orders.
   * - Full-order moves: physically relocate the order (no storno).
   * - Partial moves: copy moved items to target, reduce source quantity directly.
   * - Auto-detaches a merged slave target before moving items.
   *
   * @returns {boolean} true if any items were moved
   */
  async function splitItemsToTable(sourceTableId, targetTableId, itemQtyMap) {
    const previousOrders = orders.value;
    const previousTransactions = transactions.value;
    const billSessionPatches = [];
    let createdTargetSession = null;
    let persistedToIDB = false;
    if (!sourceTableId || !targetTableId || sourceTableId === targetTableId) return false;

    // Block if any source order is still awaiting kitchen confirmation
    if (orders.value.some(o => o.table === sourceTableId && o.status === 'pending')) return false;

    // Refuse if target is a slave of a *different* master
    const targetMaster = tableMergedInto.value[targetTableId];
    if (targetMaster && targetMaster !== sourceTableId) return false;

    // Pre-scan: ensure at least one item will actually move
    const hasValidItemsToMove = orders.value.some(ord => {
      if (ord.table !== sourceTableId) return false;
      if (ord.status === 'completed' || ord.status === 'rejected') return false;
      return ord.orderItems.some(item => {
        const netQty = item.quantity - (item.voidedQuantity || 0);
        if (netQty <= 0) return false;
        const key = `${ord.id}__${item.uid}`;
        return Math.min(Math.max(0, Math.floor(itemQtyMap[key] || 0)), netQty) > 0;
      });
    });
    if (!hasValidItemsToMove) return false;

    // ── Floor-plan display: build projected nextMergedInto without mutating the
    // reactive ref — actual reactive assignment happens after IDB write (IDB-first).
    const nextMergedInto = { ...tableMergedInto.value };
    if (targetMaster === sourceTableId) delete nextMergedInto[targetTableId];

    // Ensure target has an open billing session
    let targetSession = tableCurrentBillSession.value[targetTableId];
    if (!targetSession) {
      if (getTableStatus(targetTableId).status !== 'free') return false;
      await openTableSession(targetTableId, 0, 0, { enqueueSync: false });
      targetSession = tableCurrentBillSession.value[targetTableId];
      createdTargetSession = _cloneSession(targetSession);
    }
    if (!targetSession?.billSessionId) return false;
    const targetSessionId = targetSession.billSessionId;

    let anyMoved = false;
    const partialMoveItems = [];

    // Build a projected orders array by applying all mutations to deep clones.
    // This lets us persist the projected state to IDB *before* touching any reactive refs,
    // maintaining the IDB-first invariant even for existing-order relocations.
    const projectedOrders = orders.value.map(ord => {
      if (ord.table !== sourceTableId) return ord;
      if (ord.status === 'completed' || ord.status === 'rejected') return ord;

      const clone = JSON.parse(JSON.stringify(ord));
      const moves = [];
      let totalActiveInOrder = 0;
      let totalMovingFromOrder = 0;

      clone.orderItems.forEach(item => {
        const netQty = item.quantity - (item.voidedQuantity || 0);
        if (netQty <= 0) return;
        totalActiveInOrder += netQty;
        const key = `${clone.id}__${item.uid}`;
        const actualMoveQty = Math.min(Math.max(0, Math.floor(itemQtyMap[key] || 0)), netQty);
        totalMovingFromOrder += actualMoveQty;
        if (actualMoveQty > 0) moves.push({ item, actualMoveQty, netQty });
      });

      if (moves.length === 0) return clone;
      anyMoved = true;

      if (totalMovingFromOrder === totalActiveInOrder) {
        // All active items move → physically relocate the whole order
        clone.table = targetTableId;
        clone.billSessionId = targetSessionId;
      } else {
        // Partial move: copy items to target, reduce source quantity in clone
        moves.forEach(({ item, actualMoveQty, netQty }) => {
          const sourceActiveAfterSplit = netQty - actualMoveQty;
          partialMoveItems.push({
            uid: newShortId('spl'),
            dishId: item.dishId ?? null,
            name: item.name,
            unitPrice: item.unitPrice,
            quantity: actualMoveQty,
            voidedQuantity: 0,
            notes: item.notes ? [...item.notes] : [],
            modifiers: (item.modifiers || []).map(m => ({
              ...m,
              voidedQuantity: Math.max(0, (m.voidedQuantity || 0) - sourceActiveAfterSplit),
            })),
          });
          item.quantity -= actualMoveQty;
          for (const m of (item.modifiers || [])) {
            m.voidedQuantity = Math.min(m.voidedQuantity || 0, sourceActiveAfterSplit);
          }
        });
        clone.orderItems = clone.orderItems.filter(i => i.quantity - (i.voidedQuantity || 0) > 0);
        updateOrderTotals(clone);
      }

      return clone;
    });

    if (!anyMoved) return false;

    // ── Build complete projected cleanup state for all slices that will change ─
    const nextOccupiedAt = { ...tableOccupiedAt.value };
    if (!nextOccupiedAt[targetTableId]) {
      nextOccupiedAt[targetTableId] = new Date().toISOString();
    }

    // Determine source cleanup from the projected orders (before any reactive write).
    const sourceStillHasOrders = projectedOrders.some(
      o => o.table === sourceTableId && o.status !== 'completed' && o.status !== 'rejected',
    );

    let nextTransactions = transactions.value;
    let nextTCS = tableCurrentBillSession.value;
    let nextBillRequested = billRequestedTables.value;

    if (!sourceStillHasOrders) {
      const srcSessionId = tableCurrentBillSession.value[sourceTableId]?.billSessionId;
      // Retag transactions from the closing source session to the target (immutable update).
      nextTransactions = srcSessionId
        ? transactions.value.map(t =>
            t.tableId === sourceTableId && t.billSessionId === srcSessionId
              ? { ...t, tableId: targetTableId, billSessionId: targetSessionId }
              : t,
          )
        : transactions.value;
      const projectedTCS = { ...tableCurrentBillSession.value };
      delete projectedTCS[sourceTableId];
      nextTCS = projectedTCS;
      delete nextOccupiedAt[sourceTableId];
      const projectedBillRequested = new Set(billRequestedTables.value);
      projectedBillRequested.delete(sourceTableId);
      nextBillRequested = projectedBillRequested;
      // Floor-plan display: remove all merge links involving the now-empty source.
      slaveIdsOf(sourceTableId).forEach(slaveId => { delete nextMergedInto[slaveId]; });
      delete nextMergedInto[sourceTableId];
      if (srcSessionId) {
        _addBillSessionPatch(billSessionPatches, srcSessionId, {
          status: 'closed',
          closed_at: new Date().toISOString(),
        });
      }
    }

    // IDB-first: persist all projected state before any reactive assignment.
    // On IDB failure we log and proceed (offline resilience — watcher retries).
    try {
      await saveStateToIDB({
        orders: projectedOrders,
        transactions: nextTransactions,
        tableCurrentBillSession: nextTCS,
        tableOccupiedAt: nextOccupiedAt,
        tableMergedInto: nextMergedInto,
        billRequestedTables: nextBillRequested,
      });
      await _persistBillSessionPatchesToIDB(billSessionPatches, nextTCS);
      persistedToIDB = true;
    } catch (err) {
      console.warn('[Store] splitItemsToTable IDB save failed:', err);
    }

    if (!persistedToIDB) return false;

    // Assign reactive refs only after IDB write completes successfully.
    orders.value = projectedOrders;
    transactions.value = nextTransactions;
    tableCurrentBillSession.value = nextTCS;
    tableOccupiedAt.value = nextOccupiedAt;
    tableMergedInto.value = nextMergedInto;
    if (updateBillRequestedState) {
      billRequestedTables.value = nextBillRequested;
    } else if (!sourceStillHasOrders) {
      setBillRequested(sourceTableId, false);
    }

    if (createdTargetSession) enqueueBillSessionCreate(createdTargetSession);
    _enqueueChangedOrders(previousOrders, projectedOrders);
    _enqueueChangedTransactions(previousTransactions, nextTransactions);
    billSessionPatches.forEach(({ billSessionId, payload }) => enqueueBillSessionUpdate(billSessionId, payload));

    if (partialMoveItems.length > 0) await addDirectOrder(targetTableId, targetSessionId, partialMoveItems);

    return true;
  }

  return {
    moveTableOrders,
    mergeTableOrders,
    detachSlaveTable,
    splitItemsToTable,
  };
}
