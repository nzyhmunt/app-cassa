<template>
  <!-- Course-grouped item rows — used inside OrderItemsList panel and CassaTableManager per-ordine cards -->
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
        {{ courseLabel(row.course) }}
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

            <!-- +/- controls (pending + showEditControls) -->
            <div v-if="order.status === 'pending' && showEditControls" class="flex items-center gap-1 bg-gray-100 rounded-md p-0.5 border border-gray-200 shrink-0">
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

            <!-- Read-only quantity -->
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
                  <span v-if="(mod.voidedQuantity || 0) > 0" class="text-[8px] text-red-500 font-bold ml-0.5">(-{{ mod.voidedQuantity }})</span>
                </span>
              </div>
            </div>
          </div>

          <!-- Price + edit / void controls -->
          <div class="flex items-center gap-2 md:gap-4 shrink-0">
            <div class="flex flex-col items-end">
              <span
                class="font-black text-sm md:text-base text-gray-800"
                :class="{ 'line-through text-gray-400': row.item.voidedQuantity === row.item.quantity }"
              >
                {{ configStore.config.ui.currency }}{{ getOrderItemRowTotal(row.item).toFixed(2) }}
              </span>
              <span v-if="order.status === 'pending' && showEditControls" class="text-[9px] text-gray-400">{{ configStore.config.ui.currency }}{{ getItemUnitPrice(row.item).toFixed(2) }} cad.</span>
            </div>

            <!-- Edit note button (pending + showEditControls) -->
            <div v-if="order.status === 'pending' && showEditControls" class="flex items-center gap-1 ml-1">
              <button
                @click="$emit('edit-item', row.index)"
                class="p-1.5 md:p-2 text-gray-500 hover:text-[var(--brand-primary)] bg-gray-50 border border-gray-200 hover:bg-gray-100 rounded-md transition-colors active:scale-95 shadow-sm"
                title="Note e Portata"
              >
                <PenLine class="size-3.5" />
              </button>
            </div>

            <!-- Void/restore buttons (accepted + showVoidControls) -->
            <div v-if="showVoidControls && order.status === 'accepted'" class="flex items-center gap-1 ml-1">
              <button
                @click="orderStore.voidOrderItems(order, row.index, 1)"
                :disabled="row.item.quantity - (row.item.voidedQuantity || 0) <= 0"
                class="p-1.5 bg-white border border-orange-200 text-orange-500 hover:bg-orange-50 rounded shadow-sm transition-colors active:scale-95 disabled:opacity-30"
                title="Storna dal conto"
              >
                <Ban class="size-3.5 md:size-4" />
              </button>
              <button
                @click="orderStore.restoreOrderItems(order, row.index, 1)"
                :disabled="(row.item.voidedQuantity || 0) <= 0"
                class="p-1.5 bg-white border border-blue-200 text-blue-500 hover:bg-blue-50 rounded shadow-sm transition-colors active:scale-95 disabled:opacity-30"
                title="Ripristina nel conto"
              >
                <Undo2 class="size-3.5 md:size-4" />
              </button>
            </div>
          </div>
        </div>

        <!-- Paid modifier void/restore rows (showVoidControls + accepted) -->
        <div
          v-if="showVoidControls && order.status === 'accepted' && row.item.modifiers && row.item.modifiers.some(m => m.price > 0)"
          class="mt-1 ml-10 space-y-0.5"
        >
          <template v-for="(mod, modIdx) in row.item.modifiers" :key="'mod_' + row.item.uid + '_' + modIdx">
            <div
              v-if="mod.price > 0"
              class="flex items-center justify-between py-1 pl-2 pr-1 rounded bg-purple-50/60 border border-purple-100"
              :class="modNetQty(row.item, mod) <= 0 ? 'opacity-40' : ''"
            >
              <div class="flex items-center gap-1.5 flex-1 min-w-0">
                <span
                  class="font-bold text-[9px] text-purple-500"
                  :class="modNetQty(row.item, mod) <= 0 ? 'line-through text-gray-400' : ''"
                >
                  {{ Math.max(0, modNetQty(row.item, mod)) }}x
                </span>
                <span
                  class="text-[9px] md:text-[10px] font-bold text-purple-700 truncate"
                  :class="{ 'line-through text-gray-400': modNetQty(row.item, mod) <= 0 }"
                >
                  + {{ mod.name }} (+{{ configStore.config.ui.currency }}{{ mod.price.toFixed(2) }})
                </span>
                <span v-if="(mod.voidedQuantity || 0) > 0" class="text-[8px] text-red-500 font-bold uppercase shrink-0">-{{ mod.voidedQuantity }}</span>
              </div>
              <div class="flex items-center gap-0.5 shrink-0">
                <button
                  @click="orderStore.voidModifier(order, row.index, modIdx, 1)"
                  :disabled="modNetQty(row.item, mod) <= 0"
                  class="p-1 bg-white border border-orange-200 text-orange-500 hover:bg-orange-50 rounded shadow-sm transition-colors active:scale-95 disabled:opacity-30"
                  title="Storna questa variazione"
                >
                  <Ban class="size-3" />
                </button>
                <button
                  @click="orderStore.restoreModifier(order, row.index, modIdx, 1)"
                  :disabled="(mod.voidedQuantity || 0) <= 0"
                  class="p-1 bg-white border border-blue-200 text-blue-500 hover:bg-blue-50 rounded shadow-sm transition-colors active:scale-95 disabled:opacity-30"
                  title="Ripristina questa variazione"
                >
                  <Undo2 class="size-3" />
                </button>
              </div>
            </div>
          </template>
        </div>
      </div>
    </template>

    <!-- Add items footer (pending + showAddButton) -->
    <div v-if="showAddButton && order.status === 'pending'" class="p-3 bg-gray-50 border-t border-gray-100">
      <button
        @click="$emit('add-items')"
        class="theme-btn-outline w-full py-3 md:py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95 text-xs md:text-sm"
      >
        <PlusCircle class="size-5" /> <span>Aggiungi Nuovi Piatti all'Ordine</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { Layers, Trash2, Minus, Plus, MessageSquareWarning, PenLine, Sparkles, PlusCircle, Ban, Undo2 } from 'lucide-vue-next';
