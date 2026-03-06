<template>
  <div class="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
    <!-- Card header -->
    <button
      type="button"
      @click="isOpen = !isOpen"
      :aria-expanded="isOpen"
      :aria-controls="'bill-detail-' + bill.tableId + '-' + (bill.billSessionId ?? bill.closedAt)"
      class="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors active:bg-gray-100"
    >
      <div class="flex items-center gap-3">
        <div class="size-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center font-black text-base text-emerald-800 shrink-0">
          {{ bill.table?.label ?? bill.tableId }}
        </div>
        <div class="text-left">
          <p class="font-bold text-gray-800 text-sm leading-tight">
            Tavolo {{ bill.table?.label ?? bill.tableId }}
          </p>
          <p class="text-[10px] text-gray-400 font-medium mt-0.5">
            {{ bill.table?.covers ? bill.table.covers + ' coperti · ' : '' }}Chiuso {{ formatTime(bill.closedAt) }}
          </p>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <div class="text-right hidden sm:block">
          <p class="text-[10px] text-gray-400 font-medium">
            {{ bill.transactions.length }} pagament{{ bill.transactions.length !== 1 ? 'i' : 'o' }}
          </p>
        </div>
        <span class="font-black text-lg text-emerald-700">
          {{ store.config.ui.currency }}{{ bill.totalPaid.toFixed(2) }}
        </span>
        <ChevronDown
          class="size-4 text-gray-400 transition-transform duration-200 shrink-0"
          :class="isOpen ? 'rotate-180' : ''"
        />
      </div>
    </button>

    <!-- Expanded detail -->
    <div v-if="isOpen" :id="'bill-detail-' + bill.tableId + '-' + (bill.billSessionId ?? bill.closedAt)" class="border-t border-gray-100 bg-gray-50">

      <!-- Payments -->
      <div class="p-4">
        <h5 class="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
          <CreditCard class="size-3.5" /> Pagamenti Effettuati
        </h5>
        <div class="space-y-1.5">
          <div
            v-for="txn in bill.transactions"
            :key="txn.transactionId"
            class="flex items-center justify-between bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2"
          >
            <div class="flex items-center gap-2 text-xs font-bold text-emerald-700">
              <component :is="getPaymentIcon(txn.paymentMethod)" class="size-3.5 shrink-0" />
              <span class="uppercase tracking-wide">{{ txn.paymentMethod }}</span>
              <span v-if="txn.operationType === 'romana'" class="text-[9px] text-emerald-500 font-medium">
                ({{ txn.splitQuota }}/{{ txn.splitWays }})
              </span>
              <span class="text-[9px] text-emerald-500 font-medium">
                · {{ formatTime(txn.timestamp) }}
              </span>
            </div>
            <span class="font-black text-sm text-emerald-800">
              {{ store.config.ui.currency }}{{ txn.amountPaid.toFixed(2) }}
            </span>
          </div>
        </div>
      </div>

      <!-- Orders -->
      <div v-if="bill.orders.length > 0" class="px-4 pb-4">
        <h5 class="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
          <ClipboardList class="size-3.5" /> Comande
        </h5>
        <div class="space-y-2">
          <div
            v-for="ord in bill.orders"
            :key="ord.id"
            class="bg-white border border-gray-200 rounded-xl p-3"
          >
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-bold text-gray-700">
                Comanda #{{ ord.id.substring(0, 6) }}
                <span class="text-gray-400 font-medium">· {{ ord.time }}</span>
                <span
                  v-if="ord.status === 'rejected'"
                  class="ml-1 text-[9px] font-bold uppercase text-red-500 border border-red-200 bg-red-50 px-1 rounded"
                >Rifiutata</span>
              </span>
              <span class="font-black text-sm text-gray-800">
                {{ store.config.ui.currency }}{{ ord.totalAmount.toFixed(2) }}
              </span>
            </div>
            <div class="space-y-1">
              <div
                v-for="item in ord.orderItems"
                :key="item.uid"
                class="flex items-center justify-between text-xs text-gray-600"
                :class="{ 'opacity-40 line-through': item.voidedQuantity === item.quantity }"
              >
                <div class="flex items-center gap-2 min-w-0">
                  <span class="font-bold w-5 shrink-0 text-center">
                    {{ item.quantity - (item.voidedQuantity || 0) }}x
                  </span>
                  <span class="truncate">{{ item.name }}</span>
                  <span
                    v-if="item.voidedQuantity > 0 && item.voidedQuantity !== item.quantity"
                    class="text-[9px] text-red-500 font-bold border border-red-200 bg-red-50 px-1 rounded shrink-0"
                  >
                    -{{ item.voidedQuantity }} Storn.
                  </span>
                </div>
                <span class="font-bold shrink-0 ml-2">
                  {{ store.config.ui.currency }}{{ calculateItemTotal(item).toFixed(2) }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="px-4 pb-4">
        <p class="text-xs text-gray-400 italic">Nessuna comanda registrata.</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { ChevronDown, CreditCard, ClipboardList, Banknote } from 'lucide-vue-next';
import { useAppStore } from '../store/index.js';

const props = defineProps({
  bill: {
    type: Object,
    required: true,
  },
  initiallyOpen: {
    type: Boolean,
    default: false,
  },
});

const store = useAppStore();
const isOpen = ref(props.initiallyOpen);

function formatTime(isoString) {
  if (!isoString) return '–';
  return new Date(isoString).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function getPaymentIcon(methodIdOrLabel) {
  const m = store.config.paymentMethods.find(x => x.label === methodIdOrLabel || x.id === methodIdOrLabel);
  if (!m) return Banknote;
  return m.icon === 'credit-card' ? CreditCard : Banknote;
}

function calculateItemTotal(item) {
  const modifiers = item.modifiers ? item.modifiers.reduce((a, m) => a + (m.price || 0), 0) : 0;
  const activeQty = item.quantity - (item.voidedQuantity || 0);
  return (item.unitPrice + modifiers) * activeQty;
}
</script>
