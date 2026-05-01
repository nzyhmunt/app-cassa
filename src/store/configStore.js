/**
 * @file store/configStore.js
 * @description Pinia store for application configuration.
 * Handles venue config, menu loading, local settings, and Directus connection settings.
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  appConfig,
  createRuntimeConfig,
  DEFAULT_SETTINGS,
  applyDirectusConfigToAppConfig,
  KEYBOARD_POSITIONS,
} from '../utils/index.js';
import { mapVenueConfigFromDirectus } from '../utils/mappers.js';
import { cloneValue as _clone } from './storeUtils.js';
import {
  loadSettingsFromIDB,
  saveSettingsToIDB,
  saveJsonMenuToIDB,
  loadJsonMenuFromIDB,
} from './persistence/operations.js';
import { loadConfigFromIDB } from './persistence/config.js';
import { saveDirectusConfigToStorage } from '../composables/useDirectusClient.js';

function _normalizeJsonMenuPayload(data) {
  if (typeof data !== 'object' || data === null || Array.isArray(data) || !Object.values(data).every(Array.isArray)) {
    throw new Error('Formato menu non valido');
  }
  const menu = {};
  Object.keys(data).forEach((category) => {
    const valid = data[category].filter(item =>
      item !== null && typeof item === 'object' &&
      typeof item.id === 'string' && item.id.trim() !== '' &&
      typeof item.name === 'string' && item.name.trim() !== '' &&
      typeof item.price === 'number' && Number.isFinite(item.price),
    );
    if (valid.length > 0) menu[category] = valid;
  });
  if (Object.keys(menu).length === 0) throw new Error('Nessun articolo valido nel menu');
  return menu;
}

function _normalizeMenuSource(value, fallback = null) {
  if (value === 'json' || value === 'directus') return value;
  return fallback;
}

/**
 * Normalizes device-local settings payloads and fills missing/invalid values
 * with explicit fallbacks from current store state / defaults.
 *
 * @param {object} payload
 * @param {object} current
 * @returns {{sounds:boolean,menuUrl:string,menuSource:'json'|'directus',preventScreenLock:boolean,customKeyboard:string,preBillPrinterId:string}}
 */
function _normalizeLocalSettingsPayload(payload, current) {
  const normalizedCurrentMenuSource = _normalizeMenuSource(current?.menuSource, 'directus');
  return {
    sounds: typeof payload?.sounds === 'boolean' ? payload.sounds : !!current?.sounds,
    menuUrl:
      typeof payload?.menuUrl === 'string' && payload.menuUrl.trim() !== ''
        ? payload.menuUrl
        : (current?.menuUrl ?? DEFAULT_SETTINGS.menuUrl),
    menuSource: _normalizeMenuSource(payload?.menuSource, normalizedCurrentMenuSource),
    preventScreenLock:
      typeof payload?.preventScreenLock === 'boolean'
        ? payload.preventScreenLock
        : !!current?.preventScreenLock,
    customKeyboard: KEYBOARD_POSITIONS.includes(payload?.customKeyboard)
      ? payload.customKeyboard
      : (KEYBOARD_POSITIONS.includes(current?.customKeyboard) ? current.customKeyboard : 'disabled'),
    preBillPrinterId:
      typeof payload?.preBillPrinterId === 'string'
        ? payload.preBillPrinterId
        : (typeof current?.preBillPrinterId === 'string' ? current.preBillPrinterId : ''),
  };
}

