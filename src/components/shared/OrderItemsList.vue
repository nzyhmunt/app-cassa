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
      <OrderItemsRows
        :order="order"
        show-edit-controls
        show-add-button
        @edit-item="$emit('edit-item', $event)"
        @add-items="$emit('add-items')"
      />
    </div>

  </div>
</template>

<script setup>
import { computed } from 'vue';
import { ShieldCheck, ShoppingCart, PlusCircle, MessageSquareWarning } from 'lucide-vue-next';
import { KITCHEN_ACTIVE_STATUSES } from '../../utils/index.js';
import OrderItemsRows from './OrderItemsRows.vue';

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

const isReadOnly = computed(() => KITCHEN_ACTIVE_STATUSES.includes(props.order.status));
</script>
