<template>
  <!-- Items list used in the order detail panel of CassaOrderManager and SalaOrderManager -->
  <div class="flex-1 overflow-y-auto bg-gray-100 p-2 md:p-4 min-h-0">

    <!-- Read-only notice when order is already in the kitchen -->
    <div
      v-if="readOnlyMessage && isReadOnly"
      class="mb-3 bg-teal-50 border border-teal-200 text-teal-800 p-3 rounded-xl text-[10px] md:text-xs font-bold flex items-center gap-2 shadow-sm"
    >
      <ShieldCheck class="size-4 md:size-5 shrink-0" />
      {{ readOnlyMessage }}
    </div>

    <!-- Global order note banner (visible according to noteVisibilityKey) -->
    <div
      v-if="order.globalNote && order.noteVisibility?.[noteVisibilityKey] !== false"
      class="mb-3 bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2 shadow-sm"
    >
      <MessageSquareWarning class="size-4 md:size-5 text-amber-600 shrink-0" />
      <div class="min-w-0 flex-1">
        <p class="text-[10px] md:text-xs font-bold text-amber-800 uppercase tracking-wider mb-0.5">Nota Ordine</p>
        <p class="text-xs md:text-sm text-amber-700 font-medium whitespace-pre-wrap">{{ order.globalNote }}</p>
      </div>
    </div>

    <!-- Empty order hint -->
    <div v-if="order.orderItems.length === 0" class="text-center py-10 text-gray-400">
      <ShoppingCart class="size-10 mx-auto mb-2 opacity-30" />
      <p class="text-sm font-medium">Nessun piatto aggiunto.</p>
      <button
        v-if="order.status === 'pending'"
        @click="$emit('add-items')"
        class="mt-3 inline-flex items-center gap-1.5 text-xs font-bold theme-text hover:underline"
      >
        <PlusCircle class="size-4" /> Aggiungi dal menù
      </button>
    </div>

    <!-- Items card -->
    <div v-else class="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div class="divide-y divide-gray-100">
        <template v-for="row in orderedItems" :key="row.type === 'header' ? 'header_' + row.course : row.item?.uid">

          <!-- Course group header -->
          <div
            v-if="row.type === 'header'"
            class="px-3 py-1.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest"
            :class="{
              'bg-orange-50 text-orange-700': row.course === 'prima',
              'bg-gray-50 text-gray-500': row.course === 'insieme',
              'bg-purple-50 text-purple-700': row.course === 'dopo',
            }"
          >
            <Layers class="size-3 shrink-0" />
            {{ row.course === 'prima' ? 'Esce Prima' : row.course === 'insieme' ? 'Insieme' : 'Esce Dopo' }}
          </div>

          <!-- Item row -->
          <div
            v-else
            class="border-l-4 p-2 md:p-3 hover:bg-gray-50 transition-colors"
            :class="[
              { 'bg-gray-50 opacity-60': row.item.voidedQuantity === row.item.quantity },
              getCourseBorderClass(row.item.course),
            ]"
          >
            <div class="flex items-center justify-between gap-2 md:gap-4">
              <div class="flex items-center gap-2 md:gap-3 flex-1 min-w-0">

                <!-- +/- controls (pending only) -->
                <div v-if="order.status === 'pending'" class="flex items-center gap-1 bg-gray-100 rounded-md p-0.5 border border-gray-200 shrink-0">
                  <button
                    @click="orderStore.updateQtyGlobal(order, row.index, -1)"
                    class="size-6 md:size-7 flex items-center justify-center bg-white rounded shadow-sm active:scale-95 transition-colors"
                    :class="row.item.quantity === 1 ? 'text-red-500' : 'text-gray-600'"
                    :title="row.item.quantity === 1 ? 'Rimuovi voce' : 'Diminuisci quantità'"
                  >
                    <Trash2 v-if="row.item.quantity === 1" class="size-3" />
                    <Minus v-else class="size-3" />
                  </button>
                  <span class="w-5 md:w-6 text-center font-black text-xs md:text-sm text-gray-800">{{ row.item.quantity }}</span>
                  <button @click="orderStore.updateQtyGlobal(order, row.index, 1)" class="size-6 md:size-7 flex items-center justify-center bg-white theme-text rounded shadow-sm active:scale-95">
                    <Plus class="size-3" />
                  </button>
                </div>

                <!-- Read-only quantity (in kitchen) -->
                <div v-else class="w-8 shrink-0 text-center font-black text-sm md:text-base" :class="getCourseQtyClass(row.item.course)">
                  {{ row.item.quantity - (row.item.voidedQuantity || 0) }}x
                </div>

                <!-- Item info -->
                <div class="flex flex-col min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span
                      class="font-bold text-sm md:text-base text-gray-800 leading-tight truncate"
                      :class="{ 'line-through': row.item.voidedQuantity === row.item.quantity }"
                    >{{ row.item.name }}</span>
                    <span v-if="(row.item.voidedQuantity || 0) > 0" class="text-[9px] text-red-500 font-bold uppercase tracking-widest border border-red-200 bg-red-50 px-1 rounded shrink-0">-{{ row.item.voidedQuantity }} Stornati</span>
                  </div>
                  <div v-if="row.item.notes && row.item.notes.length > 0" class="text-[10px] md:text-xs text-amber-600 font-bold italic mt-0.5 truncate flex items-center gap-1">
                    <MessageSquareWarning class="size-3 shrink-0" /> {{ row.item.notes.join(', ') }}
                  </div>
                  <div v-if="row.item.modifiers && row.item.modifiers.length > 0" class="mt-0.5 flex flex-wrap gap-1">
                    <span
                      v-for="(mod, mi) in row.item.modifiers"
                      :key="mi"
                      class="text-[9px] md:text-[10px] font-bold bg-purple-50 border border-purple-200 text-purple-700 px-1.5 py-0.5 rounded flex items-center gap-0.5"
                    >
                      <Sparkles class="size-2.5" />
                      {{ mod.name }}{{ mod.price > 0 ? ' +' + configStore.config.ui.currency + mod.price.toFixed(2) : '' }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- Price + edit-note button -->
              <div class="flex items-center gap-2 md:gap-4 shrink-0">
                <div class="flex flex-col items-end">
                  <span
                    class="font-black text-sm md:text-base text-gray-800"
                    :class="{ 'line-through text-gray-400': row.item.voidedQuantity === row.item.quantity }"
                  >
                    {{ configStore.config.ui.currency }}{{ getOrderItemRowTotal(row.item).toFixed(2) }}
                  </span>
                  <span v-if="order.status === 'pending'" class="text-[9px] text-gray-400">{{ configStore.config.ui.currency }}{{ getItemUnitPrice(row.item).toFixed(2) }} cad.</span>
                </div>
                <div v-if="order.status === 'pending'" class="flex items-center gap-1 ml-1">
                  <button
                    @click="$emit('edit-item', row.index)"
                    class="p-1.5 md:p-2 text-gray-500 hover:text-[var(--brand-primary)] bg-gray-50 border border-gray-200 hover:bg-gray-100 rounded-md transition-colors active:scale-95 shadow-sm"
                    title="Note e Portata"
                  >
                    <PenLine class="size-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- Quick-add button (pending only) -->
        <div v-if="order.status === 'pending'" class="p-3 bg-gray-50 border-t border-gray-100">
          <button
            @click="$emit('add-items')"
            class="theme-btn-outline w-full py-3 md:py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95 text-xs md:text-sm"
          >
            <PlusCircle class="size-5" /> <span>Aggiungi Nuovi Piatti all'Ordine</span>
          </button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { computed } from 'vue';
import { ShieldCheck, ShoppingCart, PlusCircle, Layers, Trash2, Minus, Plus, MessageSquareWarning, PenLine, Sparkles } from 'lucide-vue-next';
import { useConfigStore, useOrderStore } from '../../store/index.js';
import {
  getOrderItemRowTotal,
  getCourseBorderClass,
  getCourseQtyClass,
  groupOrderItemsByCourse,
  KITCHEN_ACTIVE_STATUSES,
} from '../../utils/index.js';

const props = defineProps({
  /** The currently selected order object */
  order: { type: Object, required: true },
  /**
   * Which visibility flag to check on `order.noteVisibility` for the note banner.
   * Use 'cassa' in CassaOrderManager and 'sala' in SalaOrderManager.
   */
  noteVisibilityKey: {
    type: String,
    default: 'sala',
    validator: (v) => ['cassa', 'sala', 'cucina'].includes(v),
  },
  /**
   * Text displayed in the teal read-only notice when the order is in the kitchen.
   * Pass null / empty string to hide the notice entirely.
   */
  readOnlyMessage: { type: String, default: null },
});

defineEmits([
  /** Emitted with row.index when the user clicks the edit-note button on an item */
  'edit-item',
  /** Emitted when the user clicks the add-items / "Aggiungi Nuovi Piatti" button */
  'add-items',
]);

const configStore = useConfigStore();
const orderStore = useOrderStore();

const isReadOnly = computed(() => KITCHEN_ACTIVE_STATUSES.includes(props.order.status));

const orderedItems = computed(() => groupOrderItemsByCourse(props.order.orderItems));

function getItemUnitPrice(item) {
  const modTotal = (item.modifiers || []).reduce((a, m) => a + (m.price || 0), 0);
  return item.unitPrice + modTotal;
}
</script>
