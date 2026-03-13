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
          class="px-3 py-2 flex items-start gap-3 border-l-4 transition-opacity"
          :class="[getCourseBorderClass(row.item), row.item.kitchenReady ? 'opacity-50' : '']"
        >
          <span :class="['shrink-0 font-black text-lg w-8 text-center', row.item.kitchenReady ? 'text-gray-400' : qtyClass]">
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

    <!-- Action button (hidden when showAction is false) -->
    <div v-if="showAction" class="px-4 pb-4 pt-2">
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
import { Layers } from 'lucide-vue-next';

const props = defineProps({
  order: { type: Object, required: true },
  statusLabel: { type: String, required: true },
  statusClass: { type: String, default: '' },
  qtyClass: { type: String, default: 'text-gray-600' },
  elapsedLabel: { type: String, required: true },
  elapsedColor: { type: String, default: 'text-gray-500' },
  actionLabel: { type: String, default: '' },
  actionClass: { type: String, default: '' },
  showAction: { type: Boolean, default: true },
});

defineEmits(['action']);

const COURSE_ORDER = ['prima', 'insieme', 'dopo'];
const DEFAULT_COURSE = 'insieme';

const activeItemsWithIndex = computed(() =>
  props.order.orderItems
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => (item.quantity - (item.voidedQuantity || 0)) > 0),
);

// Group items by course and build a flat list with course-header rows
const orderedItems = computed(() => {
  const groups = { prima: [], insieme: [], dopo: [] };
  activeItemsWithIndex.value.forEach(({ item, index }) => {
    const course = item.course && COURSE_ORDER.includes(item.course) ? item.course : DEFAULT_COURSE;
    groups[course].push({ item, index });
  });
  const nonEmpty = COURSE_ORDER.filter(c => groups[c].length > 0);
  const showHeaders = nonEmpty.length > 1;
  const result = [];
  COURSE_ORDER.forEach(course => {
    if (groups[course].length > 0) {
      if (showHeaders) result.push({ type: 'header', course });
      groups[course].forEach(entry => result.push({ type: 'item', ...entry }));
    }
  });
  return result;
});

function activeModifiers(item) {
  return (item.modifiers || []).filter(m => (m.quantity || 1) - (m.voidedQuantity || 0) > 0);
}

function getCourseBorderClass(item) {
  if (item.course === 'prima') return 'border-orange-400';
  if (item.course === 'dopo') return 'border-purple-500';
  return 'border-[var(--brand-primary)]';
}

const dietTags = computed(() => {
  const prefs = props.order.dietaryPreferences || {};
  return [
    ...(prefs.diete || []),
    ...(prefs.allergeni || []),
  ];
});
</script>
