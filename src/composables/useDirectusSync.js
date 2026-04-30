/**
 * @file composables/useDirectusSync.js
 * @description Bidirectional sync composable — Step 2 di §5.7.8.
 *
 * Gestisce:
 *  - Push loop  (§5.7.2): svuota la sync_queue verso Directus via SDK.
 *  - Pull loop  (§5.7.3): WebSocket subscriptions (SDK realtime) con fallback
 *                          a polling periodico se il WebSocket non è disponibile.
 *  - Conflict resolution (§5.7.4): last-write-wins su date_updated.
 *
 * Utilizzo (in ogni App root):
 *   const sync = useDirectusSync();
 *   onMounted(() => sync.startSync({ appType: 'cassa', store }));
 *   onUnmounted(() => sync.stopSync());
 *
 * Il composable è un singleton a livello di modulo.
 */

import { ref } from 'vue';
import { createDirectus, staticToken, rest, readItems, readItem } from '@directus/sdk';
import { appConfig, createRuntimeConfig, DEFAULT_SETTINGS } from '../utils/index.js';
import {
  mapOrderFromDirectus,
  mapOrderItemFromDirectus,
  mapBillSessionFromDirectus,
  mapVenueConfigFromDirectus,
  mapMenuItemFromDirectus,
  mapMenuCategoryFromDirectus,
  mapMenuModifierFromDirectus,
  mapMenuCategoryModifierLinkFromDirectus,
  mapMenuItemModifierLinkFromDirectus,
  mapTableMergeSessionFromDirectus,
  mergeOrderFromWSPayload,
  mergeOrderItemFromWSPayload,
  relationId,
} from '../utils/mappers.js';
import { getDirectusClient, resetDirectusClient } from './useDirectusClient.js';
import { drainQueue } from './useSyncQueue.js';
import {
  loadStateFromIDB,
  upsertRecordsIntoIDB,
  deleteRecordsFromIDB,
} from '../store/persistence/operations.js';
import { getDB } from './useIDB.js';
import {
  loadConfigFromIDB,
  loadLastPullTsFromIDB,
  saveLastPullTsToIDB,
  replaceTableMergesInIDB,
  replaceVenueUsersInIDB,
  clearLocalConfigCacheFromIDB,
} from '../store/persistence/config.js';
import { reloadUsersFromIDB } from './useAuth.js';
import { addSyncLog } from '../store/persistence/syncLogs.js';

// ── Per-app pull config (§5.7.6) ─────────────────────────────────────────────

/** @type {Record<string, { collections: string[], intervalMs: number }>} */
const PULL_CONFIG = {
  cassa: {
    collections: ['orders', 'order_items', 'bill_sessions', 'tables'],
    // 30 s polling: frequent enough for near-real-time UX while keeping
    // backend load low. Use wsEnabled=true for sub-second updates if the
    // Directus instance supports WebSocket subscriptions.
    intervalMs: 30_000,
  },
  sala: {
    collections: ['orders', 'order_items', 'bill_sessions', 'tables', 'menu_items'],
    intervalMs: 30_000,
  },
  cucina: {
    collections: ['orders', 'order_items'],
    intervalMs: 30_000,
  },
};

/** Collections for all apps: fetched once at startup and every 5 minutes. */
const VENUE_RELATED_COLLECTIONS = [
  'venues', 'rooms', 'tables', 'payment_methods',
  'menu_categories', 'menu_items', 'menu_modifiers',
  'menu_categories_menu_modifiers', 'menu_items_menu_modifiers',
  'printers', 'venue_users', 'table_merge_sessions',
];
const DEEP_FETCH_FIELDS = [
  '*',
  'rooms.*',
  'rooms.tables.*',
  'tables.*',
  'payment_methods.*',
  'menu_categories.*',
  'menu_categories.menu_items.*',
  'menu_categories.menu_modifiers.menu_modifiers_id.*',
  'menu_items.*',
  'menu_items.menu_modifiers.menu_modifiers_id.*',
  'printers.*',
  'users.*',
  'table_merge_sessions.*',
];
const DEEP_FETCH_BASE_RELATION_FIELDS = [
  '*',
  'rooms.*',
  'tables.*',
  'payment_methods.*',
  'printers.*',
  'users.*',
  'table_merge_sessions.*',
];
const DEEP_FETCH_FALLBACK_FIELDS = [
  ...DEEP_FETCH_BASE_RELATION_FIELDS,
  'rooms.tables.*',
  'menu_categories.*',
  'menu_categories.menu_items.*',
  'menu_items.*',
];
const DEEP_FETCH_FIELD_SETS = [
  { key: 'full', fields: DEEP_FETCH_FIELDS },
  { key: 'fallback', fields: DEEP_FETCH_FALLBACK_FIELDS },
];
const DEEP_FETCH_JSON_FIELDS = [
  'id',
  'name',
  'status',
  'date_updated',
  'primary_color',
  'primary_color_dark',
  'currency_symbol',
  'allow_custom_variants',
  'orders_rejection_reasons',
  'users.*',
  'cover_charge_enabled',
  'cover_charge_auto_add',
  'cover_charge_price_adult',
  'cover_charge_price_child',
  'billing_auto_close_on_full_payment',
  'billing_enable_cash_change_calculator',
  'billing_enable_tips',
  'billing_enable_discounts',
  'billing_allow_custom_entry',
];
const DEEP_FETCH_JSON_FIELD_SETS = [
  { key: 'json_minimal', fields: DEEP_FETCH_JSON_FIELDS },
];
const VENUE_NESTED_RELATION_KEYS = [
  'rooms',
  'tables',
  'payment_methods',
  'menu_categories',
  'menu_items',
  'printers',
  'venue_users',
  'table_merge_sessions',
];
const VENUE_USERS_RELATION_KEYS = ['venue_users', 'users'];
const GLOBAL_INTERVAL_MS = 5 * 60_000;
const TABLE_FETCH_BATCH_SIZE = 200;
const DEEP_FETCH_PAYLOAD_UNWRAP_MAX_DEPTH = 3;
// Maximum number of records stored verbatim in a sync log entry.
// Keeps the Activity Monitor readable and IDB storage bounded on large pulls.
const SYNC_LOG_RECORDS_MAX = 20;
const SUPPORTS_STRUCTURED_CLONE = typeof structuredClone === 'function';
// Allow substantial device/server clock drift before treating last_pull_ts as invalid.
// 24h avoids perpetual full-refreshes on slightly misconfigured tablets while still
// catching clearly bogus cursors (for example, year 2099).
const GLOBAL_TIMESTAMP_SKEW_TOLERANCE_MS = 24 * 60 * 60_000;

/**
 * Per-collection quirks for collections that deviate from the default schema
 * assumed by _fetchUpdatedViaSDK (venue FK + date_updated timestamp field).
 *
 * H3: Some collections don't expose the standard `venue` FK and/or `date_updated`.
 * In these cases we must skip unsupported filters to avoid Directus API errors.
 *
 * Some collections (for example `venues`) intentionally don't expose a `venue`
 * FK and therefore must skip the tenant filter in REST/WS queries.
 *
 * Collections without a direct `venue` FK but reachable via a relational path
 * can use a `venueFilter` function to return the appropriate Directus filter
 * object instead of the default `{ venue: { _eq: venueId } }`.
 */
const COLLECTION_QUIRKS = {
  venues: { noVenueFilter: true },
  // `order_items` has no direct `venue` FK — it is scoped to the venue via its
  // parent order.  Filtering by `order.venue` avoids the Directus 403 error that
  // would result from referencing a non-existent top-level field.
  order_items: { venueFilter: (venueId) => ({ order: { venue: { _eq: venueId } } }) },
};

// ── Field mapping: Directus → local in-memory store format ───────────────────

function _mapRecord(collection, r) {
  if (collection === 'orders') return mapOrderFromDirectus(r);
  if (collection === 'bill_sessions') return mapBillSessionFromDirectus(r);
  if (collection === 'order_items') return mapOrderItemFromDirectus(r);
  if (collection === 'menu_items') return mapMenuItemFromDirectus(r);
  if (collection === 'menu_categories') return mapMenuCategoryFromDirectus(r);
  if (collection === 'menu_modifiers') return mapMenuModifierFromDirectus(r);
  if (collection === 'menu_categories_menu_modifiers') return mapMenuCategoryModifierLinkFromDirectus(r);
  if (collection === 'menu_items_menu_modifiers') return mapMenuItemModifierLinkFromDirectus(r);
  if (collection === 'table_merge_sessions') return mapTableMergeSessionFromDirectus(r);
  return { ...r, _sync_status: 'synced' };
}

async function _refreshStoreFromIDB(collection = null) {
  if (!_store) return;
  if (typeof _store.refreshOperationalStateFromIDB === 'function') {
    await _store.refreshOperationalStateFromIDB(collection ? { collection } : {});
    return;
  }
  if (typeof _store.refreshFromIDB === 'function') {
    await _store.refreshFromIDB(collection);
    return;
  }
  // No further fallback: stores must expose refreshOperationalStateFromIDB or refreshFromIDB
  // to preserve strict IDB-first semantics. Direct assignment is intentionally omitted.
  console.warn('[DirectusSync] Store refresh API missing; skipping to preserve strict IDB-first.');
}

async function _refreshStoreConfigFromIDB(options = {}) {
  if (!_store) return;
  if (typeof _store.hydrateConfigFromIDB === 'function') {
    await _store.hydrateConfigFromIDB(options);
    return;
  }
  console.warn('[Directus] hydrateConfigFromIDB not available on store; skipping config refresh.');
}

function _extractRecordIds(records) {
  return records
    .map((r) => String(r?.id ?? r))
    .filter(Boolean);
}

/**
 * Prepares mapped pull records before IDB upsert.
 * `cachedState` reuses a previously loaded state snapshot across paginated
 * pulls, avoiding repeated `loadStateFromIDB()` calls per page. `undefined`
 * means "not loaded yet", while `null` means "loaded, but no state available".
 */
