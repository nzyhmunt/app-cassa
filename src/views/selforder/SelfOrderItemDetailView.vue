<template>
  <div class="h-full flex flex-col bg-white">
    <!-- Header with back button -->
    <div class="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
      <button 
        class="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center"
        @click="goBack"
      >
        <ArrowLeft class="w-5 h-5 text-gray-600" />
      </button>
      <h1 class="text-lg font-bold text-gray-800">Dettaglio</h1>
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
      </div>

      <!-- Item info -->
      <div class="p-4">
        <h2 class="text-xl font-bold text-gray-800">{{ item?.name }}</h2>
        <p class="text-gray-500 mt-1">{{ item?.description }}</p>
        <p class="text-emerald-600 text-2xl font-bold mt-3">{{ formatPrice(item?.price) }}</p>
      </div>

      <!-- Modifiers -->
      <div v-if="item?.modifiers?.length > 0" class="px-4 pb-4">
        <h3 class="font-semibold text-gray-800 mb-3">Aggiunte</h3>
        <div class="space-y-2">
          <label
            v-for="modifier in item.modifiers"
            :key="modifier.id"
            class="flex items-center justify-between p-3 bg-gray-50 rounded-xl cursor-pointer"
            :class="{ 'bg-emerald-50': selectedModifiers.includes(modifier.id) }"
          >
            <div class="flex items-center gap-3">
              <input
                type="checkbox"
                :value="modifier.id"
                v-model="selectedModifiers"
                class="w-5 h-5 rounded border-gray-300 text-emerald-600"
              />
              <span class="text-gray-800">{{ modifier.name }}</span>
            </div>
            <span class="text-gray-500 text-sm">
              +{{ formatPrice(modifier.price) }}
            </span>
          </label>
        </div>
      </div>

      <!-- Notes -->
      <div class="px-4 pb-4">
        <h3 class="font-semibold text-gray-800 mb-3">Note</h3>
        <textarea
          v-model="notes"
          placeholder="Allergie, preferenze..."
          class="w-full p-3 bg-gray-50 rounded-xl border border-gray-200 resize-none"
          rows="3"
        ></textarea>
      </div>
    </div>

    <!-- Add to cart button -->
    <div class="p-4 border-t border-gray-100 bg-white">
      <button
        class="w-full py-4 bg-emerald-600 text-white rounded-xl font-bold text-lg flex items-center justify-center gap-2 active:scale-95 transition-transform"
        @click="addToCart"
      >
        <Plus class="w-5 h-5" />
        Aggiungi al carrello - {{ formatPrice(totalItemPrice) }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter, onBeforeRouteLeave } from 'vue-router';
import { ArrowLeft, Plus, UtensilsCrossed } from 'lucide-vue-next';
import { useConfigStore } from '../../store/index.js';
import { useSelfOrderCart } from '../../composables/useSelfOrderCart.js';

const props = defineProps({
  id: { type: String, required: true }
});

const router = useRouter();
const configStore = useConfigStore();
const { addItem } = useSelfOrderCart();

const item = ref(null);
const selectedModifiers = ref([]);
const notes = ref('');
const quantity = ref(1);

const totalItemPrice = computed(() => {
  if (!item.value) return 0;
  let price = item.value.price || 0;
  
  selectedModifiers.value.forEach(modId => {
    const mod = item.value.modifiers?.find(m => m.id === modId);
    if (mod) {
      price += mod.price || 0;
    }
  });
  
  return price * quantity.value;
});

function loadItem() {
  const menu = configStore.menu || {};
  
  for (const [category, items] of Object.entries(menu)) {
    const found = items.find(i => i.id === props.id);
    if (found) {
      item.value = { ...found, category };
      break;
    }
  }
}

function addToCart() {
  if (!item.value) return;
  
  const modifiers = selectedModifiers.value.map(id => {
    const mod = item.value.modifiers?.find(m => m.id === id);
    return mod;
  }).filter(Boolean);
  
  addItem(item.value, quantity.value, modifiers, notes.value);
  
  router.push('/menu');
}

function goBack() {
  router.back();
}

onMounted(() => {
  loadItem();
});

function formatPrice(price) {
  if (price === null || price === undefined) return '';
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR'
  }).format(price);
}
</script>
