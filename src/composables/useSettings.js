import { ref, watch, onUnmounted } from 'vue';
import { useConfigStore } from '../store/index.js';
import { KEYBOARD_POSITIONS, DEFAULT_SETTINGS } from '../utils/index.js';
import { isWakeLockSupported } from './useWakeLock.js';
import { useAuth } from './useAuth.js';
import { deleteDatabase, clearAllStateFromIDB } from '../store/persistence/operations.js';
import { clearDirectusConfigFromStorage } from './useDirectusClient.js';
import { getInstanceName } from '../store/persistence.js';
/**
 * Shared composable for the Cassa and Sala settings modals.
 * Handles IndexedDB persistence (debounced), reset, and menu sync.
 *
 * @param {object} props  - Component props (must expose `modelValue: Boolean`)
 * @param {function} emit - Component emit function
 * @returns {{ configStore, settings, resetConfirmPending, syncMenu, confirmReset, wakeLockApiSupported }}
 */
export function useSettings(props, emit) {
  const configStore = useConfigStore();
  const wakeLockApiSupported = isWakeLockSupported();

  /** Validate a stored keyboard value; return 'disabled' if unknown. */
  function _parseKeyboardPosition(v) {
    if (KEYBOARD_POSITIONS.includes(v)) return v;
    return 'disabled';
  }

  // Build initial settings from the store (already populated by initStoreFromIDB before mount).
  function loadInitialSettings() {
    return {
      sounds: typeof configStore.sounds === 'boolean' ? configStore.sounds : true,
      menuUrl:
        typeof configStore.menuUrl === 'string' && configStore.menuUrl.trim() !== ''
          ? configStore.menuUrl
          : (configStore.config?.menuUrl ?? DEFAULT_SETTINGS.menuUrl),
      menuSource: configStore.menuSource === 'json' ? 'json' : 'directus',
      preventScreenLock:
        typeof configStore.preventScreenLock === 'boolean' && wakeLockApiSupported
          ? configStore.preventScreenLock
          : true,
      customKeyboard: _parseKeyboardPosition(configStore.customKeyboard),
      preBillPrinterId: typeof configStore.preBillPrinterId === 'string' ? configStore.preBillPrinterId : '',
    };
  }

  const settings = ref(loadInitialSettings());
  const resetConfirmPending = ref(false);

  let saveTimer = null;

  function persistSettings(val) {
    configStore.saveLocalSettings(val).catch(e => console.warn('[Settings] Failed to save settings:', e));
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
      configStore.applyLocalSettings(newVal);
      if (configStore.menuSource !== 'json') {
        configStore.menuError = null;
        configStore.menuLoading = false;
      }
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
    await configStore.loadMenu();
  }

  async function confirmReset() {
    // Clear Directus connection config so it is not reloaded after reload.
    try {
      await clearDirectusConfigFromStorage();
    } catch (e) {
      console.warn('[Settings] Failed to clear Directus config during reset:', e);
    }
    // Proactively wipe all IDB stores before the physical database delete.
    // deleteDatabase() uses an onblocked handler that resolves after a 3-second
    // timeout when another connection (e.g. an in-flight WebSocket write or
    // polling timer) is holding the DB open. In that case the physical delete
    // silently does NOT happen, so app_meta (including lastPullTs cursors) and
    // all operational stores (orders, bill_sessions …) survive the reload.
    // Calling clearAllStateFromIDB() first guarantees a clean slate regardless
    // of whether the subsequent physical delete succeeds.
    try {
      await clearAllStateFromIDB();
    } catch (e) {
      console.warn('[Settings] Failed to pre-clear IDB stores during reset:', e);
    }
    // Nuclear reset: physically delete the entire IndexedDB database.
    // This guarantees a full clean slate for every object store.
    try {
      await deleteDatabase(getInstanceName());
    } catch (e) {
      console.warn('[Settings] Failed to complete nuclear database reset - data may not be fully cleared:', e);
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert('Reset bloccato: chiudi le altre schede/app aperte su questo dispositivo e riprova.');
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
    configStore,
    settings,
    resetConfirmPending,
    syncMenu,
    confirmReset,
    wakeLockApiSupported,
  };
}
