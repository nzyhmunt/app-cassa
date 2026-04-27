<template>
  <!-- MODAL: SYNC MONITOR -->
  <div
    v-if="modelValue"
    class="fixed inset-0 z-[95] bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4"
    @click.self="$emit('update:modelValue', false)"
  >
    <div class="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[94dvh] md:max-h-[88dvh]">

      <!-- Header -->
      <div class="bg-gray-50 border-b border-gray-200 p-4 md:p-5 flex justify-between items-center shrink-0">
        <h3 class="font-bold text-base md:text-lg flex items-center gap-2 text-gray-800">
          <Activity class="size-4 md:size-5 text-gray-500" />
          Activity Monitor
        </h3>
        <button
          @click="$emit('update:modelValue', false)"
          class="text-gray-400 hover:text-gray-800 bg-gray-200 hover:bg-gray-300 rounded-full p-1.5 transition-colors active:scale-95"
          aria-label="Chiudi"
        >
          <X class="size-5" />
        </button>
      </div>

      <!-- Content -->
      <div class="overflow-y-auto flex-1 p-4 md:p-6 space-y-4 bg-white pb-8 md:pb-6">

        <!-- Sezione 1: Stato Real-time -->
        <div class="space-y-2">
          <span class="block text-xs font-bold text-gray-600 uppercase tracking-wider">Stato Real-time</span>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <!-- Online/Offline -->
            <div
              class="rounded-2xl border px-3 py-2.5 flex items-center gap-2"
              :class="isOnline ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'"
            >
              <span
                class="inline-block size-2 rounded-full shrink-0"
                :class="isOnline ? 'bg-emerald-500' : 'bg-red-500'"
              ></span>
              <div class="min-w-0">
                <p class="text-[10px] font-bold text-gray-500 leading-none mb-0.5">Rete</p>
                <p class="text-xs font-bold truncate" :class="isOnline ? 'text-emerald-700' : 'text-red-700'">
                  {{ isOnline ? 'Online' : 'Offline' }}
                </p>
              </div>
            </div>

            <!-- WS Connected -->
            <div
              class="rounded-2xl border px-3 py-2.5 flex items-center gap-2"
              :class="wsConnected ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'"
            >
              <span
                class="inline-block size-2 rounded-full shrink-0"
                :class="wsConnected ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'"
              ></span>
              <div class="min-w-0">
                <p class="text-[10px] font-bold text-gray-500 leading-none mb-0.5">WebSocket</p>
                <p class="text-xs font-bold truncate" :class="wsConnected ? 'text-emerald-700' : 'text-gray-500'">
                  {{ wsConnected ? 'Connesso' : 'Inattivo' }}
                </p>
              </div>
            </div>

            <!-- Last Push -->
            <div class="rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2.5 flex items-center gap-2">
              <ArrowUpCircle class="size-3.5 text-purple-400 shrink-0" />
              <div class="min-w-0">
                <p class="text-[10px] font-bold text-gray-500 leading-none mb-0.5">Ultimo Push</p>
                <p class="text-xs font-bold text-gray-700 truncate">{{ lastPushLabel }}</p>
              </div>
            </div>

            <!-- Last Pull -->
            <div class="rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2.5 flex items-center gap-2">
              <ArrowDownCircle class="size-3.5 text-sky-400 shrink-0" />
              <div class="min-w-0">
                <p class="text-[10px] font-bold text-gray-500 leading-none mb-0.5">Ultimo Pull</p>
                <p class="text-xs font-bold text-gray-700 truncate">{{ lastPullLabel }}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Sezione 2: Activity Log -->
        <div class="space-y-2">
          <!-- Log header with export/clear -->
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-gray-600 uppercase tracking-wider">
              Activity Log
              <span v-if="filteredLogs.length !== logs.length" class="normal-case text-[10px] font-normal ml-1 text-gray-400">
                ({{ filteredLogs.length }}/{{ logs.length }})
              </span>
              <span v-else-if="logs.length > 0" class="normal-case text-[10px] font-normal ml-1 text-gray-400">
                ({{ logs.length }})
              </span>
            </span>
            <div class="flex items-center gap-1.5">
              <button
                @click="exportSession"
                class="flex items-center gap-1 text-[10px] font-bold text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded-lg transition-colors active:scale-95"
                title="Esporta tutti i log come file JSON"
              >
                <FileDown class="size-3" />
                Esporta
              </button>
              <button
                @click="clearLogs"
                class="flex items-center gap-1 text-[10px] font-bold text-gray-500 hover:text-red-600 bg-gray-100 hover:bg-red-50 px-2 py-1 rounded-lg transition-colors active:scale-95"
                title="Cancella tutti i log"
              >
                <Trash2 class="size-3" />
                Svuota
              </button>
            </div>
          </div>

          <!-- Filter bar -->
          <div class="flex flex-wrap gap-2 items-center">
            <!-- Status filter -->
            <div class="flex gap-1 bg-gray-100 p-1 rounded-xl shrink-0">
              <button
                v-for="opt in STATUS_FILTER_OPTS"
                :key="opt.value"
                @click="filterStatus = opt.value"
                class="px-2.5 py-1.5 text-[10px] font-bold rounded-lg transition-all active:scale-95"
                :class="filterStatus === opt.value
                  ? 'bg-[var(--brand-primary)] text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'"
              >{{ opt.label }}</button>
            </div>

            <!-- Type filter -->
            <div class="flex gap-1 bg-gray-100 p-1 rounded-xl shrink-0">
              <button
                v-for="opt in TYPE_FILTER_OPTS"
                :key="opt.value"
                @click="filterType = opt.value"
                class="px-2.5 py-1.5 text-[10px] font-bold rounded-lg transition-all flex items-center gap-1 active:scale-95"
                :class="filterType === opt.value
                  ? 'bg-[var(--brand-primary)] text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'"
              >
                <component :is="opt.icon" class="size-2.5" />
                {{ opt.label }}
              </button>
            </div>

            <!-- Text search -->
            <div class="flex-1 min-w-[120px] relative">
              <Search class="size-3 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                v-model="searchText"
                type="text"
                placeholder="Cerca endpoint, collezione o ID…"
                class="w-full pl-7 pr-2.5 py-1.5 text-[10px] border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] placeholder:text-gray-400"
              />
            </div>
          </div>

          <!-- Empty state -->
          <div v-if="logs.length === 0" class="text-center py-10 text-gray-400">
            <Activity class="size-8 mx-auto mb-2 opacity-30" />
            <p class="text-sm">Nessuna attività registrata</p>
            <p class="text-[10px] mt-1">I log appariranno qui dopo la prima sincronizzazione</p>
          </div>
          <div v-else-if="filteredLogs.length === 0" class="text-center py-8 text-gray-400">
            <Search class="size-7 mx-auto mb-2 opacity-30" />
            <p class="text-sm">Nessun risultato</p>
            <p class="text-[10px] mt-1">Modifica i filtri o la ricerca</p>
          </div>

          <!-- Log list -->
          <div v-else class="space-y-1.5">
            <button
              v-for="log in filteredLogs"
              :key="log.id"
              @click="selectLog(log)"
              class="w-full text-left rounded-2xl border px-3 py-2.5 transition-colors active:scale-[0.99]"
              :class="logRowClass(log)"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="flex items-center gap-1.5 min-w-0">
                  <!-- Direction icon -->
                  <component
                    :is="directionIcon(log)"
                    class="size-3.5 shrink-0"
                    :class="directionIconClass(log)"
                  />
                  <!-- Type badge -->
                  <span
                    class="shrink-0 inline-flex items-center justify-center rounded-lg px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                    :class="logTypeBadgeClass(log)"
                  >{{ log.type }}</span>
                  <span class="text-xs font-semibold text-gray-700 truncate">{{ log.endpoint ?? log.collection ?? '—' }}</span>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <!-- Status dot -->
                  <span
                    class="inline-block size-1.5 rounded-full shrink-0"
                    :class="statusDotClass(log)"
                  ></span>
                  <span class="text-[10px] text-gray-400">{{ formatTs(log.timestamp) }}</span>
                </div>
              </div>
              <div class="mt-1 flex items-center gap-3 text-[10px]" :class="logMetaClass(log)">
                <span v-if="log.collection && log.collection !== log.endpoint">{{ log.collection }}</span>
                <span v-if="log.recordCount != null">{{ log.recordCount }} rec</span>
                <span v-if="log.durationMs != null">{{ log.durationMs }}ms</span>
                <span
                  v-if="log.statusCode != null"
                  class="font-bold"
                  :class="log.status === 'error' ? '' : 'font-normal'"
                >HTTP {{ log.statusCode }}</span>
                <span v-if="log.status === 'error' && !log.statusCode" class="font-bold">Network Error</span>
              </div>
            </button>
          </div>
        </div>
      </div>

      <!-- Detail panel: shown when a log is selected -->
      <transition name="slide-up">
        <div
          v-if="selectedLog"
          class="border-t border-gray-200 bg-gray-50 shrink-0 max-h-[45dvh] flex flex-col"
        >
          <!-- Detail header -->
          <div class="flex items-center justify-between p-3 border-b border-gray-200 shrink-0">
            <span class="text-xs font-bold text-gray-700 flex items-center gap-1.5 min-w-0">
              <component :is="directionIcon(selectedLog)" class="size-3.5 shrink-0" :class="directionIconClass(selectedLog)" />
              <span class="truncate">{{ selectedLog.endpoint ?? selectedLog.collection ?? '—' }}</span>
              <span
                class="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-lg"
                :class="logTypeBadgeClass(selectedLog)"
              >{{ selectedLog.type }}</span>
            </span>
            <div class="flex items-center gap-1.5 shrink-0">
              <!-- Copy technical block -->
              <button
                @click="copyTechBlock"
                class="flex items-center gap-1 text-[10px] font-bold text-gray-500 hover:text-gray-700 bg-white hover:bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-lg transition-colors active:scale-95"
                title="Copia blocco tecnico completo"
              >
                <ClipboardList class="size-3" />
                {{ copyBlockLabel }}
              </button>
              <button
                @click="selectedLog = null"
                class="text-gray-400 hover:text-gray-700 bg-gray-200 hover:bg-gray-300 rounded-full p-1 transition-colors active:scale-95"
              >
                <X class="size-3.5" />
              </button>
            </div>
          </div>

          <!-- Detail content -->
          <div class="overflow-y-auto flex-1 p-3 space-y-3">

            <!-- Request pane -->
            <div>
              <div class="flex items-center justify-between mb-1">
                <span class="text-[10px] font-bold text-gray-600 uppercase tracking-wider">Request / Payload</span>
                <button
                  @click="copyRequest"
                  class="flex items-center gap-1 text-[10px] font-bold text-gray-500 hover:text-gray-700 bg-white hover:bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-lg transition-colors active:scale-95"
                >
                  <Copy class="size-3" />
                  {{ copyRequestLabel }}
                </button>
              </div>
              <pre class="bg-white border border-gray-200 rounded-2xl p-3 text-[10px] text-gray-700 overflow-x-auto max-h-32 whitespace-pre-wrap break-all font-mono">{{ formatJSON(selectedLog.payload) }}</pre>
            </div>

            <!-- Response pane -->
            <div>
              <div class="flex items-center justify-between mb-1">
                <span class="text-[10px] font-bold text-gray-600 uppercase tracking-wider">Response</span>
                <button
                  @click="copyResponse"
                  class="flex items-center gap-1 text-[10px] font-bold text-gray-500 hover:text-gray-700 bg-white hover:bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-lg transition-colors active:scale-95"
                >
                  <Copy class="size-3" />
                  {{ copyResponseLabel }}
                </button>
              </div>
              <pre
                class="bg-white border rounded-2xl p-3 text-[10px] overflow-x-auto max-h-32 whitespace-pre-wrap break-all font-mono"
                :class="selectedLog.status === 'error' ? 'border-red-200 text-red-700' : 'border-gray-200 text-gray-700'"
              >{{ formatJSON(selectedLog.response) }}</pre>
            </div>
          </div>
        </div>
      </transition>

    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import {
  Activity, X, ArrowUpCircle, ArrowDownCircle, RefreshCw,
  FileDown, Trash2, Search, Copy, ClipboardList,
} from 'lucide-vue-next';
import { useDirectusSync } from '../../composables/useDirectusSync.js';
import { getSyncLogs, clearSyncLogs, exportSyncLogs, _BC_CHANNEL } from '../../store/persistence/syncLogs.js';

