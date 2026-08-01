<template>
  <div class="absolute inset-0 z-50 bg-white flex flex-col items-center justify-center p-6 text-center overflow-y-auto">
    <!-- Logo -->
    <img 
      v-if="restaurantLogo" 
      :src="restaurantLogo" 
      alt="Logo" 
      class="size-32 mb-6 rounded-3xl shadow-lg object-cover border-4 theme-border p-1"
    />
    <div v-else class="w-32 h-32 mb-6 rounded-3xl shadow-lg bg-emerald-100 flex items-center justify-center">
      <UtensilsCrossed class="size-16 text-emerald-600" />
    </div>

    <!-- Restaurant name -->
    <h1 class="text-3xl md:text-5xl font-bold mb-2 text-gray-900">{{ restaurantName }}</h1>
    <p class="text-gray-500 mb-8 max-w-md">{{ restaurantSubtitle }}</p>

    <!-- Session validation error -->
    <div v-if="error" class="bg-red-50 border border-red-200 rounded-2xl p-4 mb-6 w-full max-w-sm">
      <AlertCircle class="w-8 h-8 text-red-500 mx-auto mb-2" />
      <p class="text-red-700 text-sm font-medium">{{ error }}</p>
      <button 
        @click="error = null"
        class="mt-3 px-4 py-2 bg-red-100 text-red-700 rounded-lg text-sm font-medium"
      >
        {{ t.riprova }}
      </button>
    </div>

    <!-- Loading state -->
    <div v-else-if="loading" class="flex flex-col items-center">
      <Loader2 class="size-12 text-emerald-600 animate-spin mb-4" />
      <p class="text-gray-500">{{ t.connessione }}</p>
    </div>

    <!-- Main content (only when not loading and no error) -->
    <template v-else>
      <!-- QR Scanner button -->
      <button 
        @click="showScanner = true" 
        class="theme-bg hover:theme-bg-dark text-white py-6 px-12 rounded-2xl font-bold text-xl shadow-lg transition-all flex items-center justify-center gap-4 active:scale-[0.98] mb-6"
      >
        <QrCode class="size-8" />
        {{ t.scansionaQR }}
      </button>

      <!-- Manual code entry toggle -->
      <button 
        @click="showManualEntry = !showManualEntry"
        class="text-gray-400 hover:text-gray-600 text-sm font-medium underline underline-offset-4 transition-colors mb-4"
      >
        {{ showManualEntry ? t.nascondiCodice : t.inserisciCodice }}
      </button>

      <!-- Manual code entry form -->
      <div v-if="showManualEntry" class="w-full max-w-sm bg-gray-50 rounded-2xl p-6 mb-6 border border-gray-200">
        <label class="block text-sm font-bold text-gray-700 mb-3 text-left">
          {{ t.codiceSessione }}
        </label>
        <input 
          v-model="manualSessionId" 
          type="text" 
          class="w-full px-4 py-3 bg-white border border-gray-300 rounded-xl text-sm font-mono text-center focus:outline-none ring-2 ring-emerald-200 transition-all"
          :placeholder="t.codicePlaceholder"
          @keyup.enter="handleManualSubmit"
        />
        <button 
          @click="handleManualSubmit"
          :disabled="!manualSessionId.trim() || manualLoading"
          class="mt-4 w-full theme-bg hover:theme-bg-dark text-white py-3 rounded-xl font-bold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          <Loader2 v-if="manualLoading" class="size-4 animate-spin" />
          {{ t.conferma }}
        </button>
      </div>

      <!-- Help text -->
      <p class="text-gray-400 text-xs max-w-xs mt-4">
        {{ t.helpText }}
      </p>
    </template>

    <!-- QR Scanner modal -->
    <SelfOrderQRScanner 
      v-if="showScanner" 
      @scanned="handleQRScanned" 
      @close="showScanner = false"
      @error="handleScannerError"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { UtensilsCrossed, Loader2, AlertCircle, QrCode } from 'lucide-vue-next';
import { useSelfOrderAuth } from '../../composables/useSelfOrderAuth.js';
import { useSelfOrderMenu } from '../../composables/useSelfOrderMenu.js';
import SelfOrderQRScanner from '../../components/selforder/SelfOrderQRScanner.vue';

