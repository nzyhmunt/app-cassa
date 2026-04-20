/**
 * @file store/idbPersistence.js
 * @description IndexedDB-based persistence helpers for the Pinia store.
 *
 * Replaces `pinia-plugin-persistedstate` with structured
 * IndexedDB ObjectStores as defined in DATABASE_SCHEMA.md §5.6.
 *
 * Architecture:
 *  - loadStateFromIDB()   — called once at app startup to hydrate the Pinia store
 *  - saveStateToIDB(state) — called (debounced/watched) whenever state changes
 *  - Individual save helpers for fine-grained writes triggered by mutations
 */

import { getDB } from '../composables/useIDB.js';
import { appConfig } from '../utils/index.js';
import { newUUIDv7 } from './storeUtils.js';
import { touchStorageKey } from './persistence.js';

// ── Internal helpers ──────────────────────────────────────────────────────────

const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/i;

async function _hashPinForLocalAuth(pin) {
  const raw = String(pin ?? '');
  if (!raw) return '';
  try {
    const data = new TextEncoder().encode(raw);
    const hashBuf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch (_) {
    return raw;
  }
}

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

function _normalizeTableCurrentBillSession(rawSessions) {
  if (!rawSessions || typeof rawSessions !== 'object' || Array.isArray(rawSessions)) return {};

  const normalized = {};
  for (const [table, rawSession] of Object.entries(rawSessions)) {
    if (!table) continue;

    if (typeof rawSession === 'string' && rawSession.trim() !== '') {
      normalized[table] = {
        billSessionId: rawSession,
        table,
        status: 'open',
        adults: 0,
        children: 0,
        opened_at: null,
      };
      continue;
    }

    if (!rawSession || typeof rawSession !== 'object') continue;
    const billSessionId = typeof rawSession.billSessionId === 'string' && rawSession.billSessionId.trim() !== ''
      ? rawSession.billSessionId
      : null;
    if (!billSessionId) continue;

    normalized[table] = {
      ...rawSession,
      billSessionId,
      table: typeof rawSession.table === 'string' && rawSession.table.trim() !== '' ? rawSession.table : table,
      status: typeof rawSession.status === 'string' ? rawSession.status : 'open',
      adults: Number.isFinite(rawSession.adults) ? rawSession.adults : 0,
      children: Number.isFinite(rawSession.children) ? rawSession.children : 0,
      opened_at: rawSession.opened_at ?? null,
    };
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

    // printLog: strip payload field before persistence
    const printLog = printLogRaw.map(({ payload: _p, ...rest }) => rest);

    // H1: Reconstruct tableCurrentBillSession from the dedicated bill_sessions ObjectStore
    // for any open sessions stored there (e.g. synced from Directus).
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
      // Merge: IDB records take precedence over the app_meta blob
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
    touchStorageKey();
  } catch (e) {
    console.warn('[IDBPersistence] Failed to save state:', e);
    throw e;
  }
}

// ── bill_sessions fine-grained writes ────────────────────────────────────────

/**
 * Writes (upserts) a single bill_session record to the `bill_sessions` ObjectStore.
 * Called by `openTableSession()` so that offline reloads hydrate the session from
 * the dedicated ObjectStore without requiring a Directus pull to populate it first.
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
 * Called when closing a table session locally so that a subsequent reload cannot
 * resurrect the stale open record via the `status` index query in `loadStateFromIDB()`.
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

// ── Settings ──────────────────────────────────────────────────────────────────

const SETTINGS_RECORD_ID = 'local';
const JSON_MENU_RECORD_ID = 'json_menu_snapshot';

/**
 * Loads app settings from the `local_settings` ObjectStore.
 * @returns {Promise<object|null>}
 */
export async function loadSettingsFromIDB() {
  try {
    const db = await getDB();
    const record = await db.get('local_settings', SETTINGS_RECORD_ID);
    return record ?? null;
  } catch (e) {
    console.warn('[IDBPersistence] Failed to load settings:', e);
    return null;
  }
}

/**
 * Persists app settings to the `local_settings` ObjectStore.
 * @param {object} settings
 */
export async function saveSettingsToIDB(settings) {
  try {
    const db = await getDB();
    await db.put('local_settings', JSON.parse(JSON.stringify({ id: SETTINGS_RECORD_ID, ...settings })));
  } catch (e) {
    console.warn('[IDBPersistence] Failed to save settings:', e);
    throw e;
  }
}

/**
 * Persists normalized JSON menu payload in app_meta.
 * @param {object} menu
 */
export async function saveJsonMenuToIDB(menu) {
  try {
    const db = await getDB();
    await db.put('app_meta', JSON.parse(JSON.stringify({
      id: JSON_MENU_RECORD_ID,
      value: menu ?? {},
    })));
    touchStorageKey();
  } catch (e) {
    console.warn('[IDBPersistence] Failed to save JSON menu:', e);
  }
}

/**
 * Loads normalized JSON menu payload from app_meta.
 * @returns {Promise<object|null>}
 */
export async function loadJsonMenuFromIDB() {
  try {
    const db = await getDB();
    const record = await db.get('app_meta', JSON_MENU_RECORD_ID);
    return record?.value ?? null;
  } catch (e) {
    console.warn('[IDBPersistence] Failed to load JSON menu:', e);
    return null;
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

/**
 * Loads app-managed users from the `venue_users` ObjectStore.
 *
 * Returns both locally-created (manual) users and active users pulled from
 * Directus (H6).  Manual users are identified by `_type === 'manual_user'`;
 * Directus-synced users have no `_type` discriminator.  Archived Directus users
 * (`status === 'archived'`) are excluded so they cannot log in.
 * @returns {Promise<Array>}
 */
export async function loadUsersFromIDB() {
  try {
    const db = await getDB();
    const all = await db.getAll('venue_users');
    return all.filter(r =>
      r._type === 'manual_user' ||
      (!r._type && r.status !== 'archived'),
    );
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
 * Clears the entire DB except `local_settings` (device-local preferences).
 * This includes operational stores, config caches, sync queue and audit stores.
 */
export async function clearAllStateFromIDB() {
  try {
    const db = await getDB();
    const storesToClear = Array.from(db.objectStoreNames).filter((name) => name !== 'local_settings');
    await Promise.all(storesToClear.map((name) => db.clear(name)));
  } catch (e) {
    console.warn('[IDBPersistence] Failed to clear state:', e);
  }
}

/**
 * Removes all pending entries from the `sync_queue` IndexedDB store.
 * Called during a factory reset so that stale push operations cannot be
 * replayed after the user re-enables Directus.
 */
export async function clearSyncQueueFromIDB() {
  try {
    const db = await getDB();
    await db.clear('sync_queue');
  } catch (e) {
    console.warn('[IDBPersistence] Failed to clear sync_queue:', e);
  }
}

/**
 * Removes all locally cached Directus configuration collections and related
 * global pull cursors (`last_pull_ts:*`) from app_meta.
 *
 * This is used when the user explicitly asks for a full local config reset
 * before forcing a new Directus configuration pull.
 */
export async function clearLocalConfigCacheFromIDB() {
  const configStores = [
    'venues',
    'rooms',
    'tables',
    'payment_methods',
    'menu_categories',
    'menu_items',
    'menu_modifiers',
    'menu_categories_menu_modifiers',
    'menu_items_menu_modifiers',
    'printers',
    'venue_users',
    'table_merge_sessions',
  ];
  try {
    const db = await getDB();
    const existingStores = configStores.filter(store => db.objectStoreNames.contains(store));
    await Promise.all(existingStores.map(store => db.clear(store)));

    const tx = db.transaction('app_meta', 'readwrite');
    const keys = await tx.store.getAllKeys();
    await Promise.all(
      keys
        .filter(key => typeof key === 'string' && key.startsWith('last_pull_ts:'))
        .map(key => tx.store.delete(key)),
    );
    await tx.done;
  } catch (e) {
    console.warn('[IDBPersistence] Failed to clear local config cache:', e);
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
    try {
      const db = await getDB();
      db?.close?.();
    } catch (_) {
      // Best-effort close: deleteDatabase may still succeed even if no active
      // connection exists or close() throws during shutdown races.
    }
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = resolve;
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error(`Database deletion blocked for '${dbName}'`));
    });
  } catch (e) {
    console.warn('[IDBPersistence] Failed to delete database:', e);
    throw e;
  }
}

// ── Directus pull helpers ────────────────────────────────────────────────────

/**
 * Returns the last pull timestamp for `collection` stored in app_meta.
 * Used by the pull loop to build `filter[date_updated][_gt]` queries.
 *
 * @param {string} collection
 * @returns {Promise<string|null>} ISO timestamp or null if never pulled
 */
export async function loadLastPullTsFromIDB(collection) {
  try {
    const db = await getDB();
    const record = await db.get('app_meta', `last_pull_ts:${collection}`);
    return record?.value ?? null;
  } catch (e) {
    console.warn('[IDBPersistence] Failed to load last_pull_ts for', collection, e);
    return null;
  }
}

/**
 * Persists the last pull timestamp for `collection`.
 * Called after each successful pull cycle.
 *
 * @param {string} collection
 * @param {string} ts - ISO timestamp (e.g. max date_updated in the pulled batch)
 */
export async function saveLastPullTsToIDB(collection, ts) {
  try {
    const db = await getDB();
    await db.put('app_meta', { id: `last_pull_ts:${collection}`, value: ts });
  } catch (e) {
    console.warn('[IDBPersistence] Failed to save last_pull_ts for', collection, e);
  }
}

/**
 * Batch-upserts Directus records into the given IDB ObjectStore.
 *
 * Only inserts/replaces a record when the incoming `date_updated` is strictly
 * greater than (or the local record has no `date_updated`).  This implements
 * the last-write-wins conflict resolution described in §5.7.4.
 *
 * Strips `_sync_status` before storing (Directus records are authoritative and
 * implicitly 'synced').
 *
 * @param {string} storeName   - IDB ObjectStore name
 * @param {Array<object>} records - Records received from Directus
 * @returns {Promise<number>} Number of records actually written
 */
export async function upsertRecordsIntoIDB(storeName, records) {
  if (!records || records.length === 0) return 0;

  // Hardcoded keyPath overrides for stores that deviate from the default 'id'.
  // All other stores (orders, bill_sessions, transactions, order_items, etc.) use 'id'.
  // Note: print_jobs is LOCAL-ONLY (not synced with Directus) — its keyPath 'logId' is
  // intentionally excluded here since no Directus records are ever upserted for it.
  const keyPath = 'id';

  const relationId = (value) => {
    if (value == null) return value;
    if (typeof value === 'object') {
      return value.id ?? value.slug ?? null;
    }
    return value;
  };
  const parseJsonArray = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        return [];
      }
    }
    return [];
  };

  const normalizeIncoming = async (collection, record) => {
    if (!record || typeof record !== 'object') return record;
    const normalized = { ...record };
    if (collection === 'orders') {
      const billSession = relationId(normalized.bill_session ?? normalized.billSessionId);
      if (billSession != null) {
        normalized.bill_session = billSession;
        normalized.billSessionId = billSession;
      }
      const table = relationId(normalized.table);
      if (table != null) normalized.table = table;
      normalized.dietary_diets = parseJsonArray(normalized.dietary_diets);
      normalized.dietary_allergens = parseJsonArray(normalized.dietary_allergens);
    } else if (collection === 'order_items') {
      const orderId = relationId(normalized.order ?? normalized.orderId);
      if (orderId != null) {
        normalized.order = orderId;
        normalized.orderId = orderId;
      }
      const dishId = relationId(normalized.dish ?? normalized.dishId);
      if (dishId != null) {
        normalized.dish = dishId;
        normalized.dishId = dishId;
      }
    } else if (collection === 'order_item_modifiers') {
      const orderItem = relationId(normalized.order_item ?? normalized.orderItemId);
      if (orderItem != null) {
        normalized.order_item = orderItem;
        normalized.orderItemId = orderItem;
      }
      const orderId = relationId(normalized.order ?? normalized.orderId);
      if (orderId != null) {
        normalized.order = orderId;
        normalized.orderId = orderId;
      }
      if (normalized.item_uid == null && normalized.itemUid != null) normalized.item_uid = normalized.itemUid;
      if (normalized.itemUid == null && normalized.item_uid != null) normalized.itemUid = normalized.item_uid;
    } else if (collection === 'table_merge_sessions') {
      const slave = relationId(normalized.slave_table ?? normalized.slaveTable);
      const master = relationId(normalized.master_table ?? normalized.masterTable);
      const venue = relationId(normalized.venue);
      if (slave != null) {
        normalized.slave_table = slave;
        normalized.slaveTable = slave;
      }
      if (master != null) {
        normalized.master_table = master;
        normalized.masterTable = master;
      }
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
      const rawPin = normalized.pin ?? normalized.pin_hash;
      if (typeof rawPin === 'string' && rawPin.trim() !== '') {
        const trimmedPin = rawPin.trim();
        normalized.pin = SHA256_HEX_REGEX.test(trimmedPin)
          ? trimmedPin.toLowerCase()
          : await _hashPinForLocalAuth(trimmedPin);
      }
      delete normalized.pin_hash;
    }
    return normalized;
  };

  try {
    const db = await getDB();

    // H7: Guard against unknown ObjectStores — avoids silent transaction failures
    // if a new collection is added to GLOBAL_COLLECTIONS without a matching IDB store.
    if (!db.objectStoreNames.contains(storeName)) {
      console.warn('[IDBPersistence] upsertRecordsIntoIDB: unknown ObjectStore:', storeName);
      return 0;
    }

    // Collect writes to perform — filter out records with no PK and those
    // that are not newer than the local version before opening the transaction.
    // This avoids opening a readwrite transaction when nothing needs writing.
    const normalizedIncomingRecords = await Promise.all(
      records.map((incomingRaw) => normalizeIncoming(storeName, incomingRaw)),
    );
    const toWrite = [];
    {
      // Read-only pre-scan using a readonly transaction to avoid unnecessary
      // write locks when all incoming records are already up-to-date.
      const roTx = db.transaction(storeName, 'readonly');
      for (const incoming of normalizedIncomingRecords) {
        const pk = incoming[keyPath];
        if (!pk) continue;
        const existing = await roTx.store.get(pk);
        if (existing && existing.date_updated && incoming.date_updated) {
          if (new Date(incoming.date_updated) <= new Date(existing.date_updated)) {
            continue; // local is newer or equal — skip
          }
        }
        const { _sync_status: _s, ...clean } = incoming;
        toWrite.push(clean);
      }
      await roTx.done;
    }

    if (toWrite.length === 0) return 0;

    const tx = db.transaction(storeName, 'readwrite');
    for (const record of toWrite) {
      await tx.store.put(record);
    }
    await tx.done;
    touchStorageKey();
    return toWrite.length;
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

// ── Config hydration (D) ─────────────────────────────────────────────────────

/**
 * Reads Directus-sourced configuration collections from IndexedDB and returns
 * a plain object that `applyDirectusConfigToAppConfig()` (utils/index.js) can
 * apply to the live `appConfig` singleton.
 *
 * Filters by `venueId` when provided and excludes archived records.
 * Sorting is done client-side using each record's `sort` field.
 *
 * @param {number|string|null} venueId - venues.id to filter by, or null for no filter.
 * @returns {Promise<{venueRecord:object|null, rooms:Array, tables:Array,
 *                    paymentMethods:Array, printers:Array,
 *                    categories:Array, items:Array, modifiers:Array,
 *                    categoryModifierLinks:Array, itemModifierLinks:Array}|null>}
 */
export async function loadConfigFromIDB(venueId) {
  try {
    const db = await getDB();

    // Normalize IDs to String for type-safe FK comparison.
    // Directus FKs can arrive either as scalar IDs or expanded relation objects
    // ({ id: ... }) depending on API/project settings.
    const relationId = (value) => {
      if (value == null) return null;
      if (typeof value === 'object') {
        if (value.id == null) return null;
        return String(value.id);
      }
      return String(value);
    };

    const venueIdStr = venueId != null ? String(venueId) : null;
    const byVenueAndStatus = (arr) =>
      arr
        .filter(r => (venueIdStr == null || relationId(r.venue) === venueIdStr) && r.status !== 'archived')
        .sort((a, b) => (a.sort ?? 9999) - (b.sort ?? 9999));

    const [
      venues,
      allRooms,
      allTables,
      allPaymentMethods,
      allPrinters,
      allCategories,
      allItems,
      allModifiers,
      allCategoryModifierLinks,
      allItemModifierLinks,
    ] = await Promise.all([
      db.getAll('venues'),
      db.getAll('rooms'),
      db.getAll('tables'),
      db.getAll('payment_methods'),
      db.getAll('printers'),
      db.getAll('menu_categories'),
      db.getAll('menu_items'),
      db.getAll('menu_modifiers'),
      db.getAll('menu_categories_menu_modifiers'),
      db.getAll('menu_items_menu_modifiers'),
    ]);

    const venueRecord = venueIdStr != null
      ? (venues.find(v => String(v.id) === venueIdStr) ?? null)
      : null;

    const rooms = byVenueAndStatus(allRooms);
    const roomIds = new Set(rooms.map(r => String(r.id)));
    const tables = allTables
      .filter((t) => {
        if (t.status === 'archived') return false;
        if (venueIdStr == null) return true;

        const tableVenueId = relationId(t.venue);
        if (tableVenueId != null) return tableVenueId === venueIdStr;

        const tableRoomId = relationId(t.room);
        return tableRoomId != null && roomIds.has(tableRoomId);
      })
      .sort((a, b) => (a.sort ?? 9999) - (b.sort ?? 9999));

    return {
      venueRecord,
      rooms,
      tables,
      paymentMethods: byVenueAndStatus(allPaymentMethods),
      printers:       byVenueAndStatus(allPrinters),
      categories:     byVenueAndStatus(allCategories),
      items:          byVenueAndStatus(allItems),
      modifiers:      byVenueAndStatus(allModifiers),
      categoryModifierLinks: byVenueAndStatus(allCategoryModifierLinks),
      itemModifierLinks: byVenueAndStatus(allItemModifierLinks),
    };
  } catch (e) {
    console.warn('[IDBPersistence] loadConfigFromIDB failed:', e);
    return null;
  }
}

/**
 * Atomically replaces all records in the `table_merge_sessions` ObjectStore.
 *
 * Used after a full Directus pull of `table_merge_sessions` so that dissolved
 * merges (records deleted on Directus) are also removed from IDB, preventing
 * stale slave→master mappings from persisting after a split.
 *
 * @param {Array<object>} records - Complete set of active merge records from Directus.
 * @returns {Promise<void>}
 */
export async function replaceTableMergesInIDB(records) {
  try {
    const db = await getDB();
    const tx = db.transaction('table_merge_sessions', 'readwrite');
    await tx.store.clear();
    for (const r of records) {
      if (r.id && r.slave_table) {
        const { _sync_status: _s, ...clean } = r;
        await tx.store.put(JSON.parse(JSON.stringify(clean)));
      }
    }
    await tx.done;
  } catch (e) {
    console.warn('[IDBPersistence] replaceTableMergesInIDB failed:', e);
  }
}
