import { ref, watch, onUnmounted } from 'vue';
import { useAppStore } from '../store/index.js';
import { getInstanceName, resolveStorageKeys, resolveCustomItemsKey } from '../store/persistence.js';
import { appConfig, KEYBOARD_POSITIONS } from '../utils/index.js';
import { isWakeLockSupported } from './useWakeLock.js';
import { getPwaDismissKey } from './usePwaInstall.js';
import { useAuth } from './useAuth.js';
import { saveSettingsToIDB, clearAllStateFromIDB } from '../store/idbPersistence.js';
/**
 * Shared composable for the Cassa and Sala settings modals.
 * Handles IndexedDB persistence (debounced), reset, and menu sync.
 *
 * @param {object} props  - Component props (must expose `modelValue: Boolean`)
 * @param {function} emit - Component emit function
 * @returns {{ store, settings, resetConfirmPending, syncMenu, exportBackupData, initiateReset, confirmReset, wakeLockApiSupported }}
 */
export function useSettings(props, emit) {
  const store = useAppStore();
  const wakeLockApiSupported = isWakeLockSupported();

  const _instanceName = getInstanceName();
  const { storageKey: _storageKey, settingsKey: _settingsKey } = resolveStorageKeys(_instanceName);

  /** Validate a stored keyboard value; return 'disabled' if unknown. */
  function _parseKeyboardPosition(v) {
    if (KEYBOARD_POSITIONS.includes(v)) return v;
    return 'disabled';
  }

  // Build initial settings from the store (already populated by initStoreFromIDB before mount).
  function loadInitialSettings() {
    return {
      sounds: typeof store.sounds === 'boolean' ? store.sounds : true,
      menuUrl:
        typeof store.menuUrl === 'string' && store.menuUrl.trim() !== ''
          ? store.menuUrl
          : appConfig.menuUrl,
      preventScreenLock:
        typeof store.preventScreenLock === 'boolean' && wakeLockApiSupported
          ? store.preventScreenLock
          : true,
      customKeyboard: _parseKeyboardPosition(store.customKeyboard),
      preBillPrinterId: typeof store.preBillPrinterId === 'string' ? store.preBillPrinterId : '',
    };
  }

  const settings = ref(loadInitialSettings());
  const resetConfirmPending = ref(false);

  let saveTimer = null;

  function persistSettings(val) {
    saveSettingsToIDB(val).catch(e => console.warn('[Settings] Failed to save settings:', e));
  }

  // Flush pending save and reset confirm state when the modal closes
  watch(
    () => props.modelValue,
    (newVal) => {
      if (!newVal) {
        resetConfirmPending.value = false;
        clearTimeout(saveTimer);
        persistSettings(settings.value);
      }
    }
  );

  watch(
    settings,
    (newVal) => {
      // Keep store and parent in sync immediately for responsive UI
      store.sounds = newVal.sounds;
      store.menuUrl = newVal.menuUrl;
      store.preventScreenLock = newVal.preventScreenLock;
      store.customKeyboard = newVal.customKeyboard;
      store.preBillPrinterId = newVal.preBillPrinterId ?? '';
      emit('settings-changed', newVal);
      // Debounce IDB writes to avoid per-keystroke I/O (e.g. menuUrl typing)
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => persistSettings(newVal), 400);
    },
    { deep: true }
  );

  onUnmounted(() => {
    clearTimeout(saveTimer);
    persistSettings(settings.value);
  });

  async function syncMenu() {
    await store.loadMenu();
  }

  /**
   * Collects all app data from localStorage and triggers a JSON file download
   * as a safety backup before any destructive reset operation.
   */
  function exportBackupData() {
    if (typeof window === 'undefined') return;
    try {
      const now = new Date();
      const suffix = _instanceName ? `_${_instanceName}` : '';
      const backup = {
        exportedAt: now.toISOString(),
        instanceName: _instanceName || 'default',
        appState: null,
        settings: null,
        authUsers: null,
        authSettings: null,
        customItems: null,
      };

      try {
        const raw = window.localStorage.getItem(_storageKey);
        backup.appState = raw ? JSON.parse(raw) : null;
      } catch { /* ignore parse errors */ }

      try {
        const raw = window.localStorage.getItem(_settingsKey);
        backup.settings = raw ? JSON.parse(raw) : null;
      } catch { /* ignore parse errors */ }

      try {
        const raw = window.localStorage.getItem(`auth_users${suffix}`);
        backup.authUsers = raw ? JSON.parse(raw) : null;
      } catch { /* ignore parse errors */ }

      try {
        const raw = window.localStorage.getItem(`auth_settings${suffix}`);
        backup.authSettings = raw ? JSON.parse(raw) : null;
      } catch { /* ignore parse errors */ }

      try {
        const raw = window.localStorage.getItem(resolveCustomItemsKey(_instanceName));
        backup.customItems = raw ? JSON.parse(raw) : null;
      } catch { /* ignore parse errors */ }

      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup-cassa-${now.toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.warn('[Settings] Failed to export backup:', e);
    }
  }

  /**
   * Initiates the reset flow: automatically exports a backup and then shows
   * the confirmation UI. Should be called instead of setting resetConfirmPending
   * directly.
   */
  function initiateReset() {
    exportBackupData();
    resetConfirmPending.value = true;
  }

  async function confirmReset() {
    // Remove legacy localStorage entries synchronously
    try { window.localStorage.removeItem(_storageKey); } catch (_) { /* ignore */ }
    try { window.localStorage.removeItem(_settingsKey); } catch (_) { /* ignore */ }
    try {
      window.localStorage.removeItem(getPwaDismissKey());
    } catch (e) {
      console.warn('[Settings] Failed to remove PWA dismiss key during reset:', e);
    }
    // Await the IDB clear so all transactions commit before the page reloads.
    // (Fire-and-forget clears could be cancelled by the reload mid-transaction.)
    await clearAllStateFromIDB();
    // Clear in-memory auth state (its internal IDB call is harmless — already cleared)
    try {
      const { clearAllAuthData } = useAuth();
      clearAllAuthData();
    } catch (e) {
      console.warn('[Settings] Failed to clear auth data during reset:', e);
    }
    if (typeof window !== 'undefined' && window.location) {
      window.location.reload();
    }
  }

  return {
    store,
    settings,
    resetConfirmPending,
    syncMenu,
    exportBackupData,
    initiateReset,
    confirmReset,
    wakeLockApiSupported,
  };
}
