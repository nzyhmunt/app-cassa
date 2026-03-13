<template>
  <!-- Kitchen Display System — light theme matching Cassa & Sala -->
  <div class="h-full flex flex-col overflow-hidden select-none bg-gray-100">

    <!-- ── Header ─────────────────────────────────────────────────────────── -->
    <header class="theme-bg text-white p-2 md:p-4 shadow-md z-40 flex justify-between items-center shrink-0 h-16 md:h-20">

      <!-- Brand -->
      <div class="flex items-center gap-2 md:gap-3 flex-1 min-w-0">
        <div class="bg-white p-2 rounded-full shadow-sm hidden sm:flex items-center justify-center shrink-0">
          <ChefHat class="size-5 md:size-6 theme-text" />
        </div>
        <div class="flex flex-col truncate">
          <h1 class="text-sm md:text-xl font-bold leading-none truncate">{{ store.config.ui.name }}</h1>
          <p class="text-white/80 text-[9px] md:text-xs mt-0.5 font-bold uppercase tracking-wider truncate">APP CUCINA</p>
        </div>
      </div>

      <!-- Status counters + clock -->
      <div class="flex items-center gap-2 md:gap-3">
        <div v-if="pendingOrders.length > 0"
             class="flex items-center gap-1.5 bg-amber-100 text-amber-800 border border-amber-200 rounded-full px-3 py-1 text-xs font-bold">
          <span class="bg-amber-500 text-white rounded-full font-black text-[10px] size-5 flex items-center justify-center shrink-0">
            {{ pendingOrders.length }}
          </span>
          <span class="hidden sm:inline uppercase tracking-wide">Da Prep.</span>
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
        <div class="text-right hidden lg:block">
          <p class="text-sm font-bold truncate">{{ currentTime }}</p>
          <p class="text-[10px] text-white/80 uppercase truncate">Turno Attivo</p>
        </div>
        <button
          @click="syncFromStorage"
          class="bg-white/10 hover:bg-white/20 px-2.5 md:px-3 py-2 md:py-2.5 rounded-xl transition-colors text-white flex items-center justify-center"
          title="Aggiorna"
        >
          <RefreshCw class="size-5 md:size-5 shrink-0" />
        </button>
        <button
          @click="emit('open-settings')"
          aria-label="Apri impostazioni"
          class="relative z-50 bg-black/20 hover:bg-black/30 px-2.5 md:px-3 py-2 md:py-2.5 rounded-xl transition-colors shadow-inner text-white flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
          title="Impostazioni"
        >
          <Settings class="size-5 md:size-5 shrink-0" />
          <span class="hidden lg:inline text-xs font-bold">Config</span>
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
        <p class="text-sm text-gray-400">Le comande arrivano qui dopo l'accettazione dalla Cassa.</p>
      </div>

      <!-- 3-column kanban: stacked on mobile, side-by-side on desktop -->
      <div v-else class="h-full flex flex-col md:flex-row gap-3">

        <!-- ── Column 1: DA PREPARARE (accepted by Cassa) ────────────────── -->
        <section class="md:flex-1 md:flex md:flex-col md:min-h-0">
          <div class="flex items-center gap-2 mb-2 shrink-0">
            <Bell class="size-4 text-amber-600" />
            <h2 class="text-xs font-black uppercase tracking-widest text-amber-700">
              Da Preparare
            </h2>
            <span class="ml-auto bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-black rounded-full px-2 py-0.5">
              {{ pendingOrders.length }}
            </span>
          </div>

          <div v-if="pendingOrders.length === 0"
               class="flex-1 flex items-center justify-center rounded-2xl py-10 bg-white border-2 border-dashed border-gray-200">
            <p class="text-sm font-semibold text-gray-400">Nessuna comanda da preparare</p>
          </div>

          <div v-else class="md:flex-1 md:overflow-y-auto space-y-3">
            <article
              v-for="order in pendingOrders"
              :key="order.id"
              class="bg-white rounded-2xl border-2 border-amber-300 shadow-sm overflow-hidden"
              :aria-label="`Comanda tavolo ${order.table} da preparare`"
            >
              <KitchenOrderCard
                :order="order"
                status-label="Da Preparare"
                status-class="bg-amber-100 text-amber-800 border-amber-200"
                qty-class="text-amber-600"
                :elapsed-label="elapsedLabel(order.time)"
                :elapsed-color="elapsedColor(order.time)"
                action-label="Inizia preparazione"
                action-class="theme-bg text-white hover:opacity-90"
                @action="acceptOrder(order)"
              />
            </article>
          </div>
        </section>

        <!-- ── Column 2: IN COTTURA (preparing) ──────────────────────────── -->
        <section class="md:flex-1 md:flex md:flex-col md:min-h-0">
          <div class="flex items-center gap-2 mb-2 shrink-0">
            <Flame class="size-4 text-orange-600" />
            <h2 class="text-xs font-black uppercase tracking-widest text-orange-700">
              In Cottura
            </h2>
            <span class="ml-auto bg-orange-100 text-orange-800 border border-orange-200 text-[10px] font-black rounded-full px-2 py-0.5">
              {{ preparingOrders.length }}
            </span>
          </div>

          <div v-if="preparingOrders.length === 0"
               class="flex-1 flex items-center justify-center rounded-2xl py-10 bg-white border-2 border-dashed border-gray-200">
            <p class="text-sm font-semibold text-gray-400">Nessuna comanda in cottura</p>
          </div>

          <div v-else class="md:flex-1 md:overflow-y-auto space-y-3">
            <article
              v-for="order in preparingOrders"
              :key="order.id"
              class="bg-white rounded-2xl border-2 border-orange-300 shadow-sm overflow-hidden"
              :aria-label="`Comanda tavolo ${order.table} in cottura`"
            >
              <KitchenOrderCard
                :order="order"
                status-label="In Cottura"
                status-class="bg-orange-100 text-orange-800 border-orange-200"
                qty-class="text-orange-600"
                :elapsed-label="elapsedLabel(order.time)"
                :elapsed-color="elapsedColor(order.time)"
                action-label="Segna pronta"
                action-class="bg-orange-500 text-white hover:bg-orange-600"
                @action="advancePreparingOrder(order)"
              />
            </article>
          </div>
        </section>

        <!-- ── Column 3: PRONTE (ready — Sala marks as delivered) ─────────── -->
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
              :aria-label="`Comanda tavolo ${order.table} pronta`"
            >
              <KitchenOrderCard
                :order="order"
                status-label="Pronta 🔔"
                status-class="bg-teal-100 text-teal-800 border-teal-200"
                qty-class="text-teal-600"
                :elapsed-label="elapsedLabel(order.time)"
                :elapsed-color="elapsedColor(order.time)"
                :show-action="false"
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
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { Bell, BellRing, ChefHat, Flame, RefreshCw, Settings } from 'lucide-vue-next';
import { useAppStore } from '../../store/index.js';
import { useBeep } from '../../composables/useBeep.js';
import KitchenOrderCard from './KitchenOrderCard.vue';