const router = useRouter();
const { validateAndLoadSession } = useSelfOrderAuth();
const { loadMenu } = useSelfOrderMenu();

const loading = ref(false);
const manualLoading = ref(false);
const error = ref(null);
const showScanner = ref(false);
const showManualEntry = ref(false);
const manualSessionId = ref('');
const currentLang = ref(localStorage.getItem('selforder_lang') || 'it');

// Simple config (could be loaded from static config.json)
const restaurantName = ref('Ristorante');
const restaurantSubtitle = ref('Scansiona il QR sul tuo tavolo per iniziare');
const restaurantLogo = ref(null);

const i18n = {
  it: {
    connessione: 'Connessione in corso...',
    sessioneScaduta: 'Sessione scaduta o non valida',
    scansionaQR: 'Scansiona QR',
    inserisciCodice: 'Inserisci codice manualmente',
    nascondiCodice: 'Nascondi',
    codiceSessione: 'Codice Sessione',
    codicePlaceholder: 'xxxx-xxxx-xxxx',
    conferma: 'Conferma',
    riprova: 'Riprova',
    helpText: 'Il codice si trova sul QR del tuo tavolo',
  },
  en: {
    connessione: 'Connecting...',
    sessioneScaduta: 'Session expired or invalid',
    scansionaQR: 'Scan QR',
    inserisciCodice: 'Enter code manually',
    nascondiCodice: 'Hide',
    codiceSessione: 'Session Code',
    codicePlaceholder: 'xxxx-xxxx-xxxx',
    conferma: 'Confirm',
    riprova: 'Retry',
    helpText: 'The code is on the QR at your table',
  }
};

const t = computed(() => i18n[currentLang.value] || i18n.it);

async function handleQRScanned(url) {
  showScanner.value = false;
  loading.value = true;
  error.value = null;
  
  try {
    const sessionId = extractSessionId(url);
    if (!sessionId) {
      throw new Error(t.value.sessioneScaduta);
    }
    
    await validateAndLoadSession(sessionId);
    await loadMenu();
    
    const hasSeenOnboarding = sessionStorage.getItem('selforder_onboarding_done');
    if (!hasSeenOnboarding) {
      router.push('/onboarding');
    } else {
      router.push('/menu');
    }
  } catch (e) {
    error.value = e.message || t.value.sessioneScaduta;
  } finally {
    loading.value = false;
  }
}

async function handleManualSubmit() {
  if (!manualSessionId.value.trim() || manualLoading.value) return;
  
  manualLoading.value = true;
  error.value = null;
  
  try {
    const sessionId = manualSessionId.value.trim();
    await validateAndLoadSession(sessionId);
    await loadMenu();
    
    const hasSeenOnboarding = sessionStorage.getItem('selforder_onboarding_done');
    if (!hasSeenOnboarding) {
      router.push('/onboarding');
    } else {
      router.push('/menu');
    }
  } catch (e) {
    error.value = e.message || t.value.sessioneScaduta;
  } finally {
    manualLoading.value = false;
  }
}

function extractSessionId(url) {
  try {
    const urlObj = new URL(url);
    const hash = urlObj.hash || url;
    const sessionMatch = hash.match(/\/session\/([^?]+)/);
    return sessionMatch ? sessionMatch[1] : null;
  } catch {
    // Try regex on raw string
    const match = url.match(/([a-f0-9-]{36})|([A-Z0-9]{8})/i);
    return match ? match[0] : null;
  }
}

function handleScannerError(msg) {
  error.value = msg;
}

// Handle direct URL with session params (from deep link / pre-scanned QR)
onMounted(async () => {
  const hash = window.location.hash;
  const sessionMatch = hash.match(/\/session\/([^?]+)/);
  
  if (sessionMatch) {
    const sessionId = sessionMatch[1];
    const urlParams = new URLSearchParams(hash.split('?')[1] || '');
    
    loading.value = true;
    error.value = null;
    
    try {
      await validateAndLoadSession(sessionId);
      await loadMenu();
      
      const hasSeenOnboarding = sessionStorage.getItem('selforder_onboarding_done');
      if (!hasSeenOnboarding) {
        router.push('/onboarding');
      } else {
        router.push('/menu');
      }
    } catch (e) {
      error.value = e.message || t.value.sessioneScaduta;
    } finally {
      loading.value = false;
    }
  }
});
</script>
