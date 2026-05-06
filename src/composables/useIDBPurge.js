/**
 * @file composables/useIDBPurge.js
 * @description Provides `runIDBPurge()` — a safe, incremental purge of stale
 * IndexedDB records that have already been synchronised to Directus.
 *
 * ## Safety guarantees
 *
 * 1. **Collection-level sync guard**: before purging any record from a given
 *    collection, the function verifies that `sync_queue` has zero pending
 *    entries for that collection.  If there are pending entries the entire
 *    collection is skipped for this cycle (conservative: the window is bounded
 *    by the next successful drain of the queue).
 *
 * 2. **Retention windows**: records are only considered for removal when their
 *    date field (`date_updated` by default) is older than the configured
 *    retention window.  Windows are set conservatively so that a device that
 *    was offline for several days does not lose data before Directus receives it.
 *
 * 3. **Child-before-parent ordering**: orphaned children (`order_item_modifiers`,
 *    `order_items`) are swept in two passes — once before and once after the
 *    parent purge — so no records are left dangling.
 *
 * 4. **print_jobs**: push-only to Directus via `sync_queue`.  Uses `logId` as
 *    primary key and `timestamp` as the date field.  The sync_queue guard
 *    therefore applies (skipping purge if a push is still pending).
 *
 * 5. **sync_failed_calls**: LOCAL-ONLY audit log.  No sync_queue guard; purged
 *    purely by age (`failed_at`).
 *
 * ## When to call
 *
 * Call `runIDBPurge()` in `onMounted` of the root app component, guarded by
 * `_isDirectusSyncActive()`.  Do NOT call in a `setInterval` without
 * coordinating across tabs (no leader-election mechanism is in place).
 *
 * @see PIANO_IDB_PURGE.md
 * @see DATABASE_SCHEMA.md §5.8
 */

import { getDB } from './useIDB.js';
import { MAX_ATTEMPTS } from './useSyncQueue.js';
import { appConfig, DEFAULT_SETTINGS } from '../utils/index.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Returns true when Directus sync is fully configured and active.
 * Mirrors the guard used by useDirectusSync._getCfg().
 *
 * @returns {boolean}
 */
export function isDirectusSyncActive() {
  const d = appConfig.directus;
  return Boolean(d?.enabled && d?.url && d?.staticToken);
}

/** @deprecated Use {@link isDirectusSyncActive} instead. Kept for test compatibility. */
export const _isDirectusSyncActive = isDirectusSyncActive;

/**
 * Returns true when `sync_queue` has at least one pending entry for
 * `collectionName`.  On any error, returns true (conservative: skip purge).
 *
 * @param {string} collectionName
 * @returns {Promise<boolean>}
 */
async function _hasPendingSyncEntries(collectionName) {
  try {
    const db = await getDB();
    const tx = db.transaction('sync_queue', 'readonly');
    const count = await tx.store.index('collection').count(IDBKeyRange.only(collectionName));
    await tx.done;
    return count > 0;
  } catch (e) {
    console.warn('[useIDBPurge] Failed to check sync_queue for collection:', collectionName, e);
    return true; // conservative: if the check fails, do not purge
  }
}

// ── Core purge logic ──────────────────────────────────────────────────────────

/**
 * Purge stale records from a single ObjectStore.
 *
 * Records are candidates for deletion when ALL of the following are true:
 *  - `retentionDays` is non-null AND `record[dateField]` is older than the
 *    retention cutoff (pass `retentionDays: null` to skip the date filter).
 *  - `statusFilter` is null OR `record.status` is in `statusFilter`.
 *  - `requireMissingParent` is null OR the parent record no longer exists
 *    in `requireMissingParent.storeName`.
 *
 * The sync_queue guard is applied unless `skipSyncGuard` is true.
 *
 * @param {string} storeName
 * @param {number|null} retentionDays  Null = orphan-only purge (no date filter).
 * @param {{
 *   statusFilter?: string[]|null,
 *   dateField?: string,
 *   pkField?: string,
 *   requireMissingParent?: { storeName: string, foreignKey: string }|null,
 *   skipSyncGuard?: boolean,
 * }} [options]
 */
