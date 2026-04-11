/**
 * @file composables/useSyncQueue.js
 * @description Manages the `sync_queue` IndexedDB ObjectStore.
 *
 * Each operational mutation (create / update) is recorded here so that a future
 * sync loop can push the changes to Directus. The queue is NOT drained in this
 * step (Step 1 of the migration plan — DATABASE_SCHEMA.md §5.7.8); Directus
 * integration is handled in Step 2.
 *
 * Queue entry shape:
 *   { id, collection, operation: 'create'|'update'|'delete',
 *     record_id, payload, date_created, attempts }
 */

import { getDB } from './useIDB.js';
import { newUUID } from '../store/storeUtils.js';

/**
 * Adds a new entry to the sync_queue ObjectStore.
 * Fire-and-forget — errors are logged but never propagate to callers.
 *
 * @param {string} collection  - IDB / Directus collection name (e.g. 'orders')
 * @param {'create'|'update'|'delete'} operation
 * @param {string} recordId    - Primary key of the affected record
 * @param {object} [payload]   - Record snapshot or partial update fields
 */
export async function enqueue(collection, operation, recordId, payload) {
  try {
    const db = await getDB();
    await db.add('sync_queue', {
      id: newUUID('sq'),
      collection,
      operation,
      record_id: recordId,
      payload: payload ?? null,
      date_created: new Date().toISOString(),
      attempts: 0,
    });
  } catch (e) {
    console.warn('[SyncQueue] Failed to enqueue:', e);
  }
}

/**
 * Returns all pending entries in the sync_queue, ordered by date_created ASC.
 * @returns {Promise<Array>}
 */
export async function getPendingEntries() {
  try {
    const db = await getDB();
    const all = await db.getAllFromIndex('sync_queue', 'date_created');
    return all;
  } catch (e) {
    console.warn('[SyncQueue] Failed to read queue:', e);
    return [];
  }
}

/**
 * Removes a processed entry from the sync_queue.
 * @param {string} id - The queue entry id
 */
export async function removeEntry(id) {
  try {
    const db = await getDB();
    await db.delete('sync_queue', id);
  } catch (e) {
    console.warn('[SyncQueue] Failed to remove entry:', e);
  }
}

/**
 * Increments the `attempts` counter on a failed entry.
 * @param {string} id
 */
export async function incrementAttempts(id) {
  try {
    const db = await getDB();
    const entry = await db.get('sync_queue', id);
    if (entry) {
      await db.put('sync_queue', { ...entry, attempts: (entry.attempts ?? 0) + 1 });
    }
  } catch (e) {
    console.warn('[SyncQueue] Failed to increment attempts:', e);
  }
}
