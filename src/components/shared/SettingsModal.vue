<template>
  <!-- MODAL: IMPOSTAZIONI -->
  <div v-if="modelValue" class="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4">
    <div class="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
      <div class="bg-gray-50 border-b border-gray-200 p-4 md:p-5 flex justify-between items-center">
        <h3 class="font-bold text-base md:text-lg flex items-center gap-2 text-gray-800">
          <Settings class="text-gray-500 size-4 md:size-5" /> {{ title }}
        </h3>
        <button @click="$emit('update:modelValue', false)" class="text-gray-400 hover:text-gray-800 bg-gray-200 hover:bg-gray-300 rounded-full p-1.5 transition-colors active:scale-95">
          <X class="size-5" />
        </button>
      </div>
      <div class="p-4 md:p-6 space-y-3 bg-white pb-8 md:pb-6">
        <div @click="settings.sounds = !settings.sounds"
          class="flex items-center justify-between p-3 md:p-4 border border-gray-200 rounded-2xl cursor-pointer hover:bg-gray-50 transition-colors active:scale-95">
          <div>
            <span class="font-bold text-gray-800 block text-sm">Avvisi Audio "Ding"</span>
            <span class="text-[10px] text-gray-500">Suona all'arrivo di nuovi ordini</span>
          </div>
          <button type="button" role="switch" :aria-checked="settings.sounds"
            :aria-label="'Avvisi Audio: ' + (settings.sounds ? 'attivo' : 'disattivato')"
            @click.stop="settings.sounds = !settings.sounds"
            class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2"
            :class="settings.sounds ? 'bg-[var(--brand-primary)]' : 'bg-gray-300'">
            <span class="inline-block size-5 transform rounded-full bg-white shadow-md transition-transform"
              :class="settings.sounds ? 'translate-x-5' : 'translate-x-0.5'"></span>
          </button>
        </div>

        <div @click="wakeLockApiSupported && (settings.preventScreenLock = !settings.preventScreenLock)"
          class="flex items-center justify-between p-3 md:p-4 border border-gray-200 rounded-2xl transition-colors"
          :class="wakeLockApiSupported ? 'cursor-pointer hover:bg-gray-50 active:scale-95' : 'opacity-50 cursor-not-allowed'">
          <div>
            <span class="font-bold text-gray-800 block text-sm">Schermo sempre acceso</span>
            <span v-if="wakeLockApiSupported" class="text-[10px] text-gray-500">Impedisce lo spegnimento automatico</span>
            <span v-else class="text-[10px] text-red-400">Non supportato dal browser</span>
          </div>
          <button type="button" role="switch" :aria-checked="settings.preventScreenLock"
            :aria-label="'Schermo sempre acceso: ' + (settings.preventScreenLock ? 'attivo' : 'disattivato')"
            :disabled="!wakeLockApiSupported"
            @click.stop="wakeLockApiSupported && (settings.preventScreenLock = !settings.preventScreenLock)"
            class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed"
            :class="settings.preventScreenLock ? 'bg-[var(--brand-primary)]' : 'bg-gray-300'">
            <span class="inline-block size-5 transform rounded-full bg-white shadow-md transition-transform"
              :class="settings.preventScreenLock ? 'translate-x-5' : 'translate-x-0.5'"></span>
          </button>
        </div>

        <div v-if="showKeyboardToggle" class="p-3 md:p-4 border border-gray-200 rounded-2xl space-y-2.5">
          <div>
            <span class="font-bold text-gray-800 block text-sm">Tastiera Numerica Personalizzata</span>
            <span class="text-[10px] text-gray-500">Posizione della tastiera a scomparsa</span>
          </div>
          <div class="flex gap-1 bg-gray-100 p-1 rounded-xl">
            <button
              v-for="opt in keyboardPositionOptions"
              :key="opt.value"
              @click="settings.customKeyboard = opt.value"
              class="flex-1 py-1.5 text-xs font-bold rounded-lg transition-all active:scale-95"
              :class="settings.customKeyboard === opt.value
                ? 'bg-[var(--brand-primary)] text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-700'"
              :aria-pressed="settings.customKeyboard === opt.value"
            >{{ opt.label }}</button>
          </div>
        </div>

        <div v-if="showMenuSync" class="pt-4 border-t border-gray-100 mt-2 space-y-3">
          <div>
            <label class="block text-xs font-bold text-gray-600 mb-1">URL Menu JSON</label>
            <input
              v-model="settings.menuUrl"
              type="url"
              placeholder="https://..."
              class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
            />
          </div>
          <button @click="syncMenu" :disabled="store.menuLoading" class="w-full py-4 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold rounded-2xl flex items-center justify-center gap-2 border border-gray-200 transition-colors shadow-sm active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed">
            <RefreshCw class="size-5" :class="store.menuLoading ? 'animate-spin text-emerald-600' : 'text-gray-600'" />
            <span>{{ store.menuLoading ? 'Sincronizzazione...' : 'Sincronizza Menu' }}</span>
          </button>
          <p v-if="store.menuError" class="text-xs text-red-600 text-center">Errore: {{ store.menuError }}</p>
        </div>

        <!-- Gestione Utenti -->
        <div class="pt-4 border-t border-gray-100 mt-2">
          <button @click="showUserManagement = true"
            class="w-full py-3 bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold rounded-2xl flex items-center justify-center gap-2 border border-gray-200 transition-colors shadow-sm active:scale-95">
            <Users class="size-4 text-gray-500" />
            Gestione Utenti &amp; Blocco Schermo
          </button>
        </div>

        <!-- Reset dati -->
        <div class="pt-4 border-t border-gray-100 mt-2">
          <template v-if="!resetConfirmPending">
            <button @click="resetConfirmPending = true"
              class="w-full py-3 bg-red-50 hover:bg-red-100 text-red-700 font-bold rounded-2xl flex items-center justify-center gap-2 border border-red-200 transition-colors shadow-sm active:scale-95">
              <RotateCcw class="size-4" />
              Ripristina dati di default
            </button>
          </template>
          <template v-else>
            <p class="text-xs text-red-700 font-semibold text-center mb-3">
              Tutti i dati (ordini, cassa, tavoli) e gli utenti saranno cancellati. Sei sicuro?
            </p>
            <div class="flex gap-2">
              <button @click="resetConfirmPending = false"
                class="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-2xl border border-gray-200 transition-colors active:scale-95">
                Annulla
              </button>
              <button @click="confirmReset"
                class="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-2xl border border-red-600 transition-colors active:scale-95">
                Sì, ripristina
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
  <UserManagementModal v-model="showUserManagement" />
</template>

<script setup>
import { ref } from 'vue';
import { Settings, X, RefreshCw, RotateCcw, Users } from 'lucide-vue-next';
import { useSettings } from '../../composables/useSettings.js';
import UserManagementModal from '../UserManagementModal.vue';

const props = defineProps({
  modelValue: Boolean,
  title: { type: String, required: true },
  showKeyboardToggle: { type: Boolean, default: false },
  showMenuSync: { type: Boolean, default: true },
});
const emit = defineEmits(['update:modelValue', 'settings-changed']);

const { store, settings, resetConfirmPending, syncMenu, confirmReset, wakeLockApiSupported } = useSettings(props, emit);

const showUserManagement = ref(false);

const keyboardPositionOptions = [
  { value: 'disabled', label: 'Off' },
  { value: 'center',   label: 'Centro' },
  { value: 'left',     label: 'Sinistra' },
  { value: 'right',    label: 'Destra' },
];
</script>