export async function purgeCollection(storeName, retentionDays, options = {}) {
  const {
    statusFilter = null,
    dateField = 'date_updated',
    pkField = 'id',
    requireMissingParent = null,
    skipSyncGuard = false,
  } = options;

  // Collection-level sync guard.
  if (!skipSyncGuard && await _hasPendingSyncEntries(storeName)) return;

  const cutoff = retentionDays != null
    ? Date.now() - retentionDays * 86_400_000
    : null;

  const db = await getDB();
  const records = await db.getAll(storeName);
  const toDelete = [];

  for (const record of records) {
    if (!record) continue;

    // Date filter (skip when retentionDays is null).
    if (cutoff != null) {
      const dateValue = record[dateField];
      if (!dateValue) continue;
      const ts = new Date(dateValue).getTime();
      if (!Number.isFinite(ts)) continue; // skip records with invalid/unparseable dates
      if (ts >= cutoff) continue;
    }

    // Status filter.
    if (statusFilter != null && !statusFilter.includes(record.status)) continue;

    // Parent-missing check (orphan purge).
    if (requireMissingParent != null) {
      const parentId = record[requireMissingParent.foreignKey];
      if (!parentId) continue; // malformed record — skip
      const parent = await db.get(requireMissingParent.storeName, parentId);
      if (parent) continue; // parent still present — keep child
    }

    const pk = record[pkField];
    if (pk != null) toDelete.push(pk);
  }

  if (toDelete.length === 0) return;

  const tx = db.transaction(storeName, 'readwrite');
  for (const key of toDelete) await tx.store.delete(key);
  await tx.done;
}

// ── Specialised purge helpers (local-only stores) ─────────────────────────────

/**
 * Removes dead-letter `sync_queue` entries — those that have exhausted all
 * MAX_ATTEMPTS retry attempts and whose `date_created` is older than
 * `retentionDays`.
 *
 * @param {number} retentionDays
 */
export async function purgeSyncQueueDeadLetter(retentionDays) {
  const cutoff = Date.now() - retentionDays * 86_400_000;
  const db = await getDB();
  const all = await db.getAll('sync_queue');
  const toDelete = all
    .filter(
      e =>
        e &&
        (e.attempts ?? 0) >= MAX_ATTEMPTS /* = 5 */ &&
        e.date_created &&
        new Date(e.date_created).getTime() < cutoff,
    )
    .map(e => e.id)
    .filter(Boolean);
  if (toDelete.length === 0) return;
  const tx = db.transaction('sync_queue', 'readwrite');
  for (const id of toDelete) await tx.store.delete(id);
  await tx.done;
}

/**
 * Removes old entries from `sync_failed_calls` (local-only audit log).
 * No sync_queue guard is applied because this store is never synchronised.
 *
 * @param {number} retentionDays
 */
