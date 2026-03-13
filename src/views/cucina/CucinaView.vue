<template>
  <!-- Kitchen Mode ─ Full-screen dark UI optimised for fast-paced kitchen use -->
  <div class="h-full flex flex-col overflow-hidden select-none" style="background:#1c1917;">

    <!-- ── Header ──────────────────────────────────────────────────────────── -->
    <header class="shrink-0 flex items-center justify-between px-4 py-3" style="background:#292524;border-bottom:1px solid #44403c;">
      <div class="flex items-center gap-3">
        <!-- Chef-hat icon -->
        <div class="flex items-center justify-center rounded-xl" style="width:2.5rem;height:2.5rem;background:#b45309;">
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none"
               stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0A5.11 5.11 0 0 1 16.59 6 4 4 0 0 1 18 13.87V21H6Z"/>
            <line x1="6" y1="17" x2="18" y2="17"/>
          </svg>
        </div>
        <div>
          <p class="font-black text-lg leading-none" style="color:#f5f5f4;">Cucina</p>
          <p class="text-xs font-semibold uppercase tracking-widest" style="color:#a8a29e;">{{ store.config.ui.name }}</p>
        </div>
      </div>

      <!-- Live clock + order counts -->
      <div class="flex items-center gap-3">
        <!-- Pending badge -->
        <div v-if="pendingOrders.length > 0"
             class="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-black uppercase"
             style="background:#78350f;color:#fde68a;">
          <span class="inline-block rounded-full text-center font-black"
                style="min-width:1.25rem;height:1.25rem;line-height:1.25rem;background:#f59e0b;color:#1c1917;font-size:0.7rem;">
            {{ pendingOrders.length }}
          </span>
          In attesa
        </div>
        <!-- Accepted badge -->
        <div v-if="acceptedOrders.length > 0"
             class="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-black uppercase"
             style="background:#1e3a5f;color:#93c5fd;">
          <span class="inline-block rounded-full text-center font-black"
                style="min-width:1.25rem;height:1.25rem;line-height:1.25rem;background:#3b82f6;color:white;font-size:0.7rem;">
            {{ acceptedOrders.length }}
          </span>
          In cucina
        </div>

        <!-- Clock -->
        <p class="font-mono font-bold text-sm" style="color:#78716c;">{{ currentTime }}</p>
      </div>
    </header>

    <!-- ── Column headers (desktop) ────────────────────────────────────────── -->
    <div class="shrink-0 hidden md:grid grid-cols-2 gap-3 px-4 pt-3 pb-1">
      <p class="text-xs font-black uppercase tracking-widest" style="color:#f59e0b;">
        ⏳ In Attesa ({{ pendingOrders.length }})
      </p>
      <p class="text-xs font-black uppercase tracking-widest" style="color:#60a5fa;">
        🔥 In Cucina ({{ acceptedOrders.length }})
      </p>
    </div>

    <!-- ── Scrollable content ───────────────────────────────────────────────── -->
    <main class="flex-1 overflow-y-auto px-3 pb-4 pt-2" style="overscroll-behavior:contain;">

      <!-- Empty state -->
      <div v-if="pendingOrders.length === 0 && acceptedOrders.length === 0"
           class="flex flex-col items-center justify-center h-full gap-4 py-16">
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none"
             stroke="#57534e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0A5.11 5.11 0 0 1 16.59 6 4 4 0 0 1 18 13.87V21H6Z"/>
          <line x1="6" y1="17" x2="18" y2="17"/>
        </svg>
        <p class="text-lg font-bold" style="color:#78716c;">Nessun ordine attivo</p>
        <p class="text-sm" style="color:#57534e;">Gli ordini arrivano qui non appena vengono inviati dalla sala.</p>
      </div>

      <!-- Mobile: stacked columns; Desktop: 2-column grid -->
      <div v-else class="md:grid md:grid-cols-2 md:gap-3 space-y-3 md:space-y-0">

        <!-- ── PENDING column ─────────────────────────────────────────────── -->
        <section>
          <!-- Mobile label -->
          <p class="md:hidden text-xs font-black uppercase tracking-widest mb-2" style="color:#f59e0b;">
            ⏳ In Attesa ({{ pendingOrders.length }})
          </p>

          <div v-if="pendingOrders.length === 0"
               class="flex items-center justify-center rounded-2xl py-10"
               style="background:#292524;border:2px dashed #44403c;">
            <p class="text-sm font-semibold" style="color:#57534e;">Nessun ordine in attesa</p>
          </div>

          <div v-else class="space-y-3">
            <article
              v-for="order in pendingOrders"
              :key="order.id"
              class="rounded-2xl overflow-hidden"
              style="background:#292524;border:2px solid #b45309;box-shadow:0 0 20px rgba(180,83,9,0.25);"
              :aria-label="`Ordine tavolo ${order.table} in attesa`"
            >
              <!-- Card header -->
              <div class="flex items-center justify-between px-4 py-3" style="background:#3c1f06;">
                <div class="flex items-center gap-3">
                  <span class="font-black text-2xl" style="color:#fed7aa;">T.{{ order.table }}</span>
                  <div>
                    <span class="text-xs font-bold uppercase rounded-full px-2 py-0.5" style="background:#b45309;color:#fff3e8;">
                      In attesa
                    </span>
                    <p class="text-xs mt-0.5" style="color:#a8a29e;">{{ order.time }} &middot; {{ order.itemCount }} piatt{{ order.itemCount === 1 ? 'o' : 'i' }}</p>
                  </div>
                </div>
                <div class="text-right">
                  <p class="text-xs font-semibold" style="color:#a8a29e;">Ord. #{{ order.id.substring(4, 10) }}</p>
                  <p class="font-black text-lg" style="color:#fed7aa;">{{ elapsedLabel(order.time) }}</p>
                </div>
              </div>

              <!-- Items list -->
              <ul class="px-4 py-3 space-y-2">
                <li
                  v-for="item in activeItems(order)"
                  :key="item.uid"
                  class="flex items-start gap-3"
                >
                  <span class="shrink-0 font-black text-lg w-8 text-center" style="color:#f59e0b;">
                    {{ item.quantity - (item.voidedQuantity || 0) }}×
                  </span>
                  <div class="flex-1 min-w-0">
                    <p class="font-bold text-base leading-tight" style="color:#f5f5f4;">{{ item.name }}</p>
                    <p v-if="item.notes && item.notes.length" class="text-xs mt-0.5 font-semibold" style="color:#fb923c;">
                      ✎ {{ item.notes.join(' · ') }}
                    </p>
                    <!-- Modifiers -->
                    <p v-for="mod in activeModifiers(item)" :key="mod.name" class="text-xs" style="color:#a8a29e;">
                      + {{ mod.name }}
                    </p>
                  </div>
                </li>
              </ul>

              <!-- Dietary tags -->
              <div v-if="dietTags(order).length" class="flex flex-wrap gap-1.5 px-4 pb-2">
                <span
                  v-for="tag in dietTags(order)"
                  :key="tag"
                  class="text-xs font-bold rounded-full px-2 py-0.5"
                  style="background:#292524;border:1px solid #78350f;color:#fbbf24;"
                >
                  {{ tag }}
                </span>
              </div>

              <!-- Action: Accept for cooking -->
              <div class="px-4 pb-4 pt-1">
                <button
                  @click="acceptOrder(order)"
                  class="w-full rounded-xl font-black text-base py-3.5 transition-transform active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  style="background:#b45309;color:white;focus-visible:ring-color:#f59e0b;"
                  :aria-label="`Accetta ordine tavolo ${order.table}`"
                >
                  🔥 Prendi in carico
                </button>
              </div>
            </article>
          </div>
        </section>

        <!-- ── ACCEPTED (IN CUCINA) column ───────────────────────────────── -->
        <section>
          <!-- Mobile label -->
          <p class="md:hidden text-xs font-black uppercase tracking-widest mb-2 mt-4" style="color:#60a5fa;">
            🔥 In Cucina ({{ acceptedOrders.length }})
          </p>

          <div v-if="acceptedOrders.length === 0"
               class="flex items-center justify-center rounded-2xl py-10"
               style="background:#292524;border:2px dashed #44403c;">
            <p class="text-sm font-semibold" style="color:#57534e;">Nessuna comanda in lavorazione</p>
          </div>

          <div v-else class="space-y-3">
            <article
              v-for="order in acceptedOrders"
              :key="order.id"
              class="rounded-2xl overflow-hidden"
              style="background:#292524;border:2px solid #1d4ed8;box-shadow:0 0 20px rgba(29,78,216,0.2);"
              :aria-label="`Ordine tavolo ${order.table} in cucina`"
            >
              <!-- Card header -->
              <div class="flex items-center justify-between px-4 py-3" style="background:#172554;">
                <div class="flex items-center gap-3">
                  <span class="font-black text-2xl" style="color:#bfdbfe;">T.{{ order.table }}</span>
                  <div>
                    <span class="text-xs font-bold uppercase rounded-full px-2 py-0.5" style="background:#1d4ed8;color:#dbeafe;">
                      In cucina
                    </span>
                    <p class="text-xs mt-0.5" style="color:#a8a29e;">{{ order.time }} &middot; {{ order.itemCount }} piatt{{ order.itemCount === 1 ? 'o' : 'i' }}</p>
                  </div>
                </div>
                <div class="text-right">
                  <p class="text-xs font-semibold" style="color:#a8a29e;">Ord. #{{ order.id.substring(4, 10) }}</p>
                  <p class="font-black text-lg" :style="{ color: elapsedColor(order.time) }">{{ elapsedLabel(order.time) }}</p>
                </div>
              </div>

              <!-- Items list -->
              <ul class="px-4 py-3 space-y-2">
                <li
                  v-for="item in activeItems(order)"
                  :key="item.uid"
                  class="flex items-start gap-3"
                >
                  <span class="shrink-0 font-black text-lg w-8 text-center" style="color:#60a5fa;">
                    {{ item.quantity - (item.voidedQuantity || 0) }}×
                  </span>
                  <div class="flex-1 min-w-0">
                    <p class="font-bold text-base leading-tight" style="color:#f5f5f4;">{{ item.name }}</p>
                    <p v-if="item.notes && item.notes.length" class="text-xs mt-0.5 font-semibold" style="color:#fb923c;">
                      ✎ {{ item.notes.join(' · ') }}
                    </p>
                    <!-- Modifiers -->
                    <p v-for="mod in activeModifiers(item)" :key="mod.name" class="text-xs" style="color:#a8a29e;">
                      + {{ mod.name }}
                    </p>
                  </div>
                </li>
              </ul>

              <!-- Dietary tags -->
              <div v-if="dietTags(order).length" class="flex flex-wrap gap-1.5 px-4 pb-2">
                <span
                  v-for="tag in dietTags(order)"
                  :key="tag"
                  class="text-xs font-bold rounded-full px-2 py-0.5"
                  style="background:#292524;border:1px solid #1e3a5f;color:#93c5fd;"
                >
                  {{ tag }}
                </span>
              </div>

              <!-- Action: Mark as ready -->
              <div class="px-4 pb-4 pt-1">
                <button
                  @click="completeOrder(order)"
                  class="w-full rounded-xl font-black text-base py-3.5 transition-transform active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  style="background:#15803d;color:white;"
                  :aria-label="`Segna come pronto ordine tavolo ${order.table}`"
                >
                  ✅ Pronto — Segna completato
                </button>
              </div>
            </article>
          </div>
        </section>

      </div>
    </main>

    <!-- ── Footer: sync indicator ──────────────────────────────────────────── -->
    <footer class="shrink-0 flex items-center justify-between px-4 py-2" style="background:#292524;border-top:1px solid #44403c;">
      <p class="text-xs" style="color:#57534e;">
        Ultimo aggiornamento: <span style="color:#a8a29e;">{{ lastSyncLabel }}</span>
      </p>
      <button
        @click="syncFromStorage"
        class="text-xs font-bold rounded-lg px-3 py-1.5 transition-colors focus:outline-none"
        style="background:#44403c;color:#a8a29e;"
        aria-label="Aggiorna ora"
      >
        ↻ Aggiorna
      </button>
    </footer>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useAppStore } from '../../store/index.js';
