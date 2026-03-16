<template>
  <!-- ============================================================ -->
  <!-- MODAL: NOTA ORDINE                                           -->
  <!-- ============================================================ -->
  <div
    v-if="modelValue && order"
    class="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4"
  >
    <div class="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[92dvh] md:max-h-[85dvh]">
      <div class="bg-gray-50 border-b border-gray-100 p-4 flex justify-between items-center shrink-0">
        <h3 class="font-bold text-base md:text-lg flex items-center gap-2">
          <MessageSquareWarning class="text-gray-500 size-4 md:size-5" /> Nota Ordine
        </h3>
        <button
          @click="$emit('update:modelValue', false)"
          aria-label="Chiudi"
          class="text-gray-400 hover:text-gray-800 p-1.5 bg-gray-200 hover:bg-gray-300 rounded-full active:scale-95 transition-colors"
        ><X class="size-5" /></button>
      </div>

      <div class="overflow-y-auto flex-1 p-4 md:p-5 space-y-4">
        <textarea
          v-model="order.globalNote"
          rows="5"
          placeholder="Aggiungi una nota per tutto l'ordine..."
          class="w-full bg-gray-100 border border-gray-200 rounded-xl px-3 py-2.5 focus:bg-white theme-ring transition-all text-gray-800 text-sm resize-none font-medium"
        ></textarea>

        <div>
          <p class="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <CheckCircle2 class="size-3.5" /> Visibile in:
          </p>
          <div class="flex gap-2">
            <button
              @click="order.noteVisibility.cassa = !order.noteVisibility.cassa"
              :aria-pressed="order.noteVisibility.cassa"
              :class="order.noteVisibility.cassa ? 'bg-[var(--brand-primary)]/10 text-[var(--brand-primary)] border-[var(--brand-primary)]/30 font-bold' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-100'"
              class="flex-1 py-2.5 px-2 rounded-xl border transition-all flex items-center justify-center gap-1 text-xs active:scale-95 shadow-sm"
            >
              <CheckCircle2 v-if="order.noteVisibility.cassa" class="size-3 shrink-0" aria-hidden="true" />
              Cassa
            </button>
            <button
              @click="order.noteVisibility.sala = !order.noteVisibility.sala"
              :aria-pressed="order.noteVisibility.sala"
              :class="order.noteVisibility.sala ? 'bg-[var(--brand-primary)]/10 text-[var(--brand-primary)] border-[var(--brand-primary)]/30 font-bold' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-100'"
              class="flex-1 py-2.5 px-2 rounded-xl border transition-all flex items-center justify-center gap-1 text-xs active:scale-95 shadow-sm"
            >
              <CheckCircle2 v-if="order.noteVisibility.sala" class="size-3 shrink-0" aria-hidden="true" />
              Sala
            </button>
            <button
              @click="order.noteVisibility.cucina = !order.noteVisibility.cucina"
              :aria-pressed="order.noteVisibility.cucina"
              :class="order.noteVisibility.cucina ? 'bg-[var(--brand-primary)]/10 text-[var(--brand-primary)] border-[var(--brand-primary)]/30 font-bold' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-100'"
              class="flex-1 py-2.5 px-2 rounded-xl border transition-all flex items-center justify-center gap-1 text-xs active:scale-95 shadow-sm"
            >
              <CheckCircle2 v-if="order.noteVisibility.cucina" class="size-3 shrink-0" aria-hidden="true" />
              Cucina
            </button>
          </div>
        </div>
      </div>

      <div class="p-3 md:p-4 bg-gray-50 pb-8 md:pb-4 border-t border-gray-200 shrink-0">
        <button
          @click="$emit('update:modelValue', false)"
          class="w-full theme-bg text-white py-3 md:py-3.5 rounded-xl font-bold shadow-md hover:opacity-90 transition-opacity active:scale-95 text-sm md:text-base"
        >Salva Nota</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { MessageSquareWarning, X, CheckCircle2 } from 'lucide-vue-next';

defineProps({
  modelValue: { type: Boolean, required: true },
  order: { type: Object, default: null },
});

defineEmits(['update:modelValue']);
</script>