async function _preparePullRecordsForIDB(collection, mapped, cachedState = undefined) {
  if (!Array.isArray(mapped) || mapped.length === 0) {
    return { records: mapped, state: cachedState };
  }
  if (collection !== 'orders' && collection !== 'bill_sessions') {
    return { records: mapped, state: cachedState };
  }

  const state = cachedState === undefined ? await loadStateFromIDB() : cachedState;
  if (!state) {
    return { records: mapped, state };
  }

  if (collection === 'orders') {
    const existingById = new Map(
      (Array.isArray(state.orders) ? state.orders : [])
        .filter((record) => record?.id)
        .map((record) => [String(record.id), record]),
    );
    const records = mapped.map((incoming) => {
      const existing = existingById.get(String(incoming?.id ?? ''));
      if (!existing) return incoming;
      if (Array.isArray(existing.orderItems) && existing.orderItems.length > 0) {
        const hasIncomingItems = Array.isArray(incoming.orderItems) && incoming.orderItems.length > 0;
        if (!hasIncomingItems) {
          return { ...incoming, orderItems: existing.orderItems };
        }
      }
      return incoming;
    });
    return { records, state };
  }

  const existingByBillSessionId = new Map(
    Object.values(state.tableCurrentBillSession ?? {})
      .filter((session) => session?.billSessionId)
      .map((session) => [String(session.billSessionId), session]),
  );
  const records = mapped.map((incoming) => {
    const billSessionId = incoming?.billSessionId ?? incoming?.id;
    const existing = billSessionId != null
      ? existingByBillSessionId.get(String(billSessionId))
      : null;
    if (!existing) return incoming;
    if ((incoming.opened_at == null || incoming.opened_at === '') && existing.opened_at) {
      return { ...incoming, opened_at: existing.opened_at };
    }
    return incoming;
  });
  return { records, state };
}

// ── REST pull helpers ─────────────────────────────────────────────────────────

/**
 * Builds a fresh REST-only client, passing the current `globalThis.fetch`
 * so that test spies installed after module load are picked up correctly.
 * (The Directus SDK caches `globalThis.fetch` at `createDirectus()` call time.)
 */
function _buildRestClient(cfg) {
  return createDirectus(cfg.url, { globals: { fetch: globalThis.fetch } })
    .with(staticToken(cfg.staticToken))
    .with(rest());
}

async function _fetchUpdatedViaSDK(collection, sinceTs, page = 1) {
  const cfg = _getCfg();
  if (!cfg) return { data: [], maxTs: null, error: null };

  const quirks = COLLECTION_QUIRKS[collection] ?? {};
  const client = _buildRestClient(cfg);
  // For orders, expand nested order_items and their modifiers so that the
  // detail view is populated even on a fresh device that has never locally
  // created those orders.
  // For order_items, also expand order_item_modifiers so that the modifier
  // detail is available when order_items are pulled as a standalone collection
  // (e.g. cucina app, or the fallback separate-pull path in cassa/sala).
  let pullFields;
  if (collection === 'orders') {
    pullFields = ['*', 'order_items.*', 'order_items.order_item_modifiers.*'];
  } else if (collection === 'order_items') {
    pullFields = ['*', 'order_item_modifiers.*'];
  } else {
    pullFields = ['*'];
  }
  const query = {
    limit: 200,
    page,
    // Primary sort by date_updated (or id for quirk collections); secondary by
    // date_created and id to guarantee a stable, deterministic page order when
    // many records share the same date_updated value (including null).
    sort: quirks.noDateUpdated ? ['id'] : ['date_updated', 'date_created', 'id'],
    fields: pullFields,
  };

  // Incremental pull filter (only records updated/created at or after last known timestamp).
  // Skipped for collections that have no date_updated field (noDateUpdated quirk).
  //
  // Directus sets date_updated only when a record is PATCHed, not on initial creation,
  // so newly created records have date_updated = null. Without the _or clause those
  // records would be invisible to every incremental poll after the initial full pull.
  //
  // We use _gte (≥) instead of _gt (>) so that records whose date_updated/date_created
  // equals sinceTs are always re-fetched.  This is necessary because multiple PATCH
  // operations performed on the same record in rapid succession can land at the same
  // server-clock second (or even millisecond), meaning the final update shares the exact
  // same timestamp as the version already seen by the pulling device.  A strict _gt
  // filter would permanently skip those boundary records on every subsequent poll.
  // upsertRecordsIntoIDB handles the re-fetch idempotently: it only writes when the
  // incoming timestamp is ≥ the stored one (preferring the freshest server payload).
  const conditions = [];
  if (sinceTs && !quirks.noDateUpdated) {
    conditions.push({
      _or: [
        { date_updated: { _gte: sinceTs } },
        { _and: [{ date_updated: { _null: true } }, { date_created: { _gte: sinceTs } }] },
      ],
    });
  }
  // Venue filter — skipped for collections without a `venue` FK (noVenueFilter quirk).
  // Collections with a custom `venueFilter` use a relational path instead of
  // the default `{ venue: { _eq: venueId } }`.
  // (This filtering logic lives inside `_fetchUpdatedViaSDK`, which owns REST pull queries.
  //  The WebSocket subscription path in `_startSubscriptions` applies the same quirks.)
  if (!quirks.noVenueFilter && cfg.venueId != null) {
    const venueCondition = quirks.venueFilter
      ? quirks.venueFilter(cfg.venueId)
      : { venue: { _eq: cfg.venueId } };
    conditions.push(venueCondition);
  }
  if (conditions.length === 1) {
    query.filter = conditions[0];
  } else if (conditions.length > 1) {
    query.filter = { _and: conditions };
  }

  const _pullStart = Date.now();
  try {
    const records = await client.request(readItems(collection, query));
    const _pullDuration = Date.now() - _pullStart;
    const data = Array.isArray(records) ? records : [];
    // Use date_updated as the primary cursor value, falling back to date_created
    // for records where date_updated is null (i.e. created but never patched).
    const timestamps = data.map(r => r.date_updated ?? r.date_created).filter(Boolean);
    const maxTs = timestamps.length > 0 ? timestamps.reduce((a, b) => (a > b ? a : b)) : null;
    addSyncLog({
      direction: 'IN',
      type: 'PULL',
      endpoint: `/items/${collection}`,
      payload: { collection, page, filter: query.filter ?? null, since: sinceTs ?? null },
      response: { count: data.length, maxTs, records: data.length <= SYNC_LOG_RECORDS_MAX ? data : data.slice(0, SYNC_LOG_RECORDS_MAX) },
      status: 'success',
      statusCode: 200,
      durationMs: _pullDuration,
      collection,
      recordCount: data.length,
    });
    return { data, maxTs, error: null };
  } catch (e) {
    console.warn(`[DirectusSync] Pull ${collection} error:`, e?.message ?? e);
    addSyncLog({
      direction: 'IN',
      type: 'PULL',
      endpoint: `/items/${collection}`,
      payload: { collection, page, filter: query.filter ?? null, since: sinceTs ?? null },
      response: { error: e?.message ?? String(e) },
      status: 'error',
      statusCode: e?.response?.status ?? null,
      durationMs: Date.now() - _pullStart,
      collection,
      recordCount: 0,
    });
    return { data: [], maxTs: null, error: e };
  }
}

/**
 * Merges an array of freshly-pulled order_items into their parent orders stored
 * in the `orders` IDB ObjectStore.
 *
 * The `orders` store persists each order with an embedded `orderItems` array
 * (populated when orders are fetched with `fields: ['*', 'order_items.*']`).
 * When the cucina app pulls order_items directly via the `order_items` collection
 * those records land in a separate `order_items` ObjectStore and never reach the
 * embedded arrays — causing the in-memory store to show stale item data even
 * after a successful pull.
 *
 * This function bridges the gap: for each affected order it loads the current
 * record, upserts the incoming items (last-write-wins on date_updated/date_created),
 * and writes the result back before the orders store refresh fires.
 *
 * @param {Array<object>} pulledItems - Mapped order_item records (from _mapRecord).
 * @param {Array<object>} [rawItems]  - Optional raw Directus records (snake_case, same
 *   length/order as pulledItems). May come from a WS event or a REST pull response.
 *   When provided, existing embedded items are merged via `mergeOrderItemFromWSPayload`
 *   so that absent mapped-default fields (quantity, unit_price, etc.) never clobber
 *   real IDB values with zeros.
 */
async function _mergeOrderItemsIntoOrdersIDB(pulledItems, rawItems = null) {
  if (!pulledItems || pulledItems.length === 0) return;
  try {
    const db = await getDB();

    // Build a raw-payload lookup if rawItems were provided (WS or REST pull path).
    const rawById = new Map();
    if (rawItems && rawItems.length === pulledItems.length) {
      for (let i = 0; i < rawItems.length; i++) {
        const id = String(pulledItems[i]?.id ?? pulledItems[i]?.uid ?? '');
        if (id) rawById.set(id, rawItems[i]);
      }
    }

    // Group items by parent order ID
    const itemsByOrderId = new Map();
    for (const item of pulledItems) {
      const orderId = item?.order ?? item?.orderId;
      if (!orderId) continue;
      const key = String(orderId);
      if (!itemsByOrderId.has(key)) itemsByOrderId.set(key, []);
      itemsByOrderId.get(key).push(item);
    }
    if (itemsByOrderId.size === 0) return;

    const tx = db.transaction('orders', 'readwrite');
    for (const [orderId, items] of itemsByOrderId) {
      const order = await tx.store.get(orderId);
      if (!order) continue;

      const existingItems = Array.isArray(order.orderItems) ? order.orderItems : [];
      const byId = new Map(existingItems.map(i => [String(i.id ?? i.uid ?? ''), i]));

      for (const item of items) {
        const itemId = String(item.id ?? item.uid ?? '');
        if (!itemId) continue;
        const existing = byId.get(itemId);
        if (!existing) {
          byId.set(itemId, item);
        } else {
          // Last-write-wins using date_updated, falling back to date_created.
          // Use Date-based comparison (consistent with upsertRecordsIntoIDB):
          // incoming wins when existing has no timestamp (can't compare), or
          // the incoming timestamp is newer than or equal to the existing one.
          // Ties (same timestamp) favour the incoming payload so that rapid back-
          // to-back PATCHes processed within the same server-clock millisecond are
          // never silently dropped.
          // If incoming has no timestamp but existing does, keep the existing record.
          const existingTs = existing.date_updated ?? existing.date_created ?? null;
          const incomingTs = item.date_updated ?? item.date_created ?? null;
          const incomingWins = !existingTs || (incomingTs != null && new Date(incomingTs) >= new Date(existingTs));
          if (incomingWins) {
            // When a raw WS payload is available, use the selective merge so that
            // mapper-supplied defaults for absent fields (e.g. quantity → 0) never
            // overwrite real values already stored in the embedded item.
            const rawPayload = rawById.get(itemId);
            byId.set(itemId, rawPayload
              ? mergeOrderItemFromWSPayload(existing, rawPayload, item)
              : { ...existing, ...item });
          }
          // else: existing is newer — keep the map unchanged
        }
      }

      const mergedItems = Array.from(byId.values()).filter(i => i.id ?? i.uid);
      // A shallow spread is intentional here: IDB's put() performs its own
      // structured-clone serialisation so shared nested references (notes,
      // modifiers) are safely deep-copied before being written to the store.
      await tx.store.put({ ...order, orderItems: mergedItems });
    }
    await tx.done;
  } catch (e) {
    console.warn('[DirectusSync] _mergeOrderItemsIntoOrdersIDB failed:', e);
    throw e;
  }
}

