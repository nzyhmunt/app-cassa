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
  // When a slave is merged, only orders from its current active bill session
  // are physically moved to the master's table field; older-session/historical
  // orders are intentionally left in place to preserve session isolation. The
  // mapping is kept only so the slave shows as "occupied" on the floor plan by
  // delegating its status to the master.
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
    // If merged slave: orders are on the master. Delegate status entirely to master.
    const resolvedMaster = resolveMaster(tableId);
    if (tableMergedInto.value[tableId]) {
      if (resolvedMaster !== tableId) {
        return {
          ...getTableStatus(resolvedMaster),
          isMergedSlave: true,
          masterTableId: resolvedMaster,
        };
      }
      // Cycle detected — degrade gracefully
      return { status: 'free', total: 0, remaining: 0 };
    }

    // Normal (non-slave) table: check its own orders only
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
      delete tableOccupiedAt.value[order.table];
      // Collect all merge mappings to clear in a single spread: slaves of this master +
      // the table itself if it was a slave.
      const idsToUnmap = [
        ...slaveIdsOf(order.table),
        ...(tableMergedInto.value[order.table] ? [order.table] : []),
      ];
      if (idsToUnmap.length > 0) {
        const nextMerge = { ...tableMergedInto.value };
        idsToUnmap.forEach(id => delete nextMerge[id]);
        tableMergedInto.value = nextMerge;
      }
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

  // Resolves a tableId to its ultimate merge master by walking the full chain.
  // If the table is a slave, returns the final master ID; otherwise returns
  // the table ID itself. The visited-set guards against accidental cycles.
  function resolveMaster(tableId) {
    const visited = new Set();
    let currentId = tableId;
    while (tableMergedInto.value[currentId] != null) {
      if (visited.has(currentId)) break; // cycle guard
      visited.add(currentId);
      currentId = tableMergedInto.value[currentId];
    }
    return currentId;
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
    // If the destination is currently a slave, clear its merge mapping so it
    // becomes independent before receiving the moved orders/session state.
    // This must happen before resolving the move target so resolveMaster(toTableId)
    // returns toTableId itself rather than the now-irrelevant old master.
    if (tableMergedInto.value[toTableId]) {
      delete tableMergedInto.value[toTableId];
    }
    // Any slave tables that were merged into the source must now follow the source.
    // Resolve toTableId to its own master first so we never create a slave→slave chain.
    const resolvedMoveTarget = resolveMaster(toTableId);
    const oldSlaveIds = slaveIdsOf(fromTableId);
    oldSlaveIds.forEach(slaveId => {
      tableMergedInto.value = { ...tableMergedInto.value, [slaveId]: resolvedMoveTarget };
    });
    // If the source was itself a slave, detach its old merge mapping.
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
        // Destination already has a session — retag the moved orders and active-session
        // transactions to the destination session so they appear in its payment panel.
        // Historical transactions (other billSessionIds) remain tied to fromTableId
        // to avoid corrupting receipt/history reporting.
        const srcSessionId = tableCurrentBillSession.value[fromTableId].billSessionId;
        const destSessionId = tableCurrentBillSession.value[toTableId].billSessionId;
        // The orders were already moved to toTableId in the first pass above;
        // retag their billSessionId from the source session to the destination session.
        orders.value.forEach(o => {
          if (o.table === toTableId && o.billSessionId === srcSessionId) {
            o.billSessionId = destSessionId;
          }
        });
        // Also retag any source-session transactions that were already pointing to
        // fromTableId (e.g. partial payments made before the move).
        transactions.value.forEach(t => {
          if (t.tableId === fromTableId && t.billSessionId === srcSessionId) {
            t.billSessionId = destSessionId;
            t.tableId = toTableId;
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
    } else {
      // No active session on the source — move any existing transactions (edge case:
      // direct orders placed without opening a billing session).
      transactions.value.forEach(t => {
        if (t.tableId === fromTableId) t.tableId = toTableId;
      });
      // If the destination has an active session, retag the orders that were already
      // moved to toTableId (first pass above) so they appear in its billing totals.
      // Without this, orders with null/stale billSessionId are invisible to getTableStatus().
      const destSession = tableCurrentBillSession.value[toTableId];
      if (destSession) {
        orders.value.forEach(o => {
          if (o.table === toTableId && o.status !== 'completed' && o.status !== 'rejected') {
            o.billSessionId = destSession.billSessionId;
          }
        });
      }
    }
  }

  function mergeTableOrders(sourceTableId, targetTableId) {
    // Resolve chains: if target is itself a slave, adopt its master
    const resolvedTargetId = resolveMaster(targetTableId);

    // Guard: self-map or cycle
    if (sourceTableId === resolvedTargetId) return;

    // Ensure target has an open session
    if (!tableCurrentBillSession.value[resolvedTargetId]) {
      openTableSession(resolvedTargetId);
    }
    const targetSessionId = tableCurrentBillSession.value[resolvedTargetId].billSessionId;

    // Re-parent existing slaves of source to the new master.
    // In the physical-move model, active slave orders should already live on the
    // current master table. Any remaining orders keyed to a slave table are
    // historical and must not be retagged into the new master's active session.
    const srcSlaves = slaveIdsOf(sourceTableId);
    srcSlaves.forEach(slaveId => {
      tableMergedInto.value = { ...tableMergedInto.value, [slaveId]: resolvedTargetId };
    });

    // If source is already a slave (of someone else), detach it first
    delete tableMergedInto.value[sourceTableId];

    // Capture source session BEFORE we delete it
    const srcSession = tableCurrentBillSession.value[sourceTableId];
    const srcSessionId = srcSession?.billSessionId;

    // Physically move source orders from the current session to master table.
    // Orders from older (closed) sessions are left in place to preserve
    // per-session isolation — getTableStatus() filters by billSessionId.
    // When the source has no session entry (orders created without opening a
    // session), only move non-completed active orders; completed orders without
    // a session are historical and must not be pulled into the target session.
    orders.value.forEach(o => {
      if (o.table !== sourceTableId || o.status === 'rejected') return;
      if (srcSessionId) {
        if (o.billSessionId !== srcSessionId) return;
      } else {
        if (o.status === 'completed') return;
      }
      o.table = resolvedTargetId;
      o.billSessionId = targetSessionId;
    });

    // Move current-session transactions to master
    if (srcSessionId) {
      transactions.value.forEach(t => {
        if (t.tableId === sourceTableId && t.billSessionId === srcSessionId) {
          t.tableId = resolvedTargetId;
          t.billSessionId = targetSessionId;
        }
      });
    }

    // Preserve earliest occupiedAt on master, then clear the source
    if (tableOccupiedAt.value[sourceTableId]) {
      const srcTime = tableOccupiedAt.value[sourceTableId];
      const tgtTime = tableOccupiedAt.value[resolvedTargetId];
      if (!tgtTime || new Date(srcTime) < new Date(tgtTime)) {
        tableOccupiedAt.value[resolvedTargetId] = srcTime;
      }
      delete tableOccupiedAt.value[sourceTableId];
    }
    // Also clear stale occupiedAt for any re-parented slaves (they hold no orders)
    srcSlaves.forEach(slaveId => {
      delete tableOccupiedAt.value[slaveId];
    });

    // Combine headcounts on master session
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
      const next = { ...tableCurrentBillSession.value };
      delete next[sourceTableId];
      tableCurrentBillSession.value = next;
    }

    // Clear bill request on source
    billRequestedTables.value.delete(sourceTableId);
    billRequestedTables.value = new Set(billRequestedTables.value);

    // Record merge relationship (slave shows as "occupied" on floor plan via master)
    tableMergedInto.value = { ...tableMergedInto.value, [sourceTableId]: resolvedTargetId };
  }

  // Detaches a slave table from a merged group and, if the slave already has active
  // orders on it (moved there by splitItemsToTable), opens a fresh session for it.
  // Note: splitItemsToTable() handles slave detachment automatically when the target
  // is a merged slave, so this function is rarely needed directly.
  function splitTableOrders(masterTableId, slaveTableId) {
    if (tableMergedInto.value[slaveTableId] !== masterTableId) return;

    // Remove the merge mapping
    const next = { ...tableMergedInto.value };
    delete next[slaveTableId];
    tableMergedInto.value = next;

    // If the slave has any active orders (moved there by splitItemsToTable), open a fresh session
    const slaveHasOrders = orders.value.some(
      o => o.table === slaveTableId && o.status !== 'completed' && o.status !== 'rejected',
    );
    if (slaveHasOrders) {
      const newSessionId = openTableSession(slaveTableId, 0, 0);
      orders.value.forEach(o => {
        if (o.table === slaveTableId && o.status !== 'completed' && o.status !== 'rejected') {
          o.billSessionId = newSessionId;
        }
      });
    }
  }

  /**
   * Moves selected item quantities from one table to another at the item level.
   *
   * - itemQtyMap: { key: qtyToMove } where key = `${orderId}__${itemUid}`
   * - When the target is a merged slave of the source, it is automatically detached
   *   from the merge group before items are moved (no need to call splitTableOrders first).
   * - When ALL active items of a source order are selected, the order is physically
   *   relocated (table + billSessionId changed) to avoid creating a fully-voided
   *   "storno" order on the source table.
   * - When only SOME items of a source order are selected, the selected quantities
   *   are voided on the source and a new direct order is created on the target.
   * - The target table gets a billing session if it doesn't already have one.
   * - When all active orders are moved away from source, its session state is cleaned up.
   *
   * @param {string} sourceTableId
   * @param {string} targetTableId
   * @param {object} itemQtyMap  { key: qtyToMove }
   * @returns {boolean} true if any items were moved
   */
  function splitItemsToTable(sourceTableId, targetTableId, itemQtyMap) {
    if (!sourceTableId || !targetTableId || sourceTableId === targetTableId) return false;

    // If the target is currently merged as a slave of the source, detach it so it
    // can receive its own session and become independent.
    // If the target is a slave of a *different* master, refuse — moving orders there
    // would corrupt the other merge group's billing state.
    const targetMaster = tableMergedInto.value[targetTableId];
    if (targetMaster) {
      if (targetMaster !== sourceTableId) return false;
      const next = { ...tableMergedInto.value };
      delete next[targetTableId];
      tableMergedInto.value = next;
    }

    // Pre-scan: verify at least one item key actually matches an active order item and
    // has a positive quantity to move. This prevents opening an orphan billing session
    // on the target when itemQtyMap contains only non-matching keys or all-zero values.
    const hasValidItemsToMove = orders.value.some(ord => {
      if (ord.table !== sourceTableId) return false;
      if (ord.status === 'completed' || ord.status === 'rejected') return false;
      return ord.orderItems.some(item => {
        const netQty = item.quantity - (item.voidedQuantity || 0);
        if (netQty <= 0) return false;
        const key = `${ord.id}__${item.uid}`;
        return Math.min(Math.max(0, Math.floor(itemQtyMap[key] || 0)), netQty) > 0;
      });
    });
    if (!hasValidItemsToMove) return false;

    // Ensure target has a billing session; open one if the table is free.
    let targetSession = tableCurrentBillSession.value[targetTableId];
    if (!targetSession) {
      if (getTableStatus(targetTableId).status !== 'free') return false;
      openTableSession(targetTableId);
      targetSession = tableCurrentBillSession.value[targetTableId];
    }
    if (!targetSession?.billSessionId) return false;
    const targetSessionId = targetSession.billSessionId;

    let anyMoved = false;
    // Items from orders that are only partially moved (void-and-copy strategy).
    const partialMoveItems = [];

    orders.value.forEach(ord => {
      if (ord.table !== sourceTableId) return;
      if (ord.status === 'completed' || ord.status === 'rejected') return;

      // Determine which items to move and how many active units are in this order.
      const moves = []; // { item, actualMoveQty, netQty }
      let totalActiveInOrder = 0;
      let totalMovingFromOrder = 0;

      ord.orderItems.forEach(item => {
        const netQty = item.quantity - (item.voidedQuantity || 0);
        if (netQty <= 0) return;
        totalActiveInOrder += netQty;

        const key = `${ord.id}__${item.uid}`;
        const moveQty = Math.max(0, Math.floor(itemQtyMap[key] || 0));
        const actualMoveQty = Math.min(moveQty, netQty);
        totalMovingFromOrder += actualMoveQty;

        if (actualMoveQty > 0) {
          moves.push({ item, actualMoveQty, netQty });
        }
      });

      if (moves.length === 0) return; // nothing to move from this order

      anyMoved = true;

      if (totalMovingFromOrder === totalActiveInOrder) {
        // ALL active items of this order are being moved: physically relocate the order
        // to avoid leaving a fully-voided "storno" order on the source table.
        ord.table = targetTableId;
        ord.billSessionId = targetSessionId;
      } else {
        // PARTIAL move: void selected items on source and collect copies for the target.
        moves.forEach(({ item, actualMoveQty, netQty }) => {
          item.voidedQuantity = (item.voidedQuantity || 0) + actualMoveQty;

          // The number of active item units remaining on the source after the split.
          // Modifier voidedQuantity is distributed so the combined pricing stays invariant:
          // target gets max(0, mod.voidedQuantity - sourceActiveAfter) voided modifier
          // units, which ensures source_charge + target_charge === original_charge.
          const sourceActiveAfterSplit = netQty - actualMoveQty;

          // Build a copy of the item (with all its modifiers) for the target order.
          // Use the same crypto.randomUUID strategy as openTableSession for consistent UID generation.
          const newUid = (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : 'spl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
          partialMoveItems.push({
            uid: newUid,
            dishId: item.dishId ?? null,
            name: item.name,
            unitPrice: item.unitPrice,
            quantity: actualMoveQty,
            voidedQuantity: 0,
            notes: item.notes ? [...item.notes] : [],
            modifiers: (item.modifiers || []).map(m => ({
              ...m,
              voidedQuantity: Math.max(0, (m.voidedQuantity || 0) - sourceActiveAfterSplit),
            })),
          });
        });
        updateOrderTotals(ord);
      }
    });

    if (!anyMoved) return false;

    // Create a single direct order on the target for all partially-moved items.
    if (partialMoveItems.length > 0) {
      addDirectOrder(targetTableId, targetSessionId, partialMoveItems);
    }

    // Mark target as occupied if it wasn't already.
    if (!tableOccupiedAt.value[targetTableId]) {
      tableOccupiedAt.value[targetTableId] = new Date().toISOString();
    }

    // If the source has no more active orders (all were physically relocated), clean up
    // its session state so it returns to a proper free state.
    // Also retag any current-session transactions to the target so that partial payments
    // made before the move are not left orphaned on the now-free source table.
    const sourceStillHasOrders = orders.value.some(
      o => o.table === sourceTableId && o.status !== 'completed' && o.status !== 'rejected',
    );
    if (!sourceStillHasOrders) {
      const srcSessionId = tableCurrentBillSession.value[sourceTableId]?.billSessionId;
      if (srcSessionId) {
        // Direct in-place mutation is safe here: transactions.value is a reactive Pinia ref
        // and Vue tracks property changes on array items. This is the same pattern used
        // throughout the store (e.g., mergeTableOrders, moveTableOrders).
        transactions.value.forEach(t => {
          if (t.tableId === sourceTableId && t.billSessionId === srcSessionId) {
            t.tableId = targetTableId;
            t.billSessionId = targetSessionId;
          }
        });
      }
      delete tableOccupiedAt.value[sourceTableId];
      const nextSession = { ...tableCurrentBillSession.value };
      delete nextSession[sourceTableId];
      tableCurrentBillSession.value = nextSession;
      billRequestedTables.value.delete(sourceTableId);
      billRequestedTables.value = new Set(billRequestedTables.value);

      // Keep merge state consistent with the table becoming fully free:
      // - if sourceTableId is a master, detach all of its slaves
      // - if sourceTableId is itself a slave, detach it from its master
      if (typeof tableMergedInto !== 'undefined' && tableMergedInto?.value) {
        const nextMergedInto = { ...tableMergedInto.value };
        if (typeof slaveIdsOf === 'function') {
          slaveIdsOf(sourceTableId).forEach(slaveTableId => {
            delete nextMergedInto[slaveTableId];
          });
        }
        delete nextMergedInto[sourceTableId];
        tableMergedInto.value = nextMergedInto;
      }
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
