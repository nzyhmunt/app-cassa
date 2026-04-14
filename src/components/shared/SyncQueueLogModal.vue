<template>
  <!-- Admin-only modal: sync queue log with filter by status -->
  <div
    v-if="modelValue"
    class="fixed inset-0 z-[95] bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4"
    @click.self="$emit('update:modelValue', false)"
  >
    <div class="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85dvh]">

      <!-- Header -->
      <div class="bg-gray-50 border-b border-gray-200 p-4 flex justify-between items-center shrink-0">
        <h3 class="font-bold text-base flex items-center gap-2 text-gray-800">
          <ListOrdered class="size-4 text-gray-500" />
          Log Coda Sincronizzazione
        </h3>
        <button
          @click="$emit('update:modelValue', false)"
          class="text-gray-400 hover:text-gray-800 bg-gray-200 hover:bg-gray-300 rounded-full p-1.5 transition-colors active:scale-95"
        >
          <X class="size-5" />
        </button>
      </div>

      <!-- Filter tabs + refresh button -->
      <div class="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-white">
        <div class="flex gap-0.5 bg-gray-100 p-0.5 rounded-xl flex-1">
          <button
            v-for="tab in TABS"
            :key="tab.key"
            @click="activeFilter = tab.key"
            class="flex-1 py-1.5 text-xs font-bold rounded-lg transition-all active:scale-95"
            :class="
              activeFilter === tab.key
                ? 'bg-white text-gray-800 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            "
          >
            {{ tab.label }}
            <span v-if="countFor(tab.key) > 0" class="ml-0.5 text-[9px] opacity-60"
              >({{ countFor(tab.key) }})</span
            >
          </button>
        </div>
        <button
          @click="refresh"
          :disabled="loading"
          class="p-2 rounded-xl bg-gray-50 hover:bg-gray-100 border border-gray-200 transition-colors active:scale-95 disabled:opacity-50"
          title="Aggiorna"
        >
          <RefreshCw class="size-4 text-gray-500" :class="loading ? 'animate-spin' : ''" />
        </button>
      </div>

      <!-- Entry list -->
      <div class="flex-1 overflow-y-auto p-4 space-y-2">
        <!-- Empty state -->
        <div v-if="!loading && filteredEntries.length === 0" class="text-center py-12 text-gray-400">
          <CheckCircle class="size-10 mx-auto mb-2 text-emerald-400" />
          <p class="font-bold text-sm">Coda vuota</p>
          <p class="text-xs mt-1">
            {{
              activeFilter === 'error'
                ? 'Nessuna operazione fallita'
                : activeFilter === 'pending'
                  ? 'Nessuna operazione in attesa'
                  : 'Nessuna operazione in coda'
            }}
          </p>
        </div>

        <!-- Entry cards -->
        <div
          v-for="entry in filteredEntries"
          :key="entry.id"
          class="rounded-xl border p-3 space-y-1.5"
          :class="{
            'border-red-200 bg-red-50': entry.attempts > 0,
            'border-gray-200 bg-white': entry.attempts === 0,
          }"
        >
          <div class="flex items-center justify-between gap-2">
            <!-- Collection + operation badge -->
            <div class="flex items-center gap-1.5 min-w-0">
              <span
                class="shrink-0 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-md"
                :class="{
                  'bg-emerald-100 text-emerald-700': entry.operation === 'create',
                  'bg-blue-100 text-blue-700': entry.operation === 'update',
                  'bg-red-100 text-red-700': entry.operation === 'delete',
                }"
              >{{ entry.operation }}</span>
              <span class="text-xs font-bold text-gray-700 truncate">{{ entry.collection }}</span>
            </div>
            <!-- Status badge -->
            <span
              class="shrink-0 text-[9px] font-medium px-1.5 py-0.5 rounded-full"
              :class="
                entry.attempts > 0
                  ? 'bg-red-100 text-red-600'
                  : 'bg-gray-100 text-gray-500'
              "
            >
              {{ entry.attempts > 0 ? `${entry.attempts} tentativi` : 'In coda' }}
            </span>
          </div>
          <!-- Record ID -->
          <p class="text-[10px] text-gray-400 font-mono truncate leading-tight">
            ID: {{ entry.record_id }}
          </p>
          <!-- Timestamp -->
          <p class="text-[10px] text-gray-400 leading-tight">
            {{ formatTs(entry.date_created) }}
          </p>
        </div>
      </div>

      <!-- Footer bar -->
      <div class="shrink-0 px-4 py-2.5 border-t border-gray-100 bg-gray-50 text-[10px] text-gray-400 flex items-center justify-between">
        <span>{{ allEntries.length }} operazioni in coda</span>
        <span>Aggiornato: {{ lastRefresh }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { X, RefreshCw, ListOrdered, CheckCircle } from 'lucide-vue-next';
import { appConfig } from '../../utils/index.js';
import { getPendingEntries } from '../../composables/useSyncQueue.js';

const props = defineProps({
  modelValue: Boolean,
});

defineEmits(['update:modelValue']);

const TABS = [
  { key: 'all', label: 'Tutti' },
  { key: 'pending', label: 'In coda' },
  { key: 'error', label: 'Falliti' },
];

const activeFilter = ref('all');
const allEntries = ref([]);
const loading = ref(false);
const lastRefresh = ref('—');

const filteredEntries = computed(() => {
  if (activeFilter.value === 'pending') return allEntries.value.filter(e => e.attempts === 0);
  if (activeFilter.value === 'error') return allEntries.value.filter(e => e.attempts > 0);
  return allEntries.value;
});

function countFor(key) {
  if (key === 'pending') return allEntries.value.filter(e => e.attempts === 0).length;
  if (key === 'error') return allEntries.value.filter(e => e.attempts > 0).length;
  return allEntries.value.length;
}

async function refresh() {
  loading.value = true;
  try {
    allEntries.value = await getPendingEntries();
    lastRefresh.value = new Date().toLocaleTimeString(appConfig.locale, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: appConfig.timezone,
    });
  } catch {
    allEntries.value = [];
  } finally {
    loading.value = false;
  }
}

function formatTs(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(appConfig.locale, {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: appConfig.timezone,
    });
  } catch {
    return iso;
  }
}

// Reload entries every time the modal is opened
watch(
  () => props.modelValue,
  (val) => {
    if (val) refresh();
  },
);
</script>