/**
 * Removes deleted order_items (identified by their IDs) from the embedded
 * `orderItems` arrays of their parent orders in the `orders` IDB ObjectStore.
 *
 * Called by `_handleSubscriptionMessage` when a WS `delete` event arrives for
 * the `order_items` collection so that cucina devices with wsEnabled see the
 * deletion reflected in the orders store without waiting for the next poll.
 *
 * @param {string[]} deletedIds - IDs of the deleted order_item records.
 */
async function _removeOrderItemsFromOrdersIDB(deletedIds) {
  if (!deletedIds || deletedIds.length === 0) return;
  try {
    const db = await getDB();
    const deletedSet = new Set(deletedIds.map(String));
    const tx = db.transaction(['order_items', 'orders'], 'readwrite');
    const orderItemsStore = tx.objectStore('order_items');
    const ordersStore = tx.objectStore('orders');
    const affectedOrderIds = new Set();

    // Resolve only the parent orders for the deleted items, so we do not scan
    // the entire orders store on every WS delete event.
    const resolvedIds = new Set();
    for (const deletedId of deletedSet) {
      const orderItem = await orderItemsStore.get(deletedId);
      if (!orderItem) continue;
      resolvedIds.add(deletedId);

      const parentOrderId = relationId(
        orderItem.order ?? orderItem.orders_id ?? orderItem.order_id ?? orderItem.orderId,
      );
      if (parentOrderId != null && parentOrderId !== '') {
        affectedOrderIds.add(String(parentOrderId));
      }
    }

    for (const orderId of affectedOrderIds) {
      const order = await ordersStore.get(orderId);
      if (!order) continue;

      const items = Array.isArray(order.orderItems) ? order.orderItems : [];
      const filtered = items.filter(i => {
        const itemId = String(i.id ?? i.uid ?? '');
        return !deletedSet.has(itemId);
      });

      if (filtered.length !== items.length) {
        await ordersStore.put({ ...order, orderItems: filtered });
      }
    }

    // Fallback: for deleted IDs that weren't in the order_items store (e.g. on a
    // fresh device before the first order_items pull), scan all orders to remove
    // any matching embedded items.  This O(#orders) pass only runs when some IDs
    // could not be resolved via the fast lookup above.
    const unresolvedIds = new Set();
    for (const id of deletedSet) {
      if (!resolvedIds.has(id)) unresolvedIds.add(id);
    }
    if (unresolvedIds.size > 0) {
      let cursor = await ordersStore.openCursor();
      while (cursor) {
        const order = cursor.value;
        const items = Array.isArray(order.orderItems) ? order.orderItems : [];
        const filtered = items.filter(i => !unresolvedIds.has(String(i.id ?? i.uid ?? '')));
        if (filtered.length !== items.length) {
          await cursor.update({ ...order, orderItems: filtered });
        }
        cursor = await cursor.continue();
      }
    }
    await tx.done;
  } catch (e) {
    console.warn('[DirectusSync] _removeOrderItemsFromOrdersIDB failed:', e);
    throw e;
  }
}

async function _pullCollection(collection, { forceFull = false, lastPullTimestampOverride = null } = {}) {
  if (collection === 'table_merge_sessions' && forceFull) {
    let page = 1;
    let latestTs = null;
    const allMapped = [];
    let hadFetchError = false;
    while (true) { // eslint-disable-line no-constant-condition
      const { data, maxTs, error } = await _fetchUpdatedViaSDK(collection, null, page);
      if (error) hadFetchError = true;
      if (data.length === 0) break;
      const mapped = data.map(r => _mapRecord(collection, r));
      allMapped.push(...mapped);
      if (maxTs && (!latestTs || maxTs > latestTs)) latestTs = maxTs;
      if (data.length < 200) break;
      page++;
    }
    if (!hadFetchError) {
      await replaceTableMergesInIDB(allMapped);
      await _refreshStoreFromIDB('table_merge_sessions');
      if (latestTs) await saveLastPullTsToIDB(collection, latestTs);
    }
    return { merged: allMapped.length, ok: !hadFetchError };
  }

  // forceFull always wins: ignore both lastPullTimestampOverride and persisted cursor.
  const storedSinceTs = forceFull
    ? null
    : lastPullTimestampOverride ?? await loadLastPullTsFromIDB(collection);
  let page = 1;
  let latestTs = storedSinceTs;
  let totalMerged = 0;
  let hadFetchError = false;
  let hadRemoteRecords = false;
  let cachedState = undefined;
  // Collect all mapped order_items across pages so they can be merged into their
  // parent orders in the `orders` IDB store after the pull completes.
  // rawPulledOrderItems mirrors pulledOrderItems but contains the unmodified
  // Directus API records so that _mergeOrderItemsIntoOrdersIDB can use
  // mergeOrderItemFromWSPayload to avoid clobbering existing embedded modifier
  // data with mapper defaults (e.g. `modifiers: []` from ID-only relation fields).
  const pulledOrderItems = collection === 'order_items' ? [] : null;
  const rawPulledOrderItems = collection === 'order_items' ? [] : null;

  while (true) { // eslint-disable-line no-constant-condition
    const { data, maxTs, error } = await _fetchUpdatedViaSDK(collection, storedSinceTs, page);
    if (error) hadFetchError = true;
    if (data.length === 0) break;
    hadRemoteRecords = true;

    const mapped = data.map(r => _mapRecord(collection, r));
    if (pulledOrderItems !== null) {
      pulledOrderItems.push(...mapped);
      rawPulledOrderItems.push(...data);
    }
    const preparedResult = await _preparePullRecordsForIDB(collection, mapped, cachedState);
    cachedState = preparedResult.state;
    const prepared = preparedResult.records;
    const written = await upsertRecordsIntoIDB(collection, prepared);
    totalMerged += written;

    if (maxTs && (!latestTs || maxTs > latestTs)) latestTs = maxTs;
    if (data.length < 200) break;
    page++;
  }

  if (hadRemoteRecords) {
    if (collection === 'order_items') {
      // Merge pulled items into their parent orders in the `orders` IDB store so
      // that refreshOperationalStateFromIDB('orders') picks up the latest items.
      // This is necessary because the cucina app pulls order_items directly and
      // `refreshOperationalStateFromIDB` has no handler for the 'order_items' key.
      // Errors from the merge are propagated: if the merge fails, treat it like a
      // fetch error so the cursor does not advance and the cycle retries next poll.
      try {
        await _mergeOrderItemsIntoOrdersIDB(pulledOrderItems, rawPulledOrderItems);
      } catch (e) {
        console.warn('[DirectusSync] order_items merge failed; cursor will not advance:', e);
        hadFetchError = true;
      }
      await _refreshStoreFromIDB('orders');
    } else {
      await _refreshStoreFromIDB(collection);
    }
  }

  if (!hadFetchError && latestTs && latestTs !== storedSinceTs) {
    await saveLastPullTsToIDB(collection, latestTs);
  }

  return { merged: totalMerged, ok: !hadFetchError };
}

// ── WebSocket subscription helpers ───────────────────────────────────────────

/** Active unsubscribe callbacks. */
const _unsubscribers = [];
/** Whether we are currently connected via WebSocket. */
const _wsConnected = ref(false);

/**
 * Processes an incoming realtime message from Directus Subscriptions.
 * Maps records to local format, upserts into IDB, and merges into the store.
 *
 * Self-echo suppression: records that this device pushed within the last
 * ECHO_SUPPRESS_TTL_MS are filtered out to prevent redundant IDB writes and
 * transient UI rewrites caused by receiving our own changes back via WebSocket.
 *
 * @param {string} collection
 * @param {{ event: string, data: Array<object|string> }} message
 */
