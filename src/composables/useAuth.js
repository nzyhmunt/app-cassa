import { ref, computed } from 'vue';
import { getInstanceName } from '../store/persistence.js';
import { appConfig } from '../utils/index.js';

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

// ── PIN hashing ───────────────────────────────────────────────────────────────

/**
 * Returns a SHA-256 hex digest of the given PIN string.
 * PINs are hashed before storage so plaintext PINs never persist.
 * @param {string} pin
 * @returns {Promise<string>}
 */
async function hashPin(pin) {
  const data = new TextEncoder().encode(String(pin));
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── App detection ─────────────────────────────────────────────────────────────

/**
 * Detect which app is currently running from the page URL.
 * Since each app is served from a separate HTML file, the pathname
 * reliably identifies it.
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

// ── Key helpers ─────────────────────────────────────────────────────────────

function resolveAuthKeys(instanceName) {
  const n = instanceName ?? getInstanceName();
  const suffix = n ? `_${n}` : '';
  return {
    usersKey: `auth_users${suffix}`,
    sessionKey: `auth_session${suffix}`,
    settingsKey: `auth_settings${suffix}`,
  };
}

// ── localStorage helpers ─────────────────────────────────────────────────────

function readUsers(usersKey) {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(usersKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((u) => u && u.id && u.name && u.pin)
      .map((u) => ({
        ...u,
        apps: normalizeUserApps(u.apps),
        isAdmin: u.isAdmin === true,
        fromConfig: false,
      }));
  } catch {
    return [];
  }
}

function writeUsers(usersKey, users) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(usersKey, JSON.stringify(users));
  } catch {
    // Ignore quota / disabled-storage errors
  }
}

function readSession(sessionKey) {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(sessionKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.userId ?? null;
  } catch {
    return null;
  }
}

function writeSession(sessionKey, userId) {
  if (typeof localStorage === 'undefined') return;
  try {
    if (userId == null) {
      localStorage.removeItem(sessionKey);
    } else {
      localStorage.setItem(sessionKey, JSON.stringify({ userId }));
    }
  } catch {
    // Ignore
  }
}

function readSettings(settingsKey) {
  if (typeof localStorage === 'undefined') return { lockTimeoutMinutes: 5 };
  try {
    const raw = localStorage.getItem(settingsKey);
    if (!raw) return { lockTimeoutMinutes: 5 };
    const parsed = JSON.parse(raw);
    return {
      lockTimeoutMinutes:
        typeof parsed.lockTimeoutMinutes === 'number' ? parsed.lockTimeoutMinutes : 5,
    };
  } catch {
    return { lockTimeoutMinutes: 5 };
  }
}

function writeSettings(settingsKey, settings) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(settingsKey, JSON.stringify(settings));
  } catch {
    // Ignore
  }
}

// ── Module-level singleton ────────────────────────────────────────────────────
// Each app page (cassa / sala / cucina) is a separate HTML document, so one
// singleton per page is the correct scope.

let _initialized = false;
/** Manual users persisted in localStorage (excludes appConfig users). */
const _users = ref(/** @type {Array} */ ([]));
const _currentUserId = ref(/** @type {string|null} */ (null));
const _isLocked = ref(true);
const _lockTimeoutMinutes = ref(5);
let _lockTimer = null;
let _keys = null;
/** The app running on this page, determined once at init. */
let _currentApp = 'cassa';
/**
 * In-memory hashes for appConfig static users.
 * Populated asynchronously after init. Plaintext PINs are never stored.
 */
const _configUserHashes = new Map();
/** Resolves when all appConfig user hashes are ready. */
let _configHashesReady = null;

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
  _keys = resolveAuthKeys();

  _users.value = readUsers(_keys.usersKey);

  const savedSettings = readSettings(_keys.settingsKey);
  _lockTimeoutMinutes.value = savedSettings.lockTimeoutMinutes;

  // Restore session (always re-lock on page load for security)
  const savedUserId = readSession(_keys.sessionKey);
  const userExists = _allUsers.value.some((u) => u.id === savedUserId);
  _currentUserId.value = savedUserId && userExists ? savedUserId : null;
  _isLocked.value = true;

  // Pre-hash appConfig PINs in memory (async, never persisted)
  const configs = appConfig.auth?.users ?? [];
  if (configs.length > 0) {
    _configHashesReady = Promise.all(
      configs.map(async (u) => {
        if (!/^\d{4}$/.test(String(u.pin))) {
          console.warn(`[Auth] appConfig user "${u.id}" has an invalid PIN (must be exactly 4 digits). Login will fail for this user.`);
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

  /** True when the current user has admin privileges. */
  const isAdmin = computed(() => currentUser.value?.isAdmin === true);

  /** True when there is at least one manually-created admin user. */
  const hasAdmin = computed(() => _users.value.some((u) => u.isAdmin));

  // ── Actions ────────────────────────────────────────────────────────────────

  /**
   * Attempt to log in as `userId` with the given `pin`.
   * Handles both appConfig users (PIN verified against in-memory hash) and
   * manual users (PIN verified against localStorage hash).
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
      _currentUserId.value = userId;
      _isLocked.value = false;
      writeSession(_keys.sessionKey, userId);
      _resetLockTimer();
      return true;
    }

    // Check manual users
    const user = _users.value.find((u) => u.id === userId);
    if (!user) return false;
    if (user.pin !== hash) return false;
    _currentUserId.value = userId;
    _isLocked.value = false;
    writeSession(_keys.sessionKey, userId);
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
    _currentUserId.value = null;
    _isLocked.value = true;
    writeSession(_keys.sessionKey, null);
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
   * The first manual user added automatically receives admin privileges.
   * @param {string}   name - Display name
   * @param {string}   pin  - Numeric 4-digit PIN (hashed with SHA-256 before storage)
   * @param {string[]} [apps] - Apps this user can access; defaults to all three
   * @returns {Promise<object>} The new user object
   */
  async function addUser(name, pin, apps = [...ALL_APPS], makeAdmin = false) {
    const id = crypto.randomUUID();
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
    _users.value = [..._users.value, user];
    writeUsers(_keys.usersKey, _users.value);
    return user;
  }

  /**
   * Update an existing manual user.
   * If `updates.pin` is provided it is hashed before storage.
   * Cannot update appConfig users (no-op for those).
   * @param {string} id      - User id
   * @param {object} updates - Partial user fields to update
   * @returns {Promise<void>}
   */
  async function updateUser(id, updates) {
    // Block editing of appConfig users
    if ((appConfig.auth?.users ?? []).some((u) => u.id === id)) return;
    const resolved = { ...updates };
    if (resolved.pin != null) {
      resolved.pin = await hashPin(resolved.pin);
    }
    _users.value = _users.value.map((u) =>
      u.id === id ? { ...u, ...resolved } : u,
    );
    writeUsers(_keys.usersKey, _users.value);
  }

  /**
   * Remove a manual user account.
   * If the removed user is currently logged in they are also logged out.
   * Cannot remove appConfig users (no-op for those).
   * @param {string} id - User id
   */
  function removeUser(id) {
    // Block deleting appConfig users
    if ((appConfig.auth?.users ?? []).some((u) => u.id === id)) return;
    _users.value = _users.value.filter((u) => u.id !== id);
    writeUsers(_keys.usersKey, _users.value);
    if (_currentUserId.value === id) {
      logout();
    }
  }

  /**
   * Set the inactivity auto-lock timeout.
   * @param {number} minutes - 0 = never
   */
  function setLockTimeout(minutes) {
    _lockTimeoutMinutes.value = minutes;
    writeSettings(_keys.settingsKey, { lockTimeoutMinutes: minutes });
    _resetLockTimer();
  }

  /**
   * Wipe all auth data from localStorage and reset in-memory state.
   * Called during "Ripristina dati di default".
   */
  function clearAllAuthData() {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(_keys.usersKey);
        localStorage.removeItem(_keys.sessionKey);
        localStorage.removeItem(_keys.settingsKey);
      } catch {
        // Ignore
      }
    }
    _users.value = [];
    _currentUserId.value = null;
    _isLocked.value = true;
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
  _keys = null;
  _currentApp = 'cassa';
  _configUserHashes.clear();
  _configHashesReady = null;
}
