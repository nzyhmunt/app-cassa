<template>
  <div class="h-full flex flex-col bg-gray-50">
    <!-- Loading state -->
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <Loader2 class="w-8 h-8 text-emerald-600 animate-spin" />
    </div>

    <template v-else>
      <!-- Dynamic Suggestions (based on time of day) -->
      <div v-if="dynamicSuggestions.length > 0" class="bg-gradient-to-r from-purple-50 to-white border-b border-purple-100 px-4 py-3">
        <p class="text-xs font-bold text-purple-600 mb-2 uppercase tracking-wide">{{ currentTimeLabel }}</p>
        <div class="flex gap-2 overflow-x-auto pb-1">
          <button
            v-for="sug in dynamicSuggestions"
            :key="sug.id"
            @click="runQuickAi(sug)"
            class="shrink-0 px-4 py-2 bg-white border border-purple-200 rounded-full text-sm font-medium text-purple-700 hover:bg-purple-50 transition-colors flex items-center gap-2"
          >
            <Sparkles class="size-4" />
            {{ sug.label }}
          </button>
        </div>
      </div>

      <!-- Category tabs with allergen filter -->
      <div class="bg-white border-b border-gray-200 px-4 py-3 overflow-x-auto shrink-0">
        <div class="flex items-center gap-2 min-w-max">
          <!-- Allergen filter toggle -->
          <button
            v-if="hasAllergenPreferences"
            @click="filterAllergens = !filterAllergens"
            class="shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors flex items-center gap-1"
            :class="filterAllergens 
              ? 'bg-amber-100 text-amber-700 border border-amber-300' 
              : 'bg-gray-100 text-gray-600 border border-gray-200'"
          >
            <Filter class="size-3" />
            {{ filterAllergens ? t.hideAllergens : t.filterAllergens }}
          </button>

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
      <div class="flex-1 overflow-y-auto p-4 pb-24">
        <!-- Cart Suggestions -->
        <div v-if="cartSuggestions.length > 0 && cartItems.length > 0" class="mb-6 p-4 bg-purple-50 rounded-2xl border border-purple-100">
          <div class="flex items-center justify-between mb-3">
            <p class="text-sm font-bold text-purple-700">{{ t.completeMeal }}</p>
            <button 
              @click="askCartAdvice"
              class="text-xs text-purple-600 hover:text-purple-800 font-medium underline"
            >
              {{ t.askAdvice }}
            </button>
          </div>
          <div class="flex gap-2 overflow-x-auto pb-1">
            <button
              v-for="item in cartSuggestions"
              :key="item.id"
              @click="quickAddToCart(item)"
              class="shrink-0 flex items-center gap-2 px-3 py-2 bg-white rounded-xl border border-purple-200 hover:border-purple-400 transition-colors"
            >
              <span class="text-sm font-medium text-gray-800">{{ item.name }}</span>
              <Plus class="size-4 text-emerald-600" />
            </button>
          </div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          <div
            v-for="item in filteredItems"
            :key="item.id"
            class="bg-white rounded-2xl overflow-hidden shadow-sm text-left active:scale-[0.98] transition-transform flex flex-col"
          >
            <!-- Image area -->
            <div class="aspect-square bg-gray-100 relative cursor-pointer" @click="selectItem(item)">
              <img 
                v-if="item.image" 
                :src="item.image" 
                :alt="item.name"
                class="w-full h-full object-cover"
              />
              <div v-else class="w-full h-full flex items-center justify-center">
                <UtensilsCrossed class="w-10 h-10 text-gray-300" />
              </div>
              
              <!-- Price overlay on image -->
              <div class="absolute top-2 right-2 bg-white/95 backdrop-blur-sm px-2.5 py-1 rounded-full shadow-sm border border-gray-100">
                <span class="theme-text font-black text-sm">{{ currency }}{{ formatPrice(item.price) }}</span>
              </div>
              
              <!-- Unavailable badge -->
              <span 
                v-if="item.available === false"
                class="absolute top-2 left-2 bg-red-500 text-white text-[10px] px-2 py-1 rounded-full font-bold"
              >
                {{ t.notAvailable }}
              </span>
              
              <!-- Dietary badges -->
              <div class="absolute bottom-2 left-2 flex gap-1">
                <span 
                  v-if="item.note === 'Vegano'"
                  class="bg-green-100 text-green-800 text-[9px] px-2 py-0.5 rounded-full font-bold border border-green-200"
                >
                  {{ t.vegan }}
                </span>
                <span 
                  v-else-if="item.note === 'Vegetariano'"
                  class="bg-green-100 text-green-800 text-[9px] px-2 py-0.5 rounded-full font-bold border border-green-200"
                >
                  {{ t.vegetarian }}
                </span>
              </div>
            </div>
            
            <!-- Item info -->
            <div class="p-3 flex flex-col flex-1">
              <h3 class="font-bold text-gray-900 text-sm line-clamp-2 leading-tight cursor-pointer" @click="selectItem(item)">{{ item.name }}</h3>
              <p class="text-xs text-gray-500 mt-1 line-clamp-2 italic">{{ item.description }}</p>
              
              <!-- Allergens highlight if matching profile -->
              <div v-if="item.allergens && item.allergens.length > 0" class="mt-2 flex flex-wrap gap-1">
                <span 
                  v-for="allergen in item.allergens.slice(0, 3)" 
                  :key="allergen"
                  :class="isAllergenInProfile(allergen) ? 'bg-red-100 text-red-700 border-red-300 font-bold' : 'bg-amber-50 text-amber-700 border-amber-200'"
                  class="text-[10px] px-2 py-0.5 rounded-md border capitalize"
                >
                  {{ allergen.replace(/_/g, ' ') }}
                </span>
                <span v-if="item.allergens.length > 3" class="text-[10px] text-gray-500">+{{ item.allergens.length - 3 }}</span>
              </div>
              
              <!-- Action buttons -->
              <div class="mt-auto pt-3 flex items-center gap-2 border-t border-gray-50">
                <button 
                  @click="askMagic(item)"
                  class="flex-none p-2 rounded-lg bg-gray-50 hover:bg-purple-50 text-gray-500 hover:text-purple-600 transition-colors"
                  :title="t.chefRecommended"
                >
                  <Sparkles class="size-4" />
                </button>
                <button 
                  @click="askInfo(item)"
                  class="flex-none p-2 rounded-lg bg-gray-50 hover:bg-blue-50 text-gray-500 hover:text-blue-600 transition-colors"
                  :title="t.moreInfo"
                >
                  <Info class="size-4" />
                </button>
                <button 
                  @click="quickAddToCart(item)"
                  class="flex-1 relative h-10 flex items-center justify-center gap-2 bg-gray-900 hover:bg-black text-white rounded-xl font-bold transition-all active:scale-95 shadow-sm"
                >
                  <Plus class="size-4" />
                  <span class="uppercase tracking-wider text-xs">{{ t.add }}</span>
                  <span 
                    v-if="getItemQty(item.id) > 0" 
                    class="absolute -top-2 -right-2 theme-bg text-white text-[10px] font-bold size-5 flex items-center justify-center rounded-full border-2 border-white shadow-sm"
                  >
                    {{ getItemQty(item.id) }}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="filteredItems.length === 0" class="text-center py-12">
          <UtensilsCrossed class="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p class="text-gray-500">{{ t.noItems }}</p>
          <p v-if="filterAllergens" class="text-sm text-amber-600 mt-2">{{ t.hiddenAllergens }}</p>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, inject } from 'vue';
