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
      :class="store.getTableColorClass(table.id)"
    >
      <!-- Covers badge -->
      <span class="absolute top-2 right-2 text-[9px] md:text-[10px] font-bold opacity-60 flex items-center gap-0.5">
        <Users class="size-2.5" />{{ table.covers }}
      </span>

      <!-- Table label -->
      <h3 class="text-xl md:text-2xl font-black mt-2">{{ table.label }}</h3>

      <!-- Non-free state: elapsed time + app-specific slot content -->
      <!-- tableStatus is passed to the slot scope so parent templates can use it without extra store calls -->
      <div v-if="store.getTableStatus(table.id).status !== 'free'" class="mt-auto text-center w-full">
        <span v-if="getElapsedTime(table.id)" class="absolute top-2 left-2 text-[8px] font-bold opacity-70 flex items-center gap-0.5">
          <Timer class="size-2.5" />{{ getElapsedTime(table.id) }}
        </span>
        <slot name="status" :table="table" :tableStatus="store.getTableStatus(table.id)" />
      </div>

      <!-- Free state -->
      <div v-else class="mt-auto text-center w-full opacity-30">
        <span class="block text-[9px] md:text-[10px] font-bold uppercase tracking-widest">Libero</span>
      </div>

    </button>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { Users, Timer } from 'lucide-vue-next';
import { useAppStore } from '../../store/index.js';

defineEmits(['open-table']);

defineProps({
  tables: { type: Array, required: true },
});

const store = useAppStore();

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
