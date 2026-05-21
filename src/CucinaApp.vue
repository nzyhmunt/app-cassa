<template>
  <div
    id="app"
    class="h-full flex flex-col relative w-full"
    :style="configStore.cssVars"
    @click="auth.recordActivity()"
    @keydown="auth.recordActivity()"
    @touchstart.passive="onRootTouchStart"
    @touchmove.passive="onRootTouchMove"
    @touchend.passive="onRootTouchEnd"
    @touchcancel.passive="onRootTouchCancel"
  >
    <div
      class="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 z-[95] transition-all duration-300"
      :class="(isPulling || isSwipeRefreshing || isRefreshDone) ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-3'"
    >
      <div class="rounded-full border border-gray-200 bg-white/95 shadow-sm px-3 py-1.5">
        <Check v-if="isRefreshDone" class="size-4 text-emerald-600" />
        <RefreshCw
          v-else
          class="size-4"
          :style="!isSwipeRefreshing ? { transform: `rotate(${pullRotationDeg}deg)` } : undefined"
          :class="isSwipeRefreshing ? 'animate-spin text-blue-600' : isThresholdReached ? 'text-emerald-600' : 'text-gray-500'"
        />
      </div>
    </div>
    <router-view @open-settings="showSettings = true" />
    <CucinaSettingsModal v-model="showSettings" />
    <PwaInstallBanner />
    <LockScreen />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useConfigStore, useOrderStore } from './store/index.js';
import { useWakeLock } from './composables/useWakeLock.js';
import { resolveStorageKeys, getInstanceName } from './store/persistence.js';
import { useAuth } from './composables/useAuth.js';
import CucinaSettingsModal from './components/CucinaSettingsModal.vue';
import PwaInstallBanner from './components/shared/PwaInstallBanner.vue';
import LockScreen from './components/LockScreen.vue';
import { RefreshCw, Check } from 'lucide-vue-next';
import { useDirectusSync } from './composables/useDirectusSync.js';
import { loadDirectusConfigFromStorage } from './composables/useDirectusClient.js';
import { useSyncStoreProxy } from './composables/useSyncStoreProxy.js';
import { useAppSwipeRefresh } from './composables/useAppSwipeRefresh.js';
import { useIDBPurge, isDirectusSyncActive } from './composables/useIDBPurge.js';

const configStore = useConfigStore();
const orderStore = useOrderStore();
const auth = useAuth();
const sync = useDirectusSync();
const showSettings = ref(false);
const syncStore = useSyncStoreProxy(configStore, orderStore);
const {
  isSwipeRefreshing,
  isRefreshDone,
  isPulling,
  isThresholdReached,
  pullRotationDeg,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onTouchCancel,
} = useAppSwipeRefresh({
  configStore,
  orderStore,
  sync,
  logPrefix: 'CucinaApp',
});

useWakeLock();

// Best-effort preload; full sync startup awaits config in restartSync().
loadDirectusConfigFromStorage().catch((e) => {
  console.warn('[CucinaApp] Failed to load Directus config from IDB:', e);
});

const { storageKey } = resolveStorageKeys(getInstanceName());

function onStorageChange(event) {
  if (event.key !== storageKey) return;
  void hydrateStateFromStorage();
}

async function hydrateStateFromStorage() {
  try {
    await Promise.all([
      configStore.hydrateConfigFromIDB(),
      orderStore.refreshOperationalStateFromIDB(),
    ]);
  } catch (error) {
    console.warn('[CucinaApp] Failed to hydrate state from storage event:', error);
  }
}

async function restartSync() {
  try {
    await loadDirectusConfigFromStorage();
  } catch (e) { console.warn('[CucinaApp] Failed to load Directus config from IDB:', e); }
  sync.stopSync();
  await sync.startSync({ appType: 'cucina', store: syncStore });
}

async function onDirectusConfigUpdated() {
  await restartSync();
}

function onRootTouchStart(event) {
  auth.recordActivity();
  onTouchStart(event);
}

function onRootTouchMove(event) {
  onTouchMove(event);
}

function onRootTouchEnd(event) {
  onTouchEnd(event);
}

function onRootTouchCancel() {
  onTouchCancel();
}

const { runIDBPurge } = useIDBPurge();

onMounted(async () => {
  window.addEventListener('storage', onStorageChange);
  window.addEventListener('directus-config-updated', onDirectusConfigUpdated);
  await restartSync();
  // Best-effort post-startup IDB purge.  Guard: only when Directus sync is
  // active so all data has a chance to reach the server first.
  if (isDirectusSyncActive()) {
    runIDBPurge().catch((e) => {
      console.warn('[CucinaApp] IDB purge error (non-fatal):', e);
    });
  }
});

onUnmounted(() => {
  window.removeEventListener('storage', onStorageChange);
  window.removeEventListener('directus-config-updated', onDirectusConfigUpdated);
  sync.stopSync();
});
</script>
