/**
 * @file store/persistence/config.js
 * @description Persistence helpers for Directus configuration cache
 * (venue, rooms, tables, menu, payment methods, printers, venue users, pull timestamps).
 */

import { getDB } from '../../composables/useIDB.js';
import { hashPin, PIN_LENGTH } from '../../utils/pinAuth.js';
import { normalizeAppsArray } from '../../utils/userRoles.js';
import { touchStorageKey } from '../persistence.js';
import { relationIdStr } from './_shared.js';

async function _hashPin(pin) {
  const raw = String(pin ?? '');
  if (!raw) return '';
  return hashPin(raw);
}

function _extractPinDigits(value) {
  const source = String(value ?? '');
  let digits = '';
  for (let i = 0; i < source.length && digits.length < PIN_LENGTH; i += 1) {
    const char = source[i];
    if (char >= '0' && char <= '9') digits += char;
  }
  return digits;
}

/**
 * Loads all cached Directus configuration from IndexedDB.
 * Returns null if the DB is not available or on error.
 *
 * @param {string|number|null} venueId - Filter records to this venue. Pass null to return all.
 * @returns {Promise<{venueRecord, rooms, tables, paymentMethods, printers,
 *                    categories, items, modifiers,
 *                    categoryModifierLinks, itemModifierLinks}|null>}
 */
export async function loadConfigFromIDB(venueId) {
  try {
    const db = await getDB();

    const venueIdStr = venueId != null ? String(venueId) : null;
    const byVenueAndStatus = (arr) =>
      arr
        .filter(r => (venueIdStr == null || relationIdStr(r.venue) === venueIdStr) && r.status !== 'archived')
        .sort((a, b) => (a.sort ?? 9999) - (b.sort ?? 9999));

    const [
      venues,
      allRooms,
      allTables,
      allPaymentMethods,
      allPrinters,
      allCategories,
      allItems,
      allModifiers,
      allCategoryModifierLinks,
      allItemModifierLinks,
    ] = await Promise.all([
      db.getAll('venues'),
      db.getAll('rooms'),
      db.getAll('tables'),
      db.getAll('payment_methods'),
      db.getAll('printers'),
      db.getAll('menu_categories'),
      db.getAll('menu_items'),
      db.getAll('menu_modifiers'),
      db.getAll('menu_categories_menu_modifiers'),
      db.getAll('menu_items_menu_modifiers'),
    ]);

    const venueRecord = venueIdStr != null
      ? (venues.find(v => String(v.id) === venueIdStr) ?? null)
      : null;

    const rooms = byVenueAndStatus(allRooms);
    const roomIds = new Set(rooms.map(r => String(r.id)));
    const tables = allTables
      .filter((t) => {
        if (t.status === 'archived') return false;
        if (venueIdStr == null) return true;

        const tableVenueId = relationIdStr(t.venue);
        if (tableVenueId != null) return tableVenueId === venueIdStr;

        const tableRoomId = relationIdStr(t.room);
        return tableRoomId != null && roomIds.has(tableRoomId);
      })
      .sort((a, b) => (a.sort ?? 9999) - (b.sort ?? 9999));

    return {
      venueRecord,
      rooms,
      tables,
      paymentMethods: byVenueAndStatus(allPaymentMethods),
      printers:       byVenueAndStatus(allPrinters),
      categories:     byVenueAndStatus(allCategories),
      items:          byVenueAndStatus(allItems),
      modifiers:      byVenueAndStatus(allModifiers),
      categoryModifierLinks: byVenueAndStatus(allCategoryModifierLinks),
      itemModifierLinks: byVenueAndStatus(allItemModifierLinks),
    };
  } catch (e) {
    console.warn('[IDBPersistence] loadConfigFromIDB failed:', e);
    return null;
  }
}

/**
 * Removes all locally cached Directus configuration collections and related
 * per-collection pull state (`last_pull_ts:*` and `last_pull_cursor:*`) from
 * app_meta.
 *
 * Used when the user explicitly requests a full local config reset before
 * forcing a new Directus configuration pull.
 */
