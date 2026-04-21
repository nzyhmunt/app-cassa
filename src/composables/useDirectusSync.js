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
const DEEP_FETCH_JSON_FIELDS = [
  'id',
  'name',
  'status',
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

  while (true) { // eslint-disable-line no-constant-condition
    const { data, maxTs, error } = await _fetchUpdatedViaSDK(collection, storedSinceTs, page);
    if (error) hadFetchError = true;
    if (data.length === 0) break;
    hadRemoteRecords = true;

    const mapped = data.map(r => _mapRecord(collection, r));
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
    await _refreshStoreFromIDB(collection);
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
    await upsertRecordsIntoIDB(collection, mapped);
    await _refreshStoreFromIDB(collection);
  }

  lastPullAt.value = new Date().toISOString();
  const echoNote = suppressedCount > 0 ? ` (${suppressedCount} self-echo(es) suppressed)` : '';
  console.info(`[DirectusSync] WS ${event} on ${collection}: ${writtenCount} record(s) written${echoNote}`);
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
      // Register pushed IDs so self-echo events from the WebSocket are suppressed.
      if (Array.isArray(result.pushedIds) && result.pushedIds.length > 0) {
        _registerPushedEchoes(result.pushedIds);
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
  const venueUsers = _dedupeRecordsById(
    VENUE_USERS_RELATION_KEYS
      .flatMap((key) => _normalizeToArray(venueRecord[key]))
      .filter(_isObjectRecord),
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
    .filter(([storeName]) => storeName !== 'table_merge_sessions')
    .map(([storeName, records]) => upsertRecordsIntoIDB(storeName, records)));
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
  // Persist the auto-selected printer to IDB so the selection survives a reload.
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

    const localMenuSource = appConfig.menuSource;
    const remoteMenuSource = deepVenue.menu_source;
    const menuSource = localMenuSource === 'json'
      ? 'json'
      : (remoteMenuSource ?? localMenuSource ?? 'directus');
    const fanOutSummary = await _fanOutVenueTreeToIDB(deepVenue, { menuSource });
    await saveLastPullTsToIDB('deep_venue_config', new Date().toISOString());

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
    // When menu data comes from a local JSON file, exclude menu_items from WebSocket
    // subscriptions to avoid unnecessary subscription traffic and IDB fan-out.
    const menuSource = appConfig.menuSource ?? 'directus';
    const wsCollections = menuSource === 'json'
      ? pullCfg.collections.filter(c => c !== 'menu_items')
      : pullCfg.collections;

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
  _recentlyPushed.clear();
  if (typeof window !== 'undefined') {
    window.removeEventListener('online', _onOnline);
    window.removeEventListener('sync-queue:enqueue', _onQueueEnqueue);
  }
  syncStatus.value = 'idle';
  lastPushAt.value = null;
  lastPullAt.value = null;
}

/**
 * @internal For unit tests only. Direct handle for simulating incoming WS messages.
 */
export { _handleSubscriptionMessage, _registerPushedEchoes };
