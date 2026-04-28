/**
 * @file store/persistence/operations.js
 * @description Persistence helpers for operational state
 * (orders, transactions, cash, bill sessions, print log, table occupancy).
 */

import { getDB } from '../../composables/useIDB.js';
import { emitIDBChange } from './eventBus.js';
import { appConfig } from '../../utils/index.js';
import { PIN_LENGTH } from '../../utils/pinAuth.js';
import { normalizeAppsArray } from '../../utils/userRoles.js';
import { newUUIDv7 } from '../storeUtils.js';
import { touchStorageKey } from '../persistence.js';
import {
  parseJsonArray,
  relationId as _relationId,
  replaceAll as _replaceAll,
  replaceAllSerialized as _replaceAllSerialized,
  normalizeTableCurrentBillSession as _normalizeTableCurrentBillSession,
  hashPinForLocalAuth as _hashPinForLocalAuth,
  extractPinDigits as _extractPinDigits,
} from './_shared.js';

// ── normalizeIncomingSync — FK + JSON normalization for Directus records ──────

function _normalizeIncomingSync(collection, record) {
  if (!record || typeof record !== 'object') return record;
  const normalized = { ...record };
  if (collection === 'order_items') {
    const orderId = _relationId(normalized.order ?? normalized.orderId);
    if (orderId != null) {
      normalized.order = orderId;
      normalized.orderId = orderId;
    }
    const dishId = _relationId(normalized.dish ?? normalized.dishId);
    if (dishId != null) {
      normalized.dish = dishId;
      normalized.dishId = dishId;
    }
  } else if (collection === 'order_item_modifiers') {
    const orderItem = _relationId(normalized.order_item ?? normalized.orderItemId);
    if (orderItem != null) {
      normalized.order_item = orderItem;
      normalized.orderItemId = orderItem;
    }
    const orderId = _relationId(normalized.order ?? normalized.orderId);
    if (orderId != null) {
      normalized.order = orderId;
      normalized.orderId = orderId;
    }
    if (normalized.item_uid == null && normalized.itemUid != null) normalized.item_uid = normalized.itemUid;
    if (normalized.itemUid == null && normalized.item_uid != null) normalized.itemUid = normalized.item_uid;
  } else if (collection === 'table_merge_sessions') {
    const slave = _relationId(normalized.slave_table);
    const master = _relationId(normalized.master_table);
    const venue = _relationId(normalized.venue);
    if (slave != null) normalized.slave_table = slave;
    if (master != null) normalized.master_table = master;
    if (venue != null) normalized.venue = venue;
  } else if (collection === 'menu_items') {
    normalized.ingredients = parseJsonArray(normalized.ingredients);
    normalized.allergens = parseJsonArray(normalized.allergens);
  } else if (collection === 'printers') {
    normalized.print_types = parseJsonArray(normalized.print_types);
    normalized.categories = parseJsonArray(normalized.categories);
  } else if (collection === 'venue_users') {
    if ((normalized.name == null || normalized.name === '') && normalized.display_name != null) {
      normalized.name = normalized.display_name;
    }
    if ((normalized.display_name == null || normalized.display_name === '') && normalized.name != null) {
      normalized.display_name = normalized.name;
    }
    normalized.apps = normalizeAppsArray(normalized.apps);
    delete normalized.role;
    delete normalized.role2;
  }
  return normalized;
}

async function _normalizeIncoming(collection, record) {
  const normalized = _normalizeIncomingSync(collection, record);
  if (collection !== 'venue_users' || !normalized || typeof normalized !== 'object') return normalized;

  const pinType = typeof normalized.pin;
  const isPinScalar = pinType === 'string' || pinType === 'number';
  if (normalized.pin != null && isPinScalar) {
    const trimmedPin = String(normalized.pin).trim();
    const pinDigits = _extractPinDigits(trimmedPin);
    let normalizedPin = '';
    if (pinDigits.length === PIN_LENGTH) {
      try {
        normalizedPin = await _hashPinForLocalAuth(pinDigits);
      } catch (err) {
        console.warn('[IDBPersistence] Failed to hash venue_users PIN during sync. Clearing local PIN value for security. User ID:', normalized.id ?? 'unknown', err);
        normalizedPin = null;
      }
    }
    if (normalizedPin == null) {
      normalized.pin = '';
    } else if (normalizedPin === '') {
      console.warn(`[IDBPersistence] Invalid venue_users PIN during sync - could not extract ${PIN_LENGTH} numeric digits. User ID:`, normalized.id ?? 'unknown');
      normalized.pin = '';
    } else {
      normalized.pin = normalizedPin;
    }
  } else if (normalized.pin != null) {
    console.warn('[IDBPersistence] Invalid venue_users PIN type during sync (received:', pinType, '). Clearing local PIN value. User ID:', normalized.id ?? 'unknown');
    normalized.pin = '';
  }

  return normalized;
}

