import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, reactive, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { useSettings } from '../useSettings.js';
import { saveDirectusConfigToStorage } from '../useDirectusClient.js';
import { useAppStore } from '../../store/index.js';
import { resolveStorageKeys, getInstanceName } from '../../store/persistence.js';
import { getPwaDismissKey } from '../usePwaInstall.js';
import { appConfig } from '../../utils/index.js';

vi.mock('../useDirectusClient.js', () => ({
  clearDirectusConfigFromStorage: vi.fn().mockResolvedValue(undefined),
  saveDirectusConfigToStorage: vi.fn().mockResolvedValue(undefined),
}));

// Mock the IDB persistence layer so tests stay synchronous and don't need
// a real IndexedDB environment for settings tests.
vi.mock('../../store/persistence/operations.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    saveSettingsToIDB: vi.fn().mockResolvedValue(undefined),
    deleteDatabase: vi.fn().mockResolvedValue(undefined),
    clearAllStateFromIDB: vi.fn().mockResolvedValue(undefined),
  };
});
import { saveSettingsToIDB, deleteDatabase, clearAllStateFromIDB } from '../../store/persistence/operations.js';

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
    store.menuSource = 'json';
    store.preventScreenLock = true;
    store.customKeyboard = 'center';

    const props = reactive({ modelValue: false });
    const emit = vi.fn();

    const { result, wrapper } = withSetup(() => useSettings(props, emit));

    expect(result.settings.value.sounds).toBe(false);
    expect(result.settings.value.menuUrl).toBe('https://custom.example.com/menu.json');
    expect(result.settings.value.menuSource).toBe('json');
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
    const originalMenuUrl = appConfig.menuUrl;

    try {
      const { result, wrapper } = withSetup(() => useSettings(props, emit));

      result.settings.value.menuUrl = 'https://new-menu.example.com/menu.json';
      await nextTick();

      expect(store.menuUrl).toBe('https://new-menu.example.com/menu.json');
      // appConfig is not mutated by saveLocalSettings (IDB-first: only hydrateConfigFromIDB writes to appConfig)
      expect(appConfig.menuUrl).toBe(originalMenuUrl);
      wrapper.unmount();
    } finally {
      appConfig.menuUrl = originalMenuUrl;
    }
  });

  it('updates store.menuSource immediately when the setting changes', async () => {
    const props = reactive({ modelValue: true });
    const emit = vi.fn();
    const originalMenuSource = appConfig.menuSource;

    try {
      const { result, wrapper } = withSetup(() => useSettings(props, emit));

      result.settings.value.menuSource = 'json';
      await nextTick();
      expect(store.menuSource).toBe('json');
      // appConfig is not mutated by saveLocalSettings (IDB-first: only hydrateConfigFromIDB writes to appConfig)
      expect(appConfig.menuSource).toBe(originalMenuSource);
      wrapper.unmount();
    } finally {
      appConfig.menuSource = originalMenuSource;
    }
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

  it('normalizes local settings through store.applyLocalSettings()', () => {
    store.menuSource = 'directus';
    store.menuUrl = 'https://initial.example.com/menu.json';
    store.applyLocalSettings({
      menuSource: 'invalid-source',
      menuUrl: '',
      customKeyboard: 'not-valid',
      sounds: false,
      preventScreenLock: false,
      preBillPrinterId: 123,
    });

    expect(store.menuSource).toBe('directus');
    expect(typeof store.menuUrl).toBe('string');
    expect(store.menuUrl.length).toBeGreaterThan(0);
    expect(store.customKeyboard).toBe('disabled');
    expect(store.sounds).toBe(false);
    expect(store.preventScreenLock).toBe(false);
    expect(store.preBillPrinterId).toBe('');
  });

  it('falls back menuSource to default when both payload and current are invalid', () => {
    store.menuSource = 'invalid-current';
    store.applyLocalSettings({ menuSource: 'invalid-next' });
    expect(store.menuSource).toBe('directus');
  });

  it('persists directus settings through store.saveDirectusSettings()', async () => {
    vi.mocked(saveDirectusConfigToStorage).mockClear();

    await store.saveDirectusSettings({
      enabled: true,
      url: 'https://directus.example.com',
      staticToken: 'tok_test',
      venueId: 7,
      wsEnabled: true,
    });

    expect(saveDirectusConfigToStorage).toHaveBeenCalledTimes(1);
    expect(appConfig.directus).toEqual({
      enabled: true,
      url: 'https://directus.example.com',
      staticToken: 'tok_test',
      venueId: 7,
      wsEnabled: true,
    });
    expect(store.config.directus).toEqual(expect.objectContaining({
      enabled: true,
      url: 'https://directus.example.com',
      staticToken: 'tok_test',
      venueId: 7,
      wsEnabled: true,
    }));
  });

  it('applies directus settings to runtime config without persisting when using applyDirectusSettings()', () => {
    vi.mocked(saveDirectusConfigToStorage).mockClear();

    const normalized = store.applyDirectusSettings({
      enabled: true,
      url: 'https://directus.runtime.example.com',
      staticToken: 'tok_runtime',
      venueId: 9,
      wsEnabled: false,
    });

    expect(saveDirectusConfigToStorage).not.toHaveBeenCalled();
    expect(normalized).toEqual(expect.objectContaining({
      enabled: true,
      url: 'https://directus.runtime.example.com',
      staticToken: 'tok_runtime',
      venueId: 9,
      wsEnabled: false,
    }));
    expect(store.config.directus).toEqual(expect.objectContaining({
      enabled: true,
      url: 'https://directus.runtime.example.com',
      staticToken: 'tok_runtime',
      venueId: 9,
      wsEnabled: false,
    }));
    expect(appConfig.directus).toEqual(expect.objectContaining({
      enabled: true,
      url: 'https://directus.runtime.example.com',
      staticToken: 'tok_runtime',
      venueId: 9,
      wsEnabled: false,
    }));
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

    result.settings.value.menuSource = 'json';
    await result.syncMenu();

    expect(mockLoadMenu).toHaveBeenCalled();
    wrapper.unmount();
  });

  it('syncMenu() is skipped when menu source is directus', async () => {
    const props = reactive({ modelValue: false });
    const emit = vi.fn();
    const mockLoadMenu = vi.fn().mockResolvedValue(undefined);
    store.loadMenu = mockLoadMenu;

    const { result, wrapper } = withSetup(() => useSettings(props, emit));
    result.settings.value.menuSource = 'directus';
    await result.syncMenu();

    expect(mockLoadMenu).not.toHaveBeenCalled();
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

  it('confirmReset() preserves the PWA dismiss key in localStorage', async () => {
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

  it('confirmReset() calls deleteDatabase() with current instance name', async () => {
    const reloadMock = vi.fn();
    const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
    const originalLocationValue = window.location;

    try {
      Object.defineProperty(window, 'location', {
        writable: true,
        configurable: true,
        value: { reload: reloadMock, pathname: '/' },
      });

      vi.mocked(deleteDatabase).mockClear();

      const props = reactive({ modelValue: false });
      const emit = vi.fn();

      const { result, wrapper } = withSetup(() => useSettings(props, emit));
      await result.confirmReset();

      expect(deleteDatabase).toHaveBeenCalledWith(getInstanceName());
      wrapper.unmount();
    } finally {
      if (originalLocationDescriptor) {
        Object.defineProperty(window, 'location', originalLocationDescriptor);
      } else {
        window.location = originalLocationValue;
      }
    }
  });

  it('confirmReset() calls clearAllStateFromIDB() before deleteDatabase() to guarantee a clean slate even when physical delete is blocked', async () => {
    const reloadMock = vi.fn();
    const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
    const originalLocationValue = window.location;

    try {
      Object.defineProperty(window, 'location', {
        writable: true,
        configurable: true,
        value: { reload: reloadMock, pathname: '/' },
      });

      const callOrder = [];
      vi.mocked(clearAllStateFromIDB).mockImplementation(async () => { callOrder.push('clearAllStateFromIDB'); });
      vi.mocked(deleteDatabase).mockImplementation(async () => { callOrder.push('deleteDatabase'); });

      const props = reactive({ modelValue: false });
      const emit = vi.fn();

      const { result, wrapper } = withSetup(() => useSettings(props, emit));
      await result.confirmReset();

      expect(clearAllStateFromIDB).toHaveBeenCalled();
      expect(deleteDatabase).toHaveBeenCalled();
      // clearAllStateFromIDB must run before deleteDatabase so that all IDB data
      // is wiped even when the physical delete is silently blocked (onblocked timeout).
      expect(callOrder.indexOf('clearAllStateFromIDB')).toBeLessThan(callOrder.indexOf('deleteDatabase'));
      wrapper.unmount();
    } finally {
      vi.mocked(clearAllStateFromIDB).mockResolvedValue(undefined);
      vi.mocked(deleteDatabase).mockResolvedValue(undefined);
      if (originalLocationDescriptor) {
        Object.defineProperty(window, 'location', originalLocationDescriptor);
      } else {
        window.location = originalLocationValue;
      }
    }
  });

  it('confirmReset() still calls deleteDatabase() and reloads even when clearAllStateFromIDB() fails', async () => {
    const reloadMock = vi.fn();
    const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
    const originalLocationValue = window.location;

    try {
      Object.defineProperty(window, 'location', {
        writable: true,
        configurable: true,
        value: { reload: reloadMock, pathname: '/' },
      });

      vi.mocked(clearAllStateFromIDB).mockRejectedValueOnce(new Error('IDB unavailable'));
      vi.mocked(deleteDatabase).mockClear();

      const props = reactive({ modelValue: false });
      const emit = vi.fn();

      const { result, wrapper } = withSetup(() => useSettings(props, emit));
      await result.confirmReset();

      // deleteDatabase and reload must still be called even if clearAllStateFromIDB fails
      expect(deleteDatabase).toHaveBeenCalledWith(getInstanceName());
      expect(reloadMock).toHaveBeenCalled();
      wrapper.unmount();
    } finally {
      vi.mocked(clearAllStateFromIDB).mockResolvedValue(undefined);
      if (originalLocationDescriptor) {
        Object.defineProperty(window, 'location', originalLocationDescriptor);
      } else {
        window.location = originalLocationValue;
      }
    }
  });

  it('confirmReset() does not recreate local settings after deleting IndexedDB', async () => {
    const reloadMock = vi.fn();
    const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
    const originalLocationValue = window.location;

    try {
      Object.defineProperty(window, 'location', {
        writable: true,
        configurable: true,
        value: { reload: reloadMock, pathname: '/' },
      });

      vi.mocked(saveSettingsToIDB).mockClear();

      const props = reactive({ modelValue: false });
      const emit = vi.fn();

      const { result, wrapper } = withSetup(() => useSettings(props, emit));
      await result.confirmReset();

      expect(saveSettingsToIDB).not.toHaveBeenCalled();
      wrapper.unmount();
    } finally {
      if (originalLocationDescriptor) {
        Object.defineProperty(window, 'location', originalLocationDescriptor);
      } else {
        window.location = originalLocationValue;
      }
    }
  });

  it('confirmReset() does not reload when deleteDatabase() is blocked and shows actionable alert', async () => {
    const reloadMock = vi.fn();
    const alertMock = vi.fn();
    const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
    const originalAlert = window.alert;
    const originalLocationValue = window.location;

    try {
      Object.defineProperty(window, 'location', {
        writable: true,
        configurable: true,
        value: { reload: reloadMock, pathname: '/' },
      });
      window.alert = alertMock;
      vi.mocked(deleteDatabase).mockRejectedValueOnce(new Error('Database deletion blocked'));

      const props = reactive({ modelValue: false });
      const emit = vi.fn();

      const { result, wrapper } = withSetup(() => useSettings(props, emit));
      await result.confirmReset();

      expect(alertMock).toHaveBeenCalled();
      expect(reloadMock).not.toHaveBeenCalled();
      wrapper.unmount();
    } finally {
      window.alert = originalAlert;
      if (originalLocationDescriptor) {
        Object.defineProperty(window, 'location', originalLocationDescriptor);
      } else {
        window.location = originalLocationValue;
      }
    }
  });

  it('confirmReset() unregisters all service workers before reload', async () => {
    const reloadMock = vi.fn();
    const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
    const originalLocationValue = window.location;
    const unregisterMock = vi.fn().mockResolvedValue(true);
    const originalServiceWorker = navigator.serviceWorker;

    try {
      Object.defineProperty(window, 'location', {
        writable: true,
        configurable: true,
        value: { reload: reloadMock, pathname: '/' },
      });
      Object.defineProperty(navigator, 'serviceWorker', {
        writable: true,
        configurable: true,
        value: {
          getRegistrations: vi.fn().mockResolvedValue([{ unregister: unregisterMock }, { unregister: unregisterMock }]),
        },
      });

      const props = reactive({ modelValue: false });
      const emit = vi.fn();

      const { result, wrapper } = withSetup(() => useSettings(props, emit));
      await result.confirmReset();

      expect(unregisterMock).toHaveBeenCalledTimes(2);
      expect(reloadMock).toHaveBeenCalled();
      wrapper.unmount();
    } finally {
      Object.defineProperty(navigator, 'serviceWorker', {
        writable: true,
        configurable: true,
        value: originalServiceWorker,
      });
      if (originalLocationDescriptor) {
        Object.defineProperty(window, 'location', originalLocationDescriptor);
      } else {
        window.location = originalLocationValue;
      }
    }
  });

  it('confirmReset() clears all browser caches before reload', async () => {
    const reloadMock = vi.fn();
    const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
    const originalLocationValue = window.location;
    const deleteMock = vi.fn().mockResolvedValue(true);
    const originalCaches = globalThis.caches;

    try {
      Object.defineProperty(window, 'location', {
        writable: true,
        configurable: true,
        value: { reload: reloadMock, pathname: '/' },
      });
      globalThis.caches = {
        keys: vi.fn().mockResolvedValue(['shell-v1', 'assets-v1', 'data-v1']),
        delete: deleteMock,
      };

      const props = reactive({ modelValue: false });
      const emit = vi.fn();

      const { result, wrapper } = withSetup(() => useSettings(props, emit));
      await result.confirmReset();

      expect(deleteMock).toHaveBeenCalledTimes(3);
      expect(deleteMock).toHaveBeenCalledWith('shell-v1');
      expect(deleteMock).toHaveBeenCalledWith('assets-v1');
      expect(deleteMock).toHaveBeenCalledWith('data-v1');
      expect(reloadMock).toHaveBeenCalled();
      wrapper.unmount();
    } finally {
      globalThis.caches = originalCaches;
      if (originalLocationDescriptor) {
        Object.defineProperty(window, 'location', originalLocationDescriptor);
      } else {
        window.location = originalLocationValue;
      }
    }
  });

  it('confirmReset() still reloads when serviceWorker unregister fails', async () => {
    const reloadMock = vi.fn();
    const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
    const originalLocationValue = window.location;
    const originalServiceWorker = navigator.serviceWorker;

    try {
      Object.defineProperty(window, 'location', {
        writable: true,
        configurable: true,
        value: { reload: reloadMock, pathname: '/' },
      });
      Object.defineProperty(navigator, 'serviceWorker', {
        writable: true,
        configurable: true,
        value: {
          getRegistrations: vi.fn().mockRejectedValue(new Error('SW unavailable')),
        },
      });

      const props = reactive({ modelValue: false });
      const emit = vi.fn();

      const { result, wrapper } = withSetup(() => useSettings(props, emit));
      await result.confirmReset();

      expect(reloadMock).toHaveBeenCalled();
      wrapper.unmount();
    } finally {
      Object.defineProperty(navigator, 'serviceWorker', {
        writable: true,
        configurable: true,
        value: originalServiceWorker,
      });
      if (originalLocationDescriptor) {
        Object.defineProperty(window, 'location', originalLocationDescriptor);
      } else {
        window.location = originalLocationValue;
      }
    }
  });
});
