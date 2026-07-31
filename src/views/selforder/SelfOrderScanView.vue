<template>
  <div class="h-full flex flex-col items-center justify-center p-6 bg-gradient-to-b from-emerald-50 to-white">
    <div class="text-center mb-8">
      <div class="w-24 h-24 mx-auto mb-4 bg-emerald-100 rounded-full flex items-center justify-center">
        <QrCode class="w-12 h-12 text-emerald-600" />
      </div>
      <h1 class="text-2xl font-bold text-gray-800 mb-2">Ordina da Solo</h1>
      <p class="text-gray-600">Scansiona il codice QR sul tavolo per iniziare</p>
    </div>

    <div class="w-full max-w-sm">
      <div 
        class="aspect-square bg-gray-100 rounded-2xl overflow-hidden relative cursor-pointer"
        :class="{ 'ring-4 ring-emerald-500': isScanning }"
        @click="startCamera"
      >
        <video 
          ref="videoRef" 
          class="w-full h-full object-cover"
          :class="{ 'hidden': !isScanning }"
        ></video>
        
        <div 
          v-if="!isScanning && !error"
          class="absolute inset-0 flex flex-col items-center justify-center"
          @click="startCamera"
        >
          <Camera class="w-12 h-12 text-gray-400 mb-2" />
          <span class="text-gray-500 text-sm">Tocca per attivare la fotocamera</span>
        </div>

        <div 
          v-if="error"
          class="absolute inset-0 flex flex-col items-center justify-center bg-gray-100 p-4"
        >
          <AlertCircle class="w-12 h-12 text-red-500 mb-2" />
          <span class="text-red-600 text-sm text-center">{{ error }}</span>
          <button 
            class="mt-4 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm"
            @click="startCamera"
          >
            Riprova
          </button>
        </div>

        <div v-if="isScanning" class="absolute inset-0 pointer-events-none">
          <div class="absolute inset-8 border-2 border-emerald-500 rounded-lg"></div>
          <div class="absolute inset-0 flex items-center justify-center">
            <div class="w-48 h-1 bg-emerald-500 animate-pulse rounded"></div>
          </div>
        </div>
      </div>
    </div>

    <div class="mt-8 w-full max-w-sm">
      <button 
        class="w-full py-3 bg-gray-200 text-gray-700 rounded-xl font-medium"
        @click="showManualEntry = true"
      >
        Inserisci codice manualmente
      </button>
    </div>

    <!-- Manual entry modal -->
    <div 
      v-if="showManualEntry" 
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      @click.self="showManualEntry = false"
    >
      <div class="bg-white rounded-2xl p-6 w-full max-w-sm">
        <h2 class="text-lg font-bold mb-4">Inserisci il codice tavolo</h2>
        <input
          v-model="manualCode"
          type="text"
          placeholder="es. TAV-123456"
          class="w-full px-4 py-3 border border-gray-300 rounded-xl mb-4 text-center text-lg"
        />
        <div class="flex gap-3">
          <button 
            class="flex-1 py-3 bg-gray-100 text-gray-700 rounded-xl font-medium"
            @click="showManualEntry = false"
          >
            Annulla
          </button>
          <button 
            class="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-medium"
            :disabled="!manualCode.trim()"
            @click="submitManualCode"
          >
            Continua
          </button>
        </div>
      </div>
    </div>

    <!-- Loading state -->
    <div 
      v-if="loading" 
      class="fixed inset-0 bg-white/80 flex items-center justify-center z-40"
    >
      <div class="text-center">
        <Loader2 class="w-12 h-12 text-emerald-600 animate-spin mx-auto mb-4" />
        <p class="text-gray-600">Connessione in corso...</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { QrCode, Camera, AlertCircle, Loader2 } from 'lucide-vue-next';
import { useSelfOrderSession } from '../../composables/useSelfOrderSession.js';

const router = useRouter();
const { session, initSession, loading, error } = useSelfOrderSession();

const videoRef = ref(null);
const isScanning = ref(false);
const showManualEntry = ref(false);
const manualCode = ref('');

let stream = null;
let barcodeDetector = null;

async function startCamera() {
  try {
    error.value = null;
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    });
    
    if (videoRef.value) {
      videoRef.value.srcObject = stream;
      await videoRef.value.play();
      isScanning.value = true;
      startBarcodeDetection();
    }
  } catch (e) {
    console.error('[SelfOrderScan] Camera error:', e);
    error.value = 'Impossibile accedere alla fotocamera. Assicurati di aver dato i permessi.';
  }
}

async function startBarcodeDetection() {
  if ('BarcodeDetector' in window) {
    try {
      barcodeDetector = new BarcodeDetector({
        formats: ['qr_code', 'code_128', 'code_39']
      });
      
      const detect = async () => {
        if (!isScanning.value || !videoRef.value) return;
        
        try {
          const barcodes = await barcodeDetector.detect(videoRef.value);
          if (barcodes.length > 0) {
            handleBarcode(barcodes[0].rawValue);
            return;
          }
        } catch {
          // Detection failed, continue
        }
        
        requestAnimationFrame(detect);
      };
      
      detect();
    } catch {
      console.warn('[SelfOrderScan] BarcodeDetector not supported');
      // Fallback: manual entry only
      error.value = 'Rilevamento QR non disponibile. Usa l\'inserimento manuale.';
    }
  } else {
    error.value = 'Rilevamento QR non supportato su questo dispositivo. Usa l\'inserimento manuale.';
  }
}

async function handleBarcode(value) {
  stopCamera();
  
  // Parse the QR code value - expected format: selforder://session/{sessionId} or just the session ID
  let sessionId = value;
  
  if (value.startsWith('selforder://')) {
    sessionId = value.replace('selforder://session/', '');
  }
  
  await joinSession(sessionId);
}

async function submitManualCode() {
  if (!manualCode.value.trim()) return;
  showManualEntry.value = false;
  await joinSession(manualCode.value.trim());
}

async function joinSession(sessionId) {
  try {
    await initSession(sessionId);
    router.push('/menu');
  } catch (e) {
    error.value = e.message || 'Sessione non valida o scaduta';
    manualCode.value = '';
  }
}

function stopCamera() {
  isScanning.value = false;
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
}

onUnmounted(() => {
  stopCamera();
});
</script>
