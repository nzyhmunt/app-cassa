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

export const DB_VERSION = 1;
const DB_NAME_PREFIX = 'app-cassa';

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
    upgrade(db) {
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

      // NOTE: keyPath is 'transactionId' to match the current in-memory shape.
      // Will be normalised to 'id' in the Directus-sync step.
      if (!db.objectStoreNames.contains('transactions')) {
        const s = db.createObjectStore('transactions', { keyPath: 'transactionId' });
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

      // NOTE: keyPath is 'logId' to match the current in-memory shape.
      if (!db.objectStoreNames.contains('print_jobs')) {
        const s = db.createObjectStore('print_jobs', { keyPath: 'logId' });
        s.createIndex('status', 'status', { unique: false });
        s.createIndex('job_timestamp', 'timestamp', { unique: false });
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
      //   (tableOccupiedAt, tableMergedInto, billRequestedTables, cashBalance,
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
