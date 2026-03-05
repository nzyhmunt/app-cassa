import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { appConfig, initialOrders, updateOrderTotals } from '../utils/index.js';

export const useAppStore = defineStore('app', () => {
  // ── Core State ─────────────────────────────────────────────────────────────
  const config = ref(appConfig);
  const orders = ref(initialOrders);
  const transactions = ref([]);

  // ── Computed: CSS variables for theming ────────────────────────────────────
  const cssVars = computed(() => ({
    '--brand-primary': config.value.ui.primaryColor,
    '--brand-dark': config.value.ui.primaryColorDark,
  }));

  // ── Computed: Orders ───────────────────────────────────────────────────────
  const pendingCount = computed(() => orders.value.filter(o => o.status === 'pending').length);

  // ── Computed: Table helpers ────────────────────────────────────────────────
  function getTableStatus(tavoloId) {
    const ords = orders.value.filter(
      o => o.tavolo === tavoloId && o.status !== 'completed' && o.status !== 'rejected',
    );
    if (ords.length === 0) return { status: 'free', total: 0, remaining: 0 };

    // Include completed orders in the total so that per-order payments track correctly
    const billable = orders.value.filter(
      o => o.tavolo === tavoloId && (o.status === 'accepted' || o.status === 'completed'),
    );
    const total = billable.reduce((a, b) => a + b.totale_importo, 0);
    const paid = transactions.value
      .filter(t => t.tavolo_id === tavoloId)
      .reduce((a, t) => a + t.importo_pagato, 0);
    const remaining = Math.max(0, total - paid);

    if (ords.some(o => o.status === 'pending')) return { status: 'pending', total, remaining };
    return { status: 'occupied', total, remaining };
  }

  function getTableColorClass(tavoloId) {
    const st = getTableStatus(tavoloId).status;
    if (st === 'free') return 'border-emerald-200 text-emerald-800 bg-emerald-50 hover:bg-emerald-100';
    if (st === 'pending') return 'border-amber-400 text-amber-900 bg-amber-50 shadow-[0_0_15px_rgba(251,191,36,0.3)]';
    return 'border-[var(--brand-primary)] text-white theme-bg shadow-md';
  }

  function getPaymentMethodIcon(methodId) {
    const m = config.value.paymentMethods.find(x => x.label === methodId || x.id === methodId);
    return m ? m.icon : 'banknote';
  }

  // ── Mutations: Orders ──────────────────────────────────────────────────────
  function addOrder(order) {
    orders.value.push(order);
  }

  function changeOrderStatus(order, newStatus) {
    order.status = newStatus;
  }

  function updateQtyGlobal(ord, idx, delta) {
    if (!ord || ord.status !== 'pending') return;
    const riga = ord.righe_ordine[idx];
    riga.quantita += delta;
    if (riga.quantita <= 0) ord.righe_ordine.splice(idx, 1);
    updateOrderTotals(ord);
  }

  function removeRowGlobal(ord, idx) {
    if (!ord || ord.status !== 'pending') return;
    ord.righe_ordine.splice(idx, 1);
    updateOrderTotals(ord);
  }

  function cassaStornaVoci(ord, idx, qtyToStorna) {
    if (!ord || ord.status !== 'accepted') return;
    const riga = ord.righe_ordine[idx];
    if (!riga.quantita_stornata) riga.quantita_stornata = 0;
    if (riga.quantita_stornata + qtyToStorna <= riga.quantita) {
      riga.quantita_stornata += qtyToStorna;
      updateOrderTotals(ord);
    }
  }

  function cassaRipristinaVoci(ord, idx, qtyToRestore) {
    if (!ord || ord.status !== 'accepted') return;
    const riga = ord.righe_ordine[idx];
    if (riga.quantita_stornata && riga.quantita_stornata >= qtyToRestore) {
      riga.quantita_stornata -= qtyToRestore;
      updateOrderTotals(ord);
    }
  }

  // ── Mutations: Transactions ────────────────────────────────────────────────
  function addTransaction(txn) {
    transactions.value.push(txn);
  }

  function simulateNewOrder() {
    const num = Math.floor(Math.random() * 12) + 1;
    const newTav = num < 10 ? '0' + num : '' + num;
    orders.value.push({
      id: 'ord_' + Math.random().toString(36).substr(2, 9),
      tavolo: newTav,
      status: 'pending',
      time: new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
      totale_importo: 12,
      numero_articoli: 1,
      preferenze_alimentari: {},
      righe_ordine: [
        { uid: 'r_' + Date.now(), id_piatto: 'pri_2', nome: 'Amatriciana', prezzo_unitario: 12, quantita: 1, quantita_stornata: 0, note: [] },
      ],
    });
  }

  // ── Cross-view navigation state ────────────────────────────────────────────
  const pendingOpenTable = ref(null);
  const pendingSelectOrder = ref(null);

  return {
    // state
    config,
    orders,
    transactions,
    pendingOpenTable,
    pendingSelectOrder,
    // computed
    cssVars,
    pendingCount,
    // helpers
    getTableStatus,
    getTableColorClass,
    getPaymentMethodIcon,
    // mutations
    addOrder,
    changeOrderStatus,
    updateQtyGlobal,
    removeRowGlobal,
    cassaStornaVoci,
    cassaRipristinaVoci,
    addTransaction,
    simulateNewOrder,
  };
});
