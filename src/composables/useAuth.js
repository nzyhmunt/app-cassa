import { ref, computed } from 'vue';
import { getInstanceName } from '../store/persistence.js';
import { appConfig } from '../utils/index.js';
import { hashPin, PIN_LENGTH } from '../utils/pinAuth.js';
import { newUUIDv7 } from '../store/storeUtils.js';
import {
  loadUsersFromIDB, saveUsersToIDB,
  loadAuthSessionFromIDB, saveAuthSessionToIDB,
  loadAuthSettingsFromIDB, saveAuthSettingsToIDB,
} from '../store/persistence/operations.js';

/**
 * The three app identifiers used throughout the auth system.
 * A user with `apps` containing all three has unrestricted access.
 */
export const ALL_APPS = ['cassa', 'sala', 'cucina'];

/**
 * Available auto-lock timeout options (in minutes).
 * 0 = never auto-lock.
 */
export const LOCK_TIMEOUT_OPTIONS = [
  { value: 0, label: 'Mai' },
  { value: 1, label: '1 minuto' },
  { value: 2, label: '2 minuti' },
  { value: 5, label: '5 minuti' },
  { value: 10, label: '10 minuti' },
  { value: 15, label: '15 minuti' },
  { value: 30, label: '30 minuti' },
];

// ── App detection ─────────────────────────────────────────────────────────────

/**
 * Detect which app is currently running from the page URL.
 * @returns {'cassa'|'sala'|'cucina'}
 */
function detectCurrentApp() {
  if (typeof window === 'undefined') return 'cassa';
  const p = window.location.pathname.toLowerCase();
  if (p.includes('sala')) return 'sala';
  if (p.includes('cucina')) return 'cucina';
  return 'cassa';
}

/**
 * Normalise an `apps` value: ensure it is a non-empty subset of ALL_APPS.
 * Falls back to a copy of ALL_APPS when the input is invalid or empty.
 * @param {any} apps
 * @returns {string[]}
 */
function normalizeUserApps(apps) {
  if (Array.isArray(apps) && apps.length > 0) return [...apps];
  return [...ALL_APPS];
}

// ── Module-level singleton ────────────────────────────────────────────────────

let _initialized = false;
/** Manual users persisted in IndexedDB (excludes appConfig users). */
const _users = ref(/** @type {Array} */ ([]));
const _currentUserId = ref(/** @type {string|null} */ (null));
const _isLocked = ref(true);
const _lockTimeoutMinutes = ref(5);
let _lockTimer = null;
/** The app running on this page, determined once at init. */
let _currentApp = 'cassa';
/**
 * In-memory hashes for appConfig static users.
 * Populated asynchronously after init. Plaintext PINs are never stored.
 */
const _configUserHashes = new Map();
/** Resolves when all appConfig user hashes are ready. */
let _configHashesReady = null;
const PIN_REGEX = new RegExp(`^\\d{${PIN_LENGTH}}$`);

/**
 * Version counter — incremented by every mutation to `_users`, `_currentUserId`,
 * or `_lockTimeoutMinutes`. Used by `_init()` to detect whether the IDB hydration
 * should be applied: if any mutation happened before the IDB load completes, the
 * in-memory state is authoritative and the IDB data is discarded for that init.
 * This prevents async IDB reads from overwriting synchronous mutations made while
 * the load was in-flight (race condition guard).
 */
let _mutationVersion = 0;

/**
 * Promise that resolves when the initial IDB load in `_init()` completes.
 * Tests can `await _waitForAuth()` to ensure IDB hydration has finished before
 * checking state.
 */
let _initPromise = null;

/**
 * Build the in-memory list of appConfig users (shape matches manual users,
 * but with `fromConfig: true` and no persisted PIN hash).
 */
function _buildConfigUsers() {
  return (appConfig.auth?.users ?? []).map((u) => ({
    id: u.id,
    name: u.name,
    apps: normalizeUserApps(u.apps),
    fromConfig: true,
    isAdmin: false,
    pin: null, // never stored — hashes are kept in _configUserHashes
  }));
}

