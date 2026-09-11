<template>
  <div
    id="self-order-app"
    class="h-dvh flex flex-col relative w-full bg-gray-50 overflow-hidden"
    :style="cssVars"
  >
    <!-- Header - FIXED at top -->
    <SelfOrderNavbar
      v-if="showHeader"
      :session="currentSession"
      :can-go-back="canGoBack"
      @back="goBack"
      @show-cart="showCart = true"
      @share="showShareSession = true"
      @end-session="confirmEndSession"
      @preferences="showPreferences = true"
      class="shrink-0"
    />

    <!-- Main content area -->
    <main class="flex-1 overflow-y-auto">
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>

    <!-- Mobile bottom navigation - FIXED at bottom -->
    <nav 
      v-if="showBottomNav"
      class="bg-white border-t border-gray-200 px-2 py-2 shrink-0 z-50 md:hidden"
      style="padding-bottom: max(env(safe-area-inset-bottom), 0.5rem);"
    >
      <div class="flex justify-around items-center">
        <button 
          @click="router.push('/menu')"
          class="flex flex-col items-center p-2 rounded-xl transition-colors"
          :class="isActive('/menu') ? 'text-emerald-600' : 'text-gray-400'"
        >
          <UtensilsCrossed class="size-6" />
          <span class="text-[10px] font-bold mt-1">{{ t.navMenu }}</span>
        </button>
        
        <button 
          @click="router.push('/chat')"
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
    <SelfOrderShareSession v-model="showShareSession" :session-id="billSessionId" />
    <SelfOrderPreferencesModal v-model="showPreferences" />
  </div>
</template>

<script setup>
import { ref, computed, provide, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import SelfOrderNavbar from './components/selforder/SelfOrderNavbar.vue';
import SelfOrderCartDrawer from './components/selforder/SelfOrderCartDrawer.vue';
import SelfOrderSessionEndedModal from './components/selforder/SelfOrderSessionEndedModal.vue';
import SelfOrderShareSession from './components/selforder/SelfOrderShareSession.vue';
import SelfOrderPreferencesModal from './components/selforder/SelfOrderPreferencesModal.vue';
import { useConfigStore } from './store/index.js';
import { useSelfOrderCart } from './composables/useSelfOrderCart.js';
import { useSelfOrderAuth } from './composables/useSelfOrderAuth.js';
import { useSelfOrderMenu } from './composables/useSelfOrderMenu.js';
import { useSelfOrderI18n } from './composables/useSelfOrderI18n.js';
import { loadDirectusConfigFromStorage } from './composables/useDirectusClient.js';
import { UtensilsCrossed, ChefHat, ShoppingCart } from 'lucide-vue-next';

const configStore = useConfigStore();
const { items, addItem, removeItem, updateQuantity, clearCart, totalPrice } = useSelfOrderCart();
const { billSessionId, billSession, closeSession: closeAuthSession } = useSelfOrderAuth();
const { menu, loadMenu } = useSelfOrderMenu();
const route = useRoute();
const router = useRouter();

const showCart = ref(false);
const showSessionEnded = ref(false);
const showShareSession = ref(false);
const showPreferences = ref(false);
const navigationHistory = ref([]);

const cartCount = computed(() => items.value.reduce((sum, item) => sum + item.quantity, 0));

const currentSession = computed(() => {
  // The validated bill session loaded from the QR/auth flow.
  if (billSession.value) {
    return {
      id: billSessionId.value,
      table: billSession.value.table,
      table_name: billSession.value.table_name,
      venue: billSession.value.venue,
    };
  }
  return null;
});

// Show header on main app pages
const showHeader = computed(() => {
  const path = route.path;
  return ['/menu', '/chat', '/status', '/item'].some(p => path.startsWith(p));
});

// Show bottom nav on main app pages
const showBottomNav = computed(() => {
  const path = route.path;
  return ['/menu', '/chat', '/status'].includes(path);
});

const cssVars = computed(() => configStore.cssVars);

// Translations — the active language comes from the shared useSelfOrderI18n
// singleton (reactive), so switching language in the navbar updates the
// bottom-nav labels here live too.
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
const { t } = useSelfOrderI18n(i18n);

provide('selfOrderSession', { session: currentSession, endSession: handleEndSession });

function isActive(path) {
  return route.path.includes(path);
}

// In-app navigation back-stack. Bottom-nav tab switches are "roots" and go
// through router.push directly so they don't grow the stack (otherwise back
// would cycle between tabs). Sub-page forward navigations (item detail, chat
// from an action) go through navigateTo(), which records the route being
// left so goBack() can return to it. Using router.push (not raw
// window.location.hash) keeps vue-router's history in sync.
const canGoBack = computed(() => navigationHistory.value.length > 0);

function navigateTo(target) {
  navigationHistory.value.push(route.fullPath);
  router.push(target);
}

function goBack() {
  if (navigationHistory.value.length > 0) {
    const prev = navigationHistory.value.pop();
    router.push(prev);
  } else {
    router.push('/menu');
  }
}

function confirmEndSession() {
  showSessionEnded.value = true;
}

async function handleEndSession() {
  // Close the authenticated bill session via the customer token, then clear the
  // local cart.
  try {
    if (billSessionId.value) {
      await closeAuthSession();
    }
  } catch (e) {
    console.warn('[SelfOrderApp] End session failed:', e);
  }
  clearCart();
  showSessionEnded.value = false;
  window.location.hash = '/';
}

function formatPrice(price) {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR'
  }).format(price);
}

// Load config and menu on mount
onMounted(async () => {
  try {
    await loadDirectusConfigFromStorage();
    // Load menu for all views
    await loadMenu();
  } catch (e) {
    console.warn('[SelfOrderApp] Init failed:', e);
  }
});

provide('navigateTo', navigateTo);
provide('goBack', goBack);
provide('confirmEndSession', confirmEndSession);
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
