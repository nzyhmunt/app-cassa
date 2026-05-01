/**
 * @file composables/sync/storebridge.js
 * @description Vue/Pinia store ↔ IDB bridge helpers for the Directus sync subsystem.
 *
 * Functions here bridge between the IDB persistence layer and the in-memory
 * Vue/Pinia store.  They read from IDB and push updates to the store, but they
 * do NOT make network calls directly.
 *
 * Extracted from useDirectusSync.js (§5.7 refactor).
 */

import { appConfig } from '../../utils/index.js';
import { syncState } from './state.js';

/**
 * Refreshes the in-memory store from IDB for the given collection.
 * Emits an IDB-change broadcast to follower tabs when this tab is the leader.
 *
 * @param {string|null} [collection]
 * @param {Set<string>|null} [ids]
 */
export async function _refreshStoreFromIDB(collection = null, ids = null) {
  if (!syncState._store) return;
  if (typeof syncState._store.refreshOperationalStateFromIDB === 'function') {
    const opts = collection ? { collection } : {};
    if (ids instanceof Set && ids.size > 0) opts.ids = ids;
    await syncState._store.refreshOperationalStateFromIDB(opts);
    // NS6: Notify follower tabs that IDB data has changed for this collection.
    // Include `ids` (as array) so followers can perform a targeted refresh too.
    if (syncState._isLeader) {
      const msg = { type: 'idb-change', collection };
      if (ids instanceof Set && ids.size > 0) msg.ids = [...ids];
      syncState._idbChangeBroadcast?.postMessage(msg);
    }
    return;
  }
  if (typeof syncState._store.refreshFromIDB === 'function') {
    await syncState._store.refreshFromIDB(collection);
    // NS6: Notify follower tabs that IDB data has changed for this collection.
    if (syncState._isLeader) syncState._idbChangeBroadcast?.postMessage({ type: 'idb-change', collection });
    return;
  }
  // No further fallback: stores must expose refreshOperationalStateFromIDB or refreshFromIDB
  // to preserve strict IDB-first semantics. Direct assignment is intentionally omitted.
  console.warn('[DirectusSync] Store refresh API missing; skipping to preserve strict IDB-first.');
}

/**
 * Refreshes config-related store slices from IDB.
 * Emits an IDB-change broadcast to follower tabs when this tab is the leader.
 *
 * @param {object} [options]
 */
export async function _refreshStoreConfigFromIDB(options = {}) {
  if (!syncState._store) return;
  if (typeof syncState._store.hydrateConfigFromIDB === 'function') {
    await syncState._store.hydrateConfigFromIDB(options);
    // NS6: Notify follower tabs that configuration IDB data has changed.
    if (syncState._isLeader) syncState._idbChangeBroadcast?.postMessage({ type: 'idb-change', collection: 'config' });
    return;
  }
  console.warn('[Directus] hydrateConfigFromIDB not available on store; skipping config refresh.');
}

/**
 * Returns printers that can receive pre-bill jobs.
 * Printers with missing/empty printTypes are treated as catch-all.
 *
 * @returns {Array<{id:string,name?:string,url?:string,printTypes?:string[]}>}
 */
export function _preBillPrinters() {
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
export async function _syncPreBillPrinterSelection(_venueRecord = null) {
  if (!syncState._store) return;
  const candidates = _preBillPrinters();
  if (candidates.length === 0) {
    if (typeof syncState._store.saveLocalSettings === 'function') {
      try {
        await syncState._store.saveLocalSettings({ preBillPrinterId: '' });
      } catch (err) {
        console.warn('[DirectusSync] Failed to persist cleared preBillPrinterId:', err);
      }
    }
    syncState._store.preBillPrinterId = '';
    return;
  }
  const current = typeof syncState._store.preBillPrinterId === 'string' ? syncState._store.preBillPrinterId : '';
  if (current && candidates.some((printer) => printer.id === current)) return;
  const newPrinterId = candidates[0]?.id ?? '';
  if (typeof syncState._store.saveLocalSettings === 'function') {
    try {
      await syncState._store.saveLocalSettings({ preBillPrinterId: newPrinterId });
    } catch (err) {
      console.warn('[DirectusSync] Failed to persist preBillPrinterId:', err);
    }
  }
  syncState._store.preBillPrinterId = newPrinterId;
}

/**
 * Applies Directus runtime configuration to `appConfig`, preserving designated
 * fields that must not be overwritten (directus connection params, instanceName,
 * pwaLogo, menuSource/menuUrl when in JSON mode).
 *
 * @param {object} runtimeConfig - Runtime config object from `createRuntimeConfig`.
 * @param {object} [options]
 * @param {object} options.preservedDirectus - Restored directus config.
 * @param {string|undefined} options.preservedInstanceName - Restored when provided.
 * @param {string|undefined} options.preservedPwaLogo - Restored when provided.
 * @param {boolean} [options.preserveMenuSource=false] - If true, restores menuSource='json' and menuUrl.
 * @param {string|null} [options.preservedMenuUrl=null] - MenuUrl to restore when preserveMenuSource is true.
 */
export function _applyDirectusRuntimeConfigToAppConfig(runtimeConfig, options = {}) {
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

/**
 * Safely calls an `onProgress` callback, swallowing errors to prevent
 * user-supplied callbacks from crashing the sync flow.
 *
 * @param {Function|null} onProgress
 * @param {object} payload
 */
export function _emitProgress(onProgress, payload) {
  if (typeof onProgress === 'function') {
    try { onProgress(payload); } catch (e) {
      console.warn('[DirectusSync] onProgress callback error:', e);
    }
  }
}