/** Module-level computed: all users (config + manual). */
const _allUsers = computed(() => [..._buildConfigUsers(), ..._users.value]);

/** Module-level computed: users accessible for the current app. */
const _visibleUsers = computed(() =>
  _allUsers.value.filter((u) => u.apps.includes(_currentApp)),
);

function _init() {
  if (_initialized) return;
  _initialized = true;

  _currentApp = detectCurrentApp();

  // Capture the mutation version at init time.
  // If any mutation happens before IDB load completes, skip hydration.
  const capturedVersion = _mutationVersion;

  _initPromise = Promise.all([
    loadUsersFromIDB(),
    loadAuthSessionFromIDB(),
    loadAuthSettingsFromIDB(),
  ]).then(([users, savedUserId, savedSettings]) => {
    // Bail if the singleton was reset while the load was in-flight.
    // (_resetAuthSingleton sets _initialized = false; if we applied IDB data
    // after that, it would overwrite the clean state of the new singleton.)
    if (!_initialized) return;
    // Skip if any mutation (addUser, login, setLockTimeout, etc.) occurred
    // while the IDB load was in-flight. In that case the in-memory state is
    // already authoritative — applying stale IDB data would overwrite it.
    if (_mutationVersion !== capturedVersion) return;

    _users.value = users.filter(u =>
      u && u.id && u.name && u.pin,
    ).map(u => ({
      ...u,
      apps: normalizeUserApps(u.apps),
      isAdmin: u.isAdmin === true,
      fromConfig: false,
    }));

    _lockTimeoutMinutes.value = typeof savedSettings?.lockTimeoutMinutes === 'number'
      ? savedSettings.lockTimeoutMinutes
      : 5;

    const userExists = _allUsers.value.some((u) => u.id === savedUserId);
    _currentUserId.value = savedUserId && userExists ? savedUserId : null;
    _isLocked.value = true; // always re-lock on page load for security
  }).catch(e => console.warn('[Auth] Failed to load from IDB:', e));

  // Pre-hash appConfig PINs in memory (async, never persisted)
  const configs = appConfig.auth?.users ?? [];
  if (configs.length > 0) {
    _configHashesReady = Promise.all(
      configs.map(async (u) => {
        if (!PIN_REGEX.test(String(u.pin))) {
          console.warn(`[Auth] appConfig user "${u.id}" has an invalid PIN (must be exactly ${PIN_LENGTH} digits). Login will fail for this user.`);
        }
        const hash = await hashPin(String(u.pin));
        _configUserHashes.set(u.id, hash);
      }),
    );
  } else {
    _configHashesReady = Promise.resolve();
  }
}

/** (Re-)start the inactivity auto-lock countdown. */
function _resetLockTimer() {
  if (_lockTimer) {
    clearTimeout(_lockTimer);
    _lockTimer = null;
  }
  const minutes = _lockTimeoutMinutes.value;
  if (minutes <= 0 || _isLocked.value || _currentUserId.value == null) return;
  _lockTimer = setTimeout(() => {
    _isLocked.value = true;
    _lockTimer = null;
  }, minutes * 60 * 1000);
}

// ── Public composable ─────────────────────────────────────────────────────────

/**
 * Returns auth state and actions.
 * The underlying state is a module-level singleton — all callers on the same
 * page share the same reactive refs.
 */
