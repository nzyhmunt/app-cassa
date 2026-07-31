import { createApp } from 'vue';
import { createPinia } from 'pinia';
import selforderRouter from './selforder-router/index.js';
import './assets/styles/main.css';
import SelfOrderApp from './SelfOrderApp.vue';
import { setupIOSViewportFix } from './utils/iosViewportFix.js';
import { initStoreFromIDB, useConfigStore } from './store/index.js';

setupIOSViewportFix();

const app = createApp(SelfOrderApp);
const pinia = createPinia();
app.use(pinia);
app.use(selforderRouter);

async function bootstrap() {
  try {
    await initStoreFromIDB(pinia);
  } catch (e) {
    console.warn('[App] IDB init failed, starting with defaults:', e);
  }

  try {
    const configStore = useConfigStore(pinia);
    await configStore.loadMenu({ skipHydrate: true });
  } catch (e) {
    console.warn('[App] Menu bootstrap failed, continuing with cached/default menu:', e);
  }

  app.mount('#app');
}

bootstrap();
