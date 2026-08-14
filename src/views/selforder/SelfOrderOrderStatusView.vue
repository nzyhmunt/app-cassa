<template>
  <div class="h-full flex flex-col bg-gray-50">
    <div class="bg-white px-4 py-4 border-b border-gray-100">
      <h1 class="text-lg font-bold text-gray-800">Stato Ordine</h1>
      <p class="text-sm text-gray-500">I tuoi ordini in tempo reale</p>
    </div>

    <div class="flex-1 overflow-y-auto p-4">
      <div v-if="orders.length === 0" class="text-center py-12">
        <ClipboardList class="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <p class="text-gray-500">Nessun ordine ancora</p>
        <button 
          class="mt-4 px-6 py-2 bg-emerald-600 text-white rounded-xl font-medium"
          @click="goToMenu"
        >
          Vai al Menu
        </button>
      </div>

      <div v-else class="space-y-4">
        <div
          v-for="order in orders"
          :key="order.id"
          class="bg-white rounded-xl p-4 shadow-sm"
        >
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm text-gray-500">
              {{ formatTime(order.date_created) }}
            </span>
            <span 
              class="px-3 py-1 rounded-full text-xs font-medium"
              :class="statusClass(order.status)"
            >
              {{ statusLabel(order.status) }}
            </span>
          </div>

          <div class="space-y-2">
            <div
              v-for="orderItem in order.items"
              :key="orderItem.id || orderItem.uid"
              class="flex justify-between text-sm"
            >
              <span>
                {{ orderItem.quantity }}x {{ orderItem.name }}
              </span>
              <span class="text-gray-600">
                {{ formatPrice((orderItem.price || 0) * (orderItem.quantity || 0)) }}
              </span>
            </div>
          </div>

          <div class="mt-3 pt-3 border-t border-gray-100 flex justify-between font-bold">
            <span>Totale</span>
            <span class="text-emerald-600">{{ formatPrice(order.total || 0) }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="p-4 bg-white border-t border-gray-100">
      <button 
        class="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold"
        @click="goToMenu"
      >
        Aggiungi altri articoli
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { ClipboardList } from 'lucide-vue-next';
import { useSelfOrderCart } from '../../composables/useSelfOrderCart.js';
import { useSelfOrderSession } from '../../composables/useSelfOrderSession.js';
import { useSelfOrderAuth } from '../../composables/useSelfOrderAuth.js';

const router = useRouter();
const { items } = useSelfOrderCart();
const { session } = useSelfOrderSession();
const { billSessionId, fetchSessionOrders } = useSelfOrderAuth();

const orders = ref([]);

const statusMap = {
  pending: { label: 'In attesa', class: 'bg-yellow-100 text-yellow-700' },
  accepted: { label: 'Accettato', class: 'bg-blue-100 text-blue-700' },
  preparing: { label: 'In preparazione', class: 'bg-orange-100 text-orange-700' },
  ready: { label: 'Pronto', class: 'bg-emerald-100 text-emerald-700' },
  delivered: { label: 'Consegnato', class: 'bg-gray-100 text-gray-600' },
};

function statusLabel(status) {
  return statusMap[status]?.label || status;
}

function statusClass(status) {
  return statusMap[status]?.class || 'bg-gray-100 text-gray-600';
}

function formatTime(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatPrice(price) {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR'
  }).format(price);
}

function goToMenu() {
  router.push('/menu');
}

async function loadOrders() {
  const sessionId = billSessionId.value || session.value?.id;
  if (!sessionId) return;

  // Prefer the API (shared across all customers at the table); fall back to the
  // local order history persisted by useSelfOrderAuth.saveLocalOrder.
  let rawOrders = [];
  try {
    const apiOrders = await fetchSessionOrders();
    if (apiOrders && apiOrders.length > 0) rawOrders = apiOrders;
  } catch (e) {
    console.warn('[SelfOrder] Failed to load orders from API:', e);
  }

  if (rawOrders.length === 0) {
    const savedOrders = sessionStorage.getItem(`selforder_orders_${sessionId}`);
    if (savedOrders) {
      try { rawOrders = JSON.parse(savedOrders); } catch { rawOrders = []; }
    }
  }

  // Normalize to the shape the template expects: items[], total, date_created,
  // status — regardless of whether the source is the Directus API (snake_case
  // order_items/total_amount) or a locally-saved payload.
  orders.value = rawOrders.map(normalizeOrder);
}

function normalizeOrder(o) {
  const items = (o.order_items || o.items || []).map(it => ({
    id: it.id || it.uid,
    uid: it.uid,
    name: it.name,
    quantity: it.quantity || 0,
    price: it.unit_price != null ? it.unit_price : (it.price || 0),
  }));
  const total = o.total_amount != null ? o.total_amount : (o.total || 0);
  return {
    ...o,
    id: o.id,
    status: o.status,
    date_created: o.date_created || o.localTime || o.createdAt,
    items,
    total,
  };
}

onMounted(() => {
  loadOrders();
});

onUnmounted(() => {});
</script>
