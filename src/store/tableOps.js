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

  // ── moveTableOrders ──────────────────────────────────────────────────────

  function moveTableOrders(fromTableId, toTableId) {
    orders.value.forEach(o => {
      if (o.table === fromTableId && o.status !== 'completed' && o.status !== 'rejected') {
        o.table = toTableId;
      }
    });

    if (tableOccupiedAt.value[fromTableId] && !tableOccupiedAt.value[toTableId]) {
      tableOccupiedAt.value[toTableId] = tableOccupiedAt.value[fromTableId];
    }
    delete tableOccupiedAt.value[fromTableId];

    if (billRequestedTables.value.has(fromTableId)) {
      setBillRequested(fromTableId, false);
      setBillRequested(toTableId, true);
    }

    // Clear any stale merge mapping on the destination before resolving
    if (tableMergedInto.value[toTableId]) delete tableMergedInto.value[toTableId];

    const resolvedTarget = resolveMaster(toTableId);
    slaveIdsOf(fromTableId).forEach(slaveId => {
      tableMergedInto.value = { ...tableMergedInto.value, [slaveId]: resolvedTarget };
    });
    if (tableMergedInto.value[fromTableId]) delete tableMergedInto.value[fromTableId];

    const srcSession = tableCurrentBillSession.value[fromTableId];
    if (srcSession) {
      const srcSessionId = srcSession.billSessionId;
      const destSession = tableCurrentBillSession.value[toTableId];
      if (!destSession) {
        // Free destination: move session and all transactions wholesale
        const next = { ...tableCurrentBillSession.value };
        next[toTableId] = next[fromTableId];
        delete next[fromTableId];
        tableCurrentBillSession.value = next;
        transactions.value.forEach(t => { if (t.tableId === fromTableId) t.tableId = toTableId; });
      } else {
        // Occupied destination: retag moved orders and active-session transactions
        const destSessionId = destSession.billSessionId;
        orders.value.forEach(o => {
          if (o.table === toTableId && o.billSessionId === srcSessionId) o.billSessionId = destSessionId;
        });
        transactions.value.forEach(t => {
          if (t.tableId === fromTableId && t.billSessionId === srcSessionId) {
            t.billSessionId = destSessionId;
            t.tableId = toTableId;
          }
        });
        const next = { ...tableCurrentBillSession.value };
        next[toTableId] = {
          ...next[toTableId],
          adults: next[toTableId].adults + next[fromTableId].adults,
          children: next[toTableId].children + next[fromTableId].children,
        };
        delete next[fromTableId];
        tableCurrentBillSession.value = next;
      }
    } else {
      transactions.value.forEach(t => { if (t.tableId === fromTableId) t.tableId = toTableId; });
      const destSession = tableCurrentBillSession.value[toTableId];
      if (destSession) {
        orders.value.forEach(o => {
          if (o.table === toTableId && o.status !== 'completed' && o.status !== 'rejected') {
            o.billSessionId = destSession.billSessionId;
          }
        });
      }
    }
  }

  // ── mergeTableOrders ─────────────────────────────────────────────────────

  function mergeTableOrders(sourceTableId, targetTableId) {
    const resolvedTargetId = resolveMaster(targetTableId);
    if (sourceTableId === resolvedTargetId) return;

    if (!tableCurrentBillSession.value[resolvedTargetId]) openTableSession(resolvedTargetId);
    const targetSessionId = tableCurrentBillSession.value[resolvedTargetId].billSessionId;

    const srcSlaves = slaveIdsOf(sourceTableId);
    srcSlaves.forEach(slaveId => {
      tableMergedInto.value = { ...tableMergedInto.value, [slaveId]: resolvedTargetId };
    });
    delete tableMergedInto.value[sourceTableId];

    const srcSession = tableCurrentBillSession.value[sourceTableId];
    const srcSessionId = srcSession?.billSessionId;

    orders.value.forEach(o => {
      if (o.table !== sourceTableId || o.status === 'rejected') return;
      if (srcSessionId) {
        if (o.billSessionId !== srcSessionId) return;
      } else {
        if (o.status === 'completed') return;
      }
      o.table = resolvedTargetId;
      o.billSessionId = targetSessionId;
    });

    if (srcSessionId) {
      transactions.value.forEach(t => {
        if (t.tableId === sourceTableId && t.billSessionId === srcSessionId) {
          t.tableId = resolvedTargetId;
          t.billSessionId = targetSessionId;
        }
      });
    }

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
    tableMergedInto.value = { ...tableMergedInto.value, [sourceTableId]: resolvedTargetId };
  }

  // ── splitTableOrders ─────────────────────────────────────────────────────

  function splitTableOrders(masterTableId, slaveTableId) {
    if (tableMergedInto.value[slaveTableId] !== masterTableId) return;

    const next = { ...tableMergedInto.value };
    delete next[slaveTableId];
    tableMergedInto.value = next;

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

    // Detach target slave only after we know at least one item will move
    if (targetMaster === sourceTableId) {
      const next = { ...tableMergedInto.value };
      delete next[targetTableId];
      tableMergedInto.value = next;
    }

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

      const nextMergedInto = { ...tableMergedInto.value };
      slaveIdsOf(sourceTableId).forEach(slaveId => { delete nextMergedInto[slaveId]; });
      delete nextMergedInto[sourceTableId];
      tableMergedInto.value = nextMergedInto;
    }

    return true;
  }

  return {
    moveTableOrders,
    mergeTableOrders,
    splitTableOrders,
    splitItemsToTable,
  };
}
