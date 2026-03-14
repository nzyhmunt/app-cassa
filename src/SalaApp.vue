<template>
  <div class="h-full flex flex-col relative w-full" :style="store.cssVars">
    <SalaNavbar @open-settings="showSettings = true" />
    <router-view />
    <SalaSettingsModal v-model="showSettings" />
    <PwaInstallBanner />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import SalaNavbar from './components/SalaNavbar.vue';
import SalaSettingsModal from './components/SalaSettingsModal.vue';
import PwaInstallBanner from './components/shared/PwaInstallBanner.vue';
import { useAppStore } from './store/index.js';
import { useWakeLock } from './composables/useWakeLock.js';
import { resolveStorageKeys, getInstanceName } from './store/persistence.js';

const store = useAppStore();
const showSettings = ref(false);

useWakeLock();

const { storageKey } = resolveStorageKeys(getInstanceName());

function onStorageChange(event) {
  if (event.key !== storageKey) return;
  store.$hydrate?.();
}

onMounted(() => {
  if (store.menuError) store.loadMenu();
  window.addEventListener('storage', onStorageChange);
});

onUnmounted(() => {
  window.removeEventListener('storage', onStorageChange);
});
</script>
