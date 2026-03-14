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
    <CassaSettingsModal v-model="showSettings" />
    <CassaDashboard v-model="showCassa" />
    <PwaInstallBanner />
    <LockScreen />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import CassaNavbar from './components/CassaNavbar.vue';
import CassaSettingsModal from './components/CassaSettingsModal.vue';
import CassaDashboard from './components/CassaDashboard.vue';
import PwaInstallBanner from './components/shared/PwaInstallBanner.vue';
import LockScreen from './components/LockScreen.vue';
import { useAppStore } from './store/index.js';
import { useWakeLock } from './composables/useWakeLock.js';
import { resolveStorageKeys, getInstanceName } from './store/persistence.js';
import { useAuth } from './composables/useAuth.js';

const store = useAppStore();
const auth = useAuth();
const showSettings = ref(false);
const showCassa = ref(false);

useWakeLock();

const { storageKey } = resolveStorageKeys(getInstanceName());

function onStorageChange(event) {
  if (event.key !== storageKey) return;
  store.$hydrate?.();
}

onMounted(() => {
  window.addEventListener('storage', onStorageChange);
});

onUnmounted(() => {
  window.removeEventListener('storage', onStorageChange);
});
</script>