export function useAuth() {
  _init();

  const currentUser = computed(
    () => _allUsers.value.find((u) => u.id === _currentUserId.value) ?? null,
  );

  /** True when logged in and not locked. */
  const isAuthenticated = computed(
    () => _currentUserId.value != null && !_isLocked.value,
  );

  /**
   * True when at least one user is configured for the current app.
   * When false the auth overlay is skipped entirely.
   */
  const requiresAuth = computed(() => _visibleUsers.value.length > 0);

  /** True when the current user has admin privileges. In open mode (no users configured) everyone has full access. */
  const isAdmin = computed(() => !requiresAuth.value || currentUser.value?.isAdmin === true);

  /** True when there is at least one manually-created admin user. */
  const hasAdmin = computed(() => _users.value.some((u) => u.isAdmin));

  // ── Actions ────────────────────────────────────────────────────────────────

  /**
   * Attempt to log in as `userId` with the given `pin`.
   * @returns {Promise<boolean>} true on success
   */
  async function login(userId, pin) {
    // Ensure appConfig hashes are ready before verifying
    if (_configHashesReady) await _configHashesReady;

    const hash = await hashPin(pin);

    // Check appConfig users
    const configUser = (appConfig.auth?.users ?? []).find((u) => u.id === userId);
    if (configUser) {
      const storedHash = _configUserHashes.get(userId);
      if (!storedHash || hash !== storedHash) return false;
      _mutationVersion++;
      _currentUserId.value = userId;
      _isLocked.value = false;
      saveAuthSessionToIDB(userId).catch(e => console.warn('[Auth] Failed to save session:', e));
      _resetLockTimer();
      return true;
    }

    // Check manual users
    const user = _users.value.find((u) => u.id === userId);
    if (!user) return false;
    if (user.pin !== hash) return false;
    _mutationVersion++;
    _currentUserId.value = userId;
    _isLocked.value = false;
    saveAuthSessionToIDB(userId).catch(e => console.warn('[Auth] Failed to save session:', e));
    _resetLockTimer();
    return true;
  }

  /** Lock the screen (keep the current user set). */
  function lock() {
    _isLocked.value = true;
    if (_lockTimer) {
      clearTimeout(_lockTimer);
      _lockTimer = null;
    }
  }

  /** Log out completely (clears current user). */
  function logout() {
    _mutationVersion++;
    _currentUserId.value = null;
    _isLocked.value = true;
    saveAuthSessionToIDB(null).catch(e => console.warn('[Auth] Failed to clear session:', e));
    if (_lockTimer) {
      clearTimeout(_lockTimer);
      _lockTimer = null;
    }
  }

  /**
   * Signal that the user has interacted with the UI.
   * Resets the auto-lock countdown.
   */
  function recordActivity() {
    if (!_isLocked.value && _currentUserId.value != null) {
      _resetLockTimer();
    }
  }

  // ── User management ────────────────────────────────────────────────────────

  /**
   * Create a new manual user account.
   * @param {string}   name - Display name
   * @param {string}   pin  - Numeric 4-digit PIN (hashed with SHA-256 before storage)
   * @param {string[]} [apps] - Apps this user can access; defaults to all three
   * @param {boolean}  [makeAdmin=false]
   * @returns {Promise<object>} The new user object
   */
  async function addUser(name, pin, apps = [...ALL_APPS], makeAdmin = false) {
    const id = newUUIDv7();
    const pinHash = await hashPin(pin);
    const isFirstManual = _users.value.length === 0;
    const adminFlag = isFirstManual || makeAdmin;
    const user = {
      id,
      name: name.trim(),
      pin: pinHash,
      apps: adminFlag ? [...ALL_APPS] : normalizeUserApps(apps),
      isAdmin: adminFlag,
      fromConfig: false,
    };
    _mutationVersion++;
    _users.value = [..._users.value, user];
    try {
      await saveUsersToIDB(_users.value);
    } catch (e) {
      console.warn('[Auth] Failed to save users:', e);
    }
    return user;
  }

  /**
   * Update an existing manual user.
   * @param {string} id      - User id
   * @param {object} updates - Partial user fields to update
   * @returns {Promise<void>}
   */
  async function updateUser(id, updates) {
    if ((appConfig.auth?.users ?? []).some((u) => u.id === id)) return;
    const resolved = { ...updates };
    if (resolved.pin != null) {
      resolved.pin = await hashPin(resolved.pin);
    }
    _mutationVersion++;
    _users.value = _users.value.map((u) =>
      u.id === id ? { ...u, ...resolved } : u,
    );
    try {
      await saveUsersToIDB(_users.value);
    } catch (e) {
      console.warn('[Auth] Failed to save users:', e);
    }
  }

  /**
   * Remove a manual user account.
   * @param {string} id - User id
   */
  function removeUser(id) {
    if ((appConfig.auth?.users ?? []).some((u) => u.id === id)) return;
    _mutationVersion++;
    _users.value = _users.value.filter((u) => u.id !== id);
    saveUsersToIDB(_users.value).catch(e => console.warn('[Auth] Failed to save users:', e));
    if (_currentUserId.value === id) {
      logout();
    }
  }

  /**
   * Set the inactivity auto-lock timeout.
   * @param {number} minutes - 0 = never
   * @returns {Promise<void>}
   */
  async function setLockTimeout(minutes) {
    _mutationVersion++;
    _lockTimeoutMinutes.value = minutes;
    try {
      await saveAuthSettingsToIDB({ lockTimeoutMinutes: minutes });
    } catch (e) {
      console.warn('[Auth] Failed to save auth settings:', e);
    }
    _resetLockTimer();
  }

  /**
   * Wipe all auth data from IndexedDB and reset in-memory state.
   * Called during "Ripristina dati di default".
   */
  function clearAllAuthData() {
    const defaultLockTimeoutMinutes = 5;
    const persistenceTargets = ['users', 'auth session', 'auth settings'];

    void Promise.allSettled([
      saveUsersToIDB([]),
      saveAuthSessionToIDB(null),
      saveAuthSettingsToIDB({ lockTimeoutMinutes: defaultLockTimeoutMinutes }),
    ]).then((results) => {
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.warn(`[Auth] Failed to clear ${persistenceTargets[index]} from IDB:`, result.reason);
        }
      });
    });

    _mutationVersion++;
    _users.value = [];
    _currentUserId.value = null;
    _isLocked.value = true;
    _lockTimeoutMinutes.value = defaultLockTimeoutMinutes;
    if (_lockTimer) {
      clearTimeout(_lockTimer);
      _lockTimer = null;
    }
  }

  return {
    /** Reactive list of all users (appConfig + manual). */
    users: _allUsers,
    /** Only manually-created users (editable). */
    manualUsers: computed(() => _users.value),
    /** Users accessible for the current app (used by LockScreen). */
    visibleUsers: _visibleUsers,
    /** The currently logged-in user (or null). */
    currentUser,
    /** True when logged in and not locked. */
    isAuthenticated,
    /** True when the lock screen is shown. */
    isLocked: computed(() => _isLocked.value),
    /** True when at least one user is configured for the current app. */
    requiresAuth,
    /** True when the current user has admin privileges. */
    isAdmin,
    /** True when at least one admin user exists among manual users. */
    hasAdmin,
    /** The detected app for this page ('cassa' | 'sala' | 'cucina'). */
    currentApp: computed(() => _currentApp),
    /** Current auto-lock timeout in minutes (0 = never). */
    lockTimeoutMinutes: computed(() => _lockTimeoutMinutes.value),
    login,
    lock,
    logout,
    recordActivity,
    addUser,
    updateUser,
    removeUser,
    setLockTimeout,
    clearAllAuthData,
    LOCK_TIMEOUT_OPTIONS,
    ALL_APPS,
  };
}

/**
 * Returns a Promise that resolves when the initial IDB hydration in `_init()`
 * has completed (or immediately if `_init()` has not been called yet).
 * For use in tests only — ensures IDB data is loaded before making assertions.
 * @internal
 */
export function _waitForAuth() {
  return _initPromise ?? Promise.resolve();
}

/**
 * Reset all module-level singleton state.
 * For use in tests only — not exported from the public API in production builds.
 * @internal
 */
export function _resetAuthSingleton() {
  _initialized = false;
  _users.value = [];
  _currentUserId.value = null;
  _isLocked.value = true;
  _lockTimeoutMinutes.value = 5;
  if (_lockTimer) { clearTimeout(_lockTimer); _lockTimer = null; }
  _currentApp = 'cassa';
  _configUserHashes.clear();
  _configHashesReady = null;
  _mutationVersion = 0;
  _initPromise = null;
}
