import { createApp } from 'vue';
import { createPinia } from 'pinia';
import router from './router/index.js';
import './assets/styles/main.css';
import App from './App.vue';

// Reset window scroll position when iOS PWA shifts viewport on keyboard open inside fixed modals.
// The app uses overflow-hidden on body, so window should never scroll intentionally.
function isIOS() {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent || '');
}

function isStandaloneDisplayMode() {
  if (typeof window === 'undefined') return false;
  // iOS Safari exposes navigator.standalone, other platforms can use display-mode media query.
  const nav = window.navigator || {};
  const isIOSStandalone = typeof nav.standalone === 'boolean' && nav.standalone;
  const isDisplayModeStandalone =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  return isIOSStandalone || isDisplayModeStandalone;
}

if (typeof window !== 'undefined' && isIOS() && isStandaloneDisplayMode()) {
  let scrollTicking = false;

  const resetScrollIfNeeded = () => {
    scrollTicking = false;
    if (window.scrollY !== 0) {
      window.scrollTo(0, 0);
    }
  };

  const onWindowScroll = () => {
    if (!scrollTicking) {
      scrollTicking = true;
      window.requestAnimationFrame(resetScrollIfNeeded);
    }
  };

  window.addEventListener('scroll', onWindowScroll, { passive: true });
}
const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');
