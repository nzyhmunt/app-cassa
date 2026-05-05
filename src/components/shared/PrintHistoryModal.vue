<template>
  <!-- MODAL: CRONOLOGIA STAMPE -->
  <div v-if="modelValue" class="fixed inset-0 z-[95] bg-black/70 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4">
    <div class="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden max-h-[92dvh] md:max-h-[85dvh]">

      <!-- Header -->
      <div class="bg-gray-900 text-white px-5 py-4 flex justify-between items-center shrink-0">
        <h3 class="font-bold text-base flex items-center gap-2">
          <History class="size-5 theme-text" />
          Cronologia Stampe
          <span v-if="orderStore.printLog.length" class="text-xs font-bold bg-white/10 px-2 py-0.5 rounded-full">{{ orderStore.printLog.length }}</span>
        </h3>
        <div class="flex items-center gap-2">
          <button
            v-if="orderStore.printLog.length > 0"
            @click="confirmingClear = !confirmingClear"
            class="text-[10px] font-bold bg-red-500/20 hover:bg-red-500/30 text-red-300 px-2.5 py-1.5 rounded-lg transition-colors active:scale-95"
          >
            {{ confirmingClear ? 'Annulla' : 'Svuota' }}
          </button>
          <button @click="$emit('update:modelValue', false)" class="bg-white/10 hover:bg-white/20 p-1.5 rounded-full transition-colors active:scale-95">
            <X class="size-4" />
          </button>
        </div>
      </div>

      <!-- Confirm clear banner -->
      <div v-if="confirmingClear" class="bg-red-50 border-b border-red-200 p-3 flex items-center gap-3 shrink-0">
        <span class="text-xs text-red-700 font-bold flex-1">Eliminare tutta la cronologia stampe?</span>
        <button @click="clearLog" class="text-xs font-bold bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg active:scale-95 transition-colors">
          Elimina
        </button>
      </div>

      <!-- Empty state -->
      <div v-if="orderStore.printLog.length === 0" class="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400 p-8">
        <Printer class="size-12 opacity-30" />
        <p class="text-sm font-medium">Nessuna stampa registrata.</p>
      </div>

      <!-- Log list -->
      <div v-else class="flex-1 overflow-y-auto divide-y divide-gray-100">
        <div
          v-for="entry in orderStore.printLog"
          :key="entry.logId"
          class="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
        >
          <!-- Type badge -->
          <div class="shrink-0 mt-0.5">
            <span
              class="inline-flex items-center gap-1 text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md"
              :class="badgeClass(entry.printType)"
            >
              <component :is="badgeIcon(entry.printType)" class="size-2.5" />
              {{ badgeLabel(entry.printType) }}
            </span>
          </div>

          <!-- Info -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="font-bold text-gray-800 text-xs truncate">{{ entry.table || '—' }}</span>
              <span v-if="entry.isReprint" class="text-[9px] font-bold bg-amber-100 text-amber-700 px-1 rounded">ristampa</span>
              <!-- Job status badge -->
              <span
                class="text-[9px] font-bold px-1 rounded ml-auto"
                :class="statusBadgeClass(entry.status)"
                :title="entry.errorMessage ?? ''"
              >{{ statusLabel(entry.status) }}</span>
            </div>
            <p class="text-[10px] text-gray-500 truncate">
              <Printer class="size-2.5 inline mr-0.5" />{{ entry.printerName }}
              <span class="mx-1">·</span>
              {{ formatTime(entry.timestamp) }}
              <span v-if="entry.status === 'error' && entry.errorMessage" class="ml-1 text-red-500 truncate">— {{ entry.errorMessage }}</span>
            </p>
          </div>

          <!-- Reprint button (disabled when payload was stripped from persistence) -->
          <button
            @click="openReprint(entry)"
            :disabled="!entry.payload"
            class="shrink-0 text-[10px] font-bold px-2.5 py-1.5 rounded-lg border transition-all"
            :class="entry.payload
              ? 'text-[var(--brand-primary)] hover:bg-[var(--brand-primary)]/10 border-[var(--brand-primary)]/30 active:scale-95'
              : 'text-gray-300 border-gray-200 cursor-not-allowed'"
            :title="entry.payload ? 'Ristampa' : 'Payload non disponibile dopo riavvio — impossibile ristampare'"
            :aria-label="entry.payload ? 'Ristampa' : 'Ristampa non disponibile'"
          >
            <RefreshCw class="size-3" />
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Reprint printer-selector modal -->
  <div v-if="reprintEntry" class="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4">
    <div class="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col max-h-[80dvh]">
      <div class="bg-gray-900 text-white px-5 py-4 flex justify-between items-center shrink-0">
        <h3 class="font-bold text-sm flex items-center gap-2"><RefreshCw class="size-4 theme-text" /> Ristampa</h3>
        <button @click="reprintEntry = null" class="bg-white/10 hover:bg-white/20 p-1.5 rounded-full transition-colors active:scale-95"><X class="size-4" /></button>
      </div>
      <div class="p-4 overflow-y-auto space-y-2">
        <p class="text-xs text-gray-500 mb-3">Seleziona la stampante su cui inviare nuovamente questo job:</p>
        <!-- Same printer -->
        <button
          @click="confirmReprint(null)"
          class="w-full text-left px-3 py-2.5 rounded-xl border-2 border-[var(--brand-primary)] bg-[var(--brand-primary)]/5 hover:bg-[var(--brand-primary)]/10 transition-colors active:scale-95 flex items-center gap-2"
        >
          <Printer class="size-4 theme-text shrink-0" />
          <div class="min-w-0">
            <p class="text-sm font-bold text-gray-800">{{ reprintEntry.printerName }}</p>
            <p class="text-[10px] text-gray-400 truncate">{{ reprintEntry.printerUrl }} (stessa)</p>
          </div>
        </button>
        <!-- Other configured printers -->
        <template v-for="p in otherPrinters" :key="p.id ?? p.url">
          <button
            @click="confirmReprint(p.url)"
            class="w-full text-left px-3 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors active:scale-95 flex items-center gap-2"
          >
            <Printer class="size-4 text-gray-400 shrink-0" />
            <div class="min-w-0">
              <p class="text-sm font-bold text-gray-700">{{ p.name ?? p.id }}</p>
              <p class="text-[10px] text-gray-400 truncate">{{ p.url }}</p>
            </div>
          </button>
        </template>
        <div v-if="otherPrinters.length === 0 && configuredPrinters.length <= 1" class="text-xs text-gray-400 text-center pt-1">
          Nessun'altra stampante configurata.
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { History, Printer, X, RefreshCw, ArrowRightLeft, FileText, ClipboardList } from 'lucide-vue-next';
import { useConfigStore, useOrderStore } from '../../store/index.js';
import { reprintJob } from '../../composables/usePrintQueue.js';

