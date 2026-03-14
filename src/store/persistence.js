/**
 * @file store/persistence.js
 * @description Persistence utilities for the app state.
 *
 * Persistence is handled by `pinia-plugin-persistedstate`, configured in
 * `src/store/index.js` via the `persist` option. This module exposes the
 * helpers needed to derive the correct localStorage keys and manage the
 * active instance name.
 *
 * ── Multi-instance support ────────────────────────────────────────────────
 * Multiple instances of the app can run on the same device by assigning each
 * build a unique `instanceName` in `src/utils/index.js` (`appConfig`).
 * All localStorage keys are derived from that name, so each build operates
 * in complete isolation — no runtime user configuration required.
 *
 * ── Note per la futura migrazione a PWA ──────────────────────────────────
 * TODO (PWA - IndexedDB): Replace localStorage with IndexedDB for larger
 *   datasets and non-blocking async I/O. Recommended library: idb.
 * TODO (PWA - Directus sync): Trigger sync after local writes.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { appConfig } from '../utils/index.js';

/**
 * Schema version. Increment for breaking state structure changes.
 * The localStorage key changes automatically (e.g. demo_app_state_v2),
 * leaving the previous version's data as orphans until cleared.
 */
export const SCHEMA_VERSION = 1;

/**
 * Returns the active instance name from `appConfig.instanceName`.
 * Set this value at build time in `src/utils/index.js`.
 *
 * @returns {string} The instance name, or '' for the default instance.
 */
export function getInstanceName() {
  return appConfig.instanceName || '';
}

/**
 * Derives localStorage keys from the active instance name.
 * The default instance (empty name) uses the original key names for backwards
 * compatibility with existing installations.
 *
 * @param {string} [instanceName] - Instance name; defaults to getInstanceName().
 * @returns {{ storageKey: string, settingsKey: string }}
 */
export function resolveStorageKeys(instanceName) {
  const n = instanceName ?? getInstanceName();
  const suffix = n ? `_${n}` : '';
  return {
    storageKey: `demo_app_state${suffix}_v${SCHEMA_VERSION}`,
    settingsKey: n ? `app-settings_${n}` : 'app-settings',
  };
}

/**
 * Derives the localStorage key used to persist saved custom items in the
 * "Personalizzata" tab of the "Diretto" modal (CassaTableManager). Kept here
 * so both the component and the settings reset logic share the exact same key
 * derivation.
 *
 * @param {string} [instanceName] - Instance name; defaults to getInstanceName().
 * @returns {string} The localStorage key for saved custom items.
 */
export function resolveCustomItemsKey(instanceName) {
  const n = instanceName ?? getInstanceName();
  return n ? `direct_custom_items_${n}` : 'direct_custom_items';
}

/**
 * Removes the persisted app state from localStorage.
 * Obtain the key from resolveStorageKeys().storageKey.
 *
 * @param {string} storageKey - The key to remove.
 */
export function clearState(storageKey) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(storageKey);
  } catch (e) {
    console.warn('[Persistence] Failed to clear saved state:', e);
  }
}
