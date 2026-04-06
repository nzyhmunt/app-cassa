/**
 * @file store/tableOps.js
 * @description Factory for table-level operations: move, merge, split orders between tables.
 *
 * Usage: call `makeTableOps(state, helpers)` inside the Pinia store definition.
 * All parameters are the reactive refs / helper functions already defined in the store.
 */
import { updateOrderTotals } from '../utils/index.js';
import { newUUID } from './storeUtils.js';

/**
 * @param {object} state   – Reactive refs: orders, transactions, tableCurrentBillSession,
 *                           tableOccupiedAt, billRequestedTables, tableMergedInto
 * @param {object} helpers – Store functions: addDirectOrder, openTableSession,
 *                           getTableStatus, setBillRequested, slaveIdsOf, resolveMaster
 */
export function makeTableOps(state, helpers) {
  const {
    orders, transactions,
    tableCurrentBillSession, tableOccupiedAt,
    billRequestedTables, tableMergedInto,
  } = state;
  const { addDirectOrder, openTableSession, getTableStatus, setBillRequested, slaveIdsOf, resolveMaster } = helpers;

  // ── Floor-plan display helpers (private) ─────────────────────────────────
  //
  // tableMergedInto is used *exclusively* for the floor-plan "ghost-occupied"
  // display: a slave table delegates its status to the master so that the
  // cashier sees both tables as occupied even though all billing data lives on
  // the master.  All writes to tableMergedInto go through these two helpers so
  // the display concern is visually isolated from the billing operations below.

  /**
   * Marks slaveId as a floor-plan ghost-occupied slave of masterId.
   * @param {string} slaveId
   * @param {string} masterId
   */
  function _linkSlave(slaveId, masterId) {
    tableMergedInto.value = { ...tableMergedInto.value, [slaveId]: masterId };
  }

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

  // ── _relocateOrders (private helper) ────────────────────────────────────

  /**
   * Moves active orders from srcTableId → dstTableId and reassigns their billSessionId.
   * Matching transactions are retagged in the same step.
   *
   * If srcSessionId is provided, only orders and transactions for that session are moved.
   * If srcSessionId is null, all non-completed/rejected orders move (transactions retagged
   * by tableId only, with billSessionId set to dstSessionId when provided).
   */
  function _relocateOrders(srcTableId, dstTableId, srcSessionId, dstSessionId) {
    orders.value.forEach(o => {
      if (o.table !== srcTableId || o.status === 'rejected') return;
      if (srcSessionId ? o.billSessionId !== srcSessionId : o.status === 'completed') return;
      o.table = dstTableId;
      if (dstSessionId) o.billSessionId = dstSessionId;
    });
    if (srcSessionId) {
      transactions.value.forEach(t => {
        if (t.tableId === srcTableId && t.billSessionId === srcSessionId) {
          t.tableId = dstTableId;
          t.billSessionId = dstSessionId;
        }
      });
    } else {
      transactions.value.forEach(t => {
        if (t.tableId === srcTableId) {
          t.tableId = dstTableId;
          if (dstSessionId) t.billSessionId = dstSessionId;
        }
      });
    }
  }

  // ── moveTableOrders ──────────────────────────────────────────────────────

  function moveTableOrders(fromTableId, toTableId) {
    if (tableOccupiedAt.value[fromTableId] && !tableOccupiedAt.value[toTableId]) {
      tableOccupiedAt.value[toTableId] = tableOccupiedAt.value[fromTableId];
    }
    delete tableOccupiedAt.value[fromTableId];

    if (billRequestedTables.value.has(fromTableId)) {
      setBillRequested(fromTableId, false);
      setBillRequested(toTableId, true);
    }

    // ── Floor-plan display: clear stale merge links on destination, re-point any
    //    slaves of the source to the resolved destination, clear source's own link.
    if (tableMergedInto.value[toTableId]) _unlinkSlave(toTableId);

    const resolvedTarget = resolveMaster(toTableId);
    slaveIdsOf(fromTableId).forEach(slaveId => _linkSlave(slaveId, resolvedTarget));
    if (tableMergedInto.value[fromTableId]) _unlinkSlave(fromTableId);

    const srcSession = tableCurrentBillSession.value[fromTableId];
    const destSession = tableCurrentBillSession.value[toTableId];
    const srcSessionId = srcSession?.billSessionId;
    const destSessionId = destSession?.billSessionId;

    if (srcSession && destSession) {
      // Both occupied: retag src orders + transactions to dest session, combine headcounts
      _relocateOrders(fromTableId, toTableId, srcSessionId, destSessionId);
      const next = { ...tableCurrentBillSession.value };
      next[toTableId] = {
        ...next[toTableId],
        adults: next[toTableId].adults + next[fromTableId].adults,
        children: next[toTableId].children + next[fromTableId].children,
      };
      delete next[fromTableId];
      tableCurrentBillSession.value = next;
    } else if (srcSession) {
      // Free destination: move all active orders (preserving billSessionId), move session wholesale
      _relocateOrders(fromTableId, toTableId, null, srcSessionId);
      const next = { ...tableCurrentBillSession.value };
      next[toTableId] = next[fromTableId];
      delete next[fromTableId];
      tableCurrentBillSession.value = next;
    } else {
      // No source session: move all active orders, adopt dest session if present
      _relocateOrders(fromTableId, toTableId, null, destSessionId);
    }
  }

  // ── mergeTableOrders ─────────────────────────────────────────────────────

  function mergeTableOrders(sourceTableId, targetTableId) {
    const resolvedTargetId = resolveMaster(targetTableId);
    if (sourceTableId === resolvedTargetId) return;

    // ── Billing: ensure target has an open session ───────────────────────────
    if (!tableCurrentBillSession.value[resolvedTargetId]) openTableSession(resolvedTargetId);
    const targetSessionId = tableCurrentBillSession.value[resolvedTargetId].billSessionId;

    // ── Floor-plan display: re-point source's slaves to the new master, clear
    //    source's own slave link (it is about to become a slave itself below).
    const srcSlaves = slaveIdsOf(sourceTableId);
    srcSlaves.forEach(slaveId => _linkSlave(slaveId, resolvedTargetId));
    _unlinkSlave(sourceTableId);

    // ── Billing: move current-session orders and transactions to master ───────
    const srcSession = tableCurrentBillSession.value[sourceTableId];
    const srcSessionId = srcSession?.billSessionId;
    _relocateOrders(sourceTableId, resolvedTargetId, srcSessionId, targetSessionId);

    if (tableOccupiedAt.value[sourceTableId]) {
      const srcTime = tableOccupiedAt.value[sourceTableId];
      const tgtTime = tableOccupiedAt.value[resolvedTargetId];
      if (!tgtTime || new Date(srcTime) < new Date(tgtTime)) {
        tableOccupiedAt.value[resolvedTargetId] = srcTime;
      }
      delete tableOccupiedAt.value[sourceTableId];
    }
    srcSlaves.forEach(slaveId => { delete tableOccupiedAt.value[slaveId]; });

    const next = { ...tableCurrentBillSession.value };
    next[resolvedTargetId] = {
      ...next[resolvedTargetId],
      adults: (next[resolvedTargetId]?.adults ?? 0) + (srcSession?.adults ?? 0),
      children: (next[resolvedTargetId]?.children ?? 0) + (srcSession?.children ?? 0),
    };
    delete next[sourceTableId];
    tableCurrentBillSession.value = next;

    setBillRequested(sourceTableId, false);

    // ── Floor-plan display: mark source as ghost-occupied slave of the master ─
    _linkSlave(sourceTableId, resolvedTargetId);
  }

  // ── detachSlaveTable ──────────────────────────────────────────────────────

  function detachSlaveTable(masterTableId, slaveTableId) {
    if (tableMergedInto.value[slaveTableId] !== masterTableId) return;

    // ── Floor-plan display: remove slave's ghost-occupied link ────────────────
    _unlinkSlave(slaveTableId);

    const slaveHasOrders = orders.value.some(
      o => o.table === slaveTableId && o.status !== 'completed' && o.status !== 'rejected',
    );
    if (slaveHasOrders) {
      const newSessionId = openTableSession(slaveTableId, 0, 0);
      orders.value.forEach(o => {
        if (o.table === slaveTableId && o.status !== 'completed' && o.status !== 'rejected') {
          o.billSessionId = newSessionId;
        }
      });
    }
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
  function splitItemsToTable(sourceTableId, targetTableId, itemQtyMap) {
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

    // ── Floor-plan display: detach target slave only after confirming a move will happen
    if (targetMaster === sourceTableId) _unlinkSlave(targetTableId);

    // Ensure target has an open billing session
    let targetSession = tableCurrentBillSession.value[targetTableId];
    if (!targetSession) {
      if (getTableStatus(targetTableId).status !== 'free') return false;
      openTableSession(targetTableId);
      targetSession = tableCurrentBillSession.value[targetTableId];
    }
    if (!targetSession?.billSessionId) return false;
    const targetSessionId = targetSession.billSessionId;

    let anyMoved = false;
    const partialMoveItems = [];

    orders.value.forEach(ord => {
      if (ord.table !== sourceTableId) return;
      if (ord.status === 'completed' || ord.status === 'rejected') return;

      const moves = [];
      let totalActiveInOrder = 0;
      let totalMovingFromOrder = 0;

      ord.orderItems.forEach(item => {
        const netQty = item.quantity - (item.voidedQuantity || 0);
        if (netQty <= 0) return;
        totalActiveInOrder += netQty;
        const key = `${ord.id}__${item.uid}`;
        const actualMoveQty = Math.min(Math.max(0, Math.floor(itemQtyMap[key] || 0)), netQty);
        totalMovingFromOrder += actualMoveQty;
        if (actualMoveQty > 0) moves.push({ item, actualMoveQty, netQty });
      });

      if (moves.length === 0) return;
      anyMoved = true;

      if (totalMovingFromOrder === totalActiveInOrder) {
        // All active items move → physically relocate the whole order
        ord.table = targetTableId;
        ord.billSessionId = targetSessionId;
      } else {
        // Partial move: copy items to target, reduce source quantity directly
        moves.forEach(({ item, actualMoveQty, netQty }) => {
          const sourceActiveAfterSplit = netQty - actualMoveQty;
          partialMoveItems.push({
            uid: newUUID('spl'),
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
        ord.orderItems = ord.orderItems.filter(i => i.quantity - (i.voidedQuantity || 0) > 0);
        updateOrderTotals(ord);
      }
    });

    if (!anyMoved) return false;

    if (partialMoveItems.length > 0) addDirectOrder(targetTableId, targetSessionId, partialMoveItems);
    if (!tableOccupiedAt.value[targetTableId]) {
      tableOccupiedAt.value[targetTableId] = new Date().toISOString();
    }

    // If source now has no active orders, clean up its session state
    const sourceStillHasOrders = orders.value.some(
      o => o.table === sourceTableId && o.status !== 'completed' && o.status !== 'rejected',
    );
    if (!sourceStillHasOrders) {
      const srcSessionId = tableCurrentBillSession.value[sourceTableId]?.billSessionId;
      if (srcSessionId) {
        transactions.value.forEach(t => {
          if (t.tableId === sourceTableId && t.billSessionId === srcSessionId) {
            t.tableId = targetTableId;
            t.billSessionId = targetSessionId;
          }
        });
      }
      delete tableOccupiedAt.value[sourceTableId];
      const nextSession = { ...tableCurrentBillSession.value };
      delete nextSession[sourceTableId];
      tableCurrentBillSession.value = nextSession;
      setBillRequested(sourceTableId, false);

      // ── Floor-plan display: remove any merge links involving the now-empty source
      slaveIdsOf(sourceTableId).forEach(slaveId => _unlinkSlave(slaveId));
      _unlinkSlave(sourceTableId);
    }

    return true;
  }

  return {
    moveTableOrders,
    mergeTableOrders,
    detachSlaveTable,
    splitItemsToTable,
  };
}