export async function clearLocalConfigCacheFromIDB() {
  const configStores = [
    'venues',
    'rooms',
    'tables',
    'payment_methods',
    'menu_categories',
    'menu_items',
    'menu_modifiers',
    'menu_categories_menu_modifiers',
    'menu_items_menu_modifiers',
    'printers',
    'venue_users',
    'table_merge_sessions',
  ];
  try {
    const db = await getDB();
    const existingStores = configStores.filter(store => db.objectStoreNames.contains(store));
    await Promise.all(existingStores.map(store => db.clear(store)));

    const tx = db.transaction('app_meta', 'readwrite');
    const keys = await tx.store.getAllKeys();
    await Promise.all(
      keys
        .filter(key => typeof key === 'string' && (key.startsWith('last_pull_ts:') || key.startsWith('last_pull_cursor:')))
        .map(key => tx.store.delete(key)),
    );
    await tx.done;
  } catch (e) {
    console.warn('[IDBPersistence] Failed to clear local config cache:', e);
  }
}

/**
 * Returns the last pull timestamp for `collection` stored in app_meta.
 * Used by the pull loop to build `filter[date_updated][_gt]` queries.
 *
 * @param {string} collection
 * @returns {Promise<string|null>} ISO timestamp or null if never pulled
 */
export async function loadLastPullTsFromIDB(collection) {
  try {
    const db = await getDB();
    const record = await db.get('app_meta', `last_pull_ts:${collection}`);
    return record?.value ?? null;
  } catch (e) {
    console.warn('[IDBPersistence] Failed to load last_pull_ts for', collection, e);
    return null;
  }
}

/**
 * Persists the last pull timestamp for `collection`.
 * Called after each successful pull cycle.
 *
 * @param {string} collection
 * @param {string} ts - ISO timestamp (e.g. max date_updated in the pulled batch)
 */
export async function saveLastPullTsToIDB(collection, ts) {
  try {
    const db = await getDB();
    await db.put('app_meta', { id: `last_pull_ts:${collection}`, value: ts });
  } catch (e) {
    console.warn('[IDBPersistence] Failed to save last_pull_ts for', collection, e);
  }
}

/**
 * Returns the keyset cursor `{ts, id}` for `collection` stored in app_meta.
 *
 * The cursor checkpoints the `{date_updated, id}` position at the end of
 * each successfully processed page so the next incremental poll can resume
 * from where the previous one left off.  Note that `ts` may be `null` for
 * records that have neither `date_updated` nor `date_created` set; callers
 * must check for `null` before using the value in a keyset filter.
 *
 * Returns `null` when no cursor has been persisted yet (e.g. after a fresh
 * install or a full reset).
 *
 * @param {string} collection
 * @returns {Promise<{ts: string|null, id: string|number}|null>}
 */
export async function loadLastPullCursorFromIDB(collection) {
  try {
    const db = await getDB();
    const record = await db.get('app_meta', `last_pull_cursor:${collection}`);
    return record?.value ?? null;
  } catch (e) {
    console.warn('[IDBPersistence] Failed to load last_pull_cursor for', collection, e);
    return null;
  }
}

/**
 * Persists the keyset cursor `{ts, id}` for `collection`.
 *
 * Called after each successfully processed page in the pull loop so the cursor
 * is checkpointed at the last known-good position.  Only cursors with both a
 * truthy `id` and a non-null `ts` are persisted (callers must enforce this
 * guard); cursors with `ts: null` cannot activate keyset mode and must not be
 * stored.
 *
 * @param {string} collection
 * @param {{ ts: string|null, id: string|number }} cursor
 */
export async function saveLastPullCursorToIDB(collection, cursor) {
  try {
    const db = await getDB();
    await db.put('app_meta', { id: `last_pull_cursor:${collection}`, value: cursor });
  } catch (e) {
    console.warn('[IDBPersistence] Failed to save last_pull_cursor for', collection, e);
  }
}

/**
 * Atomically replaces all records in the `table_merge_sessions` ObjectStore.
 *
 * Used after a full Directus pull of `table_merge_sessions` so that dissolved
 * merges (records deleted on Directus) are also removed from IDB.
 *
 * @param {Array<object>} records - Complete set of active merge records from Directus.
 */
