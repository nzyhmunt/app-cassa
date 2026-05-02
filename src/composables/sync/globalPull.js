/**
 * @file composables/sync/globalPull.js
 * @description Full venue-config global pull helpers for the Directus sync subsystem.
 *
 * Contains the venue-tree fan-out pipeline, deep-fetch helpers, local config
 * cache hydration, and the orchestrated global pull flow.
 *
 * Extracted from useDirectusSync.js (§9 refactor).
 */

import { readItem, readItems } from '@directus/sdk';
import { appConfig, createRuntimeConfig, DEFAULT_SETTINGS } from '../../utils/index.js';
import { mapVenueConfigFromDirectus, relationId } from '../../utils/mappers.js';
import {
  loadConfigFromIDB,
  saveLastPullTsToIDB,
  normalizeVenueUsersForIDB,
} from '../../store/persistence/config.js';
import { getDB } from '../useIDB.js';
import { reloadUsersFromIDB } from '../useAuth.js';
import { touchStorageKey } from '../../store/persistence.js';
import { _buildRestClient, _getCfg } from './pullQueue.js';
import {
  _applyDirectusRuntimeConfigToAppConfig,
  _refreshStoreConfigFromIDB,
  _syncPreBillPrinterSelection,
  _emitProgress,
} from './storebridge.js';
import { syncState } from './state.js';
import {
  VENUE_RELATED_COLLECTIONS,
  DEEP_FETCH_FIELDS,
  DEEP_FETCH_FIELD_SETS,
  DEEP_FETCH_JSON_FIELD_SETS,
  VENUE_NESTED_RELATION_KEYS,
  TABLE_FETCH_BATCH_SIZE,
  DEEP_FETCH_PAYLOAD_UNWRAP_MAX_DEPTH,
} from './config.js';

// ── Venue-tree helper utilities ───────────────────────────────────────────────

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

/**
 * Writes a flattened venue record and all its nested sub-collections to IDB
 * in a single atomic transaction.
 *
 * @param {object} venueRecord - The deep-fetched venue object.
 * @param {{ menuSource: string }} options
 * @returns {Promise<Record<string, number>>} Store-name → count written.
 */
export async function _fanOutVenueTreeToIDB(venueRecord, { menuSource }) {
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

  // NS3: Pre-compute venue_users normalization outside the transaction —
  // async PIN hashing must not run inside an IDB transaction (would stall it).
  const normalizedVenueUsers = await normalizeVenueUsersForIDB(payloadByStore.venue_users);

  // NS3: Single atomic IDB transaction covering all stores so that a partial
  // failure (e.g. browser storage quota) never leaves some stores written and
  // others not, avoiding an inconsistent in-memory/IDB state.
  const db = await getDB();
  const storeNames = Object.keys(payloadByStore);
  const tx = db.transaction(storeNames, 'readwrite');

  // venue_users: full replace, preserving manual users (same logic as replaceVenueUsersInIDB).
  const vuStore = tx.objectStore('venue_users');
  const existingVU = await vuStore.getAll();
  const manualUsers = existingVU.filter((r) =>
    r && typeof r === 'object' && r.id && (
      r._type === 'manual_user' ||
      (!r._type && !Object.prototype.hasOwnProperty.call(r, 'status'))
    )
  );
  await vuStore.clear();
  const vuPuts = [];
  for (const mu of manualUsers) vuPuts.push(vuStore.put(mu));
  for (const r of normalizedVenueUsers) vuPuts.push(vuStore.put(r));
  await Promise.all(vuPuts);

  // table_merge_sessions: full replace (stale dissolved merges must not linger).
  const tmStore = tx.objectStore('table_merge_sessions');
  await tmStore.clear();
  const tmPuts = [];
  for (const r of payloadByStore.table_merge_sessions) {
    if (r?.id != null) tmPuts.push(tmStore.put(r));
  }
  await Promise.all(tmPuts);

  // All other stores: forceWrite upsert — put each record using its `id` as key.
  const otherPuts = [];
  for (const [storeName, records] of stores) {
    if (storeName === 'venue_users' || storeName === 'table_merge_sessions') continue;
    const objStore = tx.objectStore(storeName);
    for (const r of records) {
      if (r && r.id != null) otherPuts.push(objStore.put(r));
    }
  }
  await Promise.all(otherPuts);

  await tx.done;
  touchStorageKey();

  // Return actual written counts (not pre-write array lengths).
  const writeCounts = {};
  writeCounts.venue_users = manualUsers.length + normalizedVenueUsers.length;
  writeCounts.table_merge_sessions = tmPuts.length;
  for (const [storeName, records] of stores) {
    if (storeName === 'venue_users' || storeName === 'table_merge_sessions') continue;
    writeCounts[storeName] = records.filter((r) => r && r.id != null).length;
  }
  return writeCounts;
}

