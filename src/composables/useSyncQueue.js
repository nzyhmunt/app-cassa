/**
 * @file composables/useSyncQueue.js
 * @description Manages the `sync_queue` IndexedDB ObjectStore.
 *
 * Each operational mutation (create / update / delete) is recorded here so that
 * the push loop can synchronise the changes with Directus.  When the device is
 * online and `directus.enabled` is `true`, `drainQueue()` sweeps all pending
 * entries and sends them to Directus via the official SDK in chronological order.
 *
 * Queue entry shape:
 *   { id (UUIDv7), collection, operation: 'create'|'update'|'delete',
 *     record_id, payload, date_created, attempts }
 *
 * Push strategy per §5.7.2:
 *   create  → createItem(collection, payload)       [POST  /items/{collection}]
 *   update  → updateItem(collection, id, payload)   [PATCH /items/{collection}/{id}]
 *   delete  →
 *            (A) soft-delete: updateItem({status:'archived'}) — venues, rooms, tables, …
 *            (B) domain-status (orders, bill_sessions, print_jobs) — NOOP skip
 *            (C) junction tables — deleteItem(collection, id) [hard DELETE]
 *   409 on create → retry as updateItem (duplicate UUIDv7 treated as update)
 *   error (HTTP)  → incrementAttempts; block same (collection, record_id) chain for the
 *                   current drain cycle; abandon after MAX_ATTEMPTS.
 *   error (network) → no attempt counter increment; drain halts immediately; returns
 *                   offline:true.  Retry timing is delegated to the external push-loop
 *                   interval (no inline sleep).
 *
 * Drain ordering (§5.7.2-bis):
 *   Entries are drained breadth-first by logical record chain, grouped by
 *   (collection, record_id).  Groups are ordered by the group's minimum
 *   attempts count first, then by the first entry's date_created, so never-tried
 *   chains are attempted before retried ones.  Within each group, entries are
 *   processed in chronological order.  Dependent entries (child FK → parent
 *   collection) are deferred within the cycle when their parent has not yet been
 *   pushed, preventing FK-not-found failures from burning retry budget.
 */

import { createDirectus, staticToken, rest, createItem, updateItem, deleteItem } from '@directus/sdk';
import { getDB } from './useIDB.js';
import { newUUIDv7 } from '../store/storeUtils.js';
import { appConfig } from '../utils/index.js';
import { mapPayloadToDirectus } from '../utils/mappers.js';
import { loadAuthSessionFromIDB } from '../store/persistence/operations.js';

/**
 * Maximum push attempts before a queue entry is abandoned.
 */
export const MAX_ATTEMPTS = 5;

/**
 * Collections that use soft-delete (PATCH { status: 'archived' }) instead of
 * hard DELETE.  Per §5.7.2 strategy (A).
 * @type {Set<string>}
 */
const SOFT_DELETE_COLLECTIONS = new Set([
  'venues', 'rooms', 'tables', 'menu_categories', 'menu_items', 'menu_modifiers',
  'menu_categories_menu_modifiers', 'menu_items_menu_modifiers',
  'payment_methods', 'printers',
  'transactions', 'cash_movements', 'order_items', 'order_item_modifiers',
  'daily_closures', 'daily_closure_by_method',
]);

/**
 * Collections whose lifecycle is managed purely by status transitions — DELETE
 * operations are silently skipped (§5.7.2 strategy B).
 * @type {Set<string>}
 */
const DOMAIN_STATUS_COLLECTIONS = new Set([
  'bill_sessions', 'orders', 'print_jobs',
]);

// ── Core queue helpers ───────────────────────────────────────────────────────

/** @internal No-op kept for test compatibility. */
export function _resetEnqueueSeq() {}