const props = defineProps({
  modelValue: Boolean,
});
defineEmits(['update:modelValue']);

const sync = useDirectusSync();

// ── Filter options (static constants) ────────────────────────────────────────

const STATUS_FILTER_OPTS = [
  { value: 'all',     label: 'Tutti' },
  { value: 'success', label: 'OK' },
  { value: 'errors',  label: 'Errori' },
];

const TYPE_FILTER_OPTS = [
  { value: 'all',  label: 'Tutti',      icon: Activity },
  { value: 'PUSH', label: 'Push',       icon: ArrowUpCircle },
  { value: 'PULL', label: 'Pull',       icon: ArrowDownCircle },
  { value: 'WS',   label: 'WebSocket',  icon: RefreshCw },
];

// ── Reactive state ────────────────────────────────────────────────────────────

const logs       = ref([]);
const selectedLog = ref(null);
const isOnline   = ref(typeof navigator !== 'undefined' ? navigator.onLine : true);

const filterStatus = ref('all');
const filterType   = ref('all');
const searchText   = ref('');

const copyRequestLabel  = ref('Copia');
const copyResponseLabel = ref('Copia');
const copyBlockLabel    = ref('Blocco');

// ── Computed ─────────────────────────────────────────────────────────────────

const wsConnected = computed(() => sync.wsConnected?.value ?? false);

