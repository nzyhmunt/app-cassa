<template>
  <div class="h-full flex flex-col bg-white">
    <!-- Header with back button -->
    <div class="flex items-center gap-3 px-4 py-3 border-b border-gray-100 shrink-0">
      <button 
        class="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center active:scale-95 transition-transform"
        @click="goBack"
      >
        <ArrowLeft class="w-5 h-5 text-gray-600" />
      </button>
      <h1 class="text-lg font-bold text-gray-800">{{ t.dettaglio }}</h1>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto">
      <!-- Image -->
      <div class="aspect-video bg-gray-100 relative">
        <img 
          v-if="item?.image" 
          :src="item.image" 
          :alt="item?.name"
          class="w-full h-full object-cover"
        />
        <div v-else class="w-full h-full flex items-center justify-center">
          <UtensilsCrossed class="w-16 h-16 text-gray-300" />
        </div>
        
        <!-- Dietary badge -->
        <div v-if="item?.note" class="absolute bottom-3 left-3">
          <span 
            v-if="item.note === 'Vegano'"
            class="bg-green-500 text-white text-xs px-3 py-1 rounded-full font-bold"
          >
            {{ t.vegano }}
          </span>
          <span 
            v-else-if="item.note === 'Vegetariano'"
            class="bg-green-400 text-white text-xs px-3 py-1 rounded-full font-bold"
          >
            {{ t.vegetariano }}
          </span>
        </div>
      </div>

      <!-- Item info -->
      <div class="p-4">
        <h2 class="text-xl font-bold text-gray-800">{{ item?.name }}</h2>
        <p class="text-gray-500 mt-1">{{ item?.description }}</p>
        <p class="theme-text text-2xl font-bold mt-3">{{ currency }}{{ formatPrice(item?.price) }}</p>
      </div>

      <!-- Ingredients -->
      <div v-if="item?.ingredients" class="px-4 pb-4">
        <p class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">{{ t.ingredienti }}</p>
        <p class="text-sm text-gray-600">{{ item.ingredients }}</p>
      </div>

      <!-- Allergens -->
      <div v-if="item?.allergens?.length > 0" class="px-4 pb-4">
        <p class="text-[10px] font-bold text-amber-600 uppercase tracking-wider mb-2 flex items-center gap-1">
          <AlertTriangle class="size-3" />
          {{ t.allergeniTitle }}
        </p>
        <div class="flex flex-wrap gap-2">
          <span 
            v-for="allergen in item.allergens" 
            :key="allergen"
            class="bg-amber-50 text-amber-800 border border-amber-200 text-xs px-3 py-1.5 rounded-full font-medium"
          >
            {{ getAllergenLabel(allergen) }}
          </span>
        </div>
      </div>

      <!-- Modifiers -->
      <div v-if="item?.modifiers?.length > 0" class="px-4 pb-4">
        <h3 class="font-semibold text-gray-800 mb-3">{{ t.aggiunte }}</h3>
        <div class="space-y-2">
          <label
            v-for="modifier in item.modifiers"
            :key="modifier.id"
            class="flex items-center justify-between p-3 bg-gray-50 rounded-xl cursor-pointer transition-colors"
            :class="{ 'theme-active-card': selectedModifiers.includes(modifier.id) }"
          >
            <div class="flex items-center gap-3">
              <input
                type="checkbox"
                :value="modifier.id"
                v-model="selectedModifiers"
                class="w-5 h-5 rounded border-gray-300 theme-accent"
              />
              <span class="text-gray-800">{{ modifier.name }}</span>
            </div>
            <span class="text-gray-500 text-sm font-medium">
              +{{ currency }}{{ formatPrice(modifier.price) }}
            </span>
          </label>
        </div>
      </div>

      <!-- Notes -->
      <div class="px-4 pb-4">
        <h3 class="font-semibold text-gray-800 mb-3">{{ t.note }}</h3>
        <textarea
          v-model="notes"
          :placeholder="t.notePlaceholder"
          class="w-full p-3 bg-gray-50 rounded-xl border border-gray-200 resize-none text-sm"
          rows="2"
        ></textarea>
      </div>
    </div>

    <!-- Add to cart button -->
    <div class="p-4 border-t border-gray-100 bg-white shrink-0">
      <button
        class="w-full py-4 theme-bg hover:theme-bg-dark text-white rounded-xl font-bold text-lg flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-md"
        @click="addToCart"
      >
        <Plus class="w-5 h-5" />
        {{ t.aggiungi }} - {{ currency }}{{ formatPrice(totalItemPrice) }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowLeft, Plus, UtensilsCrossed, AlertTriangle } from 'lucide-vue-next';