import { useSelfOrderI18n } from '../../composables/useSelfOrderI18n.js';
import { useRouter } from 'vue-router';
import { UtensilsCrossed, Loader2, Sparkles, Info, Plus, Filter } from 'lucide-vue-next';
import { useSelfOrderMenu } from '../../composables/useSelfOrderMenu.js';
import { useSelfOrderCart } from '../../composables/useSelfOrderCart.js';

const router = useRouter();
const { menu, categories: menuCategories, loading, loadMenu, getItemById } = useSelfOrderMenu();
const { items: cartItems, addItem } = useSelfOrderCart();

const selectedCategory = ref(null);
const filterAllergens = ref(false);

// Preferences (from onboarding)
const preferences = ref({ diet: {}, allergens: {} });
const hasAllergenPreferences = computed(() => {
  return Object.values(preferences.value.allergens || {}).some(v => v);
});

// AI functions (delegated to parent or use simulated responses)
const navigateTo = inject('navigateTo', (path) => router.push(path));

// Translations
const i18n = {
  it: {
    notAvailable: 'Non disp.',
    vegan: 'Vegano',
    vegetarian: 'Veg',
    add: 'Aggiungi',
    noItems: 'Nessun articolo in questa categoria',
    hiddenAllergens: 'Alcuni piatti sono nascosti per le tue preferenze',
    completeMeal: 'Completa il tuo pasto',
    askAdvice: 'Chiedi consiglio',
    chefRecommended: 'Consigliato dallo Chef',
    moreInfo: 'Maggiori informazioni',
    hideAllergens: 'Nascondi',
    filterAllergens: 'Filtra allergeni',
    currency: '€',
  },
  en: {
    notAvailable: 'N/A',
    vegan: 'Vegan',
    vegetarian: 'Veg',
    add: 'Add',
    noItems: 'No items in this category',
    hiddenAllergens: 'Some dishes hidden for your preferences',
    completeMeal: 'Complete your meal',
    askAdvice: 'Ask for advice',
    chefRecommended: 'Chef recommended',
    moreInfo: 'More info',
    hideAllergens: 'Hide',
    filterAllergens: 'Filter allergens',
    currency: '€',
  }
};