// ── Load ──────────────────────────────────────────────────────────────────────

/**
 * Loads all persisted operational state from IndexedDB.
 * Returns an object with the same shape as the Pinia store's persisted fields.
 * Returns `null` if the DB is not available (SSR / test environments without IDB).
 *
 * @returns {Promise<object|null>}
 */
export async function loadStateFromIDB() {
  try {
    const db = await getDB();

    const [
      orders,
      transactions,
      cashMovements,
      dailyClosures,
      printLogRaw,
      billSessions,
      cashBalanceRecord,
      tableCurrentBillSessionRecord,
      tableMergeRecords,
      tableOccupiedAtRecord,
      billRequestedTablesRecord,
    ] = await Promise.all([
      db.getAll('orders'),
      db.getAll('transactions'),
      db.getAll('cash_movements'),
      db.getAll('daily_closures'),
      db.getAll('print_jobs'),
      db.getAllFromIndex('bill_sessions', 'status', 'open'),
      db.get('app_meta', 'cashBalance'),
      db.get('app_meta', 'tableCurrentBillSession'),
      db.getAll('table_merge_sessions'),
      db.get('app_meta', 'tableOccupiedAt'),
      db.get('app_meta', 'billRequestedTables'),
    ]);

    const printLog = printLogRaw.map(({ payload: _p, ...rest }) => rest);

    let tableCurrentBillSession = _normalizeTableCurrentBillSession(tableCurrentBillSessionRecord?.value ?? {});
    if (billSessions.length > 0) {
      const fromIDB = {};
      for (const s of billSessions) {
        if (!s.table) continue;
        fromIDB[s.table] = {
          billSessionId: s.id,
          adults: s.adults ?? 0,
          children: s.children ?? 0,
          table: s.table,
          status: s.status,
          opened_at: s.opened_at ?? null,
        };
      }
      tableCurrentBillSession = { ...tableCurrentBillSession, ...fromIDB };
    }

    return {
      orders,
      transactions,
      cashBalance: cashBalanceRecord?.cashBalance ?? 0,
      cashMovements,
      dailyClosures,
      printLog,
      tableCurrentBillSession,
      tableMergedInto: Object.fromEntries(tableMergeRecords.map(r => [r.slave_table, r.master_table])),
      tableOccupiedAt: tableOccupiedAtRecord?.value ?? {},
      billRequestedTables: new Set(billRequestedTablesRecord?.value ?? []),
    };
  } catch (e) {
    console.warn('[IDBPersistence] Failed to load state:', e);
    return null;
  }
}

// ── Save — bulk ───────────────────────────────────────────────────────────────

/**
 * Persists Pinia store state slices to their respective IndexedDB ObjectStores.
 * Only stores whose key is **present** in the `state` object are written —
 * absent keys are silently skipped, so callers can pass a partial payload
 * without wiping unrelated stores.
 *
 * @param {{
 *   orders?: Array,
 *   transactions?: Array,
 *   cashBalance?: number,
 *   cashMovements?: Array,
 *   dailyClosures?: Array,
 *   printLog?: Array,
 *   tableCurrentBillSession?: object,
 *   tableMergedInto?: object,
 *   tableOccupiedAt?: object,
 *   billRequestedTables?: Set|Array,
 * }} state
 */
