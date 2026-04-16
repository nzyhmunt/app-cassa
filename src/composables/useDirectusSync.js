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
import { createDirectus, staticToken, rest, readItems } from '@directus/sdk';
import { appConfig, applyDirectusConfigToAppConfig, resetAppConfigFromDefaults } from '../utils/index.js';
import { getDirectusClient } from './useDirectusClient.js';
import { drainQueue } from './useSyncQueue.js';
import {
  loadLastPullTsFromIDB,
  saveLastPullTsToIDB,
  upsertRecordsIntoIDB,
  deleteRecordsFromIDB,
  loadConfigFromIDB,
  replaceTableMergesInIDB,
  clearLocalConfigCacheFromIDB,
} from '../store/idbPersistence.js';

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
const GLOBAL_COLLECTIONS = [
  'venues', 'rooms', 'tables', 'payment_methods', 'app_settings',
  'menu_categories', 'menu_items', 'menu_modifiers',
  'menu_categories_menu_modifiers', 'menu_items_menu_modifiers',
  'printers', 'venue_users', 'table_merge_sessions',
];
const GLOBAL_INTERVAL_MS = 5 * 60_000;
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

function _mapOrder(r) {
  const tableId = _relationId(r.table);
  const billSessionId = _relationId(r.bill_session ?? r.billSessionId ?? null);
  return {
    ...r,
    table: tableId ?? r.table ?? null,
    bill_session: billSessionId,
    billSessionId,
    totalAmount: r.total_amount ?? r.totalAmount ?? 0,
    itemCount: r.item_count ?? r.itemCount ?? 0,
    time: r.order_time ?? r.time ?? '',
    globalNote: r.global_note ?? r.globalNote ?? '',
    noteVisibility: {
      cassa: r.note_visibility_cassa ?? r.noteVisibility?.cassa ?? true,
      sala: r.note_visibility_sala ?? r.noteVisibility?.sala ?? true,
      cucina: r.note_visibility_cucina ?? r.noteVisibility?.cucina ?? true,
    },
    isCoverCharge: r.is_cover_charge ?? r.isCoverCharge ?? false,
    isDirectEntry: r.is_direct_entry ?? r.isDirectEntry ?? false,
    rejectionReason: r.rejection_reason ?? r.rejectionReason ?? null,
    dietaryPreferences: r.dietaryPreferences ?? {
      diete: _parseJsonArray(r.dietary_diets),
      allergeni: _parseJsonArray(r.dietary_allergens),
    },
    orderItems: r.orderItems ?? r.order_items ?? [],
    _sync_status: 'synced',
  };
}

function _mapBillSession(r) {
  return {
    ...r,
    billSessionId: r.id,
    adults: r.adults ?? r.adults_count ?? 0,
    children: r.children ?? r.children_count ?? 0,
    _sync_status: 'synced',
  };
}

function _mapOrderItem(r) {
  const orderId = _relationId(r.order ?? r.orderId ?? null);
  const dishId = _relationId(r.dish ?? r.dishId ?? null);
  return {
    ...r,
    order: orderId,
    orderId,
    dish: dishId,
    dishId,
    uid: r.uid ?? r.id,
    unitPrice: r.unit_price ?? r.unitPrice ?? 0,
    voidedQuantity: r.voided_quantity ?? r.voidedQuantity ?? 0,
    kitchenReady: r.kitchen_ready ?? r.kitchenReady ?? false,
    _sync_status: 'synced',
  };
}

function _mapMenuItem(r) {
  return {
    ...r,
    ingredients: _parseJsonArray(r.ingredients),
    allergens: _parseJsonArray(r.allergens),
    _sync_status: 'synced',
  };
}

function _mapMenuModifier(r) {
  return {
    ...r,
    venue: _relationId(r.venue),
    _sync_status: 'synced',
  };
}

function _mapMenuCategoryModifierLink(r) {
  return {
    ...r,
    venue: _relationId(r.venue),
    menu_categories_id: _relationId(r.menu_categories_id),
    menu_modifiers_id: _relationId(r.menu_modifiers_id),
    _sync_status: 'synced',
  };
}

