/**
 * @file store/index.js
 * @description Pinia store shared (at the code/definition level) between the
 * Cassa and Sala applications.
 *
 * This module defines the store that acts as the single source of truth for
 * runtime state such as orders, transactions, table sessions, and
 * configuration. Each entry point (e.g. cassa-main.js and sala-main.js) mounts
 * its own Vue application with an independent Pinia instance, so every
 * browser page/tab gets its own in-memory store state. What is shared
 * between the Cassa and Sala apps is the store definition and logic, not
 * the live in-memory data (see vite.config.js for the multi-page setup).
 *
 * Key data structures:
 *   orders[]       – All order objects (pending → accepted → preparing → ready → completed/rejected)
 *   transactions[] – Payment records linked to orders via billSessionId
 *   tableCurrentBillSession{} – Active seating session per table
 *   tableOccupiedAt{}         – ISO timestamp when a table was first opened
 *   billRequestedTables (Set) – Tables that requested the bill
 *   closedBills[]             – Archived bill sessions after full payment
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { appConfig, initialOrders, updateOrderTotals, KITCHEN_ACTIVE_STATUSES, KEYBOARD_POSITIONS } from '../utils/index.js';
import { getInstanceName, resolveStorageKeys } from './persistence.js';

// Derive storage keys once at module load — stable for the lifetime of the page
const _instanceName = getInstanceName();
const { storageKey, settingsKey } = resolveStorageKeys(_instanceName);

export const useAppStore = defineStore('app', () => {

  // ── Core State ─────────────────────────────────────────────────────────────
  const config = ref(appConfig);
  // orders is initialized empty; pinia-plugin-persistedstate will hydrate saved state,
  // or afterHydrate will fall back to initialOrders on first load.
  const orders = ref([]);
  const transactions = ref([]);

  // ── Menu loading state ─────────────────────────────────────────────────────
  // menuUrl priority: app-settings (user-saved) > appConfig default.
  // The URL is set at build time via appConfig.menuUrl or updated by the user in Settings.
  const _savedAppSettings = (() => {
    try {
      if (typeof window === 'undefined') return null;
      const raw = window.localStorage.getItem(settingsKey);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  })();
  const menuUrl = ref(
    (typeof _savedAppSettings?.menuUrl === 'string' && _savedAppSettings.menuUrl.trim() !== '')
      ? _savedAppSettings.menuUrl
      : appConfig.menuUrl
  );
  const preventScreenLock = ref(
    typeof _savedAppSettings?.preventScreenLock === 'boolean'
      ? _savedAppSettings.preventScreenLock
      : false
  );
  const customKeyboard = ref(
    (() => {
      const v = _savedAppSettings?.customKeyboard;
      if (v === true) return 'center';           // migrate old boolean true
      if (v === false || v === null || v === undefined) return 'disabled';  // migrate old boolean false / missing
      return KEYBOARD_POSITIONS.includes(v) ? v : 'disabled';
    })()
  );
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
  const cashMovements = ref([]); // { id, type: 'deposit'|'withdrawal', amount, reason, timestamp }
  const dailyClosures = ref([]); // stored closure summaries

  // ── Table extra state ──────────────────────────────────────────────────────
  // Maps tableId -> ISO timestamp of first accepted order
  const tableOccupiedAt = ref({});
  // Set of tableIds that have requested the bill (bill requested)
  const billRequestedTables = ref(new Set());
  // Maps tableId -> { billSessionId, adults, children } for the current open session
  const tableCurrentBillSession = ref({});

  // ── Computed: CSS variables for theming ────────────────────────────────────
  const cssVars = computed(() => ({
    '--brand-primary': config.value.ui.primaryColor,
    '--brand-dark': config.value.ui.primaryColorDark,
  }));

    // ── Computed: Orders ───────────────────────────────────────────────────────
  const pendingCount = computed(() => orders.value.filter(o => o.status === 'pending').length);
  const inKitchenCount = computed(() =>
    orders.value.filter(o => KITCHEN_ACTIVE_STATUSES.includes(o.status)).length,
  );

  // ── Computed: Table helpers ────────────────────────────────────────────────
  function getTableStatus(tableId) {
    const ords = orders.value.filter(
      o => o.table === tableId && o.status !== 'completed' && o.status !== 'rejected',
    );
    if (ords.length === 0) return { status: 'free', total: 0, remaining: 0 };

    // Include completed orders in the total so that per-order payments track correctly
    const billable = orders.value.filter(
      o => o.table === tableId && (KITCHEN_ACTIVE_STATUSES.includes(o.status) || o.status === 'completed'),
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
    // When first kitchen-active order for a table, record occupiedAt
    if (KITCHEN_ACTIVE_STATUSES.includes(newStatus) && !tableOccupiedAt.value[order.table]) {
      tableOccupiedAt.value[order.table] = new Date().toISOString();
    }
    // When all orders for table are closed, clear occupiedAt, bill request, and session
    const activeOrds = orders.value.filter(
      o => o.table === order.table && o.status !== 'completed' && o.status !== 'rejected',
    );
    if (activeOrds.length === 0) {
      delete tableOccupiedAt.value[order.table];
      // Clear bill session for the table
      const nextSession = { ...tableCurrentBillSession.value };
      delete nextSession[order.table];
      tableCurrentBillSession.value = nextSession;
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
    if (!ord || !KITCHEN_ACTIVE_STATUSES.includes(ord.status)) return;
    if (!Number.isInteger(qtyToVoid) || qtyToVoid <= 0) return;
    const item = ord.orderItems[idx];
    if (!item.voidedQuantity) item.voidedQuantity = 0;
    if (item.voidedQuantity + qtyToVoid <= item.quantity) {
      item.voidedQuantity += qtyToVoid;
      // Clamp per-modifier voidedQuantity so combined never exceeds item.quantity
      const maxModActive = item.quantity - item.voidedQuantity;
      for (const m of (item.modifiers || [])) {
        m.voidedQuantity = Math.min(m.voidedQuantity || 0, maxModActive);
      }
      updateOrderTotals(ord);
    }
  }

  function restoreOrderItems(ord, idx, qtyToRestore) {
    if (!ord || !KITCHEN_ACTIVE_STATUSES.includes(ord.status)) return;
    if (!Number.isInteger(qtyToRestore) || qtyToRestore <= 0) return;
    const item = ord.orderItems[idx];
    if (item.voidedQuantity && item.voidedQuantity >= qtyToRestore) {
      item.voidedQuantity -= qtyToRestore;
      updateOrderTotals(ord);
    }
  }

  function voidModifier(ord, itemIdx, modIdx, qty) {
    if (!ord || !KITCHEN_ACTIVE_STATUSES.includes(ord.status)) return;
    if (!Number.isInteger(qty) || qty <= 0) return;
    const item = ord.orderItems[itemIdx];
    if (!item || !item.modifiers || modIdx < 0 || modIdx >= item.modifiers.length) return;
    const mod = item.modifiers[modIdx];
    if (!mod.voidedQuantity) mod.voidedQuantity = 0;
    if (mod.voidedQuantity + qty + (item.voidedQuantity || 0) <= item.quantity) {
      mod.voidedQuantity += qty;
      updateOrderTotals(ord);
    }
  }

  function restoreModifier(ord, itemIdx, modIdx, qty) {
    if (!ord || !KITCHEN_ACTIVE_STATUSES.includes(ord.status)) return;
    if (!Number.isInteger(qty) || qty <= 0) return;
    const item = ord.orderItems[itemIdx];
    if (!item || !item.modifiers || modIdx < 0 || modIdx >= item.modifiers.length) return;
    const mod = item.modifiers[modIdx];
    if ((mod.voidedQuantity || 0) >= qty) {
      mod.voidedQuantity -= qty;
      updateOrderTotals(ord);
    }
  }

  // ── Mutations: Item-level kitchen status ──────────────────────────────────
  // Marks an individual order item as kitchen-ready (or unready).
  // kitchenReady is an optional boolean on each orderItem — false/undefined = pending.
  function setItemKitchenReady(order, itemIdx, ready) {
    if (!order || !order.orderItems || itemIdx < 0 || itemIdx >= order.orderItems.length) return;
    order.orderItems[itemIdx].kitchenReady = ready;
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

  // Opens a new billing session for a table (called when the table is first seated).
  // Returns the generated billSessionId so callers can attach it to orders/transactions.
  function openTableSession(tableId, adults = 0, children = 0) {
    const billSessionId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'bill_' + Math.random().toString(36).slice(2, 11);
    tableCurrentBillSession.value = {
      ...tableCurrentBillSession.value,
      [tableId]: { billSessionId, adults, children },
    };
    return billSessionId;
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
    // Move bill session
    if (tableCurrentBillSession.value[fromTableId]) {
      if (!tableCurrentBillSession.value[toTableId]) {
        const next = { ...tableCurrentBillSession.value };
        next[toTableId] = next[fromTableId];
        delete next[fromTableId];
        tableCurrentBillSession.value = next;
      } else {
        // Destination already has a session — retag the moved orders and
        // transactions so they belong to the destination session and are
        // visible in its payment panel
        const srcSessionId = tableCurrentBillSession.value[fromTableId].billSessionId;
        const destSessionId = tableCurrentBillSession.value[toTableId].billSessionId;
        orders.value.forEach(o => {
          if (o.table === toTableId && o.billSessionId === srcSessionId) {
            o.billSessionId = destSessionId;
          }
        });
        transactions.value.forEach(t => {
          if (t.tableId === fromTableId && t.billSessionId === srcSessionId) {
            t.billSessionId = destSessionId;
          }
        });
        const next = { ...tableCurrentBillSession.value };
        // Combine headcounts so splitWays reflects the full party after the move
        next[toTableId] = {
          ...next[toTableId],
          adults: next[toTableId].adults + next[fromTableId].adults,
          children: next[toTableId].children + next[fromTableId].children,
        };
        delete next[fromTableId];
        tableCurrentBillSession.value = next;
      }
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
    // Migrate bill session: prefer destination's existing session; fall back to source's
    if (tableCurrentBillSession.value[sourceTableId]) {
      const next = { ...tableCurrentBillSession.value };
      if (!next[targetTableId]) {
        next[targetTableId] = next[sourceTableId];
      } else {
        // Target already has a session — retag moved orders and transactions to the target session
        const srcSessionId = next[sourceTableId].billSessionId;
        const destSessionId = next[targetTableId].billSessionId;
        orders.value.forEach(o => {
          if (o.table === targetTableId && o.billSessionId === srcSessionId) {
            o.billSessionId = destSessionId;
          }
        });
        transactions.value.forEach(t => {
          if (t.tableId === sourceTableId && t.billSessionId === srcSessionId) {
            t.billSessionId = destSessionId;
          }
        });
        // Combine headcounts so splitWays reflects the full party after the merge
        next[targetTableId] = {
          ...next[targetTableId],
          adults: next[targetTableId].adults + next[sourceTableId].adults,
          children: next[targetTableId].children + next[sourceTableId].children,
        };
      }
      delete next[sourceTableId];
      tableCurrentBillSession.value = next;
    }
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
      type, // 'deposit' | 'withdrawal'
      amount,
      reason,
      timestamp: new Date().toISOString(),
    });
  }

  function _buildDailySummary() {
    // Aggregate real payment transactions by payment method (exclude discounts)
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
        if (!byMethod[label]) byMethod[label] = 0;
        byMethod[label] += (t.amountPaid || 0) + (t.tipAmount || 0);
      });
    const totalReceived = Object.values(byMethod).reduce((a, b) => a + b, 0);

    // Count unique bill sessions: a table can have multiple receipts per day,
    // so we key on (tableId, billSessionId). Legacy transactions without a
    // billSessionId fall back to keying on tableId alone.
    const completedSessions = new Map();
    transactions.value
      .filter(t => t.tableId && t.operationType !== 'discount')
      .forEach(t => {
        const sessionKey = t.billSessionId != null ? `${t.tableId}::${t.billSessionId}` : t.tableId;
        if (!completedSessions.has(sessionKey)) {
          completedSessions.set(sessionKey, t.tableId);
        }
      });
    // Count covers for every session (not just unique tables) so that a table
    // used twice in a day contributes its cover count twice.
    let totalCovers = 0;
    completedSessions.forEach(tableId => {
      const table = config.value.tables.find(t => t.id === tableId);
      if (table) totalCovers += table.covers || 0;
    });

    const receiptCount = completedSessions.size;
    const averageReceipt = receiptCount > 0 ? totalReceived / receiptCount : 0;

    const totalMovements = cashMovements.value.reduce((acc, m) => {
      return acc + (m.type === 'deposit' ? m.amount : -m.amount);
    }, 0);

    return {
      timestamp: new Date().toISOString(),
      cashBalance: cashBalance.value,
      totalReceived,
      totalDiscount,
      totalTips,
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

      // Match completed or rejected orders for this table and (when present) this bill session
      const tableOrds = orders.value.filter(o => {
        if (o.table !== tableId || (o.status !== 'completed' && o.status !== 'rejected')) return false;
        if (billSessionId == null) return o.billSessionId == null;
        return o.billSessionId === billSessionId;
      });

      // Separate discount transactions from real payments for correct reporting
      const paymentTxns = tableTxns.filter(txn => txn.operationType !== 'discount');
      const discountTxns = tableTxns.filter(txn => txn.operationType === 'discount');
      const totalPaid = paymentTxns.reduce((acc, txn) => acc + (txn.amountPaid || 0), 0);
      const totalDiscount = discountTxns.reduce((acc, txn) => acc + (txn.amountPaid || 0), 0);
      // Total tips (extra amounts not applied to the bill)
      const totalTips = tableTxns.reduce((acc, txn) => acc + (txn.tipAmount || 0), 0);
      const closedAt = tableTxns[tableTxns.length - 1]?.timestamp;

      bills.push({
        tableId,
        billSessionId,
        table,
        transactions: tableTxns,
        orders: tableOrds,
        totalPaid,
        totalDiscount,
        totalTips,
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
    tableCurrentBillSession,
    pendingOpenTable,
    pendingSelectOrder,
    pendingNewOrder,
    menuUrl,
    preventScreenLock,
    customKeyboard,
    menuLoading,
    menuError,
    // computed
    cssVars,
    pendingCount,
    inKitchenCount,
    closedBills,
    // helpers
    getTableStatus,
    getTableColorClass,
    getPaymentMethodIcon,
    // mutations
    addOrder,
    changeOrderStatus,
    setItemKitchenReady,
    updateQtyGlobal,
    removeRowGlobal,
    voidOrderItems,
    restoreOrderItems,
    voidModifier,
    restoreModifier,
    addTransaction,
    simulateNewOrder,
    loadMenu,
    // table operations
    setBillRequested,
    openTableSession,
    moveTableOrders,
    mergeTableOrders,
    // cassa operations
    setFondoCassa,
    addCashMovement,
    generateXReport,
    performDailyClose,
  };
}, {
  // ── Persistenza via pinia-plugin-persistedstate ─────────────────────────
  // Lo stato operativo è salvato in localStorage sotto la chiave `storageKey`,
  // derivata da `resolveStorageKeys(_instanceName)` e usata come source of truth.
  // Un serializzatore personalizzato gestisce la conversione Set↔Array per
  // billRequestedTables, che non è direttamente serializzabile in JSON.
  //
  // TODO (PWA): Sostituire localStorage con IndexedDB (storage: useIDBKeyval())
  //             e aggiungere la sincronizzazione Directus nel afterHydrate hook.
  persist: {
    key: storageKey,
    pick: [
      'orders',
      'transactions',
      'tableOccupiedAt',
      'billRequestedTables',
      'tableCurrentBillSession',
      'cashBalance',
      'cashMovements',
      'dailyClosures',
    ],
    serializer: {
      serialize(state) {
        return JSON.stringify({
          ...state,
          // Set is not JSON-serializable — convert to Array before storing
          billRequestedTables: Array.from(state.billRequestedTables),
        });
      },
      deserialize(raw) {
        try {
          const data = JSON.parse(raw);
          return {
            ...data,
            // Restore Array back to Set so the store can use it correctly
            billRequestedTables: new Set(
              Array.isArray(data.billRequestedTables) ? data.billRequestedTables : [],
            ),
          };
        } catch (error) {
          // If the persisted JSON is corrupted, remove it so the app can recover
          try {
            if (typeof window !== 'undefined' && window.localStorage) {
              window.localStorage.removeItem(storageKey);
            }
          } catch (_) {
            // Ignore storage access errors and fall back to a safe default
          }
          return {
            // Fall back to an empty Set; other fields use the store's initial state
            billRequestedTables: new Set(),
          };
        }
      },
    },
    // On first load (no saved state), seed orders with demo data.
    // On subsequent loads the plugin has already hydrated the saved orders above.
    afterHydrate(ctx) {
      if (!ctx.store.orders.length) {
        ctx.store.orders = initialOrders;
      }
    },
  },
});
