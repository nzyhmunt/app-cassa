/**
 * @file store/idbPersistence.js
 * @description IndexedDB-based persistence helpers for the Pinia store.
 *
 * Replaces `pinia-plugin-persistedstate` + localStorage with structured
 * IndexedDB ObjectStores as defined in DATABASE_SCHEMA.md §5.6.
 *
 * Architecture:
 *  - loadStateFromIDB()   — called once at app startup to hydrate the Pinia store
 *  - saveStateToIDB(state) — called (debounced/watched) whenever state changes
 *  - Individual save helpers for fine-grained writes triggered by mutations
 */

import { getDB } from '../composables/useIDB.js';
import { appConfig } from '../utils/index.js';

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Replaces all records in an ObjectStore with the provided array.
 * Uses a readwrite transaction for atomicity.
 * @param {import('idb').IDBPDatabase} db
 * @param {string} storeName
 * @param {Array} records
 */
async function _replaceAll(db, storeName, records) {
  const tx = db.transaction(storeName, 'readwrite');
  await tx.store.clear();
  // JSON round-trip strips Vue reactive proxies before IndexedDB's structuredClone.
  await Promise.all(records.map(r => tx.store.put(JSON.parse(JSON.stringify(r)))));
  await tx.done;
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
      tableState,
      cashBalanceRecord,
    ] = await Promise.all([
      db.getAll('orders'),
      db.getAll('transactions'),
      db.getAll('cash_movements'),
      db.getAll('daily_closures'),
      db.getAll('print_jobs'),
      db.get('app_meta', 'tableState'),
      db.get('app_meta', 'cashBalance'),
    ]);

    // printLog: strip payload field (same behaviour as the old localStorage serialiser)
    const printLog = printLogRaw.map(({ payload: _p, ...rest }) => rest);

    const ts = tableState ?? {};

    return {
      orders,
      transactions,
      cashBalance: cashBalanceRecord?.cashBalance ?? 0,
      cashMovements,
      dailyClosures,
      printLog,
      tableCurrentBillSession: ts.tableCurrentBillSession ?? {},
      tableMergedInto: ts.tableMergedInto ?? {},
      tableOccupiedAt: ts.tableOccupiedAt ?? {},
      billRequestedTables: new Set(ts.billRequestedTables ?? []),
    };
  } catch (e) {
    console.warn('[IDBPersistence] Failed to load state:', e);
    return null;
  }
}

// ── Save — bulk ───────────────────────────────────────────────────────────────

/**
 * Persists all Pinia store arrays to their respective ObjectStores.
 * Called by the debounced watcher in the store; individual mutation helpers
 * are called for targeted writes triggered by specific actions.
 *
 * @param {{
 *   orders: Array,
 *   transactions: Array,
 *   cashBalance: number,
 *   cashMovements: Array,
 *   dailyClosures: Array,
 *   printLog: Array,
 *   tableCurrentBillSession: object,
 *   tableMergedInto: object,
 *   tableOccupiedAt: object,
 *   billRequestedTables: Set,
 * }} state
 */
export async function saveStateToIDB(state) {
  try {
    const db = await getDB();

    // Strip payload from printLog entries before persisting (same as old serialiser)
    const printLogToStore = (state.printLog ?? [])
      .slice(0, 200)
      .map(({ payload: _p, ...rest }) => rest);

    await Promise.all([
      _replaceAll(db, 'orders', state.orders ?? []),
      _replaceAll(db, 'transactions', state.transactions ?? []),
      _replaceAll(db, 'cash_movements', state.cashMovements ?? []),
      _replaceAll(db, 'daily_closures', state.dailyClosures ?? []),
      _replaceAll(db, 'print_jobs', printLogToStore),
      db.put('app_meta', JSON.parse(JSON.stringify({
        id: 'tableState',
        tableCurrentBillSession: state.tableCurrentBillSession ?? {},
        tableMergedInto: state.tableMergedInto ?? {},
        tableOccupiedAt: state.tableOccupiedAt ?? {},
        billRequestedTables: state.billRequestedTables instanceof Set
          ? Array.from(state.billRequestedTables)
          : Array.isArray(state.billRequestedTables)
            ? state.billRequestedTables
            : [],
      }))),
      db.put('app_meta', JSON.parse(JSON.stringify({
        id: 'cashBalance',
        cashBalance: state.cashBalance ?? 0,
      }))),
    ]);
  } catch (e) {
    console.warn('[IDBPersistence] Failed to save state:', e);
  }
}

// ── Settings ──────────────────────────────────────────────────────────────────

const SETTINGS_RECORD_ID = 'local';

/**
 * Loads app settings from the `app_settings` ObjectStore.
 * @returns {Promise<object|null>}
 */
export async function loadSettingsFromIDB() {
  try {
    const db = await getDB();
    const record = await db.get('app_settings', SETTINGS_RECORD_ID);
    return record ?? null;
  } catch (e) {
    console.warn('[IDBPersistence] Failed to load settings:', e);
    return null;
  }
}

/**
 * Persists app settings to the `app_settings` ObjectStore.
 * @param {object} settings
 */
