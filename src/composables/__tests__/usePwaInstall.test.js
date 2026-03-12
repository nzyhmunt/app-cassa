import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, nextTick } from 'vue';
import {
  getPwaDismissKey,
  isStandalone,
  isIOSSafari,
  isBannerDismissed,
  usePwaInstall,
  PWA_DISMISS_KEY,
} from '../usePwaInstall.js';

// ---------------------------------------------------------------------------
// jsdom helpers — define browser APIs that jsdom omits
// ---------------------------------------------------------------------------

/** Define (or overwrite) window.matchMedia with a configurable stub. */
function mockMatchMedia(matches) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockReturnValue({ matches }),
  });
}

/** Remove window.matchMedia so isStandalone() falls back to the iOS path. */
function removeMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: undefined,
  });
}

/** Set navigator.standalone (iOS-only property, absent in jsdom by default). */
function setNavigatorStandalone(value) {
  Object.defineProperty(window.navigator, 'standalone', {
    value,
    writable: true,
    configurable: true,
  });
}

// ---------------------------------------------------------------------------
// Helper: mount a component that calls the given composable in setup()
// Returns the composable result AND the wrapper so callers can unmount it.
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
  _wrappers.push(wrapper);
  return { result, wrapper };
}

// Keeps track of wrappers created in each test so they are unmounted in
// afterEach, ensuring onUnmounted() runs and all window event listeners
// registered by the composable are cleaned up between tests.
let _wrappers = [];