export async function saveStateToIDB(state) {
  try {
    const db = await getDB();
    const ops = [];
    // Serialize each field once so the same payload drives both the IDB write
    // and the event-bus emission. JSON.parse(JSON.stringify(...)) is safe with
    // Vue reactive proxies (structuredClone throws DataCloneError on proxies)
    // and matches the semantics of the IDB write path.
    const ser = (v) => JSON.parse(JSON.stringify(v));
    const sanitized = {};

    if ('orders' in state) {
      const v = ser(state.orders ?? []);
      sanitized.orders = v;
      ops.push(_replaceAllSerialized(db, 'orders', v));
    }
    if ('transactions' in state) {
      const v = ser(state.transactions ?? []);
      sanitized.transactions = v;
      ops.push(_replaceAllSerialized(db, 'transactions', v));
    }
    if ('cashMovements' in state) {
      const v = ser(state.cashMovements ?? []);
      sanitized.cashMovements = v;
      ops.push(_replaceAllSerialized(db, 'cash_movements', v));
    }
    if ('dailyClosures' in state) {
      const v = ser(state.dailyClosures ?? []);
      sanitized.dailyClosures = v;
      ops.push(_replaceAllSerialized(db, 'daily_closures', v));
    }
    if ('printLog' in state) {
      // printLog is NOT emitted on the bus: the IDB-persisted form strips
      // entry.payload (needed for reprint), so the in-memory ref must stay
      // intact.  Persisted via the normal watcher → _scheduleSave path.
      const printLogToStore = (state.printLog ?? [])
        .slice(0, 200)
        .map(({ payload: _p, ...rest }) => rest);
      ops.push(_replaceAll(db, 'print_jobs', printLogToStore));
    }
    if ('cashBalance' in state) {
      const v = ser(state.cashBalance ?? 0);
      sanitized.cashBalance = v;
      ops.push(db.put('app_meta', { id: 'cashBalance', cashBalance: v }));
    }
    if ('tableCurrentBillSession' in state) {
      const v = ser(state.tableCurrentBillSession ?? {});
      sanitized.tableCurrentBillSession = v;
      ops.push(db.put('app_meta', { id: 'tableCurrentBillSession', value: v }));
    }
    if ('tableMergedInto' in state) {
      // Emit the raw merge-map on the bus (serialized once for safety).
      // The actual IDB write transforms it into normalized table_merge_sessions
      // records via the async IIFE below; the two paths are intentionally separate.
      sanitized.tableMergedInto = ser(state.tableMergedInto ?? {});
      const now = new Date().toISOString();
      ops.push((async () => {
        const tx = db.transaction(['table_merge_sessions', 'app_meta'], 'readwrite');
        const mergeStore = tx.objectStore('table_merge_sessions');
        const existingRecords = await mergeStore.getAll();
        const existingBySlave = new Map(
          existingRecords
            .filter((record) => record?.slave_table)
            .map((record) => [record.slave_table, record]),
        );
        const records = Object.entries(state.tableMergedInto ?? {})
          .filter(([slave, master]) => slave && master)
          .map(([slave, master]) => {
            const existing = existingBySlave.get(slave);
            return {
              id: existing?.id ?? newUUIDv7(),
              slave_table: slave,
              master_table: master,
              venue: appConfig.directus?.venueId ?? existing?.venue ?? null,
              merged_at: existing?.merged_at ?? now,
              date_updated: now,
            };
          });
        await mergeStore.clear();
        await Promise.all(records.map(r => mergeStore.put(JSON.parse(JSON.stringify(r)))));
        await tx.objectStore('app_meta').delete('tableMergedInto');
        await tx.done;
      })());
    }
    if ('tableOccupiedAt' in state) {
      const v = ser(state.tableOccupiedAt ?? {});
      sanitized.tableOccupiedAt = v;
      ops.push(db.put('app_meta', { id: 'tableOccupiedAt', value: v }));
    }
    if ('billRequestedTables' in state) {
      const v = ser(
        state.billRequestedTables instanceof Set
          ? Array.from(state.billRequestedTables)
          : Array.isArray(state.billRequestedTables)
            ? state.billRequestedTables
            : []
      );
      sanitized.billRequestedTables = v;
      ops.push(db.put('app_meta', { id: 'billRequestedTables', value: v }));
    }

    await Promise.all(ops);
    touchStorageKey();
    emitIDBChange(sanitized);
  } catch (e) {
    console.warn('[IDBPersistence] Failed to save state:', e);
    throw e;
  }
}

