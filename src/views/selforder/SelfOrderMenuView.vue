<template>
  <div class="h-full flex flex-col bg-gray-50">
    <!-- Category tabs -->
    <div class="bg-white border-b border-gray-200 px-4 py-3 overflow-x-auto">
      <div class="flex gap-2 min-w-max">
        <button
          v-for="category in categories"
          :key="category"
          class="px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors"
          :class="selectedCategory === category 
            ? 'bg-emerald-600 text-white' 
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
          @click="selectedCategory = category"
        >
          {{ category }}
        </button>
      </div>
    </div>

    <!-- Menu items grid -->
    <div class="flex-1 overflow-y-auto p-4">
      <div class="grid grid-cols-2 gap-3">
        <button
          v-for="item in filteredItems"
          :key="item.id"
          class="bg-white rounded-xl overflow-hidden shadow-sm text-left active:scale-95 transition-transform"
          @click="selectItem(item)"
        >
          <div class="aspect-square bg-gray-100 relative">
            <img 
              v-if="item.image" 
              :src="item.image" 
              :alt="item.name"
              class="w-full h-full object-cover"
            />
            <div v-else class="w-full h-full flex items-center justify-center">
              <UtensilsCrossed class="w-8 h-8 text-gray-300" />
            </div>
            <span 
              v-if="item.available === false"
              class="absolute top-2 right-2 bg-red-500 text-white text-xs px-2 py-1 rounded-full"
            >
              Non disponibile
            </span>
          </div>
          <div class="p-3">
            <h3 class="font-medium text-gray-800 text-sm line-clamp-2">{{ item.name }}</h3>
            <p class="text-emerald-600 font-bold mt-1">{{ formatPrice(item.price) }}</p>
          </div>
        </button>
      </div>

      <div v-if="filteredItems.length === 0" class="text-center py-12">
        <UtensilsCrossed class="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <p class="text-gray-500">Nessun articolo in questa categoria</p>
      </div>
    </div>

    <!-- Cart summary bar -->
    <div 
      v-if="totalItems > 0"
      class="bg-emerald-600 text-white px-4 py-3 flex items-center justify-between"
      @click="navigateTo('/cart')"
    >
      <div class="flex items-center gap-3">
        <div class="bg-white/20 rounded-full px-3 py-1">
          <span class="font-bold">{{ totalItems }}</span>
        </div>
        <span>Vedi carrello</span>
      </div>
      <span class="font-bold">{{ formatPrice(totalPrice) }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, inject } from 'vue';
import { useRouter } from 'vue-router';
import { UtensilsCrossed } from 'lucide-vue-next';
import { useConfigStore } from '../../store/index.js';
import { useSelfOrderCart } from '../../composables/useSelfOrderCart.js';

const router = useRouter();
const configStore = useConfigStore();
const { items, totalItems, totalPrice } = useSelfOrderCart();
const navigateTo = inject('navigateTo');

const selectedCategory = ref(null);

const categories = computed(() => {
  const cats = new Set();
  Object.values(configStore.menu || {}).forEach(categoryItems => {
    categoryItems.forEach(item => {
      if (item.name) cats.add(item.category || 'Altro');
    });
  });
  return ['Tutti', ...Array.from(cats)];
});

const filteredItems = computed(() => {
  const menu = configStore.menu || {};
  let allItems = [];
  
  Object.entries(menu).forEach(([category, items]) => {
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
  if (price === null || price === undefined) return '';
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR'
  }).format(price);
}
</script>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
