<template>
  <!-- Table grid — shared by CassaTableManager and SalaTableManager.
       The app-specific status label + value are injected via the #status scoped slot:
         <template #status="{ table, tableStatus }">…</template>                -->
  <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3 md:gap-4">
    <button
      v-for="table in tables"
      :key="table.id"
      type="button"
      @click="$emit('open-table', table)"
      class="relative aspect-square rounded-2xl border-[3px] flex flex-col items-center justify-center p-2 md:p-3 transition-transform active:scale-95 shadow-sm bg-white overflow-hidden group"
      :class="colorClassFromStatus(tableStatusMap[table.id].status)"
    >
      <!-- Covers badge -->
      <span class="absolute top-2 right-2 text-[9px] md:text-[10px] font-bold opacity-60 flex items-center gap-0.5">
        <Users class="size-2.5" />{{ table.covers }}
      </span>

      <!-- Table label -->
      <h3 class="text-xl md:text-2xl font-black mt-2">{{ table.label }}</h3>

      <div v-if="tableStatusMap[table.id].status !== 'free'" class="mt-auto text-center w-full">
        <span v-if="getElapsedTime(table.id)" class="absolute top-2 left-2 text-[8px] font-bold opacity-70 flex items-center gap-0.5">
          <Timer class="size-2.5" />{{ getElapsedTime(table.id) }}
        </span>
        <slot name="status" :table="table" :tableStatus="tableStatusMap[table.id]" />
      </div>

      <!-- Free state -->
      <div v-else class="mt-auto text-center w-full opacity-30">
        <span class="block text-[9px] md:text-[10px] font-bold uppercase tracking-widest">Libero</span>
      </div>

    </button>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { Users, Timer } from 'lucide-vue-next';
import { useAppStore } from '../../store/index.js';

defineEmits(['open-table']);

const props = defineProps({
  tables: { type: Array, required: true },
});

const store = useAppStore();

// Compute table status once per table so the template doesn't call getTableStatus multiple times.
const tableStatusMap = computed(() => {
  const map = {};
  for (const table of props.tables) {
    map[table.id] = store.getTableStatus(table.id);
  }
  return map;
});

// Mirror of store.getTableColorClass, but accepts a pre-computed status string.
function colorClassFromStatus(status) {
  if (status === 'free') return 'border-emerald-200 text-emerald-800 bg-emerald-50 hover:bg-emerald-100';
  if (status === 'pending') return 'border-amber-400 text-amber-900 bg-amber-50 shadow-[0_0_15px_rgba(251,191,36,0.3)]';
  if (status === 'paid') return 'border-violet-400 text-violet-900 bg-violet-100 shadow-[0_0_15px_rgba(139,92,246,0.3)]';
  if (status === 'bill_requested') return 'border-blue-400 text-blue-900 bg-blue-100 shadow-[0_0_15px_rgba(59,130,246,0.3)]';
  return 'border-[var(--brand-primary)] text-white theme-bg shadow-md';
}

// Reactive clock for elapsed-time display (updates every 30 s)
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
</script>
