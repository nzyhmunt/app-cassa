import { createRouter, createWebHashHistory } from 'vue-router';
import OrdersView from '../views/OrdersView.vue';
import SalaView from '../views/SalaView.vue';
import BillHistoryView from '../views/BillHistoryView.vue';

const routes = [
  { path: '/', redirect: '/sala' },
  { path: '/ordini', component: OrdersView, name: 'ordini' },
  { path: '/sala', component: SalaView, name: 'sala' },
  { path: '/storico-conti', component: BillHistoryView, name: 'storico-conti' },
];

export default createRouter({
  history: createWebHashHistory(),
  routes,
});
