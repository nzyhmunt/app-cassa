<template>
  <div class="fixed inset-0 z-50 bg-gradient-to-br from-emerald-600 to-emerald-700 flex flex-col items-center justify-center p-6 text-white">
    <div class="w-full max-w-md text-center">
      <div class="mb-8">
        <Sparkles class="w-16 h-16 mx-auto mb-4" />
        <h2 class="text-2xl font-bold uppercase tracking-tight">{{ t.onbTitle }}</h2>
        <p class="text-white/80 text-sm mt-1 uppercase text-xs font-black tracking-widest">{{ t.onbSubtitle }}</p>
      </div>

      <!-- Diet preferences -->
      <div class="bg-white/10 backdrop-blur rounded-3xl p-6 mb-6">
        <h4 class="text-xs font-bold text-white/60 uppercase tracking-widest mb-4">{{ t.onbDiets }}</h4>
        <div class="flex flex-col gap-3">
          <button 
            @click="diet.Vegano = !diet.Vegano" 
            :class="diet.Vegano ? 'bg-white/30 border-white/50' : 'bg-white/10 border-white/20 hover:bg-white/20'"
            class="flex items-center gap-3 p-4 border-2 rounded-2xl font-bold text-sm transition-all active:scale-95 text-left"
          >
            <CheckCircle v-if="diet.Vegano" class="size-6 text-white shrink-0" />
            <Circle v-else class="size-6 text-white/60 shrink-0" />
            {{ t.dietVegan }}
          </button>
          <button 
            @click="diet.Vegetariano = !diet.Vegetariano" 
            :class="diet.Vegetariano ? 'bg-white/30 border-white/50' : 'bg-white/10 border-white/20 hover:bg-white/20'"
            class="flex items-center gap-3 p-4 border-2 rounded-2xl font-bold text-sm transition-all active:scale-95 text-left"
          >
            <CheckCircle v-if="diet.Vegetariano" class="size-6 text-white shrink-0" />
            <Circle v-else class="size-6 text-white/60 shrink-0" />
            {{ t.dietVegetarian }}
          </button>
        </div>
      </div>

      <!-- Allergens -->
      <div class="bg-white/10 backdrop-blur rounded-3xl p-6 mb-6">
        <button 
          @click="showAllergens = !showAllergens"
          class="flex items-center justify-center gap-2 w-full text-sm font-bold hover:bg-white/10 rounded-2xl p-3 transition-colors"
        >
          <AlertTriangle class="size-5" />
          {{ showAllergens ? t.hideAllergens : t.onbAllergensBtn }}
        </button>
        
        <div v-if="showAllergens" class="mt-4 max-h-60 overflow-y-auto">
          <div class="grid grid-cols-2 gap-2">
            <button 
              v-for="(label, key) in t.allergens" 
              :key="key"
              @click="allergens[key] = !allergens[key]"
              :class="allergens[key] ? 'bg-white/30 border-white/50' : 'bg-white/10 border-white/20'"
              class="p-3 border-2 rounded-xl font-medium text-xs text-left capitalize transition-all active:scale-95"
            >
              {{ allergens[key] ? '✓ ' : '' }}{{ label }}
            </button>
          </div>
        </div>
      </div>

      <!-- Discover menu button -->
      <button 
        @click="handleDiscover"
        class="w-full bg-white text-emerald-700 py-4 rounded-2xl font-bold text-lg shadow-lg transition-all active:scale-[0.98]"
      >
        {{ t.onbDiscoverMenu }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { useSelfOrderI18n } from '../../composables/useSelfOrderI18n.js';
import { useRouter } from 'vue-router';
import { Sparkles, CheckCircle, Circle, AlertTriangle } from 'lucide-vue-next';

const router = useRouter();

const showAllergens = ref(false);

const diet = reactive({
  Vegano: false,
  Vegetariano: false
});

const allergens = reactive({
  glutine: false,
  crostacei: false,
  uova: false,
  pesce: false,
  arachidi: false,
  soia: false,
  lattosio: false,
  frutta_a_guscio: false,
  sedano: false,
  senape: false,
  semi_di_sesamo: false,
  solfiti: false,
  lupini: false,
  molluschi: false
});

const i18n = {
  it: {
    onbTitle: 'Personalizza la tua cena',
    onbSubtitle: 'Configura la tua esperienza',
    onbDiets: 'Diete e Scelte',
    dietVegan: 'Vegano',
    dietVegetarian: 'Vegetariano',
    onbAllergensBtn: 'Gestione Allergeni',
    hideAllergens: 'Nascondi Allergeni',
    onbDiscoverMenu: 'Scopri il Menu',
    allergens: {
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
    }
  },
  en: {
    onbTitle: 'Customize your dinner',
    onbSubtitle: 'Configure your experience',
    onbDiets: 'Diet & Choices',
    dietVegan: 'Vegan',
    dietVegetarian: 'Vegetarian',
    onbAllergensBtn: 'Allergen Management',
    hideAllergens: 'Hide Allergens',
    onbDiscoverMenu: 'Discover the Menu',
    allergens: {
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
  }
};

const { t, currentLang } = useSelfOrderI18n(i18n);

onMounted(() => {
  // Restore preferences from localStorage
  const savedPrefs = localStorage.getItem('selforder_preferences');
  if (savedPrefs) {
    try {
      const prefs = JSON.parse(savedPrefs);
      Object.assign(diet, prefs.diet || {});
      Object.assign(allergens, prefs.allergens || {});
    } catch {
      // ignore
    }
  }
});

function handleDiscover() {
  // Save preferences
  localStorage.setItem('selforder_preferences', JSON.stringify({ diet, allergens }));
  localStorage.setItem('selforder_onboarding_done', 'true');
  router.push('/menu');
}
</script>
