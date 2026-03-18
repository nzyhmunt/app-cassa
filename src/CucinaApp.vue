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
import PwaInstallBanner from './components/shared/PwaInstallBanner.vue';

const store = useAppStore();
const auth = useAuth();
const showSettings = ref(false);

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
