import { createRouter, createWebHashHistory } from 'vue-router';
import SelfOrderScanView from '../views/selforder/SelfOrderScanView.vue';
import SelfOrderOnboardingView from '../views/selforder/SelfOrderOnboardingView.vue';
import SelfOrderMenuView from '../views/selforder/SelfOrderMenuView.vue';
import SelfOrderItemDetailView from '../views/selforder/SelfOrderItemDetailView.vue';
import SelfOrderOrderStatusView from '../views/selforder/SelfOrderOrderStatusView.vue';
import SelfOrderChatView from '../views/selforder/SelfOrderChatView.vue';

const routes = [
  { path: '/', redirect: '/scan' },
  // QR codes point to #/session/{id}; ScanView parses the session from the hash.
  // Must be a real route (not just a redirect) so ScanView mounts and its
  // onMounted hash-handler can validate the session.
  { path: '/session/:sessionId?', component: SelfOrderScanView, name: 'session' },
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
