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

/** Maximum push attempts before a queue entry is abandoned. */
export const MAX_ATTEMPTS = 5;

/**
 * Collections that use soft-delete (PATCH { status: 'archived' }) instead of
 * hard DELETE.  Per §5.7.2 strategy (A).
 * @type {Set<string>}
 */
const SOFT_DELETE_COLLECTIONS = new Set([
  'venues', 'rooms', 'tables', 'menu_categories', 'menu_items', 'menu_item_modifiers',
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

/**
 * Local-only fields that must NOT be sent to Directus.
 * @type {Set<string>}
 */
const LOCAL_ONLY_FIELDS = new Set([
  '_sync_status', 'orderItems', 'modifiers',
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
    const db = await getDB();
    await db.add('sync_queue', {
      id: newUUIDv7('sq'),
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

// ── Push drain ───────────────────────────────────────────────────────────────

/**
 * Strips local-only fields from a sync_queue payload before sending to Directus.
 * @param {object|null} payload
 * @returns {object}
 */
function _cleanPayload(payload) {
  if (!payload || typeof payload !== 'object') return {};
  const cleaned = {};
  for (const [k, v] of Object.entries(payload)) {
    if (!LOCAL_ONLY_FIELDS.has(k)) cleaned[k] = v;
  }
  return cleaned;
}

/**
 * Additional fields that exist only in the local store and must not be pushed to
 * Directus (either because they are handled as separate junction collection entries
 * or because they are UI-only computation helpers).
 * @type {Set<string>}
 */
const PUSH_DROP_FIELDS = new Set([
  'timestamp',    // local ISO string; Directus auto-sets date_created via server
  'orderRefs',    // M2M handled separately via transaction_order_refs collection
  'vociRefs',     // M2M handled separately via transaction_voce_refs collection
  'grossAmount',  // UI-only display field (not in Directus schema)
  'changeAmount', // UI-only display field (not in Directus schema)
]);

/**
 * Explicit rename map: local in-app field name → Directus collection field name.
 *
 * Directus FK fields use the related collection name **without** an `_id` suffix
 * (e.g. `bill_session`, not `bill_session_id`). This matches the Directus
 * convention described in DATABASE_SCHEMA.md.
 *
 * @type {Record<string, string>}
 */
const FIELD_RENAME_MAP = {
  // FK fields — Directus convention: no _id suffix
  billSessionId:  'bill_session',
  orderId:        'order',
  dishId:         'dish',
  tableId:        'table',
  // Local PK alias → Directus PK (transactions use `transactionId` locally)
  transactionId:  'id',
  // camelCase → snake_case for domain fields
  totalAmount:        'total_amount',
  itemCount:          'item_count',
  isCoverCharge:      'is_cover_charge',
  isDirectEntry:      'is_direct_entry',
  rejectionReason:    'rejection_reason',
  globalNote:         'global_note',
  unitPrice:          'unit_price',
  voidedQuantity:     'voided_quantity',
  kitchenReady:       'kitchen_ready',
  operationType:      'operation_type',
  paymentMethod:      'payment_method',
  amountPaid:         'amount_paid',
  tipAmount:          'tip_amount',
  romanaSplitCount:   'romana_split_count',
  splitQuota:         'split_quota',
  splitWays:          'split_ways',
  discountType:       'discount_type',
  discountValue:      'discount_value',
};

/**
 * Translates a local (camelCase / legacy-named) record payload into the
 * Directus-compatible field naming convention (snake_case, FK fields without
 * the `_id` suffix as per DATABASE_SCHEMA.md §2 convention notes).
 *
 * The function handles:
 *  - Explicit field renames via FIELD_RENAME_MAP (e.g. `billSessionId` → `bill_session`)
 *  - Special nested objects: `noteVisibility` → `note_visibility_{app}` flat fields,
 *    `dietaryPreferences` → `dietary_diets` / `dietary_allergens`
 *  - `time` → `order_time` (orders only)
 *  - Drop of push-local-only fields (PUSH_DROP_FIELDS + LOCAL_ONLY_FIELDS via _cleanPayload)
 *
 * Only fields present in the input payload are emitted (safe for partial updates).
 *
 * @param {string} collection  - Directus collection name
 * @param {object|null} localPayload
 * @returns {object}  Directus-ready payload
 */
function _toDirectusPayload(collection, localPayload) {
  if (!localPayload || typeof localPayload !== 'object') return {};

  // Strip local-only runtime fields first
  const cleaned = _cleanPayload(localPayload);
  const out = {};

  for (const [key, value] of Object.entries(cleaned)) {
    // Drop push-specific local fields
    if (PUSH_DROP_FIELDS.has(key)) continue;

    // Special: flatten noteVisibility object → per-app boolean columns
    if (key === 'noteVisibility' && value && typeof value === 'object') {
      out.note_visibility_cassa   = value.cassa   ?? true;
      out.note_visibility_sala    = value.sala    ?? true;
      out.note_visibility_cucina  = value.cucina  ?? true;
      continue;
    }

    // Special: flatten dietaryPreferences → dietary_diets / dietary_allergens
    // Note: 'diete' and 'allergeni' are legacy store keys (existing data model);
    // they are read-only from the local payload — not renamed in the store itself.
    if (key === 'dietaryPreferences' && value && typeof value === 'object') {
      out.dietary_diets     = value.diete     ?? null;
      out.dietary_allergens = value.allergeni ?? null;
      continue;
    }

    // Special: `time` → `order_time` only for the orders collection
    if (key === 'time' && collection === 'orders') {
      out.order_time = value;
      continue;
    }

    // Apply explicit rename (camelCase → snake_case, FK without _id suffix)
    const renamed = FIELD_RENAME_MAP[key];
    if (renamed) {
      out[renamed] = value;
      continue;
    }

    // Pass through (already in correct Directus naming or unrecognised field)
    out[key] = value;
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
 * the queue), `false` when it failed and should be retried, or `'skip'` when
 * the entry should be silently discarded (no-op delete on domain-status
 * collection).
 *
 * @param {object} entry
 * @param {import('@directus/sdk').DirectusClient<object>} sdkClient
 * @returns {Promise<true|false|'skip'>}
 */
async function _pushEntry(entry, sdkClient) {
  const { collection, operation, record_id, payload } = entry;

  // Translate local field names to Directus schema names for all non-delete operations
  const directusPayload = _toDirectusPayload(collection, payload);

  // Ensure the primary key is always present in create payloads.
  // This guards against cases where the local PK alias was renamed (e.g.
  // `transactionId` → `id`) or was simply not included in a partial payload.
  if (operation === 'create' && !directusPayload.id && record_id) {
    directusPayload.id = record_id;
  }

  try {
    if (operation === 'delete') {
      if (DOMAIN_STATUS_COLLECTIONS.has(collection)) {
        // Strategy B: lifecycle via status — silently skip hard deletes
        return 'skip';
      }
      if (SOFT_DELETE_COLLECTIONS.has(collection)) {
        // Strategy A: soft-delete via PATCH { status: 'archived' }
        await sdkClient.request(updateItem(collection, record_id, { status: 'archived' }));
      } else {
        // Strategy C: junction tables — hard DELETE
        await sdkClient.request(deleteItem(collection, record_id));
      }
    } else if (operation === 'create') {
      try {
        await sdkClient.request(createItem(collection, directusPayload));
      } catch (createError) {
        // 409 Conflict: duplicate UUIDv7 — retry as update
        if (createError?.response?.status === 409) {
          await sdkClient.request(updateItem(collection, record_id, directusPayload));
        } else {
          throw createError;
        }
      }
    } else {
      // update
      await sdkClient.request(updateItem(collection, record_id, directusPayload));
    }

    return true;
  } catch (e) {
    console.warn(`[SyncQueue] Error on ${operation} ${collection}/${record_id}:`, e?.message ?? e);
    return false;
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
 * @param {{ url: string, staticToken: string, _backoffMs?: number }} cfg
 *   Directus connection config.  `_backoffMs` overrides the exponential
 *   back-off base (default 1000 ms); set to 0 in tests to skip all delays.
 * @returns {Promise<{ pushed: number, failed: number, abandoned: number }>}
 */
export async function drainQueue(cfg) {
  const sdkClient = _buildRestClient(cfg);
  const entries = await getPendingEntries();
  const backoffBase = typeof cfg._backoffMs === 'number' ? cfg._backoffMs : 1000;
  let pushed = 0, failed = 0, abandoned = 0;

  for (const entry of entries) {
    const result = await _pushEntry(entry, sdkClient);

    if (result === true || result === 'skip') {
      await removeEntry(entry.id);
      pushed++;
    } else {
      const newAttempts = (entry.attempts ?? 0) + 1;
      if (newAttempts >= MAX_ATTEMPTS) {
        console.warn(`[SyncQueue] Abandoning entry after ${MAX_ATTEMPTS} attempts:`, entry);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('drainQueue:error', { detail: entry }));
        }
        await removeEntry(entry.id);
        abandoned++;
      } else {
        await incrementAttempts(entry.id);
        failed++;
        // Exponential back-off: pause 2^attempts × backoffBase ms before next entry
        const delayMs = Math.min(2 ** newAttempts * backoffBase, 30_000);
        if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }

  return { pushed, failed, abandoned };
}
