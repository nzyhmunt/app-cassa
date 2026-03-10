import { createApp } from 'vue';
import { createPinia } from 'pinia';
import salaRouter from './sala-router/index.js';
import './assets/styles/main.css';
import SalaApp from './SalaApp.vue';

// Reset window scroll position when iOS PWA shifts viewport on keyboard open inside fixed modals.
// The app uses overflow-hidden on body, so window should never scroll intentionally.
const isIOS = /iP(ad|hone|od)/.test(window.navigator.userAgent);
const isStandalonePWA =
  (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
  (typeof window.navigator.standalone === 'boolean' && window.navigator.standalone);

if (isIOS && isStandalonePWA) {
  let scrollTicking = false;

  window.addEventListener(
    'scroll',
    () => {
      if (scrollTicking) return;
      scrollTicking = true;

      window.requestAnimationFrame(() => {
        if (window.scrollY !== 0) {
          window.scrollTo(0, 0);
        }
        scrollTicking = false;
      });
    },
    { passive: true }
  );
}
const app = createApp(SalaApp);
app.use(createPinia());
app.use(salaRouter);
app.mount('#app');
