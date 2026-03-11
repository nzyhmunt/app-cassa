import { createApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import salaRouter from './sala-router/index.js';
import './assets/styles/main.css';
import SalaApp from './SalaApp.vue';

// On iOS PWA, reset the viewport scroll position when the on-screen keyboard is dismissed.
// Natural scrolling while the keyboard is open is preserved so focused inputs remain visible.
const isIOS = /iP(ad|hone|od)/.test(window.navigator.userAgent);
const isStandalonePWA =
  (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
  (typeof window.navigator.standalone === 'boolean' && window.navigator.standalone);

if (isIOS && isStandalonePWA) {
  const vv = window.visualViewport;
  if (vv) {
    // Primary: use the Visual Viewport API.
    // When the visual viewport grows back to near full height the keyboard has been dismissed.
    // The threshold (px) is smaller than any realistic keyboard height (~250 px) to avoid
    // false positives from minor resize events (e.g. address bar hide/show).
    const KEYBOARD_HEIGHT_THRESHOLD_PX = 150;
    const KEYBOARD_RESET_DEBOUNCE_MS = 50;
    let keyboardResetTimeoutId = null;

    vv.addEventListener('resize', () => {
      // Only consider resets when the keyboard is effectively dismissed
      // and there's actually a scroll offset to reset.
      if (
        vv.height > window.innerHeight - KEYBOARD_HEIGHT_THRESHOLD_PX &&
        window.scrollY !== 0
      ) {
        if (keyboardResetTimeoutId !== null) {
          clearTimeout(keyboardResetTimeoutId);
        }
        keyboardResetTimeoutId = window.setTimeout(() => {
          keyboardResetTimeoutId = null;
          // Final guard in case scroll was already reset.
          if (window.scrollY !== 0) {
            window.scrollTo(0, 0);
          }
        }, KEYBOARD_RESET_DEBOUNCE_MS);
      }
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
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.error('[SW] Registration failed:', err);
    });
  });
}
const app = createApp(SalaApp);
const pinia = createPinia();
pinia.use(piniaPluginPersistedstate);
app.use(pinia);
app.use(salaRouter);
app.mount('#app');
