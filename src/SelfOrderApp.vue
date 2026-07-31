<template>
  <div
    id="self-order-app"
    class="h-full flex flex-col relative w-full bg-gray-50"
    :style="cssVars"
  >
    <SelfOrderNavbar
      v-if="sessionActive"
      :session="currentSession"
      @back="goBack"
      @show-cart="showCart = true"
      @end-session="confirmEndSession"
    />
    <div class="flex-1 overflow-hidden">
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </div>
    <SelfOrderCartDrawer v-model="showCart" />
    <SelfOrderSessionEndedModal v-model="showSessionEnded" />
    <SelfOrderConfirmOrderModal v-model="showConfirmOrder" @confirm="submitOrder" />
  </div>
</template>

<script setup>
import { ref, computed, provide, onMounted } from 'vue';
import SelfOrderNavbar from './components/selforder/SelfOrderNavbar.vue';
import SelfOrderCartDrawer from './components/selforder/SelfOrderCartDrawer.vue';
import SelfOrderSessionEndedModal from './components/selforder/SelfOrderSessionEndedModal.vue';
import SelfOrderConfirmOrderModal from './components/selforder/SelfOrderConfirmOrderModal.vue';
import { useConfigStore } from './store/index.js';
import { useSelfOrderSession } from './composables/useSelfOrderSession.js';
import { useSelfOrderCart } from './composables/useSelfOrderCart.js';
import { loadDirectusConfigFromStorage } from './composables/useDirectusClient.js';

const configStore = useConfigStore();
const { session, initSession, endSession } = useSelfOrderSession();
const { items, addItem, removeItem, updateQuantity, clearCart } = useSelfOrderCart();

const showCart = ref(false);
const showSessionEnded = ref(false);
const showConfirmOrder = ref(false);
const navigationHistory = ref([]);

const sessionActive = computed(() => session.value !== null);

const currentSession = computed(() => session.value);

const cssVars = computed(() => configStore.cssVars);

provide('selfOrderSession', { session, initSession, endSession });
provide('selfOrderCart', { items, addItem, removeItem, updateQuantity, clearCart });

function goBack() {
  if (navigationHistory.value.length > 0) {
    const prev = navigationHistory.value.pop();
    window.location.hash = prev;
  }
}

function confirmEndSession() {
  showSessionEnded.value = true;
}

async function handleEndSession() {
  await endSession();
  clearCart();
  showSessionEnded.value = false;
  window.location.hash = '/';
}

async function submitOrder() {
  showConfirmOrder.value = false;
  // Order submission is handled in the menu view
}

function navigateTo(route) {
  navigationHistory.value.push(window.location.hash);
  window.location.hash = route;
}

// Load config on mount
onMounted(async () => {
  try {
    await loadDirectusConfigFromStorage();
  } catch (e) {
    console.warn('[SelfOrderApp] Config load failed:', e);
  }
});

provide('navigateTo', navigateTo);
provide('confirmEndSession', confirmEndSession);
provide('submitOrder', submitOrder);
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