/**
 * Hydrates `appConfig` and the Pinia store from the IDB config cache
 * (without hitting the network).
 *
 * @param {string|null} venueId
 * @param {Function|null} [onProgress]
 * @returns {Promise<boolean>} `true` if a cached config was found and applied.
 */
export async function _hydrateConfigFromLocalCache(venueId, onProgress = null) {
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
 * Inner implementation of the global venue-config pull.
 * Fetches the full venue tree from Directus, fans it out to IDB, and applies
 * the resulting runtime config to `appConfig` and the Pinia store.
 *
 * @param {{ onProgress?: Function|null }} [options]
 */
export async function _runGlobalPullInner({ onProgress = null } = {}) {
  if (!navigator.onLine) return;
  const cfg = _getCfg();
  if (!cfg) return;
  const venueId = cfg.venueId ?? null;
  // Capture the current generation counter so we can detect whether a newer
  // global pull has been started (e.g. by reconfigureAndApply) while this one
  // is awaiting network/IDB work.  If superseded, skip the config-apply step
  // to avoid overwriting the freshly applied runtime config with stale data.
  const myGeneration = ++syncState._globalPullGeneration;

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
    if (syncState._lastAppliedGlobalPullGeneration > myGeneration) {
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

    if ((syncState._lastAppliedGlobalPullGeneration ?? 0) > myGeneration) {
      _emitProgress(onProgress, {
        level: 'info',
        message: 'Applicazione configurazione saltata: una pull globale più recente è già stata applicata.',
      });
      return { ok: true, failedCollections: [] };
    }

    await _hydrateConfigFromLocalCache(venueId, onProgress);

    if ((syncState._lastAppliedGlobalPullGeneration ?? 0) > myGeneration) {
      _emitProgress(onProgress, {
        level: 'info',
        message: 'Configurazione idratata ma non applicata: una pull globale più recente è stata applicata durante l\u2019aggiornamento.',
      });
      return { ok: true, failedCollections: [] };
    }

    syncState._lastAppliedGlobalPullGeneration = Math.max(syncState._lastAppliedGlobalPullGeneration ?? 0, myGeneration);
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

/**
 * NS5 — Deduplicated wrapper around `_runGlobalPullInner`.
 * If a global pull is already in flight the caller awaits the same promise
 * instead of firing a second concurrent fetch.  A `{ onProgress }` argument
 * is forwarded only to the first call that actually starts the pull; callers
 * that join an already-running pull receive its result but no progress callbacks.
 *
 * @param {{ onProgress?: Function|null }} [options]
 */
export function _runGlobalPull({ onProgress = null } = {}) {
  if (!syncState._globalPullInFlight) {
    // Identity-guard the .finally() so that if _onOffline() / forcePull() nulls
    // the semaphore and a new pull starts, the stale promise's .finally() does
    // not overwrite the newer semaphore reference when it eventually settles.
    const p = _runGlobalPullInner({ onProgress })
      .finally(() => { if (syncState._globalPullInFlight === p) syncState._globalPullInFlight = null; });
    syncState._globalPullInFlight = p;
  }
  return syncState._globalPullInFlight;
}
