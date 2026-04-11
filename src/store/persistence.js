/**
 * @file store/persistence.js
 * @description Persistence key-derivation utilities.
 *
 * Provides helpers to derive storage keys (for instance isolation) and to
 * clear state. App state is now stored in IndexedDB via `store/idbPersistence.js`;
 * this module retains helpers that are shared across multiple files (key
 * derivation, instance name resolution) and provides `clearState` for
 * full-reset flows.
 *
 * ── Multi-instance support ────────────────────────────────────────────────
 * Multiple instances of the app can run on the same device by assigning each
 * build a unique `instanceName` in `src/utils/index.js` (`appConfig`).
 * All storage keys are derived from that name, so each build operates
 * in complete isolation — no runtime user configuration required.
 */

import { appConfig } from '../utils/index.js';

/**
 * Schema version. Increment for breaking state structure changes.
 * @deprecated Used only for backwards-compat key references; IndexedDB schema
 * versioning is handled independently in `composables/useIDB.js` (DB_VERSION).
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
 * Derives storage key names from the active instance name.
 * Kept for backwards compatibility — used by composables that reference the
 * instance-namespaced IDB database name and legacy references.
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
 * Derives the storage key used to persist saved custom items in the
 * "Personalizzata" tab of the "Diretto" modal (CassaTableManager).
 *
 * @param {string} [instanceName] - Instance name; defaults to getInstanceName().
 * @returns {string}
 */
export function resolveCustomItemsKey(instanceName) {
  const n = instanceName ?? getInstanceName();
  return n ? `direct_custom_items_${n}` : 'direct_custom_items';
}

/**
 * Clears the entire persisted app state from IndexedDB (and removes any
 * legacy localStorage key as a courtesy during the transition period).
 *
 * @param {string} [storageKey] - Legacy localStorage key (ignored if not present).
 */
export function clearState(storageKey) {
  // Remove legacy localStorage entry if it still exists
  if (
    typeof localStorage !== 'undefined' &&
    typeof storageKey === 'string' &&
    storageKey !== ''
  ) {
    try { localStorage.removeItem(storageKey); } catch (_) { /* ignore */ }
  }
  // Clear IndexedDB operative stores asynchronously (fire-and-forget)
  (async () => {
    try {
      const { clearAllStateFromIDB } = await import('./idbPersistence.js');
      await clearAllStateFromIDB();
    } catch (e) {
      console.warn('[Persistence] Failed to clear IDB state:', e);
    }
  })();
}

