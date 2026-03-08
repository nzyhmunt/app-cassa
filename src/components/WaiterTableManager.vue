<template>
  <!-- WORKSPACE: TABLE MAP -->
  <div class="flex-1 flex flex-col bg-gray-100/80 overflow-y-auto p-4 md:p-8 relative min-h-0">
    <div class="max-w-6xl mx-auto w-full">

      <!-- Header row -->
      <div class="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2 mb-4 md:mb-6">
        <h2 class="text-xl md:text-2xl font-black text-gray-800 flex items-center gap-2 md:gap-3">
          <Grid3x3 class="text-gray-500 size-6 md:size-8" /> Mappa Sala
        </h2>
        <!-- Legend -->
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold uppercase text-gray-500">
          <span class="flex items-center gap-1"><span class="size-3 rounded-full border-2 border-emerald-400 bg-emerald-100"></span> Libero</span>
          <span class="flex items-center gap-1"><span class="size-3 rounded-full border-2 border-amber-400 bg-amber-100"></span> In Attesa</span>
          <span class="flex items-center gap-1"><span class="size-3 rounded-full theme-bg border-2 border-white shadow-sm"></span> Occupato</span>
        </div>
      </div>

      <!-- Stats bar -->
      <div class="flex flex-wrap items-center gap-2 mb-4 md:mb-5">
        <div class="flex items-center gap-2 bg-white rounded-xl px-3 py-2 shadow-sm border border-gray-200">
          <span class="size-2.5 rounded-full border-2 border-emerald-400 bg-emerald-100 shrink-0"></span>
          <span class="text-xs font-bold text-gray-700">{{ freeTablesCount }} Liberi</span>
        </div>
        <div class="flex items-center gap-2 bg-white rounded-xl px-3 py-2 shadow-sm border border-gray-200">
          <span class="size-2.5 rounded-full theme-bg shrink-0"></span>
          <span class="text-xs font-bold text-gray-700">{{ occupiedTablesCount }} Occupati</span>
        </div>
        <div v-if="pendingTablesCount > 0" class="flex items-center gap-2 bg-amber-50 rounded-xl px-3 py-2 shadow-sm border border-amber-200">
          <span class="size-2.5 rounded-full border-2 border-amber-400 bg-amber-100 shrink-0"></span>
          <span class="text-xs font-bold text-amber-800">{{ pendingTablesCount }} In Attesa</span>
        </div>
      </div>

      <!-- Table grid -->
      <div class="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-5">
        <button
          v-for="table in store.config.tables"
          :key="table.id"
          @click="openTableDetails(table)"
          class="relative aspect-square rounded-[1.5rem] md:rounded-[2rem] border-[3px] md:border-[4px] flex flex-col items-center justify-center p-2 md:p-4 transition-transform active:scale-95 shadow-sm bg-white overflow-hidden group"
          :class="store.getTableColorClass(table.id)"
        >
          <span class="absolute top-2 right-2 md:top-3 md:right-3 text-[9px] md:text-xs font-bold opacity-60 flex items-center gap-0.5 md:gap-1">
            <Users class="size-2.5 md:size-3" />{{ table.covers }}
          </span>
          <h3 class="text-xl md:text-3xl font-black mt-2">{{ table.label }}</h3>

          <div v-if="store.getTableStatus(table.id).status !== 'free'" class="mt-auto text-center w-full">
            <span v-if="getElapsedTime(table.id)" class="absolute bottom-2 left-2 text-[8px] font-bold opacity-70 flex items-center gap-0.5">
              <Timer class="size-2.5" />{{ getElapsedTime(table.id) }}
            </span>
            <span class="block text-[8px] md:text-[10px] font-bold uppercase tracking-widest opacity-80 mb-0.5 md:mb-1 truncate">
              {{ store.getTableStatus(table.id).status === 'pending' ? 'In Attesa' : 'Occupato' }}
            </span>
            <span class="block font-black text-sm md:text-lg bg-white/20 rounded-md md:rounded-lg py-0.5 px-1 truncate">
              {{ tableOrderCount(table.id) }} coman{{ tableOrderCount(table.id) !== 1 ? 'de' : 'da' }}
            </span>
          </div>
          <div v-else class="mt-auto text-center w-full opacity-30">
            <span class="block text-[9px] md:text-[10px] font-bold uppercase tracking-widest">Libero</span>
          </div>
        </button>
      </div>

    </div>
  </div>

  <!-- ================================================================ -->
  <!-- PEOPLE MODAL: shown when opening a free table                    -->
  <!-- ================================================================ -->
  <div v-if="showPeopleModal" class="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6">
      <h3 class="text-lg font-black text-gray-800 mb-1 flex items-center gap-2">
        <Users class="size-5 theme-text" /> Tavolo {{ pendingTableToOpen?.label }}
      </h3>
      <p class="text-sm text-gray-500 mb-6">Quante persone si siedono?</p>

      <!-- Adults / people counter -->
      <div class="flex items-center justify-between mb-4">
        <span class="font-bold text-gray-700">{{ showChildrenInput ? 'Adulti' : 'Persone' }}</span>
        <div class="flex items-center gap-3">
          <button
            @click="peopleAdults = Math.max(1, peopleAdults - 1)"
            class="size-10 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center font-bold text-gray-700 active:scale-95 transition-all"
          >
            <Minus class="size-4" />
          </button>
          <span class="text-2xl font-black w-8 text-center">{{ peopleAdults }}</span>
          <button
            @click="peopleAdults++"
            class="size-10 rounded-full theme-bg text-white flex items-center justify-center active:scale-95 transition-all"
          >
            <Plus class="size-4" />
          </button>
        </div>
      </div>

      <!-- Children counter (only when cover charge for children is configured) -->
      <div v-if="showChildrenInput" class="flex items-center justify-between mb-6">
        <span class="font-bold text-gray-700">Bambini</span>
        <div class="flex items-center gap-3">
          <button
            @click="peopleChildren = Math.max(0, peopleChildren - 1)"
            class="size-10 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center font-bold text-gray-700 active:scale-95 transition-all"
          >
            <Minus class="size-4" />
          </button>
          <span class="text-2xl font-black w-8 text-center">{{ peopleChildren }}</span>
          <button
            @click="peopleChildren++"
            class="size-10 rounded-full theme-bg text-white flex items-center justify-center active:scale-95 transition-all"
          >
            <Plus class="size-4" />
          </button>
        </div>
      </div>

      <div v-if="!showChildrenInput" class="mb-6"></div>

      <div class="flex gap-3">
        <button
          @click="showPeopleModal = false; pendingTableToOpen = null"
          class="flex-1 py-3 rounded-xl border border-gray-200 font-bold text-gray-600 hover:bg-gray-50 active:scale-95 transition-all"
        >
          Annulla
        </button>
        <button
          @click="confirmPeopleAndOpenTable"
          class="flex-[2] py-3 rounded-xl theme-bg text-white font-bold shadow-md hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2"
        >
          <Check class="size-5" /> Apri Tavolo
        </button>
      </div>
    </div>
  </div>

  <!-- ================================================================ -->
  <!-- TABLE DETAIL MODAL: shown when opening an occupied/pending table -->
  <!-- ================================================================ -->
  <div v-if="showTableModal && selectedTable" class="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4">
    <div class="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden" style="max-height: 85dvh">

      <!-- Modal header -->
      <div class="bg-gray-900 text-white p-4 md:p-5 flex justify-between items-center shrink-0">
        <div class="flex items-center gap-3">
          <div class="size-10 md:size-12 rounded-full bg-white/10 flex items-center justify-center font-black text-lg md:text-xl">
            {{ selectedTable.label }}
          </div>
          <div>
            <h3 class="font-bold text-base md:text-xl leading-tight">Tavolo {{ selectedTable.label }}</h3>
            <p class="text-white/60 text-xs">
              <span v-if="tableSession">
                {{ tableSession.adults }}{{ tableSession.children > 0 ? '+' + tableSession.children + ' bambini' : '' }} persone
              </span>
              <span v-else>{{ selectedTable.covers }} posti</span>
              · {{ tableOrders.length }} comanda{{ tableOrders.length !== 1 ? 'e' : '' }}
              <span v-if="occupiedSince"> · {{ occupiedSince }}</span>
            </p>
          </div>
        </div>
        <button @click="closeTableModal" class="bg-white/10 hover:bg-white/20 p-2 md:p-2.5 rounded-full transition-colors active:scale-95">
          <X class="size-5 md:size-6" />
        </button>
      </div>

      <!-- Modal body -->
      <div class="flex-1 overflow-y-auto p-4 bg-gray-50 min-h-0">

        <!-- New order CTA -->
        <button
          @click="createNewOrder"
          class="w-full py-3 theme-bg text-white rounded-xl font-bold shadow-md hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2 mb-4"
        >
          <Plus class="size-5" /> Nuova Comanda
        </button>

        <!-- Active orders -->
        <div v-if="tableOrders.length > 0">
          <p class="text-[10px] font-bold uppercase text-gray-500 tracking-wider mb-2 px-1">Comande Attive</p>
          <div class="space-y-2">
            <button
              v-for="ord in tableOrders"
              :key="ord.id"
              @click="viewOrder(ord)"
              class="w-full bg-white rounded-xl border border-gray-200 p-3 text-left hover:border-gray-300 active:scale-[0.99] transition-all shadow-sm"
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <span v-if="ord.status === 'pending'" class="size-2 rounded-full bg-amber-400 shrink-0"></span>
                  <span v-else-if="ord.status === 'accepted'" class="size-2 rounded-full bg-blue-400 shrink-0"></span>
                  <span class="font-bold text-sm text-gray-800">{{ ord.itemCount }} pz</span>
                  <span class="text-xs text-gray-500">· {{ ord.time }}</span>
                </div>
                <div class="flex items-center gap-2">
                  <span v-if="ord.status === 'pending'" class="text-[9px] font-bold uppercase bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full border border-amber-200">In Attesa</span>
                  <span v-else-if="ord.status === 'accepted'" class="text-[9px] font-bold uppercase bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full border border-blue-200">In Cucina</span>
                  <ChevronRight class="size-4 text-gray-400" />
                </div>
              </div>
              <!-- Items preview -->
              <p v-if="ord.orderItems.length > 0" class="text-xs text-gray-500 mt-1 truncate">
                {{ ord.orderItems.slice(0, 3).map(i => i.name).join(', ') }}{{ ord.orderItems.length > 3 ? '…' : '' }}
              </p>
            </button>
          </div>
        </div>

        <div v-else class="text-center py-8 text-gray-400">
          <Coffee class="size-10 mx-auto mb-2 opacity-30" />
          <p class="text-sm">Nessuna comanda attiva per questo tavolo.</p>
          <p class="text-xs mt-1">Premi "Nuova Comanda" per iniziare.</p>
        </div>

      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import {
  Grid3x3, Users, Timer, X, Plus, Minus, Check, Coffee, ChevronRight,
} from 'lucide-vue-next';
import { useAppStore } from '../store/index.js';
import { updateOrderTotals } from '../utils/index.js';

