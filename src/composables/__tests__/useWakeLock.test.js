import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { useWakeLock } from '../useWakeLock.js';
import { useAppStore } from '../../store/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stub window.matchMedia to signal standalone display mode. */
function mockMatchMediaStandalone(matches) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockReturnValue({ matches }),
  });
}

/** Remove window.matchMedia so isStandaloneDisplayMode() returns false. */
function removeMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: undefined,
  });
}

/** Mount a component whose setup() calls the composable, returning the wrapper. */
function withSetup(composable) {
  const TestComponent = defineComponent({
    setup() {
      composable();
      return {};
    },
    template: '<div></div>',
  });
  return mount(TestComponent);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useWakeLock()', () => {
  let store;

  beforeEach(() => {
    // Ensure a clean storage and offline-safe environment before store initialization
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      }),
    );

    setActivePinia(createPinia());
    store = useAppStore();
    removeMatchMedia();
    // Ensure WakeLock API is absent by default
    if ('wakeLock' in navigator) {
      delete navigator.wakeLock;
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ── isStandaloneDisplayMode() branches ──────────────────────────────────

  it('does not request a wake lock when NOT in standalone mode', async () => {
    store.preventScreenLock = true;
    const mockRequest = vi.fn();
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request: mockRequest },
      writable: true,
      configurable: true,
    });

    const wrapper = withSetup(() => useWakeLock());
    await nextTick();

    expect(mockRequest).not.toHaveBeenCalled();
    wrapper.unmount();
    await nextTick();
  });

  it('does not request a wake lock when preventScreenLock is false', async () => {
    mockMatchMediaStandalone(true);
    store.preventScreenLock = false;
    const mockRequest = vi.fn();
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request: mockRequest },
      writable: true,
      configurable: true,
    });

    const wrapper = withSetup(() => useWakeLock());
    await nextTick();

    expect(mockRequest).not.toHaveBeenCalled();
    wrapper.unmount();
    await nextTick();
  });

  it('does not request a wake lock when the WakeLock API is not supported', async () => {
    mockMatchMediaStandalone(true);
    store.preventScreenLock = true;
    // navigator.wakeLock is already absent (set to undefined in beforeEach)

    // Should mount and unmount without throwing
    const wrapper = withSetup(() => useWakeLock());
    await nextTick();
    wrapper.unmount();
    await nextTick();
  });

  it('requests a wake lock when standalone, preventScreenLock=true, and API is available', async () => {
    mockMatchMediaStandalone(true);
    store.preventScreenLock = true;
    const sentinel = {
      release: vi.fn().mockResolvedValue(undefined),
      addEventListener: vi.fn(),
    };
    const mockRequest = vi.fn().mockResolvedValue(sentinel);
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request: mockRequest },
      writable: true,
      configurable: true,
    });

    const wrapper = withSetup(() => useWakeLock());
    await nextTick();
    await nextTick(); // allow the async requestWakeLock to settle

    expect(mockRequest).toHaveBeenCalledWith('screen');
    wrapper.unmount();
    await nextTick();
  });

  it('releases the wake lock sentinel on unmount', async () => {
    mockMatchMediaStandalone(true);
    store.preventScreenLock = true;
    const sentinel = {
      release: vi.fn().mockResolvedValue(undefined),
      addEventListener: vi.fn(),
    };
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request: vi.fn().mockResolvedValue(sentinel) },
      writable: true,
      configurable: true,
    });

    const wrapper = withSetup(() => useWakeLock());
    await nextTick();
    await nextTick(); // sentinel acquired

    wrapper.unmount();
    await nextTick();
    await nextTick(); // releaseWakeLock settles

    expect(sentinel.release).toHaveBeenCalled();
  });

  it('re-acquires the wake lock when the page becomes visible again', async () => {
    mockMatchMediaStandalone(true);
    store.preventScreenLock = true;
    const sentinel = {
      release: vi.fn().mockResolvedValue(undefined),
      addEventListener: vi.fn(),
    };
    const mockRequest = vi.fn().mockResolvedValue(sentinel);
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request: mockRequest },
      writable: true,
      configurable: true,
    });

    const wrapper = withSetup(() => useWakeLock());
    await nextTick();
    await nextTick(); // initial acquisition

    expect(mockRequest).toHaveBeenCalledTimes(1);

    // Simulate the page becoming visible
    const originalVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    try {
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
      await nextTick();
      await nextTick(); // re-acquisition settles
    } finally {
      if (originalVisibilityDescriptor) {
        Object.defineProperty(document, 'visibilityState', originalVisibilityDescriptor);
      } else {
        delete document.visibilityState;
      }
    }

    expect(mockRequest).toHaveBeenCalledTimes(2);
    wrapper.unmount();
    await nextTick();
  });

  it('watches store.preventScreenLock — acquires lock when enabled', async () => {
    mockMatchMediaStandalone(true);
    store.preventScreenLock = false;
    const sentinel = {
      release: vi.fn().mockResolvedValue(undefined),
      addEventListener: vi.fn(),
    };
    const mockRequest = vi.fn().mockResolvedValue(sentinel);
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request: mockRequest },
      writable: true,
      configurable: true,
    });

    const wrapper = withSetup(() => useWakeLock());
    await nextTick();
    await nextTick();
    expect(mockRequest).not.toHaveBeenCalled();

    store.preventScreenLock = true;
    await nextTick();
    await nextTick(); // watcher fires + async request resolves

    expect(mockRequest).toHaveBeenCalledWith('screen');
    wrapper.unmount();
    await nextTick();
  });

  it('watches store.preventScreenLock — releases lock when disabled', async () => {
    mockMatchMediaStandalone(true);
    store.preventScreenLock = true;
    const sentinel = {
      release: vi.fn().mockResolvedValue(undefined),
      addEventListener: vi.fn(),
    };
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request: vi.fn().mockResolvedValue(sentinel) },
      writable: true,
      configurable: true,
    });

    const wrapper = withSetup(() => useWakeLock());
    await nextTick();
    await nextTick(); // lock acquired

    store.preventScreenLock = false;
    await nextTick();
    await nextTick(); // watcher fires + releaseWakeLock settles

    expect(sentinel.release).toHaveBeenCalled();
    wrapper.unmount();
    await nextTick();
  });
});
