<template>
  <div class="h-full flex flex-col relative w-full" :style="store.cssVars">
    <SalaNavbar @open-settings="showSettings = true" />
    <router-view />
    <SalaSettingsModal v-model="showSettings" />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import SalaNavbar from './components/SalaNavbar.vue';
import SalaSettingsModal from './components/SalaSettingsModal.vue';
import { useAppStore } from './store/index.js';
import { useWakeLock } from './composables/useWakeLock.js';

const store = useAppStore();
const showSettings = ref(false);

useWakeLock();

// On app mount, retry loading the menu if a previous load failed (store.menuError).
// Future: replace store.loadMenu() with GET /api/menu if needed.
onMounted(() => {
  if (store.menuError) store.loadMenu();
});
</script>
