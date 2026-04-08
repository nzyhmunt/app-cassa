/**
 * @file store/index.js
 * @description Pinia store shared between the Cassa and Sala applications.
 *
 * Single source of truth for orders, transactions, table sessions and config.
 * Each browser page/tab gets its own in-memory Pinia instance; the definition
 * (code) is shared but not the live data (see vite.config.js for the multi-page setup).
 *
 * State overview:
 *   orders[]                   – All order objects (pending → … → completed/rejected)
 *   transactions[]             – Payment records linked via billSessionId
 *   tableCurrentBillSession{}  – Active seating session per table
 *   tableOccupiedAt{}          – ISO timestamp when a table was first seated
 *   billRequestedTables (Set)  – Tables that requested the bill
 *   closedBills[]              – Archived sessions after full payment (computed)
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { appConfig, updateOrderTotals, KITCHEN_ACTIVE_STATUSES, KEYBOARD_POSITIONS } from '../utils/index.js';
import { getInstanceName, resolveStorageKeys } from './persistence.js';
import { newUUID } from './storeUtils.js';
import { makeTableOps } from './tableOps.js';
import { makeReportOps } from './reportOps.js';

const _instanceName = getInstanceName();
const { storageKey, settingsKey } = resolveStorageKeys(_instanceName);

export const useAppStore = defineStore('app', () => {

  // ── Core state ─────────────────────────────────────────────────────────────
  const config = ref(appConfig);
  const orders = ref([]);
  const transactions = ref([]);

  // ── Settings (read from localStorage before Pinia hydrates) ───────────────
  const _savedSettings = (() => {
    try {
      if (typeof window === 'undefined') return null;
      const raw = window.localStorage.getItem(settingsKey);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  })();

  const menuUrl = ref(
    (typeof _savedSettings?.menuUrl === 'string' && _savedSettings.menuUrl.trim() !== '')
      ? _savedSettings.menuUrl : appConfig.menuUrl,
  );
  const preventScreenLock = ref(
    typeof _savedSettings?.preventScreenLock === 'boolean' ? _savedSettings.preventScreenLock : true,
  );
  const customKeyboard = ref(
    (() => { const v = _savedSettings?.customKeyboard; return KEYBOARD_POSITIONS.includes(v) ? v : 'disabled'; })(),
  );
  // ID of the printer chosen for pre-conto dispatch (empty string = disabled)
  const preBillPrinterId = ref(
    typeof _savedSettings?.preBillPrinterId === 'string' ? _savedSettings.preBillPrinterId : '',
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
      if (typeof data !== 'object' || data === null || Array.isArray(data) ||
          !Object.values(data).every(Array.isArray)) {
        throw new Error('Formato menu non valido');
      }
      const menu = {};
      Object.keys(data).forEach(category => {
        const valid = data[category].filter(item =>
          item !== null && typeof item === 'object' &&
          typeof item.id === 'string' && item.id.trim() !== '' &&
          typeof item.name === 'string' && item.name.trim() !== '' &&
          typeof item.price === 'number' && isFinite(item.price),
        );
        if (valid.length > 0) menu[category] = valid;
      });
      if (Object.keys(menu).length === 0) throw new Error('Nessun articolo valido nel menu');
      config.value.menu = menu;
    } catch (e) {
      menuError.value = e instanceof Error ? e.message : String(e);
    } finally {
      menuLoading.value = false;
    }
  }
  loadMenu();

  // ── Cassa state ────────────────────────────────────────────────────────────
  const cashBalance = ref(0);
  const cashMovements = ref([]);
  const dailyClosures = ref([]);

  // ── Print log ──────────────────────────────────────────────────────────────
  // Persisted list of dispatched print jobs metadata (max 200 entries, newest first).
  // In-memory entry shape:
  //   { logId, jobId, printerId, printerName, printerUrl,
  //     printType, table, timestamp, payload?,
  //     status: 'pending' | 'printing' | 'done' | 'error',
  //     errorMessage?: string,
  //     isReprint?: boolean, originalJobId?: string }
  // Note: `payload` is in-memory only and is stripped before persistence,
  // so reloaded entries may not include it.
  const printLog = ref([]);

  /** Prepends a print log entry (status defaults to 'pending'), keeping at most 200 entries. */
  function addPrintLogEntry(entry) {
    printLog.value = [{ status: 'pending', ...entry }, ...printLog.value].slice(0, 200);
  }

  /** Updates a print log entry in-place by logId. */
  function updatePrintLogEntry(logId, updates) {
    const idx = printLog.value.findIndex(e => e.logId === logId);
    if (idx !== -1) {
      printLog.value[idx] = { ...printLog.value[idx], ...updates };
    }
  }

  /** Clears the entire print log. */
  function clearPrintLog() {
    printLog.value = [];
  }

  // ── Table state ────────────────────────────────────────────────────────────
  const tableOccupiedAt = ref({});
  const billRequestedTables = ref(new Set());
  const tableCurrentBillSession = ref({});
  // slaveTableId → masterTableId; slave shows as "occupied" by delegating to master
  const tableMergedInto = ref({});

  // ── Merge-graph helpers (used by getTableStatus & changeOrderStatus) ────────
  function slaveIdsOf(masterId) {
    if (!masterId) return [];
    return Object.keys(tableMergedInto.value).filter(id => tableMergedInto.value[id] === masterId);
  }
  function resolveMaster(tableId) {
    const visited = new Set();
    let cur = tableId;
    while (tableMergedInto.value[cur] != null) {
      if (visited.has(cur)) break;
      visited.add(cur);
      cur = tableMergedInto.value[cur];
    }
    return cur;
  }

  // Floor-plan display query helpers — use these in components instead of
  // accessing tableMergedInto directly.  tableMergedInto is an internal
  // implementation detail whose sole purpose is the floor-plan ghost-occupied
  // display; exposing a stable API keeps components decoupled from the raw shape.
  /** Returns true when tableId is a merged slave delegating its status to a master. */
  function isMergedSlave(tableId) { return !!tableMergedInto.value[tableId]; }
  /** Returns the master table ID for a merged slave, or null if not a slave. */
  function masterTableOf(tableId) { return tableMergedInto.value[tableId] ?? null; }

  // ── Computed ───────────────────────────────────────────────────────────────
  const cssVars = computed(() => ({
    '--brand-primary': config.value.ui.primaryColor,
    '--brand-dark': config.value.ui.primaryColorDark,
  }));
  const rooms = computed(() => {
    const r = config.value.rooms;
    if (Array.isArray(r) && r.length > 0) return r;
    return [{ id: 'main', label: '', tables: config.value.tables ?? [] }];
  });
  const pendingCount = computed(() => orders.value.filter(o => o.status === 'pending').length);
  const inKitchenCount = computed(() =>
    orders.value.filter(o => KITCHEN_ACTIVE_STATUSES.includes(o.status)).length,
  );

  // ── Table helpers ──────────────────────────────────────────────────────────
  function getTableStatus(tableId) {
    const master = resolveMaster(tableId);
    if (tableMergedInto.value[tableId]) {
      if (master !== tableId) return { ...getTableStatus(master), isMergedSlave: true, masterTableId: master };
      return { status: 'free', total: 0, remaining: 0 }; // cycle guard
    }
    const ords = orders.value.filter(
      o => o.table === tableId && o.status !== 'completed' && o.status !== 'rejected',
    );
    if (ords.length === 0) return { status: 'free', total: 0, remaining: 0 };
    const session = tableCurrentBillSession.value[tableId];
    const billable = orders.value.filter(
      o => o.table === tableId &&
        (KITCHEN_ACTIVE_STATUSES.includes(o.status) || o.status === 'completed') &&
        (!session || o.billSessionId === session.billSessionId),
    );
    const total = billable.reduce((a, b) => a + b.totalAmount, 0);
    const paid = transactions.value
      .filter(t => t.tableId === tableId && (!session || t.billSessionId === session.billSessionId))
      .reduce((a, t) => a + t.amountPaid, 0);
    const remaining = Math.max(0, total - paid);
    if (ords.some(o => o.status === 'pending')) return { status: 'pending', total, remaining };
    if (remaining === 0) return { status: 'paid', total, remaining };
    if (billRequestedTables.value.has(tableId)) return { status: 'bill_requested', total, remaining };
    return { status: 'occupied', total, remaining };
  }

  function getTableColorClassFromStatus(status) {
    if (status === 'free') return 'border-emerald-200 text-emerald-800 bg-emerald-50 hover:bg-emerald-100';
    if (status === 'pending') return 'border-amber-400 text-amber-900 bg-amber-50 shadow-[0_0_15px_rgba(251,191,36,0.3)]';
    if (status === 'paid') return 'border-violet-400 text-violet-900 bg-violet-100 shadow-[0_0_15px_rgba(139,92,246,0.3)]';
    if (status === 'bill_requested') return 'border-blue-400 text-blue-900 bg-blue-100 shadow-[0_0_15px_rgba(59,130,246,0.3)]';
    return 'border-[var(--brand-primary)] text-white theme-bg shadow-md';
  }
  function getTableColorClass(tableId) {
    return getTableColorClassFromStatus(getTableStatus(tableId).status);
  }
  function getPaymentMethodIcon(methodId) {
    const m = config.value.paymentMethods.find(x => x.label === methodId || x.id === methodId);
    return m ? m.icon : 'banknote';
  }

  // ── Table session ──────────────────────────────────────────────────────────
  function setBillRequested(tableId, val) {
    if (val) billRequestedTables.value.add(tableId);
    else billRequestedTables.value.delete(tableId);
    billRequestedTables.value = new Set(billRequestedTables.value);
  }

  function openTableSession(tableId, adults = 0, children = 0) {
    const billSessionId = newUUID('bill');
    tableCurrentBillSession.value = {
      ...tableCurrentBillSession.value,
      [tableId]: { billSessionId, adults, children },
    };
    return billSessionId;
  }

  // ── Order mutations ────────────────────────────────────────────────────────
  function addOrder(order) {
    if (order.globalNote === undefined) order.globalNote = '';
    if (!order.noteVisibility) order.noteVisibility = { cassa: true, sala: true, cucina: true };
    orders.value.push(order);
  }

  function changeOrderStatus(order, newStatus, rejectionReason = null) {
    order.status = newStatus;
    if (newStatus === 'rejected' && rejectionReason) order.rejectionReason = rejectionReason;
    if (KITCHEN_ACTIVE_STATUSES.includes(newStatus) && !tableOccupiedAt.value[order.table]) {
      tableOccupiedAt.value[order.table] = new Date().toISOString();
    }
    const activeOrds = orders.value.filter(
      o => o.table === order.table && o.status !== 'completed' && o.status !== 'rejected',
    );
    if (activeOrds.length === 0) {
      delete tableOccupiedAt.value[order.table];
      const idsToUnmap = [...slaveIdsOf(order.table), ...(tableMergedInto.value[order.table] ? [order.table] : [])];
      if (idsToUnmap.length > 0) {
        const nextMerge = { ...tableMergedInto.value };
        idsToUnmap.forEach(id => delete nextMerge[id]);
        tableMergedInto.value = nextMerge;
      }
      const nextSession = { ...tableCurrentBillSession.value };
      delete nextSession[order.table];
      tableCurrentBillSession.value = nextSession;
      setBillRequested(order.table, false);
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
    if ((mod.voidedQuantity || 0) >= qty) { mod.voidedQuantity -= qty; updateOrderTotals(ord); }
  }

  function setItemKitchenReady(order, itemIdx, ready) {
    if (!order || !order.orderItems || itemIdx < 0 || itemIdx >= order.orderItems.length) return;
    order.orderItems[itemIdx].kitchenReady = ready;
  }

  // ── Transactions ───────────────────────────────────────────────────────────
  function addTransaction(txn) {
    transactions.value.push(txn);
    if (txn.tableId) setBillRequested(txn.tableId, false);
  }

  function addTipTransaction(tableId, billSessionId, tipValue) {
    if (!tableId || tipValue <= 0) return;
    transactions.value.push({
      transactionId: newUUID('tip'),
      tableId,
      billSessionId: billSessionId ?? null,
      paymentMethod: 'Mancia',
      operationType: 'tip',
      amountPaid: 0,
      tipAmount: tipValue,
      timestamp: new Date().toISOString(),
      orderRefs: [],
    });
  }

  // ── Direct orders (bypass kitchen workflow) ────────────────────────────────
  /**
   * Creates an order that immediately transitions to 'accepted', bypassing the kitchen queue.
   * Used for counter items, service charges, or items from splitItemsToTable.
   */
  function addDirectOrder(tableId, billSessionId, items) {
    if (!tableId || !Array.isArray(items) || items.length === 0) return null;
    const order = {
      id: newUUID('ord'),
      table: tableId,
      billSessionId: billSessionId ?? null,
      status: 'pending',
      time: new Date().toLocaleTimeString(appConfig.locale, { hour: '2-digit', minute: '2-digit', timeZone: appConfig.timezone }),
      totalAmount: 0,
      itemCount: 0,
      dietaryPreferences: {},
      orderItems: items.map(item => ({ ...item })),
      isDirectEntry: true,
    };
    updateOrderTotals(order);
    addOrder(order);
    changeOrderStatus(order, 'accepted');
    return order;
  }

  // ── Cassa operations ───────────────────────────────────────────────────────
  function setCashBalance(amount) { cashBalance.value = parseFloat(amount) || 0; }
  const setFondoCassa = setCashBalance; // backwards-compat alias

  function addCashMovement(type, amount, reason) {
    cashMovements.value.push({
      id: newUUID('mov'),
      type,
      amount: parseFloat(amount) || 0,
      reason,
      timestamp: new Date().toISOString(),
    });
  }

  function simulateNewOrder() {
    const num = Math.floor(Math.random() * 12) + 1;
    const newTav = num < 10 ? '0' + num : '' + num;
    const now = new Date().toLocaleTimeString(appConfig.locale, { hour: '2-digit', minute: '2-digit', timeZone: appConfig.timezone });
    const session = tableCurrentBillSession.value[newTav];
    orders.value.push({
      id: newUUID('ord'),
      table: newTav,
      billSessionId: session?.billSessionId ?? null,
      status: 'pending',
      time: now,
      totalAmount: 12,
      itemCount: 1,
      dietaryPreferences: {},
      globalNote: '',
      noteVisibility: { cassa: true, sala: true, cucina: true },
      orderItems: [
        { uid: `r_${Date.now()}`, dishId: 'pri_2', name: 'Amatriciana', unitPrice: 12, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
      ],
    });
    const cc = config.value.coverCharge;
    if (cc?.enabled && cc?.autoAdd && cc?.priceAdult > 0) {
      const coverOrder = addDirectOrder(newTav, session?.billSessionId ?? null, [
        { uid: newUUID('cop'), dishId: cc.dishId + '_adulto', name: cc.name, unitPrice: cc.priceAdult, quantity: 2, voidedQuantity: 0, notes: [], modifiers: [] },
      ]);
      if (coverOrder) coverOrder.isCoverCharge = true;
    }
  }

  // ── Table operations (extracted to tableOps.js) ────────────────────────────
  const { moveTableOrders, mergeTableOrders, detachSlaveTable, splitItemsToTable } =
    makeTableOps(
      { orders, transactions, tableCurrentBillSession, tableOccupiedAt, billRequestedTables, tableMergedInto },
      { addDirectOrder, openTableSession, getTableStatus, setBillRequested, slaveIdsOf, resolveMaster },
    );

  // ── Report operations (extracted to reportOps.js) ─────────────────────────
  const { generateXReport, performDailyClose, closedBills } =
    makeReportOps(
      { orders, transactions, cashBalance, cashMovements, dailyClosures, config },
      { getTableStatus },
    );

  // ── Cross-view navigation state ────────────────────────────────────────────
  const pendingOpenTable = ref(null);
  const pendingSelectOrder = ref(null);
  const pendingNewOrder = ref(null);

  return {
    // state
    config, orders, transactions,
    cashBalance, cashMovements, dailyClosures,
    tableOccupiedAt, billRequestedTables, tableCurrentBillSession, tableMergedInto,
    pendingOpenTable, pendingSelectOrder, pendingNewOrder,
    menuUrl, preventScreenLock, customKeyboard, preBillPrinterId, menuLoading, menuError,
    // print log
    printLog, addPrintLogEntry, updatePrintLogEntry, clearPrintLog,
    // computed
    cssVars, rooms, pendingCount, inKitchenCount, closedBills,
    // helpers
    getTableStatus, getTableColorClass, getTableColorClassFromStatus, getPaymentMethodIcon,
    // merge-graph display helpers (prefer these over raw tableMergedInto access in components)
    isMergedSlave, masterTableOf, slaveIdsOf,
    // order mutations
    addOrder, changeOrderStatus, setItemKitchenReady,
    updateQtyGlobal, removeRowGlobal,
    voidOrderItems, restoreOrderItems, voidModifier, restoreModifier,
    addTransaction, addTipTransaction, addDirectOrder, simulateNewOrder, loadMenu,
    // table operations
    setBillRequested, openTableSession,
    moveTableOrders, mergeTableOrders, detachSlaveTable, splitItemsToTable,
    // cassa operations
    setFondoCassa, addCashMovement, generateXReport, performDailyClose,
  };
}, {
  // ── Persistence (pinia-plugin-persistedstate) ──────────────────────────────
  // billRequestedTables is a Set — serialised as Array and restored on hydrate.
  // TODO (PWA): Replace localStorage with IndexedDB (storage: useIDBKeyval()).
  persist: {
    key: storageKey,
    pick: [
      'orders', 'transactions',
      'tableOccupiedAt', 'billRequestedTables', 'tableCurrentBillSession', 'tableMergedInto',
      'cashBalance', 'cashMovements', 'dailyClosures',
      'printLog',
    ],
    serializer: {
      serialize(state) {
        // Strip the full `payload` from each printLog entry before persisting to avoid
        // localStorage quota issues with large orders. The full payload is kept in-memory
        // only and is not available after a page reload (status/metadata are retained).
        // The reprint button in PrintHistoryModal is disabled for entries without payload,
        // and reprintJob() also guards against missing payload.
        const printLog = (Array.isArray(state.printLog) ? state.printLog : [])
          .slice(0, 200)
          .map(({ payload: _payload, ...rest }) => rest);
        return JSON.stringify({ ...state, billRequestedTables: Array.from(state.billRequestedTables), printLog });
      },
      deserialize(raw) {
        try {
          const data = JSON.parse(raw);
          return { ...data, billRequestedTables: new Set(Array.isArray(data.billRequestedTables) ? data.billRequestedTables : []) };
        } catch {
          try {
            if (typeof window !== 'undefined' && window.localStorage) window.localStorage.removeItem(storageKey);
          } catch (_) { /* ignore */ }
          return { billRequestedTables: new Set() };
        }
      },
    },
    afterHydrate(ctx) {
      if (!ctx.store.orders.length) {
        ctx.store.orders = (appConfig.demoOrders ?? []).map(o => ({ ...o }));
      }
      for (const ord of ctx.store.orders) {
        if (ord.globalNote === undefined) ord.globalNote = '';
        if (!ord.noteVisibility) ord.noteVisibility = { cassa: true, sala: true, cucina: true };
      }
    },
  },
});