import { resolveStorageKeys, getInstanceName } from '../../store/persistence.js';

const store = useAppStore();

// Resolve the storage key once at setup time — it never changes at runtime
const { storageKey } = resolveStorageKeys(getInstanceName());

// ── Live clock ─────────────────────────────────────────────────────────────
const currentTime = ref(new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }));
let clockTimer = null;

// ── Cross-tab sync ──────────────────────────────────────────────────────────
// The Pinia store is persisted to localStorage. When another tab (Cassa/Sala)
// saves a state change, the browser fires a "storage" event that we use to
// re-hydrate the store so the kitchen display stays current without polling.
const lastSyncLabel = ref('—');

function syncFromStorage() {
  // Force pinia-plugin-persistedstate to re-read from localStorage
  store.$persist?.();
  lastSyncLabel.value = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function onStorageChange(event) {
  // Only react to changes in our own store key
  if (event.key !== storageKey) return;
  syncFromStorage();
}

// ── Auto-refresh every 30 s as a fallback ──────────────────────────────────
let refreshTimer = null;

onMounted(() => {
  // Update the clock every minute since the display only shows HH:mm
  clockTimer = setInterval(() => {
    currentTime.value = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }, 60_000);

  // Listen for cross-tab storage events (when Cassa/Sala tab saves state)
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', onStorageChange);
  }

  // Fallback polling every 30 s
  refreshTimer = setInterval(syncFromStorage, 30_000);

  lastSyncLabel.value = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
});

