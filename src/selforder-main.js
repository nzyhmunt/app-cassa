import { createApp } from 'vue';
import { createPinia } from 'pinia';
import selforderRouter from './selforder-router/index.js';
import './assets/styles/main.css';
import SelfOrderApp from './SelfOrderApp.vue';
import { setupIOSViewportFix } from './utils/iosViewportFix.js';

// Self-order specific: lightweight bootstrap, no sync
setupIOSViewportFix();

const app = createApp(SelfOrderApp);
const pinia = createPinia();
app.use(pinia);
app.use(selforderRouter);

async function bootstrap() {
  // Self-order uses minimal initialization:
  // 1. Load basic config from localStorage (if any)
  // 2. Load menu from static URL
  // 3. Parse session from URL (if present)
  
  try {
    const { useConfigStore } = await import('./store/index.js');
    const configStore = useConfigStore(pinia);
    
    // Load minimal config
    try {
      await configStore.hydrateConfigFromIDB();
    } catch (e) {
      console.warn('[SelfOrder] Config load skipped, using defaults');
    }
  } catch (e) {
    console.warn('[SelfOrder] Store init warning:', e);
  }

  app.mount('#app');
}

bootstrap();
