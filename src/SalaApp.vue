<template>
  <div
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
    <SalaNavbar @open-settings="showSettings = true" @lock="auth.lock()" />
    <router-view />
    <DirectusSyncStatusBar />
    <SalaSettingsModal v-model="showSettings" />
    <PwaInstallBanner />
    <LockScreen />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import SalaNavbar from './components/SalaNavbar.vue';
import SalaSettingsModal from './components/SalaSettingsModal.vue';
import PwaInstallBanner from './components/shared/PwaInstallBanner.vue';
import LockScreen from './components/LockScreen.vue';
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
import { useIDBPurge, _isDirectusSyncActive } from './composables/useIDBPurge.js';

const configStore = useConfigStore();
const orderStore = useOrderStore();
const auth = useAuth();
const sync = useDirectusSync();
const showSettings = ref(false);
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
  logPrefix: 'SalaApp',
});

useWakeLock();

// Best-effort preload; full sync startup awaits config in restartSyncFromCurrentConfig().
loadDirectusConfigFromStorage().catch((e) => {
  console.warn('[SalaApp] Failed to load Directus config from IDB:', e);
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
    console.warn('[SalaApp] Failed to hydrate state from storage event:', error);
  }
}

async function restartSyncFromCurrentConfig() {
  try {
    await loadDirectusConfigFromStorage();
  } catch (e) { console.warn('[SalaApp] Failed to load Directus config from IDB:', e); }
  sync.stopSync();
  await sync.startSync({ appType: 'sala', store: syncStore });
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
  if (configStore.menuError) configStore.loadMenu();
  window.addEventListener('storage', onStorageChange);
  window.addEventListener('directus-config-updated', restartSyncFromCurrentConfig);
  await restartSyncFromCurrentConfig();
  // Best-effort post-startup IDB purge.  Guard: only when Directus sync is
  // active so all data has a chance to reach the server first.
  if (_isDirectusSyncActive()) {
    runIDBPurge().catch((e) => {
      console.warn('[SalaApp] IDB purge error (non-fatal):', e);
    });
  }
});

onUnmounted(() => {
  window.removeEventListener('storage', onStorageChange);
  window.removeEventListener('directus-config-updated', restartSyncFromCurrentConfig);
  sync.stopSync();
});
</script>