// ── Atomic orders + occupancy write ──────────────────────────────────────────

/**
 * Persists a new orders array and the tableOccupiedAt map inside a single
 * IDB transaction spanning both the `orders` and `app_meta` object stores.
 *
 * @param {Array}  orders          - Full projected orders array (including the new order).
 * @param {object} tableOccupiedAt - Projected table-occupancy timestamp map.
 */
export async function saveOrdersAndOccupancyInIDB(orders, tableOccupiedAt) {
  try {
    const db = await getDB();
    const tx = db.transaction(['orders', 'app_meta'], 'readwrite');
    const ordersStore = tx.objectStore('orders');
    const metaStore = tx.objectStore('app_meta');
    await ordersStore.clear();
    // Serialize each order once; the same plain objects are written to IDB and
    // emitted on the bus so there is no second JSON round-trip.
    const serializedOrders = (orders ?? []).map(r => JSON.parse(JSON.stringify(r)));
    await Promise.all(serializedOrders.map(r => ordersStore.put(r)));
    const serializedTableOccupiedAt = JSON.parse(JSON.stringify(tableOccupiedAt ?? {}));
    await metaStore.put({ id: 'tableOccupiedAt', value: serializedTableOccupiedAt });
    await tx.done;
    touchStorageKey();
    emitIDBChange({ orders: serializedOrders, tableOccupiedAt: serializedTableOccupiedAt });
  } catch (e) {
    console.warn('[IDBPersistence] saveOrdersAndOccupancyInIDB failed:', e);
    throw e;
  }
}

// ── bill_sessions fine-grained writes ────────────────────────────────────────

/**
 * Writes (upserts) a single bill_session record to the `bill_sessions` ObjectStore.
 *
 * @param {{ billSessionId: string, table: string, adults?: number, children?: number, status?: string, opened_at?: string|null, venue?: string|null }} session
 */
export async function upsertBillSessionInIDB(session) {
  try {
    const db = await getDB();
    await db.put('bill_sessions', JSON.parse(JSON.stringify({
      id: session.billSessionId,
      table: session.table,
      adults: session.adults ?? 0,
      children: session.children ?? 0,
      status: session.status ?? 'open',
      opened_at: session.opened_at ?? null,
      ...(session.venue != null ? { venue: session.venue } : {}),
    })));
    touchStorageKey();
  } catch (e) {
    console.warn('[IDBPersistence] Failed to upsert bill_session:', e);
    throw e;
  }
}

/**
 * Marks an existing bill_session record as `closed` in the `bill_sessions` ObjectStore.
 *
 * @param {string} billSessionId
 */
export async function closeBillSessionInIDB(billSessionId) {
  try {
    const db = await getDB();
    const existing = await db.get('bill_sessions', billSessionId);
    if (existing) {
      await db.put('bill_sessions', { ...existing, status: 'closed', closed_at: new Date().toISOString() });
      touchStorageKey();
    }
  } catch (e) {
    console.warn('[IDBPersistence] Failed to close bill_session in IDB:', e);
    throw e;
  }
}

// ── Directus sync writes ──────────────────────────────────────────────────────

/**
 * Batch-upserts Directus records into the given IDB ObjectStore.
 *
 * By default only inserts/replaces a record when the incoming timestamp is
 * strictly greater than the stored one. The effective timestamp is
 * `date_updated ?? date_created` so that records created but never patched
 * (where Directus leaves `date_updated = null`) are compared correctly against
 * existing ones instead of unconditionally overwriting them.
 * This implements the last-write-wins conflict resolution described in §5.7.4.
 *
 * Pass `{ forceWrite: true }` to bypass the timestamp check and unconditionally
 * overwrite every incoming record.
 *
 * @param {string} storeName   - IDB ObjectStore name
 * @param {Array<object>} records - Records received from Directus
 * @param {{ forceWrite?: boolean }} [options]
 * @returns {Promise<number>} Number of records actually written
 */
