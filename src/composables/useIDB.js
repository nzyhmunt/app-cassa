/**
 * @file composables/useIDB.js
 * @description Opens and provides access to the single IndexedDB database.
 *
 * All ObjectStores reflect the collection schema defined in DATABASE_SCHEMA.md §5.6.
 * The database is versioned (DB_VERSION) and a single singleton promise is cached
 * per page so every caller shares the same connection.
 */

import { openDB } from 'idb';
import { getInstanceName } from '../store/persistence.js';

export const DB_VERSION = 4;
const DB_NAME_PREFIX = 'app-cassa';

/**
 * H8 — Version history and upgrade guide:
 *
 *  v1 — Initial schema: bill_sessions, orders, order_items, app_meta, sync_queue.
 *  v2 — Added: cash_movements, daily_closures, daily_closure_by_method, print_jobs,
 *               fiscal_receipts, invoice_requests, venue_users, app_settings,
 *               direct_custom_items, and all config-cache stores
 *               (venues, rooms, tables, payment_methods, menu_categories, menu_items,
 *                menu_item_modifiers, printers).
 *  v3 — Added: table_merge_sessions (keyPath 'slave_table').
 *               Migrates legacy app_meta.tableMergedInto blob → table_merge_sessions records.
 *  v4 — transactions objectStore re-created with keyPath 'id' (was 'transactionId').
 *               Back-fills `id` from `transactionId` on existing records to preserve data.
 *
 * To add a new version (e.g. v5):
 *   1. Increment DB_VERSION to 5.
 *   2. Add a new `if (oldVersion < 5) { ... }` block inside the `upgrade()` callback.
 *   3. Only create new ObjectStores or add new indexes — never drop or modify existing ones
 *      unless you also provide a data-migration path for users upgrading from earlier versions.
 *   4. Update this comment block with a description of the new version.
 *   5. Update DATABASE_SCHEMA.md §5.6 to reflect the new schema and version number.
 */

/** @type {Promise<import('idb').IDBPDatabase>|null} */
let _dbPromise = null;

/**
 * Returns a Promise that resolves to the open IDBPDatabase instance.
 * Calling this multiple times always returns the same promise (singleton).
 * @returns {Promise<import('idb').IDBPDatabase>}
 */
