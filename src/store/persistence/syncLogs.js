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
 *     status ('success'|'error'), statusCode, durationMs,
 *     collection, recordCount }
 *
 * Smart Retention (two-bucket purge):
 *   Success Bucket — retain newest SYNC_LOGS_MAX_SUCCESS (100) successful entries.
 *   Error Bucket   — retain newest SYNC_LOGS_MAX_ERRORS  (200) failed entries
 *                    AND all entries from the last SYNC_LOGS_ERROR_RETENTION_MS (48 h).
 * The two buckets are purged independently so errors are never evicted by a flood
 * of successes and recent failures are always preserved for debugging.
 *
 * Reactive Bridge:
 *   - Same-tab:   CustomEvent('sync-logs:changed') dispatched on window.
 *   - Cross-tab:  BroadcastChannel('sync-logs') message { type: 'changed' }.
 */

import { getDB } from '../../composables/useIDB.js';

/** Maximum number of successful log entries to retain in IDB. */
export const SYNC_LOGS_MAX_SUCCESS = 100;

/** Maximum number of failed log entries to retain in IDB (numeric bound). */
export const SYNC_LOGS_MAX_ERRORS = 200;

/**
 * Error entries younger than this threshold are always retained regardless of
 * the numeric limit.  Defaults to 48 hours expressed in milliseconds.
 */
export const SYNC_LOGS_ERROR_RETENTION_MS = 48 * 60 * 60 * 1000;

// ── BroadcastChannel (cross-tab reactivity) ───────────────────────────────────

const BC_CHANNEL = 'sync-logs';

/**
 * A stable per-tab identifier included in BroadcastChannel messages so that
 * SyncMonitor can filter out notifications that originated in the same tab
 * (same-tab updates are already covered by the CustomEvent on `window`).
 */
export const _TAB_ID = Math.random().toString(36).slice(2);

/**
 * Notifies all listeners:
 *  - Same-tab via CustomEvent for zero-latency updates.
 *  - Other tabs via BroadcastChannel so all open monitor instances stay in sync.
 *    The message carries `sourceId` so receivers can ignore cross-tab delivery
 *    of a notification that the same tab already handled via the CustomEvent.
 *
 * A new channel is created and immediately closed on each notification to avoid
 * holding an open port when the monitor modal is not visible.
 */
function _notifyChange() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sync-logs:changed'));
  }
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const bc = new BroadcastChannel(BC_CHANNEL);
      bc.postMessage({ type: 'changed', sourceId: _TAB_ID });
      bc.close();
    } catch { /* silently ignore in environments without BC support */ }
  }
}

// ── Smart Retention ───────────────────────────────────────────────────────────

/**
 * Two-bucket purge applied after every write:
 *  1. Success bucket: delete oldest successes beyond SYNC_LOGS_MAX_SUCCESS.
 *  2. Error bucket:   delete error entries that are BOTH older than
 *     SYNC_LOGS_ERROR_RETENTION_MS AND not among the newest SYNC_LOGS_MAX_ERRORS.
 *
 * @param {import('idb').IDBPDatabase} db
 */
