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

export const DB_VERSION = 13;
const DB_NAME_PREFIX = 'app-cassa';

/**
 * H8 — Version history and upgrade guide:
 *
 *  v1 — Initial schema: bill_sessions, orders, order_items, app_meta, sync_queue.
 *  v2 — Added: cash_movements, daily_closures, daily_closure_by_method, print_jobs,
 *               fiscal_receipts, invoice_requests, venue_users,
 *               direct_custom_items, and all config-cache stores
 *               (venues, rooms, tables, payment_methods, menu_categories, menu_items,
 *                menu_item_modifiers, printers).
 *  v3 — Added: table_merge_sessions (keyPath 'slave_table').
 *               Migrates legacy app_meta.tableMergedInto blob → table_merge_sessions records.
 *  v4 — transactions objectStore re-created with keyPath 'id' (was 'transactionId').
 *               Back-fills `id` from `transactionId` on existing records to preserve data.
 *  v5 — orders/order_items/order_item_modifiers indexes aligned to Directus FK names
 *               (`bill_session`, `order`, `order_item`) with backward-compat legacy indexes.
 *               Existing records are backfilled from legacy camelCase FK fields when needed.
 *               Added `local_settings` store for device-local preferences and migrated
 *               legacy local settings out of `app_settings`.
 *  v6 — table_merge_sessions migrated to keyPath `id` (UUID) and indexed by
 *               slave_table/master_table/venue/date_updated.
 *               Added menu_modifiers + junction stores
 *               (menu_categories_menu_modifiers, menu_items_menu_modifiers).
 *  v7 — Added `sync_failed_calls` store to persist full request/response details
 *               for failed sync attempts, even after queue entries are removed.
 *  v8 — Removed legacy `menu_item_modifiers` configuration cache ObjectStore.
 *  v9 — Removed deprecated `app_settings` ObjectStore (legacy Directus cache).
 *  v10 — Removed backward-compat legacy IDB indexes: `bill_session_legacy` (orders),
 *               `order_legacy` (order_items), `order_item_legacy`/`order_legacy`/
 *               `item_uid_legacy` (order_item_modifiers). All records carry canonical
 *               snake_case FK values since v5; these indexes are no longer queried.
 *  v11 — `venue_users` index migrated from `role` to multiEntry `apps` to align with
 *               Directus `venue_users.apps` permissions model.
 *  v12 — `transactions` indexes corrected: dropped camelCase `tableId`/`billSessionId`
 *               indexes (created in v4 before the snake_case FK normalisation), added
 *               `table` and `bill_session` indexes keyed on the canonical snake_case
 *               FK fields. Existing records are back-filled so both keys are present.
 *  v13 — Added `sync_logs` ObjectStore for Activity Logging & Debugging.
 *               Each record captures direction (IN/OUT), type (PULL/PUSH/WS), endpoint,
 *               payload, response, status, statusCode, and durationMs.
 *               A `timestamp` index supports chronological reads and auto-purge
 *               (circular buffer, keep newest 200 entries).
 *
 * To add a new version (e.g. v14):
 *   1. Increment DB_VERSION to 14.
 *   2. Add a new `if (oldVersion < 14) { ... }` block inside the `upgrade()` callback.
 *   3. Prefer additive changes (new ObjectStores or new indexes). Only remove or modify
 *      existing stores/indexes when there is a clear justification: provide a data-migration
 *      path for users upgrading from earlier versions where needed, and for safe removals
 *      (such as unused legacy indexes) verify with a repo-wide search that they are no longer
 *      referenced before deleting them.
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

      if (oldVersion < 5 && db.objectStoreNames.contains('orders')) {
        const oldRecords = await tx.objectStore('orders').getAll();
        db.deleteObjectStore('orders');
        const s = db.createObjectStore('orders', { keyPath: 'id' });
        s.createIndex('table', 'table', { unique: false });
        s.createIndex('status', 'status', { unique: false });
        s.createIndex('bill_session', 'bill_session', { unique: false });
        s.createIndex('bill_session_legacy', 'billSessionId', { unique: false });
        s.createIndex('date_updated', 'date_updated', { unique: false });
        for (const rec of oldRecords) {
          if (!rec?.id) continue;
          if (rec.bill_session == null && rec.billSessionId != null) rec.bill_session = rec.billSessionId;
          await s.put(rec);
        }
      } else if (!db.objectStoreNames.contains('orders')) {
        const s = db.createObjectStore('orders', { keyPath: 'id' });
        s.createIndex('table', 'table', { unique: false });
        s.createIndex('status', 'status', { unique: false });
        s.createIndex('bill_session', 'bill_session', { unique: false });
        s.createIndex('date_updated', 'date_updated', { unique: false });
      }

      if (oldVersion < 5 && db.objectStoreNames.contains('order_items')) {
        const oldRecords = await tx.objectStore('order_items').getAll();
        db.deleteObjectStore('order_items');
        const s = db.createObjectStore('order_items', { keyPath: 'id' });
        s.createIndex('order', 'order', { unique: false });
        s.createIndex('order_legacy', 'orderId', { unique: false });
        s.createIndex('uid', 'uid', { unique: false });
        s.createIndex('date_updated', 'date_updated', { unique: false });
        for (const rec of oldRecords) {
          if (!rec?.id) continue;
          if (rec.order == null && rec.orderId != null) rec.order = rec.orderId;
          await s.put(rec);
        }
      } else if (!db.objectStoreNames.contains('order_items')) {
        const s = db.createObjectStore('order_items', { keyPath: 'id' });
        s.createIndex('order', 'order', { unique: false });
        s.createIndex('uid', 'uid', { unique: false });
        s.createIndex('date_updated', 'date_updated', { unique: false });
      }

      if (oldVersion < 5 && db.objectStoreNames.contains('order_item_modifiers')) {
        const oldRecords = await tx.objectStore('order_item_modifiers').getAll();
        db.deleteObjectStore('order_item_modifiers');
        const s = db.createObjectStore('order_item_modifiers', { keyPath: 'id' });
        s.createIndex('order_item', 'order_item', { unique: false });
        s.createIndex('order_item_legacy', 'orderItemId', { unique: false });
        s.createIndex('order', 'order', { unique: false });
        s.createIndex('order_legacy', 'orderId', { unique: false });
        s.createIndex('item_uid', 'item_uid', { unique: false });
        s.createIndex('item_uid_legacy', 'itemUid', { unique: false });
        s.createIndex('date_updated', 'date_updated', { unique: false });
        for (const rec of oldRecords) {
          if (!rec?.id) continue;
          if (rec.order_item == null && rec.orderItemId != null) rec.order_item = rec.orderItemId;
          if (rec.order == null && rec.orderId != null) rec.order = rec.orderId;
          if (rec.item_uid == null && rec.itemUid != null) rec.item_uid = rec.itemUid;
          await s.put(rec);
        }
      } else if (!db.objectStoreNames.contains('order_item_modifiers')) {
        const s = db.createObjectStore('order_item_modifiers', { keyPath: 'id' });
        s.createIndex('order_item', 'order_item', { unique: false });
        s.createIndex('order', 'order', { unique: false });
        s.createIndex('item_uid', 'item_uid', { unique: false });
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
          if (rec.id) await s.add(rec);
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

      if (oldVersion < 6 && db.objectStoreNames.contains('table_merge_sessions')) {
        const oldRecords = await tx.objectStore('table_merge_sessions').getAll();
        db.deleteObjectStore('table_merge_sessions');
        const s = db.createObjectStore('table_merge_sessions', { keyPath: 'id' });
        s.createIndex('slave_table', 'slave_table', { unique: true });
        s.createIndex('master_table', 'master_table', { unique: false });
        s.createIndex('venue', 'venue', { unique: false });
        s.createIndex('date_updated', 'date_updated', { unique: false });
        for (const rec of oldRecords) {
          if (!rec) continue;
          const record = { ...rec };
          if (!record.id) {
            if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
              record.id = crypto.randomUUID();
            } else {
              record.id = `tm_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
            }
          }
          await s.put(record);
        }
      } else if (!db.objectStoreNames.contains('table_merge_sessions')) {
        const s = db.createObjectStore('table_merge_sessions', { keyPath: 'id' });
        s.createIndex('slave_table', 'slave_table', { unique: true });
        s.createIndex('master_table', 'master_table', { unique: false });
        s.createIndex('venue', 'venue', { unique: false });
        s.createIndex('date_updated', 'date_updated', { unique: false });
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
                const id = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
                  ? crypto.randomUUID()
                  : `tm_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
                await mergeStore.put({ id, slave_table: slave, master_table: master, merged_at: now });
              }
            }
            await tx.objectStore('app_meta').delete('tableMergedInto');
          }
        } catch {
          // Ignore legacy v2→v3 migration errors for obsolete upgrade paths.
        }
      }

      // print_jobs: IDB audit store pushed to Directus via sync_queue (push-only, not in PULL_CONFIG).
      // keyPath is `logId` (plog_<uuid>, client-generated local identifier).
      // Directus PK is the standard `id` field (UUID v7, no prefix), generated alongside logId
      // in usePrintQueue.js and used as record_id for enqueue.
      // Note: logId, jobId and originalJobId are local-only — not stored as Directus columns.
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

      if (oldVersion < 8 && db.objectStoreNames.contains('menu_item_modifiers')) {
        db.deleteObjectStore('menu_item_modifiers');
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
      if (!db.objectStoreNames.contains('menu_modifiers')) {
        const s = db.createObjectStore('menu_modifiers', { keyPath: 'id' });
        s.createIndex('venue', 'venue', { unique: false });
        s.createIndex('date_updated', 'date_updated', { unique: false });
      }
      if (!db.objectStoreNames.contains('menu_categories_menu_modifiers')) {
        const s = db.createObjectStore('menu_categories_menu_modifiers', { keyPath: 'id' });
        s.createIndex('menu_categories_id', 'menu_categories_id', { unique: false });
        s.createIndex('menu_modifiers_id', 'menu_modifiers_id', { unique: false });
        s.createIndex('venue', 'venue', { unique: false });
        s.createIndex('date_updated', 'date_updated', { unique: false });
      }
      if (!db.objectStoreNames.contains('menu_items_menu_modifiers')) {
        const s = db.createObjectStore('menu_items_menu_modifiers', { keyPath: 'id' });
        s.createIndex('menu_items_id', 'menu_items_id', { unique: false });
        s.createIndex('menu_modifiers_id', 'menu_modifiers_id', { unique: false });
        s.createIndex('venue', 'venue', { unique: false });
        s.createIndex('date_updated', 'date_updated', { unique: false });
      }
      if (!db.objectStoreNames.contains('printers')) {
        db.createObjectStore('printers', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('venue_users')) {
        const s = db.createObjectStore('venue_users', { keyPath: 'id' });
        s.createIndex('venue', 'venue', { unique: false });
        s.createIndex('apps', 'apps', { unique: false, multiEntry: true });
        s.createIndex('status', 'status', { unique: false });
      } else if (oldVersion < 11) {
        const s = tx.objectStore('venue_users');
        if (s.indexNames.contains('role')) s.deleteIndex('role');
        if (!s.indexNames.contains('apps')) {
          s.createIndex('apps', 'apps', { unique: false, multiEntry: true });
        }

        // Backfill existing records so the new app-based index and auth logic
        // can see users persisted before v11.
        // Preserve only valid existing `apps` entries and drop all legacy role fields.
        let cursor = await s.openCursor();
        while (cursor) {
          const value = cursor.value || {};
          const hasValidApps = Array.isArray(value.apps);
          const normalizedApps = hasValidApps
            ? value.apps.filter((app) => typeof app === 'string' && app.trim())
            : [];
          const hasLegacyRoleFields = (
            Object.hasOwn(value, 'role')
            || Object.hasOwn(value, 'role2')
          );

          const shouldNormalizeApps =
            !hasValidApps ||
            normalizedApps.length !== value.apps.length ||
            normalizedApps.some((app, i) => app !== value.apps[i]);
          const shouldUpdate = shouldNormalizeApps || hasLegacyRoleFields;

          if (shouldUpdate) {
            const { role: _legacyRole, role2: _legacyRole2, ...cleanValue } = value;
            await cursor.update({
              ...cleanValue,
              apps: normalizedApps,
            });
          }

          cursor = await cursor.continue();
        }
      }

      // ── Sync queue (local-only, never pushed as-is to Directus) ──────────
      if (!db.objectStoreNames.contains('sync_queue')) {
        const s = db.createObjectStore('sync_queue', { keyPath: 'id' });
        s.createIndex('collection', 'collection', { unique: false });
        s.createIndex('date_created', 'date_created', { unique: false });
      }
      if (!db.objectStoreNames.contains('sync_failed_calls')) {
        const s = db.createObjectStore('sync_failed_calls', { keyPath: 'id' });
        s.createIndex('failed_at', 'failed_at', { unique: false });
        s.createIndex('collection', 'collection', { unique: false });
      }

      // v13: sync_logs — activity log for all sync exchanges (push/pull/ws).
      // keyPath is autoincrement so entries are ordered by insertion.
      // The `timestamp` index supports chronological reads and the auto-purge
      // (circular buffer) that retains the newest SYNC_LOGS_MAX_ENTRIES entries.
      if (oldVersion < 13 && !db.objectStoreNames.contains('sync_logs')) {
        const s = db.createObjectStore('sync_logs', { keyPath: 'id', autoIncrement: true });
        s.createIndex('timestamp', 'timestamp', { unique: false });
        s.createIndex('type', 'type', { unique: false });
        s.createIndex('direction', 'direction', { unique: false });
      } else if (!db.objectStoreNames.contains('sync_logs')) {
        const s = db.createObjectStore('sync_logs', { keyPath: 'id', autoIncrement: true });
        s.createIndex('timestamp', 'timestamp', { unique: false });
        s.createIndex('type', 'type', { unique: false });
        s.createIndex('direction', 'direction', { unique: false });
      }

      // ── Local-only metadata stores ─────────────────────────────────────────

      // local_settings: device-local settings (sounds, menuUrl, preventScreenLock, ...)
      if (!db.objectStoreNames.contains('local_settings')) {
        db.createObjectStore('local_settings', { keyPath: 'id' });
      }

      if (
        oldVersion < 5 &&
        db.objectStoreNames.contains('app_settings') &&
        db.objectStoreNames.contains('local_settings')
      ) {
        try {
          const legacyLocalSettings = await tx.objectStore('app_settings').get('local');
          if (legacyLocalSettings) {
            await tx.objectStore('local_settings').put(legacyLocalSettings);
            await tx.objectStore('app_settings').delete('local');
          }
        } catch (error) {
          console.warn('[useIDB] Failed to migrate legacy local settings from app_settings to local_settings during v5 upgrade (non-fatal, local settings may reset to defaults).', {
            dbName,
            oldVersion,
            newVersion: DB_VERSION,
            error,
          });
        }
      }

      // v9 cleanup: remove deprecated Directus cache store after the v5 block
      // had a chance to migrate legacy local settings into `local_settings`.
      if (oldVersion < 9 && db.objectStoreNames.contains('app_settings')) {
        db.deleteObjectStore('app_settings');
      }

      // v10: Drop backward-compat camelCase FK indexes (added in v5 for backfill support).
      // Since v5 all records carry canonical snake_case FK values; no production code
      // queries by these legacy index names.
      if (oldVersion < 10) {
        if (db.objectStoreNames.contains('orders')) {
          const s = tx.objectStore('orders');
          if (s.indexNames.contains('bill_session_legacy')) s.deleteIndex('bill_session_legacy');
        }
        if (db.objectStoreNames.contains('order_items')) {
          const s = tx.objectStore('order_items');
          if (s.indexNames.contains('order_legacy')) s.deleteIndex('order_legacy');
        }
        if (db.objectStoreNames.contains('order_item_modifiers')) {
          const s = tx.objectStore('order_item_modifiers');
          if (s.indexNames.contains('order_item_legacy')) s.deleteIndex('order_item_legacy');
          if (s.indexNames.contains('order_legacy')) s.deleteIndex('order_legacy');
          if (s.indexNames.contains('item_uid_legacy')) s.deleteIndex('item_uid_legacy');
        }
      }

      // v12: fix transactions indexes — the v4 migration created indexes keyed on
      // camelCase fields (`tableId`, `billSessionId`) but since v5 all synced records
      // carry the canonical snake_case fields (`table`, `bill_session`). Replace the
      // stale camelCase indexes with correctly-keyed snake_case ones and back-fill
      // any records that only carry one of the two field variants.
      if (oldVersion < 12 && db.objectStoreNames.contains('transactions')) {
        const s = tx.objectStore('transactions');
        if (s.indexNames.contains('table')) s.deleteIndex('table');
        if (s.indexNames.contains('bill_session')) s.deleteIndex('bill_session');
        s.createIndex('table', 'table', { unique: false });
        s.createIndex('bill_session', 'bill_session', { unique: false });

        // Back-fill snake_case fields from camelCase equivalents on legacy records.
        const allTx = await s.getAll();
        for (const rec of allTx) {
          let dirty = false;
          if (rec.table == null && rec.tableId != null) { rec.table = rec.tableId; dirty = true; }
          if (rec.bill_session == null && rec.billSessionId != null) { rec.bill_session = rec.billSessionId; dirty = true; }
          if (dirty) await s.put(rec);
        }
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
 * Closes the current DB connection and resets the singleton promise so that
 * subsequent `getDB()` calls open a fresh connection. Safe to call even when
 * the DB is not open (no-op in that case).
 *
 * Use this before `indexedDB.deleteDatabase()` to prevent `InvalidStateError`
 * race conditions where a watcher or timer obtains the closing connection.
 *
 * @returns {Promise<void>}
 */
export async function closeAndResetDB() {
  if (!_dbPromise) return;
  const promise = _dbPromise;
  _dbPromise = null; // reset first so concurrent callers open a new connection
  try {
    const db = await promise;
    db.close();
  } catch (_) {
    // Already closed or never opened — ignore.
  }
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
