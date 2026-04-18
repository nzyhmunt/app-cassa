import { defineStore } from 'pinia';
import { ref, computed, watch, toRaw } from 'vue';
import {
  appConfig,
  createRuntimeConfig,
  DEFAULT_SETTINGS,
  applyDirectusConfigToAppConfig,
  updateOrderTotals,
  KITCHEN_ACTIVE_STATUSES,
  KEYBOARD_POSITIONS,
  formatOrderTime,
} from '../utils/index.js';
import { mapOrderFromDirectus, mapVenueConfigFromDirectus } from '../utils/mappers.js';
import { newUUIDv7, newShortId } from './storeUtils.js';
import { makeTableOps } from './tableOps.js';
import { makeReportOps } from './reportOps.js';
import {
  loadStateFromIDB,
  saveStateToIDB,
  upsertRecordsIntoIDB,
  upsertBillSessionInIDB,
  closeBillSessionInIDB,
  loadSettingsFromIDB,
  saveSettingsToIDB,
  loadConfigFromIDB,
  saveJsonMenuToIDB,
  loadJsonMenuFromIDB,
} from './persistence/operations.js';
import {
  saveFiscalReceiptToIDB,
  saveInvoiceRequestToIDB,
  loadFiscalReceiptsFromIDB,
  loadInvoiceRequestsFromIDB,
  pruneFiscalReceiptsInIDB,
  pruneInvoiceRequestsInIDB,
} from './persistence/audit.js';
import { enqueue } from '../composables/useSyncQueue.js';
import { saveDirectusConfigToStorage } from '../composables/useDirectusClient.js';

function _clone(value) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch (_) {
      // Fallback for Vue proxies / non-cloneable values in test/runtime mocks.
    }
  }
  return JSON.parse(JSON.stringify(value));
}

function _normalizeJsonMenuPayload(data) {
  if (typeof data !== 'object' || data === null || Array.isArray(data) || !Object.values(data).every(Array.isArray)) {
    throw new Error('Formato menu non valido');
  }
  const menu = {};
  Object.keys(data).forEach((category) => {
    const valid = data[category].filter(item =>
      item !== null && typeof item === 'object' &&
      typeof item.id === 'string' && item.id.trim() !== '' &&
      typeof item.name === 'string' && item.name.trim() !== '' &&
      typeof item.price === 'number' && Number.isFinite(item.price),
    );
    if (valid.length > 0) menu[category] = valid;
  });
  if (Object.keys(menu).length === 0) throw new Error('Nessun articolo valido nel menu');
  return menu;
}

function _normalizeMenuSource(value, fallback = null) {
  if (value === 'json' || value === 'directus') return value;
  return fallback;
}

/**
 * Normalizes device-local settings payloads and fills missing/invalid values
 * with explicit fallbacks from current store state / defaults.
 *
 * @param {object} payload
 * @param {object} current
 * @returns {{sounds:boolean,menuUrl:string,menuSource:'json'|'directus',preventScreenLock:boolean,customKeyboard:string,preBillPrinterId:string}}
 */
function _normalizeLocalSettingsPayload(payload, current) {
  return {
    sounds: typeof payload?.sounds === 'boolean' ? payload.sounds : !!current?.sounds,
    menuUrl:
      typeof payload?.menuUrl === 'string' && payload.menuUrl.trim() !== ''
        ? payload.menuUrl
        : (current?.menuUrl ?? DEFAULT_SETTINGS.menuUrl),
    menuSource: _normalizeMenuSource(payload?.menuSource, _normalizeMenuSource(current?.menuSource, 'directus')),
    preventScreenLock:
      typeof payload?.preventScreenLock === 'boolean'
        ? payload.preventScreenLock
        : !!current?.preventScreenLock,
    customKeyboard: KEYBOARD_POSITIONS.includes(payload?.customKeyboard)
      ? payload.customKeyboard
      : (KEYBOARD_POSITIONS.includes(current?.customKeyboard) ? current.customKeyboard : 'disabled'),
    preBillPrinterId:
      typeof payload?.preBillPrinterId === 'string'
        ? payload.preBillPrinterId
        : (typeof current?.preBillPrinterId === 'string' ? current.preBillPrinterId : ''),
  };
}

