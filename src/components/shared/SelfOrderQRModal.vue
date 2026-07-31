<template>
  <Teleport to="body">
    <Transition name="fade">
      <div 
        v-if="modelValue"
        class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
        @click.self="$emit('update:modelValue', false)"
      >
        <div class="bg-white rounded-2xl p-6 w-full max-w-sm">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-bold text-gray-800">
              {{ session?.tableName || 'QR Code' }}
            </h2>
            <button 
              class="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center"
              @click="$emit('update:modelValue', false)"
            >
              <X class="w-5 h-5 text-gray-600" />
            </button>
          </div>

          <p class="text-gray-600 text-sm mb-4">
            Il cliente può scansionare il codice QR per ordinare dal proprio dispositivo
          </p>

          <!-- QR Code Display -->
          <div class="bg-white p-4 rounded-xl border border-gray-200 flex items-center justify-center mb-4">
            <div 
              ref="qrContainer"
              class="w-48 h-48"
            >
              <!-- QR code will be rendered here via canvas -->
              <canvas ref="qrCanvas" class="w-full h-full"></canvas>
            </div>
          </div>

          <!-- Session info -->
          <div class="bg-gray-50 rounded-xl p-4 mb-4">
            <div class="flex justify-between text-sm">
              <span class="text-gray-600">Codice sessione:</span>
              <span class="font-mono font-medium text-gray-800">{{ shortSessionId }}</span>
            </div>
            <div v-if="session" class="flex justify-between text-sm mt-2">
              <span class="text-gray-600">Tavolo:</span>
              <span class="font-medium text-gray-800">{{ session.tableName }}</span>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex gap-3">
            <button 
              class="flex-1 py-3 bg-gray-100 text-gray-700 rounded-xl font-medium flex items-center justify-center gap-2"
              @click="downloadQR"
            >
              <Download class="w-5 h-5" />
              Scarica QR
            </button>
            <button 
              class="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-medium flex items-center justify-center gap-2"
              @click="shareQR"
            >
              <Share2 class="w-5 h-5" />
              Condividi
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import { X, Download, Share2 } from 'lucide-vue-next';
import QRCode from 'qrcode';

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  session: { type: Object, default: null }
});

const emit = defineEmits(['update:modelValue']);

const qrCanvas = ref(null);

const shortSessionId = computed(() => {
  if (!props.session?.id) return '—';
  return props.session.id.slice(0, 8).toUpperCase();
});

const sessionUrl = computed(() => {
  if (!props.session?.id) return '';
  return `selforder://session/${props.session.id}`;
});

async function renderQRCode() {
  if (!qrCanvas.value || !sessionUrl.value) return;
  
  try {
    await QRCode.toCanvas(qrCanvas.value, sessionUrl.value, {
      width: 192,
      margin: 2,
      color: {
        dark: '#059669',
        light: '#ffffff'
      }
    });
  } catch (err) {
    console.error('[SelfOrderQRModal] QR code generation failed:', err);
  }
}

watch(() => props.modelValue, async (visible) => {
  if (visible) {
    await nextTick();
    renderQRCode();
  }
});

watch(() => props.session, async () => {
  if (props.modelValue) {
    await nextTick();
    renderQRCode();
  }
});

function downloadQR() {
  if (!qrCanvas.value) return;
  
  const link = document.createElement('a');
  link.download = `qr-${shortSessionId.value}.png`;
  link.href = qrCanvas.value.toDataURL('image/png');
  link.click();
}

async function shareQR() {
  if (!props.session) return;
  
  const shareData = {
    title: `Ordina al tavolo ${props.session.tableName}`,
    text: 'Scansiona il QR code per ordinare dal tuo dispositivo',
    url: sessionUrl.value
  };
  
  if (navigator.share) {
    try {
      await navigator.share(shareData);
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('[SelfOrderQRModal] Share failed:', err);
      }
    }
  } else {
    // Fallback: copy URL to clipboard
    await navigator.clipboard.writeText(sessionUrl.value);
    alert('Link copiato negli appunti!');
  }
}
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