/**
 * Adds a new entry to the sync_queue ObjectStore.
 * Fire-and-forget — errors are logged but never propagate to callers.
 *
 * The entry `id` is a UUIDv7 so it is time-ordered and lexicographically
 * sortable — this guarantees cross-tab deterministic ordering even when
 * two entries share the same `date_created` millisecond timestamp.
 *
 * @param {string} collection  - IDB / Directus collection name (e.g. 'orders')
 * @param {'create'|'update'|'delete'} operation
 * @param {string} recordId    - Primary key of the affected record
 * @param {object} [payload]   - Record snapshot or partial update fields
 */
export async function enqueue(collection, operation, recordId, payload) {
  try {
    const sourcePayload = payload ?? null;
    let venueUserId = null;
    if (_shouldLoadVenueUserAuditUser(collection, operation, sourcePayload)) {
      venueUserId = await loadAuthSessionFromIDB().catch((error) => {
        console.warn('[SyncQueue] Failed to load auth session user for audit payload enrichment; venue_user fields will not be set:', error);
        return null;
      });
    }
    const payloadWithAudit = _withVenueUserAuditPayload(collection, operation, sourcePayload, venueUserId);

    const db = await getDB();
    await db.add('sync_queue', {
      id: newUUIDv7('sq'),
      collection,
      operation,
      record_id: recordId,
      payload: payloadWithAudit,
      date_created: new Date().toISOString(),
      attempts: 0,
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sync-queue:enqueue'));
    }
  } catch (e) {
    console.warn('[SyncQueue] Failed to enqueue:', e);
  }
}

/**
 * Returns all pending entries in the sync_queue, ordered by (date_created, id) ASC.
 * Using the UUIDv7 `id` as a tiebreaker is cross-tab safe because UUIDv7 encodes
 * a millisecond-precision timestamp in the first 48 bits, making lexicographic
 * comparison monotonic across contexts within the same millisecond window.
 * @returns {Promise<Array>}
 */
export async function getPendingEntries() {
  try {
    const db = await getDB();
    const all = await db.getAllFromIndex('sync_queue', 'date_created');

    if (all.length < 2) return all;

    for (let start = 0; start < all.length;) {
      const ts = all[start]?.date_created ?? '';
      let end = start + 1;

      while (end < all.length && (all[end]?.date_created ?? '') === ts) {
        end += 1;
      }

      if (end - start > 1) {
        all
          .slice(start, end)
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          .forEach((entry, index) => {
            all[start + index] = entry;
          });
      }

      start = end;
    }

    return all;
  } catch (e) {
    console.warn('[SyncQueue] Failed to read queue:', e);
    return [];
  }
}

/**
 * Persists a failed sync call audit entry so operators can inspect failures
 * even after the original queue entry has been removed.
 *
 * @param {object} entry
 * @param {{ message?: string, request?: (Object|null), response?: (Object|null) }} failure
 * @param {number} attempts
 * @param {boolean} abandoned
 */
export async function addFailedSyncCall(entry, failure, attempts, abandoned) {
  try {
    const db = await getDB();
    await db.add('sync_failed_calls', {
      id: newUUIDv7('sqf'),
      queue_entry_id: entry?.id ?? null,
      collection: entry?.collection ?? null,
      operation: entry?.operation ?? null,
      record_id: entry?.record_id ?? null,
      payload: entry?.payload ?? null,
      attempts,
      abandoned: Boolean(abandoned),
      error_message: failure?.message ?? 'Unknown error',
      request: failure?.request ?? null,
      response: failure?.response ?? null,
      failed_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[SyncQueue] Failed to persist failed call log:', e);
  }
}

/**
 * Returns failed sync-call audit entries sorted by most recent first.
 *
 * @param {number} [limit=200]
 * @returns {Promise<Array>}
 */
export async function getFailedSyncCalls(limit = 200) {
  try {
    const db = await getDB();
    const all = await db.getAllFromIndex('sync_failed_calls', 'failed_at');
    const sorted = [...all].reverse();
    return Number.isFinite(limit) ? sorted.slice(0, Math.max(0, limit)) : sorted;
  } catch (e) {
    console.warn('[SyncQueue] Failed to read failed call log:', e);
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
 * Increments the `attempts` counter on a failed entry and optionally records
 * the last error message so the UI can surface it.
 * @param {string} id
 * @param {string|null} [lastError] - Human-readable error message from the last failure
 */
export async function incrementAttempts(id, lastError) {
  try {
    const db = await getDB();
    const entry = await db.get('sync_queue', id);
    if (entry) {
      const updated = { ...entry, attempts: (entry.attempts ?? 0) + 1 };
      if (lastError !== null && lastError !== undefined && lastError !== '') updated.last_error = lastError;
      await db.put('sync_queue', updated);
    }
  } catch (e) {
    console.warn('[SyncQueue] Failed to increment attempts:', e);
  }
}

// ── Push drain ───────────────────────────────────────────────────────────────

function _isPresentValue(value) {
  return value != null && value !== '';
}

/**
 * Defines cross-collection parent→child FK dependencies used by `drainQueue()`
 * to propagate blocks when a parent entry fails.
 *
 * Each entry maps a child collection to an array of parent dependencies.
 * If ANY parent entry for `parentCollection:parentId` is added to `blockedKeys`,
 * or is still pending but not yet pushed in this drain cycle, the child entry is
 * skipped for the rest of the same drain cycle (since the child can never succeed
 * without all its parents already in Directus).
 *
 * @type {Map<string, Array<{ parentCollection: string, fkField: string }>>}
 */
const PARENT_DEPENDENCY_MAP = new Map([
  // transaction_order_refs has TWO parent FKs:
  //   • payload.transaction → transactions  (primary: the ref belongs to this txn)
  //   • payload.order       → orders        (secondary: the ref references this order)
  // Both must exist in Directus before the ref can be created.
  ['transaction_order_refs',  [
    { parentCollection: 'transactions',   fkField: 'transaction' },
    { parentCollection: 'orders',         fkField: 'order' },
  ]],
  // transaction_voce_refs only references the parent transaction
  ['transaction_voce_refs',   [{ parentCollection: 'transactions',   fkField: 'transaction' }]],
  // daily closures — by-method rows carry payload.daily_closure === parent closure.id
  ['daily_closure_by_method', [{ parentCollection: 'daily_closures', fkField: 'daily_closure' }]],
  // bill_sessions — orders and transactions reference the session via the
  // camelCase `billSessionId` in the raw queue payload (mappers convert it to
  // `bill_session` only at push time, after it leaves the queue store).
  ['orders',                  [{ parentCollection: 'bill_sessions',  fkField: 'billSessionId' }]],
  ['transactions',            [{ parentCollection: 'bill_sessions',  fkField: 'billSessionId' }]],
]);

const VENUE_REQUIRED_CREATE_COLLECTIONS = new Set([
  'bill_sessions',
  'orders',
  'transactions',
  'cash_movements',
  'daily_closures',
  'print_jobs',
  'table_merge_sessions',
  'venue_users',
  'printers',
]);

const VENUE_USER_AUDIT_COLLECTIONS = new Set([
  'bill_sessions',
  'orders',
  'order_items',
  'order_item_modifiers',
  'transactions',
  'cash_movements',
  'daily_closures',
  'daily_closure_by_method',
  'print_jobs',
]);

/**
 * Injects required Directus defaults for legacy/sparse queue payloads.
 *
 * @param {string} collection
 * @param {'create'|'update'|'delete'} operation
 * @param {object|null|undefined} payload
 * @param {{ venueId?: number|string|null }} cfg
 * @returns {object}
 */
function _withRequiredDefaults(collection, operation, payload, cfg) {
  // Shallow clone is sufficient: this helper only sets top-level scalar defaults.
  const out = { ...(payload ?? {}) };
  if (
    operation === 'create'
    && VENUE_REQUIRED_CREATE_COLLECTIONS.has(collection)
    && !_isPresentValue(out.venue)
    && _isPresentValue(cfg?.venueId)
  ) {
    out.venue = cfg.venueId;
  }
  return out;
}

/**
 * Enriches queue payloads with Directus audit FKs backed by the current PIN session user.
 *
 * Injection rules:
 *  - create: sets `venue_user_created` when missing/empty
 *  - update: sets `venue_user_updated` when missing/empty
 *  - delete: unchanged payload
 *
 * Explicit payload values are never overridden (snake_case or camelCase).
 *
 * @param {string} collection
 * @param {'create'|'update'|'delete'} operation
 * @param {object|null|undefined} payload
 * @param {string|null} venueUserId
 * @returns {object|null}
 */
function _withVenueUserAuditPayload(collection, operation, payload, venueUserId) {
  if (operation === 'delete') return payload ?? null;
  if (!VENUE_USER_AUDIT_COLLECTIONS.has(collection)) return payload ?? null;
  if (!payload || typeof payload !== 'object') return payload ?? null;
  if (!_isPresentValue(venueUserId)) return payload ?? null;

  const out = { ...payload };
  const hasCreated = _hasAuditFieldValue(out, 'venue_user_created', 'venueUserCreated');
  const hasUpdated = _hasAuditFieldValue(out, 'venue_user_updated', 'venueUserUpdated');

  if (operation === 'create' && !hasCreated) {
    out.venue_user_created = venueUserId;
  }
  if (operation === 'update' && !hasUpdated) {
    out.venue_user_updated = venueUserId;
  }

  return out;
}

function _shouldLoadVenueUserAuditUser(collection, operation, payload) {
  if (operation === 'delete') return false;
  if (operation !== 'create' && operation !== 'update') return false;
  if (!VENUE_USER_AUDIT_COLLECTIONS.has(collection)) return false;
  if (!payload || typeof payload !== 'object') return false;
  const hasExistingAuditValue = operation === 'create'
    ? _hasAuditFieldValue(payload, 'venue_user_created', 'venueUserCreated')
    : _hasAuditFieldValue(payload, 'venue_user_updated', 'venueUserUpdated');
  if (hasExistingAuditValue) return false;
  return true;
}

function _hasAuditFieldValue(payload, snakeCaseKey, camelCaseKey) {
  return _isPresentValue(payload?.[snakeCaseKey]) || _isPresentValue(payload?.[camelCaseKey]);
}

/**
 * Builds a minimal REST-only Directus SDK client from a cfg object.
 * A new, lightweight client is created for each `drainQueue()` invocation
 * so that the push loop does not share connection state with the realtime
 * client used for subscriptions.
 *
 * `globalThis.fetch` is passed explicitly so that test spies installed via
 * `vi.spyOn(global, 'fetch')` are picked up at call time rather than at the
 * moment the `@directus/sdk` module was first loaded (the SDK caches the
 * fetch reference in its `globals` object when `createDirectus` runs).
 *
 * @param {{ url: string, staticToken: string }} cfg
 * @returns {import('@directus/sdk').DirectusClient<object>}
 */
function _buildRestClient(cfg) {
  return createDirectus(cfg.url, { globals: { fetch: globalThis.fetch } })
    .with(staticToken(cfg.staticToken))
    .with(rest());
}

/**
 * Pushes a single sync_queue entry to Directus using the official SDK.
 *
 * Returns `true` when the entry was successfully sent (should be removed from
 * the queue), `'skip'` when the entry should be silently discarded (no-op
 * delete on domain-status collection), or an error message string when the
 * push failed and should be retried.
 *
 * @param {object} entry
 * @param {import('@directus/sdk').DirectusClient<object>} sdkClient
 * @param {{ venueId?: number|string|null }} cfg
 * @returns {Promise<
 *   true |
 *   'skip' |
 *   {
 *     message: string,
 *     request: {
 *       collection: string,
 *       operation: string,
 *       record_id: string,
 *       endpoint: string,
 *       method: 'POST'|'PATCH'|'DELETE',
 *       body: object|null,
 *     } | null,
 *     response: {
 *       status: number|null,
 *       body: unknown,
 *     },
 *     networkError: boolean,
 *   }
 * >}
 */
async function _pushEntry(entry, sdkClient, cfg) {
  const { collection, operation, record_id, payload } = entry;

  // Translate local field names to Directus schema names (create/update only;
  // delete operations use record_id directly and ignore the payload).
  let directusPayload = {};
  if (operation !== 'delete') {
    const mappedPayload = mapPayloadToDirectus(collection, payload, {
      paymentMethods: Array.isArray(appConfig?.paymentMethods) ? appConfig.paymentMethods : [],
      recordId: record_id,
    });
    directusPayload = _withRequiredDefaults(collection, operation, mappedPayload, cfg);

    // Ensure the primary key is always present in create payloads.
    // This guards against cases where the local PK was not included in a partial payload.
    if (operation === 'create' && !directusPayload.id && record_id) {
      directusPayload.id = record_id;
    }
  }

  let requestContext = null;

  try {
    if (operation === 'delete') {
      if (DOMAIN_STATUS_COLLECTIONS.has(collection)) {
        // Strategy B: lifecycle via status — silently skip hard deletes
        return 'skip';
      }
      if (SOFT_DELETE_COLLECTIONS.has(collection)) {
        // Strategy A: soft-delete via PATCH { status: 'archived' }
        requestContext = {
          collection,
          operation,
          record_id,
          endpoint: `/items/${collection}/${record_id}`,
          method: 'PATCH',
          body: { status: 'archived' },
        };
        await sdkClient.request(updateItem(collection, record_id, { status: 'archived' }));
      } else {
        // Strategy C: junction tables — hard DELETE
        requestContext = {
          collection,
          operation,
          record_id,
          endpoint: `/items/${collection}/${record_id}`,
          method: 'DELETE',
          body: null,
        };
        await sdkClient.request(deleteItem(collection, record_id));
      }
    } else if (operation === 'create') {
      try {
        requestContext = {
          collection,
          operation,
          record_id,
          endpoint: `/items/${collection}`,
          method: 'POST',
          body: directusPayload,
        };
        await sdkClient.request(createItem(collection, directusPayload));
      } catch (createError) {
        // 409 Conflict: duplicate UUIDv7 — retry as update
        if (createError?.response?.status === 409) {
          requestContext = {
            collection,
            operation,
            record_id,
            endpoint: `/items/${collection}/${record_id}`,
            method: 'PATCH',
            body: directusPayload,
          };
          await sdkClient.request(updateItem(collection, record_id, directusPayload));
        } else {
          throw createError;
        }
      }
    } else {
      // update
      requestContext = {
        collection,
        operation,
        record_id,
        endpoint: `/items/${collection}/${record_id}`,
        method: 'PATCH',
        body: directusPayload,
      };
      await sdkClient.request(updateItem(collection, record_id, directusPayload));
    }

    return true;
  } catch (e) {
    // Extract a human-readable message from the error:
    //  - e.errors[0].message   — Directus SDK top-level GraphQL/REST error array
    //  - e.response.errors[0]  — SDK error wrapped under .response
    //  - e.message             — standard JS Error (e.g. network failure)
    //  - String(e)             — last-resort fallback (catches non-Error throws)
    const errorMsg =
      e?.errors?.[0]?.message ??
      e?.response?.errors?.[0]?.message ??
      e?.message ??
      String(e);
    console.warn(`[SyncQueue] Error on ${operation} ${collection}/${record_id}:`, errorMsg);
    return {
      message: errorMsg,
      request: requestContext,
      response: {
        status: e?.response?.status ?? null,
        body: e?.response?.errors ?? e?.errors ?? null,
      },
      // True only when the fetch itself threw (no HTTP response received).
      // In browsers and Node.js, fetch network failures surface as TypeError.
      // Distinguishing these from HTTP errors (4xx/5xx, where e.response.status
      // is set) allows the caller to decide whether to increment attempt counters.
      networkError: e instanceof TypeError,
    };
  }
}

/**
 * Drains the sync_queue by sending every pending entry to Directus in
 * BFS-ordered passes (attempts ASC, date_created ASC).
 *
 * - Successfully pushed entries are removed from the queue.
 * - Failed entries have their `attempts` counter incremented.
 * - Entries that exceed MAX_ATTEMPTS are removed (permanent failure — the
 *   caller may inspect logs; a `drainQueue:error` CustomEvent is dispatched
 *   on the window for each abandoned entry so the UI can react).
 * - Entries that should be skipped (no-op deletes) are silently removed.
 * - When an entry fails with an HTTP error, its `collection:record_id` key is
 *   added to a `blockedKeys` set and all subsequent entries sharing the same
 *   key are skipped for the rest of this drain cycle.  This preserves
 *   intra-record ordering (a create must succeed before the paired update runs)
 *   while allowing entries for DIFFERENT records to continue draining unblocked.
 * - When an entry fails with a network-level error (no HTTP response — Directus
 *   unreachable), the drain halts immediately WITHOUT incrementing any attempt
 *   counter.  The `offline` flag in the return value is set to `true`.  This
 *   prevents retry-budget exhaustion while the device is offline.
 * - Cross-collection FK dependencies are guarded by `PARENT_DEPENDENCY_MAP`.
 *   A child entry whose parent is still pending in this cycle (not yet pushed)
 *   is deferred until the next cycle so it does not burn attempts on a
 *   FK-not-found error it can never avoid.
 *
 * @param {{ url: string, staticToken: string, venueId?: number|string|null }} cfg
 *   Directus connection config.
 * @returns {Promise<{ pushed: number, failed: number, abandoned: number, pushedIds: Array<{collection: string, recordId: string}>, offline: boolean }>}
 */
export async function drainQueue(cfg) {
  const sdkClient = _buildRestClient(cfg);
  const entries = await getPendingEntries();
  let pushed = 0, failed = 0, abandoned = 0;
  /** @type {{collection: string, recordId: string}[]} */
  const pushedIds = [];
  let offline = false;

  // BFS-style ordering: process entries with fewer attempts first so that no
  // record burns through its retry budget faster than independent peers.
  // Critically, BFS applies at the GROUP level — all entries sharing the same
  // (collection, record_id) are sorted as a unit so that their internal
  // create → update → delete sequence is always preserved even after retries
  // push the first entry in a chain to a higher attempt tier than its successors.
  //
  // Algorithm:
  //   1. Group entries by "collection:record_id".
  //   2. Within each group sort chronologically (date_created, id) to preserve
  //      the original enqueue order (create before update before delete).
  //   3. Sort groups by (min_attempts_in_group ASC, date_created_of_first_entry ASC).
  //   4. Flatten groups in group-priority order.
  const groupMap = new Map(); // "collection:record_id" → entry[]
  for (const entry of entries) {
    const key = `${entry.collection}:${entry.record_id}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(entry);
  }
  const groupedEntries = [...groupMap.values()].map(grp => {
    grp.sort((a, b) => {
      if (a.date_created < b.date_created) return -1;
      if (a.date_created > b.date_created) return 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    let minAttempts = Infinity;
    for (const entry of grp) {
      const attempts = entry.attempts ?? 0;
      if (attempts < minAttempts) minAttempts = attempts;
    }

    return {
      entries: grp,
      minAttempts,
      firstDateCreated: grp[0]?.date_created ?? '',
      firstId: grp[0]?.id ?? '',
    };
  });
  const sortedEntries = groupedEntries
    .sort((ga, gb) => {
      if (ga.minAttempts !== gb.minAttempts) return ga.minAttempts - gb.minAttempts;
      if (ga.firstDateCreated < gb.firstDateCreated) return -1;
      if (ga.firstDateCreated > gb.firstDateCreated) return 1;
      return ga.firstId < gb.firstId ? -1 : ga.firstId > gb.firstId ? 1 : 0;
    })
    .flatMap(group => group.entries);

  // Pre-compute the full set of (collection:record_id) keys present in this
  // drain cycle.  Used by the cross-collection dependency check to detect when
  // a parent entry is still pending (i.e. not yet pushed), so BFS reordering
  // cannot accidentally schedule a child before its parent.
  const pendingSet = new Set(sortedEntries.map(e => `${e.collection}:${e.record_id}`));

  // (collection:record_id) keys that have failed in this drain cycle.
  // Subsequent entries sharing the same key are skipped so that operation
  // ordering within a single record is preserved (create → update → delete).
  // Entries for DIFFERENT records are NOT blocked, preventing one bad payload
  // from halting the entire queue.
  const blockedKeys = new Set();

  // Tracks entries successfully pushed in this cycle — used by the cross-
  // collection dependency check to distinguish "already pushed" parents from
  // "still pending" ones even after BFS reordering moves a child before its
  // parent in the sorted list.
  const pushedInThisCycle = new Set();

  for (const entry of sortedEntries) {
    const entryKey = `${entry.collection}:${entry.record_id}`;

    // Skip entries whose record chain is blocked by a prior failure this cycle.
    if (blockedKeys.has(entryKey)) continue;

    // Also skip entries whose parent record is blocked (cross-collection FK dependency).
    // For example: if `transactions:txn_1` failed, we must not attempt
    // `transaction_order_refs` entries whose `payload.transaction === 'txn_1'`
    // because Directus would reject them with a FK-not-found error.
    // The second condition handles the BFS case: a child (attempts=0) may be
    // sorted before its parent (attempts>0).  If the parent is still in the
    // pending set but has not been pushed yet this cycle, defer the child.
    // A collection can have multiple parents (e.g. transaction_order_refs depends
    // on both 'transactions' and 'orders'); ALL parents are checked.
    const deps = PARENT_DEPENDENCY_MAP.get(entry.collection);
    if (deps) {
      let skipEntry = false;
      for (const dep of deps) {
        const parentId = entry.payload?.[dep.fkField];
        if (parentId) {
          const parentKey = `${dep.parentCollection}:${parentId}`;
          if (blockedKeys.has(parentKey) || (pendingSet.has(parentKey) && !pushedInThisCycle.has(parentKey))) {
            skipEntry = true;
            break;
          }
        }
      }
      if (skipEntry) continue;
    }

    const result = await _pushEntry(entry, sdkClient, cfg);

    if (result === true || result === 'skip') {
      await removeEntry(entry.id);
      pushed++;
      if (result === true) {
        pushedIds.push({ collection: entry.collection, recordId: entry.record_id });
        // Record as pushed so sibling child entries processed later this cycle
        // are not incorrectly deferred by the pendingSet guard.
        pushedInThisCycle.add(entryKey);
      }
    } else {
      // Detect network-level failure: the fetch itself threw before any HTTP
      // response was received — Directus is unreachable (no internet / server
      // completely down, CORS pre-flight failed, etc.).  In browsers and Node.js
      // these surface as TypeError.  Halt the drain WITHOUT incrementing any
      // attempt counter so that no records are abandoned simply because
      // connectivity was temporarily lost.
      if (typeof result === 'object' && result !== null && result.networkError) {
        offline = true;
        break;
      }

      const failureDetails = typeof result === 'string' ? { message: result } : result;
      const newAttempts = (entry.attempts ?? 0) + 1;
      await addFailedSyncCall(entry, failureDetails, newAttempts, newAttempts >= MAX_ATTEMPTS);
      if (newAttempts >= MAX_ATTEMPTS) {
        console.warn(`[SyncQueue] Abandoning entry after ${MAX_ATTEMPTS} attempts:`, entry);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('drainQueue:error', { detail: entry }));
        }
        await removeEntry(entry.id);
        abandoned++;
      } else {
        await incrementAttempts(entry.id, failureDetails?.message ?? null);
        failed++;
      }
      // Block this (collection, record_id) pair for the rest of this cycle in
      // both the retry and abandon cases — any later operation on the same record
      // (e.g. an update after a failed create) cannot succeed and must wait for
      // the next drain cycle.
      blockedKeys.add(entryKey);
    }
  }

  return { pushed, failed, abandoned, pushedIds, offline };
}
