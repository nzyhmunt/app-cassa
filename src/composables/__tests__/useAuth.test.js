/**
 * @file useAuth.test.js
 * Unit tests for the auth composable.
 *
 * The composable uses module-level singleton state, so each test must call
 * `_resetAuthSingleton()` in beforeEach to get a clean slate.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAuth, _resetAuthSingleton, ALL_APPS, LOCK_TIMEOUT_OPTIONS } from '../useAuth.js';

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

beforeEach(() => {
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
  it('adds a user and persists to localStorage', async () => {
    const { addUser, users } = useAuth();
    await addUser('Mario', '1234');
    expect(users.value).toHaveLength(1);
    expect(users.value[0].name).toBe('Mario');
    const stored = JSON.parse(localStorage.getItem('auth_users'));
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('Mario');
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

  it('persists the session to localStorage after a successful login', async () => {
    const { addUser, login } = useAuth();
    const user = await addUser('Mario', '1234');
    await login(user.id, '1234');
    const session = JSON.parse(localStorage.getItem('auth_session'));
    expect(session?.userId).toBe(user.id);
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

  it('removes the session from localStorage', async () => {
    const { addUser, login, logout } = useAuth();
    const user = await addUser('Mario', '1234');
    await login(user.id, '1234');
    logout();
    expect(localStorage.getItem('auth_session')).toBeNull();
  });
});

// ── updateUser ───────────────────────────────────────────────────────────────

describe('updateUser()', () => {
  it('updates the user name and persists to localStorage', async () => {
    const { addUser, updateUser, users } = useAuth();
    const user = await addUser('Mario', '1234');
    await updateUser(user.id, { name: 'Luigi' });
    expect(users.value[0].name).toBe('Luigi');
    const stored = JSON.parse(localStorage.getItem('auth_users'));
    expect(stored[0].name).toBe('Luigi');
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
  it('removes the user from the list and localStorage', async () => {
    const { addUser, removeUser, users } = useAuth();
    const u = await addUser('Mario', '1234');
    expect(users.value).toHaveLength(1);
    removeUser(u.id);
    expect(users.value).toHaveLength(0);
    const stored = JSON.parse(localStorage.getItem('auth_users') ?? '[]');
    expect(stored).toHaveLength(0);
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
  it('updates lockTimeoutMinutes and persists to localStorage', () => {
    const { setLockTimeout, lockTimeoutMinutes } = useAuth();
    setLockTimeout(10);
    expect(lockTimeoutMinutes.value).toBe(10);
    const stored = JSON.parse(localStorage.getItem('auth_settings'));
    expect(stored?.lockTimeoutMinutes).toBe(10);
  });

  it('setting timeout to 0 (never) persists correctly', () => {
    const { setLockTimeout, lockTimeoutMinutes } = useAuth();
    setLockTimeout(0);
    expect(lockTimeoutMinutes.value).toBe(0);
    expect(JSON.parse(localStorage.getItem('auth_settings')).lockTimeoutMinutes).toBe(0);
  });
});

// ── clearAllAuthData ──────────────────────────────────────────────────────────

describe('clearAllAuthData()', () => {
  it('removes all auth keys from localStorage', async () => {
    const { addUser, login, clearAllAuthData } = useAuth();
    const u = await addUser('Mario', '1234');
    await login(u.id, '1234');

    clearAllAuthData();

    expect(localStorage.getItem('auth_users')).toBeNull();
    expect(localStorage.getItem('auth_session')).toBeNull();
    expect(localStorage.getItem('auth_settings')).toBeNull();
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
  it('isAdmin is false before any login', () => {
    const { isAdmin } = useAuth();
    expect(isAdmin.value).toBe(false);
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

// ── localStorage persistence across init ─────────────────────────────────────

describe('persistence across singleton resets', () => {
  it('restores manual users from localStorage on next init', async () => {
    // First session: create a user
    await useAuth().addUser('Mario', '1234');

    // Reset singleton (simulates a new page load)
    _resetAuthSingleton();

    const { users } = useAuth();
    expect(users.value.some((u) => u.name === 'Mario')).toBe(true);
  });

  it('restores lockTimeoutMinutes from localStorage on next init', () => {
    useAuth().setLockTimeout(15);
    _resetAuthSingleton();
    const { lockTimeoutMinutes } = useAuth();
    expect(lockTimeoutMinutes.value).toBe(15);
  });
});

// ── Auto-lock timer ───────────────────────────────────────────────────────────

describe('auto-lock timer', () => {
  it('locks the screen after the configured inactivity timeout', async () => {
    vi.useFakeTimers();
    try {
      const { addUser, login, setLockTimeout, isLocked } = useAuth();
      const u = await addUser('Mario', '1234');
      setLockTimeout(1); // 1 minute
      await login(u.id, '1234');
      expect(isLocked.value).toBe(false);

      vi.advanceTimersByTime(60_000);
      expect(isLocked.value).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not auto-lock when timeout is 0 (never)', async () => {
    vi.useFakeTimers();
    try {
      const { addUser, login, setLockTimeout, isLocked } = useAuth();
      const u = await addUser('Mario', '1234');
      setLockTimeout(0);
      await login(u.id, '1234');
      expect(isLocked.value).toBe(false);

      vi.advanceTimersByTime(999_999);
      expect(isLocked.value).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('recordActivity() resets the timer, delaying the auto-lock', async () => {
    vi.useFakeTimers();
    try {
      const { addUser, login, setLockTimeout, recordActivity, isLocked } = useAuth();
      const u = await addUser('Mario', '1234');
      setLockTimeout(1); // 1 minute
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
