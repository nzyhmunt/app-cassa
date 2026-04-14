<template>
  <div
    id="app"
    class="h-full flex flex-col relative w-full"
    :style="store.cssVars"
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
const showCassa = ref(false);

useWakeLock();

// Load Directus config synchronously before first render so that reactive
// consumers (DirectusSyncStatusBar, etc.) see the correct initial value.
loadDirectusConfigFromStorage();

const { storageKey } = resolveStorageKeys(getInstanceName());

function onStorageChange(event) {
  if (event.key !== storageKey) return;
  store.$hydrate?.();
}

function restartSyncFromCurrentConfig() {
  loadDirectusConfigFromStorage();
  sync.stopSync();
  sync.startSync({ appType: 'cassa', store });
}

onMounted(() => {
  window.addEventListener('storage', onStorageChange);
  window.addEventListener('directus-config-updated', restartSyncFromCurrentConfig);
  restartSyncFromCurrentConfig();
});

onUnmounted(() => {
  window.removeEventListener('storage', onStorageChange);
  window.removeEventListener('directus-config-updated', restartSyncFromCurrentConfig);
  sync.stopSync();
});
</script>