import { useSelfOrderMenu } from '../../composables/useSelfOrderMenu.js';
import { useSelfOrderCart } from '../../composables/useSelfOrderCart.js';

const props = defineProps({
  id: { type: String, required: true }
});

const router = useRouter();
const { getItemById } = useSelfOrderMenu();
const { addItem } = useSelfOrderCart();

const item = ref(null);
const selectedModifiers = ref([]);
const notes = ref('');

// Translations
const currentLang = ref(localStorage.getItem('selforder_lang') || 'it');
const allergensMap = {
  it: {
    glutine: 'Glutine',
    crostacei: 'Crostacei',
    uova: 'Uova',
    pesce: 'Pesce',
    arachidi: 'Arachidi',
    soia: 'Soia',
    lattosio: 'Lattosio',
    frutta_a_guscio: 'Frutta a guscio',
    sedano: 'Sedano',
    senape: 'Senape',
    semi_di_sesamo: 'Semi di sesamo',
    solfiti: 'Solfiti',
    lupini: 'Lupini',
    molluschi: 'Molluschi'
  },
  en: {
    glutine: 'Gluten',
    crostacei: 'Crustaceans',
    uova: 'Eggs',
    pesce: 'Fish',
    arachidi: 'Peanuts',
    soia: 'Soy',
    lattosio: 'Lactose',
    frutta_a_guscio: 'Tree nuts',
    sedano: 'Celery',
    senape: 'Mustard',
    semi_di_sesamo: 'Sesame seeds',
    solfiti: 'Sulphites',
    lupini: 'Lupins',
    molluschi: 'Molluscs'
  }
};

const i18n = {
  it: {
    dettaglio: 'Dettaglio',
    vegano: 'Vegano',
    vegetariano: 'Vegetariano',
    ingredienti: 'Ingredienti',
    allergeniTitle: 'Allergeni',
    aggiunte: 'Aggiunte',
    note: 'Note',
    notePlaceholder: 'Allergie, preferenze...',
    aggiungi: 'Aggiungi',
    currency: '€',
  },
  en: {
    dettaglio: 'Detail',
    vegano: 'Vegan',
    vegetariano: 'Vegetarian',
    ingredienti: 'Ingredients',
    allergeniTitle: 'Allergens',
    aggiunte: 'Additions',
    note: 'Notes',
    notePlaceholder: 'Allergies, preferences...',
    aggiungi: 'Add',
    currency: '€',
  }
};

const t = computed(() => i18n[currentLang.value] || i18n.it);
const currency = computed(() => t.value.currency);

const totalItemPrice = computed(() => {
  if (!item.value) return 0;
  let price = item.value.price || 0;
  
  selectedModifiers.value.forEach(modId => {
    const mod = item.value.modifiers?.find(m => m.id === modId);
    if (mod) {
      price += mod.price || 0;
    }
  });
  
  return price;
});

function loadItem() {
  item.value = getItemById(props.id);
}

function addToCart() {
  if (!item.value) return;
  
  const modifiers = selectedModifiers.value.map(id => {
    const mod = item.value.modifiers?.find(m => m.id === id);
    return mod;
  }).filter(Boolean);
  
  addItem(item.value, 1, modifiers, notes.value);
  
  router.push('/menu');
}

function goBack() {
  router.back();
}

function getAllergenLabel(allergen) {
  const map = allergensMap[currentLang.value] || allergensMap.it;
  return map[allergen] || allergen.replace(/_/g, ' ');
}

onMounted(() => {
  loadItem();
});

function formatPrice(price) {
  if (price === null || price === undefined) return '0.00';
  return price.toFixed(2);
}
</script>