export const useConfigStore = defineStore('config', () => {
  const config = ref(createRuntimeConfig(appConfig));

  const sounds = ref(true);
  const menuUrl = ref(config.value.menuUrl || DEFAULT_SETTINGS.menuUrl);
  const menuSource = ref(config.value.menuSource === 'json' ? 'json' : 'directus');
  const preventScreenLock = ref(true);
  const customKeyboard = ref('disabled');
  const preBillPrinterId = ref('');
  const configHydrated = ref(false);

  const menuLoading = ref(false);
  const menuError = ref(null);

  const cssVars = computed(() => ({
    '--brand-primary': config.value.ui.primaryColor,
    '--brand-dark': config.value.ui.primaryColorDark,
  }));

  const rooms = computed(() => {
    const r = config.value.rooms;
    if (Array.isArray(r) && r.length > 0) return r;
    return [{ id: 'main', label: '', tables: config.value.tables ?? [] }];
  });

  async function hydrateConfigFromIDB(options = {}) {
    const nextMenuSource = _normalizeMenuSource(options.menuSource);
    const nextMenuUrl = typeof options.menuUrl === 'string' && options.menuUrl.trim() !== ''
      ? options.menuUrl
      : null;
    const venueId = config.value.directus?.venueId ?? appConfig.directus?.venueId ?? null;
    const cached = await loadConfigFromIDB(venueId);
    const mapped = mapVenueConfigFromDirectus(cached, DEFAULT_SETTINGS);
    const hydrated = createRuntimeConfig(mapped);

    const resolvedMenuSource = nextMenuSource ?? _normalizeMenuSource(hydrated.menuSource, 'directus');
    const resolvedMenuUrl = nextMenuUrl ?? hydrated.menuUrl ?? DEFAULT_SETTINGS.menuUrl;
    menuSource.value = resolvedMenuSource;
    menuUrl.value = resolvedMenuUrl;
    config.value = {
      ...hydrated,
      menuSource: resolvedMenuSource,
      menuUrl: resolvedMenuUrl,
    };
    configHydrated.value = true;

    if (menuSource.value === 'json') {
      const jsonMenu = await loadJsonMenuFromIDB();
      if (jsonMenu && typeof jsonMenu === 'object' && !Array.isArray(jsonMenu)) {
        config.value = { ...config.value, menu: _clone(jsonMenu) };
      }
    }
  }

  async function loadMenu(options = {}) {
    const shouldHydrateDirectus = options.skipHydrate === true ? false : true;
    const applyJsonSnapshot = async () => {
      const jsonMenu = await loadJsonMenuFromIDB();
      if (!jsonMenu || typeof jsonMenu !== 'object' || Array.isArray(jsonMenu)) return false;
      config.value = { ...config.value, menu: _clone(jsonMenu) };
      return true;
    };

    menuLoading.value = true;
    menuError.value = null;
    try {
      if (menuSource.value === 'directus') {
        if (shouldHydrateDirectus) await hydrateConfigFromIDB();
        return;
      }

      const response = await fetch(menuUrl.value);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const normalizedMenu = _normalizeJsonMenuPayload(data);

      await saveJsonMenuToIDB(normalizedMenu);
      config.value = { ...config.value, menu: normalizedMenu };
    } catch (e) {
      menuError.value = e instanceof Error ? e.message : String(e);
      if (menuSource.value === 'json') {
        await applyJsonSnapshot();
      }
    } finally {
      menuLoading.value = false;
    }
  }

  /**
   * Applies local settings to reactive store state and runtime appConfig
   * (menuSource/menuUrl) without persisting to IndexedDB.
   *
   * @param {object} payload
   * @returns {{sounds:boolean,menuUrl:string,menuSource:'json'|'directus',preventScreenLock:boolean,customKeyboard:string,preBillPrinterId:string}}
   */
  function applyLocalSettings(payload = {}) {
    const normalized = _normalizeLocalSettingsPayload(payload, {
      sounds: sounds.value,
      menuUrl: menuUrl.value,
      menuSource: menuSource.value,
      preventScreenLock: preventScreenLock.value,
      customKeyboard: customKeyboard.value,
      preBillPrinterId: preBillPrinterId.value,
    });
    sounds.value = normalized.sounds;
    menuUrl.value = normalized.menuUrl;
    menuSource.value = normalized.menuSource;
    preventScreenLock.value = normalized.preventScreenLock;
    customKeyboard.value = normalized.customKeyboard;
    preBillPrinterId.value = normalized.preBillPrinterId;
    config.value = {
      ...config.value,
      menuSource: normalized.menuSource,
      menuUrl: normalized.menuUrl,
    };
    return normalized;
  }

  /**
   * Applies and persists local settings to `local_settings` in IndexedDB.
   *
   * @param {object} payload
   * @returns {Promise<{sounds:boolean,menuUrl:string,menuSource:'json'|'directus',preventScreenLock:boolean,customKeyboard:string,preBillPrinterId:string}>}
   */
  async function saveLocalSettings(payload = {}) {
    const normalized = _normalizeLocalSettingsPayload(payload, {
      sounds: sounds.value,
      menuUrl: menuUrl.value,
      menuSource: menuSource.value,
      preventScreenLock: preventScreenLock.value,
      customKeyboard: customKeyboard.value,
      preBillPrinterId: preBillPrinterId.value,
    });
    await saveSettingsToIDB(normalized);
    applyLocalSettings(normalized);
    return normalized;
  }

  /**
   * Applies and persists Directus settings through the centralized appConfig
   * mutation path and Directus config storage adapter.
   *
   * @param {object} payload
   * @returns {Promise<{enabled:boolean,url:string,staticToken:string,venueId:number|string|null,wsEnabled:boolean}>}
   */
  async function saveDirectusSettings(payload = {}) {
    const normalized = applyDirectusSettings(payload);
    await saveDirectusConfigToStorage();
    return normalized;
  }

  /**
   * Applies Directus settings to runtime appConfig + config store snapshot
   * without persisting to IndexedDB.
   *
   * @param {object} payload
   * @returns {{enabled:boolean,url:string,staticToken:string,venueId:number|string|null,wsEnabled:boolean}}
   */
  function applyDirectusSettings(payload = {}) {
    const normalized = applyDirectusConfigToAppConfig(payload);
    config.value = {
      ...config.value,
      directus: {
        ...(config.value.directus ?? {}),
        ...normalized,
      },
    };
    return normalized;
  }

  return {
    config,
    cssVars,
    rooms,
    sounds,
    menuUrl,
    menuSource,
    preventScreenLock,
    customKeyboard,
    preBillPrinterId,
    configHydrated,
    menuLoading,
    menuError,
    loadMenu,
    hydrateConfigFromIDB,
    applyLocalSettings,
    saveLocalSettings,
    applyDirectusSettings,
    saveDirectusSettings,
  };
});

// Re-export loadSettingsFromIDB so index.js and initStoreFromIDB callers can use it
// without a separate import chain.
export { loadSettingsFromIDB };
