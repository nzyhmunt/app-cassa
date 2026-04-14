/**
 * @file composables/useDirectusSync.js
 * @description Bidirezional sync composable — Step 2 di §5.7.8.
 *
 * Gestisce:
 *  - Push loop  (§5.7.2): svuota la sync_queue verso l'API Directus.
 *  - Pull loop  (§5.7.3): polling periodico per ricevere aggiornamenti dagli
 *                          altri dispositivi.
 *  - Conflict resolution (§5.7.4): last-write-wins su date_updated.
 *
 * Utilizzo (in ogni App root):
 *   const sync = useDirectusSync();
 *   onMounted(() => sync.startSync({ appType: 'cassa', store }));
 *   onUnmounted(() => sync.stopSync());
 *
 * Il composable è un singleton a livello di modulo: più chiamate restituiscono
 * lo stesso oggetto sottostante (garantisce un solo timer attivo per pagina).
 */

import { ref } from 'vue';
import { appConfig } from '../utils/index.js';
import { drainQueue } from './useSyncQueue.js';
import {
  loadLastPullTsFromIDB,
  saveLastPullTsToIDB,
  upsertRecordsIntoIDB,
} from '../store/idbPersistence.js';

// ── Per-app pull config (§5.7.6) ─────────────────────────────────────────────

/** @type {Record<string, { collections: string[], intervalMs: number }>} */
const PULL_CONFIG = {
  cassa: {
    collections: ['orders', 'bill_sessions', 'tables'],
    intervalMs: 5_000,
  },
  sala: {
    collections: ['orders', 'bill_sessions', 'tables', 'menu_items'],
    intervalMs: 3_000,
  },
  cucina: {
    collections: ['orders', 'order_items'],
    intervalMs: 3_000,
  },
};

/** Collections for all apps: fetched once at startup and every 5 minutes. */
const GLOBAL_COLLECTIONS = [
  'venues', 'rooms', 'payment_methods',
  'menu_categories', 'menu_items', 'menu_item_modifiers',
  'printers', 'venue_users',
];
const GLOBAL_INTERVAL_MS = 5 * 60_000;

// ── Field mapping: Directus → local in-memory store format ─────────────────

/**
 * Maps a raw Directus `orders` record to the shape used by the Pinia store.
 * Fields not listed are passed through as-is.
 * @param {object} r
 * @returns {object}
 */
function _mapOrder(r) {
  return {
    ...r,
    billSessionId: r.bill_session ?? r.billSessionId ?? null,
    totalAmount: r.total_amount ?? r.totalAmount ?? 0,
    itemCount: r.item_count ?? r.itemCount ?? 0,
    globalNote: r.global_note ?? r.globalNote ?? '',
    noteVisibility: {
      cassa: r.note_visibility_cassa ?? r.noteVisibility?.cassa ?? true,
      sala: r.note_visibility_sala ?? r.noteVisibility?.sala ?? true,
      cucina: r.note_visibility_cucina ?? r.noteVisibility?.cucina ?? true,
    },
    isCoverCharge: r.is_cover_charge ?? r.isCoverCharge ?? false,
    isDirectEntry: r.is_direct_entry ?? r.isDirectEntry ?? false,
    rejectionReason: r.rejection_reason ?? r.rejectionReason ?? null,
    // Preserve local-only fields that are not in Directus
    orderItems: r.orderItems ?? [],
    dietaryPreferences: r.dietary_preferences ?? r.dietaryPreferences ?? {},
    _sync_status: 'synced',
  };
}

/**
 * Maps a raw Directus `bill_sessions` record to a local bill session shape.
 * @param {object} r
 * @returns {object}
 */
function _mapBillSession(r) {
  return {
    ...r,
    billSessionId: r.id,
    adults: r.adults ?? 0,
    children: r.children ?? 0,
    _sync_status: 'synced',
  };
}

/**
 * Maps a raw Directus `order_items` record to the local shape.
 * @param {object} r
 * @returns {object}
 */
