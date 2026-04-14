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

import { createDirectus, staticToken, rest, realtime } from '@directus/sdk';
import { appConfig } from '../utils/index.js';

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
 * Loads persisted Directus connection config from `localStorage` and merges it
 * into `appConfig.directus`.  Should be called once at app startup (before
 * `useDirectusSync().startSync()`).
 *
 * Config is stored under the key `'directus-config'` as a JSON object:
 *   { enabled, url, staticToken, venueId }
 */
export function loadDirectusConfigFromStorage() {
  try {
    const raw = window.localStorage.getItem('directus-config');
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved && typeof saved === 'object') {
      appConfig.directus = {
        enabled: typeof saved.enabled === 'boolean' ? saved.enabled : false,
        url: typeof saved.url === 'string' ? saved.url : '',
        staticToken: typeof saved.staticToken === 'string' ? saved.staticToken : '',
        venueId: saved.venueId != null ? saved.venueId : null,
      };
      resetDirectusClient();
    }
  } catch (e) {
    console.warn('[DirectusClient] Failed to load config from storage:', e);
  }
}

/**
 * Persists the current `appConfig.directus` to `localStorage` and rebuilds
 * the SDK client singleton.  Call this after the user saves new credentials.
 */
export function saveDirectusConfigToStorage() {
  try {
    const cfg = appConfig.directus;
    window.localStorage.setItem('directus-config', JSON.stringify({
      enabled: cfg?.enabled ?? false,
      url: cfg?.url ?? '',
      staticToken: cfg?.staticToken ?? '',
      venueId: cfg?.venueId ?? null,
    }));
    resetDirectusClient();
  } catch (e) {
    console.warn('[DirectusClient] Failed to save config to storage:', e);
  }
}

// ── Internal test helpers ─────────────────────────────────────────────────────

/** @internal Exposed for test isolation only. */
export function _resetDirectusClientSingleton() {
  _client = null;
  _configSnapshot = '';
}