export const useConfigStore = defineStore('config', () => {
  const config = ref(createRuntimeConfig(appConfig));

  const sounds = ref(true);
  const menuUrl = ref(config.value.menuUrl || DEFAULT_SETTINGS.menuUrl);
  const menuSource = ref(config.value.menuSource === 'json' ? 'json' : 'directus');
  const preventScreenLock = ref(true);
  const customKeyboard = ref('disabled');
  const preBillPrinterId = ref('');
  const configHydrated = ref(false);

  const menuLoading = ref(false);
  const menuError = ref(null);

  const cssVars = computed(() => ({
    '--brand-primary': config.value.ui.primaryColor,
    '--brand-dark': config.value.ui.primaryColorDark,
  }));

  const rooms = computed(() => {
    const r = config.value.rooms;
    if (Array.isArray(r) && r.length > 0) return r;
    return [{ id: 'main', label: '', tables: config.value.tables ?? [] }];
  });

  async function hydrateConfigFromIDB(options = {}) {
    const nextMenuSource = _normalizeMenuSource(options.menuSource);
    const nextMenuUrl = typeof options.menuUrl === 'string' && options.menuUrl.trim() !== ''
      ? options.menuUrl
      : null;
    const venueId = config.value.directus?.venueId ?? appConfig.directus?.venueId ?? null;
    const cached = await loadConfigFromIDB(venueId);
    const mapped = mapVenueConfigFromDirectus(cached, DEFAULT_SETTINGS);
    const hydrated = createRuntimeConfig(mapped);

    const resolvedMenuSource = nextMenuSource ?? _normalizeMenuSource(hydrated.menuSource, 'directus');
    const resolvedMenuUrl = nextMenuUrl ?? hydrated.menuUrl ?? DEFAULT_SETTINGS.menuUrl;
    menuSource.value = resolvedMenuSource;
    menuUrl.value = resolvedMenuUrl;
    config.value = {
      ...hydrated,
      menuSource: resolvedMenuSource,
      menuUrl: resolvedMenuUrl,
    };
    configHydrated.value = true;

    if (menuSource.value === 'json') {
      const jsonMenu = await loadJsonMenuFromIDB();
      if (jsonMenu && typeof jsonMenu === 'object' && !Array.isArray(jsonMenu)) {
        config.value = { ...config.value, menu: _clone(jsonMenu) };
      }
    }
  }

  async function loadMenu(options = {}) {
    const shouldHydrateDirectus = options.skipHydrate === true ? false : true;
    const applyJsonSnapshot = async () => {
      const jsonMenu = await loadJsonMenuFromIDB();
      if (!jsonMenu || typeof jsonMenu !== 'object' || Array.isArray(jsonMenu)) return false;
      config.value = { ...config.value, menu: _clone(jsonMenu) };
      return true;
    };

    menuLoading.value = true;
    menuError.value = null;
    try {
      if (menuSource.value === 'directus') {
        if (shouldHydrateDirectus) await hydrateConfigFromIDB();
        return;
      }

      const response = await fetch(menuUrl.value);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const normalizedMenu = _normalizeJsonMenuPayload(data);

      await saveJsonMenuToIDB(normalizedMenu);
      config.value = { ...config.value, menu: normalizedMenu };
    } catch (e) {
      menuError.value = e instanceof Error ? e.message : String(e);
      if (menuSource.value === 'json') {
        await applyJsonSnapshot();
      }
    } finally {
      menuLoading.value = false;
    }
  }

  /**
   * Applies local settings to reactive store state and runtime appConfig
   * (menuSource/menuUrl) without persisting to IndexedDB.
   *
   * @param {object} payload
   * @returns {{sounds:boolean,menuUrl:string,menuSource:'json'|'directus',preventScreenLock:boolean,customKeyboard:string,preBillPrinterId:string}}
   */
  function applyLocalSettings(payload = {}) {
    const normalized = _normalizeLocalSettingsPayload(payload, {
      sounds: sounds.value,
      menuUrl: menuUrl.value,
      menuSource: menuSource.value,
      preventScreenLock: preventScreenLock.value,
      customKeyboard: customKeyboard.value,
      preBillPrinterId: preBillPrinterId.value,
    });
    sounds.value = normalized.sounds;
    menuUrl.value = normalized.menuUrl;
    menuSource.value = normalized.menuSource;
    preventScreenLock.value = normalized.preventScreenLock;
    customKeyboard.value = normalized.customKeyboard;
    preBillPrinterId.value = normalized.preBillPrinterId;
    appConfig.menuSource = normalized.menuSource;
    appConfig.menuUrl = normalized.menuUrl;
    config.value = {
      ...config.value,
      menuSource: normalized.menuSource,
      menuUrl: normalized.menuUrl,
    };
    return normalized;
  }

  /**
   * Applies and persists local settings to `local_settings` in IndexedDB.
   *
   * @param {object} payload
   * @returns {Promise<{sounds:boolean,menuUrl:string,menuSource:'json'|'directus',preventScreenLock:boolean,customKeyboard:string,preBillPrinterId:string}>}
   */
  async function saveLocalSettings(payload = {}) {
    const normalized = applyLocalSettings(payload);
    await saveSettingsToIDB(normalized);
    return normalized;
  }

  /**
   * Applies and persists Directus settings through the centralized appConfig
   * mutation path and Directus config storage adapter.
   *
   * @param {object} payload
   * @returns {Promise<{enabled:boolean,url:string,staticToken:string,venueId:number|string|null,wsEnabled:boolean}>}
   */
  async function saveDirectusSettings(payload = {}) {
    const normalized = applyDirectusConfigToAppConfig(payload);
    await saveDirectusConfigToStorage();
    config.value = {
      ...config.value,
      directus: {
        ...(config.value.directus ?? {}),
        ...normalized,
      },
    };
    return normalized;
  }

  return {
    config,
    cssVars,
    rooms,
    sounds,
    menuUrl,
    menuSource,
    preventScreenLock,
    customKeyboard,
    preBillPrinterId,
    configHydrated,
    menuLoading,
    menuError,
    loadMenu,
    hydrateConfigFromIDB,
    applyLocalSettings,
    saveLocalSettings,
    saveDirectusSettings,
  };
});