const props = defineProps({ modelValue: Boolean });
const emit = defineEmits(['update:modelValue']);

const configStore = useConfigStore();
const orderStore = useOrderStore();
const runtimeConfig = computed(() => configStore.config ?? {});

const confirmingClear = ref(false);
const reprintEntry = ref(null);

// Reset transient modal state whenever the modal is closed
watch(() => props.modelValue, (open) => {
  if (!open) {
    confirmingClear.value = false;
    reprintEntry.value = null;
  }
});

function clearLog() {
  orderStore.clearPrintLog();
  confirmingClear.value = false;
}

function openReprint(entry) {
  reprintEntry.value = entry;
}

function confirmReprint(overrideUrl) {
  if (!reprintEntry.value) return;
  reprintJob(reprintEntry.value, overrideUrl ?? null);
  reprintEntry.value = null;
}

/** All configured printers except the one already used for the selected entry. */
const configuredPrinters = computed(() => runtimeConfig.value.printers ?? []);
const otherPrinters = computed(() => {
  if (!reprintEntry.value) return [];
  return configuredPrinters.value.filter(
    p => p?.url && p.url !== reprintEntry.value.printerUrl,
  );
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString(runtimeConfig.value.locale ?? 'it-IT', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      timeZone: runtimeConfig.value.timezone ?? 'Europe/Rome',
    });
  } catch {
    return iso ?? '';
  }
}

function badgeLabel(type) {
  if (type === 'order')      return 'Comanda';
  if (type === 'table_move') return 'Sposta';
  if (type === 'pre_bill')   return 'Preconto';
  return type ?? '—';
}

function badgeClass(type) {
  if (type === 'order')      return 'bg-emerald-100 text-emerald-700';
  if (type === 'table_move') return 'bg-blue-100 text-blue-700';
  if (type === 'pre_bill')   return 'bg-amber-100 text-amber-700';
  return 'bg-gray-100 text-gray-600';
}

function badgeIcon(type) {
  if (type === 'order')      return ClipboardList;
  if (type === 'table_move') return ArrowRightLeft;
  if (type === 'pre_bill')   return FileText;
  return Printer;
}

function statusLabel(status) {
  if (status === 'pending')  return '⏳ in coda';
  if (status === 'queued')   return '📤 inviato a server';
  if (status === 'printing') return '🖨 stampa…';
  if (status === 'done')     return '✓ inviato';
  if (status === 'error')    return '✗ errore';
  return status ?? '';
}

function statusBadgeClass(status) {
  if (status === 'pending')  return 'bg-gray-100 text-gray-500';
  if (status === 'queued')   return 'bg-amber-100 text-amber-700';
  if (status === 'printing') return 'bg-blue-100 text-blue-600';
  if (status === 'done')     return 'bg-emerald-100 text-emerald-700';
  if (status === 'error')    return 'bg-red-100 text-red-600';
  return 'bg-gray-100 text-gray-500';
}
</script>
