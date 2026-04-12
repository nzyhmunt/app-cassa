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
 *
 * Records are passed through JSON.parse(JSON.stringify(...)) before storage.
 * This strips Vue reactive proxies (which cannot be structuredCloned) but also
 * means that non-JSON-serialisable values (functions, Symbols, undefined, BigInt,
 * circular references) will be silently dropped or throw. All app data stored here
 * is plain JSON-serialisable objects, so this is safe for current usage.
 *
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
      cashBalanceRecord,
      tableCurrentBillSessionRecord,
      tableMergedIntoRecord,
      tableOccupiedAtRecord,
      billRequestedTablesRecord,
    ] = await Promise.all([
      db.getAll('orders'),
      db.getAll('transactions'),
      db.getAll('cash_movements'),
      db.getAll('daily_closures'),
      db.getAll('print_jobs'),
      db.get('app_meta', 'cashBalance'),
      db.get('app_meta', 'tableCurrentBillSession'),
      db.get('app_meta', 'tableMergedInto'),
      db.get('app_meta', 'tableOccupiedAt'),
      db.get('app_meta', 'billRequestedTables'),
    ]);

    // printLog: strip payload field (same behaviour as the old localStorage serialiser)
    const printLog = printLogRaw.map(({ payload: _p, ...rest }) => rest);

    return {
      orders,
      transactions,
      cashBalance: cashBalanceRecord?.cashBalance ?? 0,
      cashMovements,
      dailyClosures,
      printLog,
      tableCurrentBillSession: tableCurrentBillSessionRecord?.value ?? {},
      tableMergedInto: tableMergedIntoRecord?.value ?? {},
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
 * (e.g. from the debounced `_scheduleSave` watcher) without wiping unrelated stores.
 *
 * Each table-state field (`tableCurrentBillSession`, `tableMergedInto`,
 * `tableOccupiedAt`, `billRequestedTables`) is stored as its own `app_meta`
 * record so that they can be written independently.
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
 * }} state - Partial or full state snapshot; only present keys are persisted.
 */
