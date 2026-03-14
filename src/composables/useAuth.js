import { ref, computed } from 'vue';
import { getInstanceName } from '../store/persistence.js';

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
    return parsed.filter((u) => u && u.id && u.name && u.pin);
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
const _users = ref(/** @type {Array<{id:string,name:string,pin:string}>} */ ([]));
const _currentUserId = ref(/** @type {string|null} */ (null));
const _isLocked = ref(true);
const _lockTimeoutMinutes = ref(5);
let _lockTimer = null;
let _keys = null;

function _init() {
  if (_initialized) return;
  _initialized = true;

  _keys = resolveAuthKeys();

  _users.value = readUsers(_keys.usersKey);

  const savedSettings = readSettings(_keys.settingsKey);
  _lockTimeoutMinutes.value = savedSettings.lockTimeoutMinutes;

  const savedUserId = readSession(_keys.sessionKey);
  const userExists = _users.value.some((u) => u.id === savedUserId);

  if (savedUserId && userExists) {
    _currentUserId.value = savedUserId;
    // Always re-lock on page load for security
    _isLocked.value = true;
  } else {
    _currentUserId.value = null;
    _isLocked.value = true;
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
    () => _users.value.find((u) => u.id === _currentUserId.value) ?? null,
  );

  /** True when a user is logged in AND the screen is not locked. */
  const isAuthenticated = computed(
    () => _currentUserId.value != null && !_isLocked.value,
  );

  /**
   * True when at least one user account exists.
   * When false the auth overlay is skipped entirely.
   */
  const requiresAuth = computed(() => _users.value.length > 0);

  // ── Actions ────────────────────────────────────────────────────────────────

  /**
   * Attempt to log in as `userId` with the given `pin`.
   * @returns {Promise<boolean>} true on success
   */
  async function login(userId, pin) {
    const user = _users.value.find((u) => u.id === userId);
    if (!user) return false;
    const hash = await hashPin(pin);
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
   * Create a new user account.
   * @param {string} name - Display name
   * @param {string} pin  - Numeric PIN (hashed with SHA-256 before storage)
   * @returns {Promise<object>} The new user object
   */
  async function addUser(name, pin) {
    const id = crypto.randomUUID();
    const pinHash = await hashPin(pin);
    const user = { id, name: name.trim(), pin: pinHash };
    _users.value = [..._users.value, user];
    writeUsers(_keys.usersKey, _users.value);
    return user;
  }

  /**
   * Update an existing user.
   * If `updates.pin` is provided it is hashed before storage.
   * @param {string} id      - User id
   * @param {object} updates - Partial user fields to update
   * @returns {Promise<void>}
   */
  async function updateUser(id, updates) {
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
   * Remove a user account.
   * If the removed user is currently logged in they are also logged out.
   * @param {string} id - User id
   */
  function removeUser(id) {
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

  return {
    /** Reactive list of all user accounts. */
    users: computed(() => _users.value),
    /** The currently selected / logged-in user (or null). */
    currentUser,
    /** True when logged in and not locked. */
    isAuthenticated,
    /** True when the lock screen is shown. */
    isLocked: computed(() => _isLocked.value),
    /** True when at least one user account is configured. */
    requiresAuth,
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
    LOCK_TIMEOUT_OPTIONS,
  };
}
