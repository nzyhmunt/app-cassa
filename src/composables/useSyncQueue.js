/**
 * @file composables/useSyncQueue.js
 * @description Manages the `sync_queue` IndexedDB ObjectStore.
 *
 * Each operational mutation (create / update / delete) is recorded here so that
 * the push loop can synchronise the changes with Directus.  When the device is
 * online and `directus.enabled` is `true`, `drainQueue()` sweeps all pending
 * entries and sends them to Directus via the official SDK using BFS group ordering
 * (attempts-first, then chronological within each group — see §5.7.2-bis below).
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
 *            (B) domain-status (orders, bill_sessions, print_jobs, fiscal_receipts, invoice_requests) — NOOP skip
 *            (C) junction tables — deleteItem(collection, id) [hard DELETE]
 *   duplicate on create (primarily HTTP 400 + extensions.code='RECORD_NOT_UNIQUE',
 *   with HTTP 409 as fallback) → retry as updateItem (duplicate UUIDv7 treated as update)
 *   error (HTTP)  → incrementAttempts; block same (collection, record_id) chain for the
 *                   current drain cycle; abandon after MAX_ATTEMPTS.
 *   error (network) → no attempt counter increment; drain halts immediately; returns
 *                   offline:true.  Retry timing is delegated to the external push-loop
 *                   interval (no inline sleep).
 *
 * Drain ordering (§5.7.2-bis):
 *   Entries are drained breadth-first by logical record chain, grouped by
 *   (collection, record_id).  Groups are ordered by the gate (first chronological)
 *   entry's attempts count first, then by the first entry's date_created, so
 *   never-tried chains are attempted before retried ones.  Using the gate entry's
 *   attempts (rather than the group minimum) prevents a partially-failed chain from
 *   being misclassified as "never tried" because later entries in that chain still
 *   have attempts=0.  Within each group, entries are processed in chronological
 *   order.  Dependent entries (child FK → parent collection) are deferred within
 *   the cycle when their parent has not yet been pushed, preventing FK-not-found
 *   failures from burning retry budget.
 */

import { createDirectus, staticToken, rest, createItem, updateItem, deleteItem } from '@directus/sdk';
import { getDB } from './useIDB.js';
import { newUUIDv7 } from '../store/storeUtils.js';
import { appConfig } from '../utils/index.js';
import { mapPayloadToDirectus } from '../utils/mappers.js';
import { loadAuthSessionFromIDB } from '../store/persistence/operations.js';
import { addSyncLog } from '../store/persistence/syncLogs.js';

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
  'bill_sessions', 'orders', 'print_jobs', 'fiscal_receipts', 'invoice_requests',
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
 * to defer child CREATEs until their required parent CREATEs are available.
 *
 * Each entry maps a child collection to an array of parent dependencies.
 * If ANY required parent entry for `parentCollection:parentId` is recorded in
 * `failedCreates`, or is still in `pendingCreates` and has not yet been added to
 * `pushedInThisCycle`, the child entry is deferred during the main pass because
 * it cannot yet succeed without all required parents already in Directus. Some
 * such deferred child entries may be retried later in the same drain cycle once
 * the needed parent CREATEs have been pushed and become satisfiable. This gating
 * is specific to parent CREATE ordering and does not imply that unrelated
 * UPDATE/DELETE failures should also block children.
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
  // bill_sessions — orders reference the session via camelCase `billSessionId` in the raw
  // queue payload (mappers convert it to `bill_session` only at push time).
  // Transactions use snake_case `bill_session` directly in the queue payload.
  // fiscal_receipts and invoice_requests also carry camelCase `billSessionId` in the queue payload.
  ['orders',                  [{ parentCollection: 'bill_sessions',  fkField: 'billSessionId' }]],
  ['transactions',            [{ parentCollection: 'bill_sessions',  fkField: 'bill_session' }]],
  ['fiscal_receipts',         [{ parentCollection: 'bill_sessions',  fkField: 'billSessionId' }]],
  ['invoice_requests',        [{ parentCollection: 'bill_sessions',  fkField: 'billSessionId' }]],
]);