function _mapOrderItem(r) {
  return {
    ...r,
    orderId: r.order ?? r.orderId ?? null,
    uid: r.uid ?? r.id,
    unitPrice: r.unit_price ?? r.unitPrice ?? 0,
    voidedQuantity: r.voided_quantity ?? r.voidedQuantity ?? 0,
    kitchenReady: r.kitchen_ready ?? r.kitchenReady ?? false,
    _sync_status: 'synced',
  };
}

/** @param {string} collection @param {object} r */
function _mapRecord(collection, r) {
  if (collection === 'orders') return _mapOrder(r);
  if (collection === 'bill_sessions') return _mapBillSession(r);
  if (collection === 'order_items') return _mapOrderItem(r);
  return { ...r, _sync_status: 'synced' };
}

// ── Directus REST fetch ───────────────────────────────────────────────────────

/**
 * Fetches updated records for a single collection from Directus.
 *
 * Uses `filter[date_updated][_gt]` to request only records changed since the
 * last pull.  Returns an empty array on any error (pull failures are non-fatal).
 *
 * @param {string} collection
 * @param {{ url: string, staticToken: string, venueId: number|null }} cfg
 * @param {string|null} sinceTs  - ISO timestamp; null = fetch all
 * @param {number} [page]
 * @returns {Promise<{ data: object[], maxTs: string|null }>}
 */
async function _fetchUpdated(collection, cfg, sinceTs, page = 1) {
  const params = new URLSearchParams({
    limit: '200',
    page: String(page),
    sort: 'date_updated',
    'fields[]': '*',
  });

  if (sinceTs) {
    params.set('filter[date_updated][_gt]', sinceTs);
  }
  if (cfg.venueId != null) {
    // Not all collections have a `venue` FK (e.g. order_items, order_item_modifiers).
    // Adding the filter unconditionally would break those queries; Directus will
    // simply ignore unknown filter fields for collections without that relation.
    params.set('filter[venue][_eq]', String(cfg.venueId));
  }

  try {
    const res = await fetch(
      `${cfg.url}/items/${collection}?${params}`,
      { headers: { Authorization: `Bearer ${cfg.staticToken}` } },
    );
    if (!res.ok) {
      console.warn(`[DirectusSync] Pull ${collection} → HTTP ${res.status}`);
      return { data: [], maxTs: null };
    }
    const json = await res.json();
    const records = Array.isArray(json.data) ? json.data : [];
    const timestamps = records.map(r => r.date_updated).filter(Boolean);
    const maxTs = timestamps.length > 0
      ? timestamps.reduce((a, b) => (a > b ? a : b))
      : null;
    return { data: records, maxTs };
  } catch (e) {
    console.warn(`[DirectusSync] Pull ${collection} network error:`, e);
    return { data: [], maxTs: null };
  }
}

// ── In-memory store merge ─────────────────────────────────────────────────────

/**
 * Merges pulled Directus records into the Pinia store's in-memory state.
 *
 * - `orders`: upserts into `store.orders[]` by id (last-write-wins on date_updated).
 * - `bill_sessions`: rebuilds `store.tableCurrentBillSession` for open sessions.
 * - All other collections: no in-memory update (config caches are read on reload).
 *
 * @param {string} collection
 * @param {object[]} records  - Directus-format records (already mapped to local)
 * @param {object} store      - Pinia store instance (useAppStore)
 */
