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
import { appConfig, applyDirectusConfigToAppConfig } from '../utils/index.js';
import { getDirectusClient } from './useDirectusClient.js';
import { drainQueue } from './useSyncQueue.js';
import {
  loadLastPullTsFromIDB,
  saveLastPullTsToIDB,
  upsertRecordsIntoIDB,
  loadConfigFromIDB,
  replaceTableMergesInIDB,
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
  'venues', 'rooms', 'tables', 'payment_methods',
  'menu_categories', 'menu_items', 'menu_item_modifiers',
  'printers', 'venue_users',
  // NOTE: table_merge_sessions is handled separately in _runGlobalPull because
  // it requires full-replace semantics (dissolved merges must be removed).
];
const GLOBAL_INTERVAL_MS = 5 * 60_000;
// Allow substantial device/server clock drift before treating last_pull_ts as invalid.
// 24h avoids perpetual full-refreshes on slightly misconfigured tablets while still
// catching clearly bogus cursors (for example, year 2099).
const GLOBAL_TIMESTAMP_SKEW_TOLERANCE_MS = 24 * 60 * 60_000;
const SYNC_ACTIVITY_LOG_LIMIT = 200;

/**
 * Per-collection quirks for collections that deviate from the default schema
 * assumed by _fetchUpdatedViaSDK (venue FK + date_updated timestamp field).
 *
 * H3: table_merge_sessions has neither a `venue` FK nor `date_updated`, so:
 *   - noVenueFilter: skip the `venue` filter to avoid an API error.
 *   - noDateUpdated: skip the incremental `date_updated` filter — full fetch
 *     every global pull cycle (the collection is small and short-lived).
 */
const COLLECTION_QUIRKS = {
  table_merge_sessions: { noVenueFilter: true, noDateUpdated: true },
};

// ── Field mapping: Directus → local in-memory store format ───────────────────

function _mapOrder(r) {
  return {
    ...r,
    billSessionId: r.bill_session ?? r.billSessionId ?? null,
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
      diete: r.dietary_diets ?? [],
      allergeni: r.dietary_allergens ?? [],
    },
    orderItems: r.orderItems ?? [],
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
  return {
    ...r,
    orderId: r.order ?? r.orderId ?? null,
    dishId: r.dish ?? r.dishId ?? null,
    uid: r.uid ?? r.id,
    unitPrice: r.unit_price ?? r.unitPrice ?? 0,
    voidedQuantity: r.voided_quantity ?? r.voidedQuantity ?? 0,
    kitchenReady: r.kitchen_ready ?? r.kitchenReady ?? false,
    _sync_status: 'synced',
  };
}

