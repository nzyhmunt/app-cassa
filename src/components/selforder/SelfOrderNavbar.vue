<template>
  <div class="bg-emerald-600 text-white px-4 py-3 flex items-center justify-between">
    <div class="flex items-center gap-3">
      <button 
        v-if="showBackButton"
        class="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center"
        @click="$emit('back')"
      >
        <ArrowLeft class="w-5 h-5" />
      </button>
      <div>
        <p class="font-bold text-sm">{{ restaurantName }}</p>
        <p class="text-xs text-emerald-100">{{ sessionName || 'Self Order' }}</p>
      </div>
    </div>
    
    <div class="flex items-center gap-1">
      <!-- Preferences button -->
      <button 
        class="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center"
        @click="$emit('preferences')"
        :title="t.preferenze"
      >
        <UtensilsCrossed class="w-5 h-5" />
      </button>
      
      <!-- Share button -->
      <button 
        class="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center"
        @click="$emit('share')"
        :title="t.condividiTavolo"
      >
        <Share2 class="w-5 h-5" />
      </button>
      
      <!-- Cart button -->
      <button 
        class="relative w-10 h-10 rounded-full bg-white/20 flex items-center justify-center"
        @click="$emit('show-cart')"
      >
        <ShoppingCart class="w-5 h-5" />
        <span 
          v-if="cartCount > 0"
          class="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-bold"
        >
          {{ cartCount > 9 ? '9+' : cartCount }}
        </span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { ArrowLeft, ShoppingCart, Share2, UtensilsCrossed } from 'lucide-vue-next';
import { useSelfOrderCart } from '../../composables/useSelfOrderCart.js';
import { useConfigStore } from '../../store/index.js';

const props = defineProps({
  session: { type: Object, default: null }
});

defineEmits(['back', 'show-cart', 'share', 'preferences']);

const { items } = useSelfOrderCart();
const configStore = useConfigStore();
const cartCount = computed(() => items.value.reduce((sum, item) => sum + item.quantity, 0));

const restaurantName = computed(() => {
  return configStore.config?.restaurant?.name || 'Self Order';
});

const sessionName = computed(() => {
  if (props.session?.tableName) return props.session.tableName;
  const table = localStorage.getItem('selforder_table');
  return table ? `Tavolo ${table}` : null;
});

const showBackButton = computed(() => {
  return window.location.hash !== '#/menu';
});

// Translations
const currentLang = ref(localStorage.getItem('selforder_lang') || 'it');
const i18n = {
  it: { condividiTavolo: 'Condividi con il tavolo', preferenze: 'Preferenze alimentari' },
  en: { condividiTavolo: 'Share with table', preferenze: 'Food preferences' }
};
const t = computed(() => i18n[currentLang.value] || i18n.it);
</script>
