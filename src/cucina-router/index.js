import { createRouter, createWebHashHistory } from 'vue-router';
import CucinaView from '../views/cucina/CucinaView.vue';

const routes = [
  { path: '/', component: CucinaView, name: 'cucina' },
];

export default createRouter({
  history: createWebHashHistory(),
  routes,
});
