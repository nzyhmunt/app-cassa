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
            <h2 class="text-lg font-bold text-gray-800 flex items-center gap-2">
              <Users class="size-5 theme-text" />
              {{ t.shareTable }}
            </h2>
            <button 
              class="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center"
              @click="$emit('update:modelValue', false)"
            >
              <X class="w-5 h-5 text-gray-600" />
            </button>
          </div>

          <p class="text-gray-600 text-sm mb-4">
            {{ t.shareDesc }}
          </p>

          <!-- QR Code -->
          <div class="bg-white p-4 rounded-xl border border-gray-200 flex items-center justify-center mb-4">
            <canvas ref="qrCanvas" class="w-48 h-48"></canvas>
          </div>

          <!-- Share URL -->
          <div class="bg-gray-50 rounded-xl p-3 mb-4">
            <p class="text-xs text-gray-500 mb-1">{{ t.shareLink }}</p>
            <p class="text-sm font-mono text-gray-700 truncate">{{ shareUrl }}</p>
          </div>

          <!-- Actions -->
          <div class="flex gap-3">
            <button 
              class="flex-1 py-3 bg-gray-100 text-gray-700 rounded-xl font-medium flex items-center justify-center gap-2"
              @click="copyLink"
            >
              <Copy class="size-5" />
              {{ copied ? t.copied : t.copyLink }}
            </button>
            <button 
              class="flex-1 py-3 theme-bg text-white rounded-xl font-medium flex items-center justify-center gap-2"
              @click="shareLink"
            >
              <Share2 class="size-5" />
              {{ t.share }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import { useSelfOrderI18n } from '../../composables/useSelfOrderI18n.js';
import { TOKEN_CACHE_KEY } from '../../composables/useSelfOrderAuth.js';
import { X, Users, Copy, Share2 } from 'lucide-vue-next';
import QRCode from 'qrcode';

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  sessionId: { type: String, default: '' },
});

const emit = defineEmits(['update:modelValue']);

const qrCanvas = ref(null);
const copied = ref(false);

// Get share URL (current page with session param). Append the cached Directus
// access_token when present so shared sessions can authenticate in
// environments that require it (otherwise the recipient lands on a 401/403).
const shareUrl = computed(() => {
  const base = window.location.origin + window.location.pathname;
  let url = `${base}#/session/${props.sessionId || 'demo'}`;
  const token = sessionStorage.getItem(TOKEN_CACHE_KEY);
  if (token) {
    url += `?access_token=${encodeURIComponent(token)}`;
  }
  return url;
});

// Generate QR code when modal opens
watch(() => props.modelValue, async (visible) => {
  if (visible) {
    await nextTick();
    generateQR();
  }
});

async function generateQR() {
  if (!qrCanvas.value || !shareUrl.value) return;
  
  try {
    await QRCode.toCanvas(qrCanvas.value, shareUrl.value, {
      width: 192,
      margin: 2,
      color: {
        dark: '#059669',
        light: '#ffffff'
      }
    });
  } catch (err) {
    console.error('[ShareSession] QR generation failed:', err);
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(shareUrl.value);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  } catch {
    // Fallback
    const el = document.createElement('textarea');
    el.value = shareUrl.value;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  }
}

async function shareLink() {
  if (navigator.share) {
    try {
      await navigator.share({
        title: 'Ordina al tavolo',
        text: 'Scansiona il QR o apri il link per unirti al mio ordine',
        url: shareUrl.value,
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        copyLink();
      }
    }
  } else {
    copyLink();
  }
}

// Translations
const i18n = {
  it: {
    shareTable: 'Condividi Tavolo',
    shareDesc: 'Invita altre persone al tuo tavolo a ordinare insieme',
    shareLink: 'Link di condivisione',
    copyLink: 'Copia Link',
    copied: 'Copiato!',
    share: 'Condividi',
  },
  en: {
    shareTable: 'Share Table',
    shareDesc: 'Invite others at your table to order together',
    shareLink: 'Share link',
    copyLink: 'Copy Link',
    copied: 'Copied!',
    share: 'Share',
  }
};
const { t, currentLang } = useSelfOrderI18n(i18n);
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
