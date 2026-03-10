import { createApp } from 'vue';
import { createPinia } from 'pinia';
import router from './router/index.js';
import './assets/styles/main.css';
import App from './App.vue';

// On iOS PWA, reset the viewport scroll position when the on-screen keyboard is dismissed.
// We do NOT prevent scrolling while the keyboard is open so the focused input remains visible.
// When focus leaves all inputs (keyboard closes), we restore scrollY to 0.
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

if (typeof window !== 'undefined' && isIOS() && isStandaloneDisplayMode()) {
  // Delay (ms) to wait for focus to settle on a new element before deciding the keyboard closed.
  const KEYBOARD_DISMISS_DELAY_MS = 300;
  let resetScrollTimeout = null;

  document.addEventListener(
    'focusout',
    () => {
      // A short delay lets focus settle on a new element (e.g. moving between inputs)
      // before we decide whether the keyboard has really been dismissed.
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
const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');
