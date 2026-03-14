import { createApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import cucinaRouter from './cucina-router/index.js';
import './assets/styles/main.css';
import CucinaApp from './CucinaApp.vue';

if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && import.meta.env.PROD) {
  const registerServiceWorker = () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.error('[SW] Registration failed:', err);
    });
  };

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    registerServiceWorker();
  } else {
    window.addEventListener('DOMContentLoaded', registerServiceWorker, { once: true });
  }
}

const app = createApp(CucinaApp);
const pinia = createPinia();
pinia.use(piniaPluginPersistedstate);
app.use(pinia);
app.use(cucinaRouter);
app.mount('#app');
