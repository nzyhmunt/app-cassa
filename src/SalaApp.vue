<template>
  <div class="h-full flex flex-col relative w-full" :style="store.cssVars">
    <SalaNavbar />
    <router-view />
  </div>
</template>

<script setup>
import { onMounted } from 'vue';
import SalaNavbar from './components/SalaNavbar.vue';
import { useAppStore } from './store/index.js';

const store = useAppStore();

// On app mount, retry loading the menu if a previous load failed (store.menuError).
// Future: replace store.loadMenu() with GET /api/menu if needed.
onMounted(() => {
  if (store.menuError) store.loadMenu();
});
</script>
