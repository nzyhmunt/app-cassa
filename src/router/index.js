import { createRouter, createWebHashHistory } from 'vue-router';
import OrdersView from '../views/cassa/OrdersView.vue';
import CassaTableView from '../views/cassa/CassaTableView.vue';
import BillHistoryView from '../views/cassa/BillHistoryView.vue';

const routes = [
  { path: '/', redirect: '/sala' },
  { path: '/ordini', component: OrdersView, name: 'ordini' },
  { path: '/sala', component: CassaTableView, name: 'sala' },
  { path: '/storico-conti', component: BillHistoryView, name: 'storico-conti' },
];

export default createRouter({
  history: createWebHashHistory(),
  routes,
});