export async function purgeSyncFailedCalls(retentionDays) {
  const cutoff = Date.now() - retentionDays * 86_400_000;
  const db = await getDB();
  // Use IDBKeyRange.upperBound on the failed_at index so only old records are
  // fetched, avoiding a full store scan.
  const cutoffIso = new Date(cutoff).toISOString();
  const old = await db.getAllFromIndex('sync_failed_calls', 'failed_at', IDBKeyRange.upperBound(cutoffIso));
  const toDelete = old.filter(e => e?.id != null).map(e => e.id);
  if (toDelete.length === 0) return;
  const tx = db.transaction('sync_failed_calls', 'readwrite');
  for (const id of toDelete) await tx.store.delete(id);
  await tx.done;
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Runs a full IDB purge cycle.
 *
 * Retention windows are read from `appConfig.idbPurge` (set at startup from
 * `local_settings` via `applyIDBPurgeConfigToAppConfig`).  If no settings are
 * stored, the conservative defaults from `DEFAULT_SETTINGS.idbPurge` apply.
 *
 * Execution order respects FK dependencies:
 *  1. Pre-sweep orphaned children from previous cycles.
 *  2. Purge parent records.
 *  3. Post-sweep orphans created by this cycle.
 *  4. Purge junction tables (orphan-only: no date field available).
 *  5. Purge `daily_closure_by_method` (child of `daily_closures`).
 *  6. Purge local-only audit stores (no sync_queue guard required).
 *
 * This function is idempotent — calling it on an already-clean database is safe.
 *
 * @returns {Promise<void>}
 */
export async function runIDBPurge() {
  // Read retention windows from appConfig.idbPurge (always pre-validated by
  // applyIDBPurgeConfigToAppConfig at startup).  Fall back to DEFAULT_SETTINGS
  // only when appConfig.idbPurge is absent (e.g. tests that bypass initStoreFromIDB).
  const defaults = DEFAULT_SETTINGS.idbPurge;
  const configured = appConfig.idbPurge ?? {};
  const retention = {
    orders:          configured.orders          ?? defaults.orders,
    billSessions:    configured.billSessions    ?? defaults.billSessions,
    transactions:    configured.transactions    ?? defaults.transactions,
    cashMovements:   configured.cashMovements   ?? defaults.cashMovements,
    dailyClosures:   configured.dailyClosures   ?? defaults.dailyClosures,
    printJobs:       configured.printJobs       ?? defaults.printJobs,
    syncFailedCalls: configured.syncFailedCalls ?? defaults.syncFailedCalls,
  };

  // ── 0. Dead-letter cleanup — run FIRST so abandoned sync_queue entries no
  //    longer block the collection-level guard in steps 1–5 below.
  await purgeSyncQueueDeadLetter(retention.orders);

  // ── 1. Pre-sweep: orphaned children from previous purge cycles ──────────────
  await purgeCollection('order_item_modifiers', retention.orders, {
    requireMissingParent: { storeName: 'order_items', foreignKey: 'order_item' },
  });
  await purgeCollection('order_items', retention.orders, {
    requireMissingParent: { storeName: 'orders', foreignKey: 'order' },
  });

  // ── 2. Parent / root records ────────────────────────────────────────────────
  await purgeCollection('orders', retention.orders, { statusFilter: ['completed', 'rejected'] });
  await purgeCollection('bill_sessions', retention.billSessions, { statusFilter: ['closed'] });
  await purgeCollection('transactions', retention.transactions);
  await purgeCollection('cash_movements', retention.cashMovements);
  await purgeCollection('daily_closures', retention.dailyClosures);

  // print_jobs: pushed to Directus via sync_queue (push-only, no pull).
  //   keyPath = 'logId'  (not 'id' like all other stores)
  //   date field = 'timestamp'  (field name in IDB records)
  await purgeCollection('print_jobs', retention.printJobs, {
    statusFilter: ['done', 'error'],
    dateField: 'timestamp',
    pkField: 'logId',
  });

  // ── 3. Post-sweep: orphans created by this cycle ────────────────────────────
  // Use retentionDays:null so orphaned children are removed regardless of their
  // own date — a child whose parent was just purged may have a date_updated
  // newer than the retention cutoff (LWW upsert), and must still be cleaned up.
  await purgeCollection('order_items', null, {
    requireMissingParent: { storeName: 'orders', foreignKey: 'order' },
  });
  await purgeCollection('order_item_modifiers', null, {
    requireMissingParent: { storeName: 'order_items', foreignKey: 'order_item' },
  });

  // ── 4. Junction tables for transactions ─────────────────────────────────────
  // These stores have no date field; purge only when the parent transaction
  // has already been removed.  Production code does not yet write to them, so
  // this is forward-compatible cleanup.
  await purgeCollection('transaction_order_refs', null, {
    requireMissingParent: { storeName: 'transactions', foreignKey: 'transaction' },
  });
  await purgeCollection('transaction_voce_refs', null, {
    requireMissingParent: { storeName: 'transactions', foreignKey: 'transaction' },
  });

  // ── 5. Child of daily_closures ──────────────────────────────────────────────
  await purgeCollection('daily_closure_by_method', retention.dailyClosures);

  // ── 6. Local-only audit / meta stores ──────────────────────────────────────
  await purgeSyncFailedCalls(retention.syncFailedCalls);
}

// ── Composable ────────────────────────────────────────────────────────────────

/**
 * @returns {{ runIDBPurge: () => Promise<void> }}
 */
export function useIDBPurge() {
  return { runIDBPurge };
}
