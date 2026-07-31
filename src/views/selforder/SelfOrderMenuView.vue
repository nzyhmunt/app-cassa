<template>
  <div class="h-full flex flex-col bg-gray-50">
    <!-- Loading state -->
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <Loader2 class="w-8 h-8 text-emerald-600 animate-spin" />
    </div>

    <!-- Category tabs -->
    <div v-else class="bg-white border-b border-gray-200 px-4 py-3 overflow-x-auto shrink-0">
      <div class="flex gap-2 min-w-max">
        <button
          v-for="category in categories"
          :key="category"
          class="px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors"
          :class="selectedCategory === category 
            ? 'theme-bg text-white' 
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
          @click="selectedCategory = category"
        >
          {{ category }}
        </button>
      </div>
    </div>

    <!-- Menu items grid -->
    <div v-if="!loading" class="flex-1 overflow-y-auto p-4 pb-24">
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        <button
          v-for="item in filteredItems"
          :key="item.id"
          class="bg-white rounded-2xl overflow-hidden shadow-sm text-left active:scale-[0.98] transition-transform flex flex-col"
          @click="selectItem(item)"
        >
          <!-- Image area -->
          <div class="aspect-square bg-gray-100 relative">
            <img 
              v-if="item.image" 
              :src="item.image" 
              :alt="item.name"
              class="w-full h-full object-cover"
            />
            <div v-else class="w-full h-full flex items-center justify-center">
              <UtensilsCrossed class="w-10 h-10 text-gray-300" />
            </div>
            
            <!-- Unavailable badge -->
            <span 
              v-if="item.available === false"
              class="absolute top-2 right-2 bg-red-500 text-white text-[10px] px-2 py-1 rounded-full font-bold"
            >
              {{ t.nonDisponibile }}
            </span>
            
            <!-- Dietary badges -->
            <div class="absolute bottom-2 left-2 flex gap-1">
              <span 
                v-if="item.note === 'Vegano'"
                class="bg-green-500 text-white text-[9px] px-2 py-0.5 rounded-full font-bold"
              >
                {{ t.vegano }}
              </span>
              <span 
                v-else-if="item.note === 'Vegetariano'"
                class="bg-green-400 text-white text-[9px] px-2 py-0.5 rounded-full font-bold"
              >
                {{ t.vegetariano }}
              </span>
            </div>
          </div>
          
          <!-- Item info -->
          <div class="p-3 flex flex-col flex-1">
            <h3 class="font-medium text-gray-800 text-sm line-clamp-2 leading-tight">{{ item.name }}</h3>
            <p class="text-xs text-gray-400 mt-1 line-clamp-1">{{ item.description }}</p>
            <div class="mt-auto pt-2">
              <p class="theme-text font-bold text-base">{{ currency }}{{ formatPrice(item.price) }}</p>
            </div>
          </div>
        </button>
      </div>

      <div v-if="filteredItems.length === 0" class="text-center py-12">
        <UtensilsCrossed class="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <p class="text-gray-500">{{ t.nessunArticolo }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { UtensilsCrossed, Loader2 } from 'lucide-vue-next';
import { useSelfOrderMenu } from '../../composables/useSelfOrderMenu.js';
import { useSelfOrderCart } from '../../composables/useSelfOrderCart.js';

const router = useRouter();
const { menu, categories: menuCategories, loading, loadMenu } = useSelfOrderMenu();
const { totalItems, totalPrice } = useSelfOrderCart();

const selectedCategory = ref(null);

// Translations
const currentLang = ref(localStorage.getItem('selforder_lang') || 'it');
const i18n = {
  it: {
    nonDisponibile: 'Non disp.',
    vegano: 'Vegano',
    vegetariano: 'Veg',
    nessunArticolo: 'Nessun articolo in questa categoria',
    currency: '€',
  },
  en: {
    nonDisponibile: 'N/A',
    vegano: 'Vegan',
    vegetariano: 'Veg',
    nessunArticolo: 'No items in this category',
    currency: '€',
  }
};

const t = computed(() => i18n[currentLang.value] || i18n.it);
const currency = computed(() => t.value.currency);

const categories = computed(() => {
  const cats = menuCategories.value || [];
  return ['Tutti', ...cats];
});

const filteredItems = computed(() => {
  let allItems = [];
  
  Object.entries(menu.value || {}).forEach(([category, items]) => {
    items.forEach(item => {
      if (item.name) {
        allItems.push({ ...item, category });
      }
    });
  });
  
  if (selectedCategory.value && selectedCategory.value !== 'Tutti') {
    allItems = allItems.filter(item => item.category === selectedCategory.value);
  }
  
  return allItems.filter(item => item.available !== false);
});

function selectItem(item) {
  router.push(`/item/${item.id}`);
}

function formatPrice(price) {
  if (price === null || price === undefined) return '0.00';
  return price.toFixed(2);
}

// Load menu on mount
onMounted(async () => {
  if (Object.keys(menu.value || {}).length === 0) {
    await loadMenu();
  }
});
</script>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.line-clamp-1 {
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