export async function saveSettingsToIDB(settings) {
  try {
    const db = await getDB();
    await db.put('app_settings', JSON.parse(JSON.stringify({ id: SETTINGS_RECORD_ID, ...settings })));
  } catch (e) {
    console.warn('[IDBPersistence] Failed to save settings:', e);
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

/**
 * Loads manual (non-appConfig) users from the `venue_users` ObjectStore.
 * Each record has a `_type: 'manual_user'` discriminator to distinguish from
 * future venue-user records that may come from Directus.
 * @returns {Promise<Array>}
 */
export async function loadUsersFromIDB() {
  try {
    const db = await getDB();
    const all = await db.getAll('venue_users');
    return all.filter(r => r._type === 'manual_user');
  } catch (e) {
    console.warn('[IDBPersistence] Failed to load users:', e);
    return [];
  }
}

/**
 * Persists the full list of manual users to IDB.
 * Replaces only records with `_type: 'manual_user'`.
 * @param {Array} users
 */
export async function saveUsersToIDB(users) {
  try {
    const db = await getDB();
    const tx = db.transaction('venue_users', 'readwrite');
    // Remove all existing manual user records
    const existing = await tx.store.getAll();
    await Promise.all(
      existing
        .filter(r => r._type === 'manual_user')
        .map(r => tx.store.delete(r.id)),
    );
    // Write new list — JSON round-trip strips Vue reactive proxies before
    // IndexedDB's structuredClone so the put() never throws a DataCloneError.
    await Promise.all(users.map(u => {
      const plain = JSON.parse(JSON.stringify({ ...u, _type: 'manual_user' }));
      return tx.store.put(plain);
    }));
    await tx.done;
  } catch (e) {
    console.warn('[IDBPersistence] Failed to save users:', e);
  }
}

/**
 * Loads the persisted auth session from `app_meta`.
 * @returns {Promise<string|null>} userId or null
 */
export async function loadAuthSessionFromIDB() {
  try {
    const db = await getDB();
    const record = await db.get('app_meta', 'auth_session');
    return record?.userId ?? null;
  } catch (e) {
    console.warn('[IDBPersistence] Failed to load auth session:', e);
    return null;
  }
}

/**
 * Persists the auth session userId to `app_meta`.
 * @param {string|null} userId
 */
export async function saveAuthSessionToIDB(userId) {
  try {
    const db = await getDB();
    if (userId == null) {
      await db.delete('app_meta', 'auth_session');
    } else {
      await db.put('app_meta', { id: 'auth_session', userId });
    }
  } catch (e) {
    console.warn('[IDBPersistence] Failed to save auth session:', e);
  }
}

/**
 * Loads auth settings from `app_meta`.
 * @returns {Promise<{lockTimeoutMinutes: number}>}
 */
export async function loadAuthSettingsFromIDB() {
  try {
    const db = await getDB();
    const record = await db.get('app_meta', 'auth_settings');
    return record ?? { lockTimeoutMinutes: 5 };
  } catch (e) {
    console.warn('[IDBPersistence] Failed to load auth settings:', e);
    return { lockTimeoutMinutes: 5 };
  }
}

/**
 * Persists auth settings to `app_meta`.
 * @param {{lockTimeoutMinutes: number}} settings
 */
export async function saveAuthSettingsToIDB(settings) {
  try {
    const db = await getDB();
    await db.put('app_meta', JSON.parse(JSON.stringify({ id: 'auth_settings', ...settings })));
  } catch (e) {
    console.warn('[IDBPersistence] Failed to save auth settings:', e);
  }
}

// ── Direct custom items ───────────────────────────────────────────────────────

const CUSTOM_ITEMS_RECORD_ID = 'local';

/**
 * Loads saved custom direct items from IDB.
 * @returns {Promise<Array>}
 */
export async function loadCustomItemsFromIDB() {
  try {
    const db = await getDB();
    const record = await db.get('direct_custom_items', CUSTOM_ITEMS_RECORD_ID);
    return Array.isArray(record?.items) ? record.items : [];
  } catch (e) {
    console.warn('[IDBPersistence] Failed to load custom items:', e);
    return [];
  }
}

/**
 * Persists saved custom direct items to IDB.
 * @param {Array} items
 */
export async function saveCustomItemsToIDB(items) {
  try {
    const db = await getDB();
    await db.put('direct_custom_items', JSON.parse(JSON.stringify({ id: CUSTOM_ITEMS_RECORD_ID, items })));
  } catch (e) {
    console.warn('[IDBPersistence] Failed to save custom items:', e);
  }
}

// ── Clear all ─────────────────────────────────────────────────────────────────

/**
 * Removes all operational data from IndexedDB (equivalent to the old clearState).
 * Clears the operative collections and app_meta/app_settings/direct_custom_items.
 * Does NOT clear configuration caches (venues, rooms, tables, menu_*, etc.) or
 * the sync_queue.
 */
export async function clearAllStateFromIDB() {
  const operativeStores = [
    'orders', 'transactions', 'cash_movements', 'daily_closures', 'print_jobs',
    'app_meta', 'app_settings', 'direct_custom_items', 'venue_users',
  ];
  try {
    const db = await getDB();
    await Promise.all(operativeStores.map(name => db.clear(name)));
  } catch (e) {
    console.warn('[IDBPersistence] Failed to clear state:', e);
  }
}

/**
 * Deletes the entire IndexedDB database for the current instance.
 * Nuclear option — used only during full reset.
 * @param {string} [instanceName]
 */
export async function deleteDatabase(instanceName) {
  const n = instanceName ?? appConfig.instanceName ?? '';
  const dbName = n ? `app-cassa-${n}` : 'app-cassa';
  try {
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = resolve;
      req.onerror = () => reject(req.error);
      req.onblocked = resolve; // proceed even if blocked
    });
  } catch (e) {
    console.warn('[IDBPersistence] Failed to delete database:', e);
  }
}
