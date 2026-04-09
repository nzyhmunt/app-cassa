<template>
  <!-- Backdrop -->
  <Transition name="kb-fade">
    <div
      v-if="keyboard.isVisible.value"
      class="fixed inset-0 z-[150] bg-black/50 backdrop-blur-sm"
      @click="keyboard.closeKeyboard()"
    />
  </Transition>

  <!-- Keyboard panel -->
  <Transition name="kb-slide">
    <div
      v-if="keyboard.isVisible.value"
      :class="panelClass"
      @click.stop
    >
      <!-- Drag handle -->
      <div class="flex justify-center pt-3 pb-1 landscape:pt-1.5 landscape:pb-0.5">
        <div class="w-10 h-1 bg-gray-300 rounded-full"></div>
      </div>

      <!-- Header -->
      <div class="bg-gray-50 border-b border-gray-200 px-4 py-3 landscape:py-1.5 flex justify-between items-center">
        <h3 class="font-bold text-sm text-gray-800 uppercase tracking-wider">Inserisci valore</h3>
        <button
          @click="keyboard.closeKeyboard()"
          class="text-gray-500 hover:text-gray-800 bg-gray-200 hover:bg-gray-300 rounded-full p-1.5 transition-colors active:scale-95"
          aria-label="Chiudi tastiera"
        >
          <X class="size-4" />
        </button>
      </div>

      <!-- Display area -->
      <div class="px-4 pt-3 pb-2 landscape:pt-1.5 landscape:pb-1">
        <div class="flex items-center bg-gray-50 border-2 border-[var(--brand-primary)] rounded-2xl px-4 py-3 landscape:py-2 gap-3 min-h-[60px] landscape:min-h-[44px]">
          <!-- Type toggle (e.g. % / €) — replaces prefix when present -->
          <div
            v-if="keyboard.typeToggle.value"
            class="flex rounded-xl overflow-hidden border border-gray-200 shrink-0"
          >
            <button
              v-for="(label, i) in keyboard.typeToggle.value.labels"
              :key="i"
              @click="keyboard.setTypeToggle(i)"
              class="px-2.5 py-1.5 text-xs font-bold transition-colors active:scale-95"
              :class="keyboard.typeToggle.value.activeIndex === i
                ? 'theme-bg text-white'
                : 'bg-white text-gray-500 hover:bg-gray-100'"
            >{{ label }}</button>
          </div>
          <!-- Static prefix (shown when no toggle) -->
          <span v-else-if="keyboard.prefix.value" class="text-gray-500 font-bold text-xl shrink-0">{{ keyboard.prefix.value }}</span>
          <span class="flex-1 text-4xl landscape:text-2xl font-black text-gray-900 tracking-wider text-right tabular-nums leading-none">
            {{ keyboard.displayValue.value || '0' }}
          </span>
        </div>
      </div>

      <!-- Button grid -->
      <div class="grid grid-cols-3 gap-2.5 landscape:gap-1.5 px-4 pb-2 landscape:pb-1">
        <button
          v-for="key in keyRows"
          :key="key.label"
          @click="key.action()"
          class="py-4 landscape:py-2 rounded-2xl font-bold text-xl landscape:text-base transition-all active:scale-95 select-none"
          :class="key.style"
          :aria-label="key.ariaLabel || key.label"
        >
          <component v-if="key.icon" :is="key.icon" class="size-5 mx-auto" />
          <span v-else>{{ key.label }}</span>
        </button>
      </div>

      <!-- Confirm + AC row -->
      <div class="grid grid-cols-3 gap-2.5 landscape:gap-1.5 px-4 pb-8 landscape:pb-3">
        <button
          @click="keyboard.clear()"
          class="py-4 landscape:py-2 rounded-2xl font-bold text-xl landscape:text-base bg-orange-50 hover:bg-orange-100 text-orange-500 border border-orange-200 shadow-sm transition-all active:scale-95"
          aria-label="Cancella tutto"
        >AC</button>
        <button
          @click="keyboard.confirm()"
          class="col-span-2 py-4 landscape:py-2 theme-bg text-white font-bold text-xl landscape:text-base rounded-2xl shadow-md hover:opacity-90 transition-opacity active:scale-95 flex items-center justify-center gap-2"
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
import { X, Delete, Check } from 'lucide-vue-next';
import { useNumericKeyboard } from '../composables/useNumericKeyboard.js';
import { useAppStore } from '../store/index.js';

const keyboard = useNumericKeyboard();
const store = useAppStore();

/** CSS classes for the keyboard panel based on the chosen position setting. */
const panelClass = computed(() => {
  const base = 'max-h-[100dvh] overflow-y-auto';
  const pos = store.customKeyboard;
  if (pos === 'left')  return `fixed bottom-0 left-0 z-[151] bg-white rounded-tr-3xl shadow-2xl select-none w-full max-w-sm ${base}`;
  if (pos === 'right') return `fixed bottom-0 right-0 z-[151] bg-white rounded-tl-3xl shadow-2xl select-none w-full max-w-sm ${base}`;
  // 'center' or fallback
  return `fixed bottom-0 left-0 right-0 z-[151] bg-white rounded-t-3xl shadow-2xl select-none mx-auto max-w-sm w-full ${base}`;
});

const keyRows = computed(() => [
  { label: '7', style: 'bg-white shadow-sm hover:bg-gray-50 text-gray-800 border border-gray-200', action: () => keyboard.appendDigit('7') },
  { label: '8', style: 'bg-white shadow-sm hover:bg-gray-50 text-gray-800 border border-gray-200', action: () => keyboard.appendDigit('8') },
  { label: '9', style: 'bg-white shadow-sm hover:bg-gray-50 text-gray-800 border border-gray-200', action: () => keyboard.appendDigit('9') },
  { label: '4', style: 'bg-white shadow-sm hover:bg-gray-50 text-gray-800 border border-gray-200', action: () => keyboard.appendDigit('4') },
  { label: '5', style: 'bg-white shadow-sm hover:bg-gray-50 text-gray-800 border border-gray-200', action: () => keyboard.appendDigit('5') },
  { label: '6', style: 'bg-white shadow-sm hover:bg-gray-50 text-gray-800 border border-gray-200', action: () => keyboard.appendDigit('6') },
  { label: '1', style: 'bg-white shadow-sm hover:bg-gray-50 text-gray-800 border border-gray-200', action: () => keyboard.appendDigit('1') },
  { label: '2', style: 'bg-white shadow-sm hover:bg-gray-50 text-gray-800 border border-gray-200', action: () => keyboard.appendDigit('2') },
  { label: '3', style: 'bg-white shadow-sm hover:bg-gray-50 text-gray-800 border border-gray-200', action: () => keyboard.appendDigit('3') },
  { label: '⌫', icon: Delete, ariaLabel: 'Cancella cifra', style: 'bg-red-50 shadow-sm hover:bg-red-100 text-red-500 border border-red-200', action: () => keyboard.backspace() },
  { label: '0', style: 'bg-white shadow-sm hover:bg-gray-50 text-gray-800 border border-gray-200', action: () => keyboard.appendDigit('0') },
  { label: '.', style: 'bg-white shadow-sm hover:bg-gray-50 text-gray-500 border border-gray-200 text-2xl', action: () => keyboard.appendDigit('.') },
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
