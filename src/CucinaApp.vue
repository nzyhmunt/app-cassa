<template>
  <div id="app" class="h-full flex flex-col relative w-full" :style="store.cssVars">
    <router-view @open-settings="showSettings = true" />
    <CucinaSettingsModal v-model="showSettings" />
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useAppStore } from './store/index.js';
import { useWakeLock } from './composables/useWakeLock.js';
import CucinaSettingsModal from './components/CucinaSettingsModal.vue';

const store = useAppStore();
const showSettings = ref(false);

useWakeLock();
</script>
