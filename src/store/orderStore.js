/**
 * @file store/orderStore.js
 * @description Pinia store for operational state
 * (orders, transactions, cash, bill sessions, table occupancy, print log, fiscal audit).
 */

import { defineStore } from 'pinia';
import { ref, computed, watch, toRaw, onScopeDispose } from 'vue';
import {
  updateOrderTotals,
  KITCHEN_ACTIVE_STATUSES,
  formatOrderTime,
  itemsAreMergeable,
} from '../utils/index.js';
import { mapOrderFromDirectus } from '../utils/mappers.js';
import { newUUIDv7, normalizeEntityId, newShortId, cloneValue as _clone } from './storeUtils.js';
import { makeTableOps } from './tableOps.js';
import { makeReportOps } from './reportOps.js';
import {
  loadStateFromIDB,
  saveStateToIDB,
  saveOrdersAndOccupancyInIDB,
  upsertRecordsIntoIDB,
  upsertBillSessionInIDB,
  closeBillSessionInIDB,
} from './persistence/operations.js';
import {
  saveFiscalReceiptToIDB,
  saveInvoiceRequestToIDB,
  loadFiscalReceiptsFromIDB,
  loadInvoiceRequestsFromIDB,
  pruneFiscalReceiptsInIDB,
  pruneInvoiceRequestsInIDB,
} from './persistence/audit.js';
import { getDB } from '../composables/useIDB.js';
import { enqueue } from '../composables/useSyncQueue.js';
import { onIDBChange } from './persistence/eventBus.js';
import { useConfigStore } from './configStore.js';

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
    enqueue('print_jobs', 'create', entry.id, entry);
  }

  function updatePrintLogEntry(logId, updates) {
    const idx = printLog.value.findIndex(e => e.logId === logId);
    if (idx !== -1) {
      printLog.value[idx] = { ...printLog.value[idx], ...updates };
      enqueue('print_jobs', 'update', printLog.value[idx].id, { logId, ...updates });
    }
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
    enqueue('fiscal_receipts', 'create', entry.id, entry);
  }

  function updateFiscalReceipt(id, updates) {
    const idx = fiscalReceipts.value.findIndex(e => e.id === id);
    if (idx !== -1) {
      fiscalReceipts.value[idx] = { ...fiscalReceipts.value[idx], ...updates };
      saveFiscalReceiptToIDB(fiscalReceipts.value[idx]);
      enqueue('fiscal_receipts', 'update', id, { id, ...updates });
    }
  }

  function addInvoiceRequest(entry) {
    invoiceRequests.value = [entry, ...invoiceRequests.value].slice(0, 200);
    saveInvoiceRequestToIDB(entry);
    enqueue('invoice_requests', 'create', entry.id, entry);
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

  const pendingCount = computed(() => orders.value.filter(o => o.status === 'pending' && !o.isDirectEntry).length);
  const inKitchenCount = computed(() =>
    orders.value.filter(o => KITCHEN_ACTIVE_STATUSES.includes(o.status)).length,
  );

  function getTableStatus(tableId) {
    const master = resolveMaster(tableId);
    if (tableMergedInto.value[tableId]) {
      if (master !== tableId) return { ...getTableStatus(master), isMergedSlave: true, masterTableId: master };
      return { status: 'free', total: 0, remaining: 0 };
    }
    const session = tableCurrentBillSession.value[tableId];
    const belongsToCurrentSession = o =>
      !session || o.billSessionId === session.billSessionId;
    const ords = orders.value.filter(
      o =>
        o.table === tableId &&
        o.status !== 'completed' &&
        o.status !== 'rejected' &&
        belongsToCurrentSession(o),
    );
    if (ords.length === 0) return { status: 'free', total: 0, remaining: 0 };
    const billable = orders.value.filter(
      o => o.table === tableId &&
        (KITCHEN_ACTIVE_STATUSES.includes(o.status) || o.status === 'completed') &&
        belongsToCurrentSession(o),
    );
    const total = billable.reduce((a, b) => a + b.totalAmount, 0);
    const paid = transactions.value
      .filter(t => t.table === tableId && (!session || t.bill_session === session.billSessionId))
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

  // Internal helper: reactive-only update, no IDB write.
  // Used by functions that already include billRequestedTables in their own saveStateToIDB call.
  function _updateBillRequestedState(tableId, val) {
    if (val) billRequestedTables.value.add(tableId);
    else billRequestedTables.value.delete(tableId);
    billRequestedTables.value = new Set(billRequestedTables.value);
  }

  // Public API: initiates an IDB write before updating reactive state.
  // The watcher-driven debounced save is skipped on success and used as a safety-net on failure.
  function setBillRequested(tableId, val) {
    const nextSet = new Set(billRequestedTables.value);
    if (val) nextSet.add(tableId);
    else nextSet.delete(tableId);
    // Initiate IDB write before reactive update; watcher retries only if this save fails.
    saveStateToIDB({ billRequestedTables: nextSet })
      .catch(e => {
        _scheduleSave('billRequestedTables');
        console.warn('[Store] setBillRequested IDB save failed:', e);
      });
    _skipNextScheduledSave('billRequestedTables');
    billRequestedTables.value = nextSet;
  }

  async function openTableSession(tableId, adults = 0, children = 0, options = {}) {
    const { enqueueSync = true } = options;
    const billSessionId = newUUIDv7();
    const now = new Date().toISOString();
    const session = { billSessionId, adults, children, table: tableId, status: 'open', opened_at: now };
    const venueId = configStore.config.directus?.venueId ?? null;
    await upsertBillSessionInIDB({ ...session, ...(venueId != null ? { venue: venueId } : {}) });
    tableCurrentBillSession.value = {
      ...tableCurrentBillSession.value,
      [tableId]: session,
    };
    if (enqueueSync) {
      enqueue('bill_sessions', 'create', billSessionId, {
        id: billSessionId,
        table: tableId,
        adults,
        children,
        status: 'open',
        opened_at: now,
        ...(venueId != null ? { venue: venueId } : {}),
      });
    }
    return billSessionId;
  }

  // Directus collection names that map to a different state key in operationalStateRefs.
  // Needed because _pullCollection('bill_sessions') calls refreshOperationalStateFromIDB
  // with { collection: 'bill_sessions' } but the state ref is 'tableCurrentBillSession'.
  // Defined outside the function body to avoid repeated object allocation on every call.
  const _COLLECTION_TO_STATE_KEY = {
    bill_sessions: 'tableCurrentBillSession',
    table_merge_sessions: 'tableMergedInto',
  };

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
    const { collection, collections, ids } = options;

    // Shared helper: map a raw IDB order to its reactive form with recomputed totals.
    // Recompute totals from orderItems when they are populated locally,
    // or when the order is genuinely empty (item_count = 0) so that a
    // locally cleared order is correctly reflected as €0.
    // When orderItems is empty but item_count > 0 the items exist in
    // Directus but were not expanded in this pull — in that case the
    // authoritative total_amount already mapped from IDB is preserved
    // to avoid a spurious reset to 0.
    function _mapIDBOrder(raw) {
      const mappedOrder = mapOrderFromDirectus(raw);
      if (!Array.isArray(mappedOrder.orderItems)) mappedOrder.orderItems = [];
      if (mappedOrder.orderItems.length > 0 || mappedOrder.item_count === 0) {
        updateOrderTotals(mappedOrder);
        mappedOrder.total_amount = mappedOrder.totalAmount;
        mappedOrder.item_count = mappedOrder.itemCount;
      } else {
        mappedOrder.totalAmount = mappedOrder.total_amount ?? mappedOrder.totalAmount;
        mappedOrder.total_amount = mappedOrder.totalAmount;
        mappedOrder.itemCount = mappedOrder.item_count ?? mappedOrder.itemCount;
        mappedOrder.item_count = mappedOrder.itemCount;
      }
      return mappedOrder;
    }

    // Issue 4 fix: targeted order refresh — when a Set of specific order IDs is
    // provided for the 'orders' collection, fetch and map only those records from
    // IDB and splice them into the reactive array.  This avoids replacing the
    // entire orders.value array (and triggering a full re-render) when only a
    // handful of orders had their orderItems updated via a WS or REST pull.
    if (collection === 'orders' && ids instanceof Set && ids.size > 0) {
      try {
        const db = await getDB();
        const freshOrders = await Promise.all(
          [...ids].map(id => db.get('orders', String(id))),
        );
        const validOrders = freshOrders.filter(Boolean);
        if (validOrders.length > 0) {
          const mappedById = new Map();
          for (const raw of validOrders) {
            mappedById.set(String(raw.id), _mapIDBOrder(raw));
          }
          // Mutate in-place: only replace the array entries for affected order IDs
          // so that Vue only schedules re-renders for changed items rather than
          // replacing the entire array reference (which forces a full list re-render).
          const updatedIds = new Set();
          for (let i = 0; i < orders.value.length; i++) {
            const sid = String(orders.value[i].id);
            const updated = mappedById.get(sid);
            if (updated) {
              orders.value.splice(i, 1, updated);
              updatedIds.add(sid);
            }
          }
          // Insert orders that were not already present in the reactive array
          // (e.g. a new order arriving via WS or pull that a follower tab missed).
          // orders.value has no single canonical sort; components apply their own
          // computed sorts, so appending at the tail is safe and correct.
          for (const [id, mapped] of mappedById) {
            if (!updatedIds.has(id)) orders.value.push(mapped);
          }
        }
      } catch (e) {
        console.warn('[orderStore] Targeted order refresh failed, falling back to full refresh:', e);
        // Fall through to full refresh below on error.
        const idbState = await loadStateFromIDB();
        if (!idbState) return;
        orders.value = (idbState.orders ?? []).map(_mapIDBOrder);
      }
      return;
    }

    const requestedCollections = collections ?? (collection ? [collection] : Object.keys(operationalStateRefs));
    const resolvedKeys = requestedCollections.map((k) => _COLLECTION_TO_STATE_KEY[k] ?? k);
    const targetCollections = [...new Set(resolvedKeys)]
      .filter((key) => Object.prototype.hasOwnProperty.call(operationalStateRefs, key));
    if (!targetCollections.length) return;

    const idbState = await loadStateFromIDB();
    if (!idbState) return;

    targetCollections.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(idbState, key)) {
        if (key === 'orders') {
          operationalStateRefs[key].value = (idbState[key] ?? []).map(_mapIDBOrder);
        } else {
          operationalStateRefs[key].value = idbState[key];
        }
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

  function _enqueueOrderItemsPatch(ordId, projectedOrder) {
    if (!ordId || !projectedOrder || typeof projectedOrder !== 'object') return;
    // Safety-net: ensure every order item and its modifiers have a stable Directus
    // PK before the payload is cloned and enqueued.  This covers:
    //   • legacy IDB items created before client-side UUID assignment was introduced,
    //   • the addItemsToOrder merge path where an existing item may still lack an id,
    //   • any other code path that pushes items/modifiers into orderItems without an id.
    // When IDs are generated, this path persists the updated order snapshot to IDB;
    // reactive state is then refreshed via the persistence event bus, which may be
    // asynchronous in production.
    let didGenerateMissingIds = false;
    if (Array.isArray(projectedOrder.orderItems)) {
      for (const item of projectedOrder.orderItems) {
        if (item && !item.id) {
          item.id = newUUIDv7();
          didGenerateMissingIds = true;
        }
        if (Array.isArray(item?.modifiers)) {
          for (const mod of item.modifiers) {
            if (mod && !mod.id) {
              mod.id = newUUIDv7();
              didGenerateMissingIds = true;
            }
          }
        }
      }
    }
    if (didGenerateMissingIds) {
      // Make the generated IDs visible in reactive state immediately so any
      // subsequent mutation on the same order observes the same item/modifier
      // IDs even if the IDB write or event-bus propagation is still pending.
      const nextOrders = _replaceOrderById(ordId, projectedOrder);
      // Suppress the watcher-triggered debounced save so the explicit saveStateToIDB
      // call below is the sole IDB write for this reactive update.
      _skipNextScheduledSave('orders');
      orders.value = nextOrders;
      saveStateToIDB({ orders: nextOrders }).catch((error) => {
        console.error('Failed to persist generated order item IDs to IDB', error);
        // orders.value is already synchronized with nextOrders; schedule a retry
        // so persistence catches up without regenerating IDs.
        _scheduleSave('orders');
      });
    }
    const payload = {};
    if (Object.prototype.hasOwnProperty.call(projectedOrder, 'orderItems')) {
      payload.orderItems = projectedOrder.orderItems;
    }
    if (Object.prototype.hasOwnProperty.call(projectedOrder, 'totalAmount')) {
      payload.totalAmount = projectedOrder.totalAmount;
    }
    if (Object.prototype.hasOwnProperty.call(projectedOrder, 'itemCount')) {
      payload.itemCount = projectedOrder.itemCount;
    }
    if (Object.keys(payload).length === 0) return;
    enqueue('orders', 'update', ordId, _clone(payload));
  }

  function _enqueueTransactionPatch(txn) {
    if (!txn?.id) return;
    enqueue('transactions', 'update', txn.id, _clone({
      table: txn.table ?? null,
      bill_session: txn.bill_session ?? null,
    }));
  }

  function _enqueueBillSessionPatch(billSessionId, payload) {
    if (!billSessionId || !payload || typeof payload !== 'object') return;
    enqueue('bill_sessions', 'update', billSessionId, _clone(payload));
  }

  function _enqueueBillSessionCreate(session) {
    if (!session?.billSessionId || !session?.table) return;
    enqueue('bill_sessions', 'create', session.billSessionId, _clone({
      id: session.billSessionId,
      table: session.table,
      adults: session.adults ?? 0,
      children: session.children ?? 0,
      status: session.status ?? 'open',
      opened_at: session.opened_at ?? new Date().toISOString(),
      ...(session.venue != null ? { venue: session.venue } : {}),
    }));
  }

  function _enqueueOrderPatch(ordId, payload) {
    if (!ordId || !payload || typeof payload !== 'object' || Object.keys(payload).length === 0) return;
    // Safety-net: normalise missing ids on any orderItems carried in the payload
    // (e.g. the changed-order slice produced by splitItemsToTable via _buildOrderSyncPatch).
    // Mutating the original items also updates orders.value[n] (shared reference).
    if (Array.isArray(payload.orderItems)) {
      for (const item of payload.orderItems) {
        if (item && !item.id) item.id = newUUIDv7();
        if (Array.isArray(item?.modifiers)) {
          for (const mod of item.modifiers) {
            if (!mod) continue;
            if (!mod.id) mod.id = newUUIDv7();
            if (Object.prototype.hasOwnProperty.call(mod, 'voidedQuantity')) {
              mod.voided_quantity = mod.voidedQuantity;
            } else if (Object.prototype.hasOwnProperty.call(mod, 'voided_quantity')) {
              mod.voidedQuantity = mod.voided_quantity;
            }
          }
        }
      }
    }
    enqueue('orders', 'update', ordId, _clone(payload));
  }

  /**
   * Returns a new orders array with the entry matching ordId replaced by updated.
   * String coercion ensures reactive-proxy IDs compare correctly against raw strings.
   */
  function _replaceOrderById(ordId, updated) {
    return orders.value.map(o => String(o.id) === String(ordId) ? updated : o);
  }

  // Per-order promise chain: serializes mutations for the same orderId so that
  // rapid concurrent clicks always compose on the latest committed state, not a
  // stale snapshot captured at click time.
  const _orderMutexMap = new Map();
  function _withOrderLock(ordId, fn) {
    const prev = (_orderMutexMap.get(ordId) ?? Promise.resolve()).catch(() => {});
    const next = prev.then(fn);
    const storedPromise = next.catch(() => {});
    _orderMutexMap.set(ordId, storedPromise);
    storedPromise.finally(() => {
      if (_orderMutexMap.get(ordId) === storedPromise) {
        _orderMutexMap.delete(ordId);
      }
    });
    return next;
  }

  async function addOrder(order) {
    if (order.globalNote === undefined) order.globalNote = '';
    if (!order.noteVisibility) order.noteVisibility = { cassa: true, sala: true, cucina: true };
    const nextOrders = [...orders.value, order];
    await saveStateToIDB({ orders: nextOrders });
    enqueue('orders', 'create', order.id, order);
  }

  /**
   * Merges `cartItems` into the pending order identified by `ordId`, then
   * persists to IDB and enqueues the order-items patch for Directus sync.
   *
   * This is the correct, IDB-first alternative to directly mutating the
   * reactive order object from a component (which would silently skip
   * persistence and sync).
   *
   * @param {string} ordId
   * @param {Array}  cartItems  – cart rows (each with dishId, name, unitPrice, quantity, …)
   * @returns {Promise<object|false|null>}
   *   - updated order object on success
   *   - false if the IDB write failed (reactive state unchanged)
   *   - null if preconditions are not met (ordId missing / order not found / not pending)
   */
  async function addItemsToOrder(ordId, cartItems) {
    if (!ordId || !Array.isArray(cartItems) || cartItems.length === 0) return null;
    return _withOrderLock(ordId, async () => {
      const current = orders.value.find(o => String(o.id) === String(ordId));
      if (!current || current.status !== 'pending') return null;
      const projected = _clone(toRaw(current));
      if (!Array.isArray(projected.orderItems)) {
        projected.orderItems = [];
      }
      for (const cartItem of cartItems) {
        if (!cartItem || typeof cartItem !== 'object' || Array.isArray(cartItem)) continue;
        const safeQuantity = Number(cartItem.quantity);
        const normalizedQuantity = Number.isFinite(safeQuantity) ? safeQuantity : 0;
        if (normalizedQuantity <= 0) continue;
        const existing = projected.orderItems.find(r => itemsAreMergeable(r, cartItem));
        if (existing) {
          // Normalise ids on the existing item and its modifiers so subsequent PATCH
          // payloads can always match the Directus record (legacy IDB items may lack ids).
          if (!existing.id) existing.id = newUUIDv7();
          const existingModifiers = Array.isArray(existing.modifiers) ? existing.modifiers : [];
          for (const mod of existingModifiers) {
            if (!mod.id) mod.id = newUUIDv7();
          }
          const existingQuantity = Number(existing.quantity);
          existing.quantity = (Number.isFinite(existingQuantity) ? existingQuantity : 0) + normalizedQuantity;
        } else {
          const normalizedModifiers = (Array.isArray(cartItem.modifiers) ? cartItem.modifiers : []).map(mod => ({
            ...mod,
            id: normalizeEntityId(mod.id),
          }));
          const normalizedItemId = normalizeEntityId(cartItem.id);
          projected.orderItems.push({ ...cartItem, quantity: normalizedQuantity, uid: newShortId('r'), modifiers: normalizedModifiers, id: normalizedItemId });
        }
      }
      updateOrderTotals(projected);
      const projectedOrders = _replaceOrderById(ordId, projected);
      try {
        await saveStateToIDB({ orders: projectedOrders });
      } catch (e) {
        console.warn('[Store] addItemsToOrder IDB save failed:', e);
        return false;
      }
      _enqueueOrderItemsPatch(ordId, projected);
      return projected;
    });
  }

  async function changeOrderStatus(order, newStatus, rejectionReason = null) {
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
    await saveStateToIDB({
      orders: projectedOrders,
      tableOccupiedAt: projectedTableOccupiedAt,
      tableMergedInto: projectedTableMergedInto,
      tableCurrentBillSession: projectedTableCurrentBillSession,
      billRequestedTables: projectedBillRequestedTables,
    });
    if (closingSession?.billSessionId) {
      await closeBillSessionInIDB(closingSession.billSessionId);
    }

    // Reactive state is updated via the IDB event bus (emitIDBChange in saveStateToIDB).
    // Only enqueue sync operations here; no direct ref mutations needed.
    if (projectedActiveOrds.length === 0 && closingSession?.billSessionId) {
      enqueue('bill_sessions', 'update', closingSession.billSessionId, {
        status: 'closed', closed_at: closedAt,
      });
    }
    const projectedOrder = projectedOrders.find(o => o.id === order.id);
    enqueue('orders', 'update', order.id, { status: newStatus, rejectionReason: projectedOrder?.rejectionReason ?? null });
  }

  // ── Order-item mutation helpers (IDB-first, serialized per order) ────────────
  // All seven functions below follow the same contract:
  //   - Mutations for the same orderId are serialized via _withOrderLock to prevent
  //     concurrent rapid clicks from projecting from a stale pre-mutation snapshot.
  //   - Inside the lock, the latest order is re-read from orders.value.
  //   - IDB is written before reactive state is updated.
  //   - Returns true when the mutation is persisted and applied.
  //   - Returns false if the IDB write fails (state unchanged).
  //   - Returns undefined when no mutation is applied because preconditions are not
  //     met (for example: missing orderId, order not found/not pending, or invalid
  //     item/index input).
  // The false-return-on-failure pattern prevents uncaught async errors in Vue
  // click handlers that invoke these functions without await.

  async function updateQtyGlobal(ord, idx, delta) {
    const ordId = ord?.id;
    if (!ordId) return;
    return _withOrderLock(ordId, async () => {
      const current = orders.value.find(o => String(o.id) === String(ordId));
      if (!current || current.status !== 'pending') return;
      const item = current.orderItems[idx];
      if (!item) return;
      const projected = _clone(toRaw(current));
      const projItem = projected.orderItems[idx];
      projItem.quantity += delta;
      if (projItem.quantity <= 0) projected.orderItems.splice(idx, 1);
      updateOrderTotals(projected);
      const projectedOrders = _replaceOrderById(ordId, projected);
      try {
        await saveStateToIDB({ orders: projectedOrders });
      } catch (e) {
        console.warn('[Store] updateQtyGlobal IDB save failed:', e);
        return false;
      }
      _enqueueOrderItemsPatch(ordId, projected);
      return true;
    });
  }

  async function removeRowGlobal(ord, idx) {
    const ordId = ord?.id;
    if (!ordId) return;
    return _withOrderLock(ordId, async () => {
      const current = orders.value.find(o => String(o.id) === String(ordId));
      if (!current || current.status !== 'pending') return;
      const projected = _clone(toRaw(current));
      projected.orderItems.splice(idx, 1);
      updateOrderTotals(projected);
      const projectedOrders = _replaceOrderById(ordId, projected);
      try {
        await saveStateToIDB({ orders: projectedOrders });
      } catch (e) {
        console.warn('[Store] removeRowGlobal IDB save failed:', e);
        return false;
      }
      _enqueueOrderItemsPatch(ordId, projected);
      return true;
    });
  }

  async function voidOrderItems(ord, idx, qtyToVoid) {
    const ordId = ord?.id;
    if (!ordId || !Number.isInteger(qtyToVoid) || qtyToVoid <= 0) return;
    return _withOrderLock(ordId, async () => {
      const current = orders.value.find(o => String(o.id) === String(ordId));
      if (!current || !KITCHEN_ACTIVE_STATUSES.includes(current.status)) return;
      const item = current.orderItems[idx];
      if (!item) return;
      if ((item.voidedQuantity || 0) + qtyToVoid > item.quantity) return;
      const projected = _clone(toRaw(current));
      const projItem = projected.orderItems[idx];
      if (!projItem.voidedQuantity) projItem.voidedQuantity = 0;
      projItem.voidedQuantity += qtyToVoid;
      const maxModActive = projItem.quantity - projItem.voidedQuantity;
      for (const m of (projItem.modifiers || [])) {
        m.voidedQuantity = Math.min(m.voidedQuantity || 0, maxModActive);
      }
      updateOrderTotals(projected);
      const projectedOrders = _replaceOrderById(ordId, projected);
      try {
        await saveStateToIDB({ orders: projectedOrders });
      } catch (e) {
        console.warn('[Store] voidOrderItems IDB save failed:', e);
        return false;
      }
      _enqueueOrderItemsPatch(ordId, projected);
      return true;
    });
  }

  async function restoreOrderItems(ord, idx, qtyToRestore) {
    const ordId = ord?.id;
    if (!ordId || !Number.isInteger(qtyToRestore) || qtyToRestore <= 0) return;
    return _withOrderLock(ordId, async () => {
      const current = orders.value.find(o => String(o.id) === String(ordId));
      if (!current || !KITCHEN_ACTIVE_STATUSES.includes(current.status)) return;
      const item = current.orderItems[idx];
      if (!item || !(item.voidedQuantity && item.voidedQuantity >= qtyToRestore)) return;
      const projected = _clone(toRaw(current));
      projected.orderItems[idx].voidedQuantity -= qtyToRestore;
      updateOrderTotals(projected);
      const projectedOrders = _replaceOrderById(ordId, projected);
      try {
        await saveStateToIDB({ orders: projectedOrders });
      } catch (e) {
        console.warn('[Store] restoreOrderItems IDB save failed:', e);
        return false;
      }
      _enqueueOrderItemsPatch(ordId, projected);
      return true;
    });
  }

  async function voidModifier(ord, itemIdx, modIdx, qty) {
    const ordId = ord?.id;
    if (!ordId || !Number.isInteger(qty) || qty <= 0) return;
    return _withOrderLock(ordId, async () => {
      const current = orders.value.find(o => String(o.id) === String(ordId));
      if (!current || !KITCHEN_ACTIVE_STATUSES.includes(current.status)) return;
      const item = current.orderItems[itemIdx];
      if (!item || !item.modifiers || modIdx < 0 || modIdx >= item.modifiers.length) return;
      const mod = item.modifiers[modIdx];
      if ((mod.voidedQuantity || 0) + qty + (item.voidedQuantity || 0) > item.quantity) return;
      const projected = _clone(toRaw(current));
      const projMod = projected.orderItems[itemIdx].modifiers[modIdx];
      if (!projMod.voidedQuantity) projMod.voidedQuantity = 0;
      projMod.voidedQuantity += qty;
      updateOrderTotals(projected);
      const projectedOrders = _replaceOrderById(ordId, projected);
      try {
        await saveStateToIDB({ orders: projectedOrders });
      } catch (e) {
        console.warn('[Store] voidModifier IDB save failed:', e);
        return false;
      }
      _enqueueOrderItemsPatch(ordId, projected);
      return true;
    });
  }

  async function restoreModifier(ord, itemIdx, modIdx, qty) {
    const ordId = ord?.id;
    if (!ordId || !Number.isInteger(qty) || qty <= 0) return;
    return _withOrderLock(ordId, async () => {
      const current = orders.value.find(o => String(o.id) === String(ordId));
      if (!current || !KITCHEN_ACTIVE_STATUSES.includes(current.status)) return;
      const item = current.orderItems[itemIdx];
      if (!item || !item.modifiers || modIdx < 0 || modIdx >= item.modifiers.length) return;
      const mod = item.modifiers[modIdx];
      if ((mod.voidedQuantity || 0) < qty) return;
      const projected = _clone(toRaw(current));
      projected.orderItems[itemIdx].modifiers[modIdx].voidedQuantity -= qty;
      updateOrderTotals(projected);
      const projectedOrders = _replaceOrderById(ordId, projected);
      try {
        await saveStateToIDB({ orders: projectedOrders });
      } catch (e) {
        console.warn('[Store] restoreModifier IDB save failed:', e);
        return false;
      }
      _enqueueOrderItemsPatch(ordId, projected);
      return true;
    });
  }

  async function setItemKitchenReady(order, itemIdx, ready) {
    const ordId = order?.id;
    if (!ordId) return;
    return _withOrderLock(ordId, async () => {
      const current = orders.value.find(o => String(o.id) === String(ordId));
      if (!current || !current.orderItems || itemIdx < 0 || itemIdx >= current.orderItems.length) return;
      const currentReady = !!current.orderItems[itemIdx].kitchenReady;
      const nextReady = typeof ready === 'boolean' ? ready : !currentReady;
      const projected = _clone(toRaw(current));
      projected.orderItems[itemIdx].kitchenReady = nextReady;
      const projectedOrders = _replaceOrderById(ordId, projected);
      try {
        await saveStateToIDB({ orders: projectedOrders });
      } catch (e) {
        console.warn('[Store] setItemKitchenReady IDB save failed:', e);
        return false;
      }
      _enqueueOrderItemsPatch(ordId, projected);
      return true;
    });
  }

  async function addTransaction(txn) {
    const nextTransactions = [...transactions.value, txn];
    const nextBillRequestedTables = new Set(billRequestedTables.value);
    if (txn.table) nextBillRequestedTables.delete(txn.table);
    await saveStateToIDB({
      transactions: nextTransactions,
      billRequestedTables: nextBillRequestedTables,
    });
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

      await persistAndEnqueueRefs().catch((err) => {
        console.warn('[Store] Failed to persist/enqueue transaction refs:', err);
      });
    }
  }

  async function addTipTransaction(tableId, billSessionId, tipValue) {
    if (!tableId || tipValue <= 0) return;
    const venueId = configStore.config.directus?.venueId;
    const txn = {
      id: newUUIDv7(),
      table: tableId,
      bill_session: billSessionId ?? null,
      paymentMethod: 'Mancia',
      operationType: 'tip',
      amountPaid: 0,
      tipAmount: tipValue,
      timestamp: new Date().toISOString(),
      orderRefs: [],
      ...(venueId != null ? { venue: venueId } : {}),
    };
    const nextTransactions = [...transactions.value, txn];
    await saveStateToIDB({ transactions: nextTransactions });
    enqueue('transactions', 'create', txn.id, txn);
  }

  async function addDirectOrder(tableId, billSessionId, items) {
    if (!tableId || !Array.isArray(items) || items.length === 0) return null;
    const venueId = configStore.config.directus?.venueId;
    const now = new Date().toISOString();
    // Direct orders (cover charge, cassa-added items) are immediately accepted:
    // create with status 'accepted' so no pending→accepted transition is needed.
    const order = {
      id: newUUIDv7(),
      table: tableId,
      billSessionId: billSessionId ?? null,
      status: 'accepted',
      time: formatOrderTime(),
      totalAmount: 0,
      itemCount: 0,
      dietaryPreferences: {},
      globalNote: '',
      noteVisibility: { cassa: true, sala: true, cucina: true },
      orderItems: items.map(item => ({
        ...item,
        id: normalizeEntityId(item.id),
        modifiers: (Array.isArray(item.modifiers) ? item.modifiers : []).map(mod => ({
          ...mod,
          id: normalizeEntityId(mod.id),
        })),
      })),
      isDirectEntry: true,
      ...(venueId != null ? { venue: venueId } : {}),
    };
    updateOrderTotals(order);

    // Prepare the table occupancy timestamp together with the new order (persisted IDB-first).
    const projectedTableOccupiedAt = { ...tableOccupiedAt.value };
    if (!projectedTableOccupiedAt[tableId]) {
      projectedTableOccupiedAt[tableId] = now;
    }
    const nextOrders = [...orders.value, order];

    // IDB-first: persist both values in a single multi-store transaction so that
    // either both the new order and the occupancy timestamp are written together
    // or neither is — preventing ghost orders on partial-failure reloads.
    try {
      await saveOrdersAndOccupancyInIDB(nextOrders, projectedTableOccupiedAt);
    } catch (_) {
      return false;
    }
    // Single Directus enqueue — the create already carries accepted status + full orderItems.
    enqueue('orders', 'create', order.id, order);
    return order;
  }

  function setCashBalance(amount) {
    const next = parseFloat(amount) || 0;
    // Initiate IDB write before reactive update; watcher retries only if this save fails.
    saveStateToIDB({ cashBalance: next })
      .catch(e => {
        console.warn('[Store] setCashBalance IDB save failed:', e);
        _scheduleSave('cashBalance');
      });
    _skipNextScheduledSave('cashBalance');
    cashBalance.value = next;
  }
  const setFondoCassa = setCashBalance;

  async function addCashMovement(type, amount, reason) {
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
    await saveStateToIDB({ cashMovements: nextCashMovements });
    enqueue('cash_movements', 'create', mov.id, mov);
  }

  async function simulateNewOrder() {
    const randomFraction = (() => {
      if (globalThis.crypto?.getRandomValues) {
        const randomBuffer = new Uint32Array(1);
        globalThis.crypto.getRandomValues(randomBuffer);
        return randomBuffer[0] / 4294967296; // 4294967296 = 2^32 → normalize to [0, 1)
      }
      return Math.random();
    })();
    const num = Math.floor(randomFraction * 12) + 1;
    const newTav = num < 10 ? '0' + num : '' + num;
    const now = formatOrderTime();
    let billSessionId = tableCurrentBillSession.value[newTav]?.billSessionId ?? null;
    const venueId = configStore.config.directus?.venueId;
    if (!billSessionId) {
      billSessionId = await openTableSession(newTav, 2, 0);
    }

    await addOrder({
      id: newUUIDv7(),
      table: newTav,
      billSessionId,
      status: 'pending',
      time: now,
      totalAmount: 12,
      itemCount: 1,
      dietaryPreferences: {},
      globalNote: '',
      noteVisibility: { cassa: true, sala: true, cucina: true },
      orderItems: [
        { id: newUUIDv7(), uid: newShortId('r'), dishId: 'pri_2', name: 'Amatriciana', unitPrice: 12, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
      ],
      ...(venueId != null ? { venue: venueId } : {}),
    });

    const cc = configStore.config.coverCharge;
    if (cc?.enabled && cc?.autoAdd && cc?.priceAdult > 0) {
      const coverOrder = await addDirectOrder(newTav, billSessionId, [
        { uid: newShortId('cop'), dishId: null, name: cc.name, unitPrice: cc.priceAdult, quantity: 2, voidedQuantity: 0, notes: [], modifiers: [] },
      ]);
      if (coverOrder) coverOrder.isCoverCharge = true;
    }
  }

  const { moveTableOrders, mergeTableOrders, detachSlaveTable, splitItemsToTable } =
    makeTableOps(
      { orders, transactions, tableCurrentBillSession, tableOccupiedAt, billRequestedTables, tableMergedInto },
      {
        addDirectOrder,
        openTableSession,
        getTableStatus,
        setBillRequested,
        slaveIdsOf,
        resolveMaster,
        updateBillRequestedState: _updateBillRequestedState,
        enqueueOrderUpdate: _enqueueOrderPatch,
        enqueueTransactionUpdate: _enqueueTransactionPatch,
        enqueueBillSessionUpdate: _enqueueBillSessionPatch,
        enqueueBillSessionCreate: _enqueueBillSessionCreate,
      },
    );

  const reportTransactions = computed(() =>
    (transactions.value || []).map((t) => ({
      ...t,
      tableId: t?.tableId ?? t?.table,
      billSessionId: t?.billSessionId ?? t?.bill_session,
    })),
  );

  const { generateXReport, performDailyClose, closedBills } =
    makeReportOps(
      {
        orders,
        transactions: reportTransactions,
        cashBalance,
        cashMovements,
        dailyClosures,
        config: configRef,
        fiscalReceipts,
        invoiceRequests,
      },
      { getTableStatus, upsertRecordsIntoIDB, enqueue },
    );

  const pendingOpenTable = ref(null);
  const pendingSelectOrder = ref(null);
  const pendingNewOrder = ref(null);

  let _saveTimer = null;
  let _saveChain = Promise.resolve();
  const _pendingSaveKeys = new Set();
  const _skipNextSaveCount = new Map();
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
    keys.forEach((key) => {
      // Explicit IDB-first actions mark keys to skip once so watcher-driven
      // debounced persistence doesn't rewrite the same payload immediately after.
      const pendingSkipValue = _skipNextSaveCount.get(key);
      const pendingSkip = pendingSkipValue === undefined ? 0 : pendingSkipValue;
      if (pendingSkip > 0) {
        if (pendingSkip === 1) _skipNextSaveCount.delete(key);
        else _skipNextSaveCount.set(key, pendingSkip - 1);
        return;
      }
      _pendingSaveKeys.add(key);
    });
    // Safe early return: `_pendingSaveKeys` is only populated in this function
    // and we just filtered all incoming keys (all skipped), so there is nothing
    // to flush and no timer is needed.
    if (_pendingSaveKeys.size === 0) return;
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

  // Prevents the watcher-driven debounced save from creating a redundant IDB write
  // after an explicit IDB-first action that already persisted the same keys.
  function _skipNextScheduledSave(...keys) {
    keys.forEach((key) => {
      const pendingSkipValue = _skipNextSaveCount.get(key);
      const pendingSkip = pendingSkipValue === undefined ? 0 : pendingSkipValue;
      _skipNextSaveCount.set(key, pendingSkip + 1);
    });
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

  // ── IDB event-bus subscriber ──────────────────────────────────────────────────
  // This subscriber is the primary reactive-update path for IDB-first action bodies.
  // Every confirmed IDB write emits on this bus and updates the reactive refs below.
  // Exceptions that still assign directly:
  //   • openTableSession – uses upsertBillSessionInIDB (different bus path)
  //   • performDailyClose (makeReportOps) – uses raw Vue refs outside the bus context;
  //     the duplicate bus assignment that follows is harmless but acknowledged.
  //   • _enqueueOrderItemsPatch safety-net – directly assigns orders.value = nextOrders
  //     so generated IDs are visible immediately, then explicitly calls saveStateToIDB.
  //     When that save later emits on the bus, this subscriber applies the persisted
  //     state and uses _skipNextScheduledSave('orders') to avoid a redundant re-save.
  const unsubIDBChange = onIDBChange((state) => {
    const keys = [];
    if ('orders' in state) { orders.value = state.orders; keys.push('orders'); }
    if ('transactions' in state) { transactions.value = state.transactions; keys.push('transactions'); }
    if ('cashBalance' in state && cashBalance.value !== state.cashBalance) { cashBalance.value = state.cashBalance; keys.push('cashBalance'); }
    if ('cashMovements' in state) { cashMovements.value = state.cashMovements; keys.push('cashMovements'); }
    if ('dailyClosures' in state) { dailyClosures.value = state.dailyClosures; keys.push('dailyClosures'); }
    // printLog is not handled here: the IDB-persisted form has `payload` stripped,
    // so updating the ref from the bus would lose reprint data. The watcher path handles persistence.
    if ('tableCurrentBillSession' in state) { tableCurrentBillSession.value = state.tableCurrentBillSession; keys.push('tableCurrentBillSession'); }
    if ('tableMergedInto' in state) { tableMergedInto.value = state.tableMergedInto; keys.push('tableMergedInto'); }
    if ('tableOccupiedAt' in state) { tableOccupiedAt.value = state.tableOccupiedAt; keys.push('tableOccupiedAt'); }
    if ('billRequestedTables' in state) { billRequestedTables.value = new Set(state.billRequestedTables ?? []); keys.push('billRequestedTables'); }
    if (keys.length) _skipNextScheduledSave(...keys);
  });
  onScopeDispose(unsubIDBChange);

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
    addItemsToOrder,
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
