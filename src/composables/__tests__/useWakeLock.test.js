import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, reactive } from 'vue';

// ── Mock the Pinia store before importing the composable ─────────────────────
vi.mock('../../store/index.js', () => ({
  useAppStore: vi.fn(),
}));
import { useAppStore } from '../../store/index.js';

import { isWakeLockSupported, useWakeLock } from '../useWakeLock.js';

// ── Browser API helpers ──────────────────────────────────────────────────────

/**
 * Create a minimal WakeLock sentinel whose 'release' event can be fired
 * programmatically via `sentinel._fire('release')`.
 */
function makeSentinel() {
  const _listeners = {};
  return {
    release: vi.fn().mockResolvedValue(undefined),
    addEventListener: vi.fn((event, cb) => {
      _listeners[event] = cb;
    }),
    /** Test helper: synchronously invoke the stored listener for `event`. */
    _fire(event) {
      _listeners[event]?.();
    },
  };
}

/** Stub `navigator.wakeLock` with a mock API that resolves to `sentinel`. */
function installWakeLock(sentinel) {
  const api = { request: vi.fn().mockResolvedValue(sentinel) };
  Object.defineProperty(navigator, 'wakeLock', {
    value: api,
    writable: true,
    configurable: true,
  });
  return api;
}

/** Remove `navigator.wakeLock` to simulate an unsupported browser. */
function uninstallWakeLock() {
  try {
    delete navigator.wakeLock;
  } catch {
    // Fallback: some environments don't allow delete on host objects
  }
}

// ── Composable mount helper ───────────────────────────────────────────────────

let _wrappers = [];

/** Mount a test component that calls `composable()` in setup(). */
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
  _wrappers.push(wrapper);
  return { result, wrapper };
}

// ── isWakeLockSupported() ─────────────────────────────────────────────────────
describe('isWakeLockSupported()', () => {
  afterEach(uninstallWakeLock);

  it('returns false by default in jsdom (no WakeLock API)', () => {
    uninstallWakeLock();
    expect(isWakeLockSupported()).toBe(false);
  });

  it('returns true when navigator.wakeLock is present', () => {
    installWakeLock(makeSentinel());
    expect(isWakeLockSupported()).toBe(true);
  });
});

// ── useWakeLock() ─────────────────────────────────────────────────────────────
describe('useWakeLock()', () => {
  let mockStore;
  let sentinel;
  let wakeLockApi;

  beforeEach(() => {
    sentinel = makeSentinel();
    wakeLockApi = installWakeLock(sentinel);
    mockStore = reactive({ preventScreenLock: false });
    useAppStore.mockReturnValue(mockStore);
  });

  afterEach(async () => {
    _wrappers.forEach((w) => w.unmount());
    _wrappers = [];
    vi.restoreAllMocks();
    uninstallWakeLock();
  });

  // ── Initial mount ──────────────────────────────────────────────────────────

  it('does not request wake lock on mount when preventScreenLock is false', async () => {
    withSetup(() => useWakeLock());
    await flushPromises();

    expect(wakeLockApi.request).not.toHaveBeenCalled();
  });

  it('requests wake lock on mount when preventScreenLock is true', async () => {
    mockStore.preventScreenLock = true;
    withSetup(() => useWakeLock());
    await flushPromises();

    expect(wakeLockApi.request).toHaveBeenCalledWith('screen');
  });

  it('does not request wake lock when the Wake Lock API is unavailable', async () => {
    uninstallWakeLock();
    mockStore.preventScreenLock = true;
    withSetup(() => useWakeLock());
    await flushPromises();

    // isWakeLockSupported() returns false → request is never reached
    expect(wakeLockApi.request).not.toHaveBeenCalled();
  });

  // ── Reactive watch (setting toggled) ──────────────────────────────────────

  it('requests wake lock when preventScreenLock is toggled on', async () => {
    withSetup(() => useWakeLock());
    await flushPromises();
    expect(wakeLockApi.request).not.toHaveBeenCalled();

    mockStore.preventScreenLock = true;
    await flushPromises();

    expect(wakeLockApi.request).toHaveBeenCalledWith('screen');
  });

  it('releases wake lock when preventScreenLock is toggled off', async () => {
    mockStore.preventScreenLock = true;
    withSetup(() => useWakeLock());
    await flushPromises();

    mockStore.preventScreenLock = false;
    await flushPromises();

    expect(sentinel.release).toHaveBeenCalled();
  });

  // ── visibilitychange re-acquisition ───────────────────────────────────────

  it('re-acquires wake lock when the page becomes visible again', async () => {
    mockStore.preventScreenLock = true;
    withSetup(() => useWakeLock());
    await flushPromises();

    wakeLockApi.request.mockClear();

    // jsdom defaults to visibilityState 'visible'; dispatching the event
    // triggers handleVisibilityChange which calls requestWakeLock().
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();

    expect(wakeLockApi.request).toHaveBeenCalledWith('screen');
  });

  it('does not re-acquire on visibilitychange when preventScreenLock is off', async () => {
    withSetup(() => useWakeLock());
    await flushPromises();

    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();

    expect(wakeLockApi.request).not.toHaveBeenCalled();
  });

  // ── Sentinel 'release' event (browser/OS releases the lock) ───────────────

  it('re-acquires wake lock when the sentinel is released by the browser', async () => {
    mockStore.preventScreenLock = true;
    withSetup(() => useWakeLock());
    await flushPromises();

    wakeLockApi.request.mockClear();

    // Simulate the OS or browser autonomously releasing the sentinel while
    // the document is still visible.
    const originalVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');

    try {
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      });
      sentinel._fire('release');
      await flushPromises();

      expect(wakeLockApi.request).toHaveBeenCalledWith('screen');
    } finally {
      if (originalVisibilityDescriptor) {
        Object.defineProperty(document, 'visibilityState', originalVisibilityDescriptor);
      } else {
        delete document.visibilityState;
      }
    }
  });

  it('does not re-acquire when sentinel is released but the setting is off', async () => {
    mockStore.preventScreenLock = true;
    withSetup(() => useWakeLock());
    await flushPromises();

    // Disable the setting — this releases the sentinel via the watch
    mockStore.preventScreenLock = false;
    await flushPromises();

    wakeLockApi.request.mockClear();

    // Firing 'release' on the sentinel should NOT trigger re-acquisition
    // because preventScreenLock is now false.
    sentinel._fire('release');
    await flushPromises();

    expect(wakeLockApi.request).not.toHaveBeenCalled();
  });

  // ── Cleanup on unmount ────────────────────────────────────────────────────

  it('removes the visibilitychange listener on unmount', async () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { wrapper } = withSetup(() => useWakeLock());
    await flushPromises();

    wrapper.unmount();

    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });
});
