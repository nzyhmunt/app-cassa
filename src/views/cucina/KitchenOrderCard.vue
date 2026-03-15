<template>
  <!-- Order card for kitchen display system — styled to match Cassa/Sala order cards -->
  <div>
    <!-- Card header -->
    <div class="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
      <div class="flex items-center gap-3">
        <div class="size-10 rounded-xl flex items-center justify-center font-black text-base theme-bg text-white shrink-0">
          {{ order.table }}
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h3 class="font-bold text-gray-800 text-base leading-none">Tavolo {{ order.table }}</h3>
            <span :class="['text-[9px] uppercase font-bold px-2 py-0.5 rounded-md border', statusClass]">
              {{ statusLabel }}
            </span>
          </div>
          <p class="text-xs text-gray-500 mt-0.5">{{ order.time }} &middot; {{ order.itemCount }} piatt{{ order.itemCount === 1 ? 'o' : 'i' }}</p>
        </div>
      </div>
      <div class="text-right">
        <p class="text-[10px] text-gray-400">#{{ order.id.substring(4, 10) }}</p>
        <p :class="['font-black text-base', elapsedColor]">{{ elapsedLabel }}</p>
      </div>
    </div>

    <!-- Items grouped by course -->
    <div class="divide-y divide-gray-100">
      <template v-for="row in orderedItems" :key="row.type === 'header' ? 'h_' + row.course : row.item.uid">
        <!-- Course header -->
        <div v-if="row.type === 'header'"
          class="px-3 py-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest"
          :class="{
            'bg-orange-50 text-orange-700': row.course === 'prima',
            'bg-gray-50 text-gray-400': row.course === 'insieme',
            'bg-purple-50 text-purple-700': row.course === 'dopo',
          }"
        >
          <Layers class="size-3 shrink-0" />
          {{ row.course === 'prima' ? 'Esce Prima' : row.course === 'insieme' ? 'Insieme' : 'Esce Dopo' }}
        </div>
        <!-- Item row -->
        <div v-else
          class="px-3 py-2 flex items-center gap-3 border-l-4 transition-opacity"
          :class="[getCourseBorderClass(row.item.course), row.item.kitchenReady ? 'opacity-50' : '']"
        >
          <span :class="['shrink-0 font-black text-sm tabular-nums w-8 text-center', row.item.kitchenReady ? 'text-gray-400' : getCourseQtyClass(row.item.course)]">
            {{ row.item.quantity - (row.item.voidedQuantity || 0) }}×
          </span>
          <div class="flex-1 min-w-0">
            <p :class="['font-bold text-sm leading-tight', row.item.kitchenReady ? 'text-gray-400 line-through' : 'text-gray-800']">{{ row.item.name }}</p>
            <p v-if="row.item.notes && row.item.notes.length" :class="['text-xs mt-0.5 font-semibold', row.item.kitchenReady ? 'text-gray-400 line-through' : 'text-amber-600']">
              ✎ {{ row.item.notes.join(' · ') }}
            </p>
            <div v-for="(mod, mi) in activeModifiers(row.item)" :key="`${row.item.uid}_mod_${mi}`"
              :class="['text-[10px] font-bold px-1.5 py-0.5 rounded inline-flex items-center gap-0.5 mt-0.5 mr-1', row.item.kitchenReady ? 'bg-gray-100 border border-gray-200 text-gray-400 line-through' : 'bg-purple-50 border border-purple-200 text-purple-700']"
            >
              + {{ mod.name }}
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Dietary / allergy tags -->
    <div v-if="dietTags.length" class="flex flex-wrap gap-1.5 px-4 py-2 border-t border-gray-100">
      <span
        v-for="tag in dietTags"
        :key="tag"
        class="text-xs font-bold rounded-full px-2 py-0.5 bg-red-50 border border-red-200 text-red-700"
      >
        {{ tag }}
      </span>
    </div>

    <!-- Order note (visible when cucina flag is set) -->
    <div
      v-if="order.globalNote && order.noteVisibility?.cucina !== false"
      class="flex items-start gap-2 px-4 py-2.5 border-t border-gray-100"
    >
      <MessageSquareWarning class="size-3.5 text-amber-600 shrink-0 mt-0.5" />
      <div class="min-w-0">
        <p class="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-0.5">Nota Ordine</p>
        <p class="text-xs text-amber-700 font-semibold whitespace-pre-wrap">{{ order.globalNote }}</p>
      </div>
    </div>

    <!-- Action buttons: [← back icon] [main action (flex-1)] on the same row -->
    <div v-if="showAction || showSecondaryAction" class="px-4 pb-4 pt-2 flex items-center gap-2">
      <!-- Secondary: icon-only back button (less prominent, on the left) -->
      <button
        v-if="showSecondaryAction"
        @click="$emit('secondary-action')"
        :class="['shrink-0 rounded-xl font-semibold py-3 px-3 transition-all active:scale-95 focus:outline-none border', secondaryActionClass]"
        :aria-label="`${secondaryActionLabel} ordine tavolo ${order.table}`"
        :title="secondaryActionLabel"
      >
        <ChevronLeft class="size-4" aria-hidden="true" />
        <span class="sr-only">{{ secondaryActionLabel }}</span>
      </button>
      <!-- Primary: main action (takes remaining width) -->
      <button
        v-if="showAction"
        @click="$emit('action')"
        :class="['flex-1 rounded-xl font-bold text-sm py-3 transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 shadow-sm flex items-center justify-center gap-1.5', actionClass]"
        :aria-label="`${actionLabel} ordine tavolo ${order.table}`"
      >
        <component v-if="actionIcon" :is="actionIcon" class="size-4" aria-hidden="true" />
        {{ actionLabel }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { ChevronLeft, Layers, MessageSquareWarning } from 'lucide-vue-next';
import { getCourseBorderClass, getCourseQtyClass, groupOrderItemsByCourse } from '../../utils/index.js';

const props = defineProps({
  order: { type: Object, required: true },
  statusLabel: { type: String, required: true },
  statusClass: { type: String, default: '' },
  elapsedLabel: { type: String, required: true },
  elapsedColor: { type: String, default: 'text-gray-500' },
  actionLabel: { type: String, default: '' },
  actionClass: { type: String, default: '' },
  showAction: { type: Boolean, default: true },
  actionIcon: { type: [Object, Function], default: null },
  secondaryActionLabel: { type: String, default: '' },
  secondaryActionClass: { type: String, default: 'border-gray-300 text-gray-500 hover:bg-gray-50' },
  showSecondaryAction: { type: Boolean, default: false },
});

defineEmits(['action', 'secondary-action']);

// Group active (non-voided) items by course using shared utility
const orderedItems = computed(() => {
  const activeItems = props.order.orderItems.filter(
    item => (item.quantity - (item.voidedQuantity || 0)) > 0,
  );
  return groupOrderItemsByCourse(activeItems, false);
});

function activeModifiers(item) {
  return (item.modifiers || []).filter(m => (m.quantity || 1) - (m.voidedQuantity || 0) > 0);
}

const dietTags = computed(() => {
  const prefs = props.order.dietaryPreferences || {};
  return [
    ...(prefs.diete || []),
    ...(prefs.allergeni || []),
  ];
});
</script>
