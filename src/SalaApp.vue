<template>
  <div
    class="h-full flex flex-col relative w-full"
    :style="store.cssVars"
    @click="auth.recordActivity()"
    @keydown="auth.recordActivity()"
    @touchstart.passive="auth.recordActivity()"
  >
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
import { useAppStore } from './store/index.js';
import { useWakeLock } from './composables/useWakeLock.js';
import { resolveStorageKeys, getInstanceName } from './store/persistence.js';
import { useAuth } from './composables/useAuth.js';
import { useDirectusSync } from './composables/useDirectusSync.js';
import { loadDirectusConfigFromStorage } from './composables/useDirectusClient.js';

const store = useAppStore();
const auth = useAuth();
const sync = useDirectusSync();
const showSettings = ref(false);

useWakeLock();

// Best-effort preload; full sync startup awaits config in restartSyncFromCurrentConfig().
loadDirectusConfigFromStorage().catch((e) => {
  console.warn('[SalaApp] Failed to load Directus config from IDB:', e);
});

const { storageKey } = resolveStorageKeys(getInstanceName());

function onStorageChange(event) {
  if (event.key !== storageKey) return;
  store.$hydrate?.();
}

async function restartSyncFromCurrentConfig() {
  try {
    await loadDirectusConfigFromStorage();
  } catch (e) { console.warn('[SalaApp] Failed to load Directus config from IDB:', e); }
  sync.stopSync();
  await sync.startSync({ appType: 'sala', store });
}

onMounted(async () => {
  if (store.menuError) store.loadMenu();
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
