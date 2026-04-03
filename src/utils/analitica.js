/**
 * @file utils/analitica.js
 * @description Pure helper functions for the "analitica" (analytic) checkout mode.
 *
 * These functions are shared between CassaTableManager.vue and the unit tests
 * so that changes to the production logic automatically surface in tests.
 *
 * All function and parameter names use English identifiers.
 */

/**
 * Builds the flat list of individually selectable line items for analitica mode.
 *
 * - Each base item appears as one row (price = unitPrice only, excluding modifiers).
 * - Each paid modifier (price > 0, not fully voided) appears as a separate sub-row
 *   immediately after its parent item.
 * - Fully voided items (netQty ≤ 0) are skipped entirely.
 *
 * @param {object[]} orders - Accepted payable orders (tableAcceptedPayableOrders).
 * @returns {object[]} Flat array of row descriptors.
 */
export function buildFlatAnaliticaItems(orders) {
  const rows = [];
  for (const order of orders) {
    for (let itemIdx = 0; itemIdx < order.orderItems.length; itemIdx++) {
      const item = order.orderItems[itemIdx];
      const netQty = item.quantity - (item.voidedQuantity || 0);
      if (netQty <= 0) continue;

      // Base item row — price does NOT include modifier surcharges (they are separate rows)
      rows.push({
        key: `${order.id}__${itemIdx}`,
        orderId: order.id,
        itemIdx,
        modIdx: null,
        name: item.name,
        netQty,
        unitPrice: item.unitPrice,
        rowTotal: item.unitPrice * netQty,
        isDirectEntry: order.isDirectEntry || false,
        isModifier: false,
      });

      // Paid modifier sub-rows
      for (let modIdx = 0; modIdx < (item.modifiers || []).length; modIdx++) {
        const mod = item.modifiers[modIdx];
        if ((mod.price || 0) <= 0) continue; // skip free / note modifiers
        const modNetQty = Math.max(0, netQty - (mod.voidedQuantity || 0));
        if (modNetQty <= 0) continue; // skip fully voided modifiers
        rows.push({
          key: `${order.id}__${itemIdx}__mod__${modIdx}`,
          orderId: order.id,
          itemIdx,
          modIdx,
          name: mod.name,
          netQty: modNetQty,
          unitPrice: mod.price,
          rowTotal: mod.price * modNetQty,
          isDirectEntry: order.isDirectEntry || false,
          isModifier: true,
        });
      }
    }
  }
  return rows;
}

/**
 * Computes the uncapped total for the currently selected analitica quantities.
 *
 * @param {object[]} flatItems - Output of buildFlatAnaliticaItems.
 * @param {object}   qtyMap    - { key: selectedQty } reactive map (analiticaQty).
 * @returns {number} Sum of (unitPrice × selectedQty) for all rows.
 */
export function computeAnaliticaTotal(flatItems, qtyMap) {
  return flatItems.reduce((total, row) => {
    const qty = qtyMap[row.key] || 0;
    return total + row.unitPrice * qty;
  }, 0);
}

/**
 * Returns true when the uncapped selected total exceeds the remaining bill amount.
 * Used to block payment (canPay guard) and show an inline warning.
 *
 * @param {object[]} flatItems       - Output of buildFlatAnaliticaItems.
 * @param {object}   qtyMap          - { key: selectedQty } map.
 * @param {number}   amountRemaining - Remaining bill balance.
 * @returns {boolean}
 */
export function selectionExceedsRemaining(flatItems, qtyMap, amountRemaining) {
  return computeAnaliticaTotal(flatItems, qtyMap) > amountRemaining;
}

/**
 * Determines which orders should be auto-completed after an analitica payment.
 * An order is eligible only when every one of its rows (base items + paid modifiers)
 * has been fully selected (selectedQty >= netQty).
 *
 * @param {object[]} orders    - Accepted payable orders.
 * @param {object[]} flatItems - Output of buildFlatAnaliticaItems.
 * @param {object}   qtyMap    - { key: selectedQty } map.
 * @returns {string[]} Array of order IDs that should be marked completed.
 */
export function getOrdersToComplete(orders, flatItems, qtyMap) {
  const toComplete = [];
  for (const order of orders) {
    const orderRows = flatItems.filter(row => row.orderId === order.id);
    const fullySelected = orderRows.length > 0 &&
      orderRows.every(row => (qtyMap[row.key] || 0) >= row.netQty);
    if (fullySelected) toComplete.push(order.id);
  }
  return toComplete;
}
