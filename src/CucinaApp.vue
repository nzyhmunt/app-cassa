<template>
  <div
    id="app"
    class="h-full flex flex-col relative w-full"
    :style="configStore.cssVars"
    @click="auth.recordActivity()"
    @keydown="auth.recordActivity()"
    @touchstart.passive="onRootTouchStart"
    @touchend.passive="onRootTouchEnd"
  >
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
import { useDirectusSync } from './composables/useDirectusSync.js';
import { loadDirectusConfigFromStorage } from './composables/useDirectusClient.js';
import { useSyncStoreProxy } from './composables/useSyncStoreProxy.js';
import { useAppSwipeRefresh } from './composables/useAppSwipeRefresh.js';

const configStore = useConfigStore();
const orderStore = useOrderStore();
const auth = useAuth();
const sync = useDirectusSync();
const showSettings = ref(false);
const syncStore = useSyncStoreProxy(configStore, orderStore);
const swipeRefresh = useAppSwipeRefresh({
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
  swipeRefresh.onTouchStart(event);
}

function onRootTouchEnd(event) {
  swipeRefresh.onTouchEnd(event);
}

onMounted(async () => {
  window.addEventListener('storage', onStorageChange);
  window.addEventListener('directus-config-updated', onDirectusConfigUpdated);
  await restartSync();
});

onUnmounted(() => {
  window.removeEventListener('storage', onStorageChange);
  window.removeEventListener('directus-config-updated', onDirectusConfigUpdated);
  sync.stopSync();
});
</script>
