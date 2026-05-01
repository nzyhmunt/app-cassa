import { createApp } from 'vue';
import { createPinia } from 'pinia';
import router from './router/index.js';
import './assets/styles/main.css';
import App from './CassaApp.vue';
import { setupIOSViewportFix } from './utils/iosViewportFix.js';
import { initStoreFromIDB, useConfigStore } from './store/index.js';

// On iOS PWA, reset the viewport scroll position when the on-screen keyboard is dismissed.
// Natural scrolling while the keyboard is open is preserved so focused inputs remain visible.
setupIOSViewportFix();

if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && import.meta.env.PROD) {
  const registerServiceWorker = () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.error('[SW] Registration failed:', err);
    });
  };

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    // DOM is already ready; register immediately so the SW can take control sooner.
    registerServiceWorker();
  } else {
    // Fallback: register as soon as the DOM is ready, which occurs before the 'load' event.
    window.addEventListener('DOMContentLoaded', registerServiceWorker, { once: true });
  }
}

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(router);

async function bootstrap() {
  try {
    // Hydrate from IDB only (no network) before first render.
    await initStoreFromIDB(pinia);
  } catch (e) {
    console.warn('[App] IDB init failed, starting with defaults:', e);
  }

  // Menu loading is a separate bootstrap step and may perform network fetches.
  try {
    const configStore = useConfigStore(pinia);
    await configStore.loadMenu({ skipHydrate: true });
  } catch (e) {
    console.warn('[App] Menu bootstrap failed, continuing with cached/default menu:', e);
  }

  app.mount('#app');
}

bootstrap();