export async function replaceTableMergesInIDB(records) {
  try {
    const db = await getDB();
    const tx = db.transaction('table_merge_sessions', 'readwrite');
    await tx.store.clear();
    for (const r of records) {
      if (r.id && r.slave_table) {
        const { _sync_status: _s, ...clean } = r;
        await tx.store.put(JSON.parse(JSON.stringify(clean)));
      }
    }
    await tx.done;
  } catch (e) {
    console.warn('[IDBPersistence] replaceTableMergesInIDB failed:', e);
  }
}

/**
 * Normalises a raw array of Directus venue_users records ready for IDB storage.
 * Handles name/display_name aliasing, apps array normalisation, role-field
 * removal, and PIN hashing.  Does NOT touch IDB — use `replaceVenueUsersInIDB`
 * for the full atomic replace.
 *
 * @param {Array<object>} records - Raw venue_users from Directus.
 * @returns {Promise<Array<object>>} Normalised records (invalid entries dropped).
 */
export async function normalizeVenueUsersForIDB(records) {
  if (!Array.isArray(records)) return [];
  const normalized = [];
  for (const rawRecord of records) {
    if (!rawRecord || typeof rawRecord !== 'object') continue;
    const record = { ...rawRecord };

    if ((record.name == null || record.name === '') && record.display_name != null) {
      record.name = record.display_name;
    }
    if ((record.display_name == null || record.display_name === '') && record.name != null) {
      record.display_name = record.name;
    }

    record.apps = normalizeAppsArray(record.apps);
    delete record.role;
    delete record.role2;
    delete record._sync_status;

    const pinType = typeof record.pin;
    const isPinScalar = pinType === 'string' || pinType === 'number';
    if (record.pin != null && isPinScalar) {
      const trimmedPin = String(record.pin).trim();
      const pinDigits = _extractPinDigits(trimmedPin);
      if (pinDigits.length === PIN_LENGTH) {
        try {
          const hashed = await _hashPin(pinDigits);
          record.pin = hashed ?? '';
        } catch (err) {
          console.warn('[IDBPersistence] Failed to hash venue_users PIN during normalizeVenueUsersForIDB. Clearing PIN. User ID:', record.id ?? 'unknown', err);
          record.pin = '';
        }
      } else {
        console.warn(`[IDBPersistence] Invalid venue_users PIN during normalizeVenueUsersForIDB — could not extract ${PIN_LENGTH} numeric digits. User ID:`, record.id ?? 'unknown');
        record.pin = '';
      }
    } else if (record.pin != null) {
      record.pin = '';
    }

    if (!record.id) continue;
    normalized.push(JSON.parse(JSON.stringify(record)));
  }
  return normalized;
}

/**
 * Atomically replaces all records in the `venue_users` ObjectStore.
 *
 * Used after a full Directus deep-fetch so that users removed from Directus
 * are also removed locally. Records are normalized (name/display_name, apps array,
 * PIN hashing) before being written. Manual users (`_type === 'manual_user'`) are
 * preserved across the replace.
 *
 * @param {Array<object>} records - Complete set of venue_users from Directus.
 */
export async function replaceVenueUsersInIDB(records) {
  try {
    const db = await getDB();
    const normalized = await normalizeVenueUsersForIDB(records);

    const tx = db.transaction('venue_users', 'readwrite');
    const existingRecords = await tx.store.getAll();
    const manualUsers = existingRecords.filter((record) => (
      record &&
      typeof record === 'object' &&
      record.id &&
      (
        record._type === 'manual_user' ||
        (!record._type && !Object.prototype.hasOwnProperty.call(record, 'status'))
      )
    ));

    await tx.store.clear();
    for (const manualUser of manualUsers) {
      await tx.store.put(manualUser);
    }
    for (const r of normalized) {
      await tx.store.put(r);
    }
    await tx.done;
    touchStorageKey();
  } catch (e) {
    console.warn('[IDBPersistence] replaceVenueUsersInIDB failed:', e);
  }
}

