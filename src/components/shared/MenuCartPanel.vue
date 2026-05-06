<script setup>
import { ref, computed } from 'vue';
import {
  ChevronRight, ShoppingCart, MousePointerClick,
  Trash2, Minus, Plus, CheckCircle,
  Info, PenLine, MessageSquareWarning, X, Sparkles,
} from 'lucide-vue-next';
import { getCourseBorderClass } from '../../utils/index.js';

/**
 * Reusable 3-column menu+cart panel used in both the comanda modal
 * (CassaOrderManager) and the direct-items "Dal Menu" tab (CassaTableManager).
 *
 * Layout:
 *   [categories sidebar] | [items grid] | [cart panel]
 *
 * The parent owns the cart array and handles all mutations via emits.
 */
const props = defineProps({
  /** Menu object: { [category]: MenuItem[] } */
  menu: { type: Object, required: true },
  /** Cart items array (managed by parent). */
  cart: { type: Array, required: true },
  /** { [dishId]: totalQty } — drives qty badges on item cards. */
  qtyMap: { type: Object, default: () => ({}) },
  /** Currency symbol, e.g. "€". */
  currency: { type: String, default: '€' },
  /** Label shown in the cart panel header. */
  cartTitle: { type: String, default: 'Carrello Preparazione' },
  /** Message shown in the empty cart state. */
  emptyCartMessage: { type: String, default: 'Tocca i piatti nel menu per prepararli qui, poi inseriscili.' },
  /** Label for the confirm button at the bottom of the cart. */
  confirmLabel: { type: String, default: 'Conferma' },
  /** Label prefix for the total row. */
  totalLabel: { type: String, default: 'Totale:' },
  /** Show the Info (ℹ) button on each item card. */
  showInfoButton: { type: Boolean, default: false },
  /** Show the PenLine (details) button on each item card. */
  showDetailsButton: { type: Boolean, default: false },
  /** Show the PenLine edit button on each cart item row. */
  showCartItemEdit: { type: Boolean, default: false },
});

const emit = defineEmits([
  /** User tapped the item title or the + button */
  'add-quick',
  /** User tapped the PenLine button on an item card */
  'add-with-details',
  /** User tapped the Info button on an item card */
  'show-info',
  /** Qty stepper in cart row: (idx, delta) */
  'update-qty',
  /** PenLine edit button in a cart row: (idx) */
  'edit-cart-item',
  /** X button on a modifier tag: (cartIdx, modIdx) */
  'remove-mod',
  /** Confirm / submit button at the bottom of the cart */
  'confirm',
]);

const activeCategory = ref(Object.keys(props.menu)[0] ?? '');

const cartTotal = computed(() =>
  props.cart.reduce((sum, item) => {
    const modTotal = (item.modifiers || []).reduce((a, m) => a + (Number(m.price) || 0), 0);
    return sum + (item.unitPrice + modTotal) * item.quantity;
  }, 0),
);
</script>

