import { createApp } from 'vue';
import { createPinia } from 'pinia';
import salaRouter from './sala-router/index.js';
import './assets/styles/main.css';
import SalaApp from './SalaApp.vue';

// Reset window scroll position when iOS PWA shifts viewport on keyboard open inside fixed modals.
// The app uses overflow-hidden on body, so window should never scroll intentionally.
window.addEventListener('scroll', () => { if (window.scrollY !== 0) window.scrollTo(0, 0); });

const app = createApp(SalaApp);
app.use(createPinia());
app.use(salaRouter);
app.mount('#app');
