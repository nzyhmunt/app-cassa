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
        <p class="font-bold">{{ sessionName || 'Self Order' }}</p>
        <p class="text-xs text-emerald-100">Ordina dal tuo tavolo</p>
      </div>
    </div>
    
    <div class="flex items-center gap-2">
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
        class="relative"
        @click="$emit('show-cart')"
      >
        <ShoppingCart class="w-6 h-6" />
        <span 
          v-if="cartCount > 0"
          class="absolute -top-2 -right-2 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold"
        >
          {{ cartCount > 9 ? '9+' : cartCount }}
        </span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { ArrowLeft, ShoppingCart, Share2 } from 'lucide-vue-next';
import { useSelfOrderCart } from '../../composables/useSelfOrderCart.js';

const props = defineProps({
  session: { type: Object, default: null }
});

defineEmits(['back', 'show-cart', 'share']);

const { items } = useSelfOrderCart();
const cartCount = computed(() => items.value.reduce((sum, item) => sum + item.quantity, 0));

const sessionName = computed(() => {
  if (props.session?.tableName) return props.session.tableName;
  const table = localStorage.getItem('selforder_table');
  return table ? `Tavolo ${table}` : 'Self Order';
});

const showBackButton = computed(() => {
  return window.location.hash !== '#/menu';
});

// Translations
const currentLang = ref(localStorage.getItem('selforder_lang') || 'it');
const i18n = {
  it: { condividiTavolo: 'Condividi con il tavolo' },
  en: { condividiTavolo: 'Share with table' }
};
const t = computed(() => i18n[currentLang.value] || i18n.it);
</script>
