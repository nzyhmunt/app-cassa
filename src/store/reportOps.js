/**
 * @file store/reportOps.js
 * @description Daily closure / X-Z report helpers and the `closedBills` computed.
 *
 * Usage: call `makeReportOps(state, helpers)` inside the Pinia store definition.
 */
import { computed } from 'vue';

/**
 * @param {object} state   – Reactive refs: orders, transactions, cashBalance, cashMovements,
 *                           dailyClosures, config, fiscalReceipts, invoiceRequests
 * @param {object} helpers – Store functions: getTableStatus
 */
export function makeReportOps(state, helpers) {
  const { orders, transactions, cashBalance, cashMovements, dailyClosures, config, fiscalReceipts, invoiceRequests } = state;
  const { getTableStatus } = helpers;

  function _buildDailySummary() {
    const byMethod = {};
    const totalDiscount = transactions.value
      .filter(t => t.operationType === 'discount')
      .reduce((acc, t) => acc + (t.amountPaid || 0), 0);
    const totalTips = transactions.value
      .filter(t => t.operationType !== 'discount')
      .reduce((acc, t) => acc + (t.tipAmount || 0), 0);
    transactions.value
      .filter(t => t.operationType !== 'discount')
      .forEach(t => {
        const label = t.paymentMethod || 'Altro';
        byMethod[label] = (byMethod[label] || 0) + (t.amountPaid || 0) + (t.tipAmount || 0);
      });
    const totalReceived = Object.values(byMethod).reduce((a, b) => a + b, 0);

    // Count unique bill sessions (keyed by tableId::billSessionId or tableId for legacy rows)
    const completedSessions = new Map();
    transactions.value
      .filter(t => t.tableId && t.operationType !== 'discount')
      .forEach(t => {
        const key = t.billSessionId != null ? `${t.tableId}::${t.billSessionId}` : t.tableId;
        if (!completedSessions.has(key)) completedSessions.set(key, t.tableId);
      });
    let totalCovers = 0;
    completedSessions.forEach(tableId => {
      const table = config.value.tables.find(t => t.id === tableId);
      if (table) totalCovers += table.covers || 0;
    });

    const receiptCount = completedSessions.size;
    const totalMovements = cashMovements.value.reduce(
      (acc, m) => acc + (m.type === 'deposit' ? m.amount : -m.amount), 0,
    );

    // Fiscal receipts and invoices issued in the current session (after last Z-close).
    const lastCloseTimestamp = dailyClosures.value.length > 0
      ? dailyClosures.value[dailyClosures.value.length - 1].timestamp
      : null;
    const sessionStart = lastCloseTimestamp ? new Date(lastCloseTimestamp) : null;
    const _afterSessionStart = entry => !sessionStart || new Date(entry.timestamp) > sessionStart;

    const sessionFiscal = (fiscalReceipts?.value ?? []).filter(_afterSessionStart);
    const sessionInvoices = (invoiceRequests?.value ?? []).filter(_afterSessionStart);

    const fiscalCount = sessionFiscal.length;
    const fiscalTotal = sessionFiscal.reduce((acc, e) => acc + (e.totalAmount || 0), 0);
    const invoiceCount = sessionInvoices.length;
    const invoiceTotal = sessionInvoices.reduce((acc, e) => acc + (e.totalAmount || 0), 0);

    return {
      timestamp: new Date().toISOString(),
      cashBalance: cashBalance.value,
      totalReceived,
      totalDiscount,
      totalTips,
      byMethod,
      totalCovers,
      averageReceipt: receiptCount > 0 ? totalReceived / receiptCount : 0,
      receiptCount,
      cashMovementsData: [...cashMovements.value],
      totalMovements,
      finalBalance: cashBalance.value + totalReceived + totalMovements,
      fiscalCount,
      fiscalTotal,
      invoiceCount,
      invoiceTotal,
    };
  }

  function generateXReport() {
    return _buildDailySummary();
  }

  function performDailyClose() {
    const summary = { ..._buildDailySummary(), type: 'Z' };
    dailyClosures.value.push(summary);
    transactions.value = [];
    cashMovements.value = [];
    cashBalance.value = summary.finalBalance;
    return summary;
  }

  // A bill session is "closed" when the table is free and has payment transactions.
  // Grouped by billSessionId (or tableId for legacy rows without a session id).
  const closedBills = computed(() => {
    const sessionsMap = new Map();
    for (const t of transactions.value) {
      if (!t.tableId) continue;
      const sessionId = t.billSessionId ?? null;
      const key = sessionId != null ? `${t.tableId}::${sessionId}` : t.tableId;
      if (!sessionsMap.has(key)) {
        sessionsMap.set(key, {
          tableId: t.tableId,
          billSessionId: sessionId,
          table: config.value.tables.find(tab => tab.id === t.tableId),
          transactions: [],
        });
      }
      sessionsMap.get(key).transactions.push(t);
    }

    const bills = [];
    for (const { tableId, billSessionId, table, transactions: txns } of sessionsMap.values()) {
      if (getTableStatus(tableId).status !== 'free') continue;
      txns.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));

      const tableOrds = orders.value.filter(o => {
        if (o.table !== tableId || (o.status !== 'completed' && o.status !== 'rejected')) return false;
        return billSessionId == null ? o.billSessionId == null : o.billSessionId === billSessionId;
      });

      const paymentTxns = txns.filter(t => t.operationType !== 'discount');
      const discountTxns = txns.filter(t => t.operationType === 'discount');
      bills.push({
        tableId, billSessionId, table, transactions: txns, orders: tableOrds,
        totalPaid: paymentTxns.reduce((acc, t) => acc + (t.amountPaid || 0), 0),
        totalDiscount: discountTxns.reduce((acc, t) => acc + (t.amountPaid || 0), 0),
        totalTips: txns.reduce((acc, t) => acc + (t.tipAmount || 0), 0),
        closedAt: txns[txns.length - 1]?.timestamp,
      });
    }
    return bills.sort((a, b) => new Date(b.closedAt || 0) - new Date(a.closedAt || 0));
  });

  return { generateXReport, performDailyClose, closedBills };
}
