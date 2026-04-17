<template>
  <div
    id="app"
    class="h-full flex flex-col relative w-full"
    :style="configStore.cssVars"
    @click="auth.recordActivity()"
    @keydown="auth.recordActivity()"
    @touchstart.passive="auth.recordActivity()"
  >
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
import { useConfigStore, useOrderStore } from './store/index.js';
import { useWakeLock } from './composables/useWakeLock.js';
import { resolveStorageKeys, getInstanceName } from './store/persistence.js';
import { useAuth } from './composables/useAuth.js';
import { useDirectusSync } from './composables/useDirectusSync.js';
import { loadDirectusConfigFromStorage } from './composables/useDirectusClient.js';

const configStore = useConfigStore();
const orderStore = useOrderStore();
const auth = useAuth();
const sync = useDirectusSync();
const showSettings = ref(false);
const showCassa = ref(false);
const syncStore = new Proxy({}, {
  get(_target, prop) {
    if (prop in orderStore) return orderStore[prop];
    return configStore[prop];
  },
  set(_target, prop, value) {
    if (prop in orderStore) {
      orderStore[prop] = value;
      return true;
    }
    configStore[prop] = value;
    return true;
  },
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
  await Promise.all([
    configStore.hydrateConfigFromIDB(),
    orderStore.refreshOperationalStateFromIDB(),
  ]);
  if (configStore.menuSource === 'json') {
    await configStore.loadMenu({ skipHydrate: true });
  }
}

async function restartSyncFromCurrentConfig() {
  try {
    await loadDirectusConfigFromStorage();
  } catch (e) { console.warn('[CassaApp] Failed to load Directus config from IDB:', e); }
  sync.stopSync();
  await sync.startSync({ appType: 'cassa', store: syncStore });
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
