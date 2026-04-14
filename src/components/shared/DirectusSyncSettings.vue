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
        :disabled="!hasChanges"
        class="flex-1 py-3 font-bold rounded-2xl flex items-center justify-center gap-2 transition-colors active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        :class="hasChanges ? 'bg-[var(--brand-primary)] text-white' : 'bg-gray-100 text-gray-500 border border-gray-200'"
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
        @click="sync.forcePush()"
        class="flex-1 py-2.5 bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold rounded-2xl flex items-center justify-center gap-2 border border-gray-200 transition-colors active:scale-95 text-xs"
      >
        <Upload class="size-3.5 text-gray-500" />
        <span>Push ora</span>
      </button>
      <button
        type="button"
        @click="sync.forcePull()"
        class="flex-1 py-2.5 bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold rounded-2xl flex items-center justify-center gap-2 border border-gray-200 transition-colors active:scale-95 text-xs"
      >
        <Download class="size-3.5 text-gray-500" />
        <span>Pull ora</span>
      </button>
    </div>

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
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import {
  RefreshCw, Save, Wifi, LoaderCircle, CheckCircle, XCircle,
  AlertCircle, Upload, Download,
} from 'lucide-vue-next';
import { appConfig } from '../../utils/index.js';
import {
  loadDirectusConfigFromStorage,
  saveDirectusConfigToStorage,
} from '../../composables/useDirectusClient.js';
import { useDirectusSync } from '../../composables/useDirectusSync.js';

const sync = useDirectusSync();

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
const connectionStatus = ref('idle'); // 'idle' | 'testing' | 'ok' | 'error'
const connectionMessage = ref('');

/** `true` when the saved config has `enabled = true`. */
const syncEnabled = computed(() => appConfig.directus?.enabled === true);

/** `true` when the form differs from the last saved state. */
const _savedSnapshot = ref('');
const hasChanges = computed(() => {
  return JSON.stringify({
    enabled: form.enabled,
    url: form.url,
    staticToken: form.staticToken,
    venueId: form.venueId,
  }) !== _savedSnapshot.value;
});

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(() => {
  loadDirectusConfigFromStorage();
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

/** Verifies the Directus connection using a lightweight /server/ping call. */
async function testConnection() {
  if (!form.url || !form.staticToken) return;
  testing.value = true;
  connectionStatus.value = 'testing';
  connectionMessage.value = 'Connessione in corso…';

  try {
    const res = await fetch(`${form.url.replace(/\/$/, '')}/server/ping`, {
      headers: { Authorization: `Bearer ${form.staticToken}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) {
      const text = await res.text();
      if (text.includes('pong') || res.status === 200) {
        connectionStatus.value = 'ok';
        connectionMessage.value = 'Connessione riuscita';
      } else {
        connectionStatus.value = 'error';
        connectionMessage.value = `Risposta inattesa: ${res.status}`;
      }
    } else {
      connectionStatus.value = 'error';
      connectionMessage.value = `Errore HTTP ${res.status}`;
    }
  } catch (e) {
    connectionStatus.value = 'error';
    connectionMessage.value = e?.message?.includes('abort') ? 'Timeout connessione' : `Errore: ${e?.message ?? e}`;
  } finally {
    testing.value = false;
  }
}

/** Persists the form values to localStorage and updates appConfig. */
function saveConfig() {
  appConfig.directus = {
    enabled: form.enabled,
    url: form.url.trim(),
    staticToken: form.staticToken.trim(),
    venueId: form.venueId || null,
    wsEnabled: form.wsEnabled,
  };
  saveDirectusConfigToStorage();
  _savedSnapshot.value = JSON.stringify({ ...form });
  connectionStatus.value = 'idle';
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
</script>
