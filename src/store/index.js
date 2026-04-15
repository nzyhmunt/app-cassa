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
import { ref, computed, watch } from 'vue';
import { appConfig, updateOrderTotals, KITCHEN_ACTIVE_STATUSES, KEYBOARD_POSITIONS, formatOrderTime } from '../utils/index.js';
import { newUUIDv7, newShortId } from './storeUtils.js';
import { makeTableOps } from './tableOps.js';
import { makeReportOps } from './reportOps.js';
import { loadStateFromIDB, saveStateToIDB, upsertBillSessionInIDB, closeBillSessionInIDB, loadSettingsFromIDB, saveFiscalReceiptToIDB, saveInvoiceRequestToIDB, loadFiscalReceiptsFromIDB, loadInvoiceRequestsFromIDB, pruneFiscalReceiptsInIDB, pruneInvoiceRequestsInIDB } from './idbPersistence.js';
import { enqueue } from '../composables/useSyncQueue.js';

export const useAppStore = defineStore('app', () => {

  // ── Core state ─────────────────────────────────────────────────────────────
  const config = ref(appConfig);
  const orders = ref([]);
  const transactions = ref([]);

  // ── Settings (defaults; populated async by initStoreFromIDB before mount) ──
  const sounds = ref(true);
  const menuUrl = ref(appConfig.menuUrl);
  const preventScreenLock = ref(true);
  const customKeyboard = ref('disabled');
  // ID of the printer chosen for pre-conto dispatch (empty string = disabled)
  const preBillPrinterId = ref('');
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

  // ── Fiscal receipts (scontrini fiscali) ────────────────────────────────────
  // In-memory list of fiscal printer commands issued at bill close.
  // Each entry shape:
  //   { id, tableId, billSessionId, tableLabel, totalAmount, totalPaid,
  //     paymentMethods, xmlRequest, xmlResponse, status, timestamp }
  const fiscalReceipts = ref([]);
  /** True once _hydrateFiscalAndInvoice() has resolved. Used by components to guard
   *  against showing stale (empty) fiscal/invoice state during the async IDB load. */
  const fiscalInvoiceHydrated = ref(false);

  /** Prepends a fiscal receipt entry (capped to 200) and persists it to IDB. */
  function addFiscalReceipt(entry) {
    fiscalReceipts.value = [entry, ...fiscalReceipts.value].slice(0, 200);
    Promise.resolve(saveFiscalReceiptToIDB(entry))
      .then(() => pruneFiscalReceiptsInIDB())
      .catch((error) => {
        console.error('Failed to persist/prune fiscal receipts in IDB:', error);
      });
  }

  /** Updates a fiscal receipt entry in-place by id and persists changes. */
  function updateFiscalReceipt(id, updates) {
    const idx = fiscalReceipts.value.findIndex(e => e.id === id);
    if (idx !== -1) {
      fiscalReceipts.value[idx] = { ...fiscalReceipts.value[idx], ...updates };
      saveFiscalReceiptToIDB(fiscalReceipts.value[idx]);
    }
  }

  // ── Invoice requests (richieste fattura) ───────────────────────────────────
  // In-memory list of electronic invoice requests collected at bill close.
  // Each entry shape:
  //   { id, tableId, billSessionId, tableLabel, totalAmount, totalPaid,
  //     billingData: { denominazione, codiceFiscale, piva, indirizzo, cap,
  //                    comune, provincia, paese, codiceDestinatario, pec },
  //     status, timestamp }
  const invoiceRequests = ref([]);

  /** Prepends an invoice request entry (capped to 200) and persists it to IDB. */
  function addInvoiceRequest(entry) {
    invoiceRequests.value = [entry, ...invoiceRequests.value].slice(0, 200);
    saveInvoiceRequestToIDB(entry);
  }

  /**
   * Hydrates fiscal receipts and invoice requests from their dedicated IDB stores.
   * Called once at store creation so the in-memory lists reflect persisted data
   * after a page reload (these collections are not part of loadStateFromIDB).
   * After loading, prunes IDB to the same cap to prevent unbounded storage growth.
   */
  async function _hydrateFiscalAndInvoice() {
    const [receipts, invoices] = await Promise.all([
      loadFiscalReceiptsFromIDB(),
      loadInvoiceRequestsFromIDB(),
    ]);
    // Both load functions return newest-first; slice(0, 200) keeps the newest.
    fiscalReceipts.value = receipts.slice(0, 200);
    invoiceRequests.value = invoices.slice(0, 200);
    // Prune IDB entries beyond the retention cap (fire-and-forget; non-critical).
    Promise.all([
      pruneFiscalReceiptsInIDB(200),
      pruneInvoiceRequestsInIDB(200),
    ]).catch(e => console.warn('[Store] Failed to prune fiscal/invoice IDB entries:', e));
    fiscalInvoiceHydrated.value = true;
  }

  _hydrateFiscalAndInvoice();
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
    const billSessionId = newUUIDv7();
    const now = new Date().toISOString();
    const session = { billSessionId, adults, children, table: tableId, status: 'open', opened_at: now };
    tableCurrentBillSession.value = {
      ...tableCurrentBillSession.value,
      [tableId]: session,
    };
    enqueue('bill_sessions', 'create', billSessionId, {
      id: billSessionId, table: tableId, adults, children, status: 'open', opened_at: now,
      venue: appConfig.directus?.venueId ?? null,
    });
    // Persist to IDB bill_sessions immediately so offline reloads hydrate the
    // session from the dedicated ObjectStore (not just app_meta) before a pull.
    upsertBillSessionInIDB({ ...session, venue: appConfig.directus?.venueId ?? null })
      .catch(e => console.warn('[Store] Failed to persist bill_session to IDB:', e));
    return billSessionId;
  }

  // ── Order mutations ────────────────────────────────────────────────────────
  function addOrder(order) {
    if (order.globalNote === undefined) order.globalNote = '';
    if (!order.noteVisibility) order.noteVisibility = { cassa: true, sala: true, cucina: true };
    orders.value.push(order);
    enqueue('orders', 'create', order.id, order);
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
      const closingSession = nextSession[order.table];
      const closedAt = new Date().toISOString();
      delete nextSession[order.table];
      tableCurrentBillSession.value = nextSession;
      setBillRequested(order.table, false);
      // Enqueue bill_session closure so Directus reflects the closed state, and
      // mark the IDB record closed immediately to prevent a stale open record from
      // being resurrected by loadStateFromIDB() on the next reload.
      if (closingSession?.billSessionId) {
        closeBillSessionInIDB(closingSession.billSessionId)
          .catch(e => console.warn('[Store] Failed to close bill_session in IDB:', e));
        enqueue('bill_sessions', 'update', closingSession.billSessionId, {
          status: 'closed', closed_at: closedAt,
        });
      }
    }
    enqueue('orders', 'update', order.id, { status: newStatus, rejectionReason: order.rejectionReason ?? null });
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
    enqueue('transactions', 'create', txn.id, txn);
  }

  function addTipTransaction(tableId, billSessionId, tipValue) {
    if (!tableId || tipValue <= 0) return;
    const txn = {
      id: newUUIDv7(),
      tableId,
      billSessionId: billSessionId ?? null,
      paymentMethod: 'Mancia',
      operationType: 'tip',
      amountPaid: 0,
      tipAmount: tipValue,
      timestamp: new Date().toISOString(),
      orderRefs: [],
      venue: appConfig.directus?.venueId ?? null,
    };
    transactions.value.push(txn);
    enqueue('transactions', 'create', txn.id, txn);
  }

  // ── Direct orders (bypass kitchen workflow) ────────────────────────────────
  /**
   * Creates an order that immediately transitions to 'accepted', bypassing the kitchen queue.
   * Used for counter items, service charges, or items from splitItemsToTable.
   */
  function addDirectOrder(tableId, billSessionId, items) {
    if (!tableId || !Array.isArray(items) || items.length === 0) return null;
    const order = {
      id: newUUIDv7(),
      table: tableId,
      billSessionId: billSessionId ?? null,
      status: 'pending',
      time: formatOrderTime(),
      totalAmount: 0,
      itemCount: 0,
      dietaryPreferences: {},
      orderItems: items.map(item => ({ ...item })),
      isDirectEntry: true,
      venue: appConfig.directus?.venueId ?? null,
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
    const mov = {
      id: newUUIDv7(),
      type,
      amount: parseFloat(amount) || 0,
      reason,
      timestamp: new Date().toISOString(),
      venue: appConfig.directus?.venueId ?? null,
    };
    cashMovements.value.push(mov);
    enqueue('cash_movements', 'create', mov.id, mov);
  }

  function simulateNewOrder() {
    const num = Math.floor(Math.random() * 12) + 1;
    const newTav = num < 10 ? '0' + num : '' + num;
    const now = formatOrderTime();
    const session = tableCurrentBillSession.value[newTav];
    orders.value.push({
      id: newUUIDv7(),
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
        { uid: newShortId('r'), dishId: 'pri_2', name: 'Amatriciana', unitPrice: 12, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
      ],
      venue: appConfig.directus?.venueId ?? null,
    });
    const cc = config.value.coverCharge;
    if (cc?.enabled && cc?.autoAdd && cc?.priceAdult > 0) {
      const coverOrder = addDirectOrder(newTav, session?.billSessionId ?? null, [
        { uid: newShortId('cop'), dishId: null, name: cc.name, unitPrice: cc.priceAdult, quantity: 2, voidedQuantity: 0, notes: [], modifiers: [] },
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
      { orders, transactions, cashBalance, cashMovements, dailyClosures, config, fiscalReceipts, invoiceRequests },
      { getTableStatus },
    );

  // ── Cross-view navigation state ────────────────────────────────────────────
  const pendingOpenTable = ref(null);
  const pendingSelectOrder = ref(null);
  const pendingNewOrder = ref(null);

  // ── IDB persistence watchers ───────────────────────────────────────────────
  // Debounced: batches rapid successive mutations into a single IDB write.
  // Uses a 150 ms timeout so UI interactions feel instant while writes are async.
  // Persist only the state slices that actually changed during the debounce window
  // instead of re-writing every persisted collection on each deep mutation.
  let _saveTimer = null;
  // Promise chain that serializes IDB writes so a slower earlier save can never
  // overwrite a newer one (last scheduled write always commits last).
  let _saveChain = Promise.resolve();
  const _pendingSaveKeys = new Set();
  const _persistableStateGetters = {
    orders: () => orders.value,
    transactions: () => transactions.value,
    cashBalance: () => cashBalance.value,
    cashMovements: () => cashMovements.value,
    dailyClosures: () => dailyClosures.value,
    printLog: () => printLog.value,
    tableCurrentBillSession: () => tableCurrentBillSession.value,
    tableMergedInto: () => tableMergedInto.value,
    tableOccupiedAt: () => tableOccupiedAt.value,
    billRequestedTables: () => billRequestedTables.value,
  };

  function _scheduleSave(...keys) {
    keys.forEach((key) => _pendingSaveKeys.add(key));
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      if (!_pendingSaveKeys.size) return;
      const payload = {};
      _pendingSaveKeys.forEach((key) => {
        const getter = _persistableStateGetters[key];
        if (getter) payload[key] = getter();
      });
      _pendingSaveKeys.clear();
      _saveChain = _saveChain
        .then(() => saveStateToIDB(payload))
        .catch((e) => console.warn('[Store] IDB save failed for keys', Object.keys(payload), e));
    }, 150);
  }

  watch(orders, () => _scheduleSave('orders'), { deep: true });
  watch(transactions, () => _scheduleSave('transactions'), { deep: true });
  watch(cashBalance, () => _scheduleSave('cashBalance'));
  watch(cashMovements, () => _scheduleSave('cashMovements'), { deep: true });
  watch(dailyClosures, () => _scheduleSave('dailyClosures'), { deep: true });
  watch(printLog, () => _scheduleSave('printLog'), { deep: true });
  watch(tableCurrentBillSession, () => _scheduleSave('tableCurrentBillSession'), { deep: true });
  watch(tableMergedInto, () => _scheduleSave('tableMergedInto'), { deep: true });
  watch(tableOccupiedAt, () => _scheduleSave('tableOccupiedAt'), { deep: true });
  watch(billRequestedTables, () => _scheduleSave('billRequestedTables'), { deep: true });

  return {
    // state
    config, orders, transactions,
    cashBalance, cashMovements, dailyClosures,
    tableOccupiedAt, billRequestedTables, tableCurrentBillSession, tableMergedInto,
    pendingOpenTable, pendingSelectOrder, pendingNewOrder,
    sounds, menuUrl, preventScreenLock, customKeyboard, preBillPrinterId, menuLoading, menuError,
    // print log
    printLog, addPrintLogEntry, updatePrintLogEntry, clearPrintLog,
    // fiscal receipts
    fiscalReceipts, addFiscalReceipt, updateFiscalReceipt,
    fiscalInvoiceHydrated,
    // invoice requests
    invoiceRequests, addInvoiceRequest,
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
});

// ── App initialisation helper ─────────────────────────────────────────────────

/**
 * Loads persisted state and settings from IndexedDB and applies them to the
 * store. Call this once per app page **before** `app.mount()` to ensure the UI
 * never renders with stale defaults.
 *
 * Also backfills demo orders when no persisted orders are found (development
 * mode), mirroring the behaviour of the old `afterHydrate` hook.
 *
 * @param {import('pinia').Pinia} pinia - The active Pinia instance
 */
export async function initStoreFromIDB(pinia) {
  const store = useAppStore(pinia);

  // ── Load operational state ──────────────────────────────────────────────────
  const [idbState, settings] = await Promise.all([
    loadStateFromIDB(),
    loadSettingsFromIDB(),
  ]);

  if (idbState) {
    if (idbState.orders.length === 0) {
      store.orders = (appConfig.demoOrders ?? []).map(o => ({ ...o }));
    } else {
      store.orders = idbState.orders;
      for (const ord of store.orders) {
        if (ord.globalNote === undefined) ord.globalNote = '';
        if (!ord.noteVisibility) ord.noteVisibility = { cassa: true, sala: true, cucina: true };
      }
    }
    store.transactions = idbState.transactions;
    store.cashBalance = idbState.cashBalance;
    store.cashMovements = idbState.cashMovements;
    store.dailyClosures = idbState.dailyClosures;
    store.printLog = idbState.printLog;
    store.tableCurrentBillSession = idbState.tableCurrentBillSession;
    store.tableMergedInto = idbState.tableMergedInto;
    store.tableOccupiedAt = idbState.tableOccupiedAt;
    store.billRequestedTables = idbState.billRequestedTables;
  } else {
    if (store.orders.length === 0) {
      store.orders = (appConfig.demoOrders ?? []).map(o => ({ ...o }));
    }
  }

  // ── Apply settings ──────────────────────────────────────────────────────────
  if (settings) {
    if (typeof settings.sounds === 'boolean') store.sounds = settings.sounds;
    if (typeof settings.menuUrl === 'string' && settings.menuUrl.trim() !== '') {
      store.menuUrl = settings.menuUrl;
    }
    if (typeof settings.preventScreenLock === 'boolean') {
      store.preventScreenLock = settings.preventScreenLock;
    }
    if (KEYBOARD_POSITIONS.includes(settings.customKeyboard)) store.customKeyboard = settings.customKeyboard;
    if (typeof settings.preBillPrinterId === 'string') {
      store.preBillPrinterId = settings.preBillPrinterId;
    }
  }
}