const emit = defineEmits(['new-order-for-comande', 'view-order']);

const store = useAppStore();

// ── Table status counters ──────────────────────────────────────────────────
const freeTablesCount = computed(() =>
  store.config.tables.filter(t => store.getTableStatus(t.id).status === 'free').length,
);
const occupiedTablesCount = computed(() =>
  store.config.tables.filter(t => {
    const st = store.getTableStatus(t.id).status;
    return st === 'occupied' || st === 'conto_richiesto';
  }).length,
);
const pendingTablesCount = computed(() =>
  store.config.tables.filter(t => store.getTableStatus(t.id).status === 'pending').length,
);

function tableOrderCount(tableId) {
  return store.orders.filter(
    o => o.table === tableId && o.status !== 'completed' && o.status !== 'rejected',
  ).length;
}

// ── Elapsed time ────────────────────────────────────────────────────────────
const now = ref(Date.now());
let clockTimer = null;
onMounted(() => { clockTimer = setInterval(() => { now.value = Date.now(); }, 30000); });
onUnmounted(() => { if (clockTimer) clearInterval(clockTimer); });

function getElapsedTime(tableId) {
  const ts = store.tableOccupiedAt[tableId];
  if (!ts) return null;
  const diffMs = now.value - new Date(ts).getTime();
  const totalMin = Math.floor(diffMs / 60000);
  if (totalMin < 1) return null;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── People modal ────────────────────────────────────────────────────────────
const showPeopleModal = ref(false);
const pendingTableToOpen = ref(null);
const peopleAdults = ref(2);
const peopleChildren = ref(0);

const showChildrenInput = computed(() =>
  !!(store.config.coverCharge?.enabled && (store.config.coverCharge?.priceChild ?? 0) > 0),
);

// ── Table modal ──────────────────────────────────────────────────────────────
const showTableModal = ref(false);
const selectedTable = ref(null);

const tableSession = computed(() =>
  selectedTable.value ? store.tableCurrentBillSession[selectedTable.value.id] : null,
);

const tableOrders = computed(() => {
  if (!selectedTable.value) return [];
  return store.orders.filter(
    o => o.table === selectedTable.value.id && o.status !== 'completed' && o.status !== 'rejected',
  );
});

const occupiedSince = computed(() => {
  if (!selectedTable.value) return null;
  const ts = store.tableOccupiedAt[selectedTable.value.id];
  if (!ts) return null;
  return new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
});

// ── Actions ──────────────────────────────────────────────────────────────────
function openTableDetails(table) {
  const status = store.getTableStatus(table.id).status;
  if (status === 'free') {
    pendingTableToOpen.value = table;
    peopleAdults.value = table.covers || 2;
    peopleChildren.value = 0;
    showPeopleModal.value = true;
  } else {
    _openTableModal(table);
  }
}

function _openTableModal(table) {
  selectedTable.value = table;
  showTableModal.value = true;
}

function closeTableModal() {
  showTableModal.value = false;
  selectedTable.value = null;
}

function confirmPeopleAndOpenTable() {
  const table = pendingTableToOpen.value;
  if (!table) return;

  // Open a billing session for this table seating
  const billSessionId = store.openTableSession(table.id, peopleAdults.value, peopleChildren.value);

  // Auto-add cover charge order if configured
  const cc = store.config.coverCharge;
  if (cc?.enabled && cc?.autoAdd) {
    const coverItems = [];
    if (peopleAdults.value > 0 && cc.priceAdult > 0) {
      coverItems.push({
        uid: 'cop_a_' + Math.random().toString(36).slice(2, 11),
        dishId: cc.dishId + '_adulto',
        name: cc.name,
        unitPrice: cc.priceAdult,
        quantity: peopleAdults.value,
        voidedQuantity: 0,
        notes: [],
      });
    }
    if (peopleChildren.value > 0 && cc.priceChild > 0) {
      coverItems.push({
        uid: 'cop_c_' + Math.random().toString(36).slice(2, 11),
        dishId: cc.dishId + '_bambino',
        name: cc.name + ' bambino',
        unitPrice: cc.priceChild,
        quantity: peopleChildren.value,
        voidedQuantity: 0,
        notes: [],
      });
    }
    if (coverItems.length > 0) {
      const coverOrder = {
        id: 'ord_' + Math.random().toString(36).slice(2, 11),
        table: table.id,
        billSessionId,
        status: 'accepted',
        time: new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
        totalAmount: 0,
        itemCount: 0,
        dietaryPreferences: {},
        orderItems: coverItems,
        isCoverCharge: true,
      };
      updateOrderTotals(coverOrder);
      store.addOrder(coverOrder);
      store.changeOrderStatus(coverOrder, 'accepted');
    }
  }

  showPeopleModal.value = false;
  pendingTableToOpen.value = null;
  _openTableModal(table);
}

function createNewOrder() {
  if (!selectedTable.value) return;
  const session = store.tableCurrentBillSession[selectedTable.value.id];

  // TODO API: replace store.addOrder() with POST /api/orders when API is available
  const newOrd = {
    id: 'ord_' + Math.random().toString(36).slice(2, 11),
    table: selectedTable.value.id,
    billSessionId: session?.billSessionId ?? null,
    status: 'pending',
    time: new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
    totalAmount: 0,
    itemCount: 0,
    dietaryPreferences: {},
    orderItems: [],
  };
  store.addOrder(newOrd);
  closeTableModal();
  emit('new-order-for-comande', newOrd);
}

function viewOrder(ord) {
  closeTableModal();
  emit('view-order', ord);
}

// ── Expose for parent (WaiterSalaView) ────────────────────────────────────
defineExpose({ openTableDetails });
</script>
