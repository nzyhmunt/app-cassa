<template>
  <!-- Clickable order card used in the sidebar list of CassaOrderManager and SalaOrderManager -->
  <div
    @click="$emit('click')"
    :class="[
      selected ? 'ring-2 ring-offset-2 theme-border bg-white' : 'border-gray-200 hover:border-gray-300 bg-white',
      order.status === 'delivered' ? 'opacity-60' : '',
    ]"
    class="p-3 md:p-4 rounded-2xl border shadow-sm cursor-pointer transition-all active:scale-[0.98]"
  >
    <div class="flex justify-between items-start mb-2">
      <div class="flex items-center gap-3">
        <div class="size-10 rounded-full flex items-center justify-center font-black text-sm md:text-base bg-gray-100 text-gray-800 border-2 border-gray-200 shrink-0">
          {{ order.table }}
        </div>
        <div>
          <h3 class="font-bold text-gray-800 text-sm md:text-base leading-tight">Tavolo {{ order.table }}</h3>
          <p class="text-[10px] text-gray-500 flex items-center gap-1 mt-0.5">
            <Clock class="size-3" /> {{ order.time }}
          </p>
        </div>
      </div>
      <div class="text-right">
        <span class="font-black text-base md:text-lg text-gray-800">{{ configStore.config.ui.currency }}{{ order.totalAmount.toFixed(2) }}</span>
      </div>
    </div>

    <div class="flex gap-2 flex-wrap mt-2 items-center">
      <OrderStatusBadge :status="order.status" />
      <span class="bg-gray-100 text-gray-600 text-[9px] md:text-[10px] font-bold px-2 py-1 rounded-md border border-gray-200 ml-auto">{{ order.itemCount }} pz</span>
    </div>

    <!-- Note indicator: shown only when there is a global note visible for the current app -->
    <div
      v-if="order.globalNote && order.noteVisibility?.[noteVisibilityKey] !== false"
      class="mt-2 flex items-start gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5"
      :title="order.globalNote"
    >
      <MessageSquareWarning class="size-3 text-amber-600 shrink-0 mt-px" />
      <p class="text-[10px] text-amber-700 font-medium leading-tight truncate">{{ order.globalNote }}</p>
    </div>
  </div>
</template>

<script setup>
import { Clock, MessageSquareWarning } from 'lucide-vue-next';
import { useConfigStore, useOrderStore } from '../../store/index.js';
import OrderStatusBadge from './OrderStatusBadge.vue';

defineProps({
  order: { type: Object, required: true },
  selected: { type: Boolean, default: false },
  /**
   * Which visibility flag to check on `order.noteVisibility` for the note indicator.
   * Use 'cassa' in CassaOrderManager and 'sala' in SalaOrderManager.
   * When null or omitted the note is always shown (no app filtering).
   */
  noteVisibilityKey: { type: String, default: null },
});

defineEmits(['click']);

const configStore = useConfigStore();
const orderStore = useOrderStore();
</script>
