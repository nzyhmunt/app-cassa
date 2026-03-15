import { ref, watch, onUnmounted } from 'vue';
import { useAppStore } from '../store/index.js';
import { getInstanceName, resolveStorageKeys, clearState } from '../store/persistence.js';
import { appConfig, KEYBOARD_POSITIONS } from '../utils/index.js';
import { isWakeLockSupported } from './useWakeLock.js';
import { getPwaDismissKey } from './usePwaInstall.js';

/**
 * Shared composable for the Cassa and Sala settings modals.
 * Handles localStorage persistence (debounced), reset, and menu sync.
 *
 * @param {object} props  - Component props (must expose `modelValue: Boolean`)
 * @param {function} emit - Component emit function
 * @returns {{ store, settings, resetConfirmPending, syncMenu, confirmReset, wakeLockApiSupported }}
 */
export function useSettings(props, emit) {
  const store = useAppStore();
  const wakeLockApiSupported = isWakeLockSupported();

  const _instanceName = getInstanceName();
  const { storageKey: _storageKey, settingsKey: SETTINGS_STORAGE_KEY } =
    resolveStorageKeys(_instanceName);

  /** Validate a stored keyboard value; return 'disabled' if unknown. */
  function _parseKeyboardPosition(v) {
    if (KEYBOARD_POSITIONS.includes(v)) return v;
    return 'disabled';
  }

  function loadInitialSettings() {
    if (typeof window === 'undefined') {
      return { sounds: true, menuUrl: appConfig.menuUrl, preventScreenLock: false, customKeyboard: 'disabled' };
    }
    try {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!raw) {
        return { sounds: true, menuUrl: appConfig.menuUrl, preventScreenLock: false, customKeyboard: 'disabled' };
      }
      const parsed = JSON.parse(raw);
      return {
        sounds: typeof parsed.sounds === 'boolean' ? parsed.sounds : true,
        menuUrl:
          typeof parsed.menuUrl === 'string' && parsed.menuUrl.trim() !== ''
            ? parsed.menuUrl
            : appConfig.menuUrl,
        preventScreenLock:
          typeof parsed.preventScreenLock === 'boolean' && wakeLockApiSupported
            ? parsed.preventScreenLock
            : false,
        customKeyboard: _parseKeyboardPosition(parsed.customKeyboard),
      };
    } catch {
      return { sounds: true, menuUrl: appConfig.menuUrl, preventScreenLock: false, customKeyboard: 'disabled' };
    }
  }

  const settings = ref(loadInitialSettings());
  const resetConfirmPending = ref(false);

  let saveTimer = null;

  function persistSettings(val) {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(val));
    } catch {
      // Ignore storage errors (e.g., quota exceeded or disabled storage)
    }
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
      store.menuUrl = newVal.menuUrl;
      store.preventScreenLock = newVal.preventScreenLock;
      store.customKeyboard = newVal.customKeyboard;
      emit('settings-changed', newVal);
      // Debounce localStorage writes to avoid per-keystroke I/O (e.g. menuUrl typing)
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

  function confirmReset() {
    clearState(_storageKey);
    try {
      window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
    } catch (e) {
      console.warn('[Settings] Failed to remove settings during reset:', e);
    }
    try {
      window.localStorage.removeItem(getPwaDismissKey());
    } catch (e) {
      console.warn('[Settings] Failed to remove PWA dismiss key during reset:', e);
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
