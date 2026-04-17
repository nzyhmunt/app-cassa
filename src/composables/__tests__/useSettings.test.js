import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, reactive, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { useSettings } from '../useSettings.js';
import { useAppStore } from '../../store/index.js';
import { resolveStorageKeys, resolveDirectusConfigKey } from '../../store/persistence.js';
import { getPwaDismissKey } from '../usePwaInstall.js';

// Mock the IDB persistence layer so tests stay synchronous and don't need
// a real IndexedDB environment for settings tests.
vi.mock('../../store/idbPersistence.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    saveSettingsToIDB: vi.fn().mockResolvedValue(undefined),
    clearAllStateFromIDB: vi.fn().mockResolvedValue(undefined),
    clearSyncQueueFromIDB: vi.fn().mockResolvedValue(undefined),
  };
});
import { saveSettingsToIDB, clearAllStateFromIDB, clearSyncQueueFromIDB } from '../../store/idbPersistence.js';

const { settingsKey: SETTINGS_KEY } = resolveStorageKeys();

// ---------------------------------------------------------------------------
// Helper: mount a component whose setup() calls the composable and exposes
// its return value.
// ---------------------------------------------------------------------------
function withSetup(composable) {
  let result;
  const TestComponent = defineComponent({
    setup() {
      result = composable();
      return {};
    },
    template: '<div></div>',
  });
  const wrapper = mount(TestComponent);
  return { result, wrapper };
}