async function _handleSubscriptionMessage(collection, message) {
  const { event, data } = message;
  if (!data || !Array.isArray(data) || data.length === 0) return;

  let writtenCount = data.length;
  let suppressedCount = 0;

  if (event === 'delete') {
    // Filter out records that this device just pushed (self-echo suppression).
    const ids = _extractRecordIds(data);
    const nonEchoIds = ids.filter(id => !_isEchoSuppressed(collection, id != null ? String(id) : null));
    suppressedCount = ids.length - nonEchoIds.length;
    writtenCount = nonEchoIds.length;
    if (suppressedCount > 0) {
      console.debug(
        `[DirectusSync] WS ${event} on ${collection}: suppressed ${suppressedCount} self-echo(es)`,
      );
    }
    if (nonEchoIds.length === 0) return;
    if (collection === 'table_merge_sessions') {
      await _pullCollection('table_merge_sessions', { forceFull: true });
      return;
    }
    if (collection === 'order_items') {
      // Deletes from the items ObjectStore must also remove the item from the
      // embedded orderItems array of the parent order so that the orders store
      // stays consistent on cucina devices with wsEnabled.
      // IMPORTANT: _removeOrderItemsFromOrdersIDB must run BEFORE deleteRecordsFromIDB
      // because it looks up the parent order ID via the order_items ObjectStore;
      // if we delete first, the lookup finds nothing and the embedded array is not cleaned up.
      await _removeOrderItemsFromOrdersIDB(nonEchoIds);
      await deleteRecordsFromIDB(collection, nonEchoIds);
      await _refreshStoreFromIDB('orders');
      return;
    }
    await deleteRecordsFromIDB(collection, nonEchoIds);
    await _refreshStoreFromIDB(collection);
  } else {
    // Defensively drop any non-object entries that should never appear for
    // non-delete events but could arrive from a malformed or unexpected
    // subscription message shape (e.g. bare ID strings).  Spreading a string
    // in _mapRecord would produce corrupted character-indexed records in IDB.
    const objectData = data.filter(r => {
      if (typeof r === 'object' && r !== null) return true;
      console.warn(`[DirectusSync] WS ${event} on ${collection}: unexpected non-object entry ignored`, r);
      return false;
    });
    // Filter out records that this device just pushed (self-echo suppression).
    const nonEcho = objectData.filter(r => {
      const id = r.id != null ? String(r.id) : null;
      return !_isEchoSuppressed(collection, id);
    });
    suppressedCount = objectData.length - nonEcho.length;
    writtenCount = nonEcho.length;
    if (suppressedCount > 0) {
      console.debug(
        `[DirectusSync] WS ${event} on ${collection}: suppressed ${suppressedCount} self-echo(es)`,
      );
    }
    if (nonEcho.length === 0) return;
    const mapped = nonEcho.map(r => _mapRecord(collection, r));
    // WS subscriptions use fields:['*'] which does NOT expand nested relations
    // (e.g. order_items), and can also send partial payloads (e.g. only
    // {id, status, date_updated}) for status-change events. mapOrderFromDirectus()
    // fills all absent fields with zero/empty defaults, so a straight put() would
    // wipe IDB fields like totalAmount, globalNote, orderItems etc.
    //
    // For update events we therefore fetch the existing IDB record and merge via
    // mergeOrderFromWSPayload(), overwriting only the fields present in the raw
    // WS payload. create events use the incoming record as-is.
    let prepared = mapped;
    if (collection === 'orders' && event !== 'create') {
      try {
        const db = await getDB();
        prepared = await Promise.all(nonEcho.map(async (raw, i) => {
          const incoming = mapped[i];
          const id = incoming?.id;
          if (!id) return incoming;
          try {
            const existing = await db.get('orders', String(id));
            if (!existing) return incoming;
            return mergeOrderFromWSPayload(existing, raw, incoming);
          } catch (e) {
            console.warn('[DirectusSync] WS order merge: IDB lookup failed for', id, e);
            return incoming;
          }
        }));
      } catch (e) {
        console.warn('[DirectusSync] WS order merge: IDB unavailable, falling back to incoming records', e);
        prepared = mapped;
      }
    }
    // For order_items updates, apply the same selective-merge strategy: load the
    // existing IDB record and merge only the fields present in the raw WS payload.
    // This prevents absent numeric/relation fields (quantity, unit_price, order FK,
    // notes, etc.) from being clobbered with mapper-supplied defaults (e.g. quantity → 0)
    // when Directus sends a partial payload (e.g. {id, kitchen_ready, date_updated}).
    // create events use the incoming record as-is (no prior IDB record to merge with).
    if (collection === 'order_items' && event !== 'create') {
      try {
        const db = await getDB();
        prepared = await Promise.all(nonEcho.map(async (raw, i) => {
          const incoming = mapped[i];
          const id = incoming?.id;
          if (!id) return incoming;
          try {
            const existing = await db.get('order_items', String(id));
            if (!existing) return incoming;
            return mergeOrderItemFromWSPayload(existing, raw, incoming);
          } catch (e) {
            console.warn('[DirectusSync] WS order_items merge: IDB lookup failed for', id, e);
            return incoming;
          }
        }));
      } catch (e) {
        console.warn('[DirectusSync] WS order_items merge: IDB unavailable, falling back to incoming records', e);
        prepared = mapped;
      }
    }
    await upsertRecordsIntoIDB(collection, prepared);
    if (collection === 'order_items') {
      // WS payloads for order_items must also be merged into the embedded
      // orderItems arrays of their parent orders so the orders store on cucina
      // devices with wsEnabled stays up to date.
      // Pass `prepared` (the selectively-merged items, which preserve the order FK
      // for correct parent-order grouping) and the raw nonEcho payloads so the
      // embedded merge uses mergeOrderItemFromWSPayload and does not clobber
      // existing embedded fields with mapper-supplied defaults for partial payloads.
      await _mergeOrderItemsIntoOrdersIDB(prepared, nonEcho);
      await _refreshStoreFromIDB('orders');
    } else {
      await _refreshStoreFromIDB(collection);
    }
  }

  lastPullAt.value = new Date().toISOString();
  const echoNote = suppressedCount > 0 ? ` (${suppressedCount} self-echo(es) suppressed)` : '';
  console.info(`[DirectusSync] WS ${event} on ${collection}: ${writtenCount} record(s) written${echoNote}`);

  addSyncLog({
    direction: 'IN',
    type: 'WS',
    endpoint: `/subscriptions/${collection}`,
    payload: { event, count: data.length, suppressedCount },
    response: { writtenCount },
    status: 'success',
    statusCode: null,
    durationMs: null,
    collection,
    recordCount: writtenCount,
  });
}

/**
 * Starts WebSocket subscriptions for the given collections.
 * Falls back silently if the WebSocket connection fails.
 *
 * @param {string[]} collections
 * @returns {Promise<boolean>} `true` if subscriptions were established
 */
async function _startSubscriptions(collections) {
  const client = getDirectusClient();
  if (!client) return false;

  const venueId = appConfig.directus?.venueId ?? null;

  try {
    await client.connect();
    _wsConnected.value = true;

    for (const collection of collections) {
      const query = { fields: ['*'] };
      const quirks = COLLECTION_QUIRKS[collection] ?? {};
      if (!quirks.noVenueFilter && venueId != null) {
        query.filter = quirks.venueFilter
          ? quirks.venueFilter(venueId)
          : { venue: { _eq: venueId } };
      }

      const { subscription, unsubscribe } = await client.subscribe(collection, { query });
      _unsubscribers.push(unsubscribe);

      // Process subscription messages as they arrive
      async function processSubscription() {
        try {
          for await (const message of subscription) {
            await _handleSubscriptionMessage(collection, message);
          }
        } catch (e) {
          console.warn(`[DirectusSync] Subscription ${collection} closed:`, e?.message ?? e);
          _wsConnected.value = false;
          if (!_running) return;
          // If wsEnabled is still on, schedule a reconnect attempt.
          // Otherwise fall back to polling.
          if (appConfig.directus?.wsEnabled === true) {
            // Use a single shared timer so that concurrent subscription errors for
            // multiple collections don't queue overlapping _reconnectWs() calls.
            if (!_reconnectTimer) {
              _reconnectTimer = setTimeout(() => {
                _reconnectTimer = null;
                if (!_running) return;
                if (!_wsConnected.value && appConfig.directus?.wsEnabled === true) {
                  _reconnectWs().catch(() => {});
                } else if (!_pollTimer && appConfig.directus?.wsEnabled !== true) {
                  // wsEnabled was turned off while reconnect was pending — fall back to polling.
                  const pullCfg = PULL_CONFIG[_appType] ?? PULL_CONFIG.cassa;
                  _pollTimer = setInterval(() => _runPull().catch(() => {}), pullCfg.intervalMs);
                }
              }, 5_000);
            }
          } else if (!_pollTimer) {
            const pullCfg = PULL_CONFIG[_appType] ?? PULL_CONFIG.cassa;
            _pollTimer = setInterval(() => _runPull().catch(() => {}), pullCfg.intervalMs);
          }
        }
      }
      processSubscription();
    }

    console.info('[DirectusSync] WebSocket subscriptions active for:', collections.join(', '));
    return true;
  } catch (e) {
    console.warn('[DirectusSync] WebSocket unavailable, falling back to polling:', e?.message ?? e);
    _stopSubscriptions();
    return false;
  }
}

function _stopSubscriptions() {
  for (const unsub of _unsubscribers) {
    try { unsub(); } catch (_) { /* best-effort */ }
  }
  _unsubscribers.length = 0;
  // Use resetDirectusClient() rather than getDirectusClient() + disconnect() to avoid
  // creating a brand-new SDK client just to immediately disconnect it.  When stopSync()
  // is called after a config change (loadDirectusConfigFromStorage already called
  // resetDirectusClient()), getDirectusClient() would create a new client and cache it,
  // so the subsequent _startSubscriptions() → connect() would attempt to reconnect a
  // client that was just disconnected — causing the WebSocket to never come back up.
  resetDirectusClient();
  _wsConnected.value = false;
}

// ── Singleton state ───────────────────────────────────────────────────────────

let _running = false;
let _pushTimer = null;
let _pollTimer = null;
let _globalTimer = null;
let _pushInFlight = null;
/** AbortController for the currently in-flight drainQueue() call.  Aborted
 *  (and replaced with null) whenever a push is invalidated via _onOffline(),
 *  forcePush(), or stopSync(), causing the hung SDK fetch to throw AbortError
 *  and halt the drain without incrementing any attempt counters. */
let _pushAbortController = null;
/**
 * Monotonically increasing generation counter. Incremented for every push
 * attempt started by `_runPush()`, and also incremented whenever a previous
 * in-flight push must be invalidated (for example on offline, manual
 * forcePush override, or stopSync). The `_runPush` finally block only clears
 * `_pushInFlight` when the generation it captured at start still matches the
 * current value — this prevents a stale/hung push that resolved late from
 * nulling out a newer in-flight push.
 */
let _pushGeneration = 0;
/** Single debounced timer for WS reconnect — prevents overlapping reconnect attempts. */
let _reconnectTimer = null;
/** Debounced short-delay push retry scheduled by _onOnline() to recover from brief post-reconnect instability. */
let _onlineRetryTimer = null;
/** @type {object|null} */
let _store = null;
/** @type {'cassa'|'sala'|'cucina'} */
let _appType = 'cassa';
/** Collections currently subscribed via WebSocket (populated on startSync). */
let _wsCollections = [];
/**
 * Monotonically increasing counter incremented by each `_runGlobalPull` call
 * that proceeds past the online/config early-exit checks.  Each such invocation
 * captures its own value; before writing runtime config back to the store it
 * checks whether a **newer pull has already successfully applied** config in the
 * meantime and, if so, skips the (now stale) write.
 *
 * Two counters are used:
 *  - `_globalPullGeneration`: incremented for each pull attempt that passes the
 *    online/config checks (assigns ordering among concurrent pulls).
 *  - `_lastAppliedGlobalPullGeneration`: set to `myGeneration` only after a pull
 *    *successfully* calls `_hydrateConfigFromLocalCache`.
 *
 * The skip condition is `_lastAppliedGlobalPullGeneration > myGeneration`:
 *  - A later pull that succeeded → current pull is stale, skip apply.
 *  - A later pull that failed → `_lastApplied` was not advanced, current pull
 *    is free to apply its successfully fetched data (fixes the case where a
 *    newer but failing pull would have permanently prevented the older
 *    successful pull from hydrating runtime config).
 */
let _globalPullGeneration = 0;
let _lastAppliedGlobalPullGeneration = 0;

const syncStatus = ref(/** @type {'idle'|'syncing'|'error'|'offline'} */ ('idle'));
const lastPushAt = ref(/** @type {string|null} */ (null));
const lastPullAt = ref(/** @type {string|null} */ (null));

// ── Echo suppression ──────────────────────────────────────────────────────────

/**
 * TTL for self-echo suppression entries (ms).
 * 5 s covers typical push → WS echo round-trip time (< 1 s on LAN) with a
 * comfortable margin for slow connections (3G / congested Wi-Fi) while keeping
 * the suppression window short enough to allow genuine cross-device updates
 * that arrive shortly after a push to pass through correctly.
 * Reduce only if sub-second cross-device echo conflicts are observed.
 */
const ECHO_SUPPRESS_TTL_MS = 5_000;

/**
 * Map of "collection:recordId" → expiry timestamp (ms since epoch).
 * Populated by `_runPush()` after each successful `drainQueue()` cycle.
 * Expired entries are lazily deleted in `_isEchoSuppressed`.
 */
const _recentlyPushed = new Map();

/**
 * Registers a list of just-pushed records in the echo-suppression map and
 * prunes any entries whose TTL has already expired to bound memory usage.
 * Expired entries are additionally removed lazily in `_isEchoSuppressed`
 * on every check so the Map stays compact even without frequent pushes.
 * @param {{collection: string, recordId: string}[]} pushedIds
 */
