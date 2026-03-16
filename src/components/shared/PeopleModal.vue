<template>
  <!-- ================================================================ -->
  <!-- SHARED: PEOPLE COUNT MODAL                                        -->
  <!-- Displayed when opening a free table to set the number of diners. -->
  <!-- Used by both SalaTableManager (Sala) and TableManager (Cassa).  -->
  <!-- Props: show, table, showChildrenInput, adults, children          -->
  <!-- Emits: cancel, confirm, update:adults, update:children           -->
  <!-- ================================================================ -->
  <div v-if="show && table" class="fixed inset-0 z-[110] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 max-h-[92dvh] overflow-y-auto">

      <!-- Header -->
      <div class="flex justify-between items-center mb-5">
        <h3 class="font-bold text-gray-800 text-base flex items-center gap-2">
          <Users class="size-5 theme-text" /> Apri Tavolo {{ table.label }}
        </h3>
        <button
          @click="$emit('cancel')"
          class="text-gray-400 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-full p-1.5 transition-colors active:scale-95"
          aria-label="Annulla"
        >
          <X class="size-4" />
        </button>
      </div>

      <!-- Adults / generic people counter -->
      <div class="mb-5">
        <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">
          {{ showChildrenInput ? 'Adulti' : 'Persone' }}
        </label>
        <div class="flex items-center gap-4">
          <button
            @click="$emit('update:adults', Math.max(1, adults - 1))"
            class="size-12 bg-gray-100 hover:bg-gray-200 rounded-xl flex items-center justify-center font-black text-gray-700 active:scale-95 transition-all"
          >
            <Minus class="size-5" />
          </button>
          <span class="text-4xl font-black text-gray-900 w-12 text-center">{{ adults }}</span>
          <button
            @click="$emit('update:adults', adults + 1)"
            class="size-12 bg-gray-100 hover:bg-gray-200 rounded-xl flex items-center justify-center font-black text-gray-700 active:scale-95 transition-all"
          >
            <Plus class="size-5" />
          </button>
        </div>
      </div>

      <!-- Children counter (only when children cover charge is enabled and non-zero price) -->
      <div v-if="showChildrenInput" class="mb-5">
        <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Bambini</label>
        <div class="flex items-center gap-4">
          <button
            @click="$emit('update:children', Math.max(0, children - 1))"
            class="size-12 bg-gray-100 hover:bg-gray-200 rounded-xl flex items-center justify-center font-black text-gray-700 active:scale-95 transition-all"
          >
            <Minus class="size-5" />
          </button>
          <span class="text-4xl font-black text-gray-900 w-12 text-center">{{ children }}</span>
          <button
            @click="$emit('update:children', children + 1)"
            class="size-12 bg-gray-100 hover:bg-gray-200 rounded-xl flex items-center justify-center font-black text-gray-700 active:scale-95 transition-all"
          >
            <Plus class="size-5" />
          </button>
        </div>
      </div>

      <!-- Cover charge preview (shown only when coverCharge is enabled and autoAdd is on) -->
      <div
        v-if="coverCharge?.enabled && coverCharge?.autoAdd && (adults > 0 || children > 0)"
        class="mb-5 bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-700"
      >
        <p class="font-bold mb-1.5 flex items-center gap-1">
          <Receipt class="size-3.5" /> Coperto automatico:
        </p>
        <div v-if="adults > 0 && coverCharge.priceAdult > 0">
          {{ adults }} adult{{ adults === 1 ? 'o' : 'i' }} × {{ currency }}{{ coverCharge.priceAdult.toFixed(2) }}
          = <strong>{{ currency }}{{ (adults * coverCharge.priceAdult).toFixed(2) }}</strong>
        </div>
        <div v-if="children > 0 && coverCharge.priceChild > 0">
          {{ children }} bambin{{ children === 1 ? 'o' : 'i' }} × {{ currency }}{{ coverCharge.priceChild.toFixed(2) }}
          = <strong>{{ currency }}{{ (children * coverCharge.priceChild).toFixed(2) }}</strong>
        </div>
      </div>

      <!-- Confirm button -->
      <button
        @click="$emit('confirm')"
        class="w-full py-3.5 theme-bg text-white font-bold rounded-xl active:scale-95 transition-all shadow-md flex items-center justify-center gap-2 text-sm md:text-base"
      >
        <Users class="size-5" /> Apri Tavolo
      </button>

    </div>
  </div>
</template>

<script setup>
import { Users, X, Plus, Minus, Receipt } from 'lucide-vue-next';
import { useAppStore } from '../../store/index.js';
import { computed } from 'vue';

/**
 * Shared people-count modal for opening a table.
 *
 * Used by both SalaTableManager (app Sala) and TableManager (app Cassa)
 * so that any UI/UX change is reflected in both applications automatically.
 */
const props = defineProps({
  /** Whether the modal is visible. */
  show: { type: Boolean, required: true },
  /** The table object being opened ({ id, label, covers, ... }). */
  table: { type: Object, default: null },
  /** Show a separate "Bambini" counter only when children cover charge is active. */
  showChildrenInput: { type: Boolean, default: false },
  /** Current adult/person count (v-model:adults). */
  adults: { type: Number, default: 2 },
  /** Current children count (v-model:children). */
  children: { type: Number, default: 0 },
});

defineEmits(['cancel', 'confirm', 'update:adults', 'update:children']);

const store = useAppStore();

/** Cover charge configuration taken directly from the shared store. */
const coverCharge = computed(() => store.config.coverCharge);

/** Currency symbol from store configuration. */
const currency = computed(() => store.config.ui.currency);
</script>