export const useOrderStore = defineStore('orders', () => {
  const configStore = useConfigStore();
  const configRef = computed(() => configStore.config);

  const orders = ref([]);
  const transactions = ref([]);

  const cashBalance = ref(0);
  const cashMovements = ref([]);
  const dailyClosures = ref([]);

  const printLog = ref([]);

  function addPrintLogEntry(entry) {
    printLog.value = [{ status: 'pending', ...entry }, ...printLog.value].slice(0, 200);
  }

  function updatePrintLogEntry(logId, updates) {
    const idx = printLog.value.findIndex(e => e.logId === logId);
    if (idx !== -1) printLog.value[idx] = { ...printLog.value[idx], ...updates };
  }

  function clearPrintLog() {
    printLog.value = [];
  }

  const fiscalReceipts = ref([]);
  const invoiceRequests = ref([]);
  const fiscalInvoiceHydrated = ref(false);

  function addFiscalReceipt(entry) {
    fiscalReceipts.value = [entry, ...fiscalReceipts.value].slice(0, 200);
    Promise.resolve(saveFiscalReceiptToIDB(entry))
      .then(() => pruneFiscalReceiptsInIDB())
      .catch((error) => console.error('Failed to persist/prune fiscal receipts in IDB:', error));
  }

  function updateFiscalReceipt(id, updates) {
    const idx = fiscalReceipts.value.findIndex(e => e.id === id);
    if (idx !== -1) {
      fiscalReceipts.value[idx] = { ...fiscalReceipts.value[idx], ...updates };
      saveFiscalReceiptToIDB(fiscalReceipts.value[idx]);
    }
  }

  function addInvoiceRequest(entry) {
    invoiceRequests.value = [entry, ...invoiceRequests.value].slice(0, 200);
    saveInvoiceRequestToIDB(entry);
  }

  async function _hydrateFiscalAndInvoice() {
    const [receipts, invoices] = await Promise.all([
      loadFiscalReceiptsFromIDB(),
      loadInvoiceRequestsFromIDB(),
    ]);
    fiscalReceipts.value = receipts.slice(0, 200);
    invoiceRequests.value = invoices.slice(0, 200);
    Promise.all([
      pruneFiscalReceiptsInIDB(200),
      pruneInvoiceRequestsInIDB(200),
    ]).catch(e => console.warn('[Store] Failed to prune fiscal/invoice IDB entries:', e));
    fiscalInvoiceHydrated.value = true;
  }

  _hydrateFiscalAndInvoice();

  const tableOccupiedAt = ref({});
  const billRequestedTables = ref(new Set());
  const tableCurrentBillSession = ref({});
  const tableMergedInto = ref({});

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

  function isMergedSlave(tableId) { return !!tableMergedInto.value[tableId]; }
  function masterTableOf(tableId) { return tableMergedInto.value[tableId] ?? null; }

  const pendingCount = computed(() => orders.value.filter(o => o.status === 'pending').length);
  const inKitchenCount = computed(() =>
    orders.value.filter(o => KITCHEN_ACTIVE_STATUSES.includes(o.status)).length,
  );

  function getTableStatus(tableId) {
    const master = resolveMaster(tableId);
    if (tableMergedInto.value[tableId]) {
      if (master !== tableId) return { ...getTableStatus(master), isMergedSlave: true, masterTableId: master };
      return { status: 'free', total: 0, remaining: 0 };
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
    const methods = configStore.config?.paymentMethods ?? [];
    const m = methods.find(x => x.label === methodId || x.id === methodId);
    return m ? m.icon : 'banknote';
  }

  function setBillRequested(tableId, val) {
    if (val) billRequestedTables.value.add(tableId);
    else billRequestedTables.value.delete(tableId);
    billRequestedTables.value = new Set(billRequestedTables.value);
  }

  function openTableSession(tableId, adults = 0, children = 0) {
    const billSessionId = newUUIDv7();
    const now = new Date().toISOString();
    const session = { billSessionId, adults, children, table: tableId, status: 'open', opened_at: now };
    const venueId = configStore.config.directus?.venueId ?? null;
    upsertBillSessionInIDB({ ...session, ...(venueId != null ? { venue: venueId } : {}) })
      .catch((err) => console.warn('[Store] Failed to persist bill session:', err));
    tableCurrentBillSession.value = {
      ...tableCurrentBillSession.value,
      [tableId]: session,
    };
    enqueue('bill_sessions', 'create', billSessionId, {
      id: billSessionId,
      table: tableId,
      adults,
      children,
      status: 'open',
      opened_at: now,
      ...(venueId != null ? { venue: venueId } : {}),
    });
    return billSessionId;
  }

  async function refreshOperationalStateFromIDB(options = {}) {
    const operationalStateRefs = {
      orders,
      transactions,
      cashBalance,
      cashMovements,
      dailyClosures,
      printLog,
      tableCurrentBillSession,
      tableMergedInto,
      tableOccupiedAt,
      billRequestedTables,
    };
    const { collection, collections } = options;
    const requestedCollections = collections ?? (collection ? [collection] : Object.keys(operationalStateRefs));
    const targetCollections = requestedCollections.filter((key) => Object.prototype.hasOwnProperty.call(operationalStateRefs, key));
    if (!targetCollections.length) return;

    const idbState = await loadStateFromIDB();
    if (!idbState) return;

    targetCollections.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(idbState, key)) {
        operationalStateRefs[key].value = idbState[key];
      }
    });
  }

  function _enqueueOrderSnapshot(ord) {
    if (!ord?.id) return;
    const rawOrder = toRaw(ord);
    let payload = rawOrder;
    try {
      payload = structuredClone(rawOrder);
    } catch (_) {
      payload = JSON.parse(JSON.stringify(rawOrder));
    }
    enqueue('orders', 'update', ord.id, payload);
  }

  function addOrder(order) {
    if (order.globalNote === undefined) order.globalNote = '';
    if (!order.noteVisibility) order.noteVisibility = { cassa: true, sala: true, cucina: true };
    const nextOrders = [...orders.value, order];
    saveStateToIDB({ orders: nextOrders })
      .catch((err) => console.warn('[Store] Failed to persist order creation:', err));
    orders.value = nextOrders;
    enqueue('orders', 'create', order.id, order);
  }

  function changeOrderStatus(order, newStatus, rejectionReason = null) {
    if (!order?.id) return;
    const projectedOrders = orders.value.map((current) => {
      if (current.id !== order.id) return current;
      const next = { ...current, status: newStatus };
      if (newStatus === 'rejected' && rejectionReason) next.rejectionReason = rejectionReason;
      return next;
    });
    const projectedTableOccupiedAt = { ...tableOccupiedAt.value };
    const projectedTableMergedInto = { ...tableMergedInto.value };
    const projectedBillRequestedTables = new Set(billRequestedTables.value);
    let projectedTableCurrentBillSession = tableCurrentBillSession.value;
    let closingSession = null;
    const closedAt = new Date().toISOString();

    if (KITCHEN_ACTIVE_STATUSES.includes(newStatus) && !projectedTableOccupiedAt[order.table]) {
      projectedTableOccupiedAt[order.table] = closedAt;
    }
    const projectedActiveOrds = projectedOrders.filter(
      o => o.table === order.table && o.status !== 'completed' && o.status !== 'rejected',
    );
    if (projectedActiveOrds.length === 0) {
      delete projectedTableOccupiedAt[order.table];
      const idsToUnmap = [...slaveIdsOf(order.table), ...(projectedTableMergedInto[order.table] ? [order.table] : [])];
      if (idsToUnmap.length > 0) {
        idsToUnmap.forEach(id => delete projectedTableMergedInto[id]);
      }
      const nextSession = { ...tableCurrentBillSession.value };
      closingSession = nextSession[order.table];
      delete nextSession[order.table];
      projectedTableCurrentBillSession = nextSession;
      projectedBillRequestedTables.delete(order.table);
    }
    saveStateToIDB({
      orders: projectedOrders,
      tableOccupiedAt: projectedTableOccupiedAt,
      tableMergedInto: projectedTableMergedInto,
      tableCurrentBillSession: projectedTableCurrentBillSession,
      billRequestedTables: projectedBillRequestedTables,
    }).catch((err) => console.warn('[Store] Failed to persist status update:', err));
    if (closingSession?.billSessionId) {
      closeBillSessionInIDB(closingSession.billSessionId)
        .catch((err) => console.warn('[Store] Failed to close bill session in IDB:', err));
    }

    order.status = newStatus;
    if (newStatus === 'rejected' && rejectionReason) order.rejectionReason = rejectionReason;
    if (KITCHEN_ACTIVE_STATUSES.includes(newStatus) && !tableOccupiedAt.value[order.table]) {
      tableOccupiedAt.value[order.table] = closedAt;
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
      const closedSession = nextSession[order.table];
      delete nextSession[order.table];
      tableCurrentBillSession.value = nextSession;
      setBillRequested(order.table, false);
      if (closedSession?.billSessionId) {
        enqueue('bill_sessions', 'update', closedSession.billSessionId, {
          status: 'closed', closed_at: closedAt,
        });
      }
    }
    enqueue('orders', 'update', order.id, { status: newStatus, rejectionReason: order.rejectionReason ?? null });
  }

  function updateQtyGlobal(ord, idx, delta) {
    if (!ord || ord.status !== 'pending') return;
    const item = ord.orderItems[idx];
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) ord.orderItems.splice(idx, 1);
    updateOrderTotals(ord);
    _enqueueOrderSnapshot(ord);
  }

  function removeRowGlobal(ord, idx) {
    if (!ord || ord.status !== 'pending') return;
    ord.orderItems.splice(idx, 1);
    updateOrderTotals(ord);
    _enqueueOrderSnapshot(ord);
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
      _enqueueOrderSnapshot(ord);
    }
  }

  function restoreOrderItems(ord, idx, qtyToRestore) {
    if (!ord || !KITCHEN_ACTIVE_STATUSES.includes(ord.status)) return;
    if (!Number.isInteger(qtyToRestore) || qtyToRestore <= 0) return;
    const item = ord.orderItems[idx];
    if (item.voidedQuantity && item.voidedQuantity >= qtyToRestore) {
      item.voidedQuantity -= qtyToRestore;
      updateOrderTotals(ord);
      _enqueueOrderSnapshot(ord);
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
      _enqueueOrderSnapshot(ord);
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
      _enqueueOrderSnapshot(ord);
    }
  }

  function setItemKitchenReady(order, itemIdx, ready) {
    if (!order || !order.orderItems || itemIdx < 0 || itemIdx >= order.orderItems.length) return;
    order.orderItems[itemIdx].kitchenReady = ready;
    _enqueueOrderSnapshot(order);
  }

  function addTransaction(txn) {
    const nextTransactions = [...transactions.value, txn];
    const nextBillRequestedTables = new Set(billRequestedTables.value);
    if (txn.tableId) nextBillRequestedTables.delete(txn.tableId);
    saveStateToIDB({
      transactions: nextTransactions,
      billRequestedTables: nextBillRequestedTables,
    }).catch((err) => console.warn('[Store] Failed to persist transactions:', err));
    transactions.value = nextTransactions;
    if (txn.tableId) setBillRequested(txn.tableId, false);
    enqueue('transactions', 'create', txn.id, txn);

    if (txn?.operationType === 'analitica') {
      const transactionOrderRefs = (Array.isArray(txn.orderRefs) ? txn.orderRefs : [])
        .map((entry) => {
          if (typeof entry === 'string' && entry.trim() !== '') {
            return { id: newUUIDv7(), transaction: txn.id, order: entry.trim() };
          }
          if (entry && typeof entry === 'object') {
            const orderId = typeof entry.order === 'string' ? entry.order : entry.orderId;
            if (typeof orderId === 'string' && orderId.trim() !== '') {
              return {
                id: typeof entry.id === 'string' && entry.id.trim() !== '' ? entry.id : newUUIDv7(),
                transaction: txn.id,
                order: orderId.trim(),
              };
            }
          }
          return null;
        })
        .filter(Boolean);

      const transactionVociRefs = (Array.isArray(txn.vociRefs) ? txn.vociRefs : [])
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const voceKey = typeof entry.key === 'string' ? entry.key.trim() : '';
          const qty = Number(entry.qty);
          if (!voceKey || !Number.isInteger(qty) || qty <= 0) return null;
          return {
            id: typeof entry.id === 'string' && entry.id.trim() !== '' ? entry.id : newUUIDv7(),
            transaction: txn.id,
            voce_key: voceKey,
            qty,
          };
        })
        .filter(Boolean);

      const persistAndEnqueueRefs = async () => {
        if (transactionOrderRefs.length > 0) {
          await upsertRecordsIntoIDB('transaction_order_refs', transactionOrderRefs);
          for (const ref of transactionOrderRefs) {
            enqueue('transaction_order_refs', 'create', ref.id, ref);
          }
        }
        if (transactionVociRefs.length > 0) {
          await upsertRecordsIntoIDB('transaction_voce_refs', transactionVociRefs);
          for (const ref of transactionVociRefs) {
            enqueue('transaction_voce_refs', 'create', ref.id, ref);
          }
        }
      };

      persistAndEnqueueRefs().catch((err) => {
        console.warn('[Store] Failed to persist/enqueue transaction refs:', err);
      });
    }
  }

  function addTipTransaction(tableId, billSessionId, tipValue) {
    if (!tableId || tipValue <= 0) return;
    const venueId = configStore.config.directus?.venueId;
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
      ...(venueId != null ? { venue: venueId } : {}),
    };
    transactions.value.push(txn);
    enqueue('transactions', 'create', txn.id, txn);
  }

  function addDirectOrder(tableId, billSessionId, items) {
    if (!tableId || !Array.isArray(items) || items.length === 0) return null;
    const venueId = configStore.config.directus?.venueId;
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
      ...(venueId != null ? { venue: venueId } : {}),
    };
    updateOrderTotals(order);
    addOrder(order);
    changeOrderStatus(order, 'accepted');
    return order;
  }

  function setCashBalance(amount) {
    cashBalance.value = parseFloat(amount) || 0;
  }
  const setFondoCassa = setCashBalance;

  function addCashMovement(type, amount, reason) {
    const venueId = configStore.config.directus?.venueId;
    const mov = {
      id: newUUIDv7(),
      type,
      amount: parseFloat(amount) || 0,
      reason,
      timestamp: new Date().toISOString(),
      ...(venueId != null ? { venue: venueId } : {}),
    };
    const nextCashMovements = [...cashMovements.value, mov];
    saveStateToIDB({ cashMovements: nextCashMovements })
      .catch((err) => console.warn('[Store] Failed to persist cash movement:', err));
    cashMovements.value = nextCashMovements;
    enqueue('cash_movements', 'create', mov.id, mov);
  }

  function simulateNewOrder() {
    const num = Math.floor(Math.random() * 12) + 1;
    const newTav = num < 10 ? '0' + num : '' + num;
    const now = formatOrderTime();
    const session = tableCurrentBillSession.value[newTav];
    const venueId = configStore.config.directus?.venueId;

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
      ...(venueId != null ? { venue: venueId } : {}),
    });

    const cc = configStore.config.coverCharge;
    if (cc?.enabled && cc?.autoAdd && cc?.priceAdult > 0) {
      const coverOrder = addDirectOrder(newTav, session?.billSessionId ?? null, [
        { uid: newShortId('cop'), dishId: null, name: cc.name, unitPrice: cc.priceAdult, quantity: 2, voidedQuantity: 0, notes: [], modifiers: [] },
      ]);
      if (coverOrder) coverOrder.isCoverCharge = true;
    }
  }

  const { moveTableOrders, mergeTableOrders, detachSlaveTable, splitItemsToTable } =
    makeTableOps(
      { orders, transactions, tableCurrentBillSession, tableOccupiedAt, billRequestedTables, tableMergedInto },
      { addDirectOrder, openTableSession, getTableStatus, setBillRequested, slaveIdsOf, resolveMaster },
    );

  const { generateXReport, performDailyClose, closedBills } =
    makeReportOps(
      {
        orders,
        transactions,
        cashBalance,
        cashMovements,
        dailyClosures,
        config: configRef,
        fiscalReceipts,
        invoiceRequests,
      },
      { getTableStatus },
    );

  const pendingOpenTable = ref(null);
  const pendingSelectOrder = ref(null);
  const pendingNewOrder = ref(null);

  let _saveTimer = null;
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
    orders,
    transactions,
    cashBalance,
    cashMovements,
    dailyClosures,
    tableOccupiedAt,
    billRequestedTables,
    tableCurrentBillSession,
    tableMergedInto,
    pendingOpenTable,
    pendingSelectOrder,
    pendingNewOrder,
    printLog,
    addPrintLogEntry,
    updatePrintLogEntry,
    clearPrintLog,
    fiscalReceipts,
    addFiscalReceipt,
    updateFiscalReceipt,
    fiscalInvoiceHydrated,
    invoiceRequests,
    addInvoiceRequest,
    pendingCount,
    inKitchenCount,
    closedBills,
    getTableStatus,
    getTableColorClass,
    getTableColorClassFromStatus,
    getPaymentMethodIcon,
    isMergedSlave,
    masterTableOf,
    slaveIdsOf,
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
    addTipTransaction,
    addDirectOrder,
    simulateNewOrder,
    setBillRequested,
    openTableSession,
    moveTableOrders,
    mergeTableOrders,
    detachSlaveTable,
    splitItemsToTable,
    setFondoCassa,
    addCashMovement,
    generateXReport,
    performDailyClose,
    refreshOperationalStateFromIDB,
  };
});

