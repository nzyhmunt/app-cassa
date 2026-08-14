<template>
  <Teleport to="body">
    <Transition name="slide-up">
      <div 
        v-if="modelValue"
        class="fixed inset-0 z-50 flex flex-col justify-end md:justify-center md:items-center md:p-4"
      >
        <div 
          class="absolute inset-0 bg-black/50"
          @click="$emit('update:modelValue', false)"
        ></div>
        
        <div class="relative bg-white rounded-t-3xl md:rounded-2xl md:max-w-md md:max-h-[80vh] w-full flex flex-col max-h-[85vh]">
          <!-- Handle -->
          <div class="flex justify-center py-3 md:hidden">
            <div class="w-12 h-1 bg-gray-300 rounded-full"></div>
          </div>
          
          <!-- Header -->
          <div class="px-4 pb-3 border-b border-gray-100 flex items-center justify-between shrink-0">
            <div class="flex items-center gap-3">
              <ShoppingBag class="size-5 theme-text" />
              <h2 class="text-lg font-bold text-gray-800">{{ t.ilTuoOrdine }}</h2>
              <span v-if="totalItems > 0" class="bg-gray-100 text-gray-600 text-xs font-bold px-2 py-1 rounded-full">
                {{ totalItems }} {{ t.art }}
              </span>
            </div>
            <button 
              v-if="items.length > 0"
              class="p-2 text-gray-400 hover:text-red-500 transition-colors rounded-full hover:bg-gray-100"
              @click="showClearConfirm = true"
            >
              <Trash2 class="w-5 h-5" />
            </button>
            <button 
              class="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center"
              @click="$emit('update:modelValue', false)"
            >
              <X class="w-5 h-5 text-gray-600" />
            </button>
          </div>
          
          <!-- Order History -->
          <div v-if="orderHistory.length > 0" class="px-4 pt-3 pb-2 border-b border-gray-100 shrink-0">
            <button 
              class="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-700"
              @click="showHistory = !showHistory"
            >
              <History class="w-4 h-4" />
              {{ t.cronologiaOrdini }}
              <ChevronDown class="w-4 h-4 transition-transform" :class="showHistory ? 'rotate-180' : ''" />
            </button>
            <div v-if="showHistory" class="mt-2 space-y-2">
              <div 
                v-for="(order, idx) in orderHistory"
                :key="idx"
                class="bg-gray-50 rounded-xl p-3"
              >
                <div class="flex justify-between text-xs text-gray-500">
                  <span><Clock class="w-3 h-3 inline mr-1" />{{ t.ordineInviato }} {{ order.time }}</span>
                  <span class="theme-text font-bold">{{ currency }}{{ order.total.toFixed(2) }}</span>
                </div>
              </div>
            </div>
          </div>
          
          <!-- Items list -->
          <div class="flex-1 overflow-y-auto p-4">
            <div v-if="items.length === 0" class="text-center py-8">
              <ShoppingCart class="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p class="text-gray-500">{{ t.ordineVuoto }}</p>
            </div>
            
            <div v-else class="space-y-4">
              <div
                v-for="item in items"
                :key="item.id"
                class="flex gap-3 items-start"
              >
                <div class="flex-1 min-w-0">
                  <h3 class="font-medium text-gray-800 text-sm">{{ item.name }}</h3>
                  <p v-if="item.modifiers?.length" class="text-xs text-gray-500 mt-0.5">
                    {{ formatModifiers(item.modifiers) }}
                  </p>
                  <p class="theme-text font-bold text-sm mt-1">
                    {{ currency }}{{ itemPrice(item).toFixed(2) }}
                  </p>
                </div>
                
                <div class="flex items-center gap-1 bg-gray-100 rounded-full p-1">
                  <button 
                    class="w-7 h-7 rounded-full bg-white flex items-center justify-center shadow-sm"
                    @click="removeItem(item.id)"
                  >
                    <Minus class="w-3 h-3 text-gray-600" />
                  </button>
                  <span class="w-6 text-center font-bold text-sm">{{ item.quantity }}</span>
                  <button 
                    class="w-7 h-7 rounded-full bg-white flex items-center justify-center shadow-sm"
                    @click="updateQuantity(item.id, item.quantity + 1)"
                  >
                    <Plus class="w-3 h-3 text-emerald-600" />
                  </button>
                </div>
              </div>
            </div>
          </div>
          
          <!-- Footer with total and checkout -->
          <div v-if="items.length > 0" class="p-4 border-t border-gray-100 bg-gray-50 shrink-0">
            <div class="flex justify-between items-center mb-4">
              <span class="text-sm font-bold text-gray-600 uppercase tracking-wider">{{ t.totale }}</span>
              <span class="text-2xl font-black theme-text">{{ currency }}{{ totalPrice.toFixed(2) }}</span>
            </div>
            
            <button 
              class="w-full py-4 theme-bg text-white rounded-xl font-bold text-lg shadow-md transition-all active:scale-[0.98] flex items-center justify-center gap-2"
              :disabled="submitting"
              @click="handleCheckout"
            >
              <span v-if="submitting" class="animate-spin">
                <Loader2 class="w-5 h-5" />
              </span>
              {{ submitting ? t.invioInCorso : t.confermaOrdine }}
            </button>
          </div>
        </div>

        <!-- Clear cart confirmation -->
        <div 
          v-if="showClearConfirm"
          class="absolute inset-0 bg-black/50 flex items-center justify-center p-4 z-60"
          @click.self="showClearConfirm = false"
        >
          <div class="bg-white rounded-2xl p-6 w-full max-w-sm text-center">
            <h3 class="text-lg font-bold mb-2">{{ t.vuoiSvuotare }}</h3>
            <div class="flex gap-3 mt-4">
              <button 
                class="flex-1 py-3 bg-gray-100 text-gray-700 rounded-xl font-bold"
                @click="showClearConfirm = false"
              >
                {{ t.annulla }}
              </button>
              <button 
                class="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold shadow-md"
                @click="handleClearCart"
              >
                {{ t.svuota }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useSelfOrderI18n } from '../../composables/useSelfOrderI18n.js';
