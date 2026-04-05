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
import { appConfig, updateOrderTotals, KITCHEN_ACTIVE_STATUSES, KEYBOARD_POSITIONS } from '../utils/index.js';
import { getInstanceName, resolveStorageKeys } from './persistence.js';

// Derive storage keys once at module load — stable for the lifetime of the page
const _instanceName = getInstanceName();
const { storageKey, settingsKey } = resolveStorageKeys(_instanceName);

export const useAppStore = defineStore('app', () => {

  // ── Core State ─────────────────────────────────────────────────────────────
  const config = ref(appConfig);
  // orders is initialized empty; pinia-plugin-persistedstate will hydrate saved state,
  // or afterHydrate will fall back to appConfig.demoOrders on first load.
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
  // Maps slaveTableId -> masterTableId for merged tables.
  // A slave table keeps its orders on its own `table` field but shares the
  // master's billSessionId, so the combined bill is managed from the master.
  const tableMergedInto = ref({});

  // ── Computed: CSS variables for theming ────────────────────────────────────
  const cssVars = computed(() => ({
    '--brand-primary': config.value.ui.primaryColor,
    '--brand-dark': config.value.ui.primaryColorDark,
  }));

  // ── Computed: Rooms ────────────────────────────────────────────────────────
  // Normalises the rooms configuration: if config.rooms is a non-empty array each
  // entry is used as-is; otherwise all tables are wrapped in a single anonymous room
  // so the rest of the UI always receives a consistent structure.
  // The fallback room intentionally uses an empty label ('') — the UI hides the room
  // tab bar entirely when there is only one room (store.rooms.length <= 1), so the
  // empty label is never displayed to the user.
  const rooms = computed(() => {
    const r = config.value.rooms;
    if (Array.isArray(r) && r.length > 0) return r;
    return [{ id: 'main', label: '', tables: config.value.tables ?? [] }];
  });

    // ── Computed: Orders ───────────────────────────────────────────────────────
  const pendingCount = computed(() => orders.value.filter(o => o.status === 'pending').length);
  const inKitchenCount = computed(() =>
    orders.value.filter(o => KITCHEN_ACTIVE_STATUSES.includes(o.status)).length,
  );

  // ── Computed: Table helpers ────────────────────────────────────────────────
  function getTableStatus(tableId) {
    // If this table is merged into a master, delegate to the master for billing
    // status while still showing the table as occupied on the floor plan.
    const masterId = tableMergedInto.value[tableId];
    if (masterId) {
      // The slave itself must have active orders to appear occupied
      const slaveOrds = orders.value.filter(
        o => o.table === tableId && o.status !== 'completed' && o.status !== 'rejected',
      );
      if (slaveOrds.length === 0) return { status: 'free', total: 0, remaining: 0 };
      // Mirror the master's billing status (paid, bill_requested, occupied…)
      const masterStatus = getTableStatus(masterId);
      // Always show at least 'occupied'; never show 'free' since the slave has orders
      return {
        ...masterStatus,
        status: masterStatus.status === 'free' ? 'occupied' : masterStatus.status,
        isMergedSlave: true,
        masterTableId: masterId,
      };
    }

    // Collect all slave tables merged into this master
    const slaveIds = slaveIdsOf(tableId);
    const allTableIds = [tableId, ...slaveIds];

    const ords = orders.value.filter(
      o => allTableIds.includes(o.table) && o.status !== 'completed' && o.status !== 'rejected',
    );
    if (ords.length === 0) return { status: 'free', total: 0, remaining: 0 };

    // Include completed orders in the total so that per-order payments track correctly
    const session = tableCurrentBillSession.value[tableId];
    const billable = orders.value.filter(
      o => allTableIds.includes(o.table) &&
        (KITCHEN_ACTIVE_STATUSES.includes(o.status) || o.status === 'completed') &&
        (!session || o.billSessionId === session.billSessionId),
    );
    const total = billable.reduce((a, b) => a + b.totalAmount, 0);
    const paid = transactions.value
      .filter(t => t.tableId === tableId)
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

  // ── Mutations: Orders ──────────────────────────────────────────────────────
  function addOrder(order) {
    if (order.globalNote === undefined) order.globalNote = '';
    if (!order.noteVisibility) order.noteVisibility = { cassa: true, sala: true, cucina: true };
    orders.value.push(order);
  }

  function changeOrderStatus(order, newStatus, rejectionReason = null) {
    order.status = newStatus;
    if (newStatus === 'rejected' && rejectionReason) {
      order.rejectionReason = rejectionReason;
    }
    // When first kitchen-active order for a table, record occupiedAt
    if (KITCHEN_ACTIVE_STATUSES.includes(newStatus) && !tableOccupiedAt.value[order.table]) {
      tableOccupiedAt.value[order.table] = new Date().toISOString();
    }
    // When all orders for table are closed, clear occupiedAt, bill request, and session
    const activeOrds = orders.value.filter(
      o => o.table === order.table && o.status !== 'completed' && o.status !== 'rejected',
    );
    if (activeOrds.length === 0) {
      // Before clearing the master session, check whether any slave tables that
      // are still merged into this table have active orders. If they do, the
      // master state must be kept alive so the combined bill remains valid.
      const slaveTableIds = slaveIdsOf(order.table);
      const slaveHasActiveOrders = slaveTableIds.some(slaveId =>
        orders.value.some(
          o => o.table === slaveId && o.status !== 'completed' && o.status !== 'rejected',
        ),
      );
      if (slaveHasActiveOrders) return;

      delete tableOccupiedAt.value[order.table];
      // If this was a merged slave, clear the stale merge relationship so the
      // table can be opened independently after its bill has been settled.
      if (tableMergedInto.value[order.table]) {
        const nextMerge = { ...tableMergedInto.value };
        delete nextMerge[order.table];
        tableMergedInto.value = nextMerge;
      }
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

  // Post-payment tip: adds a tip-only transaction on a closed bill session.
  // amountPaid is 0 so it does not affect the bill balance; only tipAmount is recorded.
  function addTipTransaction(tableId, billSessionId, tipValue) {
    if (!tableId || tipValue <= 0) return;
    transactions.value.push({
      transactionId: 'tip_' + Math.random().toString(36).slice(2, 11),
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

  // ── Mutations: Table Operations ────────────────────────────────────────────
  function setBillRequested(tableId, val) {
    if (val) billRequestedTables.value.add(tableId);
    else billRequestedTables.value.delete(tableId);
    // Trigger reactivity: replace the Set
    billRequestedTables.value = new Set(billRequestedTables.value);
  }

  // ── Private merge helpers ──────────────────────────────────────────────────
  // Returns all slave table IDs currently merged into the given master table.
  function slaveIdsOf(masterId) {
    return Object.keys(tableMergedInto.value).filter(
      id => tableMergedInto.value[id] === masterId,
    );
  }

  // Resolves a tableId to its merge master. If the table is a slave, returns
  // the master ID; otherwise returns the table ID itself.
  // Using this prevents slave→slave chains when re-parenting.
  function resolveMaster(tableId) {
    return tableMergedInto.value[tableId] ?? tableId;
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
    // Any slave tables that were merged into the source must now follow the source.
    // Resolve toTableId to its own master first so we never create a slave→slave chain
    // (which would break billing aggregation because the ultimate master would miss orders).
    const resolvedMoveTarget = resolveMaster(toTableId);
    // Collect old slaves of fromTableId BEFORE re-pointing them so we can retag their
    // orders/transactions when the destination is already occupied (see else branch below).
    const oldSlaveIds = slaveIdsOf(fromTableId);
    oldSlaveIds.forEach(slaveId => {
      tableMergedInto.value = { ...tableMergedInto.value, [slaveId]: resolvedMoveTarget };
    });
    // If the source was itself a slave, re-point it to the destination's master (or the dest)
    if (tableMergedInto.value[fromTableId]) {
      delete tableMergedInto.value[fromTableId];
    }
    // Move bill session
    if (tableCurrentBillSession.value[fromTableId]) {
      if (!tableCurrentBillSession.value[toTableId]) {
        const next = { ...tableCurrentBillSession.value };
        next[toTableId] = next[fromTableId];
        delete next[fromTableId];
        tableCurrentBillSession.value = next;
        // Free destination: move ALL transactions wholesale (both active-session and
        // historical) so the full receipt history follows the table.
        transactions.value.forEach(t => {
          if (t.tableId === fromTableId) t.tableId = toTableId;
        });
      } else {
        // Destination already has a session — retag only the active-session orders and
        // transactions so they belong to the destination session and are visible in its
        // payment panel. Historical transactions (other billSessionIds) remain tied to
        // fromTableId to avoid corrupting receipt/history reporting.
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
            t.tableId = toTableId;
          }
        });
        // Also retag orders/transactions on slave tables that were tagged to the source
        // session — without this they would disappear from the destination's combined bill.
        oldSlaveIds.forEach(slaveId => {
          orders.value.forEach(o => {
            if (o.table === slaveId && o.billSessionId === srcSessionId) {
              o.billSessionId = destSessionId;
            }
          });
          transactions.value.forEach(t => {
            if (t.tableId === slaveId && t.billSessionId === srcSessionId) {
              t.billSessionId = destSessionId;
              t.tableId = toTableId;
            }
          });
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
    } else {
      // No active session on the source — move any existing transactions (edge case:
      // direct orders placed without opening a billing session).
      transactions.value.forEach(t => {
        if (t.tableId === fromTableId) t.tableId = toTableId;
      });
    }
  }

  function mergeTableOrders(sourceTableId, targetTableId) {
    // New Unisci behaviour: orders STAY on their original (source) table so
    // per-table tracking is preserved. The source table is linked to the
    // master (target) billing session so the two tables share a single bill.
    // Both tables remain "occupied" on the floor plan.

    // Resolve chains: if target is itself a slave, adopt its master as the real target
    const resolvedTargetId = resolveMaster(targetTableId);

    // Guard: self-map or cycle would cause infinite recursion in getTableStatus()
    if (sourceTableId === resolvedTargetId) return;

    // Ensure the target has an open session; if not, open one now
    if (!tableCurrentBillSession.value[resolvedTargetId]) {
      openTableSession(resolvedTargetId);
    }
    const targetSession = tableCurrentBillSession.value[resolvedTargetId];
    const targetSessionId = targetSession.billSessionId;

    // If source is already a slave (of someone else), re-parent it to the new master
    delete tableMergedInto.value[sourceTableId];

    // Any current slaves of the source become slaves of the resolved target
    slaveIdsOf(sourceTableId).forEach(slaveId => {
      tableMergedInto.value = { ...tableMergedInto.value, [slaveId]: resolvedTargetId };
    });

    // Retag source orders to the target's bill session (orders stay on source table).
    // Include completed orders from the current session so they remain in the combined
    // bill total (getTableStatus() includes completed orders filtered by billSessionId).
    const srcSession = tableCurrentBillSession.value[sourceTableId];
    const srcSessionId = srcSession?.billSessionId;
    orders.value.forEach(o => {
      if (o.table !== sourceTableId) return;
      if (o.status === 'rejected') return;
      // Active orders: always retag
      if (o.status !== 'completed') { o.billSessionId = targetSessionId; return; }
      // Completed orders: retag only if they belong to the current source session
      if (srcSessionId && o.billSessionId === srcSessionId) o.billSessionId = targetSessionId;
    });

    // Move only the source table's current-session transactions to the target.
    // Historical transactions from older bill sessions must stay attached to
    // the original table so closed-bill history and session calculations remain correct.
    if (srcSessionId) {
      transactions.value.forEach(t => {
        if (t.tableId === sourceTableId && t.billSessionId === srcSessionId) {
          t.tableId = resolvedTargetId;
          t.billSessionId = targetSessionId;
        }
      });
    }

    // Preserve the earliest occupiedAt on the master
    if (tableOccupiedAt.value[sourceTableId]) {
      const srcTime = tableOccupiedAt.value[sourceTableId];
      const tgtTime = tableOccupiedAt.value[resolvedTargetId];
      if (!tgtTime || new Date(srcTime) < new Date(tgtTime)) {
        tableOccupiedAt.value[resolvedTargetId] = srcTime;
      }
      // Keep source's occupiedAt so it stays "occupied" on the floor plan
    }

    // Combine headcounts on the master session
    if (srcSession) {
      const next = { ...tableCurrentBillSession.value };
      next[resolvedTargetId] = {
        ...next[resolvedTargetId],
        adults: (next[resolvedTargetId]?.adults ?? 0) + (srcSession.adults ?? 0),
        children: (next[resolvedTargetId]?.children ?? 0) + (srcSession.children ?? 0),
      };
      delete next[sourceTableId];
      tableCurrentBillSession.value = next;
    } else {
      // Source had no session; just remove whatever stale entry might exist
      const next = { ...tableCurrentBillSession.value };
      delete next[sourceTableId];
      tableCurrentBillSession.value = next;
    }

    // Clear bill request on source
    billRequestedTables.value.delete(sourceTableId);
    billRequestedTables.value = new Set(billRequestedTables.value);

    // Record the merge relationship
    tableMergedInto.value = { ...tableMergedInto.value, [sourceTableId]: resolvedTargetId };
  }

  // Splits a slave table back out of a merged group.
  // Called after splitItemsToTable has already moved any master-bound items back.
  // All remaining active orders on the slave are retagged to a fresh session.
  function splitTableOrders(masterTableId, slaveTableId) {
    if (tableMergedInto.value[slaveTableId] !== masterTableId) return; // not a slave of this master

    // Remove slave from the merge group first so openTableSession treats it as independent
    const next = { ...tableMergedInto.value };
    delete next[slaveTableId];
    tableMergedInto.value = next;

    // Create a fresh session for the slave using the shared helper (ensures consistent ID generation)
    const newSessionId = openTableSession(slaveTableId, 0, 0);

    // Retag all remaining active orders on the slave to its new independent session
    orders.value.forEach(o => {
      if (o.table !== slaveTableId) return;
      if (o.status === 'completed' || o.status === 'rejected') return;
      o.billSessionId = newSessionId;
    });
  }

  /**
   * Moves selected item quantities from one table to another at the item level.
   *
   * - itemQtyMap: { key: qtyToMove } where key = `${orderId}__${itemUid}`
   * - For each item, `qtyToMove` quantities are voided on the source order and
   *   a new direct order is created on the target table.
   * - The target table gets a billing session if it doesn't already have one.
   *
   * Used both for splitting a single table (source = current table, target = free table)
   * and for partially returning items from a merged slave back to the master.
   *
   * @param {string} sourceTableId
   * @param {string} targetTableId
   * @param {object} itemQtyMap  { key: qtyToMove }
   * @returns {boolean} true if any items were moved
   */
  function splitItemsToTable(sourceTableId, targetTableId, itemQtyMap) {
    if (!sourceTableId || !targetTableId || sourceTableId === targetTableId) return false;

    // Ensure target has a billing session.
    // If the target is already occupied (e.g. pending-only orders or a merged slave)
    // but has no own session, refuse the operation to avoid creating a rogue session.
    let targetSession = tableCurrentBillSession.value[targetTableId];
    if (!targetSession) {
      const targetStatus = getTableStatus(targetTableId).status;
      if (targetStatus !== 'free') return false;

      // A free table must not still be marked as a merged slave. If such a mapping
      // remains, it is stale and would cause the new independent session/orders to
      // be hidden behind the merge master in later status/billing lookups.
      if (tableMergedInto.value[targetTableId]) {
        delete tableMergedInto.value[targetTableId];
      }
      openTableSession(targetTableId);
      targetSession = tableCurrentBillSession.value[targetTableId];
    }
    if (!targetSession || !targetSession.billSessionId) return false;
    const targetSessionId = targetSession.billSessionId;

    const movedItemsForTarget = [];

    orders.value.forEach(ord => {
      if (ord.table !== sourceTableId) return;
      if (ord.status === 'completed' || ord.status === 'rejected') return;

      let orderModified = false;

      ord.orderItems.forEach(item => {
        const key = `${ord.id}__${item.uid}`;
        const moveQty = Math.max(0, Math.floor(itemQtyMap[key] || 0));
        if (moveQty <= 0) return;

        const netQty = item.quantity - (item.voidedQuantity || 0);
        const actualMoveQty = Math.min(moveQty, netQty);
        if (actualMoveQty <= 0) return;

        // Void actualMoveQty units from the source item
        item.voidedQuantity = (item.voidedQuantity || 0) + actualMoveQty;
        orderModified = true;

        // Build a copy of the item (with all its modifiers) for the target order.
        // Use the same crypto.randomUUID strategy as openTableSession for consistent UID generation.
        const newUid = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : 'spl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
        movedItemsForTarget.push({
          uid: newUid,
          dishId: item.dishId ?? null,
          name: item.name,
          unitPrice: item.unitPrice,
          quantity: actualMoveQty,
          voidedQuantity: 0,
          notes: item.notes ? [...item.notes] : [],
          modifiers: (item.modifiers || []).map(m => ({ ...m, voidedQuantity: 0 })),
        });
      });

      if (orderModified) updateOrderTotals(ord);
    });

    if (movedItemsForTarget.length === 0) return false;

    // Create a new direct order on the target table carrying all moved items
    addDirectOrder(targetTableId, targetSessionId, movedItemsForTarget);

    // Mark target as occupied if it wasn't already
    if (!tableOccupiedAt.value[targetTableId]) {
      tableOccupiedAt.value[targetTableId] = new Date().toISOString();
    }

    return true;
  }

  // ── Mutations: Cassa ───────────────────────────────────────────────────────
  function setCashBalance(amount) {
    cashBalance.value = parseFloat(amount) || 0;
  }

  // Backwards compatibility alias; prefer using setCashBalance going forward
  const setFondoCassa = setCashBalance;
  function addCashMovement(type, amount, reason) {
    cashMovements.value.push({
      id: 'mov_' + Math.random().toString(36).slice(2, 11),
      type, // 'deposit' | 'withdrawal'
      amount: parseFloat(amount) || 0,
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
    const now = new Date().toLocaleTimeString(appConfig.locale, { hour: '2-digit', minute: '2-digit', timeZone: appConfig.timezone });
    const session = tableCurrentBillSession.value[newTav];
    const billSessionId = session?.billSessionId ?? null;

    // Kitchen order with the food item
    orders.value.push({
      id: 'ord_' + Math.random().toString(36).substr(2, 9),
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
        { uid: 'r_' + Date.now(), dishId: 'pri_2', name: 'Amatriciana', unitPrice: 12, quantity: 1, voidedQuantity: 0, notes: [], modifiers: [] },
      ],
    });

    // Coperto as direct entry (if configured)
    const cc = config.value.coverCharge;
    if (cc?.enabled && cc?.autoAdd && cc?.priceAdult > 0) {
      addDirectOrder(newTav, billSessionId, [
        { uid: 'cop_a_' + Math.random().toString(36).slice(2, 11), dishId: cc.dishId + '_adulto', name: cc.name, unitPrice: cc.priceAdult, quantity: 2, voidedQuantity: 0, notes: [], modifiers: [] },
      ])?.isCoverCharge || (orders.value.at(-1).isCoverCharge = true);
    }
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

  // ── Mutations: Direct orders (bypass kitchen workflow) ────────────────────
  /**
   * Creates an order that goes directly to "accepted" status, bypassing the
   * kitchen workflow. Used for items served at the counter (e.g. espresso),
   * service charges, or any item that should not go through the kitchen queue.
   *
   * The order is initialised with status 'pending' and immediately transitioned
   * to 'accepted' so that it becomes visible in the bill without requiring
   * kitchen approval.
   *
   * @param {string} tableId       – Table identifier
   * @param {string|null} billSessionId – Active bill session id (or null)
   * @param {Array}  items         – Array of order item objects
   * @returns {Object|null}        – The created order, or null when items is empty
   */
  function addDirectOrder(tableId, billSessionId, items) {
    if (!tableId || !Array.isArray(items) || items.length === 0) return null;
    const order = {
      id: 'ord_' + Math.random().toString(36).slice(2, 11),
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
    tableMergedInto,
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
    rooms,
    pendingCount,
    inKitchenCount,
    closedBills,
    // helpers
    getTableStatus,
    getTableColorClass,
    getTableColorClassFromStatus,
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
    addTipTransaction,
    simulateNewOrder,
    loadMenu,
    addDirectOrder,
    // table operations
    setBillRequested,
    openTableSession,
    moveTableOrders,
    mergeTableOrders,
    splitTableOrders,
    splitItemsToTable,
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
      'tableMergedInto',
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
    // On first load (no saved state), seed orders with demo data from appConfig.demoOrders.
    // Set appConfig.demoOrders = [] to disable demo mode on a production installation.
    afterHydrate(ctx) {
      if (!ctx.store.orders.length) {
        ctx.store.orders = (appConfig.demoOrders ?? []).map(o => ({ ...o }));
      }
      // Migrate orders loaded from localStorage that may be missing globalNote fields
      for (const ord of ctx.store.orders) {
        if (ord.globalNote === undefined) ord.globalNote = '';
        if (!ord.noteVisibility) ord.noteVisibility = { cassa: true, sala: true, cucina: true };
      }
    },
  },
});
