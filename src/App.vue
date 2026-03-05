<template>
  <div id="app" class="h-full flex flex-col relative w-full" :style="store.cssVars">
    <Navbar @open-settings="showSettings = true" @open-cassa="showCassa = true" />
    <router-view />
    <SettingsModal v-model="showSettings" />
    <CassaDashboard v-model="showCassa" />
  </div>
</template>

<script setup>
import { ref } from 'vue';
import Navbar from './components/Navbar.vue';
import SettingsModal from './components/SettingsModal.vue';
import CassaDashboard from './components/CassaDashboard.vue';
import { useAppStore } from './store/index.js';

const store = useAppStore();
const showSettings = ref(false);
const showCassa = ref(false);
</script>
