/**
 * @file store/persistence.js
 * @description Persistence key-derivation utilities.
 *
 * Provides helpers to derive storage keys (for instance isolation) and to
 * emit cross-tab storage signals. App state is stored in IndexedDB via
 * `store/persistence/`; this module provides shared helpers across multiple
 * files (key derivation, instance name resolution).
 *
 * ── Multi-instance support ────────────────────────────────────────────────
 * Multiple instances of the app can run on the same device by assigning each
 * build a unique `instanceName` in `src/utils/index.js` (`appConfig`).
 * All storage keys are derived from that name, so each build operates
 * in complete isolation — no runtime user configuration required.
 */

import { appConfig } from '../utils/index.js';

/**
 * Schema version used for localStorage key derivation.
 * Note: IndexedDB schema versioning is handled independently via DB_VERSION
 * in `composables/useIDB.js`.
 */
export const SCHEMA_VERSION = 2;

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
 * Derives namespaced logical keys from the active instance name.
 * Used for instance-isolated IndexedDB records.
 *
 * @param {string} [instanceName] - Instance name; defaults to getInstanceName().
 * @returns {{ storageKey: string, settingsKey: string }}
 */
export function resolveStorageKeys(instanceName) {
  const n = instanceName ?? getInstanceName();
  const suffix = n ? `_${n}` : '';
  return {
    storageKey: `app_state${suffix}_v${SCHEMA_VERSION}`,
    settingsKey: n ? `app-settings_${n}` : 'app-settings',
  };
}

/**
 * Emits a cross-tab storage signal for the current instance.
 * Listeners subscribed to the `storageKey` can use this as a lightweight
 * trigger to hydrate fresh state from IndexedDB.
 */
export function touchStorageKey() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const { storageKey } = resolveStorageKeys(getInstanceName());
    window.localStorage.setItem(storageKey, String(Date.now()));
  } catch (e) {
    console.warn('[Persistence] Failed to emit storage signal:', e);
  }
}