const { t, currentLang } = useSelfOrderI18n(i18n);
const currency = computed(() => t.value.currency);

// Time-based label
const currentTimeLabel = computed(() => {
  const hour = new Date().getHours();
  const isEn = currentLang.value === 'en';
  
  if (hour < 11) {
    return isEn ? 'Good morning suggestions' : 'Buongiorno, cosa desideri?';
  } else if (hour < 15) {
    return isEn ? 'Lunch suggestions' : 'Buon pranzo!';
  } else if (hour < 18) {
    return isEn ? 'Afternoon treat?' : 'Pomeriggio, una pausa?';
  } else if (hour < 21) {
    return isEn ? 'Dinner suggestions' : 'Buonasera, cosa prendi?';
  } else {
    return isEn ? 'Late night snack?' : 'Serata, cosa ti preparo?';
  }
});

// Dynamic suggestions based on time
const dynamicSuggestions = computed(() => {
  const hour = new Date().getHours();
  const isEn = currentLang.value === 'en';
  const pool = [];
  
  if (hour < 11) {
    pool.push(
      { id: 'colazione', label: isEn ? '☕ Breakfast' : '☕ Colazione', prompt: isEn ? 'Suggest a light breakfast' : 'Suggerisci una colazione leggera' },
      { id: 'energizzante', label: isEn ? '⚡ Energizing' : '⚡ Energizzante', prompt: isEn ? 'Suggest something energizing' : 'Suggerisci qualcosa di energizzante' }
    );
  } else if (hour < 15) {
    pool.push(
      { id: 'pranzo', label: isEn ? '🍽️ Lunch menu' : '🍽️ Menu pranzo', prompt: isEn ? 'Suggest a complete lunch' : 'Suggerisci un pranzo completo' },
      { id: 'veloce', label: isEn ? '⚡ Quick lunch' : '⚡ Pranzo veloce', prompt: isEn ? 'Suggest something quick' : 'Suggerisci qualcosa di veloce' }
    );
  } else if (hour < 18) {
    pool.push(
      { id: 'merenda', label: isEn ? '🍰 Sweet break' : '🍰 Pausa dolce', prompt: isEn ? 'Suggest a sweet treat' : 'Suggerisci qualcosa di dolce' },
      { id: 'ristoro', label: isEn ? '☕ Coffee break' : '☕ Pausa caffè', prompt: isEn ? 'Suggest a coffee or snack' : 'Suggerisci un caffè o snack' }
    );
  } else if (hour < 21) {
    pool.push(
      { id: 'cena', label: isEn ? '🍝 Dinner' : '🍝 Menu cena', prompt: isEn ? 'Suggest a nice dinner' : 'Suggerisci una cena sfiziosa' },
      { id: 'leggero', label: isEn ? '🥗 Light dinner' : '🥗 Cena leggera', prompt: isEn ? 'Suggest something light' : 'Suggerisci qualcosa di leggero' }
    );
  } else {
    pool.push(
      { id: 'notturno', label: isEn ? '🌙 Late snack' : '🌙 Serata', prompt: isEn ? 'Suggest a late night snack' : 'Suggerisci qualcosa per la serata' }
    );
  }
  
  // Add dietary suggestions if active
  if (preferences.value.diet?.Vegano) {
    pool.push({ id: 'vegano', label: isEn ? '🌱 Vegan options' : '🌱 Opzioni vegane', prompt: isEn ? 'Show vegan options' : 'Mostra opzioni vegane' });
  }
  if (preferences.value.diet?.Vegetariano) {
    pool.push({ id: 'veggie', label: isEn ? '🥬 Vegetarian' : '🥬 Vegetariano', prompt: isEn ? 'Show vegetarian options' : 'Mostra opzioni vegetariane' });
  }
  
  return pool.sort(() => 0.5 - Math.random()).slice(0, 3);
});