onUnmounted(() => {
  clearInterval(clockTimer);
  clearInterval(refreshTimer);
  if (typeof window !== 'undefined') {
    window.removeEventListener('storage', onStorageChange);
  }
});

// ── Computed order lists ────────────────────────────────────────────────────
const pendingOrders = computed(() =>
  store.orders.filter(o => o.status === 'pending').slice().sort((a, b) => a.time.localeCompare(b.time))
);

const acceptedOrders = computed(() =>
  store.orders.filter(o => o.status === 'accepted').slice().sort((a, b) => a.time.localeCompare(b.time))
);

// ── Helpers ─────────────────────────────────────────────────────────────────
function activeItems(order) {
  return order.orderItems.filter(item => (item.quantity - (item.voidedQuantity || 0)) > 0);
}

function activeModifiers(item) {
  return (item.modifiers || []).filter(m => (m.quantity || 1) - (m.voidedQuantity || 0) > 0);
}

function dietTags(order) {
  const prefs = order.dietaryPreferences || {};
  return [
    ...(prefs.diete || []),
    ...(prefs.allergeni || []),
  ];
}

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
    if (mins < 10) return '#4ade80';
    if (mins < 20) return '#fbbf24';
    return '#f87171';
  } catch {
    return '#a8a29e';
  }
}

// ── Actions ─────────────────────────────────────────────────────────────────
function acceptOrder(order) {
  store.changeOrderStatus(order, 'accepted');
  lastSyncLabel.value = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function completeOrder(order) {
  store.changeOrderStatus(order, 'completed');
  lastSyncLabel.value = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
</script>
