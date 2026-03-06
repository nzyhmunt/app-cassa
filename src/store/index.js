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
    ? new URLSearchParams(window.location.search).get('menuUrl')
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
      const menu = config.value.menu || {};
      Object.keys(data).forEach((key) => {
        menu[key] = data[key];
      });
      config.value.menu = menu;
    } catch (e) {
      menuError.value = e.message;
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

  // ── Cross-view navigation state ────────────────────────────────────────────
  const pendingOpenTable = ref(null);
  const pendingSelectOrder = ref(null);

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
    menuUrl,
    menuLoading,
    menuError,
    // computed
    cssVars,
    pendingCount,
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