import { X, ShoppingCart, ShoppingBag, Minus, Plus, Trash2, History, Clock, ChevronDown, Loader2 } from 'lucide-vue-next';
import { useSelfOrderCart } from '../../composables/useSelfOrderCart.js';
import { useSelfOrderAuth } from '../../composables/useSelfOrderAuth.js';
import { useSelfOrderMenu } from '../../composables/useSelfOrderMenu.js';
import { useConfigStore } from '../../store/index.js';

const props = defineProps({
  modelValue: { type: Boolean, required: true }
});

const emit = defineEmits(['update:modelValue']);

const { items, removeItem, updateQuantity, clearCart, buildOrderPayload } = useSelfOrderCart();
const { billSessionId, fetchSessionOrders, saveLocalOrder, billSession, createOrder } = useSelfOrderAuth();
const { calculateCartTotal, getItemPrice, getModifierPrice } = useSelfOrderMenu();
const configStore = useConfigStore();

// Calculate totals from MENU prices (trusted source), not from client cart
const cartTotals = computed(() => {
  return calculateCartTotal(items.value);
});

const totalPrice = computed(() => cartTotals.value.total);
const totalItems = computed(() => cartTotals.value.itemCount);

const showClearConfirm = ref(false);
const showHistory = ref(false);
const showSuccess = ref(false);
const orderHistory = ref([]);
const loadingHistory = ref(false);
const submitting = ref(false);

// Load order history when drawer opens
watch(() => props.modelValue, async (visible) => {
  if (visible) {
    await loadOrderHistory();
  }
});

// Translations
const i18n = {
  it: {
    ilTuoOrdine: 'Il Tuo Ordine',
    art: 'art.',
    ordineVuoto: 'Il tuo carrello è vuoto.',
    totale: 'Totale',
    confermaOrdine: 'Invia Ordine',
    invioInCorso: 'Invio in corso...',
    orderConfermato: 'Ordine confermato!',
    cronologiaOrdini: 'Ordini Tavolo',
    ordineInviato: 'Inviato alle',
    vuoiSvuotare: 'Svuotare il carrello?',
    annulla: 'Annulla',
    svuota: 'Svuota',
    currency: '€',
    caricamento: 'Caricamento...',
  },
  en: {
    ilTuoOrdine: 'Your Order',
    art: 'items',
    ordineVuoto: 'Your cart is empty.',
    totale: 'Total',
    confermaOrdine: 'Submit Order',
    invioInCorso: 'Sending...',
    orderConfermato: 'Order confirmed!',
    cronologiaOrdini: 'Table Orders',
    ordineInviato: 'Sent at',
    vuoiSvuotare: 'Clear the cart?',
    annulla: 'Cancel',
    svuota: 'Clear',
    currency: '€',
    caricamento: 'Loading...',
  }
};

