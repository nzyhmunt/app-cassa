/**
 * @file store/persistence/auth.js
 * @description Persistence helpers for authentication state (users, session, auth settings).
 */

import { getDB } from '../../composables/useIDB.js';

/**
 * Loads app-managed users from the `venue_users` ObjectStore.
 *
 * Returns both locally-created (manual) users and active users pulled from
 * Directus (H6).  Manual users are identified by `_type === 'manual_user'`;
 * Directus-synced users have no `_type` discriminator.  Archived Directus users
 * (`status === 'archived'`) are excluded so they cannot log in.
 * @returns {Promise<Array>}
 */
export async function loadUsersFromIDB() {
  try {
    const db = await getDB();
    const all = await db.getAll('venue_users');
    return all.filter(r =>
      r._type === 'manual_user' ||
      (!r._type && r.status !== 'archived'),
    );
  } catch (e) {
    console.warn('[IDBPersistence] Failed to load users:', e);
    return [];
  }
}

/**
 * Persists the full list of manual users to IDB.
 * Removes all manual user records — including legacy entries that predate the
 * `_type` marker (no `_type` field and no own `status` property) — then writes
 * the new list. Directus-synced records, identified by having an own
 * `status` field, are never touched.
 * @param {Array} users
 */
export async function saveUsersToIDB(users) {
  try {
    const db = await getDB();
    const tx = db.transaction('venue_users', 'readwrite');
    const existing = await tx.store.getAll();
    await Promise.all(
      existing
        .filter(r =>
          r._type === 'manual_user' ||
          (r._type == null && !Object.prototype.hasOwnProperty.call(r, 'status')),
        )
        .map(r => tx.store.delete(r.id)),
    );
    await Promise.all(users.map(u => {
      const plain = JSON.parse(JSON.stringify({ ...u, _type: 'manual_user' }));
      return tx.store.put(plain);
    }));
    await tx.done;
  } catch (e) {
    console.warn('[IDBPersistence] Failed to save users:', e);
  }
}

/**
 * Loads the persisted auth session from `app_meta`.
 * @returns {Promise<string|null>} userId or null
 */
export async function loadAuthSessionFromIDB() {
  try {
    const db = await getDB();
    const record = await db.get('app_meta', 'auth_session');
    return record?.userId ?? null;
  } catch (e) {
    console.warn('[IDBPersistence] Failed to load auth session:', e);
    return null;
  }
}

/**
 * Persists the auth session userId to `app_meta`.
 * @param {string|null} userId
 */
export async function saveAuthSessionToIDB(userId) {
  try {
    const db = await getDB();
    if (userId == null) {
      await db.delete('app_meta', 'auth_session');
    } else {
      await db.put('app_meta', { id: 'auth_session', userId });
    }
  } catch (e) {
    console.warn('[IDBPersistence] Failed to save auth session:', e);
  }
}

/**
 * Loads auth settings from `app_meta`.
 * @returns {Promise<{lockTimeoutMinutes: number}>}
 */
export async function loadAuthSettingsFromIDB() {
  try {
    const db = await getDB();
    const record = await db.get('app_meta', 'auth_settings');
    return record ?? { lockTimeoutMinutes: 5 };
  } catch (e) {
    console.warn('[IDBPersistence] Failed to load auth settings:', e);
    return { lockTimeoutMinutes: 5 };
  }
}

/**
 * Persists auth settings to `app_meta`.
 * @param {{lockTimeoutMinutes: number}} settings
 */
export async function saveAuthSettingsToIDB(settings) {
  try {
    const db = await getDB();
    await db.put('app_meta', JSON.parse(JSON.stringify({ id: 'auth_settings', ...settings })));
  } catch (e) {
    console.warn('[IDBPersistence] Failed to save auth settings:', e);
  }
}