describe('useSettings()', () => {
  let store;

  beforeEach(() => {
    // Ensure a clean and deterministic environment before the store is created.
    localStorage.clear();
    vi.useFakeTimers();
    // Stub fetch so store initialization cannot trigger real network requests.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    setActivePinia(createPinia());
    store = useAppStore();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── loadInitialSettings() ────────────────────────────────────────────────

  it('returns default settings when localStorage is empty', () => {
    const props = reactive({ modelValue: false });
    const emit = vi.fn();

    const { result, wrapper } = withSetup(() => useSettings(props, emit));

    expect(result.settings.value.sounds).toBe(true);
    expect(result.settings.value.preventScreenLock).toBe(true);
    expect(result.settings.value.customKeyboard).toBe('disabled');
    expect(typeof result.settings.value.menuUrl).toBe('string');
    wrapper.unmount();
  });

  it('loads all settings from the store when populated before mount', () => {
    // Mock Wake Lock API as supported so preventScreenLock:true is preserved
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request: vi.fn() },
      writable: true,
      configurable: true,
    });
    // Simulate initStoreFromIDB having already populated the store
    store.sounds = false;
    store.menuUrl = 'https://custom.example.com/menu.json';
    store.preventScreenLock = true;
    store.customKeyboard = 'center';

    const props = reactive({ modelValue: false });
    const emit = vi.fn();

    const { result, wrapper } = withSetup(() => useSettings(props, emit));

    expect(result.settings.value.sounds).toBe(false);
    expect(result.settings.value.menuUrl).toBe('https://custom.example.com/menu.json');
    expect(result.settings.value.preventScreenLock).toBe(true);
    expect(result.settings.value.customKeyboard).toBe('center');
    wrapper.unmount();
    delete navigator.wakeLock;
  });

  it('returns defaults when store has initial default values', () => {
    // Store starts with defaults (sounds=true, preventScreenLock=true)
    const props = reactive({ modelValue: false });
    const emit = vi.fn();

    const { result, wrapper } = withSetup(() => useSettings(props, emit));

    expect(result.settings.value.sounds).toBe(true);
    expect(result.settings.value.preventScreenLock).toBe(true);
    wrapper.unmount();
  });

  it('falls back to default menuUrl when store.menuUrl is an empty string', () => {
    store.menuUrl = '';

    const props = reactive({ modelValue: false });
    const emit = vi.fn();

    const { result, wrapper } = withSetup(() => useSettings(props, emit));

    // Should use appConfig.menuUrl, not the empty string
    expect(result.settings.value.menuUrl).not.toBe('');
    wrapper.unmount();
  });

  it('defaults sounds to true when store.sounds is not a boolean', () => {
    store.sounds = 'yes'; // non-boolean value

    const props = reactive({ modelValue: false });
    const emit = vi.fn();

    const { result, wrapper } = withSetup(() => useSettings(props, emit));

    expect(result.settings.value.sounds).toBe(true);
    wrapper.unmount();
  });

  // ── Settings watcher ─────────────────────────────────────────────────────

  it('updates store.menuUrl immediately when settings.menuUrl changes', async () => {
    const props = reactive({ modelValue: true });
    const emit = vi.fn();

    const { result, wrapper } = withSetup(() => useSettings(props, emit));

    result.settings.value.menuUrl = 'https://new-menu.example.com/menu.json';
    await nextTick();

    expect(store.menuUrl).toBe('https://new-menu.example.com/menu.json');
    wrapper.unmount();
  });

  it('updates store.preventScreenLock immediately when the setting changes', async () => {
    const props = reactive({ modelValue: true });
    const emit = vi.fn();

    const { result, wrapper } = withSetup(() => useSettings(props, emit));

    result.settings.value.preventScreenLock = true;
    await nextTick();

    expect(store.preventScreenLock).toBe(true);
    wrapper.unmount();
  });

  it('updates store.customKeyboard immediately when the setting changes', async () => {
    const props = reactive({ modelValue: true });
    const emit = vi.fn();

    const { result, wrapper } = withSetup(() => useSettings(props, emit));

    result.settings.value.customKeyboard = 'center';
    await nextTick();

    expect(store.customKeyboard).toBe('center');
    wrapper.unmount();
  });

  it('defaults customKeyboard to "disabled" when store.customKeyboard is not a valid position', () => {
    store.customKeyboard = 'yes'; // invalid value

    const props = reactive({ modelValue: false });
    const emit = vi.fn();

    const { result, wrapper } = withSetup(() => useSettings(props, emit));

    expect(result.settings.value.customKeyboard).toBe('disabled');
    wrapper.unmount();
  });

  it('emits "settings-changed" with the updated value when settings change', async () => {
    const props = reactive({ modelValue: true });
    const emit = vi.fn();

    const { result, wrapper } = withSetup(() => useSettings(props, emit));

    result.settings.value.sounds = false;
    await nextTick();

    expect(emit).toHaveBeenCalledWith(
      'settings-changed',
      expect.objectContaining({ sounds: false }),
    );
    wrapper.unmount();
  });

  it('debounces IDB writes — only persists after 400 ms', async () => {
    saveSettingsToIDB.mockClear();
    const props = reactive({ modelValue: true });
    const emit = vi.fn();

    const { result, wrapper } = withSetup(() => useSettings(props, emit));

    result.settings.value.sounds = false;
    await nextTick();

    // Not yet written (debounce has not fired)
    expect(saveSettingsToIDB).not.toHaveBeenCalledWith(expect.objectContaining({ sounds: false }));

    // Advance past the 400 ms debounce threshold
    vi.advanceTimersByTime(400);

    expect(saveSettingsToIDB).toHaveBeenCalledWith(expect.objectContaining({ sounds: false }));
    wrapper.unmount();
  });

  // ── Modal close watcher ──────────────────────────────────────────────────

  it('resets resetConfirmPending when the modal closes (modelValue → false)', async () => {
    const props = reactive({ modelValue: true });
    const emit = vi.fn();

    const { result, wrapper } = withSetup(() => useSettings(props, emit));
    result.resetConfirmPending.value = true;

    props.modelValue = false;
    await nextTick();

    expect(result.resetConfirmPending.value).toBe(false);
    wrapper.unmount();
  });

  it('flushes the pending IDB save immediately when the modal closes', async () => {
    saveSettingsToIDB.mockClear();
    const props = reactive({ modelValue: true });
    const emit = vi.fn();

    const { result, wrapper } = withSetup(() => useSettings(props, emit));

    result.settings.value.sounds = false;
    await nextTick();
    // Debounce has not fired yet
    expect(saveSettingsToIDB).not.toHaveBeenCalledWith(expect.objectContaining({ sounds: false }));

    // Closing the modal triggers an immediate save
    props.modelValue = false;
    await nextTick();

    expect(saveSettingsToIDB).toHaveBeenCalledWith(expect.objectContaining({ sounds: false }));
    wrapper.unmount();
  });

  it('persists settings to IDB on unmount', async () => {
    saveSettingsToIDB.mockClear();
    const props = reactive({ modelValue: true });
    const emit = vi.fn();

    const { result, wrapper } = withSetup(() => useSettings(props, emit));

    result.settings.value.sounds = false;
    await nextTick();

    // Debounce has not fired yet
    expect(saveSettingsToIDB).not.toHaveBeenCalledWith(expect.objectContaining({ sounds: false }));

    wrapper.unmount(); // onUnmounted fires persistSettings

    expect(saveSettingsToIDB).toHaveBeenCalledWith(expect.objectContaining({ sounds: false }));
  });

  // ── syncMenu() ───────────────────────────────────────────────────────────

  it('syncMenu() calls store.loadMenu()', async () => {
    const props = reactive({ modelValue: false });
    const emit = vi.fn();
    const mockLoadMenu = vi.fn().mockResolvedValue(undefined);
    store.loadMenu = mockLoadMenu;

    const { result, wrapper } = withSetup(() => useSettings(props, emit));

    await result.syncMenu();

    expect(mockLoadMenu).toHaveBeenCalled();
    wrapper.unmount();
  });

  // ── confirmReset() ───────────────────────────────────────────────────────

  it('confirmReset() clears storageKey and settingsKey from localStorage', () => {
    const { storageKey, settingsKey } = resolveStorageKeys('');
    localStorage.setItem(storageKey, JSON.stringify({ orders: [] }));
    localStorage.setItem(settingsKey, JSON.stringify({ sounds: false }));

    const props = reactive({ modelValue: false });
    const emit = vi.fn();

    // Stub window.location.reload to prevent errors in jsdom
    const reloadMock = vi.fn();
    const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
    const originalLocationValue = window.location;

    try {
      Object.defineProperty(window, 'location', {
        writable: true,
        configurable: true,
        value: { reload: reloadMock },
      });

      const { result, wrapper } = withSetup(() => useSettings(props, emit));

      result.confirmReset();

      // Reset ora agisce solo su IndexedDB; localStorage legacy non viene toccato.
      expect(localStorage.getItem(storageKey)).toBe(JSON.stringify({ orders: [] }));
      expect(localStorage.getItem(settingsKey)).toBe(JSON.stringify({ sounds: false }));
      wrapper.unmount();
    } finally {
      if (originalLocationDescriptor) {
        Object.defineProperty(window, 'location', originalLocationDescriptor);
      } else {
        window.location = originalLocationValue;
      }
    }
  });

  it('confirmReset() calls window.location.reload()', async () => {
    const reloadMock = vi.fn();
    const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
    const originalLocationValue = window.location;

    try {
      Object.defineProperty(window, 'location', {
        writable: true,
        configurable: true,
        value: { reload: reloadMock },
      });

      const props = reactive({ modelValue: false });
      const emit = vi.fn();

      const { result, wrapper } = withSetup(() => useSettings(props, emit));
      await result.confirmReset();

      expect(reloadMock).toHaveBeenCalled();
      wrapper.unmount();
    } finally {
      if (originalLocationDescriptor) {
        Object.defineProperty(window, 'location', originalLocationDescriptor);
      } else {
        window.location = originalLocationValue;
      }
    }
  });

  it('confirmReset() removes the directus-config key from localStorage', async () => {
    const reloadMock = vi.fn();
    const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
    const originalLocationValue = window.location;

    try {
      Object.defineProperty(window, 'location', {
        writable: true,
        configurable: true,
        value: { reload: reloadMock },
      });

      // Use resolveDirectusConfigKey() so the key matches the production code
      const configKey = resolveDirectusConfigKey();
      localStorage.setItem(configKey, JSON.stringify({
        enabled: true,
        url: 'https://directus.test',
        staticToken: 'test-token',
        venueId: 1,
        wsEnabled: false,
      }));

      const props = reactive({ modelValue: false });
      const emit = vi.fn();

      const { result, wrapper } = withSetup(() => useSettings(props, emit));
      await result.confirmReset();

      expect(localStorage.getItem(configKey)).toBeTruthy();
      wrapper.unmount();
    } finally {
      if (originalLocationDescriptor) {
        Object.defineProperty(window, 'location', originalLocationDescriptor);
      } else {
        window.location = originalLocationValue;
      }
    }
  });

  it('confirmReset() removes both the namespaced and legacy directus-config key when instanceName is set', async () => {
    const reloadMock = vi.fn();
    const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
    const originalLocationValue = window.location;
    const { appConfig } = await import('../../utils/index.js');
    const originalInstanceName = appConfig.instanceName;

    try {
      Object.defineProperty(window, 'location', {
        writable: true,
        configurable: true,
        value: { reload: reloadMock },
      });

      // Simulate a named instance (e.g. a second POS terminal)
      appConfig.instanceName = 'cassa2';
      const namespacedKey = resolveDirectusConfigKey();  // 'directus-config_cassa2'
      const legacyKey = 'directus-config';

      // Both keys present: namespaced (current) + legacy (pre-upgrade)
      localStorage.setItem(namespacedKey, JSON.stringify({ enabled: true, url: 'https://directus.test' }));
      localStorage.setItem(legacyKey, JSON.stringify({ enabled: true, url: 'https://directus.test' }));

      const props = reactive({ modelValue: false });
      const emit = vi.fn();

      const { result, wrapper } = withSetup(() => useSettings(props, emit));
      await result.confirmReset();

      expect(localStorage.getItem(namespacedKey)).toBeTruthy();
      expect(localStorage.getItem(legacyKey)).toBeTruthy();
      wrapper.unmount();
    } finally {
      appConfig.instanceName = originalInstanceName;
      if (originalLocationDescriptor) {
        Object.defineProperty(window, 'location', originalLocationDescriptor);
      } else {
        window.location = originalLocationValue;
      }
    }
  });

  it('confirmReset() removes the PWA dismiss key from localStorage', async () => {
    const reloadMock = vi.fn();
    const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
    const originalLocationValue = window.location;

    try {
      Object.defineProperty(window, 'location', {
        writable: true,
        configurable: true,
        value: { reload: reloadMock, pathname: '/' },
      });

      const pwaDismissKey = getPwaDismissKey();
      localStorage.setItem(pwaDismissKey, 'true');

      const props = reactive({ modelValue: false });
      const emit = vi.fn();

      const { result, wrapper } = withSetup(() => useSettings(props, emit));
      await result.confirmReset();

      expect(localStorage.getItem(pwaDismissKey)).toBe('true');
      wrapper.unmount();
    } finally {
      if (originalLocationDescriptor) {
        Object.defineProperty(window, 'location', originalLocationDescriptor);
      } else {
        window.location = originalLocationValue;
      }
    }
  });

  it('confirmReset() calls clearAllStateFromIDB() and clearSyncQueueFromIDB()', async () => {
    const reloadMock = vi.fn();
    const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
    const originalLocationValue = window.location;

    try {
      Object.defineProperty(window, 'location', {
        writable: true,
        configurable: true,
        value: { reload: reloadMock, pathname: '/' },
      });

      vi.mocked(clearAllStateFromIDB).mockClear();
      vi.mocked(clearSyncQueueFromIDB).mockClear();

      const props = reactive({ modelValue: false });
      const emit = vi.fn();

      const { result, wrapper } = withSetup(() => useSettings(props, emit));
      await result.confirmReset();

      expect(clearAllStateFromIDB).toHaveBeenCalledOnce();
      expect(clearSyncQueueFromIDB).toHaveBeenCalledOnce();
      wrapper.unmount();
    } finally {
      if (originalLocationDescriptor) {
        Object.defineProperty(window, 'location', originalLocationDescriptor);
      } else {
        window.location = originalLocationValue;
      }
    }
  });
});
