import { createApp } from 'vue';
import { createPinia } from 'pinia';
import salaRouter from './sala-router/index.js';
import './assets/styles/main.css';
import SalaApp from './SalaApp.vue';

const app = createApp(SalaApp);
app.use(createPinia());
app.use(salaRouter);
app.mount('#app');