const { t, currentLang } = useSelfOrderI18n(i18n);
const currency = computed(() => t.value.currency);

onMounted(() => {
  loadOrderHistory();
});

async function loadOrderHistory() {
  loadingHistory.value = true;
  try {
    if (billSessionId.value) {
      // Load from API (shared across all customers at this table)
      const orders = await fetchSessionOrders();
      orderHistory.value = orders.map(o => ({
        id: o.id,
        time: new Date(o.date_created || o.localTime).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
        items: (o.order_items || o.righe_ordine || o.items || []).map(it => ({
          id: it.id || it.uid,
          name: it.name,
          quantity: it.quantity || 0,
          modifiers: it.order_item_modifiers || it.modifiers || [],
        })),
        total: Number(o.total_amount != null ? o.total_amount : (o.totale_importo || o.total || 0)),
        status: o.status,
        dietary_diets: o.dietary_diets || [],
        dietary_allergens: o.dietary_allergens || [],
      }));
    }
  } catch (e) {
    console.warn('[SelfOrder] Failed to load history:', e);
  } finally {
    loadingHistory.value = false;
  }
}

// Calculate item price from MENU (trusted source, not from cart)
function itemPrice(item) {
  const basePrice = getItemPrice(item.menuItemId) * item.quantity;
  const modifiersPrice = item.modifiers?.reduce((sum, m) => sum + (m.price || 0) * item.quantity, 0) || 0;
  return basePrice + modifiersPrice;
}

function formatModifiers(modifiers) {
  return modifiers.map(m => m.name).join(', ');
}

function handleClearCart() {
  clearCart();
  showClearConfirm.value = false;
}

async function handleCheckout() {
  if (items.value.length > 0) {
    if (!billSessionId.value) {
      alert('Sessione non valida. Riprova.');
      return;
    }
    
    submitting.value = true;
    
    try {
      // Get customer preferences (per-client, not per-session)
      const prefs = getCustomerPreferences();

      // Build order_items using the Directus O2M relational field name
      // (`order_items`) — not `items` — so nested rows are actually created.
      // Each item carries unit_price from the (public) menu to satisfy the
      // NOT NULL constraint on order_items.unit_price; the cassa may still
      // recompute/override it when the order is accepted.
      const orderPayload = {
        ...buildOrderPayload(billSessionId.value),
        venue: billSession.value?.venue || configStore.config?.venueId || 1,
        table: billSession.value?.table || localStorage.getItem('selforder_table') || '1',
        order_time: new Date().toTimeString().slice(0, 5),
        dietary_diets: prefs.diete,
        dietary_allergens: prefs.allergeni,
        global_note: '',
        is_direct_entry: false,
      };

      // Send to Directus API
      const result = await createOrder(orderPayload);

      // Save to local history for demo/offline
      saveLocalOrder({
        ...orderPayload,
        id: result?.id || `local_${Date.now()}`,
        localTime: new Date().toISOString(),
      });
      
      // Reload history to show the new order
      await loadOrderHistory();
      
      // Clear cart after successful checkout
      clearCart();
      
      // Show success message
      showSuccess.value = true;
      setTimeout(() => { showSuccess.value = false; }, 3000);
      
    } catch (e) {
      console.error('[SelfOrder] Checkout failed:', e);
      alert('Errore nell\'invio dell\'ordine. Riprova.');
    } finally {
      submitting.value = false;
    }
  }
  
  emit('update:modelValue', false);
}

// Get customer preferences from localStorage
function getCustomerPreferences() {
  const savedPrefs = localStorage.getItem('selforder_preferences');
  if (savedPrefs) {
    try {
      const prefs = JSON.parse(savedPrefs);
      const diete = Object.entries(prefs.diet || {})
        .filter(([_, v]) => v)
        .map(([k]) => k);
      const allergeni = Object.entries(prefs.allergens || {})
        .filter(([_, v]) => v)
        .map(([k]) => k.replace(/_/g, ' '));
      return { diete, allergeni };
    } catch {
      return { diete: [], allergeni: [] };
    }
  }
  return { diete: [], allergeni: [] };
}
</script>

<style scoped>
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateY(100%);
}

.z-60 {
  z-index: 60;
}
</style>
