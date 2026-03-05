import { createRouter, createWebHashHistory } from 'vue-router';
import OrdersView from '../views/OrdersView.vue';
import SalaView from '../views/SalaView.vue';

const routes = [
  { path: '/', redirect: '/sala' },
  { path: '/ordini', component: OrdersView, name: 'ordini' },
  { path: '/sala', component: SalaView, name: 'sala' },
];

export default createRouter({
  history: createWebHashHistory(),
  routes,
});
