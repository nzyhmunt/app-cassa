import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { appConfig, initialOrders, updateOrderTotals } from '../utils/index.js';

export const useAppStore = defineStore('app', () => {
  // ── Core State ─────────────────────────────────────────────────────────────
  const config = ref(appConfig);
  const orders = ref(initialOrders);
  const transactions = ref([]);

  // ── Menu loading state ─────────────────────────────────────────────────────
  // menuUrl can be overridden via ?menuUrl=<url> query parameter
  const _paramUrl = typeof window !== 'undefined'
    ? (() => {
        // First, check regular query string (before '#')
        const searchParams = new URLSearchParams(window.location.search || '');
        let value = searchParams.get('menuUrl');
        if (value) return value;

        // Fallback: handle hash-based routing (e.g. /#/route?menuUrl=...)
        const hash = window.location.hash || '';
        const queryStart = hash.indexOf('?');
        if (queryStart === -1) return null;
        const hashQuery = hash.slice(queryStart + 1);
        const hashParams = new URLSearchParams(hashQuery);
        return hashParams.get('menuUrl');
      })()
    : null;
  const menuUrl = ref(_paramUrl || appConfig.menuUrl);
  const menuLoading = ref(false);
  const menuError = ref(null);

  async function loadMenu() {
    menuLoading.value = true;
    menuError.value = null;
    try {
      const response = await fetch(menuUrl.value);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (
        typeof data !== 'object' ||
        data === null ||
        Array.isArray(data) ||
        !Object.values(data).every(Array.isArray)
      ) {
        throw new Error('Formato menu non valido');
      }
      // Validate and coerce each item: require string id/name and finite number price
      const menu = {};
      Object.keys(data).forEach((category) => {
        const validItems = data[category].filter(item =>
          item !== null &&
          typeof item === 'object' &&
          typeof item.id === 'string' && item.id.trim() !== '' &&
          typeof item.name === 'string' && item.name.trim() !== '' &&
          typeof item.price === 'number' && isFinite(item.price)
        );
        if (validItems.length > 0) {
          menu[category] = validItems;
        }
      });
      if (Object.keys(menu).length === 0) {
        throw new Error('Nessun articolo valido nel menu');
      }
      config.value.menu = menu;
    } catch (e) {
      menuError.value = e instanceof Error ? e.message : String(e);
    } finally {
      menuLoading.value = false;
    }
  }

  // Auto-load the menu from the configured URL on startup
  loadMenu();

  // ── Cassa State ────────────────────────────────────────────────────────────
  const cashBalance = ref(0);
  const cashMovements = ref([]); // { id, type: 'versamento'|'prelievo', amount, reason, timestamp }
  const dailyClosures = ref([]); // stored closure summaries

  // ── Table extra state ──────────────────────────────────────────────────────
  // Maps tableId -> ISO timestamp of first accepted order
  const tableOccupiedAt = ref({});
  // Set of tableIds that have requested the bill (bill requested)
  const billRequestedTables = ref(new Set());

  // ── Computed: CSS variables for theming ────────────────────────────────────
  const cssVars = computed(() => ({
    '--brand-primary': config.value.ui.primaryColor,
    '--brand-dark': config.value.ui.primaryColorDark,
  }));

  // ── Computed: Orders ───────────────────────────────────────────────────────
  const pendingCount = computed(() => orders.value.filter(o => o.status === 'pending').length);

  // ── Computed: Table helpers ────────────────────────────────────────────────
  function getTableStatus(tableId) {
    const ords = orders.value.filter(
      o => o.table === tableId && o.status !== 'completed' && o.status !== 'rejected',
    );
    if (ords.length === 0) return { status: 'free', total: 0, remaining: 0 };

    // Include completed orders in the total so that per-order payments track correctly
    const billable = orders.value.filter(
      o => o.table === tableId && (o.status === 'accepted' || o.status === 'completed'),
    );
    const total = billable.reduce((a, b) => a + b.totalAmount, 0);
    const paid = transactions.value
      .filter(t => t.tableId === tableId)
      .reduce((a, t) => a + t.amountPaid, 0);
    const remaining = Math.max(0, total - paid);

    if (ords.some(o => o.status === 'pending')) return { status: 'pending', total, remaining };
    if (billRequestedTables.value.has(tableId)) return { status: 'conto_richiesto', total, remaining };
    return { status: 'occupied', total, remaining };
  }

  function getTableColorClass(tableId) {
    const st = getTableStatus(tableId).status;
    if (st === 'free') return 'border-emerald-200 text-emerald-800 bg-emerald-50 hover:bg-emerald-100';
    if (st === 'pending') return 'border-amber-400 text-amber-900 bg-amber-50 shadow-[0_0_15px_rgba(251,191,36,0.3)]';
    if (st === 'conto_richiesto') return 'border-blue-400 text-blue-900 bg-blue-100 shadow-[0_0_15px_rgba(59,130,246,0.3)]';
    return 'border-[var(--brand-primary)] text-white theme-bg shadow-md';
  }

  function getPaymentMethodIcon(methodId) {
    const m = config.value.paymentMethods.find(x => x.label === methodId || x.id === methodId);
    return m ? m.icon : 'banknote';
  }

  // ── Mutations: Orders ──────────────────────────────────────────────────────
  function addOrder(order) {
    orders.value.push(order);
  }

  function changeOrderStatus(order, newStatus) {
    order.status = newStatus;
    // When first accepted order for a table, record occupiedAt
    if (newStatus === 'accepted' && !tableOccupiedAt.value[order.table]) {
      tableOccupiedAt.value[order.table] = new Date().toISOString();
    }
    // When all orders for table are closed, clear occupiedAt and bill request
    const activeOrds = orders.value.filter(
      o => o.table === order.table && o.status !== 'completed' && o.status !== 'rejected',
    );
    if (activeOrds.length === 0) {
      delete tableOccupiedAt.value[order.table];
      const nextBillRequestedTables = new Set(billRequestedTables.value);
      nextBillRequestedTables.delete(order.table);
      billRequestedTables.value = nextBillRequestedTables;
    }
  }

  function updateQtyGlobal(ord, idx, delta) {
    if (!ord || ord.status !== 'pending') return;
    const item = ord.orderItems[idx];
    item.quantity += delta;
    if (item.quantity <= 0) ord.orderItems.splice(idx, 1);
    updateOrderTotals(ord);
  }

  function removeRowGlobal(ord, idx) {
    if (!ord || ord.status !== 'pending') return;
    ord.orderItems.splice(idx, 1);
    updateOrderTotals(ord);
  }

  function voidOrderItems(ord, idx, qtyToVoid) {
    if (!ord || ord.status !== 'accepted') return;
    const item = ord.orderItems[idx];
    if (!item.voidedQuantity) item.voidedQuantity = 0;
    if (item.voidedQuantity + qtyToVoid <= item.quantity) {
      item.voidedQuantity += qtyToVoid;
      updateOrderTotals(ord);
    }
  }

  function restoreOrderItems(ord, idx, qtyToRestore) {
    if (!ord || ord.status !== 'accepted') return;
    const item = ord.orderItems[idx];
    if (item.voidedQuantity && item.voidedQuantity >= qtyToRestore) {
      item.voidedQuantity -= qtyToRestore;
      updateOrderTotals(ord);
    }
  }

  // ── Mutations: Transactions ────────────────────────────────────────────────
  function addTransaction(txn) {
    transactions.value.push(txn);
    // Clear bill request when payment is made
    if (txn.tableId) setBillRequested(txn.tableId, false);
  }

  // ── Mutations: Table Operations ────────────────────────────────────────────
  function setBillRequested(tableId, val) {
    if (val) billRequestedTables.value.add(tableId);
    else billRequestedTables.value.delete(tableId);
    // Trigger reactivity: replace the Set
    billRequestedTables.value = new Set(billRequestedTables.value);
  }

  function moveTableOrders(fromTableId, toTableId) {
    // Move all active (non-completed/rejected) orders from fromTableId to toTableId
    orders.value.forEach(o => {
      if (o.table === fromTableId && o.status !== 'completed' && o.status !== 'rejected') {
        o.table = toTableId;
      }
    });
    // Move occupiedAt if set
    if (tableOccupiedAt.value[fromTableId]) {
      if (!tableOccupiedAt.value[toTableId]) {
        tableOccupiedAt.value[toTableId] = tableOccupiedAt.value[fromTableId];
      }
      delete tableOccupiedAt.value[fromTableId];
    }
    // Move bill request flag
    if (billRequestedTables.value.has(fromTableId)) {
      billRequestedTables.value.delete(fromTableId);
      billRequestedTables.value.add(toTableId);
      billRequestedTables.value = new Set(billRequestedTables.value);
    }
    // Also move related transactions
    transactions.value.forEach(t => {
      if (t.tableId === fromTableId) t.tableId = toTableId;
    });
  }

  function mergeTableOrders(sourceTableId, targetTableId) {
    // Move all active orders from sourceTableId to targetTableId
    orders.value.forEach(o => {
      if (o.table === sourceTableId && o.status !== 'completed' && o.status !== 'rejected') {
        o.table = targetTableId;
      }
    });
    // Preserve the earliest occupiedAt
    if (tableOccupiedAt.value[sourceTableId]) {
      const srcTime = tableOccupiedAt.value[sourceTableId];
      const tgtTime = tableOccupiedAt.value[targetTableId];
      if (!tgtTime || new Date(srcTime) < new Date(tgtTime)) {
        tableOccupiedAt.value[targetTableId] = srcTime;
      }
      delete tableOccupiedAt.value[sourceTableId];
    }
    // Clear bill request on source
    billRequestedTables.value.delete(sourceTableId);
    billRequestedTables.value = new Set(billRequestedTables.value);
    // Move transactions
    transactions.value.forEach(t => {
      if (t.tableId === sourceTableId) t.tableId = targetTableId;
    });
  }

  // ── Mutations: Cassa ───────────────────────────────────────────────────────
  function setCashBalance(amount) {
    cashBalance.value = amount;
  }

  // Backwards compatibility alias; prefer using setCashBalance going forward
  const setFondoCassa = setCashBalance;
  function addCashMovement(type, amount, reason) {
    cashMovements.value.push({
      id: 'mov_' + Math.random().toString(36).slice(2, 11),
      type, // 'versamento' | 'prelievo'
      amount,
      reason,
      timestamp: new Date().toISOString(),
    });
  }

  function _buildDailySummary() {
    // Aggregate transactions by payment method
    const byMethod = {};
    transactions.value.forEach(t => {
      const label = t.paymentMethod || 'Altro';
      if (!byMethod[label]) byMethod[label] = 0;
      byMethod[label] += t.amountPaid;
    });
    const totalReceived = Object.values(byMethod).reduce((a, b) => a + b, 0);

    // Total covers from completed tables
    const completedTables = new Set(
      transactions.value.map(t => t.tableId).filter(Boolean),
    );
    let totalCovers = 0;
    completedTables.forEach(tid => {
      const table = config.value.tables.find(t => t.id === tid);
      if (table) totalCovers += table.covers || 0;
    });

    const receiptCount = completedTables.size;
    const averageReceipt = receiptCount > 0 ? totalReceived / receiptCount : 0;

    const totalMovements = cashMovements.value.reduce((acc, m) => {
      return acc + (m.type === 'versamento' ? m.amount : -m.amount);
    }, 0);

    return {
      timestamp: new Date().toISOString(),
      cashBalance: cashBalance.value,
      totalReceived,
      byMethod,
      totalCovers,
      averageReceipt,
      receiptCount,
      cashMovementsData: [...cashMovements.value],
      totalMovements,
      finalBalance: cashBalance.value + totalReceived + totalMovements,
    };
  }

  function generateXReport() {
    return _buildDailySummary();
  }

  function performDailyClose() {
    const summary = _buildDailySummary();
    summary.type = 'Z';
    dailyClosures.value.push(summary);
    // Reset daily data
    transactions.value = [];
    cashMovements.value = [];
    cashBalance.value = summary.finalBalance;
    return summary;
  }

  function simulateNewOrder() {
    const num = Math.floor(Math.random() * 12) + 1;
    const newTav = num < 10 ? '0' + num : '' + num;
    orders.value.push({
      id: 'ord_' + Math.random().toString(36).substr(2, 9),
      table: newTav,
      status: 'pending',
      time: new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
      totalAmount: 12,
      itemCount: 1,
      dietaryPreferences: {},
      orderItems: [
        { uid: 'r_' + Date.now(), dishId: 'pri_2', name: 'Amatriciana', unitPrice: 12, quantity: 1, voidedQuantity: 0, notes: [] },
      ],
    });
  }

  // ── Computed: Closed bills ─────────────────────────────────────────────────
  // A bill is "closed" when a table has recorded transactions and all its orders
  // are now completed/rejected (i.e. table status is 'free').
  //
  // To avoid merging multiple distinct bills for the same table in a single day,
  // we group by a per-bill session key when available (e.g. `billSessionId` on
  // transactions / orders). If no session id is present, we fall back to grouping
  // by tableId, which preserves the previous behavior.
  const closedBills = computed(() => {
    const sessionsMap = new Map();

    // Group transactions by bill session (or by tableId as a fallback)
    for (const t of transactions.value) {
      if (!t.tableId) continue;
      const sessionId = t.billSessionId ?? null;
      const sessionKey = sessionId != null ? `${t.tableId}::${sessionId}` : t.tableId;

      if (!sessionsMap.has(sessionKey)) {
        const table = config.value.tables.find(tab => tab.id === t.tableId);
        sessionsMap.set(sessionKey, {
          tableId: t.tableId,
          billSessionId: sessionId,
          table,
          transactions: [],
        });
      }

      sessionsMap.get(sessionKey).transactions.push(t);
    }

    // Build closed bill objects from grouped sessions
    const bills = [];

    for (const session of sessionsMap.values()) {
      const { tableId, billSessionId, table, transactions: tableTxns } = session;

      // Only consider sessions whose table is currently free
      if (getTableStatus(tableId).status !== 'free') {
        continue;
      }

      // Sort transactions chronologically within the session
      tableTxns.sort(
        (a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0),
      );

      // Match completed orders for this table and (when present) this bill session
      const tableOrds = orders.value.filter(o => {
        if (o.table !== tableId || o.status !== 'completed') return false;
        if (billSessionId == null) return o.billSessionId == null;
        return o.billSessionId === billSessionId;
      });

      const totalPaid = tableTxns.reduce(
        (acc, txn) => acc + (txn.amountPaid || 0),
        0,
      );
      const closedAt = tableTxns[tableTxns.length - 1]?.timestamp;

      bills.push({
        tableId,
        billSessionId,
        table,
        transactions: tableTxns,
        orders: tableOrds,
        totalPaid,
        closedAt,
      });
    }

    return bills.sort(
      (a, b) => new Date(b.closedAt || 0) - new Date(a.closedAt || 0),
    );
  });

  // ── Cross-view navigation state ────────────────────────────────────────────
  const pendingOpenTable = ref(null);
  const pendingSelectOrder = ref(null);
  const pendingNewOrder = ref(null);

  return {
    // state
    config,
    orders,
    transactions,
    cashBalance,
    cashMovements,
    dailyClosures,
    tableOccupiedAt,
    billRequestedTables,
    pendingOpenTable,
    pendingSelectOrder,
    pendingNewOrder,
    menuUrl,
    menuLoading,
    menuError,
    // computed
    cssVars,
    pendingCount,
    closedBills,
    // helpers
    getTableStatus,
    getTableColorClass,
    getPaymentMethodIcon,
    // mutations
    addOrder,
    changeOrderStatus,
    updateQtyGlobal,
    removeRowGlobal,
    voidOrderItems,
    restoreOrderItems,
    addTransaction,
    simulateNewOrder,
    loadMenu,
    // table operations
    setBillRequested,
    moveTableOrders,
    mergeTableOrders,
    // cassa operations
    setFondoCassa,
    addCashMovement,
    generateXReport,
    performDailyClose,
  };
});
