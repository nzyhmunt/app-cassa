<template>
  <Teleport to="body">
    <Transition name="fade">
      <div 
        v-if="modelValue"
        class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[70] p-4"
        @click.self="$emit('update:modelValue', false)"
      >
        <div class="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-bold text-gray-800">
              {{ session?.tableName || 'QR Code' }}
            </h2>
            <button 
              class="w-10 h-10 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
              @click="$emit('update:modelValue', false)"
            >
              <X class="w-5 h-5 text-gray-600" />
            </button>
          </div>

          <!-- Error: no session -->
          <div v-if="!hasValidSession" class="text-center py-8">
            <AlertCircle class="w-12 h-12 text-amber-500 mx-auto mb-3" />
            <p class="text-gray-600 mb-2">Nessuna sessione attiva</p>
            <p class="text-sm text-gray-400">Apri il tavolo per generare il QR code</p>
          </div>

          <template v-else>
            <p class="text-gray-600 text-sm mb-4">
              Il cliente può scansionare il codice QR per ordinare dal proprio dispositivo
            </p>

            <!-- QR Code Display -->
            <div class="bg-white p-4 rounded-xl border-2 border-emerald-100 flex items-center justify-center mb-4">
              <canvas ref="qrCanvas" class="w-48 h-48"></canvas>
            </div>

            <!-- Session info -->
            <div class="bg-gray-50 rounded-xl p-4 mb-4">
              <div class="flex justify-between text-sm">
                <span class="text-gray-600">Codice sessione:</span>
                <span class="font-mono font-medium text-emerald-600">{{ shortSessionId }}</span>
              </div>
              <div v-if="session" class="flex justify-between text-sm mt-2">
                <span class="text-gray-600">Tavolo:</span>
                <span class="font-medium text-gray-800">{{ session.tableName }}</span>
              </div>
            </div>

            <!-- URL preview -->
            <div class="bg-gray-100 rounded-lg p-2 mb-4">
              <p class="text-xs text-gray-500 truncate font-mono">{{ sessionUrl }}</p>
            </div>

            <!-- Actions -->
            <div class="flex gap-3">
              <button 
                class="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors"
                @click="downloadQR"
              >
                <Download class="w-5 h-5" />
                Scarica
              </button>
              <button 
                class="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-medium flex items-center justify-center gap-2 transition-colors"
                @click="shareQR"
              >
                <Share2 class="w-5 h-5" />
                Condividi
              </button>
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import { X, Download, Share2, AlertCircle } from 'lucide-vue-next';
import QRCode from 'qrcode';
import { useConfigStore } from '../../store/index.js';

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  session: { type: Object, default: null }
});

const emit = defineEmits(['update:modelValue']);

const configStore = useConfigStore();
const qrCanvas = ref(null);

const hasValidSession = computed(() => {
  return props.session?.id && props.session.id.length > 0;
});

const shortSessionId = computed(() => {
  if (!props.session?.id) return '—';
  return props.session.id.slice(0, 8).toUpperCase();
});

const sessionUrl = computed(() => {
  if (!props.session?.id) return '';
  // The customer opens the SELF-ORDER app, not the staff app: use the
  // configured self-order base URL, falling back to the current origin only
  // when the two apps are served from the same place.
  const configured = configStore.config?.selfOrder?.appUrl;
  const base = (configured && configured.trim())
    ? configured.replace(/\/+$/, '')
    : (window.location.origin + window.location.pathname.replace(/\/[^/]*$/, ''));
  return `${base}#/session/${props.session.id}`;
});

async function renderQRCode() {
  if (!qrCanvas.value || !sessionUrl.value) return;
  
  try {
    // Clear previous QR
    const ctx = qrCanvas.value.getContext('2d');
    ctx.clearRect(0, 0, qrCanvas.value.width, qrCanvas.value.height);
    
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
    if (hasValidSession.value) {
      renderQRCode();
    }
  }
});

watch(() => props.session, async () => {
  if (props.modelValue && hasValidSession.value) {
    await nextTick();
    renderQRCode();
  }
});

function downloadQR() {
  if (!qrCanvas.value || !hasValidSession.value) return;
  
  const link = document.createElement('a');
  link.download = `qr-tavolo-${props.session.tableName || 'session'}.png`;
  link.href = qrCanvas.value.toDataURL('image/png');
  link.click();
}

async function shareQR() {
  if (!hasValidSession.value) return;
  
  const title = `Ordina al tavolo ${props.session.tableName || ''}`;
  const text = 'Scansiona il QR code per ordinare dal tuo dispositivo';
  const url = sessionUrl.value;
  
  // Try native share first
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.warn('[SelfOrderQRModal] Native share failed, trying clipboard:', err);
    }
  }
  
  // Fallback: copy URL to clipboard
  try {
    await navigator.clipboard.writeText(url);
    // Show temporary feedback
    const btn = event?.target?.closest('button');
    if (btn) {
      const originalText = btn.innerHTML;
      btn.innerHTML = '<span>✓ Copiato!</span>';
      setTimeout(() => {
        btn.innerHTML = originalText;
      }, 2000);
    } else {
      alert('Link copiato negli appunti!');
    }
  } catch (err) {
    console.error('[SelfOrderQRModal] Clipboard copy failed:', err);
    alert('Condividi questo link:\n' + url);
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
