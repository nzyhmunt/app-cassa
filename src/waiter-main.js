import { createApp } from 'vue';
import { createPinia } from 'pinia';
import waiterRouter from './waiter-router/index.js';
import './assets/styles/main.css';
import WaiterApp from './WaiterApp.vue';

const app = createApp(WaiterApp);
app.use(createPinia());
app.use(waiterRouter);
app.mount('#app');
