<template>
  <!-- Status filter pills — clickable to filter table grid; count=0 pills are dimmed (legend) -->
  <div class="flex flex-wrap items-center gap-2">
    <!-- Libero -->
    <button
      @click="toggle('free')"
      :aria-pressed="activeFilter === 'free'"
      :aria-label="`Filtra per Liberi: ${freeCount} tavoli`"
      :class="[
        activeFilter === 'free' ? 'ring-2 ring-emerald-400 ring-offset-1' : '',
        freeCount > 0 ? 'bg-white border-gray-200' : 'bg-white/60 border-gray-100 opacity-50',
      ]"
      class="flex items-center gap-2 rounded-xl px-3 py-2 shadow-sm border transition-all active:scale-95 cursor-pointer"
    >
      <span class="size-2.5 rounded-full border-2 border-emerald-400 bg-emerald-100 shrink-0"></span>
      <span class="text-xs font-bold text-gray-700">Liberi</span>
      <span class="text-[10px] font-black opacity-60">{{ freeCount }}</span>
    </button>
    <!-- Occupato -->
    <button
      @click="toggle('occupied')"
      :aria-pressed="activeFilter === 'occupied'"
      :aria-label="`Filtra per Occupati: ${occupiedCount} tavoli`"
      :class="[
        activeFilter === 'occupied' ? 'ring-2 ring-emerald-700 ring-offset-1' : '',
        occupiedCount > 0 ? 'bg-white border-gray-200' : 'bg-white/60 border-gray-100 opacity-50',
      ]"
      class="flex items-center gap-2 rounded-xl px-3 py-2 shadow-sm border transition-all active:scale-95 cursor-pointer"
    >
      <span class="size-2.5 rounded-full theme-bg shrink-0"></span>
      <span class="text-xs font-bold text-gray-700">Occupati</span>
      <span class="text-[10px] font-black opacity-60 text-gray-500">{{ occupiedCount }}</span>
    </button>
    <!-- In Attesa -->
    <button
      @click="toggle('pending')"
      :aria-pressed="activeFilter === 'pending'"
      :aria-label="`Filtra per In Attesa: ${pendingCount} tavoli`"
      :class="[
        activeFilter === 'pending' ? 'ring-2 ring-amber-400 ring-offset-1' : '',
        pendingCount > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white/60 border-gray-100 opacity-50',
      ]"
      class="flex items-center gap-2 rounded-xl px-3 py-2 shadow-sm border transition-all active:scale-95 cursor-pointer"
    >
      <span class="size-2.5 rounded-full border-2 border-amber-400 bg-amber-100 shrink-0"></span>
      <span :class="pendingCount > 0 ? 'text-amber-800' : 'text-gray-700'" class="text-xs font-bold">In Attesa</span>
      <span :class="pendingCount > 0 ? 'text-amber-700' : 'text-gray-500'" class="text-[10px] font-black opacity-60">{{ pendingCount }}</span>
    </button>
    <!-- Conto Richiesto — solo Cassa (prop opzionale) -->
    <button
      v-if="billRequestedCount !== undefined"
      @click="toggle('bill_requested')"
      :aria-pressed="activeFilter === 'bill_requested'"
      :aria-label="`Filtra per Conto Richiesto: ${billRequestedCount} tavoli`"
      :class="[
        activeFilter === 'bill_requested' ? 'ring-2 ring-blue-400 ring-offset-1' : '',
        billRequestedCount > 0 ? 'bg-blue-50 border-blue-200' : 'bg-white/60 border-gray-100 opacity-50',
      ]"
      class="flex items-center gap-2 rounded-xl px-3 py-2 shadow-sm border transition-all active:scale-95 cursor-pointer"
    >
      <span class="size-2.5 rounded-full border-2 border-blue-400 bg-blue-100 shrink-0"></span>
      <span :class="billRequestedCount > 0 ? 'text-blue-800' : 'text-gray-700'" class="text-xs font-bold">Conto Rich.</span>
      <span :class="billRequestedCount > 0 ? 'text-blue-700' : 'text-gray-500'" class="text-[10px] font-black opacity-60">{{ billRequestedCount }}</span>
    </button>
    <!-- Saldato -->
    <button
      @click="toggle('paid')"
      :aria-pressed="activeFilter === 'paid'"
      :aria-label="`Filtra per Saldati: ${paidCount} tavoli`"
      :class="[
        activeFilter === 'paid' ? 'ring-2 ring-violet-400 ring-offset-1' : '',
        paidCount > 0 ? 'bg-violet-50 border-violet-200' : 'bg-white/60 border-gray-100 opacity-50',
      ]"
      class="flex items-center gap-2 rounded-xl px-3 py-2 shadow-sm border transition-all active:scale-95 cursor-pointer"
    >
      <span class="size-2.5 rounded-full border-2 border-violet-400 bg-violet-100 shrink-0"></span>
      <span :class="paidCount > 0 ? 'text-violet-800' : 'text-gray-700'" class="text-xs font-bold">Saldati</span>
      <span :class="paidCount > 0 ? 'text-violet-700' : 'text-gray-500'" class="text-[10px] font-black opacity-60">{{ paidCount }}</span>
    </button>
  </div>
</template>

<script setup>
const props = defineProps({
  freeCount: { type: Number, required: true },
  occupiedCount: { type: Number, required: true },
  pendingCount: { type: Number, required: true },
  paidCount: { type: Number, default: 0 },
  billRequestedCount: { type: Number, default: undefined },
  activeFilter: { type: String, default: null },
});

const emit = defineEmits(['update:activeFilter']);

function toggle(status) {
  emit('update:activeFilter', props.activeFilter === status ? null : status);
}
</script>