function _registerPushedEchoes(pushedIds) {
  const now = Date.now();
  const expiry = now + ECHO_SUPPRESS_TTL_MS;
  for (const { collection, recordId } of pushedIds) {
    if (recordId) _recentlyPushed.set(`${collection}:${recordId}`, expiry);
  }
  // Prune expired entries to keep the Map size bounded even when the
  // WebSocket is unavailable and _isEchoSuppressed is never called.
  for (const [key, exp] of _recentlyPushed) {
    if (now >= exp) _recentlyPushed.delete(key);
  }
}

/**
 * Returns `true` when the given record should be suppressed as a self-echo.
 * Lazily removes expired entries encountered during the check.
 * @param {string} collection
 * @param {string|null|undefined} recordId
 */
function _isEchoSuppressed(collection, recordId) {
  if (!recordId) return false;
  const key = `${collection}:${recordId}`;
  const expiry = _recentlyPushed.get(key);
  if (expiry == null) return false;
  if (Date.now() >= expiry) {
    _recentlyPushed.delete(key);
    return false;
  }
  return true;
}

// ── Push helpers ──────────────────────────────────────────────────────────────

function _getCfg() {
  const d = appConfig.directus;
  if (!d?.enabled || !d?.url || !d?.staticToken) return null;
  return { url: d.url, staticToken: d.staticToken, venueId: d.venueId ?? null };
}

async function _runPush() {
  if (_pushInFlight) return _pushInFlight;
  // Advance and capture a new generation for this push attempt.  Every await
  // point is a potential preemption: if _onOffline(), forcePush(), or stopSync()
  // advance _pushGeneration while this push is suspended on `await drainQueue()`,
  // the push becomes stale.  The invalidation path also aborts _pushAbortController
  // which causes the hung SDK fetch to throw AbortError — _pushEntry returns
  // { aborted: true } and drainQueue() halts immediately (no sync_logs entry,
  // no attempt increments, offline: false).  All shared module state updates
  // (syncStatus, lastPushAt, _recentlyPushed) are still guarded by the generation
  // check so a superseded push cannot overwrite the state set by the newer push.
  const ac = new AbortController();
  _pushAbortController = ac;
  const generation = ++_pushGeneration;
  _pushInFlight = (async () => {
    try {
      if (!navigator.onLine) {
        if (_pushGeneration === generation) syncStatus.value = 'offline';
        return { pushed: 0, failed: 0, abandoned: 0, pushedIds: [], offline: true };
      }
      const cfg = _getCfg();
      if (!cfg) {
        if (_pushGeneration === generation) syncStatus.value = 'idle';
        return {
          pushed: 0,
          failed: 0,
          abandoned: 0,
          pushedIds: [],
          offline: false,
          skippedReason: 'no-config',
        };
      }
      if (_pushGeneration === generation) syncStatus.value = 'syncing';
      const result = await drainQueue(cfg, ac.signal);
      // Guard all post-await side effects: by the time drainQueue() resolves
      // this push may have been superseded (offline/forcePush/stopSync).
      if (_pushGeneration === generation) {
        if (result.pushed > 0 || result.abandoned > 0) {
          lastPushAt.value = new Date().toISOString();
        }
        // Register pushed IDs so self-echo events from the WebSocket are suppressed.
        if (Array.isArray(result.pushedIds) && result.pushedIds.length > 0) {
          _registerPushedEchoes(result.pushedIds);
        }
        syncStatus.value = result.offline
          ? 'offline'
          : result.failed > 0 ? 'error' : 'idle';
      }
      return result;
    } catch (e) {
      if (_pushGeneration === generation) {
        console.warn('[DirectusSync] Push error:', e);
        syncStatus.value = 'error';
      }
      return { pushed: 0, failed: 0, abandoned: 0, pushedIds: [], offline: false };
    } finally {
      if (_pushGeneration === generation) {
        _pushAbortController = null;
        _pushInFlight = null;
      }
    }
  })();
  return _pushInFlight;
}

// ── Pull helpers ──────────────────────────────────────────────────────────────

async function _runPull() {
  if (!navigator.onLine) {
    return { ok: false, failedCollections: [], skippedReason: 'offline' };
  }
  if (!_getCfg()) {
    return { ok: false, failedCollections: [], skippedReason: 'no-config' };
  }

  const pullCfg = PULL_CONFIG[_appType] ?? PULL_CONFIG.cassa;
  const menuSource = appConfig.menuSource ?? 'directus';

  try {
    let anyMerged = false;
    let allOk = true;
    const mergedSummary = [];
    const failedCollections = [];
    for (const collection of pullCfg.collections) {
      if (menuSource === 'json' && collection === 'menu_items') continue;
      const { merged, ok } = await _pullCollection(collection);
      if (merged > 0) anyMerged = true;
      if (!ok) allOk = false;
      if (merged > 0) mergedSummary.push(`${collection}:${merged}`);
      if (!ok) failedCollections.push(collection);
    }
    if (mergedSummary.length > 0 || failedCollections.length > 0) {
      console.info(
        `[DirectusSync] Pull cycle details — merged: ${mergedSummary.join(', ') || 'none'}; failed: ${failedCollections.join(', ') || 'none'}.`,
      );
    }
    if (allOk) {
      lastPullAt.value = new Date().toISOString();
      if (anyMerged) {
        console.info('[DirectusSync] Pull cycle completed: merged records from server.');
      } else {
        console.info('[DirectusSync] Pull cycle completed: all collections up to date.');
      }
    } else {
      console.warn('[DirectusSync] Pull cycle incomplete: at least one collection failed.');
    }
    return { ok: allOk, failedCollections };
  } catch (e) {
    console.warn('[DirectusSync] Pull error:', e);
    return { ok: false, failedCollections: [] };
  }
}

function _normalizeToArray(value) {
  return Array.isArray(value) ? value : [];
}

function _isObjectRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function _dedupeRecordsById(records) {
  const byId = new Map();
  for (const record of _normalizeToArray(records)) {
    const id = relationId(record?.id);
    if (id == null) continue;
    byId.set(String(id), record);
  }
  return Array.from(byId.values());
}

function _extractRoomTableIds(rooms) {
  const ids = new Set();
  for (const room of _normalizeToArray(rooms)) {
    if (!_isObjectRecord(room)) continue;
    for (const tableRef of _normalizeToArray(room.tables)) {
      const id = relationId(tableRef);
      if (id == null) continue;
      ids.add(String(id));
    }
  }
  return Array.from(ids);
}

async function _hydrateVenueTablesFromRoomRefs(client, venueRecord, venueId) {
  if (!_isObjectRecord(venueRecord)) return venueRecord;

  const directTables = _normalizeToArray(venueRecord.tables).filter(_isObjectRecord);
  if (directTables.length > 0) return venueRecord;

  const tableIds = _extractRoomTableIds(venueRecord.rooms);
  if (tableIds.length === 0) return venueRecord;

  try {
    const fetched = [];
    for (let offset = 0; offset < tableIds.length; offset += TABLE_FETCH_BATCH_SIZE) {
      const idChunk = tableIds.slice(offset, offset + TABLE_FETCH_BATCH_SIZE);
      const filterConditions = [{ id: { _in: idChunk } }];
      if (venueId != null) {
        filterConditions.push({ venue: { _eq: venueId } });
      }
      const filter = filterConditions.length === 1 ? filterConditions[0] : { _and: filterConditions };
      const records = await client.request(readItems('tables', {
        fields: ['id', 'label', 'covers', 'room', 'venue', 'sort', 'status'],
        limit: TABLE_FETCH_BATCH_SIZE,
        filter,
      }));
      fetched.push(..._normalizeToArray(records).filter(_isObjectRecord));
    }
    if (fetched.length === 0) return venueRecord;
    return {
      ...venueRecord,
      tables: _dedupeRecordsById(fetched),
    };
  } catch (error) {
    console.warn('[DirectusSync] Fallback table hydration by room refs failed:', error?.message ?? error);
    return venueRecord;
  }
}

function _extractDeepVenuePayload(payload) {
  if (payload == null) return null;
  if (Array.isArray(payload)) {
    const [first] = payload;
    return first && typeof first === 'object' ? first : null;
  }
  if (typeof payload !== 'object') return null;

  let node = payload;
  for (let depth = 0; depth < DEEP_FETCH_PAYLOAD_UNWRAP_MAX_DEPTH; depth += 1) {
    if (Array.isArray(node)) {
      const [first] = node;
      return first && typeof first === 'object' ? first : null;
    }
    if (!node || typeof node !== 'object') return null;
    if (!Object.prototype.hasOwnProperty.call(node, 'data')) return node;
    node = node.data;
  }
  return (node && typeof node === 'object' && !Array.isArray(node)) ? node : null;
}

function _extractModifierTree(venueRecord, menuSource) {
  if (menuSource === 'json') {
    return {
      categories: [],
      items: [],
      modifiers: [],
      categoryLinks: [],
      itemLinks: [],
    };
  }

  const categories = _normalizeToArray(venueRecord.menu_categories)
    .filter(_isObjectRecord);
  const directItems = _normalizeToArray(venueRecord.menu_items)
    .filter(_isObjectRecord);
  const categoryItems = categories
    .filter(category => Array.isArray(category?.menu_items) && category.menu_items.length > 0)
    .flatMap(category => _normalizeToArray(category.menu_items))
    .filter(_isObjectRecord);
  // Prefer direct venue.menu_items records when both direct and category-nested arrays
  // contain the same item id, because direct items preserve the canonical payload shape.
  const items = _dedupeRecordsById([...categoryItems, ...directItems]);
  const modifierById = new Map();
  const categoryLinks = [];
  const itemLinks = [];

  const addNormalizedModifier = (value) => {
    const modifier = value && typeof value === 'object' ? value : null;
    const id = modifier?.id ?? value;
    if (id == null) return null;
    let normalized;
    if (modifier) {
      normalized = {
        ...modifier,
        venue: relationId(modifier.venue) ?? venueRecord.id,
      };
    } else {
      normalized = {
        id,
        venue: venueRecord.id,
      };
    }
    modifierById.set(String(id), normalized);
    return id;
  };

  for (const category of categories) {
    for (const link of _normalizeToArray(category.menu_modifiers)) {
      const modifierId = addNormalizedModifier(link.menu_modifiers_id ?? link.menu_modifier_id ?? link);
      if (modifierId == null) continue;
      categoryLinks.push({
        id: link.id ?? `category::${String(category.id)}::modifier::${String(modifierId)}`,
        menu_categories_id: category.id,
        menu_modifiers_id: modifierId,
        venue: relationId(link.venue) ?? venueRecord.id,
        sort: link.sort ?? null,
        date_updated: link.date_updated ?? null,
      });
    }
  }

  for (const item of items) {
    for (const link of _normalizeToArray(item.menu_modifiers)) {
      const modifierId = addNormalizedModifier(link.menu_modifiers_id ?? link.menu_modifier_id ?? link);
      if (modifierId == null) continue;
      itemLinks.push({
        id: link.id ?? `item::${String(item.id)}::modifier::${String(modifierId)}`,
        menu_items_id: item.id,
        menu_modifiers_id: modifierId,
        venue: relationId(link.venue) ?? venueRecord.id,
        sort: link.sort ?? null,
        date_updated: link.date_updated ?? null,
      });
    }
  }

  return {
    categories,
    items,
    modifiers: Array.from(modifierById.values()),
    categoryLinks,
    itemLinks,
  };
}

