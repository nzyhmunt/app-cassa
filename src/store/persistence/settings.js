/**
 * @file store/persistence/settings.js
 * @description Persistence helpers for device-local settings, JSON menu cache, and custom items.
 */

import { getDB } from '../../composables/useIDB.js';
import { touchStorageKey } from '../persistence.js';

const SETTINGS_RECORD_ID = 'local';
const JSON_MENU_RECORD_ID = 'json_menu_snapshot';
const CUSTOM_ITEMS_RECORD_ID = 'local';

/**
 * Loads app settings from the `local_settings` ObjectStore.
 * @returns {Promise<object|null>}
 */
export async function loadSettingsFromIDB() {
  try {
    const db = await getDB();
    const record = await db.get('local_settings', SETTINGS_RECORD_ID);
    return record ?? null;
  } catch (e) {
    console.warn('[IDBPersistence] Failed to load settings:', e);
    return null;
  }
}

/**
 * Persists app settings to the `local_settings` ObjectStore.
 * @param {object} settings
 */
export async function saveSettingsToIDB(settings) {
  try {
    const db = await getDB();
    await db.put('local_settings', JSON.parse(JSON.stringify({ ...settings, id: SETTINGS_RECORD_ID })));
  } catch (e) {
    console.warn('[IDBPersistence] Failed to save settings:', e);
    throw e;
  }
}

/**
 * Persists normalized JSON menu payload in app_meta.
 * @param {object} menu
 */
export async function saveJsonMenuToIDB(menu) {
  try {
    const db = await getDB();
    await db.put('app_meta', JSON.parse(JSON.stringify({
      id: JSON_MENU_RECORD_ID,
      value: menu ?? {},
    })));
    touchStorageKey();
  } catch (e) {
    console.warn('[IDBPersistence] Failed to save JSON menu:', e);
  }
}

/**
 * Loads normalized JSON menu payload from app_meta.
 * @returns {Promise<object|null>}
 */
export async function loadJsonMenuFromIDB() {
  try {
    const db = await getDB();
    const record = await db.get('app_meta', JSON_MENU_RECORD_ID);
    return record?.value ?? null;
  } catch (e) {
    console.warn('[IDBPersistence] Failed to load JSON menu:', e);
    return null;
  }
}

/**
 * Loads saved custom direct items from IDB.
 * @returns {Promise<Array>}
 */
export async function loadCustomItemsFromIDB() {
  try {
    const db = await getDB();
    const record = await db.get('direct_custom_items', CUSTOM_ITEMS_RECORD_ID);
    return Array.isArray(record?.items) ? record.items : [];
  } catch (e) {
    console.warn('[IDBPersistence] Failed to load custom items:', e);
    return [];
  }
}

/**
 * Persists saved custom direct items to IDB.
 * @param {Array} items
 */
export async function saveCustomItemsToIDB(items) {
  try {
    const db = await getDB();
    await db.put('direct_custom_items', JSON.parse(JSON.stringify({ id: CUSTOM_ITEMS_RECORD_ID, items })));
  } catch (e) {
    console.warn('[IDBPersistence] Failed to save custom items:', e);
  }
}
