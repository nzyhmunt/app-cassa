import { createRouter, createWebHashHistory } from 'vue-router';
import SalaView from '../views/sala/SalaView.vue';
import SalaOrderView from '../views/sala/SalaOrderView.vue';

const routes = [
  { path: '/', redirect: '/sala' },
  { path: '/sala', component: SalaView, name: 'sala' },
  { path: '/comande', component: SalaOrderView, name: 'comande' },
];

export default createRouter({
  history: createWebHashHistory(),
  routes,
});
