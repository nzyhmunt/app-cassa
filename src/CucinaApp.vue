<template>
  <div
    id="app"
    class="h-full flex flex-col relative w-full"
    :style="store.cssVars"
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
import { useAppStore } from './store/index.js';
import { useWakeLock } from './composables/useWakeLock.js';
import { resolveStorageKeys, getInstanceName } from './store/persistence.js';
import { useAuth } from './composables/useAuth.js';
import CucinaSettingsModal from './components/CucinaSettingsModal.vue';
import PwaInstallBanner from './components/shared/PwaInstallBanner.vue';
import LockScreen from './components/LockScreen.vue';
import { useDirectusSync } from './composables/useDirectusSync.js';
import { loadDirectusConfigFromStorage } from './composables/useDirectusClient.js';

const store = useAppStore();
const auth = useAuth();
const sync = useDirectusSync();
const showSettings = ref(false);

useWakeLock();

// Best-effort preload; full sync startup awaits config in restartSync().
loadDirectusConfigFromStorage().catch((e) => {
  console.warn('[CucinaApp] Failed to load Directus config from IDB:', e);
});

const { storageKey } = resolveStorageKeys(getInstanceName());

function onStorageChange(event) {
  if (event.key !== storageKey) return;
  store.$hydrate?.();
}

async function restartSync() {
  try {
    await loadDirectusConfigFromStorage();
  } catch (e) { console.warn('[CucinaApp] Failed to load Directus config from IDB:', e); }
  sync.stopSync();
  await sync.startSync({ appType: 'cucina', store });
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
