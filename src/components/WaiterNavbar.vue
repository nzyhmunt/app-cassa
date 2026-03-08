<template>
  <header class="theme-bg text-white p-2 md:p-4 shadow-md z-40 flex justify-between items-center shrink-0 h-16 md:h-20">

    <!-- Brand -->
    <div class="flex items-center gap-2 md:gap-3 flex-1 min-w-0">
      <div class="bg-white p-2 rounded-full shadow-sm hidden sm:flex items-center justify-center shrink-0">
        <UtensilsCrossed class="size-5 md:size-6 theme-text" />
      </div>
      <div class="flex flex-col truncate">
        <h1 class="text-sm md:text-xl font-bold leading-none truncate">{{ store.config.ui.name }}</h1>
        <p class="text-white/80 text-[9px] md:text-xs mt-0.5 font-bold uppercase tracking-wider truncate">App Cameriere</p>
      </div>
    </div>

    <!-- Navigation tabs -->
    <div class="flex bg-black/20 p-1 rounded-xl w-[200px] sm:w-[220px] md:w-auto max-w-[300px] shadow-inner shrink-0 relative z-50">
      <router-link
        to="/sala"
        aria-label="Sala"
        class="flex-1 py-1.5 md:py-2 px-2 md:px-6 rounded-lg font-bold text-xs md:text-sm flex items-center justify-center gap-1.5 transition-all"
        :class="isSalaActive ? 'bg-white theme-text shadow-sm' : 'text-white/90 hover:bg-white/10'"
      >
        <LayoutGrid class="size-4 md:size-5" />
        <span class="hidden sm:inline">Sala</span>
      </router-link>
      <router-link
        to="/comande"
        aria-label="Comande"
        class="flex-1 py-1.5 md:py-2 px-2 md:px-6 rounded-lg font-bold text-xs md:text-sm flex items-center justify-center gap-1.5 transition-all"
        :class="isComandeActive ? 'bg-white theme-text shadow-sm' : 'text-white/90 hover:bg-white/10'"
      >
        <div class="relative shrink-0">
          <ClipboardList class="size-4 md:size-5" />
          <span
            v-if="store.pendingCount > 0 && !isComandeActive"
            class="absolute -top-1.5 -right-2 bg-red-500 text-white text-[9px] font-black size-4 flex items-center justify-center rounded-full border border-white"
          >{{ store.pendingCount }}</span>
        </div>
        <span class="hidden sm:inline">Comande</span>
      </router-link>
    </div>

    <!-- Right: clock -->
    <div class="flex items-center justify-end flex-1 min-w-0">
      <div class="text-right hidden lg:block">
        <p class="text-sm font-bold truncate">{{ currentTime }}</p>
        <p class="text-[10px] text-white/80 uppercase truncate">Turno Attivo</p>
      </div>
    </div>

  </header>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { UtensilsCrossed, LayoutGrid, ClipboardList } from 'lucide-vue-next';
import { useAppStore } from '../store/index.js';

const store = useAppStore();
const route = useRoute();
const currentTime = ref(new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }));

const isSalaActive = computed(() => route.name === 'sala');
const isComandeActive = computed(() => route.name === 'comande');

let clockTimer = null;
onMounted(() => {
  clockTimer = setInterval(() => {
    currentTime.value = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }, 1000);
});
onUnmounted(() => {
  if (clockTimer !== null) clearInterval(clockTimer);
});
</script>
