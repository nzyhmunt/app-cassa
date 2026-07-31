import { createRouter, createWebHashHistory } from 'vue-router';
import SelfOrderScanView from '../views/selforder/SelfOrderScanView.vue';
import SelfOrderOnboardingView from '../views/selforder/SelfOrderOnboardingView.vue';
import SelfOrderMenuView from '../views/selforder/SelfOrderMenuView.vue';
import SelfOrderItemDetailView from '../views/selforder/SelfOrderItemDetailView.vue';
import SelfOrderOrderStatusView from '../views/selforder/SelfOrderOrderStatusView.vue';
import SelfOrderChatView from '../views/selforder/SelfOrderChatView.vue';

const routes = [
  { path: '/', redirect: '/scan' },
  { path: '/scan', component: SelfOrderScanView, name: 'scan' },
  { path: '/onboarding', component: SelfOrderOnboardingView, name: 'onboarding' },
  { path: '/menu', component: SelfOrderMenuView, name: 'menu' },
  { path: '/item/:id', component: SelfOrderItemDetailView, name: 'item-detail', props: true },
  { path: '/status', component: SelfOrderOrderStatusView, name: 'order-status' },
  { path: '/chat', component: SelfOrderChatView, name: 'chat' },
];

export default createRouter({
  history: createWebHashHistory(),
  routes,
});