const emit = defineEmits(['open-settings']);

const store = useAppStore();

// ── Audio alerts: beep when a new order enters the kitchen (accepted) ────────
const { playBeep } = useBeep();
const acceptedOrderCount = computed(() =>
  store.orders.filter(o => o.status === 'accepted').length,
);
watch(acceptedOrderCount, (newVal, oldVal) => {
  if (newVal > oldVal) playBeep();
});

// ── Live clock ─────────────────────────────────────────────────────────────
const currentTime = ref(new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }));
let clockTimer = null;

// ── Manual sync ─────────────────────────────────────────────────────────────
// Automatic cross-tab sync is handled at the app root in CucinaApp.vue
// (same architecture as CassaApp.vue and SalaApp.vue).
// `syncFromStorage` is called here only by the manual refresh button and the
// 30-second periodic fallback poll.
const lastSyncLabel = ref('—');

function syncFromStorage() {
  store.$hydrate?.();
  lastSyncLabel.value = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

let refreshTimer = null;

onMounted(() => {
  clockTimer = setInterval(() => {
    currentTime.value = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }, 60_000);

  refreshTimer = setInterval(syncFromStorage, 30_000);

  lastSyncLabel.value = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
});

onUnmounted(() => {
  clearInterval(clockTimer);
  clearInterval(refreshTimer);
});

// ── Computed order lists ────────────────────────────────────────────────────
// Column 1: orders accepted by Cassa but not yet started by kitchen
const pendingOrders = computed(() =>
  store.orders.filter(o => o.status === 'accepted').slice().sort((a, b) => a.time.localeCompare(b.time)),
);

// Column 2: orders currently being prepared / cooked
const preparingOrders = computed(() =>
  store.orders
    .filter(o => o.status === 'preparing')
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
  // accepted → preparing (kitchen starts working on it)
  store.changeOrderStatus(order, 'preparing');
  store.$persist?.();
}

function advancePreparingOrder(order) {
  // preparing → ready
  store.changeOrderStatus(order, 'ready');
  store.$persist?.();
}
</script>
