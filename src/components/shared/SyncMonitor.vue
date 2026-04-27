<template>
  <!-- MODAL: SYNC MONITOR -->
  <div
    v-if="modelValue"
    class="fixed inset-0 z-[95] bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="sync-monitor-title"
    @click.self="$emit('update:modelValue', false)"
  >
    <div class="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[94dvh] md:max-h-[88dvh]">

      <!-- Header -->
      <div class="bg-gray-50 border-b border-gray-200 p-4 md:p-5 flex justify-between items-center shrink-0">
        <h3 id="sync-monitor-title" class="font-bold text-base md:text-lg flex items-center gap-2 text-gray-800">
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

          <!-- Coda push in attesa -->
          <div
            v-if="pendingQueueCount > 0"
            class="flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2"
          >
            <Clock class="size-3.5 text-amber-500 shrink-0" />
            <span class="text-xs font-bold text-amber-700">
              {{ pendingQueueCount }} {{ pendingQueueCount === 1 ? 'operazione in attesa' : 'operazioni in attesa' }} nella coda push
            </span>
          </div>

          <!-- Push / Pull now buttons -->
          <div class="flex gap-2">
            <button
              @click="handleForcePush"
              :disabled="pushing || pulling"
              class="flex-1 py-2.5 bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold rounded-2xl flex items-center justify-center gap-1.5 border border-gray-200 transition-colors active:scale-95 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <LoaderCircle v-if="pushing" class="size-3.5 text-gray-500 animate-spin" />
              <Upload v-else class="size-3.5 text-gray-500" />
              <span>{{ pushing ? 'Invio…' : 'Push ora' }}</span>
            </button>
            <button
              @click="handleForcePull"
              :disabled="pushing || pulling"
              class="flex-1 py-2.5 bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold rounded-2xl flex items-center justify-center gap-1.5 border border-gray-200 transition-colors active:scale-95 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <LoaderCircle v-if="pulling" class="size-3.5 text-gray-500 animate-spin" />
              <Download v-else class="size-3.5 text-gray-500" />
              <span>{{ pulling ? 'Ricezione…' : 'Pull ora' }}</span>
            </button>
          </div>

          <!-- Push/Pull feedback -->
          <div
            v-if="pushFeedback"
            class="flex items-center gap-2 text-xs px-3 py-2 rounded-xl"
            :class="{
              'bg-emerald-50 text-emerald-700': pushFeedback === 'success',
              'bg-amber-50 text-amber-700': pushFeedback === 'offline' || pushFeedback === 'skipped',
              'bg-red-50 text-red-700': pushFeedback === 'error',
            }"
          >
            <CheckCircle v-if="pushFeedback === 'success'" class="size-3 shrink-0" />
            <WifiOff v-else-if="pushFeedback === 'offline'" class="size-3 shrink-0" />
            <WifiOff v-else-if="pushFeedback === 'skipped'" class="size-3 shrink-0" />
            <XCircle v-else class="size-3 shrink-0" />
            <span>{{
              pushFeedback === 'success' ? 'Push completato.' :
              pushFeedback === 'offline' ? 'Directus non raggiungibile — riprovo appena torna online.' :
              pushFeedback === 'skipped' ? 'Push non disponibile: controlla le impostazioni Directus.' :
              'Errore durante il push.'
            }}</span>
          </div>
          <div
            v-if="pullFeedback"
            class="flex items-center gap-2 text-xs px-3 py-2 rounded-xl"
            :class="{
              'bg-emerald-50 text-emerald-700': pullFeedback === 'success',
              'bg-amber-50 text-amber-700': pullFeedback === 'offline',
              'bg-red-50 text-red-700': pullFeedback === 'error',
            }"
          >
            <CheckCircle v-if="pullFeedback === 'success'" class="size-3 shrink-0" />
            <WifiOff v-else-if="pullFeedback === 'offline'" class="size-3 shrink-0" />
            <XCircle v-else class="size-3 shrink-0" />
            <span>{{
              pullFeedback === 'success' ? 'Pull completato.' :
              pullFeedback === 'offline' ? 'Directus non raggiungibile — riprovo appena torna online.' :
              'Errore durante il pull.'
            }}</span>
          </div>
        </div>

        <!-- Sezione 2: Coda push attiva -->
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <span class="block text-xs font-bold text-gray-600 uppercase tracking-wider">
              Coda push
              <span v-if="queueEntries.length > 0" class="ml-1 normal-case text-[10px] font-normal text-amber-500">({{ queueEntries.length }})</span>
            </span>
            <button
              @click="_loadQueueData"
              class="flex items-center gap-1 text-[10px] font-bold text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded-lg transition-colors active:scale-95"
              title="Aggiorna coda e fallimenti"
            >
              <RefreshCw class="size-3" />
              Aggiorna
            </button>
          </div>

          <div v-if="queueEntries.length === 0" class="flex items-center gap-2 rounded-2xl border border-gray-100 bg-gray-50 px-3 py-2.5">
            <CheckCircle class="size-3.5 text-emerald-400 shrink-0" />
            <span class="text-xs text-gray-400">Coda vuota</span>
          </div>
          <div v-else class="space-y-1.5">
            <div
              v-for="entry in queueEntries"
              :key="entry.id"
              class="rounded-2xl border px-3 py-2.5 space-y-1"
              :class="entry.attempts > 0 ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-white'"
            >
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-1.5 min-w-0">
                  <span
                    class="shrink-0 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-md"
                    :class="{
                      'bg-sky-100 text-sky-700':    entry.operation === 'create',
                      'bg-amber-100 text-amber-700': entry.operation === 'update',
                      'bg-red-100 text-red-600':    entry.operation === 'delete',
                    }"
                  >{{ entry.operation }}</span>
                  <span class="text-xs font-semibold text-gray-700 truncate">{{ entry.collection }}</span>
                </div>
                <span
                  class="shrink-0 text-[9px] font-medium px-1.5 py-0.5 rounded-full"
                  :class="entry.attempts > 0 ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'"
                >{{ entry.attempts > 0 ? `${entry.attempts} tent.` : 'in coda' }}</span>
              </div>
              <p class="text-[10px] text-gray-400 font-mono truncate">ID: {{ entry.record_id }}</p>
              <p v-if="entry.attempts > 0 && entry.last_error" class="text-[10px] text-red-500 break-words">{{ entry.last_error }}</p>
              <p class="text-[10px] text-gray-400">{{ formatTs(entry.date_created) }}</p>
              <details v-if="entry.payload" class="text-[10px]">
                <summary class="cursor-pointer text-gray-500 font-semibold select-none">Payload</summary>
                <pre class="mt-1 bg-gray-50 border border-gray-200 rounded-xl p-2 text-[9px] text-gray-700 overflow-x-auto max-h-24 whitespace-pre-wrap break-all font-mono">{{ formatJSON(entry.payload) }}</pre>
              </details>
            </div>
          </div>
        </div>

        <!-- Sezione 3: Chiamate fallite -->
        <div class="space-y-2">
          <span class="block text-xs font-bold text-gray-600 uppercase tracking-wider">
            Chiamate fallite
            <span v-if="failedCalls.length > 0" class="ml-1 normal-case text-[10px] font-normal text-red-500">({{ failedCalls.length }})</span>
          </span>

          <div v-if="failedCalls.length === 0" class="flex items-center gap-2 rounded-2xl border border-gray-100 bg-gray-50 px-3 py-2.5">
            <CheckCircle class="size-3.5 text-emerald-400 shrink-0" />
            <span class="text-xs text-gray-400">Nessuna chiamata fallita</span>
          </div>
          <div v-else class="space-y-1.5">
            <div
              v-for="call in failedCalls"
              :key="call.id"
              class="rounded-2xl border border-red-200 bg-red-50 px-3 py-2.5 space-y-1"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="flex items-center gap-1.5 min-w-0">
                  <span
                    class="shrink-0 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-md"
                    :class="{
                      'bg-sky-100 text-sky-700':    call.operation === 'create',
                      'bg-amber-100 text-amber-700': call.operation === 'update',
                      'bg-red-100 text-red-600':    call.operation === 'delete',
                    }"
                  >{{ call.operation }}</span>
                  <span class="text-xs font-semibold text-gray-700 truncate">{{ call.collection }}</span>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                  <span class="text-[9px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">{{ call.attempts }} tent.</span>
                  <span v-if="call.abandoned" class="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-600">Rimossa</span>
                </div>
              </div>
              <p class="text-[10px] text-gray-400 font-mono truncate">Record: {{ call.record_id }}</p>
              <p class="text-[10px] text-red-600 break-words">{{ call.error_message }}</p>
              <p class="text-[10px] text-gray-400">{{ formatTs(call.failed_at) }}</p>
              <details class="text-[10px]">
                <summary class="cursor-pointer text-gray-500 font-semibold select-none">Dettagli request/response</summary>
                <pre class="mt-1 bg-white border border-red-200 rounded-xl p-2 text-[9px] text-gray-700 overflow-x-auto max-h-32 whitespace-pre-wrap break-all font-mono">{{ formatFailedCall(call) }}</pre>
              </details>
            </div>
          </div>
        </div>

        <!-- Sezione 4: Activity Log -->
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
              <div class="mt-1 flex items-center flex-wrap gap-1.5 text-[10px]" :class="logMetaClass(log)">
                <span v-if="log.operation" class="inline-flex items-center px-1.5 py-0.5 rounded font-bold uppercase tracking-wide shrink-0"
                  :class="{
                    'bg-sky-100 text-sky-700':    log.operation === 'create',
                    'bg-amber-100 text-amber-700': log.operation === 'update',
                    'bg-red-100 text-red-600':    log.operation === 'delete',
                  }"
                >{{ log.operation }}</span>
                <span v-if="log.method" class="inline-flex items-center px-1.5 py-0.5 rounded font-bold uppercase tracking-wide bg-gray-100 text-gray-600 shrink-0">{{ log.method }}</span>
                <span v-if="log.collection && (!log.endpoint || !log.endpoint.includes(log.collection))">{{ log.collection }}</span>
                <span v-if="log.recordCount != null">{{ log.recordCount }} rec</span>
                <span v-if="log.durationMs != null">{{ log.durationMs }}ms</span>
                <span
                  v-if="log.statusCode != null"
                  class="font-bold"
                  :class="log.status === 'error' ? '' : 'font-normal'"
                >HTTP {{ log.statusCode }}</span>
                <span v-if="log.status === 'error' && log.statusCode == null" class="font-bold">Network Error</span>
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
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import {
  Activity, X, ArrowUpCircle, ArrowDownCircle, RefreshCw,
  FileDown, Trash2, Search, Copy, ClipboardList,
  Upload, Download, CheckCircle, WifiOff, XCircle, LoaderCircle, Clock,
} from 'lucide-vue-next';
import { useDirectusSync } from '../../composables/useDirectusSync.js';
import { getSyncLogs, clearSyncLogs, exportSyncLogs, _BC_CHANNEL, _TAB_ID, SYNC_LOGS_MAX_SUCCESS, SYNC_LOGS_MAX_ERRORS } from '../../store/persistence/syncLogs.js';
import { getPendingEntries, getFailedSyncCalls } from '../../composables/useSyncQueue.js';

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

