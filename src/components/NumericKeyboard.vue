<template>
  <!-- Backdrop -->
  <Transition name="kb-fade">
    <div
      v-if="keyboard.isVisible.value"
      class="fixed inset-0 z-[80] bg-black/20"
      @click="keyboard.closeKeyboard()"
    />
  </Transition>

  <!-- Keyboard panel -->
  <Transition name="kb-slide">
    <div
      v-if="keyboard.isVisible.value"
      class="fixed bottom-0 left-0 right-0 z-[81] bg-white rounded-t-3xl shadow-2xl border-t border-gray-200 select-none"
      @click.stop
    >
      <!-- Display area -->
      <div class="px-4 pt-4 pb-2">
        <div class="flex items-center justify-between mb-3">
          <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Inserisci valore</span>
          <button
            @click="keyboard.closeKeyboard()"
            class="text-gray-400 hover:text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-full p-1.5 transition-colors active:scale-95"
            aria-label="Chiudi tastiera"
          >
            <X class="size-4" />
          </button>
        </div>
        <div class="flex items-center bg-gray-50 border-2 border-[var(--brand-primary)] rounded-2xl px-4 py-3 gap-2 min-h-[56px]">
          <span v-if="keyboard.prefix.value" class="text-gray-400 font-bold text-lg shrink-0">{{ keyboard.prefix.value }}</span>
          <span class="flex-1 text-3xl font-black text-gray-800 tracking-wider text-right tabular-nums leading-none">
            {{ keyboard.displayValue.value || '0' }}
          </span>
          <button
            v-if="keyboard.displayValue.value"
            @click="keyboard.clear()"
            class="text-gray-400 hover:text-red-500 transition-colors p-1 shrink-0"
            aria-label="Cancella tutto"
          >
            <XCircle class="size-5" />
          </button>
        </div>
      </div>

      <!-- Button grid -->
      <div class="grid grid-cols-3 gap-2 px-4 pb-2">
        <button
          v-for="key in keyRows"
          :key="key.label"
          @click="key.action()"
          class="py-3.5 rounded-xl font-bold text-xl transition-all active:scale-95 select-none"
          :class="key.style"
          :aria-label="key.ariaLabel || key.label"
        >
          <component v-if="key.icon" :is="key.icon" class="size-5 mx-auto" />
          <span v-else>{{ key.label }}</span>
        </button>
      </div>

      <!-- Confirm button -->
      <div class="px-4 pb-6">
        <button
          @click="keyboard.confirm()"
          class="w-full py-4 theme-bg text-white font-bold text-lg rounded-xl shadow-md hover:opacity-90 transition-opacity active:scale-95 flex items-center justify-center gap-2"
          aria-label="Conferma"
        >
          <Check class="size-5" />
          Conferma
        </button>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { computed } from 'vue';
import { X, XCircle, Delete, Check } from 'lucide-vue-next';
import { useNumericKeyboard } from '../composables/useNumericKeyboard.js';

const keyboard = useNumericKeyboard();

const keyRows = computed(() => [
  { label: '7', style: 'bg-gray-50 hover:bg-gray-100 text-gray-800 border border-gray-200', action: () => keyboard.appendDigit('7') },
  { label: '8', style: 'bg-gray-50 hover:bg-gray-100 text-gray-800 border border-gray-200', action: () => keyboard.appendDigit('8') },
  { label: '9', style: 'bg-gray-50 hover:bg-gray-100 text-gray-800 border border-gray-200', action: () => keyboard.appendDigit('9') },
  { label: '4', style: 'bg-gray-50 hover:bg-gray-100 text-gray-800 border border-gray-200', action: () => keyboard.appendDigit('4') },
  { label: '5', style: 'bg-gray-50 hover:bg-gray-100 text-gray-800 border border-gray-200', action: () => keyboard.appendDigit('5') },
  { label: '6', style: 'bg-gray-50 hover:bg-gray-100 text-gray-800 border border-gray-200', action: () => keyboard.appendDigit('6') },
  { label: '1', style: 'bg-gray-50 hover:bg-gray-100 text-gray-800 border border-gray-200', action: () => keyboard.appendDigit('1') },
  { label: '2', style: 'bg-gray-50 hover:bg-gray-100 text-gray-800 border border-gray-200', action: () => keyboard.appendDigit('2') },
  { label: '3', style: 'bg-gray-50 hover:bg-gray-100 text-gray-800 border border-gray-200', action: () => keyboard.appendDigit('3') },
  { label: '.', style: 'bg-gray-50 hover:bg-gray-100 text-gray-500 border border-gray-200 text-2xl', action: () => keyboard.appendDigit('.') },
  { label: '0', style: 'bg-gray-50 hover:bg-gray-100 text-gray-800 border border-gray-200', action: () => keyboard.appendDigit('0') },
  { label: '⌫', icon: Delete, ariaLabel: 'Cancella cifra', style: 'bg-red-50 hover:bg-red-100 text-red-500 border border-red-200', action: () => keyboard.backspace() },
]);
</script>

<style scoped>
.kb-fade-enter-active,
.kb-fade-leave-active {
  transition: opacity 0.2s ease;
}
.kb-fade-enter-from,
.kb-fade-leave-to {
  opacity: 0;
}

.kb-slide-enter-active,
.kb-slide-leave-active {
  transition: transform 0.25s ease;
}
.kb-slide-enter-from,
.kb-slide-leave-to {
  transform: translateY(100%);
}
</style>
