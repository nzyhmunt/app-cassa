<template>
  <!-- PWA Install Banner — slides up from the bottom of the screen -->
  <Transition
    enter-active-class="transition-transform duration-300 ease-out"
    enter-from-class="translate-y-full"
    enter-to-class="translate-y-0"
    leave-active-class="transition-transform duration-200 ease-in"
    leave-from-class="translate-y-0"
    leave-to-class="translate-y-full"
  >
    <div
      v-if="showBanner"
      class="fixed bottom-0 left-0 right-0 z-[100] bg-white border-t border-gray-200 shadow-lg px-4 py-3 flex items-start gap-3"
      role="region"
      aria-live="polite"
      aria-label="Installazione app"
    >
      <!-- App icon -->
      <div class="shrink-0 size-10 rounded-xl bg-[var(--brand-primary)] flex items-center justify-center">
        <Download class="size-5 text-white" />
      </div>

      <!-- Text -->
      <div class="flex-1 min-w-0">
        <p class="font-bold text-gray-800 text-sm leading-tight">Installa l'app</p>
        <p v-if="!isIOS" class="text-xs text-gray-500 mt-0.5">
          Aggiungi alla schermata home per l'accesso rapido e la modalità offline.
        </p>
        <p v-else class="text-xs text-gray-500 mt-0.5">
          Tocca
          <span class="inline-flex items-center gap-0.5 font-semibold text-gray-700">
            <Share2 class="size-3 inline-block" /> Condividi
          </span>
          in Safari, poi scegli <span class="font-semibold text-gray-700">"Aggiungi a Home"</span>.
        </p>
      </div>

      <!-- Actions -->
      <div class="flex gap-2 shrink-0 items-center self-center">
        <button
          v-if="!isIOS"
          @click="install"
          class="py-1.5 px-3 bg-[var(--brand-primary)] text-white text-sm font-bold rounded-xl active:scale-95 transition-transform"
        >
          Installa
        </button>
        <button
          @click="dismiss"
          class="py-1.5 px-2 text-gray-400 hover:text-gray-600 rounded-xl active:scale-95 transition-transform"
          aria-label="Chiudi notifica installazione"
        >
          <X class="size-5" />
        </button>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { Download, Share2, X } from 'lucide-vue-next';
import { usePwaInstall } from '../../composables/usePwaInstall.js';

const { showBanner, isIOS, install, dismiss } = usePwaInstall();
</script>