function _mergeIntoStore(collection, records, store) {
  if (!store || records.length === 0) return;

  if (collection === 'orders') {
    const byId = new Map(store.orders.map(o => [o.id, o]));
    for (const incoming of records) {
      const existing = byId.get(incoming.id);
      if (!existing) {
        // New order from another device — preserve local orderItems if somehow present
        byId.set(incoming.id, incoming);
      } else {
        // Conflict resolution: last-write-wins on date_updated
        const incomingTs = incoming.date_updated ? new Date(incoming.date_updated).getTime() : 0;
        const existingTs = existing.date_updated ? new Date(existing.date_updated).getTime() : 0;
        if (incomingTs > existingTs) {
          // Retain local orderItems (not stored in Directus orders collection)
          byId.set(incoming.id, {
            ...incoming,
            orderItems: existing.orderItems ?? incoming.orderItems ?? [],
          });
        }
        // Apply OR logic for kitchen_ready: if either side is true, set true (§5.7.4)
        // (kitchen_ready lives on order_items, not orders — handled in order_items branch)
      }
    }
    store.orders = Array.from(byId.values());
    return;
  }

  if (collection === 'bill_sessions') {
    // Merge open sessions into tableCurrentBillSession
    const currentSessions = { ...store.tableCurrentBillSession };
    for (const incoming of records) {
      if (incoming.status === 'open') {
        const tableId = incoming.table;
        if (!tableId) continue;
        const existingSession = currentSessions[tableId];
        const existingTs = existingSession ? (
          store.orders.find(o => o.billSessionId === existingSession.billSessionId)?.date_updated ?? ''
        ) : '';
        const incomingTs = incoming.date_updated ?? '';
        if (!existingSession || incomingTs > existingTs) {
          currentSessions[tableId] = {
            billSessionId: incoming.billSessionId ?? incoming.id,
            adults: incoming.adults ?? 0,
            children: incoming.children ?? 0,
          };
        }
      } else if (incoming.status === 'closed') {
        // Remove any local session for this table if the remote says it's closed
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
    // Merge order items into the nested orderItems arrays on the parent orders.
    // Apply OR logic for kitchen_ready (§5.7.4).
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
          // OR logic: if either side has kitchen_ready=true, preserve it
          const kitchenReady = (existing.kitchenReady || incoming.kitchenReady) === true;
          order.orderItems[idx] = { ...incoming, kitchenReady };
        }
      }
    }
    // trigger reactivity: replace the array (Vue 3 tracks array mutations via Proxy)
    store.orders = store.orders.map(o => ({ ...o }));
    return;
  }
}

// ── Singleton state ───────────────────────────────────────────────────────────

let _running = false;
let _pushTimer = null;
let _pullTimer = null;
let _globalTimer = null;
/** @type {object|null} store ref passed to startSync */
let _store = null;
/** @type {'cassa'|'sala'|'cucina'} */
let _appType = 'cassa';

/** Reactive status exposed to the UI. */
const syncStatus = ref(/** @type {'idle'|'syncing'|'error'} */ ('idle'));
/** Reactive last-successful-push timestamp. */
const lastPushAt = ref(/** @type {string|null} */ (null));
/** Reactive last-successful-pull timestamp. */
const lastPullAt = ref(/** @type {string|null} */ (null));

// ── Push helpers ──────────────────────────────────────────────────────────────

/**
 * Returns the Directus sync configuration from appConfig.
 * @returns {{ url: string, staticToken: string, venueId: number|null }|null}
 */
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

/**
 * Pulls all updated records for `collection` since the last pull and merges them
 * into IDB and the in-memory store.
 *
 * @param {string} collection
 * @param {{ url: string, staticToken: string, venueId: number|null }} cfg
 */
async function _pullCollection(collection, cfg) {
  const sinceTs = await loadLastPullTsFromIDB(collection);

  let page = 1;
  let latestTs = sinceTs;
  let totalMerged = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, maxTs } = await _fetchUpdated(collection, cfg, sinceTs, page);
    if (data.length === 0) break;

    // Map to local format before storing in IDB
    const mapped = data.map(r => _mapRecord(collection, r));

    // Upsert into IDB (last-write-wins)
    const written = await upsertRecordsIntoIDB(collection, mapped);
    totalMerged += written;

    // Update in-memory store for real-time reactivity
    if (_store && written > 0) {
      _mergeIntoStore(collection, mapped.filter(r => r.date_updated && written > 0), _store);
    }

    if (maxTs && (!latestTs || maxTs > latestTs)) latestTs = maxTs;

    if (data.length < 200) break; // last page
    page++;
  }

  if (latestTs && latestTs !== sinceTs) {
    await saveLastPullTsToIDB(collection, latestTs);
  }

  return totalMerged;
}

async function _runPull() {
  if (!navigator.onLine) return;
  const cfg = _getCfg();
  if (!cfg) return;

  const pullCfg = PULL_CONFIG[_appType] ?? PULL_CONFIG.cassa;

  try {
    let anyMerged = false;
    for (const collection of pullCfg.collections) {
      const merged = await _pullCollection(collection, cfg);
      if (merged > 0) anyMerged = true;
    }
    if (anyMerged) lastPullAt.value = new Date().toISOString();
  } catch (e) {
    console.warn('[DirectusSync] Pull error:', e);
  }
}

