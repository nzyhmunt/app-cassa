<template>
  <div
    id="self-order-app"
    class="h-full flex flex-col relative w-full bg-gray-50"
    :style="cssVars"
  >
    <!-- Header with session info -->
    <SelfOrderNavbar
      v-if="showHeader"
      :session="currentSession"
      @back="goBack"
      @show-cart="showCart = true"
      @share="showShareSession = true"
      @end-session="confirmEndSession"
    />

    <!-- Main content area -->
    <div class="flex-1 overflow-hidden flex flex-col">
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </div>

    <!-- Mobile bottom navigation -->
    <nav 
      v-if="showBottomNav"
      class="bg-white border-t border-gray-200 px-2 py-2 pb-safe shrink-0 z-40 md:hidden"
    >
      <div class="flex justify-around items-center">
        <button 
          @click="navigateTo('/menu')"
          class="flex flex-col items-center p-2 rounded-xl transition-colors"
          :class="isActive('/menu') ? 'text-emerald-600' : 'text-gray-400'"
        >
          <UtensilsCrossed class="size-6" />
          <span class="text-[10px] font-bold mt-1">{{ t.navMenu }}</span>
        </button>
        
        <button 
          @click="navigateTo('/chat')"
          class="flex flex-col items-center p-2 rounded-xl transition-colors"
          :class="isActive('/chat') ? 'text-purple-600' : 'text-gray-400'"
        >
          <ChefHat class="size-6" />
          <span class="text-[10px] font-bold mt-1">{{ t.navChat }}</span>
        </button>
        
        <button 
          @click="showCart = true"
          class="flex flex-col items-center p-2 rounded-xl transition-colors relative"
          :class="isActive('/cart') || showCart ? 'text-emerald-600' : 'text-gray-400'"
        >
          <ShoppingCart class="size-6" />
          <span class="text-[10px] font-bold mt-1">{{ t.navCart }}</span>
          <span 
            v-if="cartCount > 0"
            class="absolute -top-1 right-0 bg-red-500 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-bold"
          >
            {{ cartCount > 9 ? '9+' : cartCount }}
          </span>
        </button>
      </div>
    </nav>

    <!-- Desktop sidebar cart toggle -->
    <button 
      v-if="showBottomNav && cartCount > 0"
      @click="showCart = true"
      class="hidden md:flex fixed bottom-6 right-6 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-4 rounded-2xl shadow-lg items-center gap-3 z-40 transition-all active:scale-95"
    >
      <ShoppingCart class="size-6" />
      <span class="font-bold">{{ cartCount }} {{ t.art }}</span>
      <span class="font-black">{{ formatPrice(totalPrice) }}</span>
    </button>

    <!-- Modals -->
    <SelfOrderCartDrawer v-model="showCart" />
    <SelfOrderSessionEndedModal v-model="showSessionEnded" />
    <SelfOrderConfirmOrderModal v-model="showConfirmOrder" @confirm="submitOrder" />
    <SelfOrderShareSession v-model="showShareSession" :session-id="billSessionId" />
  </div>
</template>

<script setup>
import { ref, computed, provide, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import SelfOrderCartDrawer from './components/selforder/SelfOrderCartDrawer.vue';
import SelfOrderSessionEndedModal from './components/selforder/SelfOrderSessionEndedModal.vue';
import SelfOrderConfirmOrderModal from './components/selforder/SelfOrderConfirmOrderModal.vue';
import SelfOrderShareSession from './components/selforder/SelfOrderShareSession.vue';
import { useConfigStore } from './store/index.js';
import { useSelfOrderSession } from './composables/useSelfOrderSession.js';
import { useSelfOrderCart } from './composables/useSelfOrderCart.js';
import { useSelfOrderAuth } from './composables/useSelfOrderAuth.js';
import { loadDirectusConfigFromStorage } from './composables/useDirectusClient.js';
import { UtensilsCrossed, ChefHat, ShoppingCart } from 'lucide-vue-next';

const configStore = useConfigStore();
const { session, initSession, endSession } = useSelfOrderSession();
const { items, addItem, removeItem, updateQuantity, clearCart, totalPrice } = useSelfOrderCart();
const { billSessionId } = useSelfOrderAuth();
const route = useRoute();

const showCart = ref(false);
const showSessionEnded = ref(false);
const showConfirmOrder = ref(false);
const showShareSession = ref(false);
const navigationHistory = ref([]);

const cartCount = computed(() => items.value.reduce((sum, item) => sum + item.quantity, 0));

const currentSession = computed(() => session.value);

// Show header only when session is active
const showHeader = computed(() => {
  const path = window.location.hash.replace('#', '');
  return ['/menu', '/chat', '/status', '/item'].some(p => path.startsWith(p));
});

// Show bottom nav only on menu pages (not on scan/welcome)
const showBottomNav = computed(() => {
  const path = window.location.hash.replace('#', '');
  return ['/menu', '/chat', '/status'].includes(path);
});

const cssVars = computed(() => configStore.cssVars);

// Translations
const currentLang = ref(localStorage.getItem('selforder_lang') || 'it');
const i18n = {
  it: {
    navMenu: 'Menu',
    navChat: 'Chef IA',
    navCart: 'Ordine',
    art: 'art.',
  },
  en: {
    navMenu: 'Menu',
    navChat: 'AI Chef',
    navCart: 'Order',
    art: 'items',
  }
};
const t = computed(() => i18n[currentLang.value] || i18n.it);

provide('selfOrderSession', { session, initSession, endSession });
provide('selfOrderCart', { items, addItem, removeItem, updateQuantity, clearCart });

function isActive(path) {
  return window.location.hash.includes(path);
}

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

function formatPrice(price) {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR'
  }).format(price);
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

.pb-safe {
  padding-bottom: max(env(safe-area-inset-bottom), 0.5rem);
}
</style>
