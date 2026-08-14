<template>
  <div class="fixed inset-0 z-[80] bg-black flex flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between p-4 bg-black/80 backdrop-blur">
      <h2 class="text-white font-bold">{{ t.title }}</h2>
      <button 
        @click="$emit('close')"
        class="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center"
      >
        <X class="w-6 h-6 text-white" />
      </button>
    </div>

    <!-- Scanner area -->
    <div class="flex-1 relative">
      <div id="scanner-region" ref="scannerContainer" class="w-full h-full"></div>
      
      <!-- Scanning frame overlay -->
      <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div class="w-64 h-64 border-2 border-white rounded-2xl relative">
          <div class="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-emerald-400 rounded-tl-xl"></div>
          <div class="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-emerald-400 rounded-tr-xl"></div>
          <div class="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-emerald-400 rounded-bl-xl"></div>
          <div class="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-emerald-400 rounded-br-xl"></div>
        </div>
      </div>
    </div>

    <!-- Error/Status -->
    <div class="p-4 bg-black/80 backdrop-blur text-center">
      <p v-if="error" class="text-red-400 text-sm">{{ error }}</p>
      <p v-else class="text-white/70 text-sm">{{ t.instructions }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { Html5Qrcode } from 'html5-qrcode';
import { X } from 'lucide-vue-next';
import { useSelfOrderI18n } from '../../composables/useSelfOrderI18n.js';

const emit = defineEmits(['scanned', 'close', 'error']);

const scannerContainer = ref(null);
const error = ref(null);

const i18n = {
  it: {
    title: 'Scansiona QR Code',
    instructions: 'Inquadra il codice QR del tuo tavolo',
    errorCamera: 'Impossibile accedere alla fotocamera',
    errorGeneric: 'Errore durante la scansione'
  },
  en: {
    title: 'Scan QR Code',
    instructions: 'Point your camera at the table QR code',
    errorCamera: 'Cannot access camera',
    errorGeneric: 'Scan error'
  }
};
const { t } = useSelfOrderI18n(i18n);

let html5QrCode = null;
let hasScanned = false;

onMounted(async () => {
  hasScanned = false;
  try {
    html5QrCode = new Html5Qrcode('scanner-region');

    const config = {
      fps: 10,
      qrbox: { width: 250, height: 250 },
      aspectRatio: 1.0
    };

    await html5QrCode.start(
      { facingMode: 'environment' },
      config,
      onScanSuccess,
      onScanFailure
    );
  } catch (err) {
    console.error('[QRScanner] Init error:', err);
    error.value = t.errorCamera;
    emit('error', t.errorCamera);
  }
});

function stopScanner() {
  if (!html5QrCode) return;
  const instance = html5QrCode;
  html5QrCode = null;
  // Guard against stopping before start() has completed (throws otherwise).
  Promise.resolve()
    .then(() => (instance.isScanning ? instance.stop() : Promise.resolve()))
    .then(() => instance.clear?.())
    .catch(() => {});
}

onUnmounted(() => {
  stopScanner();
});

function onScanSuccess(decodedText) {
  // html5-qrcode keeps firing while the QR stays in frame; emit exactly once.
  if (hasScanned) return;
  hasScanned = true;
  if (navigator.vibrate) {
    navigator.vibrate(200);
  }
  stopScanner();
  emit('scanned', decodedText);
}

function onScanFailure(err) {
  // Silently ignore scan failures (no QR found in frame)
  // Only log in debug mode
  // console.debug('[QRScanner] Scan failure:', err);
}
</script>

<style>
#scanner-region {
  width: 100%;
  height: 100%;
}
#scanner-region video {
  object-fit: cover;
}
</style>
