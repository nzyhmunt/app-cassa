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
 * Multiple instances of the app can run on the same device (e.g. a cassa and
 * a sala tablet sharing the same origin) without interfering by assigning each
 * a unique instance name. The name is either:
 *   1. Set via the `?instance=NAME` query param in the URL (highest priority).
 *      Tip: bake the param into the PWA home-screen shortcut URL.
 *   2. Set by the user in Settings → Nome Istanza, saved to `app-instance`
 *      localStorage key.
 *   3. Empty string (default) — uses the original key names for backwards
 *      compatibility with existing installations.
 *
 * ── Note per la futura migrazione a PWA ──────────────────────────────────
 * TODO (PWA - IndexedDB): Replace localStorage with IndexedDB for larger
 *   datasets and non-blocking async I/O. Recommended library: idb.
 * TODO (PWA - Directus sync): Trigger sync after local writes.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * Schema version. Increment for breaking state structure changes.
 * The localStorage key changes automatically (e.g. demo_app_state_v2),
 * leaving the previous version's data as orphans until cleared.
 */
export const SCHEMA_VERSION = 1;

/**
 * Reads the active instance name.
 * Priority: ?instance= query param > 'app-instance' localStorage key > '' (default).
 *
 * @returns {string} The instance name, or '' for the default instance.
 */
export function getInstanceName() {
  if (typeof window === 'undefined') return '';
  try {
    // Regular query string (before '#') takes highest priority
    const sp = new URLSearchParams(window.location.search || '');
    let name = sp.get('instance') || '';
    if (!name) {
      // Fallback: hash-based routing (e.g. /#/route?instance=NAME)
      const hash = window.location.hash || '';
      const qi = hash.indexOf('?');
      if (qi !== -1) name = new URLSearchParams(hash.slice(qi + 1)).get('instance') || '';
    }
    if (name) return name;
    // Last resort: user-saved instance name
    return window.localStorage.getItem('app-instance') || '';
  } catch {
    return '';
  }
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
 * Saves a new instance name to localStorage.
 * The caller is responsible for reloading the page afterwards so that
 * all keys are re-derived from the new name.
 *
 * @param {string} name - New instance name (empty string restores the default).
 */
export function saveInstanceName(name) {
  if (typeof localStorage === 'undefined') return false;
  try {
    if (name) {
      localStorage.setItem('app-instance', name);
    } else {
      localStorage.removeItem('app-instance');
    }
    return true;
  } catch (e) {
    console.warn('[Persistence] Impossibile salvare il nome istanza:', e);
    return false;
  }
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
    console.warn('[Persistence] Impossibile cancellare lo stato salvato:', e);
  }
}