async function _fanOutVenueTreeToIDB(venueRecord, { menuSource }) {
  if (!venueRecord || Array.isArray(venueRecord) || typeof venueRecord !== 'object') return {};
  const venueId = relationId(venueRecord.id);
  const withVenueFallback = (records) => _normalizeToArray(records).map((record) => {
    if (!record || typeof record !== 'object' || Array.isArray(record) || venueId == null) return record;
    if (relationId(record.venue) != null) return record;
    return { ...record, venue: venueId };
  });

  const {
    categories,
    items,
    modifiers,
    categoryLinks,
    itemLinks,
  } = _extractModifierTree(venueRecord, menuSource);
  const rooms = _normalizeToArray(venueRecord.rooms)
    .filter(_isObjectRecord);
  const directTables = _normalizeToArray(venueRecord.tables)
    .filter(_isObjectRecord);
  const nestedRoomTables = rooms
    .filter((room) => Array.isArray(room?.tables) && room.tables.length > 0)
    .flatMap((room) => _normalizeToArray(room.tables))
    .filter(_isObjectRecord);
  // Prefer direct venue.tables records to avoid losing fields when nested room tables
  // contain partial projections.
  const tables = _dedupeRecordsById([...nestedRoomTables, ...directTables]);
  const paymentMethods = _normalizeToArray(venueRecord.payment_methods)
    .filter(_isObjectRecord);
  const printers = _normalizeToArray(venueRecord.printers)
    .filter(_isObjectRecord);
  // `_dedupeRecordsById` keeps the last duplicate, so append canonical
  // `venue_users` records after legacy alias `users` to preserve the richer shape.
  const venueUsers = _dedupeRecordsById(
    [
      ..._normalizeToArray(venueRecord.users),
      ..._normalizeToArray(venueRecord.venue_users),
    ].filter(_isObjectRecord),
  );
  const tableMergeSessions = _normalizeToArray(venueRecord.table_merge_sessions)
    .filter(_isObjectRecord);

  const flatVenueRecord = { ...venueRecord };
  for (const key of VENUE_NESTED_RELATION_KEYS) {
    delete flatVenueRecord[key];
  }
  // Some Directus setups expose venue users as `users` (one_field alias).
  // Keep it out of the flat venue snapshot regardless of canonical alias.
  delete flatVenueRecord.users;

  const payloadByStore = {
    venues: [{ ...flatVenueRecord }],
    rooms: withVenueFallback(rooms),
    tables: withVenueFallback(tables),
    payment_methods: withVenueFallback(paymentMethods),
    printers: withVenueFallback(printers),
    venue_users: withVenueFallback(venueUsers),
    table_merge_sessions: withVenueFallback(tableMergeSessions),
    menu_categories: withVenueFallback(categories),
    menu_items: withVenueFallback(items),
    menu_modifiers: withVenueFallback(modifiers),
    menu_categories_menu_modifiers: withVenueFallback(categoryLinks),
    menu_items_menu_modifiers: withVenueFallback(itemLinks),
  };

  if (menuSource === 'json') {
    payloadByStore.menu_categories = [];
    payloadByStore.menu_items = [];
    payloadByStore.menu_modifiers = [];
    payloadByStore.menu_categories_menu_modifiers = [];
    payloadByStore.menu_items_menu_modifiers = [];
  }

  const stores = Object.entries(payloadByStore);
  await Promise.all(stores
    .filter(([storeName]) => storeName !== 'table_merge_sessions' && storeName !== 'venue_users')
    .map(([storeName, records]) => upsertRecordsIntoIDB(storeName, records, { forceWrite: true })));
  // venue_users must be full-replaced so users removed from Directus are also
  // removed from IDB instead of lingering indefinitely via upsert-only semantics.
  await replaceVenueUsersInIDB(payloadByStore.venue_users);
  // table_merge_sessions must be full-replaced so stale dissolved merges are removed
  // from IDB instead of lingering indefinitely via upsert-only semantics.
  await replaceTableMergesInIDB(payloadByStore.table_merge_sessions);
  return Object.fromEntries(stores.map(([storeName, records]) => [storeName, records.length]));
}

/**
 * Applies a Directus-sourced runtimeConfig to appConfig, restoring
 * preserved values (directus, instanceName, pwaLogo) as instructed.
 * This is the single canonical writer for Directus-related appConfig mutations
 * inside useDirectusSync.
 *
 * @param {object} runtimeConfig - New config values from Directus/DEFAULT_SETTINGS.
 * @param {object} options
 * @param {object} options.preservedDirectus - Always restored; never overwritten by runtimeConfig.
 * @param {string|undefined} options.preservedInstanceName - Restored when provided.
 * @param {string|undefined} options.preservedPwaLogo - Restored when provided.
 * @param {boolean} [options.preserveMenuSource=false] - If true, restores menuSource='json' and menuUrl.
 * @param {string|null} [options.preservedMenuUrl=null] - MenuUrl to restore when preserveMenuSource is true.
 */
function _applyDirectusRuntimeConfigToAppConfig(runtimeConfig, options = {}) {
  const {
    preservedDirectus,
    preservedMenuUrl = null,
    preserveMenuSource = false,
  } = options;
  // Compute which keys must not be overwritten; they are restored from
  // preserved values below and must never be touched by runtimeConfig.
  const skipKeys = new Set(['directus']);
  if ('preservedInstanceName' in options) skipKeys.add('instanceName');
  if ('preservedPwaLogo' in options) skipKeys.add('pwaLogo');
  if (preserveMenuSource) {
    skipKeys.add('menuSource');
    skipKeys.add('menuUrl');
  }
  // Selective assignment — avoids the write-then-restore anti-pattern that
  // temporarily corrupts preserved fields for any reactive observer that fires
  // between the Object.assign and the subsequent restore assignments.
  for (const [key, value] of Object.entries(runtimeConfig)) {
    if (!skipKeys.has(key)) appConfig[key] = value;
  }
  // Explicitly restore preserved values that runtimeConfig must never overwrite.
  appConfig.directus = preservedDirectus;
  if ('preservedInstanceName' in options) appConfig.instanceName = options.preservedInstanceName;
  if ('preservedPwaLogo' in options) appConfig.pwaLogo = options.preservedPwaLogo;
  if (preserveMenuSource) {
    appConfig.menuSource = 'json';
    appConfig.menuUrl = preservedMenuUrl ?? null;
  }
}

async function _hydrateConfigFromLocalCache(venueId, onProgress = null) {
  if (venueId == null) return false;
  const cached = await loadConfigFromIDB(venueId);
  const mappedConfig = mapVenueConfigFromDirectus(cached, DEFAULT_SETTINGS);
  const runtimeConfig = createRuntimeConfig(mappedConfig);
  const preservedDirectus = JSON.parse(JSON.stringify(appConfig.directus ?? {}));
  const preservedInstanceName = appConfig.instanceName;
  const preservedPwaLogo = appConfig.pwaLogo;
  const preservedMenuSource = appConfig.menuSource === 'json' ? 'json' : 'directus';
  const preservedMenuUrl = appConfig.menuUrl;
  _applyDirectusRuntimeConfigToAppConfig(runtimeConfig, {
    preservedDirectus,
    preservedInstanceName,
    preservedPwaLogo,
    preserveMenuSource: preservedMenuSource === 'json',
    preservedMenuUrl,
  });
  await _refreshStoreConfigFromIDB({
    menuSource: appConfig.menuSource,
    menuUrl: appConfig.menuUrl,
  });
  await _syncPreBillPrinterSelection(cached?.venueRecord ?? null);
  _emitProgress(onProgress, { level: 'info', message: 'Configurazione locale applicata.' });
  return true;
}

/**
 * Returns printers that can receive pre-bill jobs.
 * Printers with missing/empty printTypes are treated as catch-all.
 *
 * @returns {Array<{id:string,name?:string,url?:string,printTypes?:string[]}>}
 */
function _preBillPrinters() {
  return (appConfig.printers ?? []).filter((printer) => {
    if (typeof printer?.id !== 'string' || !printer.id.trim()) return false;
    if (!printer?.url) return false;
    // Empty/missing printTypes means catch-all printer (includes pre_bill),
    // consistent with usePrintQueue routing semantics.
    if (!Array.isArray(printer.printTypes) || printer.printTypes.length === 0) return true;
    return printer.printTypes.includes('pre_bill');
  });
}

/**
 * Ensures the store pre-bill default printer points to a valid Directus printer.
 * The runtime keeps this preference only in local IDB (`local_settings`), so it can:
 *  1) Keep the current local selection if still valid
 *  2) Fallback to the first available pre-bill-capable printer
 *
 * @param {object|null} _venueRecord
 */
async function _syncPreBillPrinterSelection(_venueRecord = null) {
  if (!_store) return;
  const candidates = _preBillPrinters();
  if (candidates.length === 0) {
    if (typeof _store.saveLocalSettings === 'function') {
      try {
        await _store.saveLocalSettings({ preBillPrinterId: '' });
      } catch (err) {
        console.warn('[DirectusSync] Failed to persist cleared preBillPrinterId:', err);
      }
    }
    _store.preBillPrinterId = '';
    return;
  }
  const current = typeof _store.preBillPrinterId === 'string' ? _store.preBillPrinterId : '';
  if (current && candidates.some((printer) => printer.id === current)) return;
  const newPrinterId = candidates[0]?.id ?? '';
  if (typeof _store.saveLocalSettings === 'function') {
    try {
      await _store.saveLocalSettings({ preBillPrinterId: newPrinterId });
    } catch (err) {
      console.warn('[DirectusSync] Failed to persist preBillPrinterId:', err);
    }
  }
  _store.preBillPrinterId = newPrinterId;
}

function _emitProgress(onProgress, payload) {
  if (typeof onProgress === 'function') {
    try { onProgress(payload); } catch (e) {
      console.warn('[DirectusSync] onProgress callback error:', e);
    }
  }
}

