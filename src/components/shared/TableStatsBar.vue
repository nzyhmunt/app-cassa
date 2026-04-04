<template>
  <!-- Status pills — unified legend + count; always shown so inactive items serve as legend -->
  <div class="flex flex-wrap items-center gap-2 mb-4 md:mb-5">
    <!-- Libero -->
    <div :class="freeCount > 0
      ? 'bg-white border-gray-200'
      : 'bg-white/60 border-gray-100 opacity-50'"
      class="flex items-center gap-2 rounded-xl px-3 py-2 shadow-sm border">
      <span class="size-2.5 rounded-full border-2 border-emerald-400 bg-emerald-100 shrink-0"></span>
      <span class="text-xs font-bold text-gray-700">{{ freeCount }} Liberi</span>
    </div>
    <!-- In Attesa -->
    <div :class="pendingCount > 0
      ? 'bg-amber-50 border-amber-200'
      : 'bg-white/60 border-gray-100 opacity-50'"
      class="flex items-center gap-2 rounded-xl px-3 py-2 shadow-sm border">
      <span class="size-2.5 rounded-full border-2 border-amber-400 bg-amber-100 shrink-0"></span>
      <span :class="pendingCount > 0 ? 'text-amber-800' : 'text-gray-700'" class="text-xs font-bold">{{ pendingCount }} In Attesa</span>
    </div>
    <!-- Saldato -->
    <div :class="saldatoCount > 0
      ? 'bg-violet-50 border-violet-200'
      : 'bg-white/60 border-gray-100 opacity-50'"
      class="flex items-center gap-2 rounded-xl px-3 py-2 shadow-sm border">
      <span class="size-2.5 rounded-full border-2 border-violet-400 bg-violet-100 shrink-0"></span>
      <span :class="saldatoCount > 0 ? 'text-violet-800' : 'text-gray-700'" class="text-xs font-bold">{{ saldatoCount }} Saldati</span>
    </div>
    <!-- Conto Richiesto — solo Cassa (prop opzionale) -->
    <div v-if="billRequestedCount !== undefined"
      :class="billRequestedCount > 0
        ? 'bg-blue-50 border-blue-200'
        : 'bg-white/60 border-gray-100 opacity-50'"
      class="flex items-center gap-2 rounded-xl px-3 py-2 shadow-sm border">
      <span class="size-2.5 rounded-full border-2 border-blue-400 bg-blue-100 shrink-0"></span>
      <span :class="billRequestedCount > 0 ? 'text-blue-800' : 'text-gray-700'" class="text-xs font-bold">{{ billRequestedCount }} Conto Rich.</span>
    </div>
    <!-- Occupato -->
    <div :class="occupiedCount > 0
      ? 'bg-white border-gray-200'
      : 'bg-white/60 border-gray-100 opacity-50'"
      class="flex items-center gap-2 rounded-xl px-3 py-2 shadow-sm border">
      <span class="size-2.5 rounded-full theme-bg shrink-0"></span>
      <span class="text-xs font-bold text-gray-700">{{ occupiedCount }} Occupati</span>
    </div>
  </div>
</template>

<script setup>
defineProps({
  freeCount: { type: Number, required: true },
  occupiedCount: { type: Number, required: true },
  pendingCount: { type: Number, required: true },
  saldatoCount: { type: Number, default: 0 },
  billRequestedCount: { type: Number, default: undefined },
});
</script>
