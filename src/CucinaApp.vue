<template>
  <div id="app" class="h-full flex flex-col relative w-full" :style="store.cssVars">
    <router-view />
  </div>
</template>

<script setup>
import { useAppStore } from './store/index.js';

const store = useAppStore();
</script>
