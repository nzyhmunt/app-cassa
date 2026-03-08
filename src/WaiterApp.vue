<template>
  <div id="app" class="h-full flex flex-col relative w-full" :style="store.cssVars">
    <WaiterNavbar />
    <router-view />
  </div>
</template>

<script setup>
import { onMounted } from 'vue';
import WaiterNavbar from './components/WaiterNavbar.vue';
import { useAppStore } from './store/index.js';

const store = useAppStore();

// Reload the menu on app start so the waiter has the latest catalogue.
// Future: replace store.loadMenu() with GET /api/menu
onMounted(() => {
  if (store.menuError) store.loadMenu();
});
</script>
