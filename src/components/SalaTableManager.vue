<template>
  <!-- WORKSPACE: TABLE MAP -->
  <div class="flex-1 flex flex-col bg-gray-100/80 overflow-y-auto p-4 md:p-8 relative min-h-0">
    <div class="max-w-6xl mx-auto w-full">

      <!-- Header riga -->
      <div class="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2 mb-4 md:mb-6">
        <h2 class="text-xl md:text-2xl font-black text-gray-800 flex items-center gap-2 md:gap-3">
          <Grid3x3 class="text-gray-500 size-6 md:size-8" /> Mappa Sala
        </h2>
      </div>

      <!-- Riepilogo stato tavoli + Tab Sala + Filtri stato — tutto nella stessa barra -->
      <div class="flex flex-wrap items-center gap-2 mb-4 md:mb-5 overflow-x-auto pb-1 -mx-1 px-1">
        <!-- Room tabs — visibili solo quando sono configurate più sale -->
        <template v-if="store.rooms.length > 1">
          <!-- Tutti -->
          <button
            @click="activeRoomId = 'all'; activeStatusFilter = null"
            class="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl font-bold text-xs transition-all active:scale-95"
            :class="activeRoomId === 'all'
              ? 'theme-bg text-white shadow-md'
              : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300 shadow-sm'"
          >
            <Grid3x3 class="size-3 shrink-0" />
            <span>Tutti</span>
            <span class="text-[10px] font-black opacity-70">{{ store.config.tables.length }}</span>
          </button>
          <!-- Singole sale -->
          <button
            v-for="room in store.rooms"
            :key="room.id"
            @click="activeRoomId = room.id; activeStatusFilter = null"
            class="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl font-bold text-xs transition-all active:scale-95"
            :class="activeRoomId === room.id
              ? 'theme-bg text-white shadow-md'
              : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300 shadow-sm'"
          >
            <Grid3x3 class="size-3 shrink-0" />
            <span>{{ room.label }}</span>
            <span class="text-[10px] font-black opacity-70">{{ room.tables.length }}</span>
          </button>
          <!-- Divisore -->
          <span class="w-px h-5 bg-gray-300 shrink-0 self-center"></span>
        </template>

        <!-- Filtri stato tavoli -->
        <TableStatsBar
          :freeCount="freeTablesCount"
          :occupiedCount="occupiedTablesCount"
          :pendingCount="pendingTablesCount"
          :paidCount="paidTablesCount"
          :activeFilter="activeStatusFilter"
          @update:activeFilter="activeStatusFilter = $event"
        />
      </div>

      <!-- Griglia Tavoli — vista "Tutti" raggruppata per sala -->
      <template v-if="activeRoomId === 'all' && store.rooms.length > 1">
        <div v-for="room in store.rooms" :key="room.id" class="mb-6 last:mb-0">
          <p class="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 px-0.5">{{ room.label }}</p>
          <TableGrid :tables="filteredTablesForRoom(room)" @open-table="openTableDetails">
            <template #status="{ table, tableStatus }">
              <span class="block text-[8px] md:text-[10px] font-bold uppercase tracking-widest opacity-80 mb-0.5 md:mb-1 truncate">
                {{ tableStatus.status === 'pending' ? 'In Attesa' : tableStatus.status === 'paid' ? 'Saldato' : 'Occupato' }}
              </span>
              <span class="block font-black text-sm md:text-lg bg-white/20 rounded-md md:rounded-lg py-0.5 px-1 truncate">
                {{ tableOrderCount(table.id) }} coman{{ tableOrderCount(table.id) !== 1 ? 'de' : 'da' }}
              </span>
            </template>
          </TableGrid>
        </div>
      </template>

      <!-- Griglia Tavoli — vista singola sala -->
      <TableGrid v-else :tables="activeRoomTables" @open-table="openTableDetails">
        <template #status="{ table, tableStatus }">
          <span class="block text-[8px] md:text-[10px] font-bold uppercase tracking-widest opacity-80 mb-0.5 md:mb-1 truncate">
            {{ tableStatus.status === 'pending' ? 'In Attesa' : tableStatus.status === 'paid' ? 'Saldato' : 'Occupato' }}
          </span>
          <span class="block font-black text-sm md:text-lg bg-white/20 rounded-md md:rounded-lg py-0.5 px-1 truncate">
            {{ tableOrderCount(table.id) }} coman{{ tableOrderCount(table.id) !== 1 ? 'de' : 'da' }}
          </span>
        </template>
      </TableGrid>

    </div>
  </div>

  <!-- ================================================================ -->
  <!-- PEOPLE MODAL: shown when opening a free table                    -->
  <!-- Shared component — any UI change reflects in all apps.          -->
  <!-- ================================================================ -->
  <PeopleModal
    :show="showPeopleModal"
    :table="pendingTableToOpen"
    :showChildrenInput="showChildrenInput"
    v-model:adults="peopleAdults"
    v-model:children="peopleChildren"
    @cancel="showPeopleModal = false; pendingTableToOpen = null"
    @confirm="confirmPeopleAndOpenTable"
  />

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
                <template v-if="showChildrenInput">
                  {{ tableSession.adults }} {{ tableSession.adults === 1 ? 'adulto' : 'adulti' }}
                  <template v-if="tableSession.children > 0">
                    + {{ tableSession.children }} {{ tableSession.children === 1 ? 'bambino' : 'bambini' }}
                  </template>
                  · {{ tableSession.adults + tableSession.children }} {{ (tableSession.adults + tableSession.children) === 1 ? 'persona' : 'persone' }}
                </template>
                <template v-else>
                  {{ tableSession.adults }} {{ tableSession.adults === 1 ? 'persona' : 'persone' }}
                </template>
              </span>
              <span v-else>{{ selectedTable.covers }} posti</span>
              · {{ tableOrders.length }} comanda{{ tableOrders.length !== 1 ? 'e' : '' }}
              <span v-if="occupiedSince"> · {{ occupiedSince }}</span>
            </p>
          </div>
        </div>
        <div class="flex items-center gap-1 md:gap-2">
          <!-- Sposta button -->
          <button v-if="tableOrders.length > 0" @click="openMoveModal"
            class="bg-white/10 hover:bg-white/20 px-3 py-2 rounded-xl font-bold text-[10px] md:text-xs flex items-center gap-1.5 transition-all active:scale-95 shrink-0"
            title="Sposta Tavolo">
            <ArrowRightLeft class="size-4" /> <span class="hidden sm:inline">Sposta</span>
          </button>
          <!-- Unisci button -->
          <button v-if="tableOrders.length > 0" @click="openMergeModal"
            class="bg-white/10 hover:bg-white/20 px-3 py-2 rounded-xl font-bold text-[10px] md:text-xs flex items-center gap-1.5 transition-all active:scale-95 shrink-0"
            title="Unisci con altro Tavolo">
            <Merge class="size-4" /> <span class="hidden sm:inline">Unisci</span>
          </button>
          <button @click="closeTableModal" class="bg-white/10 hover:bg-white/20 p-2 md:p-2.5 rounded-full transition-colors active:scale-95">
            <X class="size-5 md:size-6" />
          </button>
        </div>
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
                  <span v-else-if="ord.isDirectEntry" class="size-2 rounded-full theme-bg shrink-0"></span>
                  <span v-else-if="ord.status === 'accepted'" class="size-2 rounded-full bg-blue-400 shrink-0"></span>
                  <span class="font-bold text-sm text-gray-800">{{ ord.itemCount }} pz</span>
                  <span class="text-xs text-gray-500">· {{ ord.time }}</span>
                </div>
                <div class="flex items-center gap-2">
                  <span v-if="ord.status === 'pending'" class="text-[9px] font-bold uppercase bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full border border-amber-200">In Attesa</span>
                  <span v-else-if="ord.isDirectEntry" class="text-[9px] font-bold uppercase theme-text px-2 py-0.5 rounded-full border theme-border flex items-center gap-1"><Zap class="size-2.5" /> Voce Diretta</span>
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

  <!-- ================================================================ -->
  <!-- MODAL: SPOSTA TAVOLO                                              -->
  <!-- ================================================================ -->
  <div v-if="showMoveModal" class="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 max-h-[90dvh] overflow-y-auto">
      <div class="flex justify-between items-center mb-4">
        <h3 class="font-bold text-gray-800 flex items-center gap-2"><ArrowRightLeft class="size-5 theme-text" /> Sposta Tavolo {{ selectedTable?.label }}</h3>
        <button @click="showMoveModal = false" class="text-gray-400 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-full p-1.5 transition-colors"><X class="size-4" /></button>
      </div>
      <p class="text-xs text-gray-500 mb-4">Seleziona il tavolo di destinazione libero. Tutti gli ordini verranno spostati.</p>
      <div class="grid grid-cols-4 gap-2 max-h-64 overflow-y-auto">
        <button v-for="table in freeTables" :key="'sp_'+table.id"
          @click="confirmMove(table)"
          class="aspect-square rounded-xl border-2 border-emerald-200 bg-emerald-50 text-emerald-800 font-black text-lg flex items-center justify-center hover:bg-emerald-100 active:scale-95 transition-all">
          {{ table.label }}
        </button>
      </div>
      <div v-if="freeTables.length === 0" class="text-center text-gray-400 text-sm py-4">Nessun tavolo libero disponibile.</div>
    </div>
  </div>

  <!-- ================================================================ -->
  <!-- MODAL: UNISCI TAVOLI                                              -->
  <!-- ================================================================ -->
  <div v-if="showMergeModal" class="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 max-h-[90dvh] overflow-y-auto">
      <div class="flex justify-between items-center mb-4">
        <h3 class="font-bold text-gray-800 flex items-center gap-2"><Merge class="size-5 theme-text" /> Unisci con Tavolo {{ selectedTable?.label }}</h3>
        <button @click="showMergeModal = false" class="text-gray-400 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-full p-1.5 transition-colors"><X class="size-4" /></button>
      </div>
      <p class="text-xs text-gray-500 mb-4">Seleziona il tavolo con cui fondere gli ordini. I suoi ordini e i coperti verranno uniti con questo tavolo.</p>
      <div class="grid grid-cols-4 gap-2 max-h-64 overflow-y-auto">
        <button v-for="table in occupiedTables" :key="'un_'+table.id"
          @click="confirmMerge(table)"
          class="aspect-square rounded-xl border-2 border-[var(--brand-primary)] theme-bg text-white font-black text-lg flex items-center justify-center hover:opacity-90 active:scale-95 transition-all">
          {{ table.label }}
        </button>
      </div>
      <div v-if="occupiedTables.length === 0" class="text-center text-gray-400 text-sm py-4">Nessun altro tavolo occupato disponibile.</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import {
  Grid3x3, Users, Timer, X, Coffee, ChevronRight, Plus, ArrowRightLeft, Merge, Zap,
} from 'lucide-vue-next';
import { useAppStore } from '../store/index.js';
import { appConfig } from '../utils/index.js';
// Shared component — used by both Sala and Cassa apps.
import PeopleModal from './shared/PeopleModal.vue';
import TableStatsBar from './shared/TableStatsBar.vue';
import TableGrid from './shared/TableGrid.vue';

