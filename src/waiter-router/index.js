import { createRouter, createWebHashHistory } from 'vue-router';
import WaiterSalaView from '../views/waiter/WaiterSalaView.vue';
import WaiterOrderView from '../views/waiter/WaiterOrderView.vue';

const routes = [
  { path: '/', redirect: '/sala' },
  { path: '/sala', component: WaiterSalaView, name: 'sala' },
  { path: '/comande', component: WaiterOrderView, name: 'comande' },
];

export default createRouter({
  history: createWebHashHistory(),
  routes,
});
