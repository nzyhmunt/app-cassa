<template>
  <div class="flex-1 flex flex-col bg-gray-100/80 overflow-y-auto p-4 md:p-8 relative min-h-0">
    <div class="max-w-4xl mx-auto w-full">

      <!-- Header -->
      <div class="flex justify-between items-center mb-6 md:mb-8">
        <h2 class="text-xl md:text-2xl font-black text-gray-800 flex items-center gap-2 md:gap-3">
          <History class="size-6 md:size-8" /> Storico Conti
        </h2>
        <router-link
          to="/sala"
          class="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-gray-800 bg-white border border-gray-200 hover:border-gray-300 px-3 py-2 rounded-xl transition-colors shadow-sm active:scale-95"
        >
          <ArrowLeft class="size-4" /> Torna alla Sala
        </router-link>
      </div>

      <!-- Summary bar -->
      <div v-if="store.closedBills.length > 0" class="grid grid-cols-3 gap-3 mb-6">
        <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 text-center">
          <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Conti Chiusi</p>
          <p class="text-2xl font-black text-gray-800">{{ store.closedBills.length }}</p>
        </div>
        <div class="bg-white rounded-2xl border border-emerald-200 shadow-sm p-4 text-center">
          <p class="text-[10px] font-bold text-emerald-500 uppercase tracking-wider mb-1">Totale Incassato</p>
          <p class="text-2xl font-black text-emerald-700">{{ store.config.ui.currency }}{{ totalRevenue.toFixed(2) }}</p>
        </div>
        <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 text-center">
          <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Media Conto</p>
          <p class="text-2xl font-black text-gray-800">{{ store.config.ui.currency }}{{ averageBill.toFixed(2) }}</p>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="store.closedBills.length === 0" class="text-center py-20">
        <History class="size-16 mx-auto mb-4 text-gray-300" />
        <h3 class="text-lg font-bold text-gray-400 mb-1">Nessun conto chiuso</h3>
        <p class="text-sm text-gray-400">I conti saldati appariranno qui.</p>
      </div>

      <!-- Bills list -->
      <div v-else class="space-y-3">
        <BillCard
          v-for="bill in store.closedBills"
          :key="bill.tableId + '_' + (bill.billSessionId ?? '')"
          :bill="bill"
        />
      </div>

    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { History, ArrowLeft } from 'lucide-vue-next';
import { useAppStore } from '../store/index.js';
import BillCard from '../components/BillCard.vue';

const store = useAppStore();

const totalRevenue = computed(() =>
  store.closedBills.reduce((sum, b) => sum + b.totalPaid, 0)
);

const averageBill = computed(() =>
  store.closedBills.length > 0 ? totalRevenue.value / store.closedBills.length : 0
);
</script>