import { useConfigStore, useOrderStore } from '../../store/index.js';
import {
  getOrderItemRowTotal,
  getCourseBorderClass,
  getCourseQtyClass,
  groupOrderItemsByCourse,
} from '../../utils/index.js';

const props = defineProps({
  /** The order object whose items are rendered */
  order: { type: Object, required: true },
  /**
   * Show +/- quantity and edit-note controls for pending orders.
   * Used by OrderItemsList (the full order-detail panel).
   */
  showEditControls: { type: Boolean, default: false },
  /**
   * Show void/restore controls for accepted orders.
   * Used by CassaTableManager per-ordine cards.
   */
  showVoidControls: { type: Boolean, default: false },
  /**
   * Show the "Aggiungi Nuovi Piatti" footer button for pending orders.
   * Used by OrderItemsList.
   */
  showAddButton: { type: Boolean, default: false },
});

defineEmits([
  /** Emitted with row.index when the user clicks the edit-note button on an item */
  'edit-item',
  /** Emitted when the user clicks the add-items / "Aggiungi Nuovi Piatti" button */
  'add-items',
]);

const configStore = useConfigStore();
const orderStore = useOrderStore();

const orderedItems = computed(() => groupOrderItemsByCourse(props.order.orderItems));

/** Label displayed in the course group header */
function courseLabel(course) {
  if (course === 'prima') return 'Esce Prima';
  if (course === 'dopo') return 'Esce Dopo';
  return 'Insieme';
}

/**
 * Net quantity for a modifier: item qty minus item voids minus modifier voids.
 * Used to determine disabled state and display for void/restore controls.
 */
function modNetQty(item, mod) {
  return item.quantity - (item.voidedQuantity || 0) - (mod.voidedQuantity || 0);
}

function getItemUnitPrice(item) {
  const modTotal = (item.modifiers || []).reduce((sum, mod) => sum + (mod.price || 0), 0);
  return item.unitPrice + modTotal;
}
</script>
