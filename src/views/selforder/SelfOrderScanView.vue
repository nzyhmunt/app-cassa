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
    <p class="text-gray-500 mb-12 max-w-md">{{ restaurantSubtitle }}</p>

    <!-- Session validation error -->
    <div v-if="error" class="bg-red-50 border border-red-200 rounded-2xl p-4 mb-6 w-full max-w-sm">
      <AlertCircle class="w-8 h-8 text-red-500 mx-auto mb-2" />
      <p class="text-red-700 text-sm font-medium">{{ error }}</p>
      <button 
        @click="error = null; showScanner = true"
        class="mt-3 px-4 py-2 bg-red-100 text-red-700 rounded-lg text-sm font-medium"
      >
        Riprova
      </button>
    </div>

    <!-- Loading state -->
    <div v-else-if="loading" class="flex flex-col items-center">
      <Loader2 class="size-12 text-emerald-600 animate-spin mb-4" />
      <p class="text-gray-500">{{ t.connessione }}</p>
    </div>

    <!-- QR Scanner button (only shown when not loading and no error) -->
    <button 
      v-if="!loading && !error"
      @click="showScanner = true" 
      class="theme-bg hover:theme-bg-dark text-white py-6 px-12 rounded-2xl font-bold text-xl shadow-lg transition-all flex items-center justify-center gap-4 active:scale-[0.98]"
    >
      <QrCode class="size-8" />
      {{ t.scansionaQR }}
    </button>

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
const error = ref(null);
const showScanner = ref(false);
const currentLang = ref(localStorage.getItem('selforder_lang') || 'it');

// Simple config (could be loaded from static config.json)
const restaurantName = ref('Ristorante');
const restaurantSubtitle = ref('Scansiona il QR sul tuo tavolo per iniziare');
const restaurantLogo = ref(null);

const languages = [
  { code: 'it', flag: '🇮🇹', name: 'Italiano' },
  { code: 'en', flag: '🇬🇧', name: 'English' }
];

const i18n = {
  it: {
    connessione: 'Connessione in corso...',
    sessioneScaduta: 'Sessione scaduta o non valida',
    scansionaQR: 'Scansiona QR',
  },
  en: {
    connessione: 'Connecting...',
    sessioneScaduta: 'Session expired or invalid',
    scansionaQR: 'Scan QR',
  }
};

const t = computed(() => i18n[currentLang.value] || i18n.it);

async function handleQRScanned(url) {
  showScanner.value = false;
  loading.value = true;
  error.value = null;
  
  try {
    // Extract session ID and token from URL
    // Format: selforder.html#/session/{uuid}?access_token={jwt}
    const urlObj = new URL(url);
    const hash = urlObj.hash;
    const sessionMatch = hash.match(/\/session\/([^?]+)/);
    
    if (!sessionMatch) {
      throw new Error(t.value.sessioneScaduta);
    }
    
    const sessionId = sessionMatch[1];
    const accessToken = urlObj.searchParams.get('access_token');
    
    // Validate session with optional token
    await validateAndLoadSession(sessionId, accessToken);
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

function handleScannerError(msg) {
  error.value = msg;
}

// Handle direct URL with session params (from deep link / pre-scanned QR)
onMounted(async () => {
  const hash = window.location.hash;
  
  // Check for session in URL: selforder.html#/session/{uuid}
  const sessionMatch = hash.match(/\/session\/([^?]+)/);
  
  if (sessionMatch) {
    const sessionId = sessionMatch[1];
    const urlParams = new URLSearchParams(hash.split('?')[1] || '');
    const accessToken = urlParams.get('access_token');
    
    loading.value = true;
    error.value = null;
    
    try {
      await validateAndLoadSession(sessionId, accessToken);
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
