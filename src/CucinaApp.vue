<template>
  <div class="h-full flex flex-col relative w-full" style="background:#1c1917;color:#f5f5f4;">
    <router-view />
  </div>
</template>

<script setup>
import { useAppStore } from './store/index.js';

const store = useAppStore();
</script>
