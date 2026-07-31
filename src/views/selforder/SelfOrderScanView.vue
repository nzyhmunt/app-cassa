<template>
  <div class="absolute inset-0 z-50 bg-white flex flex-col items-center justify-center p-6 text-center overflow-y-auto">
    <!-- Logo -->
    <img 
      v-if="restaurantLogo" 
      :src="restaurantLogo" 
      alt="Logo" 
      class="size-32 mb-6 rounded-3xl shadow-lg object-cover border-4 theme-border p-1"
    />
    <div v-else class="w-32 h-32 mb-6 rounded-3xl shadow-lg bg-emerald-100 flex items-center justify-center">
      <UtensilsCrossed class="size-16 text-emerald-600" />
    </div>

    <!-- Restaurant name -->
    <h1 class="text-3xl md:text-5xl font-bold mb-2 text-gray-900">{{ restaurantName }}</h1>
    <p class="text-gray-500 mb-8 max-w-md">{{ restaurantSubtitle }}</p>

    <!-- Table number input -->
    <div class="bg-gray-50 p-6 md:p-8 rounded-3xl shadow-sm border border-gray-100 w-full max-w-sm">
      <label class="block text-sm font-bold text-gray-700 mb-3 uppercase tracking-wide flex items-center justify-center gap-2">
        <MapPin class="size-4 theme-text" />
        {{ t.inserisciTavolo }}
      </label>
      <div class="relative mb-6">
        <input 
          v-model="tableNumber" 
          type="number" 
          min="1" 
          class="w-full px-4 py-4 bg-white border border-gray-300 rounded-2xl text-2xl font-black text-center focus:outline-none ring-2 ring-emerald-200 transition-all shadow-inner" 
          placeholder="##" 
          @keyup.enter="handleStart"
        />
      </div>
      <button 
        @click="handleStart" 
        :disabled="!tableNumber || menuEmpty"
        class="w-full theme-bg hover:theme-bg-dark text-white py-4 rounded-2xl font-bold text-lg shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-[0.98]"
      >
        {{ t.iniziaOrdine }} <ArrowRight class="size-5" />
      </button>
    </div>

    <!-- Language selector -->
    <div class="mt-8 relative inline-block text-left">
      <button 
        @click.stop="langMenuOpen = !langMenuOpen" 
        class="flex items-center gap-2 bg-gray-100 rounded-full px-5 py-3 border border-gray-200 shadow-sm transition-all hover:bg-gray-200 cursor-pointer font-bold text-gray-700 text-lg"
      >
        <span class="text-2xl leading-none">{{ currentLanguageObj.flag }}</span> 
        {{ currentLanguageObj.name }}
        <ChevronDown class="size-5 text-gray-500 ml-1" />
      </button>
      <div v-if="langMenuOpen" @click="langMenuOpen = false" class="fixed inset-0 z-40"></div>
      <div 
        v-if="langMenuOpen" 
        class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-white rounded-2xl shadow-xl border border-gray-100 py-2 z-50 w-48 overflow-hidden transform origin-bottom transition-all"
      >
        <button 
          v-for="lang in languages" 
          :key="lang.code" 
          @click="setLang(lang.code); langMenuOpen = false" 
          class="w-full px-5 py-3 text-left hover:bg-gray-50 flex items-center gap-3 transition-colors text-gray-800"
        >
          <span class="text-2xl leading-none">{{ lang.flag }}</span> 
          <span class="font-bold">{{ lang.name }}</span>
        </button>
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="fixed inset-0 bg-white/80 flex items-center justify-center z-40">
      <div class="text-center">
        <Loader2 class="w-12 h-12 text-emerald-600 animate-spin mx-auto mb-4" />
        <p class="text-gray-600">{{ t.connessione }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, inject } from 'vue';
import { useRouter } from 'vue-router';
import { MapPin, ArrowRight, ChevronDown, UtensilsCrossed, Loader2 } from 'lucide-vue-next';
import { useConfigStore } from '../../store/index.js';

const router = useRouter();
const configStore = useConfigStore();
const { initSession } = inject('selfOrderSession', { initSession: () => Promise.resolve() });

const tableNumber = ref('');
const loading = ref(false);
const langMenuOpen = ref(false);
const currentLang = ref('it');

const languages = [
  { code: 'it', flag: '🇮🇹', name: 'Italiano' },
  { code: 'en', flag: '🇬🇧', name: 'English' }
];

const i18n = {
  it: {
    inserisciTavolo: 'Indica il tuo tavolo',
    iniziaOrdine: 'Visualizza Menu',
    connessione: 'Connessione in corso...',
  },
  en: {
    inserisciTavolo: 'Enter your table',
    iniziaOrdine: 'View Menu',
    connessione: 'Connecting...',
  }
};

const t = computed(() => i18n[currentLang.value] || i18n.it);
const currentLanguageObj = computed(() => languages.find(l => l.code === currentLang.value) || languages[0]);

const restaurantName = computed(() => configStore.config?.ui?.name || 'Ristorante');
const restaurantSubtitle = computed(() => configStore.config?.ui?.subtitle || 'Ordina dal tuo tavolo');
const restaurantLogo = computed(() => configStore.config?.ui?.logoUrl || null);
const menuEmpty = computed(() => !configStore.menu || Object.keys(configStore.menu).length === 0);

function setLang(code) {
  currentLang.value = code;
  localStorage.setItem('selforder_lang', code);
}

function handleStart() {
  if (!tableNumber.value) return;
  
  localStorage.setItem('selforder_table', tableNumber.value);
  
  // Check if first time (show onboarding)
  const hasSeenOnboarding = localStorage.getItem('selforder_onboarding_done');
  if (!hasSeenOnboarding) {
    router.push('/onboarding');
  } else {
    router.push('/menu');
  }
}
</script>
