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
        Riprova
      </button>
    </div>

    <!-- QR Scanner button -->
    <button 
      @click="showScanner = true" 
      class="mb-6 theme-bg hover:theme-bg-dark text-white py-4 px-8 rounded-2xl font-bold text-lg shadow-md transition-all flex items-center justify-center gap-3 active:scale-[0.98]"
    >
      <QrCode class="size-6" />
      {{ t.scansionaQR }}
    </button>

    <!-- Divider -->
    <div class="flex items-center gap-4 w-full max-w-sm mb-6">
      <div class="flex-1 h-px bg-gray-300"></div>
      <span class="text-gray-400 text-sm font-medium">oppure</span>
      <div class="flex-1 h-px bg-gray-300"></div>
    </div>

    <!-- Table number input -->
    <div class="bg-gray-50 p-6 md:p-8 rounded-3xl shadow-sm border border-gray-100 w-full max-w-sm">
      <label class="block text-sm font-bold text-gray-700 mb-3 uppercase tracking-wide flex items-center justify-center gap-2">
        <MapPin class="size-4 theme-text" />
        {{ t.inserisciTavolo }}
      </label>
      <div class="relative mb-6">
        <input 
          v-model="tableNumber" 
          type="number" 
          min="1" 
          class="w-full px-4 py-4 bg-white border border-gray-300 rounded-2xl text-2xl font-black text-center focus:outline-none ring-2 ring-emerald-200 transition-all shadow-inner" 
          placeholder="##" 
          @keyup.enter="handleStart"
        />
      </div>
      <button 
        @click="handleStart" 
        :disabled="!tableNumber || loading"
        class="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 py-4 rounded-2xl font-bold text-lg shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-[0.98]"
      >
        <Loader2 v-if="loading" class="size-5 animate-spin" />
        <template v-else>
          {{ t.iniziaOrdine }} <ArrowRight class="size-5" />
        </template>
      </button>
    </div>

    <!-- Language selector -->
    <div class="mt-8 relative inline-block text-left">
      <button 
        @click.stop="langMenuOpen = !langMenuOpen" 
        class="flex items-center gap-2 bg-gray-100 rounded-full px-5 py-3 border border-gray-200 shadow-sm transition-all hover:bg-gray-200 cursor-pointer font-bold text-gray-700 text-lg"
      >
        <span class="text-2xl leading-none">{{ currentLanguageObj.flag }}</span> 
        {{ currentLanguageObj.name }}
        <ChevronDown class="size-5 text-gray-500 ml-1" />
      </button>
      <div v-if="langMenuOpen" @click="langMenuOpen = false" class="fixed inset-0 z-40"></div>
      <div 
        v-if="langMenuOpen" 
        class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-white rounded-2xl shadow-xl border border-gray-100 py-2 z-50 w-48 overflow-hidden transform origin-bottom transition-all"
      >
        <button 
          v-for="lang in languages" 
          :key="lang.code" 
          @click="setLang(lang.code); langMenuOpen = false" 
          class="w-full px-5 py-3 text-left hover:bg-gray-50 flex items-center gap-3 transition-colors text-gray-800"
        >
          <span class="text-2xl leading-none">{{ lang.flag }}</span> 
          <span class="font-bold">{{ lang.name }}</span>
        </button>
      </div>
    </div>

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
import { MapPin, ArrowRight, ChevronDown, UtensilsCrossed, Loader2, AlertCircle, QrCode } from 'lucide-vue-next';
import { useSelfOrderAuth } from '../../composables/useSelfOrderAuth.js';
import { useSelfOrderMenu } from '../../composables/useSelfOrderMenu.js';
import SelfOrderQRScanner from '../../components/selforder/SelfOrderQRScanner.vue';

const router = useRouter();
const { validateAndLoadSession, parseSessionUrl, error: authError } = useSelfOrderAuth();
const { loadMenu } = useSelfOrderMenu();

const tableNumber = ref('');
const loading = ref(false);
const error = ref(null);
const langMenuOpen = ref(false);
const showScanner = ref(false);
const currentLang = ref(localStorage.getItem('selforder_lang') || 'it');

// Simple config (could be loaded from static config.json)
const restaurantName = ref('Ristorante');
const restaurantSubtitle = ref('Ordina dal tuo tavolo');
const restaurantLogo = ref(null);

const languages = [
  { code: 'it', flag: '🇮🇹', name: 'Italiano' },
  { code: 'en', flag: '🇬🇧', name: 'English' }
];

const i18n = {
  it: {
    inserisciTavolo: 'Indica il tuo tavolo',
    iniziaOrdine: 'Visualizza Menu',
    connessione: 'Connessione in corso...',
    sessioneScaduta: 'Sessione scaduta o non valida',
    scansionaQR: 'Scansiona QR',
  },
  en: {
    inserisciTavolo: 'Enter your table',
    iniziaOrdine: 'View Menu',
    connessione: 'Connecting...',
    sessioneScaduta: 'Session expired or invalid',
    scansionaQR: 'Scan QR',
  }
};

const t = computed(() => i18n[currentLang.value] || i18n.it);
const currentLanguageObj = computed(() => languages.find(l => l.code === currentLang.value) || languages[0]);

function setLang(code) {
  currentLang.value = code;
  localStorage.setItem('selforder_lang', code);
}

async function handleStart() {
  if (!tableNumber.value || loading.value) return;
  
  loading.value = true;
  error.value = null;
  
  try {
    await loadMenu();
    localStorage.setItem('selforder_table', tableNumber.value);
    
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

async function handleQRScanned(url) {
  showScanner.value = false;
  loading.value = true;
  error.value = null;
  
  try {
    // Extract session ID from URL
    const sessionMatch = url.match(/\/session\/([^?]+)/);
    if (!sessionMatch) {
      throw new Error('URL QR non valido');
    }
    
    const sessionId = sessionMatch[1];
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

function handleScannerError(msg) {
  error.value = msg;
}

// Handle direct URL with session params (from QR code)
onMounted(async () => {
  const hash = window.location.hash;
  
  // Check for session in URL: selforder.html#/session/{uuid}
  const sessionMatch = hash.match(/\/session\/([^?]+)/);
  
  if (sessionMatch) {
    const sessionId = sessionMatch[1];
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