const lastPushLabel = computed(() => {
  const ts = sync.lastPushAt?.value;
  return ts ? formatTs(ts) : '—';
});

const lastPullLabel = computed(() => {
  const ts = sync.lastPullAt?.value;
  return ts ? formatTs(ts) : '—';
});

const filteredLogs = computed(() => {
  let result = logs.value;

  // Status filter
  if (filterStatus.value === 'success') result = result.filter(l => l.status === 'success');
  else if (filterStatus.value === 'errors') result = result.filter(l => l.status !== 'success');

  // Type filter
  if (filterType.value !== 'all') result = result.filter(l => l.type === filterType.value);

  // Text search — endpoint, collection, or id
  const q = searchText.value.trim().toLowerCase();
  if (q) {
    result = result.filter(l =>
      (l.endpoint ?? '').toLowerCase().includes(q) ||
      (l.collection ?? '').toLowerCase().includes(q) ||
      String(l.id ?? '').includes(q),
    );
  }

  return result;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTs(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

function formatJSON(value) {
  if (value == null) return 'null';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Determines the severity level for a log entry used for colour coding.
 * Returns 'critical' (5xx / network error), 'warning' (4xx / unexpected),
 * or 'success'.
 */
function _severity(log) {
  if (log.status === 'success') return 'success';
  const code = log.statusCode;
  if (code == null || code >= 500) return 'critical'; // network error or server-side
  if (code >= 400) return 'warning';                  // client/validation error
  // Fallback: non-success status with an unexpected code (e.g. 3xx treated as error).
  return 'warning';
}

function logRowClass(log) {
  if (selectedLog.value?.id === log.id) {
    return 'border-[var(--brand-primary)] bg-[var(--brand-primary)]/5';
  }
  const sev = _severity(log);
  if (sev === 'critical') return 'border-red-200 bg-red-50 hover:bg-red-100';
  if (sev === 'warning')  return 'border-orange-200 bg-orange-50 hover:bg-orange-100';
  return 'border-gray-100 bg-white hover:bg-gray-50';
}

function statusDotClass(log) {
  const sev = _severity(log);
  if (sev === 'critical') return 'bg-red-500';
  if (sev === 'warning')  return 'bg-orange-400';
  return 'bg-emerald-500';
}

function logMetaClass(log) {
  const sev = _severity(log);
  if (sev === 'critical') return 'text-red-600';
  if (sev === 'warning')  return 'text-orange-600';
  return 'text-gray-400';
}

function directionIcon(log) {
  if (log.type === 'WS') return RefreshCw;
  if (log.direction === 'IN') return ArrowDownCircle;
  return ArrowUpCircle;
}

function directionIconClass(log) {
  if (log.type === 'WS') return 'text-emerald-500';
  if (log.direction === 'IN') return 'text-sky-500';
  return 'text-purple-500';
}

function logTypeBadgeClass(log) {
  if (log.type === 'PULL') return 'bg-sky-100 text-sky-700';
  if (log.type === 'WS')   return 'bg-emerald-100 text-emerald-700';
  return 'bg-purple-100 text-purple-700';
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function loadLogs() {
  logs.value = await getSyncLogs();
}

function selectLog(log) {
  selectedLog.value = selectedLog.value?.id === log.id ? null : log;
}

async function clearLogs() {
  await clearSyncLogs();
  logs.value = [];
  selectedLog.value = null;
}

async function exportSession() {
  const data = await exportSyncLogs();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.href = url;
  a.download = `sync-session-${ts}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function _copyToClipboard(text, labelRef, resetLabel) {
  try {
    await navigator.clipboard.writeText(text);
    labelRef.value = 'Copiato!';
    setTimeout(() => { labelRef.value = resetLabel; }, 2000);
  } catch {
    labelRef.value = 'Errore';
    setTimeout(() => { labelRef.value = resetLabel; }, 2000);
  }
}

function copyRequest() {
  _copyToClipboard(formatJSON(selectedLog.value?.payload), copyRequestLabel, 'Copia');
}

function copyResponse() {
  _copyToClipboard(formatJSON(selectedLog.value?.response), copyResponseLabel, 'Copia');
}

/**
 * Copies a pre-formatted technical text block containing all essential debug
 * information for the selected log entry (useful when pasting into a support
 * ticket or chat message).
 */
function copyTechBlock() {
  const log = selectedLog.value;
  if (!log) return;
  const lines = [
    '=== Sync Log ===',
    `ID:         ${log.id ?? '—'}`,
    `Timestamp:  ${log.timestamp ?? '—'}`,
    `Direction:  ${log.direction ?? '—'}  Type: ${log.type ?? '—'}`,
    `Endpoint:   ${log.endpoint ?? '—'}`,
    `Collection: ${log.collection ?? '—'}`,
    `Status:     ${log.status ?? '—'}${log.statusCode != null ? `  HTTP ${log.statusCode}` : '  (network)'}`,
    `Duration:   ${log.durationMs != null ? `${log.durationMs}ms` : '—'}`,
    `Records:    ${log.recordCount != null ? log.recordCount : '—'}`,
    '',
    '--- REQUEST ---',
    formatJSON(log.payload),
    '',
    '--- RESPONSE ---',
    formatJSON(log.response),
  ];
  _copyToClipboard(lines.join('\n'), copyBlockLabel, 'Blocco');
}

// ── BroadcastChannel (cross-tab reactivity) ───────────────────────────────────

/** @type {BroadcastChannel|null} */
let _bc = null;

function _initBC() {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    _bc = new BroadcastChannel(_BC_CHANNEL);
    _bc.onmessage = (e) => {
      if (e.data?.type === 'changed') loadLogs();
    };
  } catch (e) {
    console.warn('[SyncMonitor] BroadcastChannel init failed — cross-tab sync unavailable:', e);
    _bc = null;
  }
}

function _closeBC() {
  _bc?.close();
  _bc = null;
}

// ── Lifecycle & event listeners ───────────────────────────────────────────────

function _onLogsChanged() { loadLogs(); }
function _onOnline()  { isOnline.value = true; }
function _onOffline() { isOnline.value = false; }

onMounted(() => {
  loadLogs();
  _initBC();
  if (typeof window !== 'undefined') {
    window.addEventListener('sync-logs:changed', _onLogsChanged);
    window.addEventListener('online',  _onOnline);
    window.addEventListener('offline', _onOffline);
  }
});

onUnmounted(() => {
  _closeBC();
  if (typeof window !== 'undefined') {
    window.removeEventListener('sync-logs:changed', _onLogsChanged);
    window.removeEventListener('online',  _onOnline);
    window.removeEventListener('offline', _onOffline);
  }
});
</script>

<style scoped>
.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(16px);
  opacity: 0;
}
</style>