export async function upsertRecordsIntoIDB(storeName, records, { forceWrite = false } = {}) {
  if (!records || records.length === 0) return 0;

  const keyPath = 'id';

  try {
    const db = await getDB();

    if (!db.objectStoreNames.contains(storeName)) {
      console.warn('[IDBPersistence] upsertRecordsIntoIDB: unknown ObjectStore:', storeName);
      return 0;
    }

    const toWrite = [];
    if (forceWrite) {
      for (const incomingRaw of records) {
        const incoming = _normalizeIncomingSync(storeName, incomingRaw);
        if (!incoming || typeof incoming !== 'object') continue;
        const pk = incoming[keyPath];
        if (!pk) continue;
        const { _sync_status: _s, ...clean } = incoming;
        toWrite.push(clean);
      }
    } else {
      const roTx = db.transaction(storeName, 'readonly');
      for (const incomingRaw of records) {
        const incoming = _normalizeIncomingSync(storeName, incomingRaw);
        if (!incoming || typeof incoming !== 'object') continue;
        const pk = incoming[keyPath];
        if (!pk) continue;
        const existing = await roTx.store.get(pk);
        if (existing) {
          // Last-write-wins: compare using date_updated, falling back to date_created
          // for records that were created but never patched (date_updated = null in Directus).
          const existingTs = existing.date_updated ?? existing.date_created;
          const incomingTs = incoming.date_updated ?? incoming.date_created;
          if (existingTs && incomingTs && new Date(incomingTs) <= new Date(existingTs)) {
            continue;
          }
        }
        const { _sync_status: _s, ...clean } = incoming;
        toWrite.push(clean);
      }
      await roTx.done;
    }

    if (toWrite.length === 0) return 0;

    let recordsToWrite = toWrite;
    if (storeName === 'venue_users') {
      const normalizedVenueUsers = [];
      for (const record of toWrite) {
        const normalized = await _normalizeIncoming(storeName, record);
        if (!normalized || typeof normalized !== 'object') continue;
        normalizedVenueUsers.push(normalized);
      }
      recordsToWrite = normalizedVenueUsers;
    }

    const tx = db.transaction(storeName, 'readwrite');
    for (const record of recordsToWrite) {
      await tx.store.put(record);
    }
    await tx.done;
    touchStorageKey();
    return recordsToWrite.length;
  } catch (e) {
    console.warn('[IDBPersistence] Failed to upsert into', storeName, e);
    return 0;
  }
}

/**
 * Deletes records from an ObjectStore by primary key.
 * Used for realtime delete events from Directus.
 *
 * @param {string} storeName
 * @param {Array<string|number>} keys
 * @returns {Promise<number>} number of deleted keys attempted
 */
export async function deleteRecordsFromIDB(storeName, keys) {
  if (!Array.isArray(keys) || keys.length === 0) return 0;
  try {
    const db = await getDB();
    if (!db.objectStoreNames.contains(storeName)) return 0;
    const tx = db.transaction(storeName, 'readwrite');
    for (const key of keys) {
      if (key == null) continue;
      await tx.store.delete(key);
    }
    await tx.done;
    touchStorageKey();
    return keys.length;
  } catch (e) {
    console.warn('[IDBPersistence] Failed to delete records from', storeName, e);
    return 0;
  }
}


// ── Backward-compat re-exports ────────────────────────────────────────────────
// These functions were moved to dedicated modules during the Step 5 refactoring.
// Re-exported here so that existing tests that spy on `persistence/operations.*`
// continue to work without modification.
export {
  loadUsersFromIDB, saveUsersToIDB,
  loadAuthSessionFromIDB, saveAuthSessionToIDB,
  loadAuthSettingsFromIDB, saveAuthSettingsToIDB,
} from './auth.js';

export {
  loadSettingsFromIDB,
  saveSettingsToIDB,
  loadCustomItemsFromIDB,
  saveCustomItemsToIDB,
  loadJsonMenuFromIDB,
  saveJsonMenuToIDB,
} from './settings.js';
export { deleteDatabase, clearAllStateFromIDB, clearSyncQueueFromIDB } from './reset.js';
