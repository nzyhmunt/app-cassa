<template>
  <!-- MODAL: IMPOSTAZIONI SALA -->
  <div v-if="modelValue" class="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4">
    <div class="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
      <div class="bg-gray-50 border-b border-gray-200 p-4 md:p-5 flex justify-between items-center">
        <h3 class="font-bold text-base md:text-lg flex items-center gap-2 text-gray-800">
          <Settings class="text-gray-500 size-4 md:size-5" /> Impostazioni Sala
        </h3>
        <button @click="$emit('update:modelValue', false)" class="text-gray-400 hover:text-gray-800 bg-gray-200 hover:bg-gray-300 rounded-full p-1.5 transition-colors active:scale-95">
          <X class="size-5" />
        </button>
      </div>
      <div class="p-4 md:p-6 space-y-3 bg-white pb-8 md:pb-6">
        <!-- Avvisi audio per nuovi ordini -->
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

        <!-- Sincronizzazione menu -->
        <div class="pt-4 border-t border-gray-100 mt-2 space-y-3">
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

        <!-- Reset dati: sezione ripristino impostazioni di default -->
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
              Tutti i dati (ordini, cassa, tavoli) saranno cancellati. Sei sicuro?
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
</template>

<script setup>
import { ref, watch } from 'vue';
import { Settings, X, RefreshCw, RotateCcw } from 'lucide-vue-next';
import { useAppStore } from '../store/index.js';
import { getInstanceName, resolveStorageKeys, clearState } from '../store/persistence.js';

const props = defineProps({ modelValue: Boolean });
const emit = defineEmits(['update:modelValue', 'settings-changed']);

const store = useAppStore();

const _instanceName = getInstanceName();
const { storageKey: _storageKey, settingsKey: SETTINGS_STORAGE_KEY } = resolveStorageKeys(_instanceName);

function loadInitialSettings() {
  if (typeof window === 'undefined') {
    return { sounds: true, menuUrl: store.menuUrl };
  }
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return { sounds: true, menuUrl: store.menuUrl };
    }
    const parsed = JSON.parse(raw);
    return {
      sounds: typeof parsed.sounds === 'boolean' ? parsed.sounds : true,
      // store.menuUrl already incorporates query-param > app-settings > appConfig priority
      menuUrl: store.menuUrl,
    };
  } catch {
    return { sounds: true, menuUrl: store.menuUrl };
  }
}

const settings = ref(loadInitialSettings());
const resetConfirmPending = ref(false);

watch(
  () => props.modelValue,
  (newVal) => {
    if (!newVal) {
      resetConfirmPending.value = false;
    }
  }
);

watch(
  settings,
  (newVal) => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newVal));
      } catch {
        // Ignore storage errors (e.g., quota exceeded or disabled storage)
      }
    }
    store.menuUrl = newVal.menuUrl;
    emit('settings-changed', newVal);
  },
  { deep: true }
);

async function syncMenu() {
  await store.loadMenu();
}

function confirmReset() {
  clearState(_storageKey);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
      window.location.reload();
    } catch {
      // Ignore storage errors during reset
      window.location.reload();
    }
  }
}
</script>
