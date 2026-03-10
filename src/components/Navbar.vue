<template>
  <header class="theme-bg text-white p-2 md:p-4 shadow-md z-40 flex justify-between items-center shrink-0 h-16 md:h-20">

    <!-- Brand Info -->
    <div class="flex items-center gap-2 md:gap-3 flex-1 min-w-0">
      <div class="bg-white p-2 rounded-full shadow-sm text-gray-900 hidden sm:flex items-center justify-center shrink-0">
        <Monitor class="size-5 md:size-6 theme-text" />
      </div>
      <div class="flex flex-col truncate">
        <h1 class="text-sm md:text-xl font-bold leading-none truncate">{{ store.config.ui.name }}</h1>
        <p class="text-white/80 text-[9px] md:text-xs mt-0.5 font-bold uppercase tracking-wider truncate">POS Cassa &amp; Ordini</p>
      </div>
    </div>

    <!-- Selettore Navigazione Principale -->
    <div class="flex bg-black/20 p-1 rounded-xl w-[200px] sm:w-[220px] md:w-auto max-w-[300px] shadow-inner shrink-0 relative z-50">
      <router-link
        to="/ordini"
        aria-label="Ordini"
        class="flex-1 py-1.5 md:py-2 px-2 md:px-6 rounded-lg font-bold text-xs md:text-sm flex items-center justify-center gap-1.5 transition-all"
        :class="isOrdersActive ? 'bg-white theme-text shadow-sm' : 'text-white/90 hover:bg-white/10'"
      >
        <div class="relative shrink-0">
          <Receipt class="size-4 md:size-5" />
          <span v-if="store.pendingCount > 0 && !isOrdersActive" class="absolute -top-1.5 -right-2 bg-red-500 text-white text-[9px] font-black size-4 flex items-center justify-center rounded-full border border-white">{{ store.pendingCount }}</span>
        </div>
        <span class="hidden sm:inline">Ordini</span>
      </router-link>
      <router-link
        to="/sala"
        class="flex-1 py-1.5 md:py-2 px-2 md:px-6 rounded-lg font-bold text-xs md:text-sm flex items-center justify-center gap-1.5 transition-all"
        :class="isRoomActive ? 'bg-white theme-text shadow-sm' : 'text-white/90 hover:bg-white/10'"
      >
        <LayoutGrid class="size-4 md:size-5" /> <span class="hidden sm:inline">Sala/Cassa</span>
      </router-link>
    </div>

    <!-- Strumenti a Destra -->
    <div class="flex items-center justify-end gap-3 flex-1 min-w-0">
      <div class="text-right hidden lg:block">
        <p class="text-sm font-bold truncate">{{ currentTime }}</p>
        <p class="text-[10px] text-white/80 uppercase truncate">Turno Attivo</p>
      </div>
      <!-- Test Audio rapido -->
      <button @click="onSimulateOrder" class="hidden md:flex bg-white/10 hover:bg-white/20 p-2 md:p-2.5 rounded-full transition-colors text-white" title="Simula Ordine da App">
        <BellPlus class="size-5 md:size-5" />
      </button>
      <!-- Tasto Cassa Dashboard -->
      <button @click="$emit('open-cassa')" aria-label="Cruscotto Cassa" class="bg-white/10 hover:bg-white/20 px-2.5 md:px-3 py-2 md:py-2.5 rounded-xl transition-colors text-white flex items-center justify-center gap-1.5">
        <Landmark class="size-5 md:size-5 shrink-0" />
        <span class="hidden lg:inline text-xs font-bold">Cassa</span>
      </button>
      <!-- Tasto Settings COG -->
      <button @click="$emit('open-settings')" aria-label="Apri impostazioni" class="relative z-50 bg-black/20 hover:bg-black/30 px-2.5 md:px-3 py-2 md:py-2.5 rounded-xl transition-colors shadow-inner text-white flex items-center justify-center gap-1.5 cursor-pointer active:scale-95">
        <Settings class="size-5 md:size-5 shrink-0" />
        <span class="hidden lg:inline text-xs font-bold">Config</span>
      </button>
    </div>
  </header>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import { Monitor, Receipt, LayoutGrid, BellPlus, Settings, Landmark } from 'lucide-vue-next';
import { useAppStore } from '../store/index.js';

const emit = defineEmits(['open-settings', 'open-cassa']);

const store = useAppStore();
const route = useRoute();
const currentTime = ref(new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }));

const isOrdersActive = computed(() => route.name === 'ordini');
const isRoomActive = computed(() => route.name === 'sala' || route.name === 'storico-conti');

let clockTimer = null;
onMounted(() => {
  clockTimer = setInterval(() => {
    currentTime.value = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }, 1000);
});

onUnmounted(() => {
  if (clockTimer !== null) clearInterval(clockTimer);
});

function onSimulateOrder() {
  store.simulateNewOrder();
  playBeep();
}

const SETTINGS_STORAGE_KEY = 'app-settings';
function isSoundsEnabled() {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return true;
    const parsed = JSON.parse(raw);
    return typeof parsed.sounds === 'boolean' ? parsed.sounds : true;
  } catch {
    return true;
  }
}

function playBeep() {
  if (!store.config || !isSoundsEnabled()) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.2);
    osc.stop(ctx.currentTime + 0.2);
    // Close the context once the sound has finished to free audio resources
    setTimeout(() => ctx.close(), 500);
  } catch (e) {
    console.warn('[Navbar] Failed to play beep:', e);
  }
}
</script>
