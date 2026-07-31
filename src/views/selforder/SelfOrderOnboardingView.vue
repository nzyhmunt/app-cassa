<template>
  <div class="fixed inset-0 z-50 bg-gradient-to-br from-emerald-600 to-emerald-700 flex flex-col items-center justify-center p-6 text-white">
    <div class="w-full max-w-md text-center">
      <div class="mb-8">
        <Sparkles class="w-16 h-16 mx-auto mb-4" />
        <h2 class="text-2xl font-bold uppercase tracking-tight">{{ t.onbTitolo }}</h2>
        <p class="text-white/80 text-sm mt-1 uppercase text-xs font-black tracking-widest">{{ t.onbSottotitolo }}</p>
      </div>

      <!-- Diet preferences -->
      <div class="bg-white/10 backdrop-blur rounded-3xl p-6 mb-6">
        <h4 class="text-xs font-bold text-white/60 uppercase tracking-widest mb-4">{{ t.onbDiete }}</h4>
        <div class="flex flex-col gap-3">
          <button 
            @click="diet.Vegano = !diet.Vegano" 
            :class="diet.Vegano ? 'bg-white/30 border-white/50' : 'bg-white/10 border-white/20 hover:bg-white/20'"
            class="flex items-center gap-3 p-4 border-2 rounded-2xl font-bold text-sm transition-all active:scale-95 text-left"
          >
            <CheckCircle v-if="diet.Vegano" class="size-6 text-white shrink-0" />
            <Circle v-else class="size-6 text-white/60 shrink-0" />
            {{ t.dietVegano }}
          </button>
          <button 
            @click="diet.Vegetariano = !diet.Vegetariano" 
            :class="diet.Vegetariano ? 'bg-white/30 border-white/50' : 'bg-white/10 border-white/20 hover:bg-white/20'"
            class="flex items-center gap-3 p-4 border-2 rounded-2xl font-bold text-sm transition-all active:scale-95 text-left"
          >
            <CheckCircle v-if="diet.Vegetariano" class="size-6 text-white shrink-0" />
            <Circle v-else class="size-6 text-white/60 shrink-0" />
            {{ t.dietVegetariano }}
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
          {{ showAllergens ? t.nascondiAllergeni : t.onbAllergeniBtn }}
        </button>
        
        <div v-if="showAllergens" class="mt-4">
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
        {{ t.onbScopriMenu }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Sparkles, CheckCircle, Circle, AlertTriangle } from 'lucide-vue-next';

const router = useRouter();

const currentLang = ref(localStorage.getItem('selforder_lang') || 'it');
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
    onbTitolo: 'Personalizza la tua cena',
    onbSottotitolo: 'Configura la tua esperienza',
    onbDiete: 'Diete e Scelte',
    dietVegano: 'Vegano',
    dietVegetariano: 'Vegetariano',
    onbAllergeniBtn: 'Gestione Allergeni',
    nascondiAllergeni: 'Nascondi Allergeni',
    onbScopriMenu: 'Scopri il Menu',
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
    onbTitolo: 'Customize your dinner',
    onbSottotitolo: 'Configure your experience',
    onbDiete: 'Diet & Choices',
    dietVegano: 'Vegan',
    dietVegetariano: 'Vegetarian',
    onbAllergeniBtn: 'Allergen Management',
    nascondiAllergeni: 'Hide Allergens',
    onbScopriMenu: 'Discover the Menu',
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

const t = computed(() => i18n[currentLang.value] || i18n.it);

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