export function getDB() {
  if (_dbPromise) return _dbPromise;

  const n = getInstanceName();
  const dbName = n ? `${DB_NAME_PREFIX}-${n}` : DB_NAME_PREFIX;

  _dbPromise = openDB(dbName, DB_VERSION, {
    async upgrade(db, oldVersion, _newVersion, tx) {
      // ── Operative collections (match DATABASE_SCHEMA.md §5.6) ─────────────

      if (!db.objectStoreNames.contains('bill_sessions')) {
        const s = db.createObjectStore('bill_sessions', { keyPath: 'id' });
        s.createIndex('table', 'table', { unique: false });
        s.createIndex('status', 'status', { unique: false });
        s.createIndex('date_updated', 'date_updated', { unique: false });
      }

      if (!db.objectStoreNames.contains('orders')) {
        const s = db.createObjectStore('orders', { keyPath: 'id' });
        s.createIndex('table', 'table', { unique: false });
        s.createIndex('status', 'status', { unique: false });
        s.createIndex('bill_session', 'billSessionId', { unique: false });
        s.createIndex('date_updated', 'date_updated', { unique: false });
      }

      if (!db.objectStoreNames.contains('order_items')) {
        const s = db.createObjectStore('order_items', { keyPath: 'id' });
        s.createIndex('order', 'orderId', { unique: false });
        s.createIndex('uid', 'uid', { unique: false });
        s.createIndex('date_updated', 'date_updated', { unique: false });
      }

      if (!db.objectStoreNames.contains('order_item_modifiers')) {
        const s = db.createObjectStore('order_item_modifiers', { keyPath: 'id' });
        s.createIndex('order_item', 'orderItemId', { unique: false });
        s.createIndex('order', 'orderId', { unique: false });
        s.createIndex('item_uid', 'itemUid', { unique: false });
        s.createIndex('date_updated', 'date_updated', { unique: false });
      }

      // Transactions use `id` as keyPath (aligned with Directus schema).
      // v3 → v4 migration: the old keyPath was `transactionId`; migrate every
      // locally-cached record to the new `id` field so offline data is preserved.
      if (oldVersion < 4 && db.objectStoreNames.contains('transactions')) {
        // Read all records from the old store before dropping it.
        const oldRecords = await tx.objectStore('transactions').getAll();
        db.deleteObjectStore('transactions');
        const s = db.createObjectStore('transactions', { keyPath: 'id' });
        s.createIndex('table', 'tableId', { unique: false });
        s.createIndex('bill_session', 'billSessionId', { unique: false });
        s.createIndex('date_updated', 'date_updated', { unique: false });
        for (const rec of oldRecords) {
          // Back-fill `id` from the legacy `transactionId` field when needed.
          if (!rec.id && rec.transactionId) rec.id = rec.transactionId;
          delete rec.transactionId;
          if (rec.id) s.add(rec);
        }
      } else if (!db.objectStoreNames.contains('transactions')) {
        const s = db.createObjectStore('transactions', { keyPath: 'id' });
        s.createIndex('table', 'tableId', { unique: false });
        s.createIndex('bill_session', 'billSessionId', { unique: false });
        s.createIndex('date_updated', 'date_updated', { unique: false });
      }

      if (!db.objectStoreNames.contains('transaction_order_refs')) {
        const s = db.createObjectStore('transaction_order_refs', { keyPath: 'id' });
        s.createIndex('transaction', 'transaction', { unique: false });
        s.createIndex('order', 'order', { unique: false });
      }

      if (!db.objectStoreNames.contains('transaction_voce_refs')) {
        const s = db.createObjectStore('transaction_voce_refs', { keyPath: 'id' });
        s.createIndex('transaction', 'transaction', { unique: false });
        s.createIndex('voce_key', 'voce_key', { unique: false });
      }

      if (!db.objectStoreNames.contains('cash_movements')) {
        const s = db.createObjectStore('cash_movements', { keyPath: 'id' });
        s.createIndex('date_updated', 'date_updated', { unique: false });
      }

      if (!db.objectStoreNames.contains('daily_closures')) {
        const s = db.createObjectStore('daily_closures', { keyPath: 'id' });
        s.createIndex('date_updated', 'date_updated', { unique: false });
      }

      if (!db.objectStoreNames.contains('daily_closure_by_method')) {
        const s = db.createObjectStore('daily_closure_by_method', { keyPath: 'id' });
        s.createIndex('daily_closure', 'daily_closure', { unique: false });
        s.createIndex('date_updated', 'date_updated', { unique: false });
      }

      // table_merge_sessions: active slave→master table unions (one record per slave).
      // keyPath is 'slave_table' (UNIQUE client-side key); 'id' is server-generated by Directus.
      if (!db.objectStoreNames.contains('table_merge_sessions')) {
        const s = db.createObjectStore('table_merge_sessions', { keyPath: 'slave_table' });
        s.createIndex('master_table', 'master_table', { unique: false });
      }

      // Migrate existing tableMergedInto blob from app_meta (v2 → v3).
      // app_meta has existed since v1, so the store is always present when oldVersion >= 1.
      // Keep this outside store creation so later upgrades can still retry cleanup/migration
      // if the legacy key remains for any reason.
      if (
        oldVersion < 3 &&
        db.objectStoreNames.contains('app_meta') &&
        db.objectStoreNames.contains('table_merge_sessions')
      ) {
        try {
          const legacy = await tx.objectStore('app_meta').get('tableMergedInto');
          if (legacy?.value && typeof legacy.value === 'object') {
            const now = new Date().toISOString();
            const mergeStore = tx.objectStore('table_merge_sessions');
            for (const [slave, master] of Object.entries(legacy.value)) {
              if (slave && master) {
                await mergeStore.put({ slave_table: slave, master_table: master, merged_at: now });
              }
            }
            await tx.objectStore('app_meta').delete('tableMergedInto');
          }
        } catch (error) {
          console.warn(
            '[useIDB] Failed to migrate app_meta.tableMergedInto to table_merge_sessions; legacy merge state may remain unmigrated in app_meta, will still be read via fallback when needed, and can be rewritten on a later successful save.',
            {
              dbName,
              oldVersion,
              newVersion: DB_VERSION,
              legacyStore: 'app_meta',
              legacyKey: 'tableMergedInto',
              targetStore: 'table_merge_sessions',
              error,
            },
          );
        }
      }

      // print_jobs: LOCAL-ONLY store — never synced with Directus (not in PULL_CONFIG or
      // GLOBAL_COLLECTIONS). logId is a short client-generated ID, not a Directus UUID.
      // Decision B2 from PIANO_LAVORO.md: keep as local audit trail only.
      if (!db.objectStoreNames.contains('print_jobs')) {
        const s = db.createObjectStore('print_jobs', { keyPath: 'logId' });
        s.createIndex('status', 'status', { unique: false });
        s.createIndex('job_timestamp', 'timestamp', { unique: false });
      }

      // fiscal_receipts: XML request/response payloads for fiscal printer commands.
      // Each record represents one closed-bill fiscal print attempt.
      if (!db.objectStoreNames.contains('fiscal_receipts')) {
        const s = db.createObjectStore('fiscal_receipts', { keyPath: 'id' });
        s.createIndex('table', 'tableId', { unique: false });
        s.createIndex('bill_session', 'billSessionId', { unique: false });
        s.createIndex('status', 'status', { unique: false });
        s.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // invoice_requests: billing data collected for electronic invoices (fatturazione elettronica).
      // Each record represents one closed-bill invoice request.
      if (!db.objectStoreNames.contains('invoice_requests')) {
        const s = db.createObjectStore('invoice_requests', { keyPath: 'id' });
        s.createIndex('table', 'tableId', { unique: false });
        s.createIndex('bill_session', 'billSessionId', { unique: false });
        s.createIndex('status', 'status', { unique: false });
        s.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // ── Configuration caches ───────────────────────────────────────────────

      if (!db.objectStoreNames.contains('venues')) {
        db.createObjectStore('venues', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('rooms')) {
        db.createObjectStore('rooms', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('tables')) {
        const s = db.createObjectStore('tables', { keyPath: 'id' });
        s.createIndex('room', 'room', { unique: false });
        s.createIndex('venue', 'venue', { unique: false });
      }
      if (!db.objectStoreNames.contains('payment_methods')) {
        db.createObjectStore('payment_methods', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('menu_categories')) {
        const s = db.createObjectStore('menu_categories', { keyPath: 'id' });
        s.createIndex('venue', 'venue', { unique: false });
      }
      if (!db.objectStoreNames.contains('menu_items')) {
        const s = db.createObjectStore('menu_items', { keyPath: 'id' });
        s.createIndex('category', 'category', { unique: false });
      }
      if (!db.objectStoreNames.contains('menu_item_modifiers')) {
        const s = db.createObjectStore('menu_item_modifiers', { keyPath: 'id' });
        s.createIndex('menu_item', 'menu_item', { unique: false });
      }
      if (!db.objectStoreNames.contains('printers')) {
        db.createObjectStore('printers', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('venue_users')) {
        const s = db.createObjectStore('venue_users', { keyPath: 'id' });
        s.createIndex('venue', 'venue', { unique: false });
        s.createIndex('role', 'role', { unique: false });
        s.createIndex('status', 'status', { unique: false });
      }

      // ── Sync queue (local-only, never pushed as-is to Directus) ──────────
      if (!db.objectStoreNames.contains('sync_queue')) {
        const s = db.createObjectStore('sync_queue', { keyPath: 'id' });
        s.createIndex('collection', 'collection', { unique: false });
        s.createIndex('date_created', 'date_created', { unique: false });
      }

      // ── Local-only metadata stores ─────────────────────────────────────────

      // app_settings: user-facing settings (sounds, menuUrl, etc.)
      if (!db.objectStoreNames.contains('app_settings')) {
        db.createObjectStore('app_settings', { keyPath: 'id' });
      }

      // app_meta: ephemeral UI state that doesn't map directly to Directus
      //   (tableOccupiedAt, billRequestedTables, cashBalance,
      //    tableCurrentBillSession, auth session/settings)
      if (!db.objectStoreNames.contains('app_meta')) {
        db.createObjectStore('app_meta', { keyPath: 'id' });
      }

      // direct_custom_items: saved items in the "Personalizzata" tab (CassaTableManager)
      if (!db.objectStoreNames.contains('direct_custom_items')) {
        db.createObjectStore('direct_custom_items', { keyPath: 'id' });
      }
    },
  });

  // Reset the singleton if the open fails so subsequent calls can retry
  // (e.g. after a QuotaExceededError or a blocked upgrade resolves).
  _dbPromise.catch(() => { _dbPromise = null; });

  return _dbPromise;
}

/**
 * Closes the current DB connection, deletes the database, and resets the
 * singleton. Ensures each test starts with a completely clean IDB state.
 *
 * For testing only — do NOT call in production code.
 * @internal
 */
export async function _resetIDBSingleton() {
  const n = getInstanceName();
  const dbName = n ? `${DB_NAME_PREFIX}-${n}` : DB_NAME_PREFIX;

  if (_dbPromise) {
    try {
      const db = await _dbPromise;
      db.close();
    } catch (_) { /* ignore */ }
    _dbPromise = null;
  }

  // Delete the database so the next test starts with a fully clean slate.
  // With fake-indexeddb this is synchronous-ish (wrapped in a Promise).
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = resolve;
    req.onerror = resolve; // resolve anyway to avoid hanging tests
    req.onblocked = resolve;
  });
}
