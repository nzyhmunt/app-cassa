<template>
  <!-- ============================================================ -->
  <!-- MODAL: INFO PIATTO                                           -->
  <!-- ============================================================ -->
  <div
    v-if="modelValue && item"
    class="fixed inset-0 z-[95] bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4"
  >
    <div class="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-md flex flex-col max-h-[92dvh] md:max-h-[85dvh] overflow-hidden">
      <!-- Header -->
      <div class="bg-gray-50 border-b border-gray-100 px-4 pt-4 pb-3 flex justify-between items-start shrink-0">
        <div>
          <h3 class="font-bold text-base md:text-lg text-gray-800 leading-tight">{{ item.name }}</h3>
          <span class="font-black theme-text text-sm mt-0.5 block">{{ configStore.config.ui.currency }}{{ item.price?.toFixed(2) }}</span>
        </div>
        <button
          @click="$emit('update:modelValue', false)"
          aria-label="Chiudi"
          class="text-gray-400 hover:text-gray-800 p-1.5 bg-gray-200 hover:bg-gray-300 rounded-full active:scale-95 transition-colors shrink-0 ml-3"
        >
          <X class="size-5" />
        </button>
      </div>
      <!-- Scrollable content -->
      <div class="overflow-y-auto flex-1 p-4 space-y-4">
        <!-- Foto -->
        <img
          v-if="item.immagine_url"
          :src="item.immagine_url"
          :alt="item.name"
          class="w-full h-44 object-cover rounded-xl shadow-sm"
        />
        <!-- Descrizione -->
        <div v-if="item.descrizione">
          <p class="text-sm text-gray-700 leading-relaxed">{{ item.descrizione }}</p>
        </div>
        <!-- Note (es. "Vegano") -->
        <div v-if="item.note" class="flex items-center gap-1.5">
          <span class="text-xs text-gray-500 italic bg-gray-100 px-2 py-0.5 rounded-full">{{ item.note }}</span>
        </div>
        <!-- Ingredienti -->
        <div v-if="item.ingredienti?.length">
          <h4 class="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Ingredienti</h4>
          <p class="text-sm text-gray-700">{{ item.ingredienti.join(', ') }}</p>
        </div>
        <!-- Allergeni -->
        <div v-if="item.allergeni?.length">
          <h4 class="text-[10px] font-bold text-amber-600 uppercase tracking-wider mb-1 flex items-center gap-1">
            <AlertOctagon class="size-3" /> Allergeni
          </h4>
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="a in item.allergeni"
              :key="a"
              class="px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-full text-xs font-medium capitalize"
            >{{ a }}</span>
          </div>
        </div>
        <!-- Testo HTML esteso (campo futuro) -->
        <div v-if="item.text" v-html="sanitizedInfoHtml" class="prose prose-sm text-gray-700 max-w-none text-sm" />
      </div>
      <!-- Footer actions -->
      <div class="p-4 pb-8 md:pb-4 bg-white border-t border-gray-100 shrink-0 flex gap-2">
        <button
          @click="$emit('add-quick')"
          class="py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl flex items-center justify-center gap-2 text-sm active:scale-[0.98] transition-all"
        >
          <Plus class="size-4" /> Rapido
        </button>
        <button
          @click="$emit('add-with-details')"
          class="flex-1 py-3 theme-bg text-white font-bold rounded-xl flex items-center justify-center gap-2 text-sm active:scale-[0.98] transition-all shadow-sm"
        >
          <PenLine class="size-4" /> Aggiungi con Dettagli
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import DOMPurify from 'dompurify';
import { X, AlertOctagon, Plus, PenLine } from 'lucide-vue-next';
import { useConfigStore, useOrderStore } from '../../store/index.js';

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  item: { type: Object, default: null },
});

defineEmits(['update:modelValue', 'add-quick', 'add-with-details']);

const configStore = useConfigStore();
const orderStore = useOrderStore();
const sanitizedInfoHtml = computed(() => DOMPurify.sanitize(props.item?.text ?? ''));
</script>
