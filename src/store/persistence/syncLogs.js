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

/** @type {BroadcastChannel|null} */
let _bc = null;

function _getBC() {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!_bc) {
    try { _bc = new BroadcastChannel(BC_CHANNEL); } catch { _bc = null; }
  }
  return _bc;
}

/**
 * Notifies all listeners:
 *  - Same-tab via CustomEvent for zero-latency updates.
 *  - Other tabs via BroadcastChannel so all open monitor instances stay in sync.
 */
function _notifyChange() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sync-logs:changed'));
  }
  _getBC()?.postMessage({ type: 'changed' });
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
  // Read all records ordered oldest-first (timestamp index, 'next' direction).
  const all = await db.getAllFromIndex('sync_logs', 'timestamp');

  const successes = all.filter(r => r.status === 'success');
  const errors    = all.filter(r => r.status !== 'success');

  const keysToDelete = new Set();

  // ── Success bucket ──────────────────────────────────────────────────────────
  if (successes.length > SYNC_LOGS_MAX_SUCCESS) {
    // `successes` is sorted oldest-first; slice off the head (oldest excess).
    const excess = successes.slice(0, successes.length - SYNC_LOGS_MAX_SUCCESS);
    for (const r of excess) keysToDelete.add(r.id);
  }

  // ── Error bucket ────────────────────────────────────────────────────────────
  if (errors.length > 0) {
    const cutoff = new Date(Date.now() - SYNC_LOGS_ERROR_RETENTION_MS).toISOString();
    // IDs of the newest SYNC_LOGS_MAX_ERRORS errors (always kept regardless of age).
    const newestErrorIds = new Set(
      errors.slice(-SYNC_LOGS_MAX_ERRORS).map(r => r.id),
    );
    for (const r of errors) {
      const withinWindow = r.timestamp >= cutoff;
      const withinCount  = newestErrorIds.has(r.id);
      // Delete only if the entry falls outside both retention criteria.
      if (!withinWindow && !withinCount) keysToDelete.add(r.id);
    }
  }

  if (keysToDelete.size > 0) {
    const tx = db.transaction('sync_logs', 'readwrite');
    await Promise.all([...keysToDelete].map(id => tx.store.delete(id)));
    await tx.done;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Adds a new entry to the sync_logs ObjectStore and applies smart retention.
 * Fire-and-forget — errors are swallowed so logging never disrupts callers.
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
    await _purge(db);
    _notifyChange();
  } catch (e) {
    console.warn('[SyncLogs] Failed to add log entry:', e);
  }
}

/**
 * Returns sync log entries sorted by most recent first (both buckets combined).
 *
 * @param {number} [limit] - Optional cap on the number of entries returned.
 * @returns {Promise<Array>}
 */
export async function getSyncLogs(limit) {
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
 * Returns all sync log entries (both buckets, most recent first) for export.
 * No limit is applied so the download is always complete.
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

/**
 * Returns the name of the BroadcastChannel used for cross-tab notifications.
 * Exposed for test use only.
 */
export const _BC_CHANNEL = BC_CHANNEL;
