/**
 * @file store/persistence/reset.js
 * @description Persistence helpers for database reset and state clearing.
 */

import { getDB, closeAndResetDB } from '../../composables/useIDB.js';
import { appConfig } from '../../utils/index.js';

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
 * Deletes the entire IndexedDB database for the current instance.
 * Nuclear option — used only during full reset.
 *
 * Uses `closeAndResetDB()` to safely close the singleton connection and reset
 * the singleton promise before the delete request is issued, preventing
 * `InvalidStateError` races when Pinia watchers or timers call `getDB()` during
 * the same micro-task queue.
 *
 * The `onblocked` handler waits up to 3 s for other tabs/frames to release the
 * connection before resolving, rather than rejecting immediately.
 *
 * @param {string} [instanceName]
 */
export async function deleteDatabase(instanceName) {
  const n = instanceName ?? appConfig.instanceName ?? '';
  const dbName = n ? `app-cassa-${n}` : 'app-cassa';
  try {
    await closeAndResetDB();
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = resolve;
      req.onerror = () => reject(req.error);
      req.onblocked = () => {
        console.warn(`[IDBPersistence] Database deletion blocked for '${dbName}'; proceeding after 3 seconds timeout`);
        setTimeout(resolve, 3000);
      };
    });
  } catch (e) {
    console.warn('[IDBPersistence] Failed to delete database:', e);
    throw e;
  }
}
