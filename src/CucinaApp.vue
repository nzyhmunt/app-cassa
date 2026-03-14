<template>
  <div id="app" class="h-full flex flex-col relative w-full" :style="store.cssVars">
    <router-view @open-settings="showSettings = true" />
    <CucinaSettingsModal v-model="showSettings" />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useAppStore } from './store/index.js';
import { useWakeLock } from './composables/useWakeLock.js';
import { resolveStorageKeys, getInstanceName } from './store/persistence.js';
import CucinaSettingsModal from './components/CucinaSettingsModal.vue';

const store = useAppStore();
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