async function _purge(db) {
  // Fast path: if total entries ≤ SYNC_LOGS_MAX_SUCCESS (100), neither bucket can
  // be over its limit.  Specifically:
  //  • Success bucket has at most 100 entries, which equals the cap — no eviction.
  //  • Error bucket also has at most 100 entries, which is ≤ SYNC_LOGS_MAX_ERRORS
  //    (200) — numeric cap not exceeded.  Time-window purge also fires only when
  //    old errors sit outside the newest-200 window, which cannot happen when the
  //    total error count is ≤ 100.
  // Using SYNC_LOGS_MAX_SUCCESS (not the combined 300) keeps the threshold low
  // enough that the retention tests still trigger the scan when needed, while
  // avoiding the O(N) cursor traversal for any store with ≤ 100 records.
  const total = await db.count('sync_logs');
  if (total <= SYNC_LOGS_MAX_SUCCESS) return;

  const tx = db.transaction('sync_logs', 'readwrite');
  const index = tx.store.index('timestamp');
  const cutoff = new Date(Date.now() - SYNC_LOGS_ERROR_RETENTION_MS).toISOString();

  const keysToDelete = new Set();

  // Keep only the newest SYNC_LOGS_MAX_SUCCESS successes by evicting
  // older successes as soon as we see more than the allowed count.
  const successIdsToKeep = [];

  // Track all errors older than the time window, then preserve the newest
  // SYNC_LOGS_MAX_ERRORS errors overall by excluding them from deletion.
  const oldErrorIds = [];
  const newestErrorIds = [];

  let cursor = await index.openCursor();
  while (cursor) {
    const record = cursor.value;

    if (record.status === 'success') {
      successIdsToKeep.push(record.id);
      if (successIdsToKeep.length > SYNC_LOGS_MAX_SUCCESS) {
        keysToDelete.add(successIdsToKeep.shift());
      }
    } else {
      newestErrorIds.push(record.id);
      if (newestErrorIds.length > SYNC_LOGS_MAX_ERRORS) {
        newestErrorIds.shift();
      }

      if (record.timestamp < cutoff) {
        oldErrorIds.push(record.id);
      }
    }

    cursor = await cursor.continue();
  }

  if (oldErrorIds.length > 0) {
    const newestErrorIdSet = new Set(newestErrorIds);
    for (const id of oldErrorIds) {
      // Delete only if the entry falls outside both retention criteria:
      // it is older than the retention window and not among the newest errors.
      if (!newestErrorIdSet.has(id)) keysToDelete.add(id);
    }
  }

  if (keysToDelete.size > 0) {
    await Promise.all([...keysToDelete].map(id => tx.store.delete(id)));
  }

  await tx.done;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * @typedef {null|boolean|number|string|JsonValue[]|{[key: string]: JsonValue}} JsonValue
 */

/**
 * Adds a new entry to the sync_logs ObjectStore and applies smart retention.
 * Fire-and-forget — errors are swallowed so logging never disrupts callers.
 *
 * @param {{
 *   direction?: 'IN'|'OUT',
 *   type?: 'PULL'|'PUSH'|'WS',
 *   endpoint?: string|null,
 *   payload?: JsonValue,
 *   response?: JsonValue,
 *   status?: 'success'|'error',
 *   statusCode?: number|null,
 *   durationMs?: number|null,
 *   collection?: string|null,
 *   recordCount?: number|null,
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
    await _purge(db);
    _notifyChange();
  } catch (e) {
    console.warn('[SyncLogs] Failed to add log entry:', e);
  }
}

/**
 * Returns sync log entries sorted by most recent first (both buckets combined).
 * Uses a reverse cursor so that when a `limit` is provided only that many
 * records are read from IDB, avoiding a full-table load.
 *
 * @param {number} [limit] - Optional cap on the number of entries returned.
 * @returns {Promise<Array>}
 */
export async function getSyncLogs(limit) {
  // A limit of 0 (or negative) means "return nothing" — short-circuit before
  // opening any IDB transaction so callers can safely pass computed values.
  if (Number.isFinite(limit) && limit <= 0) return [];
  try {
    const db = await getDB();
    const tx = db.transaction('sync_logs', 'readonly');
    const index = tx.store.index('timestamp');
    const results = [];
    let cursor = await index.openCursor(null, 'prev');
    while (cursor) {
      results.push(cursor.value);
      if (Number.isFinite(limit) && results.length >= limit) break;
      cursor = await cursor.continue();
    }
    await tx.done;
    return results;
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
 * Returns all sync log entries (both buckets, most recent first) for export.
 * No limit is applied so the download is always complete.
 * Uses a reverse cursor to avoid materialising the entire store forwards then
 * reversing in memory.
 *
 * @returns {Promise<Array>}
 */
export async function exportSyncLogs() {
  try {
    const db = await getDB();
    const tx = db.transaction('sync_logs', 'readonly');
    const index = tx.store.index('timestamp');
    const results = [];
    let cursor = await index.openCursor(null, 'prev');
    while (cursor) {
      results.push(cursor.value);
      cursor = await cursor.continue();
    }
    await tx.done;
    return results;
  } catch (e) {
    console.warn('[SyncLogs] Failed to export sync logs:', e);
    return [];
  }
}

/**
 * Returns the name of the BroadcastChannel used for cross-tab notifications.
 * Exposed for test use only.
 */
export const _BC_CHANNEL = BC_CHANNEL;