const VENUE_REQUIRED_CREATE_COLLECTIONS = new Set([
  'bill_sessions',
  'orders',
  'transactions',
  'cash_movements',
  'daily_closures',
  'print_jobs',
  'fiscal_receipts',
  'invoice_requests',
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
  'fiscal_receipts',
  'invoice_requests',
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
 * When `signal` is provided it is attached to every underlying `fetch` call,
 * allowing the caller to abort a hung or superseded drain via `AbortController`.
 *
 * @param {{ url: string, staticToken: string }} cfg
 * @param {AbortSignal} [signal]
 * @returns {import('@directus/sdk').DirectusClient<object>}
 */
function _buildRestClient(cfg, signal) {
  const fetchFn = signal
    ? (url, init) => globalThis.fetch(url, { ...(init ?? {}), signal })
    : globalThis.fetch;
  return createDirectus(cfg.url, { globals: { fetch: fetchFn } })
    .with(staticToken(cfg.staticToken))
    .with(rest());
}

/**
 * Pushes a single sync_queue entry to Directus using the official SDK.
 *
 * Returns a success object when the entry was successfully sent (should be
 * removed from the queue), `'skip'` when the entry should be silently
 * discarded (no-op delete on a domain-status collection), or a failure object
 * when the push failed and should be retried.
 *
 * @param {object} entry
 * @param {import('@directus/sdk').DirectusClient<object>} sdkClient
 * @param {{ venueId?: number|string|null }} cfg
 * @returns {Promise<
 *   {
 *     ok: true,
 *     record: object|null,
 *     method: 'POST'|'PATCH'|'DELETE',
 *     requestContext: {
 *       collection: string,
 *       operation: string,
 *       record_id: string,
 *       endpoint: string,
 *       method: 'POST'|'PATCH'|'DELETE',
 *       body: object|null,
 *     },
 *   } |
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
 *     // True when a create POST detected a duplicate record (HTTP 400
 *     // RECORD_NOT_UNIQUE, or HTTP 409 from a proxy) and the fallback PATCH
 *     // also failed.  The record exists in Directus so child FK entries remain
 *     // satisfiable.
 *     recordAlreadyExists: boolean,
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
      menuSource: appConfig?.menuSource ?? 'directus',
    });
    directusPayload = _withRequiredDefaults(collection, operation, mappedPayload, cfg);

    // Ensure the primary key is always present in create payloads.
    // This guards against cases where the local PK was not included in a partial payload.
    if (operation === 'create' && !directusPayload.id && record_id) {
      directusPayload.id = record_id;
    }
  }

  let requestContext = null;
  // Set to true when a create POST detects a duplicate record (HTTP 400 with
  // RECORD_NOT_UNIQUE, or HTTP 409 from a proxy — see isDuplicateRecord below).
  // If the fallback PATCH also fails, the record is still present in Directus,
  // so child FK entries remain satisfiable — they must not be blocked via
  // `failedCreates` / cascade-abandoned.
  let recordAlreadyExists = false;

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
        const patchResult = await sdkClient.request(updateItem(collection, record_id, { status: 'archived' }));
        return { ok: true, record: patchResult ?? null, method: 'PATCH', requestContext };
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
        return { ok: true, record: null, method: 'DELETE', requestContext };
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
        const created = await sdkClient.request(createItem(collection, directusPayload));
        return { ok: true, record: created ?? null, method: 'POST', requestContext };
      } catch (createError) {
        // Duplicate record — the UUID already exists in Directus (e.g. the same
        // entry was pushed in an earlier cycle that never received the HTTP
        // response due to a network timeout).
        //
        // Directus signals this with HTTP 400 and error code RECORD_NOT_UNIQUE
        // (extensions.code === 'RECORD_NOT_UNIQUE').  HTTP 409 is kept as a
        // fallback for compatibility with proxies or future API changes.
        //
        // When detected, retry as PATCH update and set recordAlreadyExists so the
        // outer catch propagates the flag to the caller — which avoids gating
        // child FK entries via failedCreates (the record IS in Directus, so its
        // FK is satisfiable).
        const isDuplicateRecord =
          createError?.errors?.some(e => e?.extensions?.code === 'RECORD_NOT_UNIQUE') ||
          createError?.response?.errors?.some(e => e?.extensions?.code === 'RECORD_NOT_UNIQUE') ||
          createError?.response?.status === 409;
        if (isDuplicateRecord) {
          recordAlreadyExists = true;
          requestContext = {
            collection,
            operation,
            record_id,
            endpoint: `/items/${collection}/${record_id}`,
            method: 'PATCH',
            body: directusPayload,
          };
          const patched = await sdkClient.request(updateItem(collection, record_id, directusPayload));
          return { ok: true, record: patched ?? null, method: 'PATCH', requestContext };
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
      const updated = await sdkClient.request(updateItem(collection, record_id, directusPayload));
      return { ok: true, record: updated ?? null, method: 'PATCH', requestContext };
    }
  } catch (e) {
    // AbortError: the drain was intentionally cancelled by the caller via
    // AbortController.abort().  Return a distinct marker so the drain loop
    // halts silently — no console noise, no sync_logs entry, no attempt burn.
    if (e?.name === 'AbortError') {
      return { aborted: true };
    }
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
      // Note: AbortError is handled above and never reaches this point.
      networkError: e instanceof TypeError,
      // True when a create POST detected a duplicate record (HTTP 400
      // RECORD_NOT_UNIQUE from Directus, or HTTP 409 from a proxy) and the
      // fallback PATCH also failed.  The record IS in Directus so child FK
      // entries remain satisfiable — callers must NOT gate them via failedCreates.
      recordAlreadyExists,
    };
  }
}

/**
 * Derives a minimal endpoint string from a sync queue entry.
 * Used for success-path logging where requestContext is unavailable (e.g. early skip path).
 * @param {object} entry
 * @returns {string}
 */
function _entryEndpoint(entry) {
  const { collection, operation, record_id } = entry;
  if (operation === 'create') return `/items/${collection}`;
  return `/items/${collection}/${record_id}`;
}

/**
 * Logs the outcome of a single push entry to the sync_logs store.
 * @param {object} entry
 * @param {'skip'|{ok:boolean,record:*,method:string,requestContext:*}|object} result - Return value from _pushEntry
 * @param {number} durationMs
 */
function _logPushResult(entry, result, durationMs) {
  if (result === 'skip') return; // no-op deletes are not worth logging
  let logEntry;
  if (result && typeof result === 'object' && result.ok === true) {
    logEntry = {
      direction: 'OUT',
      type: 'PUSH',
      endpoint: result.requestContext?.endpoint ?? _entryEndpoint(entry),
      payload: result.requestContext?.body ?? entry.payload ?? null,
      response: result.record ?? null,
      status: 'success',
      statusCode: null,
      durationMs,
      collection: entry.collection,
      operation: entry.operation ?? null,
      method: result.method ?? null,
    };
  } else {
    const failure = typeof result === 'object' && result !== null ? result : { message: String(result) };
    logEntry = {
      direction: 'OUT',
      type: 'PUSH',
      endpoint: failure.request?.endpoint ?? failure.requestContext?.endpoint ?? _entryEndpoint(entry),
      payload: failure.request?.body ?? entry.payload ?? null,
      response: failure.response ?? null,
      status: 'error',
      statusCode: failure.response?.status ?? null,
      durationMs,
      collection: entry.collection,
      operation: entry.operation ?? null,
      method: failure.request?.method ?? failure.requestContext?.method ?? null,
    };
  }
  addSyncLog(logEntry);
}

/**
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
 *   A child entry whose parent CREATE is still pending in this cycle (not yet
 *   pushed) is deferred until the parent has been pushed, so it does not burn
 *   attempts on a FK-not-found error it can never avoid. Depending on drain
 *   ordering, that child may be retried in a later pass of the SAME drain cycle
 *   once the parent succeeds, or else remain deferred to a future cycle. Only
 *   CREATE failures gate children — if a parent UPDATE or DELETE fails the
 *   record already exists in Directus and the child's FK is satisfied, so it
 *   proceeds unblocked.
 *
 * @param {{ url: string, staticToken: string, venueId?: number|string|null }} cfg
 *   Directus connection config.
 * @param {AbortSignal} [signal]
 *   Optional AbortSignal from an `AbortController`. When aborted, the current
 *   SDK request throws an `AbortError` which is caught by `_pushEntry` and
 *   returned as `{ aborted: true }`.  The drain loop halts immediately without
 *   writing to `sync_logs`, without incrementing any attempt counter, and with
 *   `offline: false` in the return value (the abort was caller-initiated, not a
 *   network failure).  This allows the caller to cancel an in-flight (or hung)
 *   drain without risking queue corruption or false error entries.
 * @returns {Promise<{ pushed: number, failed: number, abandoned: number, pushedIds: Array<{collection: string, recordId: string}>, offline: boolean }>}
 */
export async function drainQueue(cfg, signal) {
  const sdkClient = _buildRestClient(cfg, signal);
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
  //   3. Sort groups by (first_entry_attempts ASC, date_created_of_first_entry ASC,
  //      firstId ASC, groupKey ASC).  Using the first (gate) entry's attempts —
  //      not the minimum across the group — ensures that a partially-failed chain
  //      (gate tried N times, later entries still at 0) is correctly ranked as
  //      "tried N times" rather than "never tried".  The groupKey final tie-breaker
  //      guarantees a stable, deterministic order even when two groups share the
  //      same timestamp and UUIDv7 prefix.
  //   4. Flatten groups in group-priority order.
  const groupMap = new Map(); // "collection:record_id" → entry[]
  for (const entry of entries) {
    const key = `${entry.collection}:${entry.record_id}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(entry);
  }
  const groupedEntries = [...groupMap.entries()].map(([groupKey, grp]) => {
    grp.sort((a, b) => {
      if (a.date_created < b.date_created) return -1;
      if (a.date_created > b.date_created) return 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    // Use the gate (first chronological) entry's attempts as the group's retry tier.
    // Subsequent entries in the same group are blocked until the gate succeeds, so
    // their attempt count (always 0 until unblocked) must not drag the group back to
    // a lower tier than it has already reached.
    const firstAttempts = grp[0]?.attempts ?? 0;

    return {
      entries: grp,
      firstAttempts,
      firstDateCreated: grp[0]?.date_created ?? '',
      firstId: grp[0]?.id ?? '',
      groupKey,
    };
  });
  const sortedEntries = groupedEntries
    .sort((ga, gb) => {
      if (ga.firstAttempts !== gb.firstAttempts) return ga.firstAttempts - gb.firstAttempts;
      if (ga.firstDateCreated < gb.firstDateCreated) return -1;
      if (ga.firstDateCreated > gb.firstDateCreated) return 1;
      if (ga.firstId < gb.firstId) return -1;
      if (ga.firstId > gb.firstId) return 1;
      return ga.groupKey < gb.groupKey ? -1 : ga.groupKey > gb.groupKey ? 1 : 0;
    })
    .flatMap(group => group.entries);

  // (collection:record_id) keys that have failed in this drain cycle.
  // Subsequent entries sharing the same key are skipped so that operation
  // ordering within a single record is preserved (create → update → delete).
  // Entries for DIFFERENT records are NOT blocked, preventing one bad payload
  // from halting the entire queue.
  const blockedKeys = new Set();

  // Subset of blockedKeys: only entries whose FAILED operation was a CREATE.
  // Used exclusively for cross-collection FK dependency gating.  An UPDATE or
  // DELETE failure does NOT remove the record from Directus, so child entries
  // that reference it via FK remain valid and must not be unnecessarily deferred.
  const failedCreates = new Set();

  // Tracks entries successfully pushed in this cycle — used by the cross-
  // collection dependency check to distinguish "already pushed" parents from
  // "still pending" ones even after BFS reordering moves a child before its
  // parent in the sorted list.
  const pushedInThisCycle = new Set();

  // Set of (collection:record_id) keys whose FIRST (gate) pending operation is a
  // CREATE.  Used by the FK dependency check together with pushedInThisCycle to
  // decide whether to defer a child entry when the parent is still in the queue
  // but hasn't been processed yet this cycle.
  // Only keys with a pending CREATE matter: if the gate op is UPDATE/DELETE the
  // record already exists in Directus and the FK constraint is already satisfied.
  const pendingCreates = new Set();
  for (const [key, grp] of groupMap) {
    // Each grp was sorted chronologically inside the groupedEntries .map() above
    // (grp.sort() mutates in place), so grp[0] is the earliest-enqueued entry.
    if ((grp[0]?.operation ?? '') === 'create') pendingCreates.add(key);
  }

  // ── Shared failure-handling helper ──────────────────────────────────────
  // Defined inside drainQueue so it can close over the mutable loop state
  // (offline, pushed, failed, abandoned, pushedIds, blockedKeys,
  // failedCreates, pushedInThisCycle, sortedEntries) without the callers
  // needing to pass every piece of state explicitly.
  //
  // @param {object} entry  - Queue entry being processed.
  // @param {string} entryKey - "collection:record_id" key for the entry.
  // @param {*}      result - Return value from _pushEntry().
  // @returns {boolean} true if a network error was detected (caller must break).
  async function _handleEntryFailure(entry, entryKey, result) {
    if (typeof result === 'object' && result !== null && result.networkError) {
      offline = true;
      return true; // signal caller to break / stop processing
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
    // For FK dependency gating: only a failed CREATE where the record was never
    // written to Directus means children's FK is unsatisfied.
    //
    // Two cases where we must NOT block children:
    //   1. The operation is UPDATE or DELETE — the record already exists.
    //   2. The operation is CREATE but Directus returned RECORD_NOT_UNIQUE
    //      (HTTP 400, or HTTP 409 from a proxy) meaning the record already
    //      exists, and the fallback PATCH also failed
    //      (failureDetails.recordAlreadyExists = true).
    //      The record IS in Directus; the child FK is satisfiable.
    if (entry.operation === 'create' && failureDetails?.recordAlreadyExists) {
      // Duplicate-record path: record exists in Directus even though this
      // entry failed.  Mark as "processed" so the pendingCreates guard does
      // not defer children whose FK is already satisfied.
      pushedInThisCycle.add(entryKey);
    } else if (entry.operation === 'create') {
      failedCreates.add(entryKey);
      // When the parent CREATE is permanently abandoned (MAX_ATTEMPTS reached),
      // cascade-abandon all in-queue child entries that FK-reference this record.
      // They can never succeed without their parent existing in Directus, so
      // burning their retry budget and flooding the failed-call log is pointless.
      //
      // A local `cascadeAbandoned` set (seeded with the abandoned parent key) is
      // used for matching, NOT the global `failedCreates`.  Using `failedCreates`
      // could falsely cascade children of OTHER parents that merely failed (but
      // were not permanently abandoned) in the same drain cycle.  The local set
      // grows as transitive grandchildren are identified, enabling the BFS-ordered
      // scan to also catch grandchildren in a single pass.
      //
      // The scan is O(n) per abandoned parent.  Abandons are rare (MAX_ATTEMPTS
      // reached) and queue sizes are small, so this is an acceptable trade-off
      // over maintaining a separate reverse-index data structure.
      if (newAttempts >= MAX_ATTEMPTS) {
        const cascadeAbandoned = new Set([entryKey]);
        for (const cascadeEntry of sortedEntries) {
          const cascadeKey = `${cascadeEntry.collection}:${cascadeEntry.record_id}`;
          if (cascadeKey === entryKey) continue;          // skip the parent itself
          // Skip entries already handled by their own failure — but allow
          // FK-deferred entries (in fkDeferredSet) to be cascade-abandoned even
          // though they are also in blockedKeys.
          if (blockedKeys.has(cascadeKey) && !fkDeferredSet.has(cascadeKey)) continue;
          if (pushedInThisCycle.has(cascadeKey)) continue; // already pushed this cycle
          const childDeps = PARENT_DEPENDENCY_MAP.get(cascadeEntry.collection);
          if (!childDeps) continue;
          let isCascadeChild = false;
          for (const childDep of childDeps) {
            const parentId = cascadeEntry.payload?.[childDep.fkField];
            if (parentId) {
              const parentKey = `${childDep.parentCollection}:${parentId}`;
              if (cascadeAbandoned.has(parentKey)) { isCascadeChild = true; break; }
            }
          }
          if (!isCascadeChild) continue;
          const cascadeMsg = `Cascade abandon: parent CREATE ${entryKey} permanently failed`;
          console.warn('[SyncQueue] Cascade-abandoning child entry:', cascadeEntry.id, '—', cascadeMsg);
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('drainQueue:error', { detail: cascadeEntry }));
          }
          await addFailedSyncCall(cascadeEntry, { message: cascadeMsg }, cascadeEntry.attempts ?? 0, true);
          await removeEntry(cascadeEntry.id);
          abandoned++;
          blockedKeys.add(cascadeKey);
          // Enable transitive cascade: if this cascade child is itself a CREATE,
          // add it to the local set so its own children are matched in subsequent
          // iterations of this same scan
          // (e.g. orders→transaction_order_refs after bill_sessions→orders).
          if (cascadeEntry.operation === 'create') {
            cascadeAbandoned.add(cascadeKey);
          }
        }
      }
    }
    return false; // not offline
  }

  // Child CREATEs whose parent was still in pendingCreates (and not yet in
  // pushedInThisCycle) when they were evaluated in the main loop are tracked
  // here for a second pass.  After the main loop completes, pushedInThisCycle
  // may contain parent keys that were processed later in the same cycle (e.g.
  // via the recordAlreadyExists path), allowing the deferred children to be
  // attempted without waiting for the next drain cycle.
  const fkDeferredEntries = [];
  // Parallel set for O(1) lookup in the cascade-abandon scan: entries blocked
  // only by parent FK deferral (not their own failure) must be cascade-abandoned
  // when their parent is permanently abandoned, even though they are in blockedKeys.
  const fkDeferredSet = new Set();

  for (const entry of sortedEntries) {
    const entryKey = `${entry.collection}:${entry.record_id}`;

    // Skip entries whose record chain is blocked by a prior failure this cycle.
    if (blockedKeys.has(entryKey)) continue;

    // Also skip entries whose parent record's CREATE is blocked or still pending
    // (cross-collection FK dependency).
    // For example: if `transactions:txn_1` CREATE failed, we must not attempt
    // `transaction_order_refs` entries whose `payload.transaction === 'txn_1'`
    // because Directus would reject them with a FK-not-found error.
    // The second condition handles the BFS case: a child (attempts=0) may be
    // sorted before its parent CREATE (attempts>0).  If the parent's CREATE is
    // still pending and has not been pushed yet this cycle, defer the child.
    // NOTE: only CREATE failures gate children.  If a parent UPDATE/DELETE fails,
    // the record still exists in Directus so the FK is valid — child entries must
    // not be blocked.
    // A collection can have multiple parents (e.g. transaction_order_refs depends
    // on both 'transactions' and 'orders'); ALL parents are checked.
    // Only CREATE entries need their parent record to exist first.  UPDATE/DELETE
    // operations on a child collection are safe to push regardless of any pending
    // or failed parent CREATE: the child record already exists in Directus (it was
    // created in a prior cycle) so the FK is already satisfied.
    const deps = entry.operation === 'create' ? PARENT_DEPENDENCY_MAP.get(entry.collection) : null;
    if (deps) {
      let skipEntry = false;
      for (const dep of deps) {
        const parentId = entry.payload?.[dep.fkField];
        if (parentId) {
          const parentKey = `${dep.parentCollection}:${parentId}`;
          if (failedCreates.has(parentKey) || (pendingCreates.has(parentKey) && !pushedInThisCycle.has(parentKey))) {
            skipEntry = true;
            break;
          }
        }
      }
      if (skipEntry) {
        fkDeferredEntries.push(entry); // track for second pass (see below)
        fkDeferredSet.add(entryKey);   // allow cascade scan to find us (see _handleEntryFailure)
        blockedKeys.add(entryKey);     // prevent same-record UPDATE/DELETE this cycle
        continue;
      }
    }

    const _pushStart = Date.now();
    const result = await _pushEntry(entry, sdkClient, cfg);
    // AbortError path: drain was cancelled by the caller.  Halt immediately
    // without logging to sync_logs and without burning any retry budget.
    // The returned offline flag remains false — this was not a network failure.
    if (result?.aborted) break;
    _logPushResult(entry, result, Date.now() - _pushStart);

    if (result === 'skip' || (result && typeof result === 'object' && result.ok === true)) {
      await removeEntry(entry.id);
      pushed++;
      // Record as processed so sibling child entries processed later this cycle
      // are not incorrectly deferred by the pendingSet guard, even when this
      // entry was skipped and removed from the queue.
      pushedInThisCycle.add(entryKey);
      if (result !== 'skip') {
        pushedIds.push({ collection: entry.collection, recordId: entry.record_id });
      }
    } else {
      if (await _handleEntryFailure(entry, entryKey, result)) break;
    }
  }

  // ── Second pass: retry FK-deferred child CREATEs ────────────────────────
  // Some child CREATEs were deferred in the main loop because their parent was
  // still in pendingCreates but hadn't been pushed yet.  If the parent was
  // processed later in the same main loop and added to pushedInThisCycle
  // (including the recordAlreadyExists path where the record already existed in
  // Directus), those children can now be attempted in the same cycle rather
  // than waiting for the next drain.
  //
  // Without this second pass, a fresh child (attempts=0) BFS-sorted before a
  // retried parent (attempts>0) would be starved for up to MAX_ATTEMPTS cycles
  // even though the parent record is known to exist in Directus.
  for (const deferredEntry of fkDeferredEntries) {
    if (offline) break;
    const deferredKey = `${deferredEntry.collection}:${deferredEntry.record_id}`;

    // Re-evaluate FK deps with the pushedInThisCycle state updated by the
    // main loop.  If the parent is now satisfiable, attempt the entry.
    const deferredDeps = PARENT_DEPENDENCY_MAP.get(deferredEntry.collection);
    let stillBlocked = false;
    for (const dep of deferredDeps ?? []) {
      const parentId = deferredEntry.payload?.[dep.fkField];
      if (parentId) {
        const parentKey = `${dep.parentCollection}:${parentId}`;
        if (failedCreates.has(parentKey) || (pendingCreates.has(parentKey) && !pushedInThisCycle.has(parentKey))) {
          stillBlocked = true;
          break;
        }
      }
    }
    if (stillBlocked) continue; // parent still pending or failed — retry next cycle

    // Parent is now satisfiable — attempt this entry.
    const _deferredPushStart = Date.now();
    const result = await _pushEntry(deferredEntry, sdkClient, cfg);
    if (result?.aborted) break; // same abort handling as main loop
    _logPushResult(deferredEntry, result, Date.now() - _deferredPushStart);
    if (result === 'skip' || (result && typeof result === 'object' && result.ok === true)) {
      await removeEntry(deferredEntry.id);
      pushed++;
      // Update pushedInThisCycle so subsequent siblings in this same second
      // pass can also proceed if they depend on this entry.
      pushedInThisCycle.add(deferredKey);
      if (result !== 'skip') {
        pushedIds.push({ collection: deferredEntry.collection, recordId: deferredEntry.record_id });
      }
    } else {
      // blockedKeys already contains deferredKey from the first pass, so
      // _handleEntryFailure's blockedKeys.add(entryKey) is a harmless no-op.
      if (await _handleEntryFailure(deferredEntry, deferredKey, result)) break;
    }
  }

  return { pushed, failed, abandoned, pushedIds, offline };
}
