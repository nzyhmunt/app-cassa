<template>
  <!-- Kitchen Display System — light theme matching Cassa & Sala -->
  <div class="h-full flex flex-col overflow-hidden select-none bg-gray-100">

    <!-- ── Header ─────────────────────────────────────────────────────────── -->
    <header class="theme-bg text-white shrink-0 flex items-center justify-between px-4 py-3 shadow-md h-16 md:h-20">
      <div class="flex items-center gap-2 md:gap-3">
        <div class="bg-white/20 p-2 rounded-xl flex items-center justify-center">
          <ChefHat class="size-5 md:size-6" />
        </div>
        <div>
          <p class="font-bold text-sm md:text-xl leading-none">{{ store.config.ui.name }}</p>
          <p class="text-white/80 text-[9px] md:text-xs uppercase tracking-wider mt-0.5 font-bold">App Cucina</p>
        </div>
      </div>

      <!-- Status counters + clock -->
      <div class="flex items-center gap-2 md:gap-3">
        <div v-if="pendingOrders.length > 0"
             class="flex items-center gap-1.5 bg-amber-100 text-amber-800 border border-amber-200 rounded-full px-3 py-1 text-xs font-bold">
          <span class="bg-amber-500 text-white rounded-full font-black text-[10px] size-5 flex items-center justify-center shrink-0">
            {{ pendingOrders.length }}
          </span>
          <span class="hidden sm:inline uppercase tracking-wide">In Attesa</span>
        </div>
        <div v-if="preparingOrders.length > 0"
             class="flex items-center gap-1.5 bg-orange-100 text-orange-800 border border-orange-200 rounded-full px-3 py-1 text-xs font-bold">
          <span class="bg-orange-500 text-white rounded-full font-black text-[10px] size-5 flex items-center justify-center shrink-0">
            {{ preparingOrders.length }}
          </span>
          <span class="hidden sm:inline uppercase tracking-wide">In Cottura</span>
        </div>
        <div v-if="readyOrders.length > 0"
             class="flex items-center gap-1.5 bg-teal-100 text-teal-800 border border-teal-200 rounded-full px-3 py-1 text-xs font-bold">
          <span class="bg-teal-500 text-white rounded-full font-black text-[10px] size-5 flex items-center justify-center shrink-0">
            {{ readyOrders.length }}
          </span>
          <span class="hidden sm:inline uppercase tracking-wide">Pronte</span>
        </div>
        <p class="font-mono font-bold text-sm text-white/80 hidden md:block">{{ currentTime }}</p>
        <button
          @click="syncFromStorage"
          class="bg-white/10 hover:bg-white/20 p-2 rounded-xl transition-colors"
          title="Aggiorna"
        >
          <RefreshCw class="size-4" />
        </button>
      </div>
    </header>

    <!-- ── Scrollable kanban board ─────────────────────────────────────────── -->
    <main class="flex-1 overflow-y-auto md:overflow-hidden p-3 md:p-4" style="overscroll-behavior:contain;">

      <!-- Empty state -->
      <div v-if="pendingOrders.length === 0 && preparingOrders.length === 0 && readyOrders.length === 0"
           class="flex flex-col items-center justify-center h-full gap-4 py-16">
        <ChefHat class="size-16 text-gray-300" />
        <p class="text-xl font-bold text-gray-400">Nessun ordine attivo</p>
        <p class="text-sm text-gray-400">Gli ordini arrivano qui non appena vengono inviati dalla sala.</p>
      </div>

      <!-- 3-column kanban: stacked on mobile, side-by-side on desktop -->
      <div v-else class="h-full flex flex-col md:flex-row gap-3">

        <!-- ── Column 1: IN ATTESA (pending) ──────────────────────────────── -->
        <section class="md:flex-1 md:flex md:flex-col md:min-h-0">
          <div class="flex items-center gap-2 mb-2 shrink-0">
            <Bell class="size-4 text-amber-600" />
            <h2 class="text-xs font-black uppercase tracking-widest text-amber-700">
              In Attesa
            </h2>
            <span class="ml-auto bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-black rounded-full px-2 py-0.5">
              {{ pendingOrders.length }}
            </span>
          </div>

          <div v-if="pendingOrders.length === 0"
               class="flex-1 flex items-center justify-center rounded-2xl py-10 bg-white border-2 border-dashed border-gray-200">
            <p class="text-sm font-semibold text-gray-400">Nessun ordine in attesa</p>
          </div>

          <div v-else class="md:flex-1 md:overflow-y-auto space-y-3">
            <article
              v-for="order in pendingOrders"
              :key="order.id"
              class="bg-white rounded-2xl border-2 border-amber-300 shadow-sm overflow-hidden"
              :aria-label="`Ordine tavolo ${order.table} in attesa`"
            >
              <KitchenOrderCard
                :order="order"
                status-label="In Attesa"
                status-class="bg-amber-100 text-amber-800 border-amber-200"
                qty-class="text-amber-600"
                :elapsed-label="elapsedLabel(order.time)"
                :elapsed-color="elapsedColor(order.time)"
                action-label="Prendi in carico"
                action-class="theme-bg text-white hover:opacity-90"
                @action="acceptOrder(order)"
              />
            </article>
          </div>
        </section>

        <!-- ── Column 2: IN PREPARAZIONE (accepted + preparing) ──────────── -->
        <section class="md:flex-1 md:flex md:flex-col md:min-h-0">
          <div class="flex items-center gap-2 mb-2 shrink-0">
            <Flame class="size-4 text-orange-600" />
            <h2 class="text-xs font-black uppercase tracking-widest text-orange-700">
              In Preparazione
            </h2>
            <span class="ml-auto bg-orange-100 text-orange-800 border border-orange-200 text-[10px] font-black rounded-full px-2 py-0.5">
              {{ preparingOrders.length }}
            </span>
          </div>

          <div v-if="preparingOrders.length === 0"
               class="flex-1 flex items-center justify-center rounded-2xl py-10 bg-white border-2 border-dashed border-gray-200">
            <p class="text-sm font-semibold text-gray-400">Nessuna comanda in preparazione</p>
          </div>

          <div v-else class="md:flex-1 md:overflow-y-auto space-y-3">
            <article
              v-for="order in preparingOrders"
              :key="order.id"
              class="bg-white rounded-2xl border-2 border-orange-300 shadow-sm overflow-hidden"
              :aria-label="`Ordine tavolo ${order.table} in preparazione`"
            >
              <KitchenOrderCard
                :order="order"
                :status-label="order.status === 'accepted' ? 'In Cucina' : 'In Cottura'"
                :status-class="order.status === 'accepted' ? 'bg-blue-100 text-blue-800 border-blue-200' : 'bg-orange-100 text-orange-800 border-orange-200'"
                qty-class="text-orange-600"
                :elapsed-label="elapsedLabel(order.time)"
                :elapsed-color="elapsedColor(order.time)"
                :action-label="order.status === 'accepted' ? 'Inizia cottura' : 'Segna pronta'"
                action-class="bg-orange-500 text-white hover:bg-orange-600"
                @action="advancePreparingOrder(order)"
              />
            </article>
          </div>
        </section>

        <!-- ── Column 3: PRONTE (ready) ───────────────────────────────────── -->
        <section class="md:flex-1 md:flex md:flex-col md:min-h-0">
          <div class="flex items-center gap-2 mb-2 shrink-0">
            <BellRing class="size-4 text-teal-600" />
            <h2 class="text-xs font-black uppercase tracking-widest text-teal-700">
              Pronte
            </h2>
            <span class="ml-auto bg-teal-100 text-teal-800 border border-teal-200 text-[10px] font-black rounded-full px-2 py-0.5">
              {{ readyOrders.length }}
            </span>
          </div>

          <div v-if="readyOrders.length === 0"
               class="flex-1 flex items-center justify-center rounded-2xl py-10 bg-white border-2 border-dashed border-gray-200">
            <p class="text-sm font-semibold text-gray-400">Nessuna comanda pronta</p>
          </div>

          <div v-else class="md:flex-1 md:overflow-y-auto space-y-3">
            <article
              v-for="order in readyOrders"
              :key="order.id"
              class="bg-white rounded-2xl border-2 border-teal-400 shadow-sm overflow-hidden"
              :aria-label="`Ordine tavolo ${order.table} pronto`"
            >
              <KitchenOrderCard
                :order="order"
                status-label="Pronta"
                status-class="bg-teal-100 text-teal-800 border-teal-200"
                qty-class="text-teal-600"
                :elapsed-label="elapsedLabel(order.time)"
                :elapsed-color="elapsedColor(order.time)"
                action-label="Consegnata ✓"
                action-class="bg-emerald-600 text-white hover:bg-emerald-700"
                @action="completeOrder(order)"
              />
            </article>
          </div>
        </section>

      </div>
    </main>

    <!-- ── Footer ─────────────────────────────────────────────────────────── -->
    <footer class="shrink-0 flex items-center justify-between px-4 py-2 bg-white border-t border-gray-200 text-xs text-gray-400">
      <span>Aggiornato: {{ lastSyncLabel }}</span>
      <span class="font-mono">{{ currentTime }}</span>
    </footer>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { Bell, BellRing, ChefHat, Flame, RefreshCw } from 'lucide-vue-next';