// ---------------------------------------------------------------------------
// getPwaDismissKey()
// ---------------------------------------------------------------------------
describe('getPwaDismissKey()', () => {
  afterEach(() => {
    delete window.appConfig;
    delete window.__APP_CONFIG__;
  });

  it('includes the current pathname in the key (default jsdom path is "/")', () => {
    // jsdom defaults window.location.pathname to '/'
    const key = getPwaDismissKey();
    expect(key).toContain('pwa-install-dismissed');
    // pathname '/' is non-empty so it ends up in the key
    expect(key).toContain('/');
  });

  it('includes instanceName from window.appConfig when set', () => {
    window.appConfig = { instanceName: 'cassa1' };
    const key = getPwaDismissKey();
    expect(key).toContain('cassa1');
    expect(key.startsWith('pwa-install-dismissed:')).toBe(true);
  });

  it('includes instanceName from window.__APP_CONFIG__ when appConfig is absent', () => {
    window.__APP_CONFIG__ = { instanceName: 'sala2' };
    const key = getPwaDismissKey();
    expect(key).toContain('sala2');
  });

  it('prefers window.appConfig over window.__APP_CONFIG__', () => {
    window.appConfig = { instanceName: 'primary' };
    window.__APP_CONFIG__ = { instanceName: 'secondary' };
    const key = getPwaDismissKey();
    expect(key).toContain('primary');
    expect(key).not.toContain('secondary');
  });

  it('returns the bare key with no extra parts when instanceName is empty and path is empty', () => {
    // Temporarily remove the pathname by mocking location
    const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');

    try {
      Object.defineProperty(window, 'location', {
        writable: true,
        configurable: true,
        value: { pathname: '' },
      });

      const key = getPwaDismissKey();
      expect(key).toBe('pwa-install-dismissed');
    } finally {
      if (originalLocationDescriptor) {
        Object.defineProperty(window, 'location', originalLocationDescriptor);
      } else {
        delete window.location;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// isStandalone()
// ---------------------------------------------------------------------------
describe('isStandalone()', () => {
  afterEach(() => {
    removeMatchMedia();
    setNavigatorStandalone(undefined);
  });

  it('returns false by default in jsdom (no matchMedia, no standalone)', () => {
    removeMatchMedia();
    expect(isStandalone()).toBe(false);
  });

  it('returns true when matchMedia signals standalone display mode', () => {
    mockMatchMedia(true);
    expect(isStandalone()).toBe(true);
  });

  it('returns false when matchMedia does not match standalone', () => {
    mockMatchMedia(false);
    expect(isStandalone()).toBe(false);
  });

  it('returns true when navigator.standalone is true (iOS PWA)', () => {
    removeMatchMedia();
    setNavigatorStandalone(true);
    expect(isStandalone()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isIOSSafari()
// ---------------------------------------------------------------------------
describe('isIOSSafari()', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns false for a standard desktop Chrome user agent', () => {
    expect(isIOSSafari()).toBe(false);
  });

  it('returns true for iPhone Safari', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    );
    expect(isIOSSafari()).toBe(true);
  });

  it('returns true for iPad Safari', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    );
    expect(isIOSSafari()).toBe(true);
  });

  it('returns false for Chrome on iOS (CriOS)', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/106.0.5249.92 Mobile/15E148 Safari/604.1',
    );
    expect(isIOSSafari()).toBe(false);
  });

  it('returns false for Firefox on iOS (FxiOS)', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/106.0 Mobile/15E148 Safari/604.1',
    );
    expect(isIOSSafari()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isBannerDismissed()
// ---------------------------------------------------------------------------
describe('isBannerDismissed()', () => {
  beforeEach(() => localStorage.clear());

  it('returns false when the dismiss key is not set', () => {
    expect(isBannerDismissed()).toBe(false);
  });

  it('returns true when the dismiss key is set to "true"', () => {
    localStorage.setItem(PWA_DISMISS_KEY, 'true');
    expect(isBannerDismissed()).toBe(true);
  });

  it('returns false when the dismiss key has any other value', () => {
    localStorage.setItem(PWA_DISMISS_KEY, '1');
    expect(isBannerDismissed()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// usePwaInstall()
// ---------------------------------------------------------------------------
describe('usePwaInstall()', () => {
  beforeEach(() => {
    localStorage.clear();
    // Stub matchMedia as non-standalone so tests start from a clean state
    mockMatchMedia(false);
  });

  afterEach(() => {
    // Unmount all components created via withSetup() so that onUnmounted()
    // runs and the beforeinstallprompt window listener is removed, preventing
    // cross-test interference.
    _wrappers.forEach((w) => w.unmount());
    _wrappers = [];
    vi.restoreAllMocks();
    removeMatchMedia();
    setNavigatorStandalone(undefined);
  });

  it('showBanner is false on mount by default (no prompt event, not iOS)', () => {
    const { result } = withSetup(() => usePwaInstall());
    expect(result.showBanner.value).toBe(false);
  });

  it('showBanner becomes true when beforeinstallprompt fires and banner is not dismissed', async () => {
    const { result } = withSetup(() => usePwaInstall());

    const event = Object.assign(new Event('beforeinstallprompt'), {
      preventDefault: vi.fn(),
      prompt: vi.fn(),
      userChoice: Promise.resolve({ outcome: 'dismissed' }),
    });
    window.dispatchEvent(event);
    await nextTick();

    expect(event.preventDefault).toHaveBeenCalled();
    expect(result.showBanner.value).toBe(true);
  });

  it('does NOT show banner when beforeinstallprompt fires but banner was already dismissed', async () => {
    localStorage.setItem(PWA_DISMISS_KEY, 'true');

    const { result } = withSetup(() => usePwaInstall());

    const event = Object.assign(new Event('beforeinstallprompt'), {
      preventDefault: vi.fn(),
      prompt: vi.fn(),
    });
    window.dispatchEvent(event);
    await nextTick();

    expect(result.showBanner.value).toBe(false);
  });

  it('does NOT show banner when already in standalone mode', async () => {
    mockMatchMedia(true); // standalone

    const { result } = withSetup(() => usePwaInstall());

    const event = Object.assign(new Event('beforeinstallprompt'), {
      preventDefault: vi.fn(),
      prompt: vi.fn(),
    });
    window.dispatchEvent(event);
    await nextTick();

    expect(result.showBanner.value).toBe(false);
  });

  it('dismiss() hides the banner and writes to localStorage', () => {
    const { result } = withSetup(() => usePwaInstall());
    result.showBanner.value = true;

    result.dismiss();

    expect(result.showBanner.value).toBe(false);
    expect(localStorage.getItem(PWA_DISMISS_KEY)).toBe('true');
  });

  it('install() calls prompt(), awaits userChoice, then dismisses and persists when accepted', async () => {
    const { result } = withSetup(() => usePwaInstall());

    const mockPrompt = vi.fn();
    const event = Object.assign(new Event('beforeinstallprompt'), {
      preventDefault: vi.fn(),
      prompt: mockPrompt,
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    });
    window.dispatchEvent(event);
    await nextTick();

    expect(result.showBanner.value).toBe(true);

    await result.install();

    expect(mockPrompt).toHaveBeenCalled();
    expect(result.showBanner.value).toBe(false);
    expect(localStorage.getItem(PWA_DISMISS_KEY)).toBe('true');
  });

  it('install() hides the banner but does NOT persist dismissal when user cancels the prompt', async () => {
    const { result } = withSetup(() => usePwaInstall());

    const mockPrompt = vi.fn();
    const event = Object.assign(new Event('beforeinstallprompt'), {
      preventDefault: vi.fn(),
      prompt: mockPrompt,
      userChoice: Promise.resolve({ outcome: 'dismissed' }),
    });
    window.dispatchEvent(event);
    await nextTick();

    expect(result.showBanner.value).toBe(true);

    await result.install();

    expect(mockPrompt).toHaveBeenCalled();
    expect(result.showBanner.value).toBe(false);
    expect(localStorage.getItem(PWA_DISMISS_KEY)).toBeNull();
  });

  it('install() is a no-op when no deferred prompt is available', async () => {
    const { result } = withSetup(() => usePwaInstall());
    // No beforeinstallprompt was fired, so deferredPrompt is null
    await expect(result.install()).resolves.toBeUndefined();
  });

  it('shows the banner on iOS Safari without waiting for beforeinstallprompt', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    );

    const { result } = withSetup(() => usePwaInstall());
    await nextTick();

    expect(result.showBanner.value).toBe(true);
    expect(result.isIOS.value).toBe(true);
  });

  it('does NOT show banner on iOS Safari when already dismissed', async () => {
    localStorage.setItem(PWA_DISMISS_KEY, 'true');
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    );

    const { result } = withSetup(() => usePwaInstall());
    await nextTick();

    expect(result.showBanner.value).toBe(false);
  });
});

