<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/50" @click="$emit('update:modelValue', false)"></div>
        
        <!-- Modal content -->
        <div class="relative w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl max-h-[85vh] overflow-hidden flex flex-col">
          <!-- Header -->
          <div class="flex items-center justify-between p-4 border-b">
            <h3 class="text-lg font-bold">{{ t.preferenze }}</h3>
            <button @click="$emit('update:modelValue', false)" class="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
              <X class="size-5 text-gray-600" />
            </button>
          </div>
          
          <!-- Content -->
          <div class="flex-1 overflow-y-auto p-4">
            <!-- Diet preferences -->
            <div class="mb-6">
              <h4 class="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">{{ t.diete }}</h4>
              <div class="flex flex-col gap-2">
                <button 
                  @click="diet.Vegano = !diet.Vegano" 
                  :class="diet.Vegano ? 'bg-emerald-50 border-emerald-500 text-emerald-700' : 'bg-gray-50 border-gray-200'"
                  class="flex items-center gap-3 p-3 border-2 rounded-xl font-medium text-sm transition-all"
                >
                  <CheckCircle v-if="diet.Vegano" class="size-5 text-emerald-600 shrink-0" />
                  <Circle v-else class="size-5 text-gray-400 shrink-0" />
                  {{ t.vegano }}
                </button>
                <button 
                  @click="diet.Vegetariano = !diet.Vegetariano" 
                  :class="diet.Vegetariano ? 'bg-emerald-50 border-emerald-500 text-emerald-700' : 'bg-gray-50 border-gray-200'"
                  class="flex items-center gap-3 p-3 border-2 rounded-xl font-medium text-sm transition-all"
                >
                  <CheckCircle v-if="diet.Vegetariano" class="size-5 text-emerald-600 shrink-0" />
                  <Circle v-else class="size-5 text-gray-400 shrink-0" />
                  {{ t.vegetariano }}
                </button>
              </div>
            </div>
            
            <!-- Allergens -->
            <div>
              <h4 class="text-xs font-bold text-amber-600 uppercase tracking-widest mb-3 flex items-center gap-1">
                <AlertTriangle class="size-4" />
                {{ t.allergeni }}
              </h4>
              <div class="grid grid-cols-2 gap-2">
                <button 
                  v-for="(label, key) in allergenLabels" 
                  :key="key"
                  @click="allergens[key] = !allergens[key]"
                  :class="allergens[key] ? 'bg-amber-50 border-amber-500 text-amber-700' : 'bg-gray-50 border-gray-200 text-gray-600'"
                  class="p-3 border-2 rounded-xl font-medium text-xs text-left capitalize transition-all"
                >
                  {{ allergens[key] ? '✓ ' : '' }}{{ label }}
                </button>
              </div>
            </div>
          </div>
          
          <!-- Footer -->
          <div class="p-4 border-t bg-gray-50">
            <button 
              @click="saveAndClose"
              class="w-full bg-emerald-600 text-white py-4 rounded-2xl font-bold text-lg transition-all active:scale-[0.98]"
            >
              {{ t.salva }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { reactive, onMounted } from 'vue';
import { useSelfOrderI18n } from '../../composables/useSelfOrderI18n.js';
import { X, CheckCircle, Circle, AlertTriangle } from 'lucide-vue-next';

const props = defineProps({
  modelValue: Boolean
});
const emit = defineEmits(['update:modelValue']);


const allergenLabels = {
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
};

const i18n = {
  it: {
    preferenze: 'Preferenze Alimentari',
    diete: 'Diete e Scelte',
    vegano: 'Vegano',
    vegetariano: 'Vegetariano',
    allergeni: 'Allergeni',
    salva: 'Salva Preferenze'
  },
  en: {
    preferenze: 'Food Preferences',
    diete: 'Diet & Choices',
    vegano: 'Vegan',
    vegetariano: 'Vegetarian',
    allergeni: 'Allergens',
    salva: 'Save Preferences'
  }
};

const { t, currentLang } = useSelfOrderI18n(i18n);

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

function loadPreferences() {
  const saved = localStorage.getItem('selforder_preferences');
  if (saved) {
    try {
      const prefs = JSON.parse(saved);
      Object.assign(diet, prefs.diet || {});
      Object.assign(allergens, prefs.allergens || {});
    } catch {
      // ignore
    }
  }
}

function savePreferences() {
  localStorage.setItem('selforder_preferences', JSON.stringify({ diet, allergens }));
}

function saveAndClose() {
  savePreferences();
  emit('update:modelValue', false);
}

onMounted(() => {
  loadPreferences();
});
</script>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: all 0.3s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from > div:last-child,
.modal-leave-to > div:last-child {
  transform: translateY(100%);
}
</style>