async function _runGlobalPull({ onProgress = null } = {}) {
  if (!navigator.onLine) return;
  const cfg = _getCfg();
  if (!cfg) return;
  const venueId = cfg.venueId ?? null;
  // Capture the current generation counter so we can detect whether a newer
  // global pull has been started (e.g. by reconfigureAndApply) while this one
  // is awaiting network/IDB work.  If superseded, skip the config-apply step
  // to avoid overwriting the freshly applied runtime config with stale data.
  const myGeneration = ++_globalPullGeneration;

  try {
    _emitProgress(onProgress, { level: 'info', message: 'Avvio pull globale configurazione Directus…' });
    if (venueId == null) {
      _emitProgress(onProgress, {
        level: 'error',
        message: 'Applicazione configurazione saltata: venueId non configurato.',
      });
      return { ok: false, failedCollections: VENUE_RELATED_COLLECTIONS };
    }

    _emitProgress(onProgress, { level: 'info', message: `Deep fetch venue ${venueId}…` });
    const client = _buildRestClient(cfg);
    const preferredMenuSource = appConfig.menuSource ?? 'directus';
    const deepFetchFieldSets = preferredMenuSource === 'json'
      ? DEEP_FETCH_JSON_FIELD_SETS
      : DEEP_FETCH_FIELD_SETS;
    let deepVenue = null;
    let deepFetchMode = deepFetchFieldSets[0]?.key ?? 'full';
    let deepFetchError = null;
    for (const [index, fieldSet] of deepFetchFieldSets.entries()) {
      try {
        const deepVenueRaw = await client.request(readItem('venues', venueId, { fields: fieldSet.fields }));
        deepVenue = _extractDeepVenuePayload(deepVenueRaw);
        if (!deepVenue) throw new Error('Deep fetch payload is empty or invalid.');
        deepFetchMode = fieldSet.key;
        deepFetchError = null;
        break;
      } catch (err) {
        deepFetchError = err;
        if (index < deepFetchFieldSets.length - 1) {
          console.warn(`[DirectusSync] Deep fetch (${fieldSet.key}) failed, retrying with fallback fields:`, err?.message ?? err);
          _emitProgress(onProgress, {
            level: 'warning',
            message: 'Deep fetch avanzato non disponibile, ritento con campi compatibili…',
            details: String(err?.message ?? err),
          });
        }
      }
    }
    if (deepFetchError) throw deepFetchError;
    if (!deepVenue) {
      _emitProgress(onProgress, {
        level: 'error',
        message: `Venue ${venueId} non trovata durante il deep fetch.`,
      });
      return { ok: false, failedCollections: ['venues'] };
    }
    deepVenue = await _hydrateVenueTablesFromRoomRefs(client, deepVenue, venueId);

    // Skip IDB write and config apply only if a *newer* pull has already
    // successfully applied config.  Checking here (after network fetch but
    // before writing to IDB) prevents an older, slower pull from
    // overwriting IDB with stale venue data after a newer pull has already
    // written and applied fresher data.
    if (_lastAppliedGlobalPullGeneration > myGeneration) {
      console.debug('[DirectusSync] Global pull superseded by a newer pull — skipping IDB write and config apply.');
      return { ok: true, failedCollections: [] };
    }

    const localMenuSource = appConfig.menuSource;
    const remoteMenuSource = deepVenue.menu_source;
    const menuSource = localMenuSource === 'json'
      ? 'json'
      : (remoteMenuSource ?? localMenuSource ?? 'directus');
    const fanOutSummary = await _fanOutVenueTreeToIDB(deepVenue, { menuSource });
    await saveLastPullTsToIDB('deep_venue_config', new Date().toISOString());

    // Refresh the in-memory auth state whenever Directus venue users were written.
    // This ensures manual users are purged and the lock screen shows the up-to-date
    // Directus roster without requiring a page reload.
    if (fanOutSummary.venue_users > 0) {
      reloadUsersFromIDB().catch(e => console.warn('[DirectusSync] Auth user refresh failed:', e));
    }

    if (appConfig.directus?.debugLogs === true) {
      const usedFields =
        deepFetchFieldSets.find(set => set.key === deepFetchMode)?.fields
        ?? DEEP_FETCH_FIELDS;
      console.info('[DirectusSync] Deep fetch mode:', deepFetchMode);
      console.info('[DirectusSync] Deep fetch fields:', usedFields.join(', '));
      console.info('[DirectusSync] Deep fetch fan-out summary:', fanOutSummary);
    }
    _emitProgress(onProgress, {
      level: 'info',
      message: `Deep fetch completato (menu_source=${menuSource}).`,
      details: JSON.stringify(fanOutSummary),
    });

    if ((_lastAppliedGlobalPullGeneration ?? 0) > myGeneration) {
      _emitProgress(onProgress, {
        level: 'info',
        message: 'Applicazione configurazione saltata: una pull globale più recente è già stata applicata.',
      });
      return { ok: true, failedCollections: [] };
    }

    await _hydrateConfigFromLocalCache(venueId, onProgress);

    if ((_lastAppliedGlobalPullGeneration ?? 0) > myGeneration) {
      _emitProgress(onProgress, {
        level: 'info',
        message: 'Configurazione idratata ma non applicata: una pull globale più recente è stata applicata durante l’aggiornamento.',
      });
      return { ok: true, failedCollections: [] };
    }

    _lastAppliedGlobalPullGeneration = Math.max(_lastAppliedGlobalPullGeneration ?? 0, myGeneration);
    _emitProgress(onProgress, { level: 'success', message: 'Configurazione applicata con successo.' });
    return { ok: true, failedCollections: [] };
  } catch (e) {
    console.warn('[DirectusSync] Global pull error:', e);
    _emitProgress(onProgress, {
      level: 'error',
      message: 'Errore durante il pull globale.',
      details: String(e?.message ?? e),
    });
    return { ok: false, failedCollections: ['venues'] };
  }
}

// ── Online/offline listener ───────────────────────────────────────────────────

/**
 * Attempts to restore WebSocket subscriptions after a connection loss.
 * Cleans up any stale subscriptions/poll timer first, then calls
 * `_startSubscriptions`.  If that fails, re-enables the polling fallback.
 */
async function _reconnectWs() {
  if (!_running || _wsConnected.value) return;
  if (appConfig.directus?.wsEnabled !== true) return;

  // Recompute the collection list from the current config so that changes to
  // appConfig.menuSource (json ↔ directus) or _appType are picked up at
  // reconnect time rather than using the potentially-stale list captured at
  // startSync() time.
  const pullCfg = PULL_CONFIG[_appType] ?? PULL_CONFIG.cassa;
  const menuSource = appConfig.menuSource ?? 'directus';
  const wsCollections = menuSource === 'json'
    ? pullCfg.collections.filter(c => c !== 'menu_items')
    : pullCfg.collections;
  _wsCollections = wsCollections;

  if (_wsCollections.length === 0) return;

  // Cancel any pending debounced reconnect timer — this call IS the reconnect.
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }

  console.info('[DirectusSync] Attempting WebSocket reconnect…');

  // Stop polling before trying WS — avoids duplicate pulls during reconnect.
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }

  // Clean up stale subscriptions/connection before reconnecting.
  _stopSubscriptions();

  const subscribed = await _startSubscriptions(_wsCollections);
  if (!subscribed) {
    // Reconnect failed — restart polling fallback.
    const pullCfg = PULL_CONFIG[_appType] ?? PULL_CONFIG.cassa;
    if (!_pollTimer) {
      _pollTimer = setInterval(() => _runPull().catch(() => {}), pullCfg.intervalMs);
    }
  } else {
    // WS is back — do an immediate pull to catch up on missed updates.
    _runPull().catch(() => {});
  }
}

function _onOffline() {
  // Immediately reflect the offline state on the WS indicator.  The Directus
  // SDK may continue its internal reconnect retry loop for up to ~20 s before
  // the subscription iterator throws, so without this listener the indicator
  // would stay "connected" even though no WS traffic can flow.
  _wsConnected.value = false;
  // Cancel any pending reconnect timer — the reconnect will be rescheduled
  // by _onOnline() once the network is restored.
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  // Cancel any pending delayed push retry so it doesn't fire if the device
  // went offline again before the 5-second window elapsed.
  if (_onlineRetryTimer) { clearTimeout(_onlineRetryTimer); _onlineRetryTimer = null; }
  // Invalidate any in-flight push.  When the network drops, the underlying
  // fetch() inside sdkClient.request() can hang indefinitely waiting for a TCP
  // timeout (typically 10-20+ minutes).  Aborting _pushAbortController causes
  // the SDK fetch to throw AbortError immediately, which drainQueue treats as a
  // caller-initiated abort and uses to stop the drain cleanly without marking
  // the result as offline or incrementing attempts.
  // Clearing _pushInFlight and advancing _pushGeneration then ensures the next
  // _runPush() call (from _onOnline()) starts a completely fresh push rather
  // than waiting on the hung promise or running a second concurrent drain.
  _pushAbortController?.abort();
  _pushAbortController = null;
  _pushGeneration++;
  _pushInFlight = null;
  // If an in-flight push had already set syncStatus to "syncing", the
  // generation bump above causes that superseded _runPush() to skip its
  // post-await status update.  Reflect the offline state here so the UI
  // cannot remain stuck showing "syncing" while the app is offline.
  if (_running) { syncStatus.value = 'offline'; }
}

/**
 * Schedules a 5-second retry push after an online reconnect push failed.
 * Re-schedules itself as long as the device remains online and sync is
 * running so that the queue drains as soon as Directus becomes reachable
 * again (e.g. while DHCP / DNS is still settling after reconnect).
 * Cancelled by `_onOffline`, `stopSync`, or a new `_onOnline` event.
 */
function _scheduleOnlineRetry() {
  if (_onlineRetryTimer) { clearTimeout(_onlineRetryTimer); }
  _onlineRetryTimer = setTimeout(() => {
    _onlineRetryTimer = null;
    if (!_running || !navigator.onLine) return;
    // Capture the generation that _runPush() will assign synchronously.  Since
    // _runPush() increments _pushGeneration before its first await, reading
    // _pushGeneration immediately after the call gives the generation used by
    // this specific push attempt.  If _pushGeneration is subsequently advanced
    // (offline/forcePush/stopSync), the result belongs to a superseded attempt
    // and must not re-schedule a retry for the new online cycle.
    const retryPush = _runPush();
    const genAtStart = _pushGeneration;
    retryPush.then((result) => {
      if (result?.offline && _running && navigator.onLine && _pushGeneration === genAtStart) {
        _scheduleOnlineRetry();
      }
    }).catch(() => {});
  }, 5_000);
}