export async function saveStateToIDB(state) {
  try {
    const db = await getDB();
    const ops = [];

    if ('orders' in state) {
      ops.push(_replaceAll(db, 'orders', state.orders ?? []));
    }
    if ('transactions' in state) {
      ops.push(_replaceAll(db, 'transactions', state.transactions ?? []));
    }
    if ('cashMovements' in state) {
      ops.push(_replaceAll(db, 'cash_movements', state.cashMovements ?? []));
    }
    if ('dailyClosures' in state) {
      ops.push(_replaceAll(db, 'daily_closures', state.dailyClosures ?? []));
    }
    if ('printLog' in state) {
      // Strip payload from printLog entries before persisting (same as old serialiser)
      const printLogToStore = (state.printLog ?? [])
        .slice(0, 200)
        .map(({ payload: _p, ...rest }) => rest);
      ops.push(_replaceAll(db, 'print_jobs', printLogToStore));
    }
    if ('cashBalance' in state) {
      ops.push(db.put('app_meta', JSON.parse(JSON.stringify({
        id: 'cashBalance',
        cashBalance: state.cashBalance ?? 0,
      }))));
    }
    if ('tableCurrentBillSession' in state) {
      ops.push(db.put('app_meta', JSON.parse(JSON.stringify({
        id: 'tableCurrentBillSession',
        value: state.tableCurrentBillSession ?? {},
      }))));
    }
    if ('tableMergedInto' in state) {
      ops.push(db.put('app_meta', JSON.parse(JSON.stringify({
        id: 'tableMergedInto',
        value: state.tableMergedInto ?? {},
      }))));
    }
    if ('tableOccupiedAt' in state) {
      ops.push(db.put('app_meta', JSON.parse(JSON.stringify({
        id: 'tableOccupiedAt',
        value: state.tableOccupiedAt ?? {},
      }))));
    }
    if ('billRequestedTables' in state) {
      ops.push(db.put('app_meta', JSON.parse(JSON.stringify({
        id: 'billRequestedTables',
        value: state.billRequestedTables instanceof Set
          ? Array.from(state.billRequestedTables)
          : Array.isArray(state.billRequestedTables)
            ? state.billRequestedTables
            : [],
      }))));
    }

    await Promise.all(ops);
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

// ── Fiscal receipts ───────────────────────────────────────────────────────────

const FISCAL_INVOICE_RETENTION = 200;

/**
 * Deletes the oldest entries in `storeName` beyond `keepCount`, using the
 * `timestamp` index cursor to avoid loading all records into memory.
 * Only stores with a `timestamp` index are supported (fiscal_receipts, invoice_requests).
 * @param {import('idb').IDBPDatabase} db
 * @param {string} storeName
 * @param {number} keepCount
 */
async function _pruneToNewest(db, storeName, keepCount) {
  const total = await db.count(storeName);
  if (total <= keepCount) return;
  const deleteCount = total - keepCount;
  const tx = db.transaction(storeName, 'readwrite');
  const index = tx.store.index('timestamp');
  // Iterate oldest-first (ascending); delete excess entries without loading full records.
  let cursor = await index.openCursor(null, 'next');
  let deleted = 0;
  while (cursor && deleted < deleteCount) {
    await cursor.delete();
    deleted++;
    cursor = await cursor.continue();
  }
  await tx.done;
}

/**
 * Persists a single fiscal receipt record to the `fiscal_receipts` ObjectStore.
 * @param {object} record - Must include `id` as keyPath.
 */
export async function saveFiscalReceiptToIDB(record) {
  try {
    const db = await getDB();
    await db.put('fiscal_receipts', JSON.parse(JSON.stringify(record)));
  } catch (e) {
    console.warn('[IDBPersistence] Failed to save fiscal receipt:', e);
  }
}

/**
 * Loads the newest retained fiscal receipt records from IDB, sorted newest-first
 * by timestamp.
 * @returns {Promise<Array>}
 */
export async function loadFiscalReceiptsFromIDB() {
  try {
    const db = await getDB();
    const tx = db.transaction('fiscal_receipts');
    const index = tx.store.index('timestamp');
    const receipts = [];
    let cursor = await index.openCursor(null, 'prev');

    while (cursor && receipts.length < FISCAL_INVOICE_RETENTION) {
      receipts.push(cursor.value);
      cursor = await cursor.continue();
    }

    await tx.done;
    return receipts;
  } catch (e) {
    console.warn('[IDBPersistence] Failed to load fiscal receipts:', e);
    return [];
  }
}

/**
 * Prunes the `fiscal_receipts` store to keep only the newest `keepCount` entries.
 * @param {number} [keepCount=200]
 */
export async function pruneFiscalReceiptsInIDB(keepCount = FISCAL_INVOICE_RETENTION) {
  try {
    const db = await getDB();
    await _pruneToNewest(db, 'fiscal_receipts', keepCount);
  } catch (e) {
    console.warn('[IDBPersistence] Failed to prune fiscal receipts:', e);
  }
}

// ── Invoice requests ──────────────────────────────────────────────────────────

/**
 * Persists a single invoice request record to the `invoice_requests` ObjectStore.
 * @param {object} record - Must include `id` as keyPath.
 */
export async function saveInvoiceRequestToIDB(record) {
  try {
    const db = await getDB();
    await db.put('invoice_requests', JSON.parse(JSON.stringify(record)));
  } catch (e) {
    console.warn('[IDBPersistence] Failed to save invoice request:', e);
  }
}

/**
 * Loads the newest invoice request records from IDB, sorted newest-first by timestamp.
 * Reads directly from the `timestamp` index to avoid loading the full store into memory.
 * @returns {Promise<Array>}
 */
export async function loadInvoiceRequestsFromIDB() {
  try {
    const db = await getDB();
    const tx = db.transaction('invoice_requests', 'readonly');
    const index = tx.store.index('timestamp');
    const records = [];

    let cursor = await index.openCursor(null, 'prev');
    while (cursor && records.length < FISCAL_INVOICE_RETENTION) {
      records.push(cursor.value);
      cursor = await cursor.continue();
    }

    await tx.done;
    return records;
  } catch (e) {
    console.warn('[IDBPersistence] Failed to load invoice requests:', e);
    return [];
  }
}

/**
 * Prunes the `invoice_requests` store to keep only the newest `keepCount` entries.
 * @param {number} [keepCount=200]
 */
export async function pruneInvoiceRequestsInIDB(keepCount = FISCAL_INVOICE_RETENTION) {
  try {
    const db = await getDB();
    await _pruneToNewest(db, 'invoice_requests', keepCount);
  } catch (e) {
    console.warn('[IDBPersistence] Failed to prune invoice requests:', e);
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
 * Selectively removes only `_type === 'manual_user'` records from `venue_users`
 * so that cached Directus venue-user records are preserved.
 * Does NOT clear configuration caches (venues, rooms, tables, menu_*, etc.) or
 * the sync_queue.
 */
export async function clearAllStateFromIDB() {
  const operativeStores = [
    'orders', 'transactions', 'cash_movements', 'daily_closures', 'print_jobs',
    'fiscal_receipts', 'invoice_requests',
    'app_meta', 'app_settings', 'direct_custom_items',
  ];
  try {
    const db = await getDB();
    // Bulk-clear operative stores
    await Promise.all(operativeStores.map(name => db.clear(name)));
    // Selectively remove only manual-user records from venue_users so that
    // future Directus-synced venue users (if any) are not wiped.
    const tx = db.transaction('venue_users', 'readwrite');
    const allUsers = await tx.store.getAll();
    await Promise.all(
      allUsers
        .filter(r => r._type === 'manual_user')
        .map(r => tx.store.delete(r.id)),
    );
    await tx.done;
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
