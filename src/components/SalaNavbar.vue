<template>
  <header class="theme-bg text-white p-2 md:p-4 shadow-md z-40 flex justify-between items-center shrink-0 h-16 md:h-20">

    <!-- Brand -->
    <div class="flex items-center gap-2 md:gap-3 flex-1 min-w-0">
      <div class="bg-white p-2 rounded-full shadow-sm hidden sm:flex items-center justify-center shrink-0">
        <UtensilsCrossed class="size-5 md:size-6 theme-text" />
      </div>
      <div class="flex flex-col truncate">
        <h1 class="text-sm md:text-xl font-bold leading-none truncate">{{ store.config.ui.name }}</h1>
        <p class="text-white/80 text-[9px] md:text-xs mt-0.5 font-bold uppercase tracking-wider truncate">App Sala</p>
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

    <!-- Right: clock + settings -->
    <div class="flex items-center justify-end gap-3 flex-1 min-w-0">
      <div class="text-right hidden lg:block">
        <p class="text-sm font-bold truncate">{{ currentTime }}</p>
        <p class="text-[10px] text-white/80 uppercase truncate">Turno Attivo</p>
      </div>
      <!-- Tasto Settings -->
      <button @click="$emit('open-settings')" aria-label="Apri impostazioni" class="relative z-50 bg-black/20 hover:bg-black/30 px-2.5 md:px-3 py-2 md:py-2.5 rounded-xl transition-colors shadow-inner text-white flex items-center justify-center gap-1.5 cursor-pointer active:scale-95">
        <Settings class="size-5 md:size-5 shrink-0" />
        <span class="hidden lg:inline text-xs font-bold">Config</span>
      </button>
    </div>

  </header>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { UtensilsCrossed, LayoutGrid, ClipboardList, Settings } from 'lucide-vue-next';
import { useAppStore } from '../store/index.js';
import { useBeep } from '../composables/useBeep.js';

defineEmits(['open-settings']);

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

// ── Avviso audio per nuovi ordini in arrivo ────────────────────────────────
const { playBeep } = useBeep();

// Suona quando arriva un nuovo ordine in pending (pendingCount cresce)
watch(
  () => store.pendingCount,
  (newVal, oldVal) => {
    if (newVal > oldVal) {
      playBeep();
    }
  },
);
</script>
