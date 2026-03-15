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
 * Additionally, on iOS the same stale-scroll problem occurs on orientation
 * change (portrait ↔ landscape). When the device is rotated the browser can
 * leave window.scrollY at a non-zero value, which shifts content up and
 * exposes a gap at the bottom of the screen (visible as a black strip when
 * the body background is dark). The orientationchange handler below resets
 * the scroll position immediately after the browser has finished repainting
 * the new layout.
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

let iosViewportFixInstalled = false;

export function setupIOSViewportFix() {
  if (typeof window === 'undefined' || !isIOS() || !isStandaloneDisplayMode()) {
    return;
  }

  // Guard: each app entry point calls this once, but protect against accidental
  // double-invocation to avoid registering duplicate event listeners.
  if (iosViewportFixInstalled) return;
  iosViewportFixInstalled = true;

  // ── Orientation change: reset scroll after portrait ↔ landscape rotation ──
  // iOS can leave window.scrollY at a non-zero value after a device rotation,
  // which shifts the content upward and exposes the body background at the
  // bottom of the screen (visible as a coloured/black strip). Two rAF calls
  // are used so the reset happens after the browser has completed both the
  // layout recalculation and the compositing pass for the new orientation.
  window.addEventListener('orientationchange', () => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (window.scrollY !== 0) {
          window.scrollTo(0, 0);
        }
      });
    });
  });

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
