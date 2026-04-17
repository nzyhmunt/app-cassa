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
} from '../utils/mappers.js';
import { getDirectusClient } from './useDirectusClient.js';
import { drainQueue } from './useSyncQueue.js';
import {
  loadStateFromIDB,
  loadLastPullTsFromIDB,
  saveLastPullTsToIDB,
  upsertRecordsIntoIDB,
  deleteRecordsFromIDB,
} from '../store/persistence/operations.js';
import {
  loadConfigFromIDB,
  replaceTableMergesInIDB,
  clearLocalConfigCacheFromIDB,
} from '../store/persistence/config.js';

// ── Per-app pull config (§5.7.6) ─────────────────────────────────────────────

/** @type {Record<string, { collections: string[], intervalMs: number }>} */
const PULL_CONFIG = {
  cassa: {
    collections: ['orders', 'bill_sessions', 'tables'],
    // 30 s polling: frequent enough for near-real-time UX while keeping
    // backend load low. Use wsEnabled=true for sub-second updates if the
    // Directus instance supports WebSocket subscriptions.
    intervalMs: 30_000,
  },
  sala: {
    collections: ['orders', 'bill_sessions', 'tables', 'menu_items'],
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
  'venue_users.*',
  'table_merge_sessions.*',
];
const DEEP_FETCH_BASE_RELATION_FIELDS = [
  '*',
  'rooms.*',
  'tables.*',
  'payment_methods.*',
  'printers.*',
  'venue_users.*',
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
const GLOBAL_INTERVAL_MS = 5 * 60_000;
const TABLE_FETCH_BATCH_SIZE = 200;
const DEEP_FETCH_PAYLOAD_UNWRAP_MAX_DEPTH = 3;
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
 */
const COLLECTION_QUIRKS = {
  venues: { noVenueFilter: true },
};

// ── Field mapping: Directus → local in-memory store format ───────────────────

function _relationId(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value.id ?? null;
  return value;
}

function _parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

function _mapRecord(collection, r) {
  if (collection === 'orders') return mapOrderFromDirectus(r);
  if (collection === 'bill_sessions') return mapBillSessionFromDirectus(r);
  if (collection === 'order_items') return mapOrderItemFromDirectus(r);
  if (collection === 'menu_items') {
    return { ...r, ingredients: _parseJsonArray(r.ingredients), allergens: _parseJsonArray(r.allergens), _sync_status: 'synced' };
  }
  if (collection === 'menu_modifiers') return { ...r, venue: _relationId(r.venue), _sync_status: 'synced' };
  if (collection === 'menu_categories_menu_modifiers') {
    return { ...r, venue: _relationId(r.venue), menu_categories_id: _relationId(r.menu_categories_id), menu_modifiers_id: _relationId(r.menu_modifiers_id), _sync_status: 'synced' };
  }
  if (collection === 'menu_items_menu_modifiers') {
    return { ...r, venue: _relationId(r.venue), menu_items_id: _relationId(r.menu_items_id), menu_modifiers_id: _relationId(r.menu_modifiers_id), _sync_status: 'synced' };
  }
  if (collection === 'table_merge_sessions') {
    return { ...r, venue: _relationId(r.venue), master_table: _relationId(r.master_table), slave_table: _relationId(r.slave_table), _sync_status: 'synced' };
  }
  return { ...r, _sync_status: 'synced' };
}

// ── In-memory store merge ─────────────────────────────────────────────────────

function _mergeIntoStore(collection, records, store) {
  if (!store || records.length === 0) return;

  if (collection === 'orders') {
    const byId = new Map(store.orders.map(o => [o.id, o]));
    for (const incoming of records) {
      const existing = byId.get(incoming.id);
      if (!existing) {
        byId.set(incoming.id, incoming);
      } else {
        if (_shouldSkipIncomingRecord(existing)) {
          continue;
        }
        const incomingTs = incoming.date_updated ? new Date(incoming.date_updated).getTime() : 0;
        const existingTs = existing.date_updated ? new Date(existing.date_updated).getTime() : 0;
        if (incomingTs > existingTs) {
          byId.set(incoming.id, {
            ...incoming,
            orderItems: existing.orderItems ?? incoming.orderItems ?? [],
          });
        }
      }
    }
    store.orders = Array.from(byId.values());
    return;
  }

  if (collection === 'bill_sessions') {
    const sessionTsMap = new Map(
      store.orders
        .filter(o => o.billSessionId && o.date_updated)
        .map(o => [o.billSessionId, o.date_updated])
    );
    const currentSessions = { ...store.tableCurrentBillSession };
    for (const incoming of records) {
      if (incoming.status === 'open') {
        const tableId = incoming.table;
        if (!tableId) continue;
        const existingSession = currentSessions[tableId];
        const existingTs = existingSession ? (sessionTsMap.get(existingSession.billSessionId) ?? '') : '';
        const incomingTs = incoming.date_updated ?? '';
        if (!existingSession || incomingTs > existingTs) {
          currentSessions[tableId] = {
            ...(existingSession ?? {}),
            billSessionId: incoming.billSessionId ?? incoming.id,
            adults: incoming.adults ?? 0,
            children: incoming.children ?? 0,
            table: incoming.table ?? existingSession?.table,
            status: incoming.status ?? existingSession?.status,
            opened_at: incoming.opened_at ?? existingSession?.opened_at ?? null,
          };
        }
      } else if (incoming.status === 'closed') {
        const tableId = incoming.table;
        if (tableId && currentSessions[tableId]?.billSessionId === (incoming.billSessionId ?? incoming.id)) {
          delete currentSessions[tableId];
        }
      }
    }
    store.tableCurrentBillSession = currentSessions;
    return;
  }

  if (collection === 'order_items') {
    const orderMap = new Map(store.orders.map(o => [o.id, o]));
    for (const incoming of records) {
      const orderId = incoming.orderId ?? incoming.order;
      if (!orderId) continue;
      const order = orderMap.get(orderId);
      if (!order) continue;
      if (!order.orderItems) order.orderItems = [];
      const idx = order.orderItems.findIndex(oi => oi.uid === incoming.uid || oi.id === incoming.id);
      if (idx === -1) {
        order.orderItems.push(incoming);
      } else {
        const existing = order.orderItems[idx];
        if (_shouldSkipIncomingRecord(existing)) {
          continue;
        }
        const incomingTs = incoming.date_updated ? new Date(incoming.date_updated).getTime() : 0;
        const existingTs = existing.date_updated ? new Date(existing.date_updated).getTime() : 0;
        if (incomingTs >= existingTs) {
          const kitchenReady = (existing.kitchenReady || incoming.kitchenReady) === true;
          order.orderItems[idx] = { ...incoming, kitchenReady };
        }
      }
    }
    store.orders = store.orders.map(o => ({ ...o }));
    return;
  }

  // H3: Merge table_merge_sessions into store.tableMergedInto.
  // Each Directus record maps slave_table → master_table.
  if (collection === 'table_merge_sessions') {
    const merged = { ...(store.tableMergedInto ?? {}) };
    for (const r of records) {
      if (r.slave_table && r.master_table) {
        merged[r.slave_table] = r.master_table;
      }
    }
    store.tableMergedInto = merged;
    return;
  }
}

function _deleteFromStore(collection, records, store) {
  if (!store || !Array.isArray(records) || records.length === 0) return;
  const extractIdSet = () => new Set(_extractRecordIds(records));
  if (collection === 'orders') {
    const ids = extractIdSet();
    store.orders = store.orders.filter(o => !ids.has(String(o.id)));
    return;
  }
  if (collection === 'order_items') {
    const ids = extractIdSet();
    store.orders = store.orders.map((o) => ({
      ...o,
      orderItems: Array.isArray(o.orderItems)
        ? o.orderItems.filter((item) => !ids.has(String(item.id ?? item.uid)))
        : [],
    }));
    return;
  }
  if (collection === 'bill_sessions') {
    const ids = extractIdSet();
    const next = { ...(store.tableCurrentBillSession ?? {}) };
    for (const [tableId, session] of Object.entries(next)) {
      if (ids.has(String(session?.billSessionId ?? session?.id))) {
        delete next[tableId];
      }
    }
    store.tableCurrentBillSession = next;
  }
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

  const operationalCollections = new Set([
    'orders',
    'order_items',
    'order_item_modifiers',
    'bill_sessions',
    'transactions',
    'table_merge_sessions',
  ]);
  if (!collection || operationalCollections.has(collection)) {
    const state = await loadStateFromIDB();
    if (!state) return;

    const applySlice = (storeKey) => {
      if (Object.prototype.hasOwnProperty.call(state, storeKey)) {
        _store[storeKey] = state[storeKey];
      }
    };

    if (!collection || collection === 'orders' || collection === 'order_items' || collection === 'order_item_modifiers') {
      applySlice('orders');
    }
    if (!collection || collection === 'bill_sessions') {
      applySlice('tableCurrentBillSession');
    }
    if (!collection || collection === 'transactions') {
      applySlice('transactions');
    }
    if (!collection || collection === 'table_merge_sessions') {
      applySlice('tableMergedInto');
    }
  }
}

function _extractRecordIds(records) {
  return records
    .map((r) => String(r?.id ?? r))
    .filter(Boolean);
}

function _shouldSkipIncomingRecord(existing) {
  return existing?._sync_status === 'pending'
    && (existing.date_updated === null || existing.date_updated === undefined);
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
  const query = {
    limit: 200,
    page,
    sort: [quirks.noDateUpdated ? 'id' : 'date_updated'],
    fields: ['*'],
  };

  // Incremental pull filter (only records updated after last known timestamp).
  // Skipped for collections that have no date_updated field (noDateUpdated quirk).
  const conditions = [];
  if (sinceTs && !quirks.noDateUpdated) {
    conditions.push({ date_updated: { _gt: sinceTs } });
  }
  // Venue filter — skipped for collections without a `venue` FK (noVenueFilter quirk).
  if (!quirks.noVenueFilter && cfg.venueId != null) {
    conditions.push({ venue: { _eq: cfg.venueId } });
  }
  if (conditions.length === 1) {
    query.filter = conditions[0];
  } else if (conditions.length > 1) {
    query.filter = { _and: conditions };
  }

  try {
    const records = await client.request(readItems(collection, query));
    const data = Array.isArray(records) ? records : [];
    const timestamps = data.map(r => r.date_updated).filter(Boolean);
    const maxTs = timestamps.length > 0 ? timestamps.reduce((a, b) => (a > b ? a : b)) : null;
    return { data, maxTs, error: null };
  } catch (e) {
    console.warn(`[DirectusSync] Pull ${collection} error:`, e?.message ?? e);
    return { data: [], maxTs: null, error: e };
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
      if (_store) {
        const merged = {};
        for (const r of allMapped) {
          if (r.slave_table && r.master_table) merged[r.slave_table] = r.master_table;
        }
        _store.tableMergedInto = merged;
      }
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

  while (true) { // eslint-disable-line no-constant-condition
    const { data, maxTs, error } = await _fetchUpdatedViaSDK(collection, storedSinceTs, page);
    if (error) hadFetchError = true;
    if (data.length === 0) break;

    const mapped = data.map(r => _mapRecord(collection, r));
    const written = await upsertRecordsIntoIDB(collection, mapped);
    totalMerged += written;

    if (_store) {
      _mergeIntoStore(collection, mapped, _store);
    }

    if (maxTs && (!latestTs || maxTs > latestTs)) latestTs = maxTs;
    if (data.length < 200) break;
    page++;
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
 * @param {string} collection
 * @param {{ event: string, data: object[] }} message
 */
async function _handleSubscriptionMessage(collection, message) {
  const { event, data } = message;
  if (!data || !Array.isArray(data) || data.length === 0) return;

  if (event === 'delete') {
    if (collection === 'table_merge_sessions') {
      await _pullCollection('table_merge_sessions', { forceFull: true });
      return;
    }
    const ids = _extractRecordIds(data);
    await deleteRecordsFromIDB(collection, ids);
    if (_store) _deleteFromStore(collection, ids, _store);
    await _refreshStoreFromIDB(collection);
  } else {
    const mapped = data.map(r => _mapRecord(collection, r));
    await upsertRecordsIntoIDB(collection, mapped);
    if (_store) {
      _mergeIntoStore(collection, mapped, _store);
    }
    await _refreshStoreFromIDB(collection);
  }

  lastPullAt.value = new Date().toISOString();
  console.info(`[DirectusSync] WS ${event} on ${collection}: ${data.length} record(s)`);
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
        query.filter = { venue: { _eq: venueId } };
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
          // Restart polling fallback if the subscription broke unexpectedly
          if (_running && !_pollTimer) {
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

  const client = getDirectusClient();
  try { client?.disconnect?.(); } catch (_) { /* best-effort */ }
  _wsConnected.value = false;
}

// ── Singleton state ───────────────────────────────────────────────────────────

let _running = false;
let _pushTimer = null;
let _pollTimer = null;
let _globalTimer = null;
let _pushInFlight = null;
/** @type {object|null} */
let _store = null;
/** @type {'cassa'|'sala'|'cucina'} */
let _appType = 'cassa';

const syncStatus = ref(/** @type {'idle'|'syncing'|'error'} */ ('idle'));
const lastPushAt = ref(/** @type {string|null} */ (null));
const lastPullAt = ref(/** @type {string|null} */ (null));

// ── Push helpers ──────────────────────────────────────────────────────────────

function _getCfg() {
  const d = appConfig.directus;
  if (!d?.enabled || !d?.url || !d?.staticToken) return null;
  return { url: d.url, staticToken: d.staticToken, venueId: d.venueId ?? null };
}

async function _runPush() {
  if (_pushInFlight) return _pushInFlight;
  _pushInFlight = (async () => {
    try {
      if (!navigator.onLine) return;
      const cfg = _getCfg();
      if (!cfg) return;
      syncStatus.value = 'syncing';
      const result = await drainQueue(cfg);
      if (result.pushed > 0 || result.abandoned > 0) {
        lastPushAt.value = new Date().toISOString();
      }
      syncStatus.value = result.failed > 0 ? 'error' : 'idle';
    } catch (e) {
      console.warn('[DirectusSync] Push error:', e);
      syncStatus.value = 'error';
    } finally {
      _pushInFlight = null;
    }
  })();
  return _pushInFlight;
}

// ── Pull helpers ──────────────────────────────────────────────────────────────

async function _runPull() {
  if (!navigator.onLine) return;
  if (!_getCfg()) return;

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
    if (anyMerged && allOk) {
      lastPullAt.value = new Date().toISOString();
      console.info('[DirectusSync] Pull cycle completed successfully.');
    } else if (!allOk) {
      console.warn('[DirectusSync] Pull cycle incomplete: at least one collection failed.');
    }
  } catch (e) {
    console.warn('[DirectusSync] Pull error:', e);
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
    const id = _relationId(record?.id);
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
      const id = _relationId(tableRef);
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
        venue: _relationId(modifier.venue) ?? venueRecord.id,
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
        venue: _relationId(link.venue) ?? venueRecord.id,
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
        venue: _relationId(link.venue) ?? venueRecord.id,
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
  const venueId = _relationId(venueRecord.id);
  const withVenueFallback = (records) => _normalizeToArray(records).map((record) => {
    if (!record || typeof record !== 'object' || Array.isArray(record) || venueId == null) return record;
    if (_relationId(record.venue) != null) return record;
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
  const venueUsers = _normalizeToArray(venueRecord.venue_users)
    .filter(_isObjectRecord);
  const tableMergeSessions = _normalizeToArray(venueRecord.table_merge_sessions)
    .filter(_isObjectRecord);

  const flatVenueRecord = { ...venueRecord };
  for (const key of VENUE_NESTED_RELATION_KEYS) {
    delete flatVenueRecord[key];
  }

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
    .filter(([storeName]) => storeName !== 'table_merge_sessions')
    .map(([storeName, records]) => upsertRecordsIntoIDB(storeName, records)));
  // table_merge_sessions must be full-replaced so stale dissolved merges are removed
  // from IDB instead of lingering indefinitely via upsert-only semantics.
  await replaceTableMergesInIDB(payloadByStore.table_merge_sessions);
  return Object.fromEntries(stores.map(([storeName, records]) => [storeName, records.length]));
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
  Object.assign(appConfig, runtimeConfig);
  if (preservedMenuSource === 'json') {
    appConfig.menuSource = 'json';
    appConfig.menuUrl = preservedMenuUrl;
  }
  appConfig.directus = preservedDirectus;
  appConfig.instanceName = preservedInstanceName;
  appConfig.pwaLogo = preservedPwaLogo;
  _syncPreBillPrinterSelection(cached?.venueRecord ?? null);
  _syncStoreConfigSnapshot();
  _emitProgress(onProgress, { level: 'info', message: 'Configurazione locale applicata.' });
  return true;
}

function _syncStoreConfigSnapshot() {
  if (!_store?.config) return;
  // Force a new reference so Vue/Pinia consumers relying on `store.config`
  // receive reactive updates even when `appConfig` was mutated out-of-proxy.
  const snapshot = SUPPORTS_STRUCTURED_CLONE
    ? structuredClone(appConfig)
    : JSON.parse(JSON.stringify(appConfig));
  _store.config = snapshot;
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
 * Selection priority:
 *  1) Keep current store selection if still valid
 *  2) Use Directus venue default (pre_bill_printer / preBillPrinter) when valid
 *  3) Fallback to first available pre-bill-capable printer
 *
 * @param {object|null} venueRecord
 */
function _syncPreBillPrinterSelection(venueRecord = null) {
  if (!_store) return;
  const candidates = _preBillPrinters();
  if (candidates.length === 0) {
    _store.preBillPrinterId = '';
    return;
  }
  const current = typeof _store.preBillPrinterId === 'string' ? _store.preBillPrinterId : '';
  if (current && candidates.some((printer) => printer.id === current)) return;
  // Accept both Directus snake_case and local camelCase keys for robustness
  // across deep-fetch payload shapes and cached snapshots.
  const snakeDefault = _relationId(venueRecord?.pre_bill_printer);
  const camelDefault = _relationId(venueRecord?.preBillPrinter);
  if (snakeDefault && camelDefault && snakeDefault !== camelDefault) {
    console.warn('[DirectusSync] Conflicting pre-bill default printer values in venue record:', {
      pre_bill_printer: snakeDefault,
      preBillPrinter: camelDefault,
      selected: snakeDefault,
      note: 'Using pre_bill_printer as precedence.',
    });
  }
  const remoteDefault =
    snakeDefault ??
    camelDefault ??
    null;
  if (remoteDefault && candidates.some((printer) => printer.id === remoteDefault)) {
    _store.preBillPrinterId = remoteDefault;
    return;
  }
  _store.preBillPrinterId = candidates[0]?.id ?? '';
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
    let deepVenue = null;
    let deepFetchMode = 'full';
    let deepFetchError = null;
    for (const [index, fieldSet] of DEEP_FETCH_FIELD_SETS.entries()) {
      try {
        const deepVenueRaw = await client.request(readItem('venues', venueId, { fields: fieldSet.fields }));
        deepVenue = _extractDeepVenuePayload(deepVenueRaw);
        if (!deepVenue) throw new Error('Deep fetch payload is empty or invalid.');
        deepFetchMode = fieldSet.key;
        deepFetchError = null;
        break;
      } catch (err) {
        deepFetchError = err;
        if (index < DEEP_FETCH_FIELD_SETS.length - 1) {
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

    const localMenuSource = appConfig.menuSource;
    const remoteMenuSource = deepVenue.menu_source;
    const menuSource = localMenuSource === 'json'
      ? 'json'
      : (remoteMenuSource ?? localMenuSource ?? 'directus');
    const fanOutSummary = await _fanOutVenueTreeToIDB(deepVenue, { menuSource });
    await saveLastPullTsToIDB('deep_venue_config', new Date().toISOString());

    if (appConfig.directus?.debugLogs === true) {
      const usedFields = DEEP_FETCH_FIELD_SETS.find(set => set.key === deepFetchMode)?.fields ?? DEEP_FETCH_FIELDS;
      console.info('[DirectusSync] Deep fetch mode:', deepFetchMode);
      console.info('[DirectusSync] Deep fetch fields:', usedFields.join(', '));
      console.info('[DirectusSync] Deep fetch fan-out summary:', fanOutSummary);
    }
    _emitProgress(onProgress, {
      level: 'info',
      message: `Deep fetch completato (menu_source=${menuSource}).`,
      details: JSON.stringify(fanOutSummary),
    });

    await _hydrateConfigFromLocalCache(venueId, onProgress);
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

function _onOnline() {
  _runPush().catch(() => {});
  _runPull().catch(() => {});
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

    if (wsEnabled) {
      // Try WebSocket subscriptions; fall back to polling if connect fails
      const subscribed = await _startSubscriptions(pullCfg.collections);
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
      window.addEventListener('sync-queue:enqueue', _onQueueEnqueue);
    }
  }

  function stopSync() {
    _running = false;
    _store = null;
    if (_pushTimer) { clearInterval(_pushTimer); _pushTimer = null; }
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    if (_globalTimer) { clearInterval(_globalTimer); _globalTimer = null; }
    _stopSubscriptions();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', _onOnline);
      window.removeEventListener('sync-queue:enqueue', _onQueueEnqueue);
    }
    syncStatus.value = 'idle';
  }

  async function forcePush() {
    if (!appConfig.directus?.enabled) return;
    await _runPush();
  }

  async function forcePull() {
    if (!appConfig.directus?.enabled) return;
    await _runPull();
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
        Object.assign(appConfig, createRuntimeConfig(DEFAULT_SETTINGS));
        appConfig.directus = preservedDirectus;
        _syncStoreConfigSnapshot();
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
  };
}

/**
 * @internal For test isolation only.
 */
export function _resetDirectusSyncSingleton() {
  _running = false;
  _store = null;
  _appType = 'cassa';
  _pushInFlight = null;
  if (_pushTimer) { clearInterval(_pushTimer); _pushTimer = null; }
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  if (_globalTimer) { clearInterval(_globalTimer); _globalTimer = null; }
  _stopSubscriptions();
  if (typeof window !== 'undefined') {
    window.removeEventListener('online', _onOnline);
    window.removeEventListener('sync-queue:enqueue', _onQueueEnqueue);
  }
  syncStatus.value = 'idle';
  lastPushAt.value = null;
  lastPullAt.value = null;
}
