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
 *   error         → incrementAttempts; exponential back-off 2^n s; max MAX_ATTEMPTS
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
    const venueUserId = await loadAuthSessionFromIDB().catch((error) => {
      console.warn('[SyncQueue] Failed to load auth session user for audit payload enrichment; venue_user fields will not be set:', error);
      return null;
    });
    const payloadWithAudit = _withVenueUserAuditPayload(collection, operation, payload ?? null, venueUserId);

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
 * Explicit payload values are never overridden.
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
  const hasCreated = _isPresentValue(out.venue_user_created);
  const hasUpdated = _isPresentValue(out.venue_user_updated);

  if (operation === 'create' && !hasCreated) {
    out.venue_user_created = venueUserId;
  }
  if (operation === 'update' && !hasUpdated) {
    out.venue_user_updated = venueUserId;
  }

  return out;
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
    };
  }
}

/**
 * Drains the sync_queue by sending every pending entry to Directus in
 * chronological order (date_created ASC).
 *
 * - Successfully pushed entries are removed from the queue.
 * - Failed entries have their `attempts` counter incremented.
 * - Entries that exceed MAX_ATTEMPTS are removed (permanent failure — the
 *   caller may inspect logs; a `drainQueue:error` CustomEvent is dispatched
 *   on the window for each abandoned entry so the UI can react).
 * - Entries that should be skipped (no-op deletes) are silently removed.
 *
 * @param {{ url: string, staticToken: string, venueId?: number|string|null, _backoffMs?: number }} cfg
 *   Directus connection config.  `_backoffMs` overrides the exponential
 *   back-off base (default 1000 ms); set to 0 in tests to skip all delays.
 * @returns {Promise<{ pushed: number, failed: number, abandoned: number, pushedIds: Array<{collection: string, recordId: string}> }>}
 */
export async function drainQueue(cfg) {
  const sdkClient = _buildRestClient(cfg);
  const entries = await getPendingEntries();
  const backoffBase = typeof cfg._backoffMs === 'number' ? cfg._backoffMs : 1000;
  let pushed = 0, failed = 0, abandoned = 0;
  /** @type {{collection: string, recordId: string}[]} */
  const pushedIds = [];

  for (const entry of entries) {
    const result = await _pushEntry(entry, sdkClient, cfg);

    if (result === true || result === 'skip') {
      await removeEntry(entry.id);
      pushed++;
      if (result === true) pushedIds.push({ collection: entry.collection, recordId: entry.record_id });
    } else {
      const newAttempts = (entry.attempts ?? 0) + 1;
      const failureDetails = typeof result === 'string' ? { message: result } : result;
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
        // Exponential back-off: pause 2^attempts × backoffBase ms before next entry
        const delayMs = Math.min(2 ** newAttempts * backoffBase, 30_000);
        if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
        // Preserve queue ordering (create → update) by stopping the current
        // drain cycle at the first failed entry. The remaining entries stay
        // queued and will be processed in a subsequent drain attempt.
        break;
      }
    }
  }

  return { pushed, failed, abandoned, pushedIds };
}
