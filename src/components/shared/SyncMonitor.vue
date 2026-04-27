<template>
  <!-- MODAL: SYNC MONITOR -->
  <div
    v-if="modelValue"
    class="fixed inset-0 z-[95] bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4"
    @click.self="$emit('update:modelValue', false)"
  >
    <div class="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[94dvh] md:max-h-[88dvh]">

      <!-- Header -->
      <div class="bg-gray-50 border-b border-gray-200 p-4 flex justify-between items-center shrink-0">
        <h3 class="font-bold text-base flex items-center gap-2 text-gray-800">
          <Activity class="size-4 text-gray-500" />
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
      <div class="overflow-y-auto flex-1 p-4 space-y-4 bg-white pb-6">

        <!-- Sezione 1: Stato Real-time -->
        <div class="space-y-2">
          <span class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Stato Real-time</span>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <!-- Online/Offline -->
            <div
              class="rounded-xl border px-3 py-2.5 flex items-center gap-2"
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
              class="rounded-xl border px-3 py-2.5 flex items-center gap-2"
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
            <div class="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 flex items-center gap-2">
              <Upload class="size-3.5 text-gray-400 shrink-0" />
              <div class="min-w-0">
                <p class="text-[10px] font-bold text-gray-500 leading-none mb-0.5">Ultimo Push</p>
                <p class="text-xs font-bold text-gray-700 truncate">{{ lastPushLabel }}</p>
              </div>
            </div>

            <!-- Last Pull -->
            <div class="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 flex items-center gap-2">
              <Download class="size-3.5 text-gray-400 shrink-0" />
              <div class="min-w-0">
                <p class="text-[10px] font-bold text-gray-500 leading-none mb-0.5">Ultimo Pull</p>
                <p class="text-xs font-bold text-gray-700 truncate">{{ lastPullLabel }}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Sezione 2: Activity Log -->
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-gray-500 uppercase tracking-wider">Activity Log</span>
            <div class="flex items-center gap-1.5">
              <button
                @click="exportSession"
                class="flex items-center gap-1 text-[10px] font-bold text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded-lg transition-colors active:scale-95"
                title="Esporta tutti i log come file JSON"
              >
                <FileDown class="size-3" />
                Esporta Sessione
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

          <!-- Empty state -->
          <div v-if="logs.length === 0" class="text-center py-10 text-gray-400">
            <Activity class="size-8 mx-auto mb-2 opacity-30" />
            <p class="text-sm">Nessuna attività registrata</p>
            <p class="text-[10px] mt-1">I log appariranno qui dopo la prima sincronizzazione</p>
          </div>

          <!-- Log list -->
          <div v-else class="space-y-1.5">
            <button
              v-for="log in logs"
              :key="log.id"
              @click="selectLog(log)"
              class="w-full text-left rounded-xl border px-3 py-2.5 transition-colors active:scale-[0.99]"
              :class="[
                selectedLog?.id === log.id
                  ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)]/5'
                  : 'border-gray-200 hover:bg-gray-50',
                log.status === 'error' ? 'border-red-200 bg-red-50 hover:bg-red-100' : '',
              ]"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="flex items-center gap-2 min-w-0">
                  <!-- Direction / Type badge -->
                  <span
                    class="shrink-0 inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                    :class="logBadgeClass(log)"
                  >{{ log.direction }}</span>
                  <span
                    class="shrink-0 inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                    :class="logTypeBadgeClass(log)"
                  >{{ log.type }}</span>
                  <span class="text-xs font-bold text-gray-700 truncate">{{ log.endpoint ?? log.collection ?? '—' }}</span>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <span
                    class="inline-block size-1.5 rounded-full"
                    :class="log.status === 'success' ? 'bg-emerald-500' : 'bg-red-500'"
                  ></span>
                  <span class="text-[10px] text-gray-400">{{ formatTs(log.timestamp) }}</span>
                </div>
              </div>
              <div class="mt-1 flex items-center gap-3 text-[10px] text-gray-500">
                <span v-if="log.collection">{{ log.collection }}</span>
                <span v-if="log.recordCount != null">{{ log.recordCount }} record</span>
                <span v-if="log.durationMs != null">{{ log.durationMs }}ms</span>
                <span v-if="log.statusCode != null" :class="log.status === 'error' ? 'text-red-600 font-bold' : ''">
                  HTTP {{ log.statusCode }}
                </span>
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
            <span class="text-xs font-bold text-gray-700 flex items-center gap-1.5">
              <Search class="size-3.5 text-gray-400" />
              Dettaglio: <span class="text-gray-500 font-normal truncate max-w-[200px]">{{ selectedLog.endpoint ?? selectedLog.collection }}</span>
            </span>
            <button
              @click="selectedLog = null"
              class="text-gray-400 hover:text-gray-700 bg-gray-200 hover:bg-gray-300 rounded-full p-1 transition-colors active:scale-95"
            >
              <X class="size-3.5" />
            </button>
          </div>

          <!-- Detail content with two panes -->
          <div class="overflow-y-auto flex-1 p-3 space-y-3">

            <!-- Request pane -->
            <div>
              <div class="flex items-center justify-between mb-1">
                <span class="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Request / Payload</span>
                <button
                  @click="copyRequest"
                  class="flex items-center gap-1 text-[10px] font-bold text-gray-500 hover:text-gray-700 bg-white hover:bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-lg transition-colors active:scale-95"
                >
                  <Copy class="size-3" />
                  {{ copyRequestLabel }}
                </button>
              </div>
              <pre class="bg-white border border-gray-200 rounded-xl p-3 text-[10px] text-gray-700 overflow-x-auto max-h-32 whitespace-pre-wrap break-all font-mono">{{ formatJSON(selectedLog.payload) }}</pre>
            </div>

            <!-- Response pane -->
            <div>
              <div class="flex items-center justify-between mb-1">
                <span class="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Response</span>
                <button
                  @click="copyResponse"
                  class="flex items-center gap-1 text-[10px] font-bold text-gray-500 hover:text-gray-700 bg-white hover:bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-lg transition-colors active:scale-95"
                >
                  <Copy class="size-3" />
                  {{ copyResponseLabel }}
                </button>
              </div>
              <pre
                class="bg-white border rounded-xl p-3 text-[10px] overflow-x-auto max-h-32 whitespace-pre-wrap break-all font-mono"
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
import { Activity, X, Upload, Download, FileDown, Trash2, Search, Copy } from 'lucide-vue-next';
import { useDirectusSync } from '../../composables/useDirectusSync.js';
import { getSyncLogs, clearSyncLogs, exportSyncLogs } from '../../store/persistence/syncLogs.js';

