<template>
  <!-- MODAL: CRUSCOTTO CASSA -->
  <div v-if="modelValue" class="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4">
    <div class="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-3xl h-[95dvh] md:h-[90vh] flex flex-col overflow-hidden">

      <!-- Header -->
      <div class="bg-gray-900 text-white p-4 md:p-5 flex justify-between items-center shrink-0">
        <div class="flex items-center gap-3">
          <div class="size-10 md:size-12 rounded-full bg-white/10 flex items-center justify-center">
            <Landmark class="size-5 md:size-6 text-emerald-400" />
          </div>
          <div>
            <h3 class="font-bold text-base md:text-xl leading-tight">Cruscotto Cassa</h3>
            <p class="text-white/60 text-[10px] md:text-xs">Fondo, Movimenti e Chiusure Giornaliere</p>
          </div>
        </div>
        <button @click="$emit('update:modelValue', false)" class="bg-white/10 hover:bg-white/20 p-2 md:p-2.5 rounded-full transition-colors active:scale-95">
          <X class="size-5 md:size-6" />
        </button>
      </div>

      <!-- Tabs -->
      <div class="flex bg-gray-50 border-b border-gray-200 shrink-0">
        <button v-for="tab in tabs" :key="tab.id" @click="activeTab = tab.id"
          class="flex-1 py-2.5 md:py-3 px-2 text-[10px] md:text-xs font-bold uppercase tracking-wider transition-all flex flex-col items-center gap-1"
          :class="activeTab === tab.id ? 'bg-white border-b-2 border-[var(--brand-primary)] theme-text shadow-sm' : 'text-gray-500 hover:bg-gray-100'">
          <component :is="tab.icon" class="size-4 md:size-5" />
          {{ tab.label }}
        </button>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-y-auto p-4 md:p-6 bg-gray-50">

        <!-- TAB: FONDO CASSA -->
        <div v-if="activeTab === 'fondo'" class="space-y-4">
          <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 md:p-6">
            <h4 class="font-bold text-gray-700 text-sm uppercase tracking-wider mb-4 flex items-center gap-2">
              <Wallet class="size-4 text-emerald-600" /> Fondo Cassa Iniziale
            </h4>
            <div class="flex items-center gap-3">
              <div class="relative flex-1">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 font-black text-gray-500 text-lg">€</span>
                <input type="number" v-model.number="fondoInput" min="0" step="0.50"
                  class="w-full pl-8 pr-4 py-3 border-2 border-gray-200 rounded-xl font-black text-xl text-gray-800 focus:border-[var(--brand-primary)] focus:outline-none transition-colors"
                  placeholder="0.00" />
              </div>
              <button @click="saveFondo"
                class="theme-bg text-white px-5 py-3 rounded-xl font-bold shadow-md hover:opacity-90 transition-opacity active:scale-95 flex items-center gap-2 shrink-0">
                <Save class="size-5" /> Salva
              </button>
            </div>
            <div class="mt-3 flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-100 rounded-xl">
              <TrendingUp class="size-4 text-emerald-600 shrink-0" />
              <span class="text-xs font-bold text-emerald-700">Fondo attuale: <span class="text-base">€{{ store.fondoCassa.toFixed(2) }}</span></span>
            </div>
          </div>

          <!-- Movimenti -->
          <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 md:p-6">
            <h4 class="font-bold text-gray-700 text-sm uppercase tracking-wider mb-4 flex items-center gap-2">
              <ArrowLeftRight class="size-4 text-blue-600" /> Versamenti &amp; Prelievi
            </h4>

            <div class="grid grid-cols-2 gap-2 mb-4">
              <button @click="movTipo = 'versamento'"
                :class="movTipo === 'versamento' ? 'bg-emerald-100 border-emerald-400 text-emerald-800' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'"
                class="py-2.5 px-3 rounded-xl border-2 font-bold text-xs md:text-sm flex items-center justify-center gap-2 transition-all active:scale-95">
                <ArrowDownCircle class="size-4" /> Versamento
              </button>
              <button @click="movTipo = 'prelievo'"
                :class="movTipo === 'prelievo' ? 'bg-red-100 border-red-400 text-red-800' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'"
                class="py-2.5 px-3 rounded-xl border-2 font-bold text-xs md:text-sm flex items-center justify-center gap-2 transition-all active:scale-95">
                <ArrowUpCircle class="size-4" /> Prelievo
              </button>
            </div>

            <div class="flex flex-col sm:flex-row gap-2 mb-4">
              <div class="relative flex-1">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 font-black text-gray-400">€</span>
                <input type="number" v-model.number="movImporto" min="0.01" step="0.50"
                  class="w-full pl-8 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm font-bold focus:border-[var(--brand-primary)] focus:outline-none"
                  placeholder="Importo" />
              </div>
              <input type="text" v-model="movCausale"
                class="flex-[2] px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:border-[var(--brand-primary)] focus:outline-none"
                placeholder="Causale (es. Cambio moneta)" />
              <button @click="addMovimento"
                :class="movTipo === 'versamento' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'"
                class="text-white px-4 py-2.5 rounded-xl font-bold text-sm flex items-center gap-1.5 shrink-0 transition-colors active:scale-95 shadow-sm">
                <Plus class="size-4" /> Aggiungi
              </button>
            </div>

            <!-- Lista movimenti -->
            <div class="space-y-2 max-h-48 overflow-y-auto">
              <div v-if="store.movimentiCassa.length === 0" class="text-center text-gray-400 py-4 text-sm">
                Nessun movimento registrato.
              </div>
              <div v-for="mov in [...store.movimentiCassa].reverse()" :key="mov.id"
                class="flex items-center justify-between p-3 rounded-xl border text-sm font-bold"
                :class="mov.tipo === 'versamento' ? 'bg-emerald-50 border-emerald-100 text-emerald-800' : 'bg-red-50 border-red-100 text-red-800'">
                <div class="flex items-center gap-2">
                  <component :is="mov.tipo === 'versamento' ? ArrowDownCircle : ArrowUpCircle" class="size-4 shrink-0" />
                  <span class="font-medium text-xs md:text-sm">{{ mov.causale || mov.tipo }}</span>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <span class="font-black">{{ mov.tipo === 'versamento' ? '+' : '-' }}€{{ mov.importo.toFixed(2) }}</span>
                  <span class="text-[9px] opacity-60">{{ new Date(mov.timestamp).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- TAB: LETTURA X (PREVIEW) -->
        <div v-if="activeTab === 'lettura_x'" class="space-y-4">
          <div class="bg-amber-50 border border-amber-200 rounded-xl p-3 md:p-4 flex items-start gap-2 text-sm">
            <Eye class="size-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p class="font-bold text-amber-800">Lettura X – Anteprima Giornata</p>
              <p class="text-amber-700 text-xs mt-0.5">Riepilogo senza azzeramento. La giornata rimane aperta.</p>
            </div>
          </div>

          <div v-if="xSummary" class="space-y-3">
            <!-- Totale incassato -->
            <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 md:p-5">
              <p class="text-[10px] font-bold uppercase text-gray-400 mb-1">Totale Incassato</p>
              <p class="text-4xl md:text-5xl font-black theme-text">€{{ xSummary.totale_incassato.toFixed(2) }}</p>
            </div>

            <!-- Per metodo pagamento -->
            <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
              <h5 class="font-bold text-gray-600 text-xs uppercase tracking-wider mb-3 flex items-center gap-1">
                <CreditCard class="size-4" /> Per Metodo di Pagamento
              </h5>
              <div v-if="Object.keys(xSummary.by_method).length === 0" class="text-sm text-gray-400 italic">Nessuna transazione.</div>
              <div v-for="(val, method) in xSummary.by_method" :key="method"
                class="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
                <span class="font-bold text-sm text-gray-700 flex items-center gap-2">
                  <component :is="getMethodIcon(method)" class="size-4 text-gray-500" />
                  {{ method }}
                </span>
                <span class="font-black text-base text-gray-800">€{{ val.toFixed(2) }}</span>
              </div>
            </div>

            <!-- Coperti e scontrino medio -->
            <div class="grid grid-cols-3 gap-3">
              <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-3 md:p-4 text-center">
                <Users class="size-5 mx-auto mb-1 text-blue-500" />
                <p class="text-2xl md:text-3xl font-black text-gray-800">{{ xSummary.totale_coperti }}</p>
                <p class="text-[10px] font-bold text-gray-400 uppercase mt-0.5">Coperti</p>
              </div>
              <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-3 md:p-4 text-center">
                <Receipt class="size-5 mx-auto mb-1 text-purple-500" />
                <p class="text-2xl md:text-3xl font-black text-gray-800">{{ xSummary.num_scontrini }}</p>
                <p class="text-[10px] font-bold text-gray-400 uppercase mt-0.5">Scontrini</p>
              </div>
              <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-3 md:p-4 text-center">
                <TrendingUp class="size-5 mx-auto mb-1 text-emerald-500" />
                <p class="text-xl md:text-2xl font-black text-gray-800">€{{ xSummary.scontrino_medio.toFixed(2) }}</p>
                <p class="text-[10px] font-bold text-gray-400 uppercase mt-0.5">Scontrino Medio</p>
              </div>
            </div>

            <!-- Fondo e movimenti -->
            <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
              <h5 class="font-bold text-gray-600 text-xs uppercase tracking-wider mb-3 flex items-center gap-1">
                <Wallet class="size-4" /> Cassa Fisica
              </h5>
              <div class="space-y-2 text-sm">
                <div class="flex justify-between"><span class="text-gray-500">Fondo iniziale</span><span class="font-bold">€{{ xSummary.fondo_cassa.toFixed(2) }}</span></div>
                <div class="flex justify-between"><span class="text-gray-500">Movimenti netti</span><span class="font-bold" :class="xSummary.totale_movimenti >= 0 ? 'text-emerald-600' : 'text-red-600'">{{ xSummary.totale_movimenti >= 0 ? '+' : '' }}€{{ xSummary.totale_movimenti.toFixed(2) }}</span></div>
                <div class="flex justify-between border-t border-gray-100 pt-2 mt-1"><span class="font-bold text-gray-700">Fondo Finale Stimato</span><span class="font-black text-lg theme-text">€{{ xSummary.fondo_finale.toFixed(2) }}</span></div>
              </div>
            </div>
          </div>

          <button @click="runLetturax"
            class="w-full py-4 theme-bg text-white rounded-2xl font-bold shadow-md hover:opacity-90 transition-opacity active:scale-95 flex items-center justify-center gap-2 text-sm md:text-base">
            <RefreshCw class="size-5" /> Aggiorna Lettura X
          </button>
        </div>

        <!-- TAB: LETTURA Z (CHIUSURA) -->
        <div v-if="activeTab === 'lettura_z'" class="space-y-4">
          <div class="bg-red-50 border border-red-200 rounded-xl p-3 md:p-4 flex items-start gap-2 text-sm">
            <AlertTriangle class="size-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <p class="font-bold text-red-800">Lettura Z – Chiusura Giornata</p>
              <p class="text-red-700 text-xs mt-0.5">Azzera le transazioni e registra la chiusura. Operazione irreversibile.</p>
            </div>
          </div>

          <!-- Storico chiusure -->
          <div v-if="store.chiusureGiornaliere.length > 0" class="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
            <h5 class="font-bold text-gray-600 text-xs uppercase tracking-wider mb-3 flex items-center gap-1">
              <History class="size-4" /> Chiusure Precedenti
            </h5>
            <div class="space-y-2 max-h-40 overflow-y-auto">
              <div v-for="(ch, idx) in [...store.chiusureGiornaliere].reverse()" :key="idx"
                class="flex justify-between items-center p-3 bg-gray-50 rounded-xl border border-gray-100 text-sm">
                <div>
                  <p class="font-bold text-gray-800">Chiusura Z #{{ store.chiusureGiornaliere.length - idx }}</p>
                  <p class="text-[10px] text-gray-400">{{ new Date(ch.timestamp).toLocaleString('it-IT') }}</p>
                </div>
                <div class="text-right">
                  <p class="font-black text-base theme-text">€{{ ch.totale_incassato.toFixed(2) }}</p>
                  <p class="text-[10px] text-gray-400">{{ ch.num_scontrini }} scontrini</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Preview prima di chiudere -->
          <div v-if="zPreview" class="bg-white rounded-2xl border border-red-200 shadow-sm p-4">
            <h5 class="font-bold text-red-600 text-xs uppercase tracking-wider mb-3 flex items-center gap-1">
              <ClipboardList class="size-4" /> Riepilogo da Chiudere
            </h5>
            <div class="space-y-1 text-sm">
              <div class="flex justify-between"><span class="text-gray-500">Totale incassato</span><span class="font-black theme-text text-base">€{{ zPreview.totale_incassato.toFixed(2) }}</span></div>
              <div v-for="(val, method) in zPreview.by_method" :key="method" class="flex justify-between text-xs">
                <span class="text-gray-400 ml-3">– {{ method }}</span>
                <span class="font-bold">€{{ val.toFixed(2) }}</span>
              </div>
              <div class="flex justify-between pt-1 border-t border-gray-100 mt-1"><span class="text-gray-500">Coperti totali</span><span class="font-bold">{{ zPreview.totale_coperti }}</span></div>
              <div class="flex justify-between"><span class="text-gray-500">Scontrino medio</span><span class="font-bold">€{{ zPreview.scontrino_medio.toFixed(2) }}</span></div>
            </div>
          </div>

          <button @click="previewZ"
            class="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-2xl font-bold border border-gray-200 transition-colors active:scale-95 flex items-center justify-center gap-2 text-sm">
            <Eye class="size-5" /> Anteprima Chiusura
          </button>

          <button @click="confirmZ"
            class="w-full py-4 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-bold shadow-md transition-colors active:scale-95 flex items-center justify-center gap-2 text-sm md:text-base">
            <Lock class="size-5" /> Esegui Lettura Z (Chiudi Giornata)
          </button>
        </div>

      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import {
  X, Landmark, Wallet, ArrowLeftRight, ArrowDownCircle, ArrowUpCircle, Plus,
  Eye, AlertTriangle, Lock, RefreshCw, Save, TrendingUp, CreditCard, Users,
  Receipt, History, ClipboardList,
} from 'lucide-vue-next';
import { Banknote } from 'lucide-vue-next';
import { useAppStore } from '../store/index.js';

defineProps({ modelValue: Boolean });
defineEmits(['update:modelValue']);

const store = useAppStore();

const tabs = [
  { id: 'fondo', label: 'Fondo Cassa', icon: Wallet },
  { id: 'lettura_x', label: 'Lettura X', icon: Eye },
  { id: 'lettura_z', label: 'Lettura Z', icon: Lock },
];

const activeTab = ref('fondo');

// ── Fondo Cassa ────────────────────────────────────────────────────────────
const fondoInput = ref(store.fondoCassa);

function saveFondo() {
  if (fondoInput.value >= 0) {
    store.setFondoCassa(fondoInput.value);
  }
}

// ── Movimenti ──────────────────────────────────────────────────────────────
const movTipo = ref('versamento');
const movImporto = ref(0);
const movCausale = ref('');

function addMovimento() {
  if (!movImporto.value || movImporto.value <= 0) return;
  store.addMovimentoCassa(movTipo.value, movImporto.value, movCausale.value || movTipo.value);
  movImporto.value = 0;
  movCausale.value = '';
}

// ── Lettura X ──────────────────────────────────────────────────────────────
const xSummary = ref(null);

function runLetturax() {
  xSummary.value = store.chiusuraX();
}

// ── Lettura Z ──────────────────────────────────────────────────────────────
const zPreview = ref(null);

function previewZ() {
  zPreview.value = store.chiusuraX();
}

function confirmZ() {
  if (!zPreview.value) {
    zPreview.value = store.chiusuraX();
  }
  if (!confirm(`Confermi la Chiusura Z? Totale: €${zPreview.value.totale_incassato.toFixed(2)}. Questa operazione è irreversibile.`)) return;
  store.chiusuraZ();
  zPreview.value = null;
  fondoInput.value = store.fondoCassa;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function getMethodIcon(methodLabel) {
  const m = store.config.paymentMethods.find(x => x.label === methodLabel);
  if (!m) return Banknote;
  return m.icon === 'credit-card' ? CreditCard : Banknote;
}
</script>
