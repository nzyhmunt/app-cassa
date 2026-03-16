<template>
  <div class="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
    <!-- Card header -->
    <button
      type="button"
      @click="isOpen = !isOpen"
      :aria-expanded="isOpen"
      :aria-controls="'bill-panel-' + billKey(bill)"
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
            {{ bill.transactions.filter(t => t.operationType !== 'discount').length }} pagament{{ bill.transactions.filter(t => t.operationType !== 'discount').length !== 1 ? 'i' : 'o' }}
          </p>
          <p v-if="bill.totalDiscount > 0" class="text-[10px] text-amber-600 font-bold">
            -{{ store.config.ui.currency }}{{ bill.totalDiscount.toFixed(2) }} sconto
          </p>
          <p v-if="bill.totalTips > 0" class="text-[10px] text-purple-600 font-bold">
            +{{ store.config.ui.currency }}{{ bill.totalTips.toFixed(2) }} mancia
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
    <div v-if="isOpen" :id="'bill-panel-' + billKey(bill)" class="border-t border-gray-100 bg-gray-50">

      <!-- Payments -->
      <div class="p-4">
        <h5 class="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
          <CreditCard class="size-3.5" /> Pagamenti Effettuati
        </h5>
        <div class="space-y-1.5">
          <div
            v-for="txn in bill.transactions"
            :key="txn.transactionId"
            class="flex items-center justify-between rounded-xl px-3 py-2 border"
            :class="txn.operationType === 'discount' ? 'bg-amber-50 border-amber-100' : 'bg-emerald-50 border-emerald-100'"
          >
            <div class="flex items-center gap-2 text-xs font-bold"
              :class="txn.operationType === 'discount' ? 'text-amber-700' : 'text-emerald-700'">
              <Tag v-if="txn.operationType === 'discount'" class="size-3.5 shrink-0" />
              <component v-else :is="getPaymentIcon(txn.paymentMethod)" class="size-3.5 shrink-0" />
              <span class="uppercase tracking-wide">{{ txn.paymentMethod }}</span>
              <span v-if="txn.operationType === 'romana'" class="text-[9px] font-medium opacity-70">
                ({{ txn.splitQuota }}/{{ txn.splitWays }}<template v-if="(txn.romanaSplitCount || 1) > 1"> · {{ txn.romanaSplitCount }} quote</template>)
              </span>
              <span v-if="txn.operationType === 'discount'" class="text-[9px] font-medium opacity-70">
                ({{ txn.discountType === 'percent' ? txn.discountValue + '%' : store.config.ui.currency + (txn.discountValue ?? 0).toFixed(2) }})
              </span>
              <span class="text-[9px] font-medium opacity-70">
                · {{ formatTime(txn.timestamp) }}
              </span>
            </div>
            <div class="text-right">
              <span class="font-black text-sm" :class="txn.operationType === 'discount' ? 'text-amber-800' : 'text-emerald-800'">
                <span v-if="txn.operationType === 'discount'">-</span>{{ store.config.ui.currency }}{{ txn.amountPaid.toFixed(2) }}
              </span>
              <div v-if="txn.grossAmount" class="text-[9px] font-medium text-gray-500">Consegnato: {{ store.config.ui.currency }}{{ txn.grossAmount.toFixed(2) }}</div>
              <div v-if="txn.changeAmount" class="text-[9px] font-bold text-blue-600">Resto: -{{ store.config.ui.currency }}{{ txn.changeAmount.toFixed(2) }}</div>
              <div v-if="txn.tipAmount" class="text-[9px] font-bold text-purple-600">
                +{{ store.config.ui.currency }}{{ txn.tipAmount.toFixed(2) }} mancia
              </div>
            </div>
          </div>
        </div>

        <!-- Summary row when discounts or tips present -->
        <div v-if="bill.totalDiscount > 0 || bill.totalTips > 0" class="mt-3 pt-3 border-t border-gray-200 space-y-1">
          <div v-if="bill.totalDiscount > 0" class="flex justify-between text-xs font-bold text-amber-600">
            <span>Sconto totale:</span>
            <span>-{{ store.config.ui.currency }}{{ bill.totalDiscount.toFixed(2) }}</span>
          </div>
          <div v-if="bill.totalTips > 0" class="flex justify-between text-xs font-bold text-purple-600">
            <span>Mance totali:</span>
            <span>+{{ store.config.ui.currency }}{{ bill.totalTips.toFixed(2) }}</span>
          </div>
          <div class="flex justify-between text-xs font-bold text-emerald-700">
            <span>Incasso netto:</span>
            <span>{{ store.config.ui.currency }}{{ bill.totalPaid.toFixed(2) }}</span>
          </div>
        </div>

        <!-- Aggiungi Mancia post-pagamento -->
        <div class="mt-3 pt-3 border-t border-gray-200">
          <div v-if="!showTipInput" class="flex justify-end">
            <button
              @click="showTipInput = true; postTipValue = ''"
              class="flex items-center gap-1.5 text-[10px] font-bold text-purple-600 hover:text-purple-800 bg-purple-50 hover:bg-purple-100 border border-purple-200 px-3 py-1.5 rounded-xl transition-colors active:scale-95"
            >
              <Wallet class="size-3.5" /> Aggiungi Mancia
            </button>
          </div>
          <div v-else class="space-y-2">
            <label class="block text-[10px] font-bold text-purple-600 uppercase flex items-center gap-1.5">
              <Wallet class="size-3.5" /> Mancia da aggiungere
            </label>
            <div class="flex items-center gap-2">
              <span class="text-sm font-bold text-purple-600">{{ store.config.ui.currency }}</span>
              <input
                v-model="postTipValue"
                type="number"
                min="0"
                step="0.50"
                placeholder="0.00"
                class="flex-1 text-sm font-bold border border-purple-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:border-purple-400 text-purple-900"
              />
            </div>
            <div class="flex gap-2">
              <button
                @click="confirmPostTip"
                :disabled="!postTipParsed"
                class="flex-1 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl disabled:opacity-40 active:scale-95 transition-all text-xs flex items-center justify-center gap-1.5"
              >
                <CheckCircle class="size-3.5" /> Conferma
              </button>
              <button
                @click="showTipInput = false; postTipValue = ''"
                class="flex-1 py-2 text-gray-600 font-bold rounded-xl border border-gray-200 hover:bg-gray-100 active:scale-95 transition-all text-xs"
              >
                Annulla
              </button>
            </div>
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
                  {{ store.config.ui.currency }}{{ getOrderItemRowTotal(item).toFixed(2) }}
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
import { ref, computed } from 'vue';
import { ChevronDown, CreditCard, ClipboardList, Banknote, Tag, Wallet, CheckCircle } from 'lucide-vue-next';
import { useAppStore } from '../store/index.js';
import { billKey, getOrderItemRowTotal } from '../utils/index.js';

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

// Post-payment tip state
const showTipInput = ref(false);
const postTipValue = ref('');
const postTipParsed = computed(() => Math.max(0, parseFloat(postTipValue.value) || 0));

function confirmPostTip() {
  if (!postTipParsed.value) return;
  store.addTipTransaction(props.bill.tableId, props.bill.billSessionId, postTipParsed.value);
  showTipInput.value = false;
  postTipValue.value = '';
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
</script>