function _mapMenuItemModifierLink(r) {
  return {
    ...r,
    venue: _relationId(r.venue),
    menu_items_id: _relationId(r.menu_items_id),
    menu_modifiers_id: _relationId(r.menu_modifiers_id),
    _sync_status: 'synced',
  };
}

function _mapTableMergeSession(r) {
  return {
    ...r,
    venue: _relationId(r.venue),
    master_table: _relationId(r.master_table),
    slave_table: _relationId(r.slave_table),
    _sync_status: 'synced',
  };
}

function _mapRecord(collection, r) {
  if (collection === 'orders') return _mapOrder(r);
  if (collection === 'bill_sessions') return _mapBillSession(r);
  if (collection === 'order_items') return _mapOrderItem(r);
  if (collection === 'menu_items') return _mapMenuItem(r);
  if (collection === 'menu_modifiers') return _mapMenuModifier(r);
  if (collection === 'menu_categories_menu_modifiers') return _mapMenuCategoryModifierLink(r);
  if (collection === 'menu_items_menu_modifiers') return _mapMenuItemModifierLink(r);
  if (collection === 'table_merge_sessions') return _mapTableMergeSession(r);
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
  } else {
    const mapped = data.map(r => _mapRecord(collection, r));
    await upsertRecordsIntoIDB(collection, mapped);
    if (_store) {
      _mergeIntoStore(collection, mapped, _store);
    }
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
let _initialGlobalHydrationDone = false;
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
  if (!navigator.onLine) return;
  const cfg = _getCfg();
  if (!cfg) return;

  try {
    syncStatus.value = 'syncing';
    const result = await drainQueue(cfg);
    if (result.pushed > 0 || result.abandoned > 0) {
      lastPushAt.value = new Date().toISOString();
    }
    syncStatus.value = result.failed > 0 ? 'error' : 'idle';
  } catch (e) {
    console.warn('[DirectusSync] Push error:', e);
    syncStatus.value = 'error';
  }
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

function _emitProgress(onProgress, payload) {
  if (typeof onProgress === 'function') {
    try { onProgress(payload); } catch (e) {
      console.warn('[DirectusSync] onProgress callback error:', e);
    }
  }
}

async function _runGlobalPull({ forceFullAll = false, onProgress = null } = {}) {
  if (!navigator.onLine) return;
  if (!_getCfg()) return;

  // Capture venueId before the pull loop so that appConfig mutations during
  // a long pull cannot change which venue we query / hydrate into (D3 review).
  const venueId = appConfig.directus?.venueId ?? null;
  const MENU_COLLECTIONS = new Set([
    'menu_categories',
    'menu_items',
    'menu_modifiers',
    'menu_categories_menu_modifiers',
    'menu_items_menu_modifiers',
  ]);

  try {
    _emitProgress(onProgress, { level: 'info', message: 'Avvio pull globale configurazione Directus…' });
    let configHydrationOk = true;
    const menuSource = appConfig.menuSource ?? 'directus';
    const fullModeCollections = [];
    const failedCollections = [];
    for (const collection of GLOBAL_COLLECTIONS) {
      if (menuSource === 'json' && MENU_COLLECTIONS.has(collection)) {
        _emitProgress(onProgress, {
          level: 'info',
          message: `Pull "${collection}" saltato (venue.menu_source=json).`,
        });
        continue;
      }
      _emitProgress(onProgress, { level: 'info', message: `Pull collezione "${collection}"…` });
      // Keep global pull incremental by default (lower backend load), but:
      //  - always force full pull on initial global hydration after startSync
      //  - force full pull when stored cursor is clearly invalid (future timestamp)
      let forceFull = forceFullAll || !_initialGlobalHydrationDone;
      let lastPullTimestamp = null;
      if (!forceFullAll && !forceFull) {
        lastPullTimestamp = await loadLastPullTsFromIDB(collection);
        const timestampMs = lastPullTimestamp ? Date.parse(lastPullTimestamp) : NaN;
        if (Number.isFinite(timestampMs) && timestampMs > (Date.now() + GLOBAL_TIMESTAMP_SKEW_TOLERANCE_MS)) {
          console.warn(
            `[DirectusSync] Ignoring invalid future last_pull_ts for ${collection} and forcing a full pull:`,
            lastPullTimestamp,
          );
          forceFull = true;
          lastPullTimestamp = null;
        }
      }
      const { ok } = await _pullCollection(collection, { forceFull, lastPullTimestampOverride: lastPullTimestamp });
      if (!ok) configHydrationOk = false;
      if (forceFull) fullModeCollections.push(collection);
      if (!ok) failedCollections.push(collection);
      _emitProgress(onProgress, {
        level: ok ? 'info' : 'error',
        message: ok
          ? `Pull "${collection}" completato.`
          : `Pull "${collection}" fallito.`,
      });
    }
    if (fullModeCollections.length > 0 || failedCollections.length > 0) {
      console.info(
        `[DirectusSync] Global pull details — full mode: ${fullModeCollections.join(', ') || 'none'}; failed: ${failedCollections.join(', ') || 'none'}.`,
      );
    }

    if (configHydrationOk) {
      _initialGlobalHydrationDone = true;
    } else {
      console.warn('[DirectusSync] Global config hydration incomplete; hydration/apply was skipped due to pull errors.');
    }

    // D3: Hydrate appConfig from IDB after pulling config collections.
    // Skip hydration when venueId is not configured: without a venue filter
    // loadConfigFromIDB() would return records for *all* venues and mix them
    // into a single (incorrect) appConfig.
    // Also skip hydration when this global cycle had errors, to avoid publishing
    // partial config snapshots to the live app/store.
    if (venueId != null && configHydrationOk) {
      _emitProgress(onProgress, { level: 'info', message: 'Idratazione configurazione da IndexedDB…' });
      const cfg = await loadConfigFromIDB(venueId);
      applyDirectusConfigToAppConfig(cfg);
      // Keep the reactive store config in sync with the hydrated appConfig so
      // the UI reflects the pull immediately without requiring a reload.
      if (_store?.config) {
        Object.assign(_store.config, appConfig);
      }
      _emitProgress(onProgress, { level: 'success', message: 'Configurazione applicata con successo.' });
    } else if (venueId == null) {
      _emitProgress(onProgress, {
        level: 'error',
        message: 'Applicazione configurazione saltata: venueId non configurato.',
      });
    } else {
      _emitProgress(onProgress, {
        level: 'error',
        message: 'Applicazione configurazione saltata: pull globale incompleto.',
      });
    }
    return { ok: configHydrationOk && venueId != null, failedCollections };
  } catch (e) {
    console.warn('[DirectusSync] Global pull error:', e);
    _emitProgress(onProgress, {
      level: 'error',
      message: 'Errore durante il pull globale.',
      details: String(e?.message ?? e),
    });
    return { ok: false, failedCollections: GLOBAL_COLLECTIONS };
  }
}

// ── Online/offline listener ───────────────────────────────────────────────────

function _onOnline() {
  _runPush().catch(() => {});
  _runPull().catch(() => {});
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
    _initialGlobalHydrationDone = false;
    _running = true;

    const pullCfg = PULL_CONFIG[_appType] ?? PULL_CONFIG.cassa;

    // Initial push + global config pull
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
    }
  }

  function stopSync() {
    _running = false;
    _initialGlobalHydrationDone = false;
    _store = null;
    if (_pushTimer) { clearInterval(_pushTimer); _pushTimer = null; }
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    if (_globalTimer) { clearInterval(_globalTimer); _globalTimer = null; }
    _stopSubscriptions();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', _onOnline);
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
        resetAppConfigFromDefaults({ keepDirectusConfig: true });
        if (_store?.config) Object.assign(_store.config, appConfig);
        _emitProgress(onProgress, { level: 'info', message: 'Cache configurazione locale svuotata.' });
      }

      const result = await _runGlobalPull({ forceFullAll: true, onProgress });
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
  _initialGlobalHydrationDone = false;
  _store = null;
  _appType = 'cassa';
  if (_pushTimer) { clearInterval(_pushTimer); _pushTimer = null; }
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  if (_globalTimer) { clearInterval(_globalTimer); _globalTimer = null; }
  _stopSubscriptions();
  syncStatus.value = 'idle';
  lastPushAt.value = null;
  lastPullAt.value = null;
}
