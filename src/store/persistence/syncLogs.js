/**
 * @file store/persistence/syncLogs.js
 * @description Activity Logging & Debugging — IDB persistence for sync_logs.
 *
 * Each record captures one network exchange (push/pull/ws) with full
 * request/response details for debugging purposes.
 *
 * Record shape:
 *   { id (autoincrement), timestamp, direction ('IN'|'OUT'),
 *     type ('PULL'|'PUSH'|'WS'), endpoint, payload, response,
 *     status ('success'|'error'), statusCode, durationMs }
 *
 * Auto-purge: a circular buffer keeps at most SYNC_LOGS_MAX_ENTRIES entries
 * (newest entries are kept). Purging is done via the `timestamp` index using
 * the shared `pruneToNewest` helper from _shared.js.
 */

import { getDB } from '../../composables/useIDB.js';

/**
 * Maximum number of sync log entries to retain in IDB.
 * Older entries are automatically removed after each write.
 */
export const SYNC_LOGS_MAX_ENTRIES = 200;

/**
 * Dispatches a CustomEvent on `window` to notify UI listeners that the
 * sync_logs store has been updated.  Fire-and-forget — safe to call in
 * browsers and Node/test environments (window guard included).
 */
function _notifyChange() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sync-logs:changed'));
  }
}

/**
 * Adds a new entry to the sync_logs ObjectStore and prunes to
 * SYNC_LOGS_MAX_ENTRIES.  Fire-and-forget — errors are logged but never
 * propagate to callers so that logging never disrupts operational code.
 *
 * @param {{
 *   direction: 'IN'|'OUT',
 *   type: 'PULL'|'PUSH'|'WS',
 *   endpoint: string,
 *   payload: object|null,
 *   response: object|null,
 *   status: 'success'|'error',
 *   statusCode: number|null,
 *   durationMs: number|null,
 *   collection?: string,
 *   recordCount?: number,
 * }} entry
 */
export async function addSyncLog(entry) {
  try {
    const db = await getDB();
    const record = {
      timestamp: new Date().toISOString(),
      direction: entry.direction ?? 'OUT',
      type: entry.type ?? 'PUSH',
      endpoint: entry.endpoint ?? null,
      payload: entry.payload ?? null,
      response: entry.response ?? null,
      status: entry.status ?? 'success',
      statusCode: entry.statusCode ?? null,
      durationMs: entry.durationMs ?? null,
      collection: entry.collection ?? null,
      recordCount: entry.recordCount ?? null,
    };
    await db.add('sync_logs', record);

    // Auto-purge: keep only newest SYNC_LOGS_MAX_ENTRIES entries.
    // Uses the `timestamp` index to delete oldest entries first.
    const total = await db.count('sync_logs');
    if (total > SYNC_LOGS_MAX_ENTRIES) {
      const deleteCount = total - SYNC_LOGS_MAX_ENTRIES;
      const tx = db.transaction('sync_logs', 'readwrite');
      const index = tx.store.index('timestamp');
      let cursor = await index.openCursor(null, 'next');
      let deleted = 0;
      while (cursor && deleted < deleteCount) {
        await cursor.delete();
        deleted++;
        cursor = await cursor.continue();
      }
      await tx.done;
    }

    _notifyChange();
  } catch (e) {
    console.warn('[SyncLogs] Failed to add log entry:', e);
  }
}

/**
 * Returns sync log entries sorted by most recent first.
 *
 * @param {number} [limit=200]
 * @returns {Promise<Array>}
 */
export async function getSyncLogs(limit = 200) {
  try {
    const db = await getDB();
    const all = await db.getAllFromIndex('sync_logs', 'timestamp');
    const sorted = [...all].reverse();
    return Number.isFinite(limit) ? sorted.slice(0, Math.max(0, limit)) : sorted;
  } catch (e) {
    console.warn('[SyncLogs] Failed to read sync logs:', e);
    return [];
  }
}

/**
 * Clears all sync log entries.  Useful for "reset session" operations.
 */
export async function clearSyncLogs() {
  try {
    const db = await getDB();
    await db.clear('sync_logs');
    _notifyChange();
  } catch (e) {
    console.warn('[SyncLogs] Failed to clear sync logs:', e);
  }
}

/**
 * Returns all sync log entries as a plain array (most recent first)
 * for session export.  No limit is applied so the export is complete.
 *
 * @returns {Promise<Array>}
 */
export async function exportSyncLogs() {
  try {
    const db = await getDB();
    const all = await db.getAllFromIndex('sync_logs', 'timestamp');
    return [...all].reverse();
  } catch (e) {
    console.warn('[SyncLogs] Failed to export sync logs:', e);
    return [];
  }
}
