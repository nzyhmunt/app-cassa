/**
 * iOS PWA Viewport Scroll Reset
 *
 * On iOS, dismissing the on-screen keyboard while running as a PWA (standalone
 * display mode) can leave window.scrollY at a non-zero value. This shifts the
 * viewport upward and hides the app's top bar behind the iOS status indicators
 * (time, battery, signal). This fix resets the scroll position to (0, 0) as
 * soon as the keyboard is dismissed, without interfering with natural scrolling
 * while the keyboard is still open.
 *
 * Call setupIOSViewportFix() once at app startup (before mounting Vue) in each
 * entry point (cassa-main.js, sala-main.js, cucina-main.js).
 */

function isIOS() {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent || '');
}

function isStandaloneDisplayMode() {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator || {};
  const isIOSStandalone = typeof nav.standalone === 'boolean' && nav.standalone;
  const isDisplayModeStandalone =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  return isIOSStandalone || isDisplayModeStandalone;
}

export function setupIOSViewportFix() {
  if (typeof window === 'undefined' || !isIOS() || !isStandaloneDisplayMode()) {
    return;
  }

  const vv = window.visualViewport;
  if (vv) {
    // Primary: use the Visual Viewport API.
    // When the visual viewport grows back to near full height the keyboard has
    // been dismissed. The threshold (px) is smaller than any realistic keyboard
    // height (~250 px) to avoid false positives from minor resize events
    // (e.g. address bar hide/show).
    const KEYBOARD_HEIGHT_THRESHOLD_PX = 150;
    let keyboardScrollResetScheduled = false;
    vv.addEventListener('resize', () => {
      // Guard against unnecessary work: only reset if we're not already at the
      // top, and throttle so we perform at most one reset per resize burst.
      const keyboardDismissed =
        vv.height > window.innerHeight - KEYBOARD_HEIGHT_THRESHOLD_PX;
      if (!keyboardDismissed || window.scrollY === 0 || keyboardScrollResetScheduled) {
        return;
      }
      keyboardScrollResetScheduled = true;
      window.requestAnimationFrame(() => {
        keyboardScrollResetScheduled = false;
        const stillDismissed =
          vv.height > window.innerHeight - KEYBOARD_HEIGHT_THRESHOLD_PX;
        if (stillDismissed && window.scrollY !== 0) {
          window.scrollTo(0, 0);
        }
      });
    });
  } else {
    // Fallback for browsers without visualViewport support.
    // Reset scroll once focus leaves all keyboard-triggering elements.
    const KEYBOARD_DISMISS_DELAY_MS = 300;
    let resetScrollTimeout = null;
    document.addEventListener(
      'focusout',
      () => {
        clearTimeout(resetScrollTimeout);
        resetScrollTimeout = setTimeout(() => {
          const active = document.activeElement;
          const keyboardTags = ['INPUT', 'TEXTAREA', 'SELECT'];
          if (!active || !keyboardTags.includes(active.tagName)) {
            window.scrollTo(0, 0);
          }
        }, KEYBOARD_DISMISS_DELAY_MS);
      },
      { passive: true }
    );
  }
}
