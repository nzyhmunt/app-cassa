import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, reactive, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { useSettings } from '../useSettings.js';
import { useAppStore } from '../../store/index.js';
import { resolveStorageKeys } from '../../store/persistence.js';
import { getPwaDismissKey } from '../usePwaInstall.js';

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
    expect(result.settings.value.preventScreenLock).toBe(false);
    expect(result.settings.value.customKeyboard).toBe('disabled');
    expect(typeof result.settings.value.menuUrl).toBe('string');
    wrapper.unmount();
  });

  it('loads all settings from localStorage when the key is present', () => {
    // Mock Wake Lock API as supported so preventScreenLock:true is preserved
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request: vi.fn() },
      writable: true,
      configurable: true,
    });
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        sounds: false,
        menuUrl: 'https://custom.example.com/menu.json',
        preventScreenLock: true,
        customKeyboard: 'center',
      }),
    );
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

  it('falls back to defaults when localStorage contains malformed JSON', () => {
    localStorage.setItem(SETTINGS_KEY, 'not-valid-json');
    const props = reactive({ modelValue: false });
    const emit = vi.fn();

    const { result, wrapper } = withSetup(() => useSettings(props, emit));

    expect(result.settings.value.sounds).toBe(true);
    expect(result.settings.value.preventScreenLock).toBe(false);
    wrapper.unmount();
  });

  it('falls back to default menuUrl when stored menuUrl is an empty string', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ sounds: true, menuUrl: '' }));
    const props = reactive({ modelValue: false });
    const emit = vi.fn();

    const { result, wrapper } = withSetup(() => useSettings(props, emit));

    // Should use appConfig.menuUrl, not the empty string
    expect(result.settings.value.menuUrl).not.toBe('');
    wrapper.unmount();
  });

  it('defaults sounds to true when stored sounds value is not a boolean', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ sounds: 'yes' }));
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

  it('defaults customKeyboard to "disabled" when stored value is not a valid position', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ customKeyboard: 'yes' }));
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

  it('debounces localStorage writes — only persists after 400 ms', async () => {
    const props = reactive({ modelValue: true });
    const emit = vi.fn();

    const { result, wrapper } = withSetup(() => useSettings(props, emit));

    result.settings.value.sounds = false;
    await nextTick();

    // Not yet written
    expect(localStorage.getItem(SETTINGS_KEY)).toBeNull();

    // Advance past the 400 ms debounce threshold
    vi.advanceTimersByTime(400);

    const stored = localStorage.getItem(SETTINGS_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored).sounds).toBe(false);
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

  it('flushes the pending localStorage save immediately when the modal closes', async () => {
    const props = reactive({ modelValue: true });
    const emit = vi.fn();

    const { result, wrapper } = withSetup(() => useSettings(props, emit));

    result.settings.value.sounds = false;
    await nextTick();
    // Debounce has not fired yet
    expect(localStorage.getItem(SETTINGS_KEY)).toBeNull();

    // Closing the modal triggers an immediate save
    props.modelValue = false;
    await nextTick();

    const stored = localStorage.getItem(SETTINGS_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored).sounds).toBe(false);
    wrapper.unmount();
  });

  it('persists settings to localStorage on unmount', async () => {
    const props = reactive({ modelValue: true });
    const emit = vi.fn();

    const { result, wrapper } = withSetup(() => useSettings(props, emit));

    result.settings.value.sounds = false;
    await nextTick();

    // Debounce has not fired yet
    expect(localStorage.getItem(SETTINGS_KEY)).toBeNull();

    wrapper.unmount(); // onUnmounted fires persistSettings

    const stored = localStorage.getItem(SETTINGS_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored).sounds).toBe(false);
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

  it('confirmReset() clears the storage state and settings keys from localStorage', () => {
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

      expect(localStorage.getItem(storageKey)).toBeNull();
      expect(localStorage.getItem(settingsKey)).toBeNull();
      wrapper.unmount();
    } finally {
      if (originalLocationDescriptor) {
        Object.defineProperty(window, 'location', originalLocationDescriptor);
      } else {
        window.location = originalLocationValue;
      }
    }
  });

  it('confirmReset() calls window.location.reload()', () => {
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
      result.confirmReset();

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

  it('confirmReset() removes the PWA dismiss key from localStorage', () => {
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
      result.confirmReset();

      expect(localStorage.getItem(pwaDismissKey)).toBeNull();
      wrapper.unmount();
    } finally {
      if (originalLocationDescriptor) {
        Object.defineProperty(window, 'location', originalLocationDescriptor);
      } else {
        window.location = originalLocationValue;
      }
    }
  });

  // ── exportBackupData() ───────────────────────────────────────────────────

  it('exportBackupData() triggers a JSON file download', () => {
    const { storageKey, settingsKey } = resolveStorageKeys('');
    localStorage.setItem(storageKey, JSON.stringify({ orders: [{ id: '1' }] }));
    localStorage.setItem(settingsKey, JSON.stringify({ sounds: false }));

    const props = reactive({ modelValue: false });
    const emit = vi.fn();

    // Mount composable first, then set up DOM mocks to avoid conflicting with Vue test utils
    const { result, wrapper } = withSetup(() => useSettings(props, emit));

    const clickMock = vi.fn();
    const anchorEl = { href: '', download: '', click: clickMock };
    vi.spyOn(document, 'createElement').mockReturnValue(anchorEl);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => {});
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => {});
    const createObjectURLMock = vi.fn(() => 'blob:mock');
    const revokeObjectURLMock = vi.fn();
    vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectURLMock);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectURLMock);

    result.exportBackupData();

    expect(anchorEl.download).toMatch(/^backup-cassa-\d{4}-\d{2}-\d{2}\.json$/);
    expect(anchorEl.href).toBe('blob:mock');
    expect(clickMock).toHaveBeenCalled();
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock');

    wrapper.unmount();
    vi.restoreAllMocks();
  });

  it('exportBackupData() includes app state and settings in the backup', async () => {
    const { storageKey, settingsKey } = resolveStorageKeys('');
    const appState = { orders: [{ id: 'order-1', status: 'pending' }] };
    const appSettings = { sounds: false, menuUrl: 'https://example.com/menu.json' };
    localStorage.setItem(storageKey, JSON.stringify(appState));
    localStorage.setItem(settingsKey, JSON.stringify(appSettings));

    const props = reactive({ modelValue: false });
    const emit = vi.fn();

    const { result, wrapper } = withSetup(() => useSettings(props, emit));

    let capturedBlob = null;
    const anchorEl = { href: '', download: '', click: vi.fn() };
    vi.spyOn(document, 'createElement').mockReturnValue(anchorEl);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => {});
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      capturedBlob = blob;
      return 'blob:mock';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    result.exportBackupData();

    expect(capturedBlob).not.toBeNull();
    const text = await capturedBlob.text();
    const parsed = JSON.parse(text);
    expect(parsed.appState).toEqual(appState);
    expect(parsed.settings).toEqual(appSettings);
    expect(parsed.instanceName).toBe('default');
    expect(typeof parsed.exportedAt).toBe('string');

    wrapper.unmount();
    vi.restoreAllMocks();
  });

  // ── initiateReset() ──────────────────────────────────────────────────────

  it('initiateReset() triggers backup download and sets resetConfirmPending to true', async () => {
    const props = reactive({ modelValue: true });
    const emit = vi.fn();

    const { result, wrapper } = withSetup(() => useSettings(props, emit));

    // Apply mocks after mounting to avoid interfering with Vue test utils DOM operations
    const anchorEl = { href: '', download: '', click: vi.fn() };
    vi.spyOn(document, 'createElement').mockReturnValue(anchorEl);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => {});
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    expect(result.resetConfirmPending.value).toBe(false);
    result.initiateReset();
    await nextTick();

    expect(result.resetConfirmPending.value).toBe(true);
    // The anchor click (download) was triggered
    expect(anchorEl.click).toHaveBeenCalled();

    wrapper.unmount();
    vi.restoreAllMocks();
  });
});