const categories = computed(() => {
  const cats = menuCategories.value || [];
  return ['Tutti', ...cats];
});

// Get user's allergen preferences
function loadPreferences() {
  const saved = localStorage.getItem('selforder_preferences');
  if (saved) {
    try {
      preferences.value = JSON.parse(saved);
    } catch {
      preferences.value = { diet: {}, allergens: {} };
    }
  }
}

// Check if item has allergens that user wants to avoid
function itemHasAllergen(item) {
  if (!filterAllergens.value || !hasAllergenPreferences.value) return false;
  
  const itemAllergens = item.allergens || [];
  for (const allergen of itemAllergens) {
    if (preferences.value.allergens[allergen]) return true;
  }
  return false;
}

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
  
  // Filter out unavailable and allergen items
  allItems = allItems.filter(item => 
    item.available !== false && 
    !itemHasAllergen(item)
  );
  
  return allItems;
});

// Cart suggestions - suggest items to complete a meal
const cartSuggestions = computed(() => {
  if (cartItems.value.length === 0) return [];
  
  const suggestions = [];
  const cartCategories = new Set(cartItems.value.map(c => {
    // Find item's category
    for (const [cat, items] of Object.entries(menu.value || {})) {
      if (items.find(i => i.id === c.menuItemId)) {
        return cat;
      }
    }
    return '';
  }));
  
  // Check what categories are missing for a complete meal
  const allCategories = Object.keys(menu.value || {});
  
  // Simple logic: if no Bevande, suggest a drink
  if (!cartCategories.has('Bevande') && menu.value?.['Bevande']) {
    suggestions.push(...menu.value['Bevande'].filter(i => i.available !== false).slice(0, 2));
  }
  
  // If has Primi but no Contorni, suggest a side
  if (cartCategories.has('Primi Piatti') && !cartCategories.has('Contorni') && menu.value?.['Contorni']) {
    suggestions.push(...menu.value['Contorni'].filter(i => i.available !== false).slice(0, 2));
  }
  
  // If has Primi or Secondi but no Dolci, suggest dessert
  if ((cartCategories.has('Primi Piatti') || cartCategories.has('Secondi Piatti')) && 
      !cartCategories.has('Dolci') && menu.value?.['Dolci']) {
    suggestions.push(...menu.value['Dolci'].filter(i => i.available !== false).slice(0, 2));
  }
  
  return suggestions.slice(0, 4);
});

function selectItem(item) {
  router.push(`/item/${item.id}`);
}

function formatPrice(price) {
  if (price === null || price === undefined) return '0.00';
  return price.toFixed(2);
}

// Get quantity of item in cart
function getItemQty(itemId) {
  const found = cartItems.value.find(c => c.menuItemId === itemId);
  return found ? found.quantity : 0;
}

// Check if allergen is in user's preferences
function isAllergenInProfile(allergen) {
  return preferences.value.allergens?.[allergen] === true;
}

function quickAddToCart(item) {
  addItem(item, 1, [], '');
}

function askMagic(item) {
  // Navigate to chat with pre-filled message
  router.push({ path: '/chat', query: { action: 'magic', item: item.id } });
}

function askInfo(item) {
  router.push({ path: '/chat', query: { action: 'info', item: item.id } });
}

function askCartAdvice() {
  router.push('/chat');
}

function runQuickAi(suggestion) {
  router.push({ path: '/chat', query: { action: 'quick', suggestion: suggestion.id } });
}

// Load menu and preferences on mount
onMounted(async () => {
  loadPreferences();
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
