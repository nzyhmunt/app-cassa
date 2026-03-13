<template>
  <!-- Order card for kitchen display system -->
  <div>
    <!-- Card header -->
    <div class="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
      <div class="flex items-center gap-3">
        <div class="size-10 rounded-full flex items-center justify-center font-black text-base theme-bg text-white shrink-0">
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

    <!-- Items list -->
    <ul class="px-4 py-3 space-y-2">
      <li
        v-for="item in activeItems"
        :key="item.uid"
        class="flex items-start gap-3"
      >
        <span :class="['shrink-0 font-black text-lg w-8 text-center', qtyClass]">
          {{ item.quantity - (item.voidedQuantity || 0) }}×
        </span>
        <div class="flex-1 min-w-0">
          <p class="font-bold text-sm text-gray-800 leading-tight">{{ item.name }}</p>
          <p v-if="item.notes && item.notes.length" class="text-xs mt-0.5 font-semibold text-amber-600">
            ✎ {{ item.notes.join(' · ') }}
          </p>
          <p v-for="mod in activeModifiers(item)" :key="mod.name" class="text-xs text-gray-500">
            + {{ mod.name }}
          </p>
        </div>
      </li>
    </ul>

    <!-- Dietary / allergy tags -->
    <div v-if="dietTags.length" class="flex flex-wrap gap-1.5 px-4 pb-2">
      <span
        v-for="tag in dietTags"
        :key="tag"
        class="text-xs font-bold rounded-full px-2 py-0.5 bg-red-50 border border-red-200 text-red-700"
      >
        {{ tag }}
      </span>
    </div>

    <!-- Action button -->
    <div class="px-4 pb-4 pt-1">
      <button
        @click="$emit('action')"
        :class="['w-full rounded-xl font-bold text-sm py-3 transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 shadow-sm', actionClass]"
        :aria-label="`${actionLabel} ordine tavolo ${order.table}`"
      >
        {{ actionLabel }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  order: { type: Object, required: true },
  statusLabel: { type: String, required: true },
  statusClass: { type: String, default: '' },
  qtyClass: { type: String, default: 'text-gray-600' },
  elapsedLabel: { type: String, required: true },
  elapsedColor: { type: String, default: 'text-gray-500' },
  actionLabel: { type: String, required: true },
  actionClass: { type: String, default: '' },
});

defineEmits(['action']);

const activeItems = computed(() =>
  props.order.orderItems.filter(item => (item.quantity - (item.voidedQuantity || 0)) > 0),
);

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
