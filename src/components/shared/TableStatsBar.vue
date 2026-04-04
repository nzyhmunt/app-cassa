<template>
  <!-- Status pills: free / occupied / pending / saldato — shared by CassaTableManager and SalaTableManager -->
  <div class="flex flex-wrap items-center gap-2 mb-4 md:mb-5">
    <div class="flex items-center gap-2 bg-white rounded-xl px-3 py-2 shadow-sm border border-gray-200">
      <span class="size-2.5 rounded-full border-2 border-emerald-400 bg-emerald-100 shrink-0"></span>
      <span class="text-xs font-bold text-gray-700">{{ freeCount }} Liberi</span>
    </div>
    <div class="flex items-center gap-2 bg-white rounded-xl px-3 py-2 shadow-sm border border-gray-200">
      <span class="size-2.5 rounded-full theme-bg shrink-0"></span>
      <span class="text-xs font-bold text-gray-700">{{ occupiedCount }} Occupati</span>
    </div>
    <div v-if="pendingCount > 0" class="flex items-center gap-2 bg-amber-50 rounded-xl px-3 py-2 shadow-sm border border-amber-200">
      <span class="size-2.5 rounded-full border-2 border-amber-400 bg-amber-100 shrink-0"></span>
      <span class="text-xs font-bold text-amber-800">{{ pendingCount }} In Attesa</span>
    </div>
    <div v-if="saldatoCount > 0" class="flex items-center gap-2 bg-violet-50 rounded-xl px-3 py-2 shadow-sm border border-violet-200">
      <span class="size-2.5 rounded-full border-2 border-violet-400 bg-violet-100 shrink-0"></span>
      <span class="text-xs font-bold text-violet-800">{{ saldatoCount }} Saldati</span>
    </div>
  </div>
</template>

<script setup>
defineProps({
  freeCount: { type: Number, required: true },
  occupiedCount: { type: Number, required: true },
  pendingCount: { type: Number, required: true },
  saldatoCount: { type: Number, default: 0 },
});
</script>
