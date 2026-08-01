<template>
  <div class="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center">
    <!-- Header -->
    <div class="absolute top-0 left-0 right-0 p-4 flex justify-between items-center z-10">
      <button 
        @click="$emit('close')"
        class="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center text-white"
      >
        <X class="size-6" />
      </button>
      <span class="text-white font-bold">Scansiona QR Code</span>
      <div class="w-10"></div>
    </div>

    <!-- Scanner area -->
    <div id="qr-reader" ref="readerRef" class="w-full max-w-sm aspect-square"></div>

    <!-- Instructions -->
    <div class="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/80 to-transparent">
      <p class="text-white/80 text-center text-sm">
        Inquadra il codice QR sul tavolo
      </p>
    </div>

    <!-- Loading/Error overlay -->
    <div v-if="loading" class="absolute inset-0 bg-black/70 flex items-center justify-center z-20">
      <Loader2 class="size-12 text-white animate-spin" />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { Html5Qrcode } from 'html5-qrcode';
import { X, Loader2 } from 'lucide-vue-next';

const emit = defineEmits(['scanned', 'close', 'error']);

const readerRef = ref(null);
const loading = ref(true);
let html5QrCode = null;

onMounted(async () => {
  try {
    html5QrCode = new Html5Qrcode('qr-reader');
    
    await html5QrCode.start(
      { facingMode: 'environment' },
      {
        fps: 10,
        qrbox: { width: 250, height: 250 },
      },
      (decodedText) => {
        // Success - emit the decoded URL
        emit('scanned', decodedText);
        stopScanner();
      },
      (errorMessage) => {
        // Ignore scan errors (noise, partial reads)
      }
    );
    loading.value = false;
  } catch (err) {
    console.error('[QRScanner] Camera error:', err);
    emit('error', 'Impossibile accedere alla fotocamera. Verifica i permessi.');
    emit('close');
  }
});

onUnmounted(() => {
  stopScanner();
});

async function stopScanner() {
  if (html5QrCode) {
    try {
      await html5QrCode.stop();
    } catch (e) {
      // Ignore stop errors
    }
  }
}
</script>