function _onOnline() {
  // Clear any stale retry timer from a previous online/offline cycle.
  if (_onlineRetryTimer) { clearTimeout(_onlineRetryTimer); _onlineRetryTimer = null; }
  // Immediate push attempt: when the network is already stable the queue drains
  // here and no retry is needed.  Only schedule the 5 s follow-up when the push
  // reports an offline/network failure (e.g. DHCP still settling) AND the
  // device is still online when the result arrives — this avoids a redundant
  // drainQueue() cycle on every reconnect when the first push already succeeded.
  // Also clear any timer already set by a concurrent push from a rapid second
  // 'online' event so only the most recent push's retry is scheduled.
  // If the retry also fails, _scheduleOnlineRetry() reschedules itself every
  // 5 s until the push succeeds, the device goes offline, or stopSync() is called.
  // Capture the generation that _runPush() assigns synchronously (it increments
  // _pushGeneration before its first await).  If _pushGeneration is subsequently
  // advanced (offline/forcePush/stopSync), the result belongs to a superseded
  // attempt and must not schedule a retry for the new online cycle.
  const onlinePush = _runPush();
  const genAtStart = _pushGeneration;
  onlinePush.then((result) => {
    if (result?.offline && _running && navigator.onLine && _pushGeneration === genAtStart) {
      _scheduleOnlineRetry();
    }
  }).catch(() => {});
  _runPull().catch(() => {});
  // If WebSocket was enabled but is currently disconnected, attempt to reconnect.
  if (appConfig.directus?.wsEnabled === true && !_wsConnected.value && _running) {
    _reconnectWs().catch(() => {});
  }
}

function _onQueueEnqueue() {
  _runPush().catch(() => {});
}

// ── Public composable ─────────────────────────────────────────────────────────

export function useDirectusSync() {
  /**
   * Starts the push loop, WebSocket subscriptions (with polling fallback), and
   * global config pull.
   *
   * @param {{ appType: 'cassa'|'sala'|'cucina', store: object }} opts
   */
  async function startSync({ appType, store }) {
    if (_running) return;
    if (!appConfig.directus?.enabled) return;

    _appType = appType ?? 'cassa';
    _store = store;
    _running = true;

    const pullCfg = PULL_CONFIG[_appType] ?? PULL_CONFIG.cassa;
    const venueId = appConfig.directus?.venueId ?? null;

    // Local-first: apply cached config snapshot from IDB before any remote call.
    try {
      await _hydrateConfigFromLocalCache(venueId);
    } catch (e) {
      console.warn(`[DirectusSync] WARN: Fallback to remote sync after local cache hydration failed for venue ${String(venueId)}:`, e);
    }

    // Initial push + deep global config pull
    _runPush().catch(() => {});
    _runGlobalPull().catch(() => {});

    // Push loop: retry every 30 s when online
    _pushTimer = setInterval(() => _runPush().catch(() => {}), 30_000);

    // Global config pull: every 5 minutes
    _globalTimer = setInterval(() => _runGlobalPull().catch(() => {}), GLOBAL_INTERVAL_MS);

    // WebSocket subscriptions are opt-in (wsEnabled must be explicitly true).
    // When disabled, fall back to periodic polling from the start.
    const wsEnabled = appConfig.directus?.wsEnabled === true;
    // When menu data comes from a local JSON file, exclude menu_items from WebSocket
    // subscriptions to avoid unnecessary subscription traffic and IDB fan-out.
    const menuSource = appConfig.menuSource ?? 'directus';
    const wsCollections = menuSource === 'json'
      ? pullCfg.collections.filter(c => c !== 'menu_items')
      : pullCfg.collections;
    // Persist the last computed collection list at module level; reconnect logic
    // recomputes the effective list from the current appConfig when reconnecting.
    _wsCollections = wsCollections;

    if (wsEnabled) {
      // Try WebSocket subscriptions; fall back to polling if connect fails
      const subscribed = await _startSubscriptions(wsCollections);
      if (!subscribed) {
        _runPull().catch(() => {});
        _pollTimer = setInterval(() => _runPull().catch(() => {}), pullCfg.intervalMs);
      } else {
        // Even with WebSocket, do one initial REST pull to catch up on missed updates
        _runPull().catch(() => {});
      }
    } else {
      // WebSocket disabled — use REST polling only
      _runPull().catch(() => {});
      _pollTimer = setInterval(() => _runPull().catch(() => {}), pullCfg.intervalMs);
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('online', _onOnline);
      window.addEventListener('offline', _onOffline);
      window.addEventListener('sync-queue:enqueue', _onQueueEnqueue);
    }
  }

  function stopSync() {
    _running = false;
    _store = null;
    // Abort any in-flight push and advance the generation so any push started
    // before stopSync() does not clear a new _pushInFlight that might be
    // created after the next startSync() call.  The AbortController abort causes
    // the SDK fetch to throw AbortError so the drain halts immediately without
    // corrupting the queue.
    _pushAbortController?.abort();
    _pushAbortController = null;
    _pushGeneration++;
    _pushInFlight = null;
    if (_pushTimer) { clearInterval(_pushTimer); _pushTimer = null; }
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    if (_globalTimer) { clearInterval(_globalTimer); _globalTimer = null; }
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
    if (_onlineRetryTimer) { clearTimeout(_onlineRetryTimer); _onlineRetryTimer = null; }
    _stopSubscriptions();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', _onOnline);
      window.removeEventListener('offline', _onOffline);
      window.removeEventListener('sync-queue:enqueue', _onQueueEnqueue);
    }
    syncStatus.value = 'idle';
  }

  /**
   * Manually triggers a full push drain of the sync queue.
   * @returns {Promise<{
   *   pushed: number,
   *   failed: number,
   *   abandoned: number,
   *   pushedIds: Array<{ collection: string, recordId: string }>,
   *   offline: boolean,
   *   skippedReason?: 'no-config' | 'disabled',
   * }>}
   */
  async function forcePush() {
    if (!appConfig.directus?.enabled) return { pushed: 0, failed: 0, abandoned: 0, pushedIds: [], offline: false, skippedReason: 'disabled' };
    // Abort any in-flight push and start fresh. This handles both the
    // "push is stuck on a hung fetch (TCP timeout)" case and the more benign
    // "push is already running" case: aborting the AbortController cancels the
    // current drain immediately, returning the caller-initiated cancellation
    // path (aborted: true) without marking the client offline, incrementing
    // attempt counters, or leaving a second concurrent drain running in parallel.
    _pushAbortController?.abort();
    _pushAbortController = null;
    _pushGeneration++;
    _pushInFlight = null;
    return _runPush();
  }

  async function forcePull() {
    if (!appConfig.directus?.enabled) return { ok: true, failedCollections: [] };
    syncStatus.value = 'syncing';
    try {
      const result = await _runPull();
      if (result?.ok !== false) {
        syncStatus.value = 'idle';
      } else if (result?.skippedReason === 'offline') {
        syncStatus.value = 'offline';
      } else {
        syncStatus.value = 'error';
      }
      return result;
    } catch (e) {
      syncStatus.value = 'error';
      console.warn('forcePull failed unexpectedly', e);
      return {
        ok: false,
        failedCollections: [],
        ...(e && typeof e === 'object' && 'skippedReason' in e ? { skippedReason: e.skippedReason } : {}),
        ...(e instanceof Error ? { message: e.message } : {}),
        error: e,
      };
    }
  }

  /**
   * Applies a fresh Directus configuration snapshot with an optional local cache wipe.
   * Intended for explicit post-save reconfiguration from the settings UI.
   *
   * @param {{ clearLocalConfig?: boolean, onProgress?: Function }} [opts]
   * @returns {Promise<{ ok: boolean, failedCollections: string[] }>}
   */
  async function reconfigureAndApply({
    clearLocalConfig = false,
    onProgress = null,
  } = {}) {
    if (!appConfig.directus?.enabled) {
      const result = { ok: false, failedCollections: [] };
      _emitProgress(onProgress, {
        level: 'error',
        message: 'Sincronizzazione Directus disabilitata: impossibile applicare la configurazione.',
      });
      return result;
    }

    syncStatus.value = 'syncing';
    try {
      if (clearLocalConfig) {
        _emitProgress(onProgress, { level: 'info', message: 'Svuotamento completo cache configurazione locale…' });
        await clearLocalConfigCacheFromIDB();
        const preservedDirectus = JSON.parse(JSON.stringify(appConfig.directus ?? {}));
        _applyDirectusRuntimeConfigToAppConfig(createRuntimeConfig(DEFAULT_SETTINGS), {
          preservedDirectus,
        });
        await _refreshStoreConfigFromIDB({
          menuSource: appConfig.menuSource,
          menuUrl: appConfig.menuUrl,
        });
        _emitProgress(onProgress, { level: 'info', message: 'Cache configurazione locale svuotata.' });
      }

      const result = await _runGlobalPull({ onProgress });
      syncStatus.value = result?.ok ? 'idle' : 'error';
      return result ?? { ok: false, failedCollections: [] };
    } catch (e) {
      syncStatus.value = 'error';
      _emitProgress(onProgress, {
        level: 'error',
        message: 'Errore durante la procedura di applicazione configurazione.',
        details: String(e?.message ?? e),
      });
      return { ok: false, failedCollections: [] };
    }
  }

  /**
   * Exposes the internal `_reconnectWs` function so callers (e.g. swipe-down
   * refresh) can actively trigger a WebSocket reconnect attempt.  No-ops when
   * sync is not running, WS is already connected, or WS is disabled.
   *
   * @returns {Promise<void>}
   */
  function reconnectWs() {
    return _reconnectWs();
  }

  return {
    syncStatus,
    lastPushAt,
    lastPullAt,
    wsConnected: _wsConnected,
    startSync,
    stopSync,
    forcePush,
    forcePull,
    reconfigureAndApply,
    reconnectWs,
  };
}

/**
 * @internal For test isolation only.
 */
export function _resetDirectusSyncSingleton() {
  _running = false;
  _store = null;
  _appType = 'cassa';
  _wsCollections = [];
  _pushGeneration = 0;
  _pushAbortController?.abort();
  _pushAbortController = null;
  _pushInFlight = null;
  _globalPullGeneration = 0;
  _lastAppliedGlobalPullGeneration = 0;
  if (_pushTimer) { clearInterval(_pushTimer); _pushTimer = null; }
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  if (_globalTimer) { clearInterval(_globalTimer); _globalTimer = null; }
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  if (_onlineRetryTimer) { clearTimeout(_onlineRetryTimer); _onlineRetryTimer = null; }
  _stopSubscriptions();
  _recentlyPushed.clear();
  if (typeof window !== 'undefined') {
    window.removeEventListener('online', _onOnline);
    window.removeEventListener('offline', _onOffline);
    window.removeEventListener('sync-queue:enqueue', _onQueueEnqueue);
  }
  syncStatus.value = 'idle';
  lastPushAt.value = null;
  lastPullAt.value = null;
}

/**
 * @internal For unit tests only. Direct handle for simulating incoming WS messages.
 */
export { _handleSubscriptionMessage, _registerPushedEchoes, _startSubscriptions };