const emit = defineEmits(['new-order-for-comande', 'view-order']);

const store = useAppStore();

// ── Room tabs ─────────────────────────────────────────────────────────────
const activeRoomId = ref(store.rooms.length > 1 ? 'all' : (store.rooms[0]?.id ?? null));
const activeStatusFilter = ref(null);

function matchesActiveStatusFilter(table) {
  if (!activeStatusFilter.value) return true;
  const status = store.getTableStatus(table.id).status;
  if (activeStatusFilter.value === 'occupied') {
    return status === 'occupied' || status === 'bill_requested';
  }
  return status === activeStatusFilter.value;
}

function filteredTablesForRoom(room) {
  if (!activeStatusFilter.value) return room.tables;
  return room.tables.filter(matchesActiveStatusFilter);
}

const activeRoomTables = computed(() => {
  if (activeRoomId.value === 'all') {
    const all = store.config.tables;
    if (!activeStatusFilter.value) return all;
    return all.filter(matchesActiveStatusFilter);
  }
  const room = store.rooms.find(r => r.id === activeRoomId.value);
  const tables = room ? room.tables : store.config.tables;
  if (!activeStatusFilter.value) return tables;
  return tables.filter(matchesActiveStatusFilter);
});

// ── Table status counters ──────────────────────────────────────────────────
const freeTablesCount = computed(() =>
  store.config.tables.filter(t => store.getTableStatus(t.id).status === 'free').length,
);
const occupiedTablesCount = computed(() =>
  store.config.tables.filter(t => {
    const st = store.getTableStatus(t.id).status;
    return st === 'occupied' || st === 'bill_requested';
  }).length,
);
const pendingTablesCount = computed(() =>
  store.config.tables.filter(t => store.getTableStatus(t.id).status === 'pending').length,
);
const paidTablesCount = computed(() =>
  store.config.tables.filter(t => store.getTableStatus(t.id).status === 'paid').length,
);

