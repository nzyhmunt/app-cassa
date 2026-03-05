<template>
  <div id="app" class="h-full flex flex-col relative w-full" :style="store.cssVars">
    <Navbar @open-settings="showSettings = true" />
    <router-view />
    <SettingsModal v-model="showSettings" />
  </div>
</template>

<script setup>
import { ref } from 'vue';
import Navbar from './components/Navbar.vue';
import SettingsModal from './components/SettingsModal.vue';
import { useAppStore } from './store/index.js';

const store = useAppStore();
const showSettings = ref(false);
</script>