// Push / Pull state
const pendingQueueCount = ref(0);
const queueEntries = ref([]);
const failedCalls = ref([]);
const pushing = ref(false);
const pulling = ref(false);
const pushFeedback = ref(null); // null | 'success' | 'offline' | 'error' | 'skipped'
const pullFeedback = ref(null); // null | 'success' | 'offline' | 'error'
let _pushFeedbackTimer = null;
let _pullFeedbackTimer = null;
let _queuePollTimer = null;
let _loadQueueDataInFlight = false;

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

function formatFailedCall(call) {
  try {
    return JSON.stringify({
      failed_at: call.failed_at,
      queue_entry_id: call.queue_entry_id,
      collection: call.collection,
      operation: call.operation,
      record_id: call.record_id,
      attempts: call.attempts,
      abandoned: call.abandoned,
      error_message: call.error_message,
      request: call.request,
      response: call.response,
      payload: call.payload,
    }, null, 2);
  } catch {
    return '(impossibile serializzare i dettagli)';
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

const SYNC_LOGS_UI_FETCH_LIMIT = SYNC_LOGS_MAX_SUCCESS + SYNC_LOGS_MAX_ERRORS; // UI fetch/display cap; not a bound on retained logs

async function loadLogs() {
  logs.value = await getSyncLogs(SYNC_LOGS_UI_FETCH_LIMIT);
}

async function _loadQueueData() {
  if (_loadQueueDataInFlight) return;
  _loadQueueDataInFlight = true;
  try {
    const entries = await getPendingEntries();
    pendingQueueCount.value = entries.length;
    queueEntries.value = entries;
  } catch {
    pendingQueueCount.value = 0;
    queueEntries.value = [];
  }
  try {
    failedCalls.value = await getFailedSyncCalls();
  } catch {
    failedCalls.value = [];
  }
  _loadQueueDataInFlight = false;
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
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

async function handleForcePush() {
  if (pushing.value || pulling.value) return;
  pushing.value = true;
  pushFeedback.value = null;
  clearTimeout(_pushFeedbackTimer);
  try {
    const result = await sync.forcePush();
    if (result?.offline) {
      pushFeedback.value = 'offline';
    } else if (result?.failed > 0) {
      pushFeedback.value = 'error';
    } else if (result?.skippedReason) {
      pushFeedback.value = 'skipped';
    } else {
      pushFeedback.value = 'success';
    }
  } catch {
    pushFeedback.value = 'error';
  } finally {
    pushing.value = false;
    await _loadQueueData();
    _pushFeedbackTimer = setTimeout(() => { pushFeedback.value = null; }, 3000);
  }
}

async function handleForcePull() {
  if (pushing.value || pulling.value) return;
  pulling.value = true;
  pullFeedback.value = null;
  clearTimeout(_pullFeedbackTimer);
  try {
    // Best-effort config refresh first (venues, menu, etc.) — don't abort the operational pull on failure.
    try { await sync.reconfigureAndApply({ clearLocalConfig: false }); } catch (e) { console.debug('[SyncMonitor] Config refresh failed:', e); }
    const pullResult = await sync.forcePull();
    if (pullResult?.ok) {
      pullFeedback.value = 'success';
    } else if (pullResult?.skippedReason === 'offline') {
      pullFeedback.value = 'offline';
    } else {
      pullFeedback.value = 'error';
    }
  } catch {
    pullFeedback.value = 'error';
  } finally {
    pulling.value = false;
    _pullFeedbackTimer = setTimeout(() => { pullFeedback.value = null; }, 3000);
  }
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
  let statusSuffix = '';
  if (log.statusCode != null) statusSuffix = `  HTTP ${log.statusCode}`;
  else if (log.status === 'error') statusSuffix = '  (network)';
  const lines = [
    '=== Sync Log ===',
    `ID:         ${log.id ?? '—'}`,
    `Timestamp:  ${log.timestamp ?? '—'}`,
    `Direction:  ${log.direction ?? '—'}  Type: ${log.type ?? '—'}`,
    `Operazione: ${log.operation ?? '—'}  Metodo: ${log.method ?? '—'}`,
    `Endpoint:   ${log.endpoint ?? '—'}`,
    `Collection: ${log.collection ?? '—'}`,
    `Status:     ${log.status ?? '—'}${statusSuffix}`,
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
      // Ignore messages originating from this tab — same-tab updates are already
      // handled by the 'sync-logs:changed' CustomEvent on window, so acting on
      // both would cause duplicate loadLogs() / IDB reads per write.
      if (e.data?.type === 'changed' && e.data?.sourceId !== _TAB_ID) loadLogs();
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
function _onQueueEnqueue() { _loadQueueData(); }

function _attach() {
  loadLogs();
  _loadQueueData();
  _initBC();
  // Poll queue count every 5 seconds while the modal is open so the badge stays fresh.
  _queuePollTimer = setInterval(_loadQueueData, 5_000);
  if (typeof window !== 'undefined') {
    window.addEventListener('sync-logs:changed', _onLogsChanged);
    window.addEventListener('sync-queue:enqueue', _onQueueEnqueue);
    window.addEventListener('online',  _onOnline);
    window.addEventListener('offline', _onOffline);
  }
}

function _detach() {
  _closeBC();
  clearInterval(_queuePollTimer);
  _queuePollTimer = null;
  clearTimeout(_pushFeedbackTimer);
  clearTimeout(_pullFeedbackTimer);
  if (typeof window !== 'undefined') {
    window.removeEventListener('sync-logs:changed', _onLogsChanged);
    window.removeEventListener('sync-queue:enqueue', _onQueueEnqueue);
    window.removeEventListener('online',  _onOnline);
    window.removeEventListener('offline', _onOffline);
  }
}

// Only open the channel and register listeners while the modal is visible.
// This avoids a permanently-open BroadcastChannel and loadLogs() calls
// while the modal is hidden but the component is still mounted.
// The watcher handles transitions after mount; onMounted handles the initial
// open state so listeners are never registered before the component is ready.
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      _attach();
    } else {
      _detach();
      selectedLog.value = null;
    }
  },
);

onMounted(() => {
  // Handle the initial open state (if the modal is open when first mounted).
  if (props.modelValue) _attach();
});

onUnmounted(() => {
  _detach();
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
