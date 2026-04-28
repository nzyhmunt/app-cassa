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
    // Proactively clear operational IDB state before the physical database delete.
    // deleteDatabase() uses an onblocked handler that resolves after a 3-second
    // timeout when another connection (e.g. an in-flight WebSocket write or
    // polling timer) is holding the DB open. In that case the physical delete
    // silently does NOT happen, so app_meta (including lastPullTs cursors) and
    // other stores can survive the reload.
    // Calling clearAllStateFromIDB() first reduces leftover app data in that
    // blocked-delete case, but it is still best-effort and does not remove every store.
    try {
      await clearAllStateFromIDB();
    } catch (e) {
      console.warn('[Settings] Failed to pre-clear IDB stores during reset:', e);
    }
    // Nuclear reset: physically delete the entire IndexedDB database.
    // Only a successful delete clears every object store.
    try {
      await deleteDatabase(getInstanceName());
    } catch (e) {
      // The physical delete may be blocked by another open connection (e.g. a
      // concurrent WebSocket write or polling timer). We already attempted to
      // clear operational IDB state above, so continue with SW cleanup and reload,
      // but some data (for example local_settings or any store not cleared above)
      // may still remain until the database can be deleted successfully.
      console.warn('[Settings] Failed to complete nuclear database reset - data may not be fully cleared:', e);
    }
    // Clear in-memory auth state (its internal IDB call is harmless — already cleared)
    try {
      const { clearAllAuthData } = useAuth();
      clearAllAuthData();
    } catch (e) {
      console.warn('[Settings] Failed to clear auth data during reset:', e);
    }
    // Unregister all service workers and purge all browser caches so that the
    // next load fetches the latest deployed code from the network, rather than
    // serving stale JS/CSS assets from the SW's cache-first asset cache.
    // This prevents the "interface changes not applied after reset" issue that
    // occurs when a new build has been deployed but the SW still holds old
    // assets under the same cache-version key.
    try {
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((r) => r.unregister()));
      }
    } catch (e) {
      console.warn('[Settings] Failed to unregister service workers during reset:', e);
    }
    try {
      if (typeof caches !== 'undefined') {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
    } catch (e) {
      console.warn('[Settings] Failed to clear browser caches during reset:', e);
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
