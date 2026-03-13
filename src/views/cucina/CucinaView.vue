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

    <!-- ── Tab nav: Kanban / Dettaglio ───────────────────────────────────── -->
    <div class="shrink-0 flex gap-1.5 bg-white border-b border-gray-200 px-3 py-2">
      <button
        @click="cucinaTab = 'kanban'"
        :class="cucinaTab === 'kanban' ? 'bg-[var(--brand-primary)]/10 text-[var(--brand-primary)] border-[var(--brand-primary)]/30 font-bold' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-100'"
        class="flex-1 py-1.5 px-2 rounded-xl border transition-all text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-sm"
      >
        <Layers class="size-3.5" /> Kanban
      </button>
      <button
        @click="cucinaTab = 'detail'"
        :class="cucinaTab === 'detail' ? 'bg-[var(--brand-primary)]/10 text-[var(--brand-primary)] border-[var(--brand-primary)]/30 font-bold' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-100'"
        class="flex-1 py-1.5 px-2 rounded-xl border transition-all text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-sm"
      >
        <ClipboardList class="size-3.5" /> Dettaglio
        <span v-if="allKitchenOrders.length > 0" class="bg-[var(--brand-primary)] text-white text-[9px] font-black rounded-full size-4 flex items-center justify-center shrink-0">{{ allKitchenOrders.length }}</span>
      </button>
    </div>

    <!-- ── Scrollable kanban board ─────────────────────────────────────────── -->
    <main v-if="cucinaTab === 'kanban'" class="flex-1 overflow-y-auto md:overflow-hidden p-3 md:p-4" style="overscroll-behavior:contain;">

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

    <!-- ── Dettaglio tab: per-item kitchen status management ──────────────── -->
    <main v-else-if="cucinaTab === 'detail'" class="flex-1 overflow-y-auto p-3 md:p-4 space-y-3" style="overscroll-behavior:contain;">

      <p v-if="allKitchenOrders.length === 0" class="flex flex-col items-center justify-center gap-3 h-full py-16 text-center">
        <ChefHat class="size-12 text-gray-300" />
        <span class="text-sm font-bold text-gray-400">Nessuna comanda attiva</span>
        <span class="text-xs text-gray-400">Le comande appaiono qui dopo l'accettazione dalla Cassa.</span>
      </p>

      <article
        v-for="order in allKitchenOrders"
        :key="order.id"
        class="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden"
      >
        <!-- Card header -->
        <div class="px-3 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="theme-bg text-white rounded-xl size-9 flex items-center justify-center font-black text-sm shrink-0">
              {{ order.table }}
            </div>
            <div class="min-w-0">
              <p class="text-xs font-bold text-gray-800 truncate">Tavolo {{ order.table }}</p>
              <p class="text-[10px] text-gray-400">{{ order.time }} · {{ elapsedLabel(order.time) }}</p>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <span :class="detailStatusBadgeClass(order.status)" class="hidden sm:flex text-[9px] uppercase font-bold px-2 py-0.5 rounded-full border items-center">
              {{ detailStatusLabel(order.status) }}
            </span>
            <button
              @click="forceDeliver(order)"
              class="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] rounded-lg font-bold flex items-center gap-1.5 active:scale-95 transition-colors"
              title="Segna come consegnata (override)"
            >
              <CheckCircle2 class="size-3.5" />
              <span class="hidden sm:inline">Consegnata</span>
            </button>
          </div>
        </div>

        <!-- Per-item toggles -->
        <div class="divide-y divide-gray-100">
          <template v-for="(item, idx) in order.orderItems" :key="item.uid || idx">
            <div
              v-if="(item.quantity - (item.voidedQuantity || 0)) > 0"
              class="px-3 py-2 flex items-center gap-3"
            >
              <!-- Toggle button -->
              <button
                @click="toggleItemReady(order, idx)"
                :class="item.kitchenReady ? 'bg-emerald-500 text-white border-emerald-600' : 'bg-white text-gray-400 border-gray-200 hover:border-gray-400'"
                class="size-7 rounded-lg border-2 flex items-center justify-center shrink-0 active:scale-95 transition-all"
                :title="item.kitchenReady ? 'Segna come non pronto' : 'Segna come pronto'"
              >
                <Check v-if="item.kitchenReady" class="size-4" />
              </button>

              <!-- Item info -->
              <div class="flex-1 min-w-0">
                <p :class="item.kitchenReady ? 'text-gray-400 line-through' : 'text-gray-800'" class="text-xs font-bold truncate">
                  {{ item.quantity }}× {{ item.name }}
                </p>
                <p v-if="item.notes?.length" class="text-[10px] text-orange-600 truncate">{{ item.notes.join(' · ') }}</p>
              </div>

              <!-- Course badge -->
              <span v-if="item.course === 'prima'" class="text-[9px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 border border-orange-200 font-bold uppercase shrink-0">Prima</span>
              <span v-else-if="item.course === 'dopo'" class="text-[9px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 border border-purple-200 font-bold uppercase shrink-0">Dopo</span>
              <span v-else class="text-[9px] px-1.5 py-0.5 rounded bg-teal-100 text-teal-700 border border-teal-200 font-bold uppercase shrink-0">Insieme</span>
            </div>
          </template>
        </div>
      </article>
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
import { Bell, BellRing, ChefHat, Check, CheckCircle2, Flame, Layers, RefreshCw, Settings, ClipboardList } from 'lucide-vue-next';
import { useAppStore } from '../../store/index.js';
import { useBeep } from '../../composables/useBeep.js';
import KitchenOrderCard from './KitchenOrderCard.vue';

const emit = defineEmits(['open-settings']);

const store = useAppStore();

// ── Kitchen tab navigation: Kanban vs Detail ──────────────────────────────
const cucinaTab = ref('kanban'); // 'kanban' | 'detail'

// All active kitchen orders for the detail tab (accepted → preparing → ready)
const allKitchenOrders = computed(() =>
  store.orders
    .filter(o => ['accepted', 'preparing', 'ready'].includes(o.status))
    .slice()
    .sort((a, b) => a.time.localeCompare(b.time)),
);

function toggleItemReady(order, itemIdx) {
  const item = order.orderItems[itemIdx];
  if (!item) return;
  store.setItemKitchenReady(order, itemIdx, !item.kitchenReady);
  store.$persist?.();
}

function forceDeliver(order) {
  store.changeOrderStatus(order, 'delivered');
  store.$persist?.();
}

function detailStatusBadgeClass(status) {
  if (status === 'accepted') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (status === 'preparing') return 'bg-orange-50 text-orange-700 border-orange-200';
  if (status === 'ready') return 'bg-teal-50 text-teal-700 border-teal-200';
  return 'bg-gray-50 text-gray-700 border-gray-200';
}

function detailStatusLabel(status) {
  if (status === 'accepted') return 'Da Preparare';
  if (status === 'preparing') return 'In Cottura';
  if (status === 'ready') return 'Pronta 🔔';
  return status;
}

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
