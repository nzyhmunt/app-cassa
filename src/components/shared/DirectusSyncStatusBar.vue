<template>
  <!-- Shown only when Directus sync is enabled -->
  <div
    v-if="directusEnabled"
    class="shrink-0 flex items-center gap-2 px-4 py-1 bg-white border-t border-gray-100 text-[10px] text-gray-400 select-none"
  >
    <!-- Online/offline indicator -->
    <span
      class="flex items-center gap-1 font-medium"
      :class="isOnline ? 'text-emerald-600' : 'text-red-500'"
    >
      <span
        class="inline-block size-1.5 rounded-full shrink-0"
        :class="isOnline ? 'bg-emerald-500' : 'bg-red-400'"
      ></span>
      {{ isOnline ? 'Online' : 'Offline' }}
    </span>

    <span class="text-gray-200">·</span>

    <!-- Sync status -->
    <span v-if="syncStatus === 'syncing'" class="flex items-center gap-1 text-blue-500">
      <LoaderCircle class="size-3 shrink-0 animate-spin" />
      <span>Sincronizzazione…</span>
    </span>
    <span v-else-if="syncStatus === 'error'" class="flex items-center gap-1 text-red-500">
      <AlertCircle class="size-3 shrink-0" />
      <span>Errore sync</span>
    </span>
    <span v-else class="flex items-center gap-1">
      <Cloud class="size-3 shrink-0" />
      <span>Directus attivo</span>
    </span>

    <!-- Last sync time -->
    <template v-if="formattedLastSync">
      <span class="text-gray-200">·</span>
      <span>Agg. {{ formattedLastSync }}</span>
    </template>

    <!-- Pending queue count -->
    <template v-if="pendingCount > 0">
      <span class="text-gray-200">·</span>
      <span class="text-amber-500 font-medium">{{ pendingCount }} in coda</span>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { LoaderCircle, AlertCircle, Cloud } from 'lucide-vue-next';
import { useAppStore } from '../../store/index.js';
import { directusEnabledRef } from '../../composables/useDirectusClient.js';
import { useDirectusSync } from '../../composables/useDirectusSync.js';
import { getPendingEntries } from '../../composables/useSyncQueue.js';

const sync = useDirectusSync();
const store = useAppStore();
const runtimeConfig = computed(() => store.config ?? {});

const isOnline = ref(typeof navigator !== 'undefined' ? navigator.onLine : true);
const pendingCount = ref(0);
let _refreshTimer = null;

const directusEnabled = directusEnabledRef;

const syncStatus = computed(() => sync.syncStatus.value);

const formattedLastSync = computed(() => {
  const ts = sync.lastPullAt.value || sync.lastPushAt.value;
  if (!ts) return null;
  try {
    return new Date(ts).toLocaleTimeString(runtimeConfig.value.locale ?? 'it-IT', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: runtimeConfig.value.timezone ?? 'Europe/Rome',
    });
  } catch {
    return null;
  }
});

async function _updatePendingCount() {
  if (!directusEnabled.value) return;
  try {
    const entries = await getPendingEntries();
    pendingCount.value = entries.length;
  } catch {
    pendingCount.value = 0;
  }
}

function _onOnline() { isOnline.value = true; }
function _onOffline() { isOnline.value = false; }

onMounted(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener('online', _onOnline);
    window.addEventListener('offline', _onOffline);
  }
  _updatePendingCount();
  _refreshTimer = setInterval(_updatePendingCount, 10_000);
});

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('online', _onOnline);
    window.removeEventListener('offline', _onOffline);
  }
  clearInterval(_refreshTimer);
});
</script>