<template>
  <div class="flex flex-1 min-h-0 flex-col md:flex-row">

    <!-- ── Sidebar categorie ─────────────────────────────────────────── -->
    <div class="w-full md:w-[220px] border-b md:border-b-0 md:border-r border-gray-200 bg-gray-50 flex md:flex-col overflow-x-auto md:overflow-y-auto no-scrollbar shrink-0">
      <button
        v-for="(items, category) in menu"
        :key="'mcp_cat_' + category"
        @click="activeCategory = category"
        class="whitespace-nowrap md:whitespace-normal md:w-full text-center md:text-left px-4 md:px-5 py-3 md:py-4 border-b-4 md:border-b-0 md:border-l-4 border-transparent font-bold transition-colors md:flex md:justify-between md:items-center text-sm md:text-base"
        :class="activeCategory === category
          ? 'bg-white theme-text theme-border-b md:!border-b-transparent theme-border-l shadow-sm'
          : 'text-gray-600 hover:bg-gray-100'">
        {{ category }}
        <span v-if="activeCategory === category" class="opacity-50 hidden md:flex items-center">
          <ChevronRight class="size-4" />
        </span>
      </button>
    </div>

    <!-- ── Griglia piatti ────────────────────────────────────────────── -->
    <div class="flex-1 overflow-y-auto p-2 md:p-4 bg-gray-100 md:bg-white grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-3 content-start min-h-0">
      <div
        v-for="item in (menu[activeCategory] || [])"
        :key="'mcp_item_' + item.id"
        class="bg-white border border-gray-200 rounded-xl md:rounded-2xl shadow-sm hover:border-emerald-400 transition-all group flex flex-col h-full min-h-[100px] md:min-h-[120px] relative overflow-visible">

        <!-- Qty badge -->
        <span
          v-if="(qtyMap[item.id] || 0) > 0"
          class="absolute -top-2 -right-2 bg-emerald-500 text-white size-6 md:size-7 rounded-full flex items-center justify-center text-[10px] md:text-xs font-black border-2 border-white shadow-sm z-10">
          {{ qtyMap[item.id] }}
        </span>

        <!-- Title area — quick add on tap/click -->
        <button
          @click="emit('add-quick', item)"
          :aria-label="'Aggiungi ' + item.name + ' al carrello'"
          class="flex-1 flex items-start text-left p-3 md:p-4 pb-1 md:pb-2 w-full">
          <h4 class="font-bold text-gray-800 text-xs md:text-sm leading-tight group-hover:theme-text transition-colors line-clamp-3">{{ item.name }}</h4>
        </button>

        <!-- Bottom row: price + action buttons -->
        <div class="px-3 md:px-4 pb-3 md:pb-4 flex items-center justify-between gap-1">
          <span class="font-black theme-text text-xs md:text-sm bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 shrink-0">{{ currency }}{{ item.price.toFixed(2) }}</span>
          <div class="flex items-center gap-0.5 shrink-0">
            <button
              v-if="showInfoButton"
              @click="emit('show-info', item)"
              :aria-label="'Informazioni su ' + item.name"
              class="size-6 md:size-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-teal-600 hover:bg-teal-50 transition-colors active:scale-95"
              title="Dettagli piatto">
              <Info class="size-3 md:size-3.5" />
            </button>
            <button
              v-if="showDetailsButton"
              @click="emit('add-with-details', item)"
              :aria-label="'Aggiungi ' + item.name + ' con dettagli'"
              class="size-6 md:size-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-purple-600 hover:bg-purple-50 transition-colors active:scale-95"
              title="Aggiungi con portata, note e varianti">
              <PenLine class="size-3 md:size-3.5" />
            </button>
            <button
              @click="emit('add-quick', item)"
              :aria-label="'Aggiungi ' + item.name + ' al carrello'"
              class="size-7 md:size-8 flex items-center justify-center rounded-lg theme-bg text-white shadow-sm hover:opacity-90 active:scale-95 transition-all"
              :class="showInfoButton || showDetailsButton ? 'ml-0.5' : ''"
              title="Aggiungi al carrello">
              <Plus class="size-3.5 md:size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Pannello carrello ──────────────────────────────────────────── -->
    <div class="w-full md:w-[320px] bg-gray-50 border-t md:border-t-0 md:border-l border-gray-200 flex flex-col shrink-0 h-[40vh] max-h-[40vh] md:max-h-none md:h-auto min-h-0">

      <!-- Cart header -->
      <div class="p-3 bg-gray-100 border-b border-gray-200 font-bold text-gray-700 text-xs uppercase tracking-wider flex items-center gap-2 shrink-0 shadow-sm z-10">
        <ShoppingCart class="size-4" /> {{ cartTitle }}
      </div>

      <!-- Cart items -->
      <div class="flex-1 overflow-y-auto min-h-0 p-3 space-y-2">
        <div v-if="cart.length === 0" class="text-center text-gray-400 py-8 flex flex-col items-center">
          <MousePointerClick class="size-8 opacity-30 mb-2" />
          <p class="text-xs font-medium">{{ emptyCartMessage }}</p>
        </div>

        <div
          v-for="(cartItem, idx) in cart"
          :key="cartItem.uid"
          class="bg-white rounded-lg shadow-sm overflow-hidden border-l-4"
          :class="getCourseBorderClass(cartItem.course)">

          <div class="p-2.5 flex items-start justify-between">
            <div class="flex flex-col flex-1 min-w-0 pr-2">
              <span class="font-bold text-sm text-gray-800 truncate">{{ cartItem.name }}</span>
              <span class="text-[10px] text-gray-500">
                {{ currency }}{{ (cartItem.unitPrice + (cartItem.modifiers || []).reduce((a, m) => a + (Number(m.price) || 0), 0)).toFixed(2) }} cad.
              </span>
              <div
                v-if="cartItem.notes && cartItem.notes.length > 0"
                class="text-[9px] text-amber-600 font-bold italic mt-0.5 truncate flex items-center gap-1">
                <MessageSquareWarning class="size-3 shrink-0" /> {{ cartItem.notes.join(', ') }}
              </div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <!-- Qty stepper -->
              <div class="flex items-center gap-1 bg-gray-100 rounded p-0.5 border border-gray-200">
                <button
                  @click="emit('update-qty', idx, -1)"
                  class="size-6 flex items-center justify-center bg-white rounded shadow-sm active:scale-95 transition-colors"
                  :class="cartItem.quantity === 1 ? 'text-red-500' : 'text-gray-600'"
                  :title="cartItem.quantity === 1 ? 'Rimuovi voce' : 'Diminuisci quantità'">
                  <Trash2 v-if="cartItem.quantity === 1" class="size-3" />
                  <Minus v-else class="size-3" />
                </button>
                <span class="w-5 text-center font-black text-sm">{{ cartItem.quantity }}</span>
                <button
                  @click="emit('update-qty', idx, 1)"
                  class="size-6 flex items-center justify-center bg-white theme-text rounded shadow-sm active:scale-95">
                  <Plus class="size-3" />
                </button>
              </div>
              <!-- Edit notes / variants (comanda only) -->
              <button
                v-if="showCartItemEdit"
                @click="emit('edit-cart-item', idx)"
                class="p-1.5 text-gray-500 hover:text-[var(--brand-primary)] bg-gray-50 border border-gray-200 hover:bg-gray-100 rounded-md transition-colors active:scale-95 shadow-sm"
                title="Note e Varianti">
                <PenLine class="size-3.5" />
              </button>
            </div>
          </div>

          <!-- Modifier tags -->
          <div v-if="cartItem.modifiers && cartItem.modifiers.length > 0" class="px-2.5 pb-2">
            <div class="flex flex-wrap gap-1">
              <span
                v-for="(mod, mi) in cartItem.modifiers"
                :key="mi"
                class="text-[9px] font-bold bg-purple-50 border border-purple-200 text-purple-700 px-1.5 py-0.5 rounded flex items-center gap-1">
                <Sparkles class="size-2.5" />
                {{ mod.name }}{{ mod.price > 0 ? ' +' + currency + mod.price.toFixed(2) : '' }}
                <button
                  @click="emit('remove-mod', idx, mi)"
                  class="text-purple-400 hover:text-red-500 transition-colors">
                  <X class="size-2.5" />
                </button>
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Cart footer -->
      <div class="p-3 md:p-4 bg-white border-t border-gray-200 shrink-0 pb-8 md:pb-4 shadow-[0_-5px_15px_rgba(0,0,0,0.05)] z-10">
        <div class="flex justify-between items-center mb-3">
          <span class="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{{ totalLabel }}</span>
          <span class="font-black text-lg text-gray-900">{{ currency }}{{ cartTotal.toFixed(2) }}</span>
        </div>
        <button
          @click="emit('confirm')"
          :disabled="cart.length === 0"
          class="w-full theme-bg text-white py-3 md:py-4 rounded-xl font-bold shadow-md hover:opacity-90 transition-opacity active:scale-95 text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
          <CheckCircle class="size-5" /> <span>{{ confirmLabel }}</span>
        </button>
      </div>
    </div>

  </div>
</template>
