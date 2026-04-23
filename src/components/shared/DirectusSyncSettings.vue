<template>
  <!-- ── Sezione Sincronizzazione Directus ── -->
  <div class="pt-4 border-t border-gray-100 mt-2 space-y-3">
    <div class="flex items-center gap-2 mb-1">
      <RefreshCw class="size-4 text-gray-400 shrink-0" />
      <span class="text-xs font-bold text-gray-600 uppercase tracking-wider">Sincronizzazione Directus</span>
    </div>

    <!-- Abilitato toggle -->
    <div
      @click="form.enabled = !form.enabled"
      class="flex items-center justify-between p-3 border border-gray-200 rounded-2xl cursor-pointer hover:bg-gray-50 transition-colors active:scale-95"
    >
      <div>
        <span class="font-bold text-gray-800 block text-sm">Abilita sincronizzazione</span>
        <span class="text-[10px] text-gray-500">Sincronizza dati con il backend Directus</span>
      </div>
      <button
        type="button"
        role="switch"
        :aria-checked="form.enabled"
        @click.stop="form.enabled = !form.enabled"
        class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2"
        :class="form.enabled ? 'bg-[var(--brand-primary)]' : 'bg-gray-300'"
      >
        <span
          class="inline-block size-5 transform rounded-full bg-white shadow-md transition-transform"
          :class="form.enabled ? 'translate-x-5' : 'translate-x-0.5'"
        ></span>
      </button>
    </div>

    <!-- Campi connessione (visibili solo se abilitato) -->
    <template v-if="form.enabled">
      <div class="space-y-2">
        <div>
          <label class="block text-xs font-bold text-gray-600 mb-1">URL Directus</label>
          <input
            v-model="form.url"
            type="url"
            placeholder="https://dev.nanawork.it"
            class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
            autocomplete="off"
          />
        </div>
        <div>
          <label class="block text-xs font-bold text-gray-600 mb-1">Static Token</label>
          <input
            v-model="form.staticToken"
            :type="showToken ? 'text' : 'password'"
            placeholder="••••••••••••••••"
            class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
            autocomplete="new-password"
          />
          <button
            type="button"
            @click="showToken = !showToken"
            class="mt-1 text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
          >
            {{ showToken ? 'Nascondi' : 'Mostra' }} token
          </button>
        </div>
        <div>
          <label class="block text-xs font-bold text-gray-600 mb-1">Venue ID</label>
          <input
            v-model.number="form.venueId"
            type="number"
            placeholder="1"
            min="1"
            class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
          />
        </div>

        <!-- WebSocket toggle -->
        <div
          @click="form.wsEnabled = !form.wsEnabled"
          class="flex items-center justify-between p-3 border border-gray-200 rounded-2xl cursor-pointer hover:bg-gray-50 transition-colors active:scale-95"
        >
          <div>
            <span class="font-bold text-gray-800 block text-sm">Abilita WebSocket (Subscriptions)</span>
            <span class="text-[10px] text-gray-500">Solo se l'istanza Directus supporta il modulo WebSocket</span>
          </div>
          <button
            type="button"
            role="switch"
            :aria-checked="form.wsEnabled"
            @click.stop="form.wsEnabled = !form.wsEnabled"
            class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2"
            :class="form.wsEnabled ? 'bg-[var(--brand-primary)]' : 'bg-gray-300'"
          >
            <span
              class="inline-block size-5 transform rounded-full bg-white shadow-md transition-transform"
              :class="form.wsEnabled ? 'translate-x-5' : 'translate-x-0.5'"
            ></span>
          </button>
        </div>
      </div>

      <!-- Stato connessione -->
      <div
        v-if="connectionStatus !== 'idle'"
        class="flex items-center gap-2 text-xs px-3 py-2 rounded-xl"
        :class="{
          'bg-emerald-50 text-emerald-700': connectionStatus === 'ok',
          'bg-red-50 text-red-700': connectionStatus === 'error',
          'bg-gray-50 text-gray-500': connectionStatus === 'testing',
        }"
      >
        <LoaderCircle v-if="connectionStatus === 'testing'" class="size-3 animate-spin shrink-0" />
        <CheckCircle v-else-if="connectionStatus === 'ok'" class="size-3 shrink-0" />
        <XCircle v-else class="size-3 shrink-0" />
        <span>{{ connectionMessage }}</span>
      </div>
    </template>

    <!-- Pulsanti -->
    <div class="flex gap-2">
      <button
        v-if="form.enabled"
        type="button"
        @click="testConnection"
        :disabled="testing || !form.url || !form.staticToken"
        class="flex-1 py-3 bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold rounded-2xl flex items-center justify-center gap-2 border border-gray-200 transition-colors active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
      >
        <Wifi class="size-4 text-gray-500" :class="testing ? 'animate-pulse' : ''" />
        <span>{{ testing ? 'Test...' : 'Verifica' }}</span>
      </button>
      <button
        type="button"
        @click="saveConfig"
        :disabled="saveDisabled"
        class="flex-1 py-3 font-bold rounded-2xl flex items-center justify-center gap-2 transition-colors active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        :class="!saveDisabled ? 'bg-[var(--brand-primary)] text-white' : 'bg-gray-100 text-gray-500 border border-gray-200'"
      >
        <Save class="size-4" />
        <span>Salva</span>
      </button>
    </div>

    <!-- Stato sync corrente (solo se abilitato e salvato) -->
    <template v-if="syncEnabled && sync.syncStatus.value !== 'idle'">
      <div
        class="flex items-center gap-2 text-xs px-3 py-2 rounded-xl"
        :class="{
          'bg-blue-50 text-blue-700': sync.syncStatus.value === 'syncing',
          'bg-red-50 text-red-700': sync.syncStatus.value === 'error',
        }"
      >
        <LoaderCircle v-if="sync.syncStatus.value === 'syncing'" class="size-3 animate-spin shrink-0" />
        <AlertCircle v-else class="size-3 shrink-0" />
        <span>{{ sync.syncStatus.value === 'syncing' ? 'Sincronizzazione in corso...' : 'Errore durante la sincronizzazione' }}</span>
      </div>
    </template>

    <!-- Pulsanti force push/pull (solo se abilitato e configurato) -->
    <div v-if="syncEnabled" class="flex gap-2">
      <button
        type="button"
        @click="handleForcePush"
        :disabled="pushing || pulling"
        class="flex-1 py-2.5 bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold rounded-2xl flex items-center justify-center gap-2 border border-gray-200 transition-colors active:scale-95 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <LoaderCircle v-if="pushing" class="size-3.5 text-gray-500 animate-spin" />
        <Upload v-else class="size-3.5 text-gray-500" />
        <span>{{ pushing ? 'Invio in corso...' : 'Push ora' }}</span>
      </button>
      <button
        type="button"
        @click="handleForcePull"
        :disabled="pushing || pulling"
        class="flex-1 py-2.5 bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold rounded-2xl flex items-center justify-center gap-2 border border-gray-200 transition-colors active:scale-95 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <LoaderCircle v-if="pulling" class="size-3.5 text-gray-500 animate-spin" />
        <Download v-else class="size-3.5 text-gray-500" />
        <span>{{ pulling ? 'Ricezione in corso...' : 'Pull ora' }}</span>
      </button>
    </div>

    <!-- Log coda sincronizzazione -->
    <button
      v-if="syncEnabled"
      type="button"
      @click="showQueueLog = true"
      class="w-full py-2.5 bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold rounded-2xl flex items-center justify-center gap-2 border border-gray-200 transition-colors active:scale-95 text-xs"
    >
      <ListOrdered class="size-3.5 text-gray-500" />
      <span>Log coda sync</span>
    </button>

    <!-- Info timestamp -->
    <div v-if="syncEnabled" class="text-[10px] text-gray-400 space-y-0.5 px-1">
      <p v-if="sync.lastPushAt.value">
        Ultimo push: {{ formatTs(sync.lastPushAt.value) }}
      </p>
      <p v-if="sync.lastPullAt.value">
        Ultimo pull: {{ formatTs(sync.lastPullAt.value) }}
      </p>
      <p v-if="sync.wsConnected.value" class="flex items-center gap-1">
        <span class="inline-block size-1.5 rounded-full bg-emerald-500"></span>
        WebSocket attivo
      </p>
      <p v-else-if="appConfig.directus?.wsEnabled" class="flex items-center gap-1 text-amber-500">
        <span class="inline-block size-1.5 rounded-full bg-amber-400"></span>
        WebSocket abilitato (non connesso)
      </p>
    </div>

    <!-- Sync queue log modal (admin only) -->
    <SyncQueueLogModal v-model="showQueueLog" />

    <!-- Modale applicazione nuova configurazione Directus -->
    <div
      v-if="showReconfigureModal"
      class="fixed inset-0 z-[98] bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4"
      @click.self="!reconfigureRunning && (showReconfigureModal = false)"
    >
      <div class="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85dvh]">
        <div class="bg-gray-50 border-b border-gray-200 p-4 flex justify-between items-center shrink-0">
          <h3 class="font-bold text-base flex items-center gap-2 text-gray-800">
            <RefreshCw class="size-4 text-gray-500" />
            Applica nuova configurazione
          </h3>
          <button
            :disabled="reconfigureRunning"
            @click="showReconfigureModal = false"
            class="text-gray-400 hover:text-gray-800 bg-gray-200 hover:bg-gray-300 rounded-full p-1.5 transition-colors active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <XCircle class="size-5" />
          </button>
        </div>

        <div class="p-4 space-y-3 overflow-y-auto">
          <p class="text-sm text-gray-700">
            Confermi l'applicazione completa della nuova configurazione Directus?
          </p>

          <label class="flex items-start gap-2 p-3 border border-gray-200 rounded-xl bg-gray-50">
            <input
              v-model="clearLocalConfigBeforeApply"
              type="checkbox"
              class="mt-0.5 accent-[var(--brand-primary)]"
              :disabled="reconfigureRunning"
            />
            <span class="text-xs text-gray-700">
              Svuota completamente la configurazione locale prima del pull.
            </span>
          </label>

          <div class="border border-gray-200 rounded-xl bg-gray-50 min-h-36 max-h-60 overflow-y-auto p-3 space-y-1">
            <p
              v-for="entry in reconfigureLogs"
              :key="entry.id"
              class="text-[11px] leading-tight break-words"
              :class="{
                'text-gray-600': entry.level === 'info',
                'text-emerald-700': entry.level === 'success',
                'text-red-700 font-semibold': entry.level === 'error',
              }"
            >
              {{ entry.ts }} · {{ entry.message }}
              <span v-if="entry.details" class="block text-[10px] text-red-500 font-normal mt-0.5">{{ entry.details }}</span>
            </p>
            <p v-if="reconfigureLogs.length === 0" class="text-[11px] text-gray-400">
              Nessuna operazione avviata.
            </p>
          </div>
        </div>

        <div class="shrink-0 px-4 py-3 border-t border-gray-100 bg-white flex gap-2">
          <button
            type="button"
            @click="showReconfigureModal = false"
            :disabled="reconfigureRunning"
            class="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl border border-gray-200 transition-colors active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed text-xs"
          >
            Chiudi
          </button>
          <button
            type="button"
            @click="runFullConfigApply"
            :disabled="reconfigureRunning || !form.enabled"
            class="flex-1 py-2.5 bg-[var(--brand-primary)] text-white font-bold rounded-xl border border-[var(--brand-primary)] transition-colors active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed text-xs flex items-center justify-center gap-1.5"
          >
            <LoaderCircle v-if="reconfigureRunning" class="size-3.5 animate-spin" />
            <RefreshCw v-else class="size-3.5" />
            <span>{{ reconfigureRunning ? 'Applicazione...' : 'Conferma e applica' }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import {
  RefreshCw, Save, Wifi, LoaderCircle, CheckCircle, XCircle,
  AlertCircle, Upload, Download, ListOrdered,
} from 'lucide-vue-next';
import { appConfig } from '../../utils/index.js';
import {
  loadDirectusConfigFromStorage,
  directusEnabledRef,
} from '../../composables/useDirectusClient.js';
import { useDirectusSync } from '../../composables/useDirectusSync.js';
import { useConfigStore } from '../../store/index.js';
import SyncQueueLogModal from './SyncQueueLogModal.vue';

const sync = useDirectusSync();
const configStore = useConfigStore();

// ── Form state ────────────────────────────────────────────────────────────────

/** Reactive form bound to the UI inputs. */
const form = reactive({
  enabled: false,
  url: '',
  staticToken: '',
  venueId: null,
  wsEnabled: false,
});

const showToken = ref(false);
const testing = ref(false);
const pushing = ref(false);
const pulling = ref(false);
const connectionStatus = ref('idle'); // 'idle' | 'testing' | 'ok' | 'error'
const connectionMessage = ref('');
const showQueueLog = ref(false);
const showReconfigureModal = ref(false);
const reconfigureRunning = ref(false);
const clearLocalConfigBeforeApply = ref(true);
const reconfigureLogs = ref([]);
let reconfigureLogSeq = 0;

/** `true` when the saved config has `enabled = true` (reactive via directusEnabledRef). */
const syncEnabled = directusEnabledRef;

/** `true` when the form differs from the last saved state. */
const _savedSnapshot = ref('');
const hasChanges = computed(() => {
  return JSON.stringify({
    enabled: form.enabled,
    url: form.url,
    staticToken: form.staticToken,
    venueId: form.venueId,
    wsEnabled: form.wsEnabled,
  }) !== _savedSnapshot.value;
});

/**
 * `true` when saving is NOT allowed: either no changes, or sync is being
 * enabled without the required url and staticToken credentials.
 */
const saveDisabled = computed(() =>
  !hasChanges.value || (form.enabled && (!form.url.trim() || !form.staticToken.trim())),
);

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(async () => {
  try {
    await loadDirectusConfigFromStorage();
  } catch (e) { console.warn('[DirectusSyncSettings] Failed to load Directus config from IDB:', e); }
  _syncFormFromConfig();
});

function _syncFormFromConfig() {
  const cfg = appConfig.directus ?? {};
  form.enabled = cfg.enabled ?? false;
  form.url = cfg.url ?? '';
  form.staticToken = cfg.staticToken ?? '';
  form.venueId = cfg.venueId ?? null;
  form.wsEnabled = cfg.wsEnabled ?? false;
  _savedSnapshot.value = JSON.stringify({ ...form });
}

// ── Actions ───────────────────────────────────────────────────────────────────

/** Verifies the Directus connection using a lightweight /server/ping call,
 *  with an authenticated /users/me fallback if the ping endpoint returns a
 *  5xx error (e.g. 503 from a reverse proxy). */
async function testConnection() {
  const normalizedUrl = form.url.trim();
  if (!normalizedUrl || !form.staticToken) return;
  testing.value = true;
  connectionStatus.value = 'testing';
  connectionMessage.value = 'Connessione in corso…';

  const baseUrl = normalizedUrl.replace(/\/$/, '');

  // Fallback timer IDs for environments that don't support AbortSignal.timeout;
  // stored here so they can all be cancelled in the finally block.
  const _pendingTimers = [];

  /** Creates a fresh AbortSignal with an 8-second timeout. */
  function makeSignal() {
    if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(8_000);
    const ctrl = new AbortController();
    _pendingTimers.push(setTimeout(() => ctrl.abort(), 8_000));
    return ctrl.signal;
  }

  try {
    // ── Step 1: try /server/ping (public endpoint, no auth required). ──────
    // The /server/ping endpoint is unauthenticated — do NOT send a Bearer
    // token here, as some reverse proxies return 503 when they see an
    // unexpected Authorization header on health-check paths.
    // If the ping returns a 5xx error we fall back to /users/me below.
    const pingRes = await fetch(`${baseUrl}/server/ping`, { signal: makeSignal() });

    if (pingRes.ok) {
      // ── Step 2: validate the static token against /users/me. ─────────────
      const meRes = await fetch(`${baseUrl}/users/me`, {
        headers: { Authorization: `Bearer ${form.staticToken}` },
        signal: makeSignal(),
      });
      if (meRes.ok) {
        connectionStatus.value = 'ok';
        connectionMessage.value = 'Connessione riuscita';
      } else {
        connectionStatus.value = 'error';
        connectionMessage.value = (meRes.status === 401 || meRes.status === 403)
          ? `Token non valido (HTTP ${meRes.status})`
          : `Errore HTTP ${meRes.status}`;
      }
    } else if (pingRes.status >= 500) {
      // Ping failed with server-side error (e.g. 503 from proxy) — use the
      // authenticated /users/me endpoint as a fallback connectivity check.
      const meRes = await fetch(`${baseUrl}/users/me`, {
        headers: { Authorization: `Bearer ${form.staticToken}` },
        signal: makeSignal(),
      });
      if (meRes.ok) {
        connectionStatus.value = 'ok';
        connectionMessage.value = 'Connessione riuscita';
      } else {
        connectionStatus.value = 'error';
        connectionMessage.value = (meRes.status === 401 || meRes.status === 403)
          ? `Token non valido (HTTP ${meRes.status})`
          : `Errore HTTP ${meRes.status}`;
      }
    } else {
      connectionStatus.value = 'error';
      connectionMessage.value = `Errore HTTP ${pingRes.status}`;
    }
  } catch (e) {
    connectionStatus.value = 'error';
    connectionMessage.value = e?.name === 'AbortError' || e?.message?.includes('abort')
      ? 'Timeout connessione'
      : `Errore: ${e?.message ?? e}`;
  } finally {
    _pendingTimers.forEach(clearTimeout);
    testing.value = false;
  }
}

/** Persists the form values through ConfigStore (IDB + runtime update). */
async function saveConfig() {
  const nextDirectusConfig = {
    enabled: form.enabled,
    url: form.url.trim().replace(/\/$/, ''),
    staticToken: form.staticToken.trim(),
    venueId: form.venueId || null,
    wsEnabled: form.wsEnabled,
  };

  try {
    await configStore.saveDirectusSettings(nextDirectusConfig);
  } catch (e) {
    _appendReconfigureLog({
      level: 'error',
      message: 'Errore salvataggio configurazione locale. Verifica lo spazio/permessi del browser e riprova.',
      details: String(e?.message ?? e),
    });
    return;
  }
  _savedSnapshot.value = JSON.stringify({ ...form });
  connectionStatus.value = 'idle';
  showReconfigureModal.value = true;
  reconfigureLogSeq = 0;
  reconfigureLogs.value = [];
  _appendReconfigureLog({ level: 'info', message: 'Configurazione salvata in locale.' });
  if (!form.enabled) {
    _appendReconfigureLog({
      level: 'error',
      message: 'Sincronizzazione disabilitata: riattivala per applicare la configurazione da Directus.',
    });
  }
}

/** Triggers a manual push and shows a loading spinner on the button. */
async function handleForcePush() {
  if (pushing.value || pulling.value) return;
  pushing.value = true;
  try {
    await sync.forcePush();
  } finally {
    pushing.value = false;
  }
}

/** Triggers a manual pull and shows a loading spinner on the button. */
async function handleForcePull() {
  if (pushing.value || pulling.value) return;
  pulling.value = true;
  try {
    await sync.reconfigureAndApply({ clearLocalConfig: false });
  } finally {
    pulling.value = false;
  }
}

/** Formats an ISO timestamp to a locale-friendly short string. */
function formatTs(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

function _appendReconfigureLog({ level = 'info', message, details = '' }) {
  const now = new Date();
  reconfigureLogs.value.push({
    id: `${now.getTime()}-${reconfigureLogSeq++}`,
    ts: now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    level,
    message,
    details,
  });
}

async function runFullConfigApply() {
  if (reconfigureRunning.value || !form.enabled) return;
  reconfigureRunning.value = true;
  _appendReconfigureLog({ level: 'info', message: 'Avvio procedura di re-sync configurazione…' });
  try {
    const result = await sync.reconfigureAndApply({
      clearLocalConfig: clearLocalConfigBeforeApply.value,
      onProgress: (entry) => _appendReconfigureLog({
        level: entry?.level ?? 'info',
        message: entry?.message ?? 'Operazione completata.',
        details: entry?.details ?? '',
      }),
    });
    if (result?.ok) {
      _appendReconfigureLog({ level: 'success', message: 'Procedura completata con successo.' });
    } else {
      _appendReconfigureLog({
        level: 'error',
        message: 'Procedura completata con errori.',
        details: (result?.failedCollections?.length ?? 0) > 0
          ? `Collezioni fallite: ${result.failedCollections.join(', ')}`
          : '',
      });
    }
  } catch (e) {
    _appendReconfigureLog({
      level: 'error',
      message: 'Errore inatteso durante la procedura.',
      details: String(e?.message ?? e),
    });
  } finally {
    reconfigureRunning.value = false;
  }
}
</script>
