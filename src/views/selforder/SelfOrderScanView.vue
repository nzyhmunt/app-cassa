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
        {{ t.retry }}
      </button>
    </div>

    <!-- Loading state -->
    <div v-else-if="loading" class="flex flex-col items-center">
      <Loader2 class="size-12 text-emerald-600 animate-spin mb-4" />
      <p class="text-gray-500">{{ t.connecting }}</p>
    </div>

    <!-- Main content -->
    <template v-else>
      <!-- QR Scanner button -->
      <button 
        @click="showScanner = true" 
        class="theme-bg hover:theme-bg-dark text-white py-6 px-12 rounded-2xl font-bold text-xl shadow-lg transition-all flex items-center justify-center gap-4 active:scale-[0.98] mb-4"
      >
        <QrCode class="size-8" />
        {{ t.scanQR }}
      </button>

      <!-- Divider -->
      <div class="flex items-center gap-4 w-full max-w-sm mb-4">
        <div class="flex-1 h-px bg-gray-300"></div>
        <span class="text-gray-400 text-sm">{{ t.or }}</span>
        <div class="flex-1 h-px bg-gray-300"></div>
      </div>

      <!-- Manual code entry -->
      <div class="w-full max-w-sm bg-gray-50 rounded-2xl p-4 border border-gray-200">
        <input 
          v-model="manualSessionId" 
          type="text" 
          class="w-full px-4 py-3 bg-white border border-gray-300 rounded-xl text-sm text-center focus:outline-none ring-2 ring-emerald-200 transition-all"
          :placeholder="t.codePlaceholder"
          @keyup.enter="handleManualSubmit"
        />
        <button 
          @click="handleManualSubmit"
          :disabled="!manualSessionId.trim() || manualLoading"
          class="mt-3 w-full bg-gray-100 hover:bg-gray-200 text-gray-700 py-3 rounded-xl font-bold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          <Loader2 v-if="manualLoading" class="size-4 animate-spin" />
          {{ t.continue }}
        </button>
      </div>
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
import { ref, onMounted } from 'vue';
import { useSelfOrderI18n } from '../../composables/useSelfOrderI18n.js';
import { useRouter } from 'vue-router';
import { UtensilsCrossed, Loader2, AlertCircle, QrCode } from 'lucide-vue-next';
import { useSelfOrderAuth } from '../../composables/useSelfOrderAuth.js';
import { useSelfOrderMenu } from '../../composables/useSelfOrderMenu.js';
import SelfOrderQRScanner from '../../components/selforder/SelfOrderQRScanner.vue';

const router = useRouter();
const { validateAndLoadSession, parseSessionUrl } = useSelfOrderAuth();
const { loadMenu } = useSelfOrderMenu();

const loading = ref(false);
const manualLoading = ref(false);
const error = ref(null);
const showScanner = ref(false);
const manualSessionId = ref('');

// Simple config
const restaurantName = ref('Ristorante');
const restaurantSubtitle = ref('Scansiona il QR o inserisci il codice del tuo tavolo');
const restaurantLogo = ref(null);

const i18n = {
  it: {
    connecting: 'Connessione in corso...',
    sessionExpired: 'Sessione non valida o scaduta',
    scanQR: 'Scansiona QR',
    or: 'oppure',
    codePlaceholder: 'Inserisci codice',
    continue: 'Continua',
    retry: 'Riprova',
  },
  en: {
    connecting: 'Connecting...',
    sessionExpired: 'Session invalid or expired',
    scanQR: 'Scan QR',
    or: 'or',
    codePlaceholder: 'Enter code',
    continue: 'Continue',
    retry: 'Retry',
  }
};

const { t, currentLang } = useSelfOrderI18n(i18n);

async function handleQRScanned(url) {
  showScanner.value = false;
  loading.value = true;
  error.value = null;
  
  try {
    // parseSessionUrl extracts both sessionId and optional access_token.
    const { sessionId, token } = parseSessionUrl(url);
    if (!sessionId) {
      throw new Error(t.value.sessioneScaduta);
    }
    
    await validateAndLoadSession(sessionId, token);
    await loadMenu();
    
    const hasSeenOnboarding = sessionStorage.getItem('selforder_onboarding_done');
    router.push(hasSeenOnboarding ? '/menu' : '/onboarding');
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
    router.push(hasSeenOnboarding ? '/menu' : '/onboarding');
  } catch (e) {
    error.value = e.message || t.value.sessioneScaduta;
  } finally {
    manualLoading.value = false;
  }
}

function extractSessionId(url) {
  // Kept for backwards compatibility; parseSessionUrl is the canonical parser.
  const { sessionId } = parseSessionUrl(url);
  return sessionId;
}

function handleScannerError(msg) {
  error.value = msg;
}

onMounted(async () => {
  const hash = window.location.hash;
  const sessionMatch = hash.match(/\/session\/([^?]+)/);

  if (sessionMatch) {
    loading.value = true;
    error.value = null;

    try {
      // Extract an optional access_token embedded in the hash fragment.
      const tokenMatch = hash.match(/[?&]access_token=([^&]+)/);
      const token = tokenMatch ? decodeURIComponent(tokenMatch[1]) : null;
      await validateAndLoadSession(sessionMatch[1], token);
      await loadMenu();

      const hasSeenOnboarding = sessionStorage.getItem('selforder_onboarding_done');
      router.push(hasSeenOnboarding ? '/menu' : '/onboarding');
    } catch (e) {
      error.value = e.message || t.value.sessioneScaduta;
    } finally {
      loading.value = false;
    }
  } else {
    // PWA reload with no session in the URL: re-validate a previously cached
    // session (so the customer doesn't have to re-scan the QR on every
    // reload). validateAndLoadSession re-checks status === 'open' server-side,
    // so a closed session is correctly rejected and the scan UI is shown.
    const cachedId = sessionStorage.getItem('selforder_session_id');
    if (cachedId) {
      loading.value = true;
      try {
        await validateAndLoadSession(cachedId);
        await loadMenu();
        const hasSeenOnboarding = sessionStorage.getItem('selforder_onboarding_done');
        router.push(hasSeenOnboarding ? '/menu' : '/onboarding');
      } catch (e) {
        // Cached session invalid/closed → clear it and stay on the scan view.
        sessionStorage.removeItem('selforder_session_id');
      } finally {
        loading.value = false;
      }
    }
  }
});
</script>