const props = defineProps({
  modelValue: Boolean,
});
defineEmits(['update:modelValue']);

const sync = useDirectusSync();

// ── Reactive state ────────────────────────────────────────────────────────────

const logs = ref([]);
const selectedLog = ref(null);
const isOnline = ref(typeof navigator !== 'undefined' ? navigator.onLine : true);

const copyRequestLabel = ref('Copia');
const copyResponseLabel = ref('Copia');

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

function logBadgeClass(log) {
  if (log.direction === 'IN') return 'bg-blue-100 text-blue-700';
  return 'bg-purple-100 text-purple-700';
}

function logTypeBadgeClass(log) {
  if (log.type === 'PULL') return 'bg-sky-100 text-sky-700';
  if (log.type === 'WS') return 'bg-emerald-100 text-emerald-700';
  return 'bg-orange-100 text-orange-700';
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function loadLogs() {
  logs.value = await getSyncLogs(200);
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

async function _copyToClipboard(text, labelRef) {
  try {
    await navigator.clipboard.writeText(text);
    labelRef.value = 'Copiato!';
    setTimeout(() => { labelRef.value = 'Copia'; }, 2000);
  } catch {
    labelRef.value = 'Errore';
    setTimeout(() => { labelRef.value = 'Copia'; }, 2000);
  }
}

function copyRequest() {
  _copyToClipboard(formatJSON(selectedLog.value?.payload), copyRequestLabel);
}

function copyResponse() {
  _copyToClipboard(formatJSON(selectedLog.value?.response), copyResponseLabel);
}

// ── Lifecycle & event listeners ───────────────────────────────────────────────

function _onLogsChanged() {
  loadLogs();
}

function _onOnline() { isOnline.value = true; }
function _onOffline() { isOnline.value = false; }

onMounted(() => {
  loadLogs();
  if (typeof window !== 'undefined') {
    window.addEventListener('sync-logs:changed', _onLogsChanged);
    window.addEventListener('online', _onOnline);
    window.addEventListener('offline', _onOffline);
  }
});

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('sync-logs:changed', _onLogsChanged);
    window.removeEventListener('online', _onOnline);
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
