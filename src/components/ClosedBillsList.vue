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
      <div
        v-for="bill in store.closedBills"
        :key="bill.tableId"
        class="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden"
      >
        <!-- Card header -->
        <button
          @click="toggleBill(bill.tableId)"
          class="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors active:bg-gray-100"
        >
          <div class="flex items-center gap-3">
            <div class="size-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center font-black text-base text-emerald-800">
              {{ bill.table?.label ?? bill.tableId }}
            </div>
            <div class="text-left">
              <p class="font-bold text-gray-800 text-sm leading-tight">
                Tavolo {{ bill.table?.label ?? bill.tableId }}
              </p>
              <p class="text-[10px] text-gray-400 font-medium mt-0.5">
                {{ bill.table?.covers ? bill.table.covers + ' coperti · ' : '' }}
                Chiuso {{ formatTime(bill.closedAt) }}
              </p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="font-black text-lg text-emerald-700">
              {{ store.config.ui.currency }}{{ bill.totalPaid.toFixed(2) }}
            </span>
            <ChevronDown
              class="size-4 text-gray-400 transition-transform duration-200 shrink-0"
              :class="openBills.has(bill.tableId) ? 'rotate-180' : ''"
            />
          </div>
        </button>

        <!-- Dettaglio espandibile -->
        <div v-if="openBills.has(bill.tableId)" class="border-t border-gray-100 bg-gray-50">

          <!-- Pagamenti -->
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

          <!-- Ordini -->
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

          <!-- Empty orders state -->
          <div v-else class="px-4 pb-4">
            <p class="text-xs text-gray-400 italic">Nessuna comanda registrata.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { CheckCircle, ChevronDown, CreditCard, ClipboardList, Banknote } from 'lucide-vue-next';
import { useAppStore } from '../store/index.js';

const store = useAppStore();

// Whether the whole section is expanded
const expanded = ref(true);

// Set of tableIds whose detail panel is open
const openBills = ref(new Set());

function toggleBill(tableId) {
  const next = new Set(openBills.value);
  if (next.has(tableId)) {
    next.delete(tableId);
  } else {
    next.add(tableId);
  }
  openBills.value = next;
}

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
