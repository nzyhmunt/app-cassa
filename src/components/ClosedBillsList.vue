<template>
  <!-- Sezione Conti Chiusi -->
  <div v-if="store.closedBills.length > 0" class="mt-8 md:mt-10">
    <!-- Header collapsibile -->
    <button
      @click="expanded = !expanded"
      class="w-full flex items-center justify-between mb-3 group"
    >
      <h3 class="text-base md:text-lg font-black text-gray-700 flex items-center gap-2">
        <CheckCircle class="size-5 md:size-6 text-emerald-500" />
        Conti Chiusi
        <span class="bg-emerald-100 text-emerald-700 text-xs font-black px-2 py-0.5 rounded-full">
          {{ store.closedBills.length }}
        </span>
      </h3>
      <ChevronDown
        class="size-5 text-gray-400 transition-transform duration-200"
        :class="expanded ? 'rotate-180' : ''"
      />
    </button>

    <!-- Lista conti -->
    <div v-if="expanded" class="space-y-3">
      <BillCard
        v-for="bill in store.closedBills"
        :key="billKey(bill)"
        :bill="bill"
      />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { CheckCircle, ChevronDown } from 'lucide-vue-next';
import { useAppStore } from '../store/index.js';
import { billKey } from '../utils/index.js';
import BillCard from './BillCard.vue';

const store = useAppStore();

const expanded = ref(true);
</script>
