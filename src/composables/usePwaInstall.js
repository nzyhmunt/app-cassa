/**
 * usePwaInstall — detects PWA installability and manages the install banner.
 *
 * Handles three scenarios:
 *  1. Chrome / Edge / Samsung Internet on Android: captures the
 *     `beforeinstallprompt` event and triggers the native install dialog.
 *  2. Safari on iOS: the browser never fires `beforeinstallprompt`, so we
 *     detect the platform and show manual "Add to Home Screen" instructions.
 *  3. Already installed (standalone display mode): banner is never shown.
 *
 * Once the user dismisses the banner the decision is persisted to
 * localStorage so it does not reappear on subsequent visits.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/BeforeInstallPromptEvent
 */

import { ref, onMounted, onUnmounted } from 'vue';

/** localStorage key used to remember the user's dismissal decision. */
export function getPwaDismissKey() {
  // Derive the key from the current instance context (URL path) to avoid
  // different app instances/builds sharing the same dismissal state.
  if (typeof window === 'undefined') {
    return 'pwa-install-dismissed';
  }
  const path = window.location?.pathname || '';
  return `pwa-install-dismissed${path ? `:${path}` : ''}`;
}

export const PWA_DISMISS_KEY = getPwaDismissKey();
/**
 * Returns true when the app is already running as an installed PWA
 * (standalone display mode on any platform).
 *
 * @returns {boolean}
 */
export function isStandalone() {
  if (typeof window === 'undefined') return false;
  const isIOSStandalone =
    typeof window.navigator?.standalone === 'boolean' && window.navigator.standalone;
  const isDisplayModeStandalone =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  return isIOSStandalone || isDisplayModeStandalone;
}

/**
 * Returns true when the browser is Safari on iOS/iPadOS.
 * Chrome for iOS (CriOS), Firefox for iOS (FxiOS) and other wrappers
 * cannot trigger a PWA install, so they are excluded.
 *
 * @returns {boolean}
 */
export function isIOSSafari() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';

  // Classic iOS devices (pre‑iPadOS desktop UA)
  const isClassicIOS = /iphone|ipad|ipod/i.test(ua);

  // iPadOS 13+ Safari often reports as "Macintosh" with a mobile Safari token.
  // We detect that pattern and require a touch-capable device to distinguish it
  // from real macOS Safari.
  const isIPadOSSafariUA =
    /Macintosh/i.test(ua) &&
    /Safari/i.test(ua) &&
    /Mobile\/\w+/i.test(ua);
  const hasTouch =
    typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1;
  const isIpadOS = isIPadOSSafariUA && hasTouch;

  // Exclude known iOS wrapper browsers that cannot trigger PWA install.
  const isExcludedWrapper = /(crios|fxios|opios|mercury)/i.test(ua);

  return (isClassicIOS || isIpadOS) && !isExcludedWrapper;
}

/**
 * Returns true when the user has previously dismissed the install banner.
 *
 * @returns {boolean}
 */
export function isBannerDismissed() {
  try {
    return localStorage.getItem(PWA_DISMISS_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Composable that exposes the install-banner reactive state and actions.
 *
 * @returns {{
 *   showBanner: import('vue').Ref<boolean>,
 *   isIOS: import('vue').Ref<boolean>,
 *   install: () => Promise<void>,
 *   dismiss: () => void,
 * }}
 */
export function usePwaInstall() {
  /** Whether the install banner should be visible. */
  const showBanner = ref(false);

  /** true when running on iOS Safari (manual add-to-home instructions needed). */
  const isIOS = ref(false);

  /** Captured BeforeInstallPromptEvent — null on iOS or when not available. */
  let deferredPrompt = null;

  /**
   * Persists the dismissal decision and hides the banner.
   */
  function dismiss() {
    showBanner.value = false;
    try {
      localStorage.setItem(PWA_DISMISS_KEY, 'true');
    } catch {
      // Ignore storage errors (e.g. private-browsing quota or disabled storage)
    }
  }

  /**
   * Triggers the native browser install prompt (non-iOS only).
   * Hides the banner after the user responds. Dismissal is only persisted
   * to localStorage when the user accepts the install; cancelling the dialog
   * merely hides the banner so it can reappear on a future visit.
   */
  async function install() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (outcome === 'accepted') {
      dismiss();
    } else {
      showBanner.value = false;
    }
  }

  /**
   * Stores the deferred prompt and shows the banner the first time
   * the browser signals PWA installability.
   *
   * @param {BeforeInstallPromptEvent} e
   */
  function handleBeforeInstallPrompt(e) {
    e.preventDefault();
    deferredPrompt = e;
    if (!isBannerDismissed()) {
      showBanner.value = true;
    }
  }

  onMounted(() => {
    // Do not show the banner when already running as an installed PWA.
    if (isStandalone()) return;
    // Do not show the banner when the user has already dismissed it.
    if (isBannerDismissed()) return;

    isIOS.value = isIOSSafari();

    if (isIOS.value) {
      // iOS Safari does not support beforeinstallprompt; show manual instructions.
      showBanner.value = true;
    } else {
      // Chrome / Edge / Android: wait for the browser's install prompt signal.
      window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    }
  });

  onUnmounted(() => {
    window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  });

  return { showBanner, isIOS, install, dismiss };
}
