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
              class="w-full py-4 theme-bg text-white rounded-xl font-bold text-lg shadow-md transition-all active:scale-[0.98]"
              @click="handleCheckout"
            >
              {{ t.confermaOrdine }}
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
import { X, ShoppingCart, ShoppingBag, Minus, Plus, Trash2, History, Clock, ChevronDown } from 'lucide-vue-next';
import { useSelfOrderCart } from '../../composables/useSelfOrderCart.js';
import { useSelfOrderAuth } from '../../composables/useSelfOrderAuth.js';
import { useConfigStore } from '../../store/index.js';

const props = defineProps({
  modelValue: { type: Boolean, required: true }
});

const emit = defineEmits(['update:modelValue']);

const { items, totalPrice, totalItems, removeItem, updateQuantity, clearCart } = useSelfOrderCart();
const { billSessionId, fetchSessionOrders, saveLocalOrder, billSession } = useSelfOrderAuth();
const configStore = useConfigStore();

const showClearConfirm = ref(false);
const showHistory = ref(false);
const orderHistory = ref([]);
const loadingHistory = ref(false);

// Load order history when drawer opens
watch(() => props.modelValue, async (visible) => {
  if (visible) {
    await loadOrderHistory();
  }
});

// Translations
const currentLang = ref(localStorage.getItem('selforder_lang') || 'it');
const i18n = {
  it: {
    ilTuoOrdine: 'Il Tuo Ordine',
    art: 'art.',
    ordineVuoto: 'Il tuo carrello è vuoto.',
    totale: 'Totale',
    confermaOrdine: 'Invia Ordine',
    cronologiaOrdini: 'Ordini Tavolo', // Changed to indicate shared history
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
    cronologiaOrdini: 'Table Orders', // Changed to indicate shared history
    ordineInviato: 'Sent at',
    vuoiSvuotare: 'Clear the cart?',
    annulla: 'Cancel',
    svuota: 'Clear',
    currency: '€',
    caricamento: 'Loading...',
  }
};

const t = computed(() => i18n[currentLang.value] || i18n.it);
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
        time: new Date(o.date_created).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
        items: o.righe_ordine || o.items || [],
        total: o.total_amount || o.totale_importo || 0,
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

function itemPrice(item) {
  const basePrice = item.price * item.quantity;
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
    
    // Get customer preferences (per-client, not per-session)
    const prefs = getCustomerPreferences();
    
    // Create order payload aligned with Directus schema
    const orderPayload = {
      bill_session: billSessionId.value, // REQUIRED - links to open bill session
      venue: billSession.value?.venue || configStore.config?.venueId || 1,
      table: billSession.value?.table || localStorage.getItem('selforder_table') || '1',
      status: 'pending', // Always pending, must be accepted by staff
      order_time: new Date().toTimeString().slice(0, 5), // 'HH:MM'
      total_amount: totalPrice.value,
      item_count: totalItems.value,
      dietary_diets: prefs.diete, // Per-customer preferences
      dietary_allergens: prefs.allergeni, // Per-customer allergies
      global_note: '',
      is_direct_entry: false,
      // Order items (righe_ordine)
      items: items.value.map((c, idx) => ({
        uid: `r_${idx + 1}`, // Unique within order
        dish: c.menuItemId,
        name: c.name,
        unit_price: c.price,
        quantity: c.quantity,
        notes: c.notes ? [c.notes] : [],
        modifiers: c.modifiers?.map(m => m.name) || [],
      })),
    };
    
    console.log('[SelfOrder] Order payload:', JSON.stringify(orderPayload, null, 2));
    
    // Save to local history for demo/offline
    saveLocalOrder({
      ...orderPayload,
      localTime: new Date().toISOString(),
    });
    
    // Reload history to show the new order
    await loadOrderHistory();
    
    // Clear cart after checkout
    clearCart();
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
