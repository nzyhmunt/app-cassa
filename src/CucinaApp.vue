<template>
  <div
    id="app"
    class="h-full flex flex-col relative w-full"
    :style="configStore.cssVars"
    @click="auth.recordActivity()"
    @keydown="auth.recordActivity()"
    @touchstart.passive="auth.recordActivity()"
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

const configStore = useConfigStore();
const orderStore = useOrderStore();
const auth = useAuth();
const sync = useDirectusSync();
const showSettings = ref(false);
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
  await Promise.all([
    configStore.hydrateConfigFromIDB(),
    orderStore.refreshOperationalStateFromIDB(),
  ]);
  if (configStore.menuSource === 'json') {
    await configStore.loadMenu({ skipHydrate: true });
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