import { useAppStore } from '../../store/index.js';
import { resolveStorageKeys, getInstanceName } from '../../store/persistence.js';
import KitchenOrderCard from './KitchenOrderCard.vue';

const store = useAppStore();

// Resolve the storage key once at setup time — it never changes at runtime
const { storageKey } = resolveStorageKeys(getInstanceName());

// ── Live clock ─────────────────────────────────────────────────────────────
const currentTime = ref(new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }));
let clockTimer = null;

// ── Cross-tab sync ──────────────────────────────────────────────────────────
const lastSyncLabel = ref('—');

function syncFromStorage() {
  store.$hydrate?.();
  lastSyncLabel.value = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function onStorageChange(event) {
  if (event.key !== storageKey) return;
  syncFromStorage();
}

let refreshTimer = null;

onMounted(() => {
  clockTimer = setInterval(() => {
    currentTime.value = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }, 60_000);

  window.addEventListener('storage', onStorageChange);

  refreshTimer = setInterval(syncFromStorage, 30_000);

  lastSyncLabel.value = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
});

onUnmounted(() => {
  clearInterval(clockTimer);
  clearInterval(refreshTimer);
  window.removeEventListener('storage', onStorageChange);
});

// ── Computed order lists ────────────────────────────────────────────────────
const pendingOrders = computed(() =>
  store.orders.filter(o => o.status === 'pending').slice().sort((a, b) => a.time.localeCompare(b.time)),
);

// "In Preparazione" column shows both 'accepted' (just picked up) and 'preparing' (cooking)
const preparingOrders = computed(() =>
  store.orders
    .filter(o => o.status === 'accepted' || o.status === 'preparing')
    .slice()
    .sort((a, b) => a.time.localeCompare(b.time)),
);

const readyOrders = computed(() =>
  store.orders.filter(o => o.status === 'ready').slice().sort((a, b) => a.time.localeCompare(b.time)),
);

// ── Helpers ─────────────────────────────────────────────────────────────────
// Show elapsed time since order.time (HH:mm format)
function elapsedLabel(orderTime) {
  try {
    const [h, m] = orderTime.split(':').map(Number);
    const now = new Date();
    const then = new Date(now);
    then.setHours(h, m, 0, 0);
    const diffMs = now - then;
    if (diffMs < 0) return orderTime;
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  } catch {
    return orderTime;
  }
}

// Color elapsed label: green < 10m, amber 10-20m, red > 20m
function elapsedColor(orderTime) {
  try {
    const [h, m] = orderTime.split(':').map(Number);
    const now = new Date();
    const then = new Date(now);
    then.setHours(h, m, 0, 0);
    const mins = Math.floor((now - then) / 60_000);
    if (mins < 10) return 'text-emerald-600';
    if (mins < 20) return 'text-amber-600';
    return 'text-red-500';
  } catch {
    return 'text-gray-500';
  }
}

// ── Actions ─────────────────────────────────────────────────────────────────
function acceptOrder(order) {
  store.changeOrderStatus(order, 'accepted');
  store.$persist?.();
}

function advancePreparingOrder(order) {
  // accepted → preparing → ready
  if (order.status === 'accepted') {
    store.changeOrderStatus(order, 'preparing');
  } else {
    store.changeOrderStatus(order, 'ready');
  }
  store.$persist?.();
}

function completeOrder(order) {
  store.changeOrderStatus(order, 'completed');
  store.$persist?.();
}
</script>
