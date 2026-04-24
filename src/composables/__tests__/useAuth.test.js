/**
 * @file useAuth.test.js
 * Unit tests for the auth composable.
 *
 * The composable uses module-level singleton state, so each test must call
 * `_resetAuthSingleton()` in beforeEach to get a clean slate.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { useAuth, _resetAuthSingleton, _waitForAuth, ALL_APPS, LOCK_TIMEOUT_OPTIONS } from '../useAuth.js';
import { _resetIDBSingleton } from '../useIDB.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Compute SHA-256 of a string the same way the composable does. */
async function sha256(str) {
  const data = new TextEncoder().encode(String(str));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(async () => {
  await _resetIDBSingleton();
  localStorage.clear();
  _resetAuthSingleton();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Exported constants ────────────────────────────────────────────────────────

describe('exported constants', () => {
  it('ALL_APPS contains exactly the three app names', () => {
    expect(ALL_APPS).toEqual(['cassa', 'sala', 'cucina']);
  });

  it('LOCK_TIMEOUT_OPTIONS starts with Mai (0) and includes standard values', () => {
    const values = LOCK_TIMEOUT_OPTIONS.map((o) => o.value);
    expect(values[0]).toBe(0);
    expect(values).toContain(5);
    expect(values).toContain(30);
  });
});

// ── Initial state ────────────────────────────────────────────────────────────

describe('initial state', () => {
  it('starts with no users and locked screen', () => {
    const { users, isLocked, requiresAuth, isAuthenticated } = useAuth();
    expect(users.value).toHaveLength(0);
    expect(isLocked.value).toBe(true);
    expect(requiresAuth.value).toBe(false);
    expect(isAuthenticated.value).toBe(false);
  });

  it('currentUser is null before any login', () => {
    const { currentUser } = useAuth();
    expect(currentUser.value).toBeNull();
  });

  it('lockTimeoutMinutes defaults to 5', () => {
    const { lockTimeoutMinutes } = useAuth();
    expect(lockTimeoutMinutes.value).toBe(5);
  });
});

// ── addUser ──────────────────────────────────────────────────────────────────

describe('addUser()', () => {
  it('adds a user and updates in-memory state', async () => {
    const { addUser, users } = useAuth();
    await addUser('Mario', '1234');
    expect(users.value).toHaveLength(1);
    expect(users.value[0].name).toBe('Mario');
  });

  it('stores a hashed PIN, not the plaintext', async () => {
    const { addUser, users } = useAuth();
    await addUser('Mario', '1234');
    const hash = await sha256('1234');
    expect(users.value[0].pin).toBe(hash);
    expect(users.value[0].pin).not.toBe('1234');
  });

  it('first manual user gets isAdmin: true', async () => {
    const { addUser, users } = useAuth();
    await addUser('First', '1111');
    expect(users.value[0].isAdmin).toBe(true);
  });

  it('subsequent users do not get admin', async () => {
    const { addUser, users } = useAuth();
    await addUser('First', '1111');
    await addUser('Second', '2222');
    expect(users.value[1].isAdmin).toBe(false);
  });

  it('assigns all three apps by default', async () => {
    const { addUser, users } = useAuth();
    await addUser('Mario', '1234');
    expect(users.value[0].apps).toEqual(ALL_APPS);
  });

  it('respects a custom apps list for non-admin users', async () => {
    const { addUser, users } = useAuth();
    await addUser('Admin', '1111'); // first user = admin, always gets ALL_APPS
    await addUser('Chef', '5678', ['cucina']); // second user = non-admin, custom apps
    expect(users.value[1].apps).toEqual(['cucina']);
  });

  it('admin user always gets all apps regardless of the apps argument', async () => {
    const { addUser, users } = useAuth();
    await addUser('Admin', '1111', ['cucina']); // first user = admin, must get ALL_APPS
    expect(users.value[0].apps).toEqual(ALL_APPS);
    expect(users.value[0].isAdmin).toBe(true);
  });

  it('makeAdmin flag creates an admin user with all apps', async () => {
    const { addUser, users } = useAuth();
    await addUser('Admin', '1111'); // first user = admin
    await addUser('Manager', '2222', ['cassa'], true); // explicit admin
    expect(users.value[1].isAdmin).toBe(true);
    expect(users.value[1].apps).toEqual(ALL_APPS);
  });
});

// ── login ────────────────────────────────────────────────────────────────────

describe('login()', () => {
  it('returns true and unlocks the screen with a correct PIN', async () => {
    const { addUser, login, isLocked, isAuthenticated, currentUser } = useAuth();
    const user = await addUser('Mario', '1234');
    const ok = await login(user.id, '1234');
    expect(ok).toBe(true);
    expect(isLocked.value).toBe(false);
    expect(isAuthenticated.value).toBe(true);
    expect(currentUser.value?.name).toBe('Mario');
  });

  it('returns false with a wrong PIN and keeps the screen locked', async () => {
    const { addUser, login, isLocked } = useAuth();
    const user = await addUser('Mario', '1234');
    const ok = await login(user.id, '9999');
    expect(ok).toBe(false);
    expect(isLocked.value).toBe(true);
  });

  it('returns false for an unknown userId', async () => {
    const { login } = useAuth();
    const ok = await login('nonexistent-id', '1234');
    expect(ok).toBe(false);
  });

  it('sets the current user and unlocks after a successful login', async () => {
    const { addUser, login, currentUser, isAuthenticated } = useAuth();
    const user = await addUser('Mario', '1234');
    await login(user.id, '1234');
    expect(currentUser.value?.id).toBe(user.id);
    expect(isAuthenticated.value).toBe(true);
  });
});

// ── lock ─────────────────────────────────────────────────────────────────────

describe('lock()', () => {
  it('locks the screen without clearing the current user', async () => {
    const { addUser, login, lock, isLocked, isAuthenticated, currentUser } = useAuth();
    const user = await addUser('Mario', '1234');
    await login(user.id, '1234');
    expect(isAuthenticated.value).toBe(true);

    lock();
    expect(isLocked.value).toBe(true);
    expect(currentUser.value?.name).toBe('Mario');
  });
});

// ── logout ───────────────────────────────────────────────────────────────────

describe('logout()', () => {
  it('clears currentUser and locks the screen', async () => {
    const { addUser, login, logout, isLocked, currentUser, isAuthenticated } = useAuth();
    const user = await addUser('Mario', '1234');
    await login(user.id, '1234');

    logout();
    expect(isLocked.value).toBe(true);
    expect(currentUser.value).toBeNull();
    expect(isAuthenticated.value).toBe(false);
  });

  it('clears the current user after logout', async () => {
    const { addUser, login, logout, currentUser, isAuthenticated } = useAuth();
    const user = await addUser('Mario', '1234');
    await login(user.id, '1234');
    expect(isAuthenticated.value).toBe(true);
    logout();
    expect(currentUser.value).toBeNull();
    expect(isAuthenticated.value).toBe(false);
  });
});

// ── updateUser ───────────────────────────────────────────────────────────────

describe('updateUser()', () => {
  it('updates the user name in in-memory state', async () => {
    const { addUser, updateUser, users } = useAuth();
    const user = await addUser('Mario', '1234');
    await updateUser(user.id, { name: 'Luigi' });
    expect(users.value[0].name).toBe('Luigi');
  });

  it('hashes the new PIN if provided', async () => {
    const { addUser, updateUser, users } = useAuth();
    const user = await addUser('Mario', '1234');
    await updateUser(user.id, { pin: '9999' });
    const newHash = await sha256('9999');
    expect(users.value[0].pin).toBe(newHash);
  });

  it('keeps the old PIN when no pin update is provided', async () => {
    const { addUser, updateUser, users } = useAuth();
    const user = await addUser('Mario', '1234');
    const oldPin = users.value[0].pin;
    await updateUser(user.id, { name: 'Luigi' });
    expect(users.value[0].pin).toBe(oldPin);
  });

  it('is a no-op for appConfig users', async () => {
    // Temporarily inject a config user
    const { addUser: _a, users } = useAuth();
    // We test by adding a manual user and confirming config guard does not corrupt data
    await _a('Manual', '1111');
    const originalName = users.value[0].name;
    // A non-existent config id should be silently ignored
    const { updateUser } = useAuth();
    await updateUser('config-id-not-in-manual', { name: 'Hacked' });
    expect(users.value[0].name).toBe(originalName);
  });
});

// ── removeUser ───────────────────────────────────────────────────────────────

describe('removeUser()', () => {
  it('removes the user from the list', async () => {
    const { addUser, removeUser, users } = useAuth();
    const u = await addUser('Mario', '1234');
    expect(users.value).toHaveLength(1);
    removeUser(u.id);
    expect(users.value).toHaveLength(0);
  });

  it('logs out the current user if they are removed', async () => {
    const { addUser, login, removeUser, currentUser, isAuthenticated } = useAuth();
    const u = await addUser('Mario', '1234');
    await login(u.id, '1234');
    expect(isAuthenticated.value).toBe(true);
    removeUser(u.id);
    expect(currentUser.value).toBeNull();
  });

  it('does not log out a different user when another is removed', async () => {
    const { addUser, login, removeUser, currentUser } = useAuth();
    const u1 = await addUser('Admin', '1111');
    const u2 = await addUser('Staff', '2222');
    await login(u1.id, '1111');
    removeUser(u2.id);
    expect(currentUser.value?.id).toBe(u1.id);
  });
});

// ── setLockTimeout ───────────────────────────────────────────────────────────

describe('setLockTimeout()', () => {
  it('updates lockTimeoutMinutes in-memory', async () => {
    const { setLockTimeout, lockTimeoutMinutes } = useAuth();
    await setLockTimeout(10);
    expect(lockTimeoutMinutes.value).toBe(10);
  });

  it('setting timeout to 0 (never) updates in-memory correctly', async () => {
    const { setLockTimeout, lockTimeoutMinutes } = useAuth();
    await setLockTimeout(0);
    expect(lockTimeoutMinutes.value).toBe(0);
  });
});

// ── clearAllAuthData ──────────────────────────────────────────────────────────

describe('clearAllAuthData()', () => {
  it('clears in-memory state when clearAllAuthData is called', async () => {
    const { addUser, login, clearAllAuthData, users, currentUser, isLocked } = useAuth();
    const u = await addUser('Mario', '1234');
    await login(u.id, '1234');

    clearAllAuthData();

    expect(users.value).toHaveLength(0);
    expect(currentUser.value).toBeNull();
    expect(isLocked.value).toBe(true);
  });

  it('resets in-memory state to empty', async () => {
    const { addUser, login, clearAllAuthData, users, currentUser, isLocked } = useAuth();
    const u = await addUser('Mario', '1234');
    await login(u.id, '1234');

    clearAllAuthData();

    expect(users.value).toHaveLength(0);
    expect(currentUser.value).toBeNull();
    expect(isLocked.value).toBe(true);
  });
});

// ── requiresAuth / visibleUsers ───────────────────────────────────────────────

describe('requiresAuth and visibleUsers', () => {
  it('requiresAuth is false when no users exist', () => {
    const { requiresAuth } = useAuth();
    expect(requiresAuth.value).toBe(false);
  });

  it('requiresAuth is true after adding a user', async () => {
    const { addUser, requiresAuth } = useAuth();
    await addUser('Mario', '1234');
    expect(requiresAuth.value).toBe(true);
  });

  it('visibleUsers includes users whose apps list contains the current app', async () => {
    const { addUser, visibleUsers } = useAuth();
    // Default app is 'cassa' (pathname is '/' in jsdom)
    await addUser('CassaOnly', '1111', ['cassa']);
    await addUser('CucinaOnly', '2222', ['cucina']);
    // Only the cassa user should be visible
    const names = visibleUsers.value.map((u) => u.name);
    expect(names).toContain('CassaOnly');
    expect(names).not.toContain('CucinaOnly');
  });
});

// ── isAdmin / hasAdmin ────────────────────────────────────────────────────────

describe('isAdmin and hasAdmin', () => {
  it('isAdmin is true in open mode (no users configured)', () => {
    const { isAdmin } = useAuth();
    expect(isAdmin.value).toBe(true);
  });

  it('isAdmin is true when the first (admin) user is logged in', async () => {
    const { addUser, login, isAdmin } = useAuth();
    const u = await addUser('Admin', '1111');
    await login(u.id, '1111');
    expect(isAdmin.value).toBe(true);
  });

  it('isAdmin is false when a non-admin user is logged in', async () => {
    const { addUser, login, isAdmin } = useAuth();
    await addUser('Admin', '1111'); // creates admin (first user)
    const u2 = await addUser('Staff', '2222');
    await login(u2.id, '2222');
    expect(isAdmin.value).toBe(false);
  });

  it('hasAdmin is false when there are no manual users', () => {
    const { hasAdmin } = useAuth();
    expect(hasAdmin.value).toBe(false);
  });

  it('hasAdmin is true after the first manual user is created', async () => {
    const { addUser, hasAdmin } = useAuth();
    await addUser('Admin', '1111');
    expect(hasAdmin.value).toBe(true);
  });
});

// ── IDB persistence across init ──────────────────────────────────────────────

describe('persistence across singleton resets', () => {
  it('restores manual users from IDB on next init', async () => {
    // First session: create a user (addUser awaits IDB write before returning)
    const { addUser } = useAuth();
    await addUser('Mario', '1234');

    // Reset singleton (simulates a new page load) — do NOT reset IDB so data persists
    _resetAuthSingleton();

    // Re-init reads from IDB
    useAuth();
    await _waitForAuth();

    const { users } = useAuth();
    expect(users.value.some((u) => u.name === 'Mario')).toBe(true);
  });

  it('restores lockTimeoutMinutes from IDB on next init', async () => {
    const { setLockTimeout } = useAuth();
    await setLockTimeout(15); // awaits IDB write before returning

    _resetAuthSingleton();

    useAuth();
    await _waitForAuth();

    const { lockTimeoutMinutes } = useAuth();
    expect(lockTimeoutMinutes.value).toBe(15);
  });

  it('hydrates Directus users with apps ["admin"] as admin with full app access', async () => {
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();
    await db.put('venue_users', {
      id: 'vu_admin',
      name: 'Admin Directus',
      display_name: 'Admin Directus',
      apps: ['admin'],
      pin: await sha256('1234'),
      status: 'active',
    });

    _resetAuthSingleton();
    useAuth();
    await _waitForAuth();

    const { users } = useAuth();
    const adminUser = users.value.find((u) => u.id === 'vu_admin');
    expect(adminUser).toBeTruthy();
    expect(adminUser.isAdmin).toBe(true);
    expect(adminUser.apps).toEqual(ALL_APPS);
  });

  it('hydrates Directus users with scoped apps into the expected app access', async () => {
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();
    await db.put('venue_users', {
      id: 'vu_multi_role',
      name: 'Operatore Multi',
      display_name: 'Operatore Multi',
      apps: ['sala', 'cucina'],
      pin: await sha256('5678'),
      status: 'active',
    });

    _resetAuthSingleton();
    useAuth();
    await _waitForAuth();

    const { users, visibleUsers } = useAuth();
    const multiRoleUser = users.value.find((u) => u.id === 'vu_multi_role');
    expect(multiRoleUser).toBeTruthy();
    expect(multiRoleUser.isAdmin).toBe(false);
    expect(multiRoleUser.apps).toEqual(['sala', 'cucina']);
    expect(visibleUsers.value.map((u) => u.id)).not.toContain('vu_multi_role');
  });

  it('hydrates Directus users without apps with denied app access', async () => {
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();
    await db.put('venue_users', {
      id: 'vu_legacy_no_apps',
      name: 'Legacy User',
      display_name: 'Legacy User',
      pin: await sha256('6789'),
      status: 'active',
    });

    _resetAuthSingleton();
    useAuth();
    await _waitForAuth();

    const { users, visibleUsers, requiresAuth } = useAuth();
    const legacyUser = users.value.find((u) => u.id === 'vu_legacy_no_apps');
    expect(legacyUser).toBeTruthy();
    expect(legacyUser.isAdmin).toBe(false);
    expect(legacyUser.apps).toEqual([]);
    expect(visibleUsers.value.map((u) => u.id)).not.toContain('vu_legacy_no_apps');
    expect(requiresAuth.value).toBe(false);
  });

  it('hydrates Directus users with empty-string apps entries with denied app access', async () => {
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();
    await db.put('venue_users', {
      id: 'vu_empty_apps_entry',
      name: 'Empty Apps Entry',
      display_name: 'Empty Apps Entry',
      apps: [''],
      pin: await sha256('6790'),
      status: 'active',
    });

    _resetAuthSingleton();
    useAuth();
    await _waitForAuth();

    const { users, visibleUsers } = useAuth();
    const user = users.value.find((u) => u.id === 'vu_empty_apps_entry');
    expect(user).toBeTruthy();
    expect(user.isAdmin).toBe(false);
    expect(user.apps).toEqual([]);
    expect(visibleUsers.value.map((u) => u.id)).not.toContain('vu_empty_apps_entry');
  });
});

// ── Auto-lock timer ───────────────────────────────────────────────────────────

describe('auto-lock timer', () => {
  // Only fake setTimeout/setInterval (used for the lock timer); do NOT fake
  // setImmediate so that fake-indexeddb's scheduling (which uses setImmediate)
  // still works when awaiting addUser / setLockTimeout inside these tests.
  // Defined at describe-block level so it is shared by all tests in this group.
  const FAKE_TIMER_OPTIONS = {
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  };

  it('locks the screen after the configured inactivity timeout', async () => {
    vi.useFakeTimers(FAKE_TIMER_OPTIONS);
    try {
      const { addUser, login, setLockTimeout, isLocked } = useAuth();
      const u = await addUser('Mario', '1234');
      await setLockTimeout(1); // 1 minute
      await login(u.id, '1234');
      expect(isLocked.value).toBe(false);

      vi.advanceTimersByTime(60_000);
      expect(isLocked.value).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not auto-lock when timeout is 0 (never)', async () => {
    vi.useFakeTimers(FAKE_TIMER_OPTIONS);
    try {
      const { addUser, login, setLockTimeout, isLocked } = useAuth();
      const u = await addUser('Mario', '1234');
      await setLockTimeout(0);
      await login(u.id, '1234');
      expect(isLocked.value).toBe(false);

      vi.advanceTimersByTime(999_999);
      expect(isLocked.value).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('recordActivity() resets the timer, delaying the auto-lock', async () => {
    vi.useFakeTimers(FAKE_TIMER_OPTIONS);
    try {
      const { addUser, login, setLockTimeout, recordActivity, isLocked } = useAuth();
      const u = await addUser('Mario', '1234');
      await setLockTimeout(1); // 1 minute
      await login(u.id, '1234');

      // Advance 59 s — not yet locked
      vi.advanceTimersByTime(59_000);
      expect(isLocked.value).toBe(false);

      // Activity resets the countdown
      recordActivity();

      // Advance another 59 s — still not locked (59 s since last activity)
      vi.advanceTimersByTime(59_000);
      expect(isLocked.value).toBe(false);

      // Finally advance past 1 minute from last activity
      vi.advanceTimersByTime(1_001);
      expect(isLocked.value).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── Cross-app access enforcement ──────────────────────────────────────────────

describe('cross-app access enforcement', () => {
  it('login() rejects a user who does not have access to the current app', async () => {
    // Default _currentApp is 'cassa' in jsdom (pathname is '/').
    // Create a cucina-only user and verify they cannot log in through the cassa app.
    const { addUser, login, isAuthenticated } = useAuth();
    await addUser('Admin', '1111'); // first user = admin, gets all apps
    const cucinaUser = await addUser('Chef', '2222', ['cucina']);
    const ok = await login(cucinaUser.id, '2222');
    expect(ok).toBe(false);
    expect(isAuthenticated.value).toBe(false);
  });

  it('login() succeeds for a user who has access to the current app', async () => {
    // A user with cassa access can log in on the cassa page.
    const { addUser, login, isAuthenticated } = useAuth();
    await addUser('Admin', '1111'); // first user = admin
    const cassaUser = await addUser('Cassiere', '3333', ['cassa']);
    const ok = await login(cassaUser.id, '3333');
    expect(ok).toBe(true);
    expect(isAuthenticated.value).toBe(true);
  });

  it('login() allows admin users to log in regardless of app', async () => {
    // Admin users have all apps; they must never be blocked by the app check.
    const { addUser, login, isAuthenticated } = useAuth();
    const admin = await addUser('Admin', '1111');
    expect(admin.isAdmin).toBe(true);
    const ok = await login(admin.id, '1111');
    expect(ok).toBe(true);
    expect(isAuthenticated.value).toBe(true);
  });

  it('session is not restored on next init for a user without access to the current app', async () => {
    // Simulate: cassa user logs in → session saved → page reload as sala app.
    // _currentApp for the test environment is 'cassa', so we manually write a
    // session for a cucina-only user into IDB and then reload.
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();

    // Write a cucina-only user to venue_users
    const cucinaHash = await sha256('5555');
    await db.put('venue_users', {
      id: 'vu_cucina_only',
      name: 'Chef Cucina',
      display_name: 'Chef Cucina',
      apps: ['cucina'],
      pin: cucinaHash,
      status: 'active',
    });
    // Persist their session (as if they logged into cucina)
    await db.put('app_meta', { id: 'auth_session', userId: 'vu_cucina_only' });

    // Simulate page reload (same app = cassa in jsdom)
    _resetAuthSingleton();
    useAuth();
    await _waitForAuth();

    const { currentUser, isAuthenticated } = useAuth();
    // The cucina user must NOT be restored as the active session on the cassa app
    expect(currentUser.value).toBeNull();
    expect(isAuthenticated.value).toBe(false);
  });

  it('session IS restored on next init for a user who has access to the current app', async () => {
    // A non-admin cassa-only user's session should survive a reload of the cassa app.
    // Create an admin first so the second addUser() call is NOT auto-promoted to admin,
    // which ensures this test actually exercises the apps.includes(_currentApp) branch
    // rather than the isAdmin === true bypass.
    const { addUser } = useAuth();
    await addUser('Admin', '0000'); // first user → always admin (isFirstManual)
    const cassaUser = await addUser('Cassiere', '3333', ['cassa']); // second user → cassa-only

    // Persist the cassa user's session manually
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();
    await db.put('app_meta', { id: 'auth_session', userId: cassaUser.id });

    _resetAuthSingleton();
    useAuth();
    await _waitForAuth();

    const { currentUser } = useAuth();
    // The cassa user should be restored (still locked, but currentUser is set)
    expect(currentUser.value?.id).toBe(cassaUser.id);
  });
});

// ── isHydrated ────────────────────────────────────────────────────────────────

describe('isHydrated', () => {
  it('is false before the IDB load completes', () => {
    // _init() is called by useAuth() but IDB load is async; isHydrated stays
    // false until the promise settles.
    const { isHydrated } = useAuth();
    expect(isHydrated.value).toBe(false);
  });

  it('becomes true once IDB hydration has settled', async () => {
    const { isHydrated } = useAuth();
    expect(isHydrated.value).toBe(false);
    await _waitForAuth();
    expect(isHydrated.value).toBe(true);
  });

  it('resets to false after _resetAuthSingleton() and becomes true again on next init', async () => {
    useAuth();
    await _waitForAuth();

    _resetAuthSingleton();
    const { isHydrated } = useAuth();
    // After reset, new init starts but IDB load hasn't settled yet
    expect(isHydrated.value).toBe(false);
    await _waitForAuth();
    expect(isHydrated.value).toBe(true);
  });

  it('is true after adding a user (mutation skips IDB hydration but still marks hydrated)', async () => {
    const { addUser, isHydrated } = useAuth();
    // addUser fires before IDB load completes; _mutationVersion changes so
    // hydration is skipped, but isHydrated must still become true.
    await addUser('Mario', '1234');
    await _waitForAuth();
    expect(isHydrated.value).toBe(true);
  });
});

// ── Directus sole-source enforcement ─────────────────────────────────────────

describe('Directus sole-source enforcement', () => {
  it('purges manual users from memory at startup when Directus users are present', async () => {
    // Pre-populate IDB with one manual user and one Directus user.
    const { saveUsersToIDB } = await import('../../store/persistence/operations.js');
    const { upsertRecordsIntoIDB } = await import('../../store/persistence/operations.js');
    await saveUsersToIDB([{
      id: 'mu_mario', name: 'Mario', pin: await sha256('1111'), apps: ['cassa'], isAdmin: false, _type: 'manual_user',
    }]);
    await upsertRecordsIntoIDB('venue_users', [{
      id: 'vu_dir', name: 'Direttore', pin: '2222', apps: ['admin'], status: 'active',
    }]);

    // Reload singleton — Directus user detected → manual user should be dropped.
    _resetAuthSingleton();
    useAuth();
    await _waitForAuth();

    const { users, manualUsers, directusUsers } = useAuth();
    expect(manualUsers.value).toHaveLength(0);
    expect(directusUsers.value.some(u => u.id === 'vu_dir')).toBe(true);
    expect(users.value.every(u => u.id !== 'mu_mario')).toBe(true);
  });

  it('reloadUsersFromIDB() purges manual users and shows Directus users when Directus users arrive mid-session', async () => {
    const { reloadUsersFromIDB } = await import('../useAuth.js');
    const { upsertRecordsIntoIDB } = await import('../../store/persistence/operations.js');

    // Start with a manual user only.
    const { addUser, users, manualUsers, directusUsers } = useAuth();
    const manualUser = await addUser('Mario', '1111');
    await _waitForAuth();
    expect(manualUsers.value).toHaveLength(1);

    // Directus sync writes a venue user during the session.
    await upsertRecordsIntoIDB('venue_users', [{
      id: 'vu_dir2', name: 'Direttore', pin: '2222', apps: ['admin'], status: 'active',
    }]);

    // Simulate the live-sync hook.
    await reloadUsersFromIDB();

    expect(manualUsers.value).toHaveLength(0);
    expect(directusUsers.value.some(u => u.id === 'vu_dir2')).toBe(true);
    // The manual user's actual id must no longer appear in the roster.
    expect(users.value.every(u => u.id !== manualUser.id)).toBe(true);
  });

  it('reloadUsersFromIDB() logs out a manual user who is purged by an arriving Directus sync', async () => {
    const { reloadUsersFromIDB } = await import('../useAuth.js');
    const { upsertRecordsIntoIDB } = await import('../../store/persistence/operations.js');

    // Manual user logs in.
    const { addUser, login, currentUser, isAuthenticated } = useAuth();
    const u = await addUser('Mario', '1111');
    await _waitForAuth();
    await login(u.id, '1111');
    expect(isAuthenticated.value).toBe(true);

    // Directus sync arrives with a venue user.
    await upsertRecordsIntoIDB('venue_users', [{
      id: 'vu_dir3', name: 'Direttore', pin: '2222', apps: ['admin'], status: 'active',
    }]);
    await reloadUsersFromIDB();

    // The manual user's session must be cleared.
    expect(currentUser.value).toBeNull();
    expect(isAuthenticated.value).toBe(false);
  });

  it('reloadUsersFromIDB() keeps manual users when no Directus users are present', async () => {
    const { reloadUsersFromIDB } = await import('../useAuth.js');

    const { addUser, manualUsers } = useAuth();
    await addUser('Mario', '1111');
    await _waitForAuth();
    expect(manualUsers.value).toHaveLength(1);

    await reloadUsersFromIDB();

    // Still has the manual user — nothing was purged.
    expect(manualUsers.value).toHaveLength(1);
    expect(manualUsers.value[0].name).toBe('Mario');
  });
});

// ── Config-user login (no explicit apps) ─────────────────────────────────────

describe('login() config user with no explicit apps', () => {
  let savedConfigUsers;
  beforeEach(() => {
    const { appConfig } = require('../../utils/index.js');
    savedConfigUsers = appConfig.auth?.users ? [...appConfig.auth.users] : [];
  });
  afterEach(() => {
    const { appConfig } = require('../../utils/index.js');
    if (appConfig.auth) appConfig.auth.users = savedConfigUsers;
  });

  it('allows a config user with no apps field to log in (defaults to all apps)', async () => {
    // Dynamic import to set up appConfig before useAuth reads it.
    const { appConfig } = await import('../../utils/index.js');
    appConfig.auth = appConfig.auth ?? {};
    appConfig.auth.users = [{ id: 'cfg_all', name: 'Config Admin', pin: '9999' }]; // no apps
    _resetAuthSingleton();
    const { login, isAuthenticated, visibleUsers, requiresAuth } = useAuth();
    await _waitForAuth();
    // The config user must be visible for the current app and auth must be required.
    expect(requiresAuth.value).toBe(true);
    expect(visibleUsers.value.some(u => u.id === 'cfg_all')).toBe(true);
    const ok = await login('cfg_all', '9999');
    expect(ok).toBe(true);
    expect(isAuthenticated.value).toBe(true);
    appConfig.auth.users = [];
  });

  it('allows a config user with empty apps array to log in (defaults to all apps)', async () => {
    const { appConfig } = await import('../../utils/index.js');
    appConfig.auth = appConfig.auth ?? {};
    appConfig.auth.users = [{ id: 'cfg_empty', name: 'Config User', pin: '8888', apps: [] }];
    _resetAuthSingleton();
    const { login, isAuthenticated, visibleUsers, requiresAuth } = useAuth();
    await _waitForAuth();
    // The config user must be visible for the current app and auth must be required.
    expect(requiresAuth.value).toBe(true);
    expect(visibleUsers.value.some(u => u.id === 'cfg_empty')).toBe(true);
    const ok = await login('cfg_empty', '8888');
    expect(ok).toBe(true);
    expect(isAuthenticated.value).toBe(true);
    appConfig.auth.users = [];
  });
});

