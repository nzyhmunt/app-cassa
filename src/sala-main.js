import { createApp } from 'vue';
import { createPinia } from 'pinia';
import salaRouter from './sala-router/index.js';
import './assets/styles/main.css';
import SalaApp from './SalaApp.vue';

// On iOS PWA, reset the viewport scroll position when the on-screen keyboard is dismissed.
// We do NOT prevent scrolling while the keyboard is open so the focused input remains visible.
// When focus leaves all inputs (keyboard closes), we restore scrollY to 0.
const isIOS = /iP(ad|hone|od)/.test(window.navigator.userAgent);
const isStandalonePWA =
  (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
  (typeof window.navigator.standalone === 'boolean' && window.navigator.standalone);

if (isIOS && isStandalonePWA) {
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
const app = createApp(SalaApp);
app.use(createPinia());
app.use(salaRouter);
app.mount('#app');