function tableOrderCount(tableId) {
  return store.orders.filter(
    o => o.table === tableId && o.status !== 'completed' && o.status !== 'rejected',
  ).length;
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

// ── Sposta / Unisci modal state ────────────────────────────────────────────
const showMoveModal = ref(false);
const showMergeModal = ref(false);

const freeTables = computed(() =>
  store.config.tables.filter(
    t => t.id !== selectedTable.value?.id && store.getTableStatus(t.id).status === 'free',
  ),
);

const occupiedTables = computed(() =>
  store.config.tables.filter(
    t => t.id !== selectedTable.value?.id && store.getTableStatus(t.id).status !== 'free',
  ),
);

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
  return new Date(ts).toLocaleTimeString(appConfig.locale, { hour: '2-digit', minute: '2-digit', timeZone: appConfig.timezone });
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
      const coverOrder = store.addDirectOrder(table.id, billSessionId, coverItems);
      if (coverOrder) coverOrder.isCoverCharge = true;
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
    time: new Date().toLocaleTimeString(appConfig.locale, { hour: '2-digit', minute: '2-digit', timeZone: appConfig.timezone }),
    totalAmount: 0,
    itemCount: 0,
    dietaryPreferences: {},
    orderItems: [],
    globalNote: '',
    noteVisibility: { cassa: true, sala: true, cucina: true },
  };
  store.addOrder(newOrd);
  closeTableModal();
  emit('new-order-for-comande', newOrd);
}

function viewOrder(ord) {
  closeTableModal();
  emit('view-order', ord);
}

function openMoveModal() { showMoveModal.value = true; }
function openMergeModal() { showMergeModal.value = true; }

function confirmMove(targetTable) {
  if (!selectedTable.value) return;
  store.moveTableOrders(selectedTable.value.id, targetTable.id);
  showMoveModal.value = false;
  // Update selectedTable to the new one
  selectedTable.value = targetTable;
}

function confirmMerge(sourceTable) {
  if (!selectedTable.value) return;
  store.mergeTableOrders(sourceTable.id, selectedTable.value.id);
  showMergeModal.value = false;
}

// ── Expose for parent (SalaView) ────────────────────────────────────
defineExpose({ openTableDetails });
</script>