async function _runGlobalPull() {
  if (!navigator.onLine) return;
  const cfg = _getCfg();
  if (!cfg) return;

  try {
    for (const collection of GLOBAL_COLLECTIONS) {
      await _pullCollection(collection, cfg);
    }
  } catch (e) {
    console.warn('[DirectusSync] Global pull error:', e);
  }
}

// ── Online/offline listener ───────────────────────────────────────────────────

function _onOnline() {
  _runPush().catch(() => {});
  _runPull().catch(() => {});
}

// ── Public composable ─────────────────────────────────────────────────────────

/**
 * Returns the shared DirectusSync instance.
 *
 * @example
 * const sync = useDirectusSync();
 * onMounted(() => sync.startSync({ appType: 'cassa', store }));
 * onUnmounted(() => sync.stopSync());
 */
export function useDirectusSync() {
  /**
   * Starts the push and pull loops.
   *
   * @param {{ appType: 'cassa'|'sala'|'cucina', store: object }} opts
   */
  function startSync({ appType, store }) {
    if (_running) return;
    if (!appConfig.directus?.enabled) return; // sync disabled in config

    _appType = appType ?? 'cassa';
    _store = store;
    _running = true;

    const pullCfg = PULL_CONFIG[_appType] ?? PULL_CONFIG.cassa;

    // Initial push + pull
    _runPush().catch(() => {});
    _runPull().catch(() => {});
    _runGlobalPull().catch(() => {});

    // Push loop: retry every 30 s when online
    _pushTimer = setInterval(() => _runPush().catch(() => {}), 30_000);

    // Pull loop: per-app interval
    _pullTimer = setInterval(() => _runPull().catch(() => {}), pullCfg.intervalMs);

    // Global config pull: every 5 minutes
    _globalTimer = setInterval(() => _runGlobalPull().catch(() => {}), GLOBAL_INTERVAL_MS);

    // Online event: trigger immediate push + pull
    if (typeof window !== 'undefined') {
      window.addEventListener('online', _onOnline);
    }
  }

  /** Stops all sync timers and removes listeners. */
  function stopSync() {
    _running = false;
    _store = null;
    if (_pushTimer) { clearInterval(_pushTimer); _pushTimer = null; }
    if (_pullTimer) { clearInterval(_pullTimer); _pullTimer = null; }
    if (_globalTimer) { clearInterval(_globalTimer); _globalTimer = null; }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', _onOnline);
    }
    syncStatus.value = 'idle';
  }

  /**
   * Manually trigger a push drain (useful from settings / debug UI).
   * @returns {Promise<void>}
   */
  async function forcePush() {
    if (!appConfig.directus?.enabled) return;
    await _runPush();
  }

  /**
   * Manually trigger a full pull for the current app's collections.
   * @returns {Promise<void>}
   */
  async function forcePull() {
    if (!appConfig.directus?.enabled) return;
    await _runPull();
  }

  return {
    /** Reactive sync status: 'idle' | 'syncing' | 'error' */
    syncStatus,
    /** ISO timestamp of the last successful push, or null. */
    lastPushAt,
    /** ISO timestamp of the last successful pull, or null. */
    lastPullAt,
    startSync,
    stopSync,
    forcePush,
    forcePull,
  };
}

/**
 * Resets all module-level singleton state.
 * For use in tests only — not exported in production builds.
 * @internal
 */
export function _resetDirectusSyncSingleton() {
  _running = false;
  _store = null;
  _appType = 'cassa';
  if (_pushTimer) { clearInterval(_pushTimer); _pushTimer = null; }
  if (_pullTimer) { clearInterval(_pullTimer); _pullTimer = null; }
  if (_globalTimer) { clearInterval(_globalTimer); _globalTimer = null; }
  syncStatus.value = 'idle';
  lastPushAt.value = null;
  lastPullAt.value = null;
}
