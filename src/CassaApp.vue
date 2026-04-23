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
      class="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 z-[95] transition-all duration-150"
      :class="(isPulling || isSwipeRefreshing) ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-3'"
    >
      <div class="rounded-full border border-gray-200 bg-white/95 shadow-sm px-3 py-1.5">
        <RefreshCw
          class="size-4"
          :style="!isSwipeRefreshing ? { transform: `rotate(${pullRotationDeg}deg)` } : undefined"
          :class="isSwipeRefreshing ? 'animate-spin text-blue-600' : isThresholdReached ? 'text-emerald-600' : 'text-gray-500'"
        />
      </div>
    </div>
    <CassaNavbar @open-settings="showSettings = true" @open-cassa="showCassa = true" @lock="auth.lock()" />
    <router-view />
    <DirectusSyncStatusBar />
    <CassaSettingsModal v-model="showSettings" />
    <CassaDashboard v-model="showCassa" />
    <PwaInstallBanner />
    <LockScreen />
    <NumericKeyboard />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import CassaNavbar from './components/CassaNavbar.vue';
import CassaSettingsModal from './components/CassaSettingsModal.vue';
import CassaDashboard from './components/CassaDashboard.vue';
import PwaInstallBanner from './components/shared/PwaInstallBanner.vue';
import LockScreen from './components/LockScreen.vue';
import NumericKeyboard from './components/NumericKeyboard.vue';
import DirectusSyncStatusBar from './components/shared/DirectusSyncStatusBar.vue';
import { RefreshCw } from 'lucide-vue-next';
import { useConfigStore, useOrderStore } from './store/index.js';
import { useWakeLock } from './composables/useWakeLock.js';
import { resolveStorageKeys, getInstanceName } from './store/persistence.js';
import { useAuth } from './composables/useAuth.js';
import { useDirectusSync } from './composables/useDirectusSync.js';
import { loadDirectusConfigFromStorage } from './composables/useDirectusClient.js';
import { useSyncStoreProxy } from './composables/useSyncStoreProxy.js';
import { useAppSwipeRefresh } from './composables/useAppSwipeRefresh.js';

const configStore = useConfigStore();
const orderStore = useOrderStore();
const auth = useAuth();
const sync = useDirectusSync();
const showSettings = ref(false);
const showCassa = ref(false);
const syncStore = useSyncStoreProxy(configStore, orderStore);
const {
  isSwipeRefreshing,
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
  logPrefix: 'CassaApp',
});

useWakeLock();

// Best-effort preload; full sync startup awaits config in restartSyncFromCurrentConfig().
loadDirectusConfigFromStorage().catch((e) => {
  console.warn('[CassaApp] Failed to load Directus config from IDB:', e);
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
    console.warn('[CassaApp] Failed to hydrate state from storage event:', error);
  }
}

async function restartSyncFromCurrentConfig() {
  try {
    await loadDirectusConfigFromStorage();
  } catch (e) { console.warn('[CassaApp] Failed to load Directus config from IDB:', e); }
  sync.stopSync();
  await sync.startSync({ appType: 'cassa', store: syncStore });
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

onMounted(async () => {
  window.addEventListener('storage', onStorageChange);
  window.addEventListener('directus-config-updated', restartSyncFromCurrentConfig);
  await restartSyncFromCurrentConfig();
});

onUnmounted(() => {
  window.removeEventListener('storage', onStorageChange);
  window.removeEventListener('directus-config-updated', restartSyncFromCurrentConfig);
  sync.stopSync();
});
</script>
