import { ref, watch, onUnmounted } from 'vue';
import { useAppStore } from '../store/index.js';
import { getInstanceName, resolveStorageKeys } from '../store/persistence.js';
import { appConfig, KEYBOARD_POSITIONS } from '../utils/index.js';
import { isWakeLockSupported } from './useWakeLock.js';
import { getPwaDismissKey } from './usePwaInstall.js';
import { useAuth } from './useAuth.js';
import { saveSettingsToIDB, clearAllStateFromIDB, clearSyncQueueFromIDB } from '../store/idbPersistence.js';
import { clearDirectusConfigFromStorage } from './useDirectusClient.js';
/**
 * Shared composable for the Cassa and Sala settings modals.
 * Handles IndexedDB persistence (debounced), reset, and menu sync.
 *
 * @param {object} props  - Component props (must expose `modelValue: Boolean`)
 * @param {function} emit - Component emit function
 * @returns {{ store, settings, resetConfirmPending, syncMenu, confirmReset, wakeLockApiSupported }}
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

  async function confirmReset() {
    // Remove legacy localStorage entries synchronously
    try { window.localStorage.removeItem(_storageKey); } catch (_) { /* ignore */ }
    try { window.localStorage.removeItem(_settingsKey); } catch (_) { /* ignore */ }
    try {
      window.localStorage.removeItem(getPwaDismissKey());
    } catch (e) {
      console.warn('[Settings] Failed to remove PWA dismiss key during reset:', e);
    }
    // Clear Directus connection config so it is not reloaded after reload.
    try {
      clearDirectusConfigFromStorage();
    } catch (e) {
      console.warn('[Settings] Failed to clear Directus config during reset:', e);
    }
    // Await the IDB clear so all transactions commit before the page reloads.
    // (Fire-and-forget clears could be cancelled by the reload mid-transaction.)
    await clearAllStateFromIDB();
    // Clear sync_queue so stale push operations cannot be replayed after a
    // factory reset if the user re-enables Directus on a fresh start.
    await clearSyncQueueFromIDB();
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
    confirmReset,
    wakeLockApiSupported,
  };
}
