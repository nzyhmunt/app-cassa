<template>
  <header class="theme-bg text-white p-4 shadow-md z-20 flex justify-between items-center shrink-0">
    <!-- Left: Logo + Restaurant name -->
    <div class="flex items-center gap-3">
      <div v-if="logoUrl" class="shrink-0">
        <img :src="logoUrl" alt="Logo" class="size-10 rounded-full bg-white p-0.5 object-cover">
      </div>
      <div class="flex flex-col">
        <h1 class="text-lg font-bold leading-none">{{ restaurantName }}</h1>
        <p class="text-white/80 text-xs mt-1 uppercase tracking-tight">{{ t.tavolo }} {{ tableNumber }}</p>
      </div>
    </div>

    <!-- Right: Actions -->
    <div class="flex items-center gap-2">
      <!-- Language selector -->
      <div class="relative">
        <button 
          @click.stop="langMenuOpen = !langMenuOpen" 
          class="flex items-center gap-1.5 bg-black/10 hover:bg-black/20 border border-white/30 rounded-full px-3 py-1.5 transition-colors text-sm font-bold shadow-sm"
        >
          <span class="text-base leading-none">{{ currentLangFlag }}</span>
          <ChevronDown class="size-3 text-white ml-0.5 opacity-80" />
        </button>
        
        <div v-if="langMenuOpen" @click="langMenuOpen = false" class="fixed inset-0 z-40"></div>
        <div v-if="langMenuOpen" class="absolute top-full right-0 mt-2 bg-white rounded-2xl shadow-xl border border-gray-100 py-1.5 z-50 min-w-[140px] overflow-hidden">
          <button 
            v-for="lang in languages" 
            :key="lang.code" 
            @click="setLang(lang.code); langMenuOpen = false" 
            class="w-full px-4 py-2.5 text-left hover:bg-gray-50 flex items-center gap-2.5 transition-colors text-gray-800"
          >
            <span class="text-lg leading-none">{{ lang.flag }}</span>
            <span class="font-bold text-sm">{{ lang.name }}</span>
          </button>
        </div>
      </div>

      <!-- Food preferences button with indicator -->
      <button 
        @click="$emit('preferences')" 
        class="flex items-center gap-2 bg-black/10 hover:bg-black/20 px-3 py-1.5 rounded-full text-sm font-bold transition-colors border border-white/30 shadow-sm relative"
      >
        <HeartPulse class="size-4 text-white" />
        <span v-if="hasActivePreferences" class="absolute -top-1 -right-1 flex size-3 bg-yellow-400 rounded-full border border-white shadow-sm"></span>
      </button>

      <!-- Cart button -->
      <button 
        @click="$emit('show-cart')" 
        class="relative bg-black/10 hover:bg-black/20 border border-white/30 rounded-full p-2 transition-colors shadow-sm"
      >
        <ShoppingCart class="w-5 h-5" />
        <span 
          v-if="cartCount > 0"
          class="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-bold"
        >
          {{ cartCount > 9 ? '9+' : cartCount }}
        </span>
      </button>

      <!-- Share button -->
      <button 
        @click="$emit('share')" 
        class="bg-black/10 hover:bg-black/20 border border-white/30 rounded-full p-2 transition-colors shadow-sm"
      >
        <Share2 class="w-5 h-5" />
      </button>
    </div>
  </header>
</template>

<script setup>
import { computed, ref } from 'vue';
import { ShoppingCart, Share2, ChevronDown, HeartPulse } from 'lucide-vue-next';
import { useSelfOrderCart } from '../../composables/useSelfOrderCart.js';
import { useConfigStore } from '../../store/index.js';

const props = defineProps({
  session: { type: Object, default: null }
});

defineEmits(['back', 'show-cart', 'share', 'preferences']);

const { items } = useSelfOrderCart();
const configStore = useConfigStore();
const cartCount = computed(() => items.value.reduce((sum, item) => sum + item.quantity, 0));
const langMenuOpen = ref(false);

const languages = [
  { code: 'it', name: 'Italiano', flag: '🇮🇹' },
  { code: 'en', name: 'English', flag: '🇬🇧' }
];

const currentLang = ref(localStorage.getItem('selforder_lang') || 'it');
const currentLangFlag = computed(() => {
  const lang = languages.find(l => l.code === currentLang.value);
  return lang?.flag || '🇮🇹';
});

const setLang = (code) => {
  currentLang.value = code;
  localStorage.setItem('selforder_lang', code);
};

const logoUrl = computed(() => {
  return configStore.config?.ui?.logoUrl || null;
});

const restaurantName = computed(() => {
  return configStore.config?.ui?.restaurantName || configStore.config?.restaurant?.name || 'Self Order';
});

const tableNumber = computed(() => {
  if (props.session?.table) return props.session.table;
  return localStorage.getItem('selforder_table') || '?';
});

const hasActivePreferences = computed(() => {
  try {
    const prefs = localStorage.getItem('selforder_preferences');
    if (!prefs) return false;
    const data = JSON.parse(prefs);
    const hasDiet = Object.values(data.diet || {}).some(v => v);
    const hasAllergens = Object.values(data.allergens || {}).some(v => v);
    return hasDiet || hasAllergens;
  } catch {
    return false;
  }
});

const i18n = {
  it: { tavolo: 'Tavolo' },
  en: { tavolo: 'Table' }
};
const t = computed(() => i18n[currentLang.value] || i18n.it);
</script>