function _createMergedStoreProxy(configStore, orderStore) {
  const sources = [orderStore, configStore];
  return new Proxy({}, {
    get(_target, prop) {
      for (const source of sources) {
        if (prop in source) {
          const value = source[prop];
          return typeof value === 'function' ? value.bind(source) : value;
        }
      }
      return undefined;
    },
    set(_target, prop, value) {
      for (const source of sources) {
        if (prop in source) {
          source[prop] = value;
          return true;
        }
      }
      configStore[prop] = value;
      return true;
    },
    has(_target, prop) {
      return sources.some(source => prop in source);
    },
    ownKeys() {
      return [...new Set(sources.flatMap(source => Reflect.ownKeys(source)))];
    },
    getOwnPropertyDescriptor() {
      return { enumerable: true, configurable: true };
    },
  });
}

export function useAppStore(pinia) {
  /**
   * Backward-compatibility facade that merges the new layered stores.
   * Prefer `useConfigStore()` and `useOrderStore()` in new code.
   */
  const configStore = useConfigStore(pinia);
  const orderStore = useOrderStore(pinia);
  return _createMergedStoreProxy(configStore, orderStore);
}

export async function initStoreFromIDB(pinia) {
  const configStore = useConfigStore(pinia);
  const orderStore = useOrderStore(pinia);

  const [idbState, settings] = await Promise.all([
    loadStateFromIDB(),
    loadSettingsFromIDB(),
  ]);

  let startupMenuSource = configStore.menuSource;
  let startupMenuUrl = configStore.menuUrl;

  if (settings) {
    if (typeof settings.sounds === 'boolean') configStore.sounds = settings.sounds;
    if (typeof settings.menuUrl === 'string' && settings.menuUrl.trim() !== '') {
      configStore.menuUrl = settings.menuUrl;
      startupMenuUrl = settings.menuUrl;
    }
    if (settings.menuSource === 'json' || settings.menuSource === 'directus') {
      configStore.menuSource = settings.menuSource;
      startupMenuSource = settings.menuSource;
    }
    if (typeof settings.preventScreenLock === 'boolean') configStore.preventScreenLock = settings.preventScreenLock;
    if (KEYBOARD_POSITIONS.includes(settings.customKeyboard)) configStore.customKeyboard = settings.customKeyboard;
    if (typeof settings.preBillPrinterId === 'string') configStore.preBillPrinterId = settings.preBillPrinterId;
  }

  await configStore.hydrateConfigFromIDB({
    menuSource: startupMenuSource,
    menuUrl: startupMenuUrl,
  });

  if (idbState) {
    if ((idbState.orders ?? []).length === 0) {
      orderStore.orders = (appConfig.demoOrders ?? []).map(o => ({ ...o }));
    } else {
      orderStore.orders = (idbState.orders ?? []).map((order) => {
        const mapped = mapOrderFromDirectus(order);
        if (mapped.globalNote === undefined) mapped.globalNote = '';
        if (!mapped.noteVisibility) mapped.noteVisibility = { cassa: true, sala: true, cucina: true };
        return mapped;
      });
    }
    orderStore.transactions = idbState.transactions ?? [];
    orderStore.cashBalance = idbState.cashBalance ?? 0;
    orderStore.cashMovements = idbState.cashMovements ?? [];
    orderStore.dailyClosures = idbState.dailyClosures ?? [];
    orderStore.printLog = idbState.printLog ?? [];
    orderStore.tableCurrentBillSession = idbState.tableCurrentBillSession ?? {};
    orderStore.tableMergedInto = idbState.tableMergedInto ?? {};
    orderStore.tableOccupiedAt = idbState.tableOccupiedAt ?? {};
    orderStore.billRequestedTables = idbState.billRequestedTables ?? new Set();
  } else if (orderStore.orders.length === 0) {
    orderStore.orders = (appConfig.demoOrders ?? []).map(o => ({ ...o }));
  }

  await configStore.loadMenu({ skipHydrate: true });
}
