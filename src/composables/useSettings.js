import { ref, watch, onUnmounted } from 'vue';
import { useAppStore } from '../store/index.js';
import { appConfig, KEYBOARD_POSITIONS, DEFAULT_SETTINGS } from '../utils/index.js';
import { isWakeLockSupported } from './useWakeLock.js';
import { useAuth } from './useAuth.js';
import { saveSettingsToIDB, deleteDatabase } from '../store/persistence/operations.js';
import { clearDirectusConfigFromStorage } from './useDirectusClient.js';
import { getInstanceName } from '../store/persistence.js';
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
          : (store.config?.menuUrl ?? DEFAULT_SETTINGS.menuUrl),
      menuSource: store.menuSource === 'json' ? 'json' : 'directus',
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
      store.menuSource = newVal.menuSource === 'json' ? 'json' : 'directus';
      appConfig.menuUrl = store.menuUrl;
      appConfig.menuSource = store.menuSource;
      if (store.menuSource !== 'json') {
        store.menuError = null;
        store.menuLoading = false;
      }
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
    if (settings.value.menuSource !== 'json') return;
    await store.loadMenu();
  }

  async function confirmReset() {
    // Clear Directus connection config so it is not reloaded after reload.
    try {
      await clearDirectusConfigFromStorage();
    } catch (e) {
      console.warn('[Settings] Failed to clear Directus config during reset:', e);
    }
    // Nuclear reset: physically delete the entire IndexedDB database.
    // This guarantees a full clean slate for every object store.
    try {
      await deleteDatabase(getInstanceName());
    } catch (e) {
      console.warn('[Settings] Failed to complete nuclear database reset - data may not be fully cleared:', e);
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert('Reset blocked: close other tabs/apps open on this device and try again.');
      }
      return;
    }
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
