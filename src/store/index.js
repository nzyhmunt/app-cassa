import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { appConfig, initialOrders, updateOrderTotals } from '../utils/index.js';

export const useAppStore = defineStore('app', () => {
  // ── Core State ─────────────────────────────────────────────────────────────
  const config = ref(appConfig);
  const orders = ref(initialOrders);
  const transactions = ref([]);

  // ── Cassa State ────────────────────────────────────────────────────────────
  const fondoCassa = ref(0);
  const movimentiCassa = ref([]); // { id, tipo: 'versamento'|'prelievo', importo, causale, timestamp }
  const chiusureGiornaliere = ref([]); // stored closure summaries

  // ── Table extra state ──────────────────────────────────────────────────────
  // Maps tableId -> ISO timestamp of first accepted order
  const tableOccupiedAt = ref({});
  // Set of tableIds that have requested the bill (conto_richiesto)
  const tablesContoRichiesto = ref(new Set());

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
    if (tablesContoRichiesto.value.has(tavoloId)) return { status: 'conto_richiesto', total, remaining };
    return { status: 'occupied', total, remaining };
  }

  function getTableColorClass(tavoloId) {
    const st = getTableStatus(tavoloId).status;
    if (st === 'free') return 'border-emerald-200 text-emerald-800 bg-emerald-50 hover:bg-emerald-100';
    if (st === 'pending') return 'border-amber-400 text-amber-900 bg-amber-50 shadow-[0_0_15px_rgba(251,191,36,0.3)]';
    if (st === 'conto_richiesto') return 'border-blue-400 text-blue-900 bg-blue-100 shadow-[0_0_15px_rgba(59,130,246,0.3)]';
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
    // When first accepted order for a table, record occupiedAt
    if (newStatus === 'accepted' && !tableOccupiedAt.value[order.tavolo]) {
      tableOccupiedAt.value[order.tavolo] = new Date().toISOString();
    }
    // When all orders for table are closed, clear occupiedAt and conto_richiesto
    const activeOrds = orders.value.filter(
      o => o.tavolo === order.tavolo && o.status !== 'completed' && o.status !== 'rejected',
    );
    if (activeOrds.length === 0) {
      delete tableOccupiedAt.value[order.tavolo];
      tablesContoRichiesto.value.delete(order.tavolo);
    }
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
    // Clear conto_richiesto when payment is made
    if (txn.tavolo_id) tablesContoRichiesto.value.delete(txn.tavolo_id);
  }

  // ── Mutations: Table Operations ────────────────────────────────────────────
  function setContoRichiesto(tavoloId, val) {
    if (val) tablesContoRichiesto.value.add(tavoloId);
    else tablesContoRichiesto.value.delete(tavoloId);
    // Trigger reactivity: replace the Set
    tablesContoRichiesto.value = new Set(tablesContoRichiesto.value);
  }

  function moveTableOrders(fromTableId, toTableId) {
    // Move all active (non-completed/rejected) orders from fromTableId to toTableId
    orders.value.forEach(o => {
      if (o.tavolo === fromTableId && o.status !== 'completed' && o.status !== 'rejected') {
        o.tavolo = toTableId;
      }
    });
    // Move occupiedAt if set
    if (tableOccupiedAt.value[fromTableId]) {
      if (!tableOccupiedAt.value[toTableId]) {
        tableOccupiedAt.value[toTableId] = tableOccupiedAt.value[fromTableId];
      }
      delete tableOccupiedAt.value[fromTableId];
    }
    // Move conto_richiesto flag
    if (tablesContoRichiesto.value.has(fromTableId)) {
      tablesContoRichiesto.value.delete(fromTableId);
      tablesContoRichiesto.value.add(toTableId);
      tablesContoRichiesto.value = new Set(tablesContoRichiesto.value);
    }
    // Also move related transactions
    transactions.value.forEach(t => {
      if (t.tavolo_id === fromTableId) t.tavolo_id = toTableId;
    });
  }

  function mergeTableOrders(sourceTableId, targetTableId) {
    // Move all active orders from sourceTableId to targetTableId
    orders.value.forEach(o => {
      if (o.tavolo === sourceTableId && o.status !== 'completed' && o.status !== 'rejected') {
        o.tavolo = targetTableId;
      }
    });
    // Preserve the earliest occupiedAt
    if (tableOccupiedAt.value[sourceTableId]) {
      const srcTime = tableOccupiedAt.value[sourceTableId];
      const tgtTime = tableOccupiedAt.value[targetTableId];
      if (!tgtTime || new Date(srcTime) < new Date(tgtTime)) {
        tableOccupiedAt.value[targetTableId] = srcTime;
      }
      delete tableOccupiedAt.value[sourceTableId];
    }
    // Clear conto_richiesto on source
    tablesContoRichiesto.value.delete(sourceTableId);
    tablesContoRichiesto.value = new Set(tablesContoRichiesto.value);
    // Move transactions
    transactions.value.forEach(t => {
      if (t.tavolo_id === sourceTableId) t.tavolo_id = targetTableId;
    });
  }

  // ── Mutations: Cassa ───────────────────────────────────────────────────────
  function setFondoCassa(importo) {
    fondoCassa.value = importo;
  }

  function addMovimentoCassa(tipo, importo, causale) {
    movimentiCassa.value.push({
      id: 'mov_' + Math.random().toString(36).slice(2, 11),
      tipo, // 'versamento' | 'prelievo'
      importo,
      causale,
      timestamp: new Date().toISOString(),
    });
  }

  function _buildChiusuraSummary() {
    // Aggregate transactions by payment method
    const byMethod = {};
    transactions.value.forEach(t => {
      const label = t.metodo_pagamento || 'Altro';
      if (!byMethod[label]) byMethod[label] = 0;
      byMethod[label] += t.importo_pagato;
    });
    const totaleIncassato = Object.values(byMethod).reduce((a, b) => a + b, 0);

    // Total covers from completed tables
    const completedTavoli = new Set(
      transactions.value.map(t => t.tavolo_id).filter(Boolean),
    );
    let totaleCoperti = 0;
    completedTavoli.forEach(tid => {
      const tavolo = config.value.tables.find(t => t.id === tid);
      if (tavolo) totaleCoperti += tavolo.coperti || 0;
    });

    const numScontrini = completedTavoli.size;
    const scontrino_medio = numScontrini > 0 ? totaleIncassato / numScontrini : 0;

    const totaleMov = movimentiCassa.value.reduce((acc, m) => {
      return acc + (m.tipo === 'versamento' ? m.importo : -m.importo);
    }, 0);

    return {
      timestamp: new Date().toISOString(),
      fondo_cassa: fondoCassa.value,
      totale_incassato: totaleIncassato,
      by_method: byMethod,
      totale_coperti: totaleCoperti,
      scontrino_medio,
      num_scontrini: numScontrini,
      movimenti_cassa: [...movimentiCassa.value],
      totale_movimenti: totaleMov,
      fondo_finale: fondoCassa.value + totaleIncassato + totaleMov,
    };
  }

  function chiusuraX() {
    return _buildChiusuraSummary();
  }

  function chiusuraZ() {
    const summary = _buildChiusuraSummary();
    summary.tipo = 'Z';
    chiusureGiornaliere.value.push(summary);
    // Reset daily data
    transactions.value = [];
    movimentiCassa.value = [];
    fondoCassa.value = summary.fondo_finale;
    return summary;
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
    fondoCassa,
    movimentiCassa,
    chiusureGiornaliere,
    tableOccupiedAt,
    tablesContoRichiesto,
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
    // table operations
    setContoRichiesto,
    moveTableOrders,
    mergeTableOrders,
    // cassa operations
    setFondoCassa,
    addMovimentoCassa,
    chiusuraX,
    chiusuraZ,
  };
});