function _mapRecord(collection, r) {
  if (collection === 'orders') return _mapOrder(r);
  if (collection === 'bill_sessions') return _mapBillSession(r);
  if (collection === 'order_items') return _mapOrderItem(r);
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

  const mapped = data.map(r => _mapRecord(collection, r));
  await upsertRecordsIntoIDB(collection, mapped);

  if (_store) {
    _mergeIntoStore(collection, mapped, _store);
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
    _addActivity('success', `WebSocket connesso (${collections.length} collection).`);

    for (const collection of collections) {
      const query = { fields: ['*'] };
      if (venueId != null) {
        query.filter = { venue: { _eq: venueId } };
      }

      const { subscription, unsubscribe } = await client.subscribe(collection, { query });
      _unsubscribers.push(unsubscribe);
      _addActivity('info', `WebSocket subscription attivata: ${collection}.`);

      // Process subscription messages as they arrive
      async function processSubscription() {
        try {
          for await (const message of subscription) {
            await _handleSubscriptionMessage(collection, message);
          }
        } catch (e) {
          console.warn(`[DirectusSync] Subscription ${collection} closed:`, e?.message ?? e);
          _wsConnected.value = false;
          _addActivity('warning', `WebSocket subscription chiusa: ${collection} (${e?.message ?? e}).`);
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
    _addActivity('warning', `WebSocket non disponibile, fallback polling: ${e?.message ?? e}.`);
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
const activityLog = ref([]);

function _addActivity(level, message, meta = null) {
  const entry = {
    id: `dsl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    level,
    message,
    meta,
  };
  activityLog.value = [entry, ...activityLog.value].slice(0, SYNC_ACTIVITY_LOG_LIMIT);
}

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
    if (result.pushed > 0 || result.failed > 0 || result.abandoned > 0) {
      _addActivity(
        result.failed > 0 ? 'error' : 'success',
        `Push completato — inviati: ${result.pushed}, falliti: ${result.failed}, abbandonati: ${result.abandoned}.`,
      );
    }
  } catch (e) {
    console.warn('[DirectusSync] Push error:', e);
    syncStatus.value = 'error';
    _addActivity('error', `Push fallito: ${e?.message ?? e}`);
  }
}

// ── Pull helpers ──────────────────────────────────────────────────────────────

async function _runPull() {
  if (!navigator.onLine) return;
  if (!_getCfg()) return;

  const pullCfg = PULL_CONFIG[_appType] ?? PULL_CONFIG.cassa;
  _addActivity('info', `Pull ${_appType} avviato: ${pullCfg.collections.join(', ')}.`);

  try {
    let anyMerged = false;
    let allOk = true;
    const mergedSummary = [];
    const failedCollections = [];
    for (const collection of pullCfg.collections) {
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
      _addActivity(
        failedCollections.length > 0 ? 'warning' : 'success',
        `Pull completato — merged: ${mergedSummary.join(', ') || 'none'}; fallite: ${failedCollections.join(', ') || 'none'}.`,
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
    _addActivity('error', `Pull fallito: ${e?.message ?? e}`);
  }
}

async function _runGlobalPull() {
  if (!navigator.onLine) return;
  if (!_getCfg()) return;

  // Capture venueId before the pull loop so that appConfig mutations during
  // a long pull cannot change which venue we query / hydrate into (D3 review).
  const venueId = appConfig.directus?.venueId ?? null;
  _addActivity('info', `Global pull avviato${venueId != null ? ` (venue ${venueId})` : ''}.`);

  try {
    let fullHydrationOk = true;
    const fullModeCollections = [];
    const failedCollections = [];
    for (const collection of GLOBAL_COLLECTIONS) {
      // Keep global pull incremental by default (lower backend load), but:
      //  - always force full pull on initial global hydration after startSync
      //  - force full pull when stored cursor is clearly invalid (future timestamp)
      let forceFull = !_initialGlobalHydrationDone;
      let lastPullTimestamp = null;
      if (!forceFull) {
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
      if (!ok) fullHydrationOk = false;
      if (forceFull) fullModeCollections.push(collection);
      if (!ok) failedCollections.push(collection);
      _addActivity(
        ok ? 'success' : 'error',
        `${collection}: pull ${ok ? 'ok' : 'fallito'} (${forceFull ? 'full' : 'incrementale'}).`,
      );
    }
    if (fullModeCollections.length > 0 || failedCollections.length > 0) {
      console.info(
        `[DirectusSync] Global pull details — full mode: ${fullModeCollections.join(', ') || 'none'}; failed: ${failedCollections.join(', ') || 'none'}.`,
      );
    }

    // H3: table_merge_sessions — full-replace semantics.
    // Fetched with a full (non-incremental) pull and replaced atomically in IDB
    // so that dissolved merges (records deleted on Directus) are also cleared.
    const { data: mergeSessionRecords, error: mergeError } = await _fetchUpdatedViaSDK('table_merge_sessions', null);
    if (mergeError) {
      fullHydrationOk = false;
      console.warn('[DirectusSync] Skipping table_merge_sessions replace due to fetch error.');
      _addActivity('error', 'table_merge_sessions: fetch fallita, replace saltato.');
    } else {
      await replaceTableMergesInIDB(mergeSessionRecords);
      _addActivity('success', `table_merge_sessions: replace completato (${mergeSessionRecords.length} record).`);
      // Rebuild in-memory tableMergedInto from the authoritative Directus data.
      if (_store) {
        const merged = {};
        for (const r of mergeSessionRecords) {
          if (r.slave_table && r.master_table) merged[r.slave_table] = r.master_table;
        }
        _store.tableMergedInto = merged;
      }
    }

    if (fullHydrationOk) {
      _initialGlobalHydrationDone = true;
    } else {
      console.warn('[DirectusSync] Global config hydration incomplete; hydration/apply was skipped due to pull errors.');
      _addActivity('warning', 'Hydration globale incompleta: applicazione configurazione saltata.');
    }

    // D3: Hydrate appConfig from IDB after pulling config collections.
    // Skip hydration when venueId is not configured: without a venue filter
    // loadConfigFromIDB() would return records for *all* venues and mix them
    // into a single (incorrect) appConfig.
    // Also skip hydration when this global cycle had errors, to avoid publishing
    // partial config snapshots to the live app/store.
    if (venueId != null && fullHydrationOk) {
      const cfg = await loadConfigFromIDB(venueId);
      applyDirectusConfigToAppConfig(cfg);
      // Keep the reactive store config in sync with the hydrated appConfig so
      // the UI reflects the pull immediately without requiring a reload.
      if (_store?.config) {
        Object.assign(_store.config, appConfig);
      }
      _addActivity(
        'success',
        `Configurazione aggiornata da Directus (rooms: ${cfg.rooms?.length ?? 0}, tavoli: ${cfg.tables?.length ?? 0}, menu: ${cfg.menu?.length ?? 0}).`,
      );
    } else if (venueId == null) {
      _addActivity('warning', 'Hydration configurazione saltata: venueId mancante.');
    }
  } catch (e) {
    console.warn('[DirectusSync] Global pull error:', e);
    _addActivity('error', `Global pull fallito: ${e?.message ?? e}`);
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
    if (_running) {
      _addActivity('info', 'startSync ignorato: sincronizzazione già attiva.');
      return;
    }
    if (!appConfig.directus?.enabled) {
      _addActivity('info', 'startSync ignorato: Directus non abilitato.');
      return;
    }

    _appType = appType ?? 'cassa';
    _store = store;
    _initialGlobalHydrationDone = false;
    _running = true;
    _addActivity('info', `Sincronizzazione avviata (app: ${_appType}).`);

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
    _addActivity('info', `Modalità realtime: ${wsEnabled ? 'WebSocket + polling di backup' : 'solo polling REST'}.`);

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
    _addActivity('info', 'Sincronizzazione fermata.');
  }

  async function forcePush() {
    if (!appConfig.directus?.enabled) return;
    await _runPush();
  }

  async function forcePull() {
    if (!appConfig.directus?.enabled) return;
    await _runPull();
  }

  return {
    syncStatus,
    lastPushAt,
    lastPullAt,
    activityLog,
    wsConnected: _wsConnected,
    startSync,
    stopSync,
    forcePush,
    forcePull,
    appendActivityLog: _addActivity,
    clearActivityLog: () => { activityLog.value = []; },
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
  activityLog.value = [];
}
