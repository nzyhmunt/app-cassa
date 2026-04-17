/**
 * @file composables/useDirectusClient.js
 * @description Singleton factory for the official Directus SDK client.
 *
 * Builds a single client instance that is shared across the application.
 * The instance combines REST transport + real-time (WebSocket) transport.
 * The client is rebuilt whenever the connection credentials change.
 *
 * Usage:
 *   import { getDirectusClient } from './useDirectusClient.js';
 *   const client = getDirectusClient(); // null when disabled / not configured
 *
 * The `realtime()` mixin activates `client.subscribe()`, `client.connect()`,
 * and `client.disconnect()`.  The `rest()` mixin activates `client.request(fn)`.
 */

import { ref } from 'vue';
import { createDirectus, staticToken, rest, realtime } from '@directus/sdk';
import { appConfig } from '../utils/index.js';
import { getDB } from './useIDB.js';

/**
 * Reactive flag that mirrors `appConfig.directus.enabled`.
 * Updated by `loadDirectusConfigFromStorage()` and `saveDirectusConfigToStorage()`
 * so that templates and computeds that depend on it stay in sync.
 */
export const directusEnabledRef = ref(false);

/** Cached client instance. */
let _client = null;
/** Snapshot of the config that produced the current `_client`. */
let _configSnapshot = '';

/**
 * Returns the shared Directus SDK client, or `null` when sync is disabled or
 * credentials are incomplete.
 *
 * The client is re-created whenever `url` or `staticToken` change so callers
 * always receive a client that matches the current configuration.
 *
 * @returns {import('@directus/sdk').DirectusClient<object> | null}
 */
export function getDirectusClient() {
  const cfg = appConfig.directus;
  if (!cfg?.enabled || !cfg?.url || !cfg?.staticToken) return null;

  const snapshot = `${cfg.url}::${cfg.staticToken}`;
  if (_client && _configSnapshot === snapshot) return _client;

  _client = createDirectus(cfg.url, { globals: { fetch: globalThis.fetch } })
    .with(staticToken(cfg.staticToken))
    .with(rest())
    .with(realtime({
      reconnect: {
        delay: 2_000,
        retries: 10,
      },
    }));

  _configSnapshot = snapshot;
  return _client;
}

/**
 * Resets the cached client.  Call this when the config changes at runtime
 * (e.g. after the user saves new credentials in the settings UI).
 */
export function resetDirectusClient() {
  if (_client) {
    try { _client.disconnect?.(); } catch (_) { /* best-effort */ }
  }
  _client = null;
  _configSnapshot = '';
}

/**
 * Loads persisted Directus connection config from IndexedDB (`app_meta`) and merges it
 * into `appConfig.directus`.  Should be called once at app startup (before
 * `useDirectusSync().startSync()`).
 *
 * Config is stored as `app_meta.id = "directus_config"`:
 *   { enabled, url, staticToken, venueId }
 *
 * @returns {Promise<void>}
 */
const DIRECTUS_CONFIG_RECORD_ID = 'directus_config';

function _normalizeDirectusConfig(saved) {
  return {
    enabled: typeof saved?.enabled === 'boolean' ? saved.enabled : false,
    url: typeof saved?.url === 'string' ? saved.url : '',
    staticToken: typeof saved?.staticToken === 'string' ? saved.staticToken : '',
    venueId: saved?.venueId != null ? saved.venueId : null,
    wsEnabled: typeof saved?.wsEnabled === 'boolean' ? saved.wsEnabled : false,
  };
}

export async function loadDirectusConfigFromStorage() {
  const db = await getDB();
  const saved = await db.get('app_meta', DIRECTUS_CONFIG_RECORD_ID);
  if (!saved || typeof saved !== 'object') return;
  appConfig.directus = _normalizeDirectusConfig(saved.value ?? saved);
  directusEnabledRef.value = appConfig.directus.enabled;
  resetDirectusClient();
}

/**
 * Persists the current `appConfig.directus` to IndexedDB and rebuilds
 * the SDK client singleton.  Call this after the user saves new credentials.
 *
 * @returns {Promise<void>}
 */
export async function saveDirectusConfigToStorage() {
  const cfg = _normalizeDirectusConfig(appConfig.directus);
  const db = await getDB();
  await db.put('app_meta', { id: DIRECTUS_CONFIG_RECORD_ID, value: cfg });
  directusEnabledRef.value = cfg.enabled;
  resetDirectusClient();
  if (typeof window !== 'undefined') {
    window.dispatchEvent?.(new CustomEvent('directus-config-updated'));
  }
}

/**
 * Removes the Directus configuration from IndexedDB and resets
 * `appConfig.directus` to its defaults.  Call this during a factory reset so
 * that a subsequent page reload starts with a clean slate.
 *
 * @returns {Promise<void>}
 */
export async function clearDirectusConfigFromStorage() {
  let deleteError = null;
  try {
    const db = await getDB();
    await db.delete('app_meta', DIRECTUS_CONFIG_RECORD_ID);
  } catch (e) {
    deleteError = e;
  } finally {
    appConfig.directus = {
      enabled: false,
      url: '',
      staticToken: '',
      venueId: null,
      wsEnabled: false,
    };
    directusEnabledRef.value = false;
    resetDirectusClient();
  }

  if (deleteError) {
    throw deleteError;
  }
}

// ── Internal test helpers ─────────────────────────────────────────────────────

/** @internal Exposed for test isolation only. */
export function _resetDirectusClientSingleton() {
  _client = null;
  _configSnapshot = '';
}
