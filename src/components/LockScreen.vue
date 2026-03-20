<template>
  <Transition name="lock-fade">
    <div
      v-if="visible"
      class="fixed inset-0 z-[200] flex flex-col items-center justify-center select-none"
      :style="store.cssVars"
      style="background: linear-gradient(135deg, var(--brand-primary, #16a34a) 0%, var(--brand-primary-dark, #15803d) 100%)"
    >
      <!-- Clock & branding -->
      <div class="flex flex-col items-center mb-6 md:mb-8">
        <div class="bg-white/20 p-3 rounded-full mb-3 shadow-lg">
          <Lock class="size-7 text-white" />
        </div>
        <p class="text-5xl md:text-6xl font-black text-white tracking-tight tabular-nums">{{ currentTime }}</p>
        <p class="text-white/70 text-xs md:text-sm font-bold uppercase tracking-widest mt-1">{{ currentDate }}</p>
        <p class="text-white/60 text-[11px] mt-2 font-semibold">{{ store.config.ui.name }}</p>
      </div>

      <!-- Card -->
      <div class="bg-white rounded-3xl shadow-2xl w-full max-w-xs md:max-w-sm mx-4 overflow-hidden">

        <!-- ── User picker (shown when no user is selected) ──────────────── -->
        <template v-if="!selectedUserId">
          <div class="p-4 md:p-5 border-b border-gray-100">
            <h3 class="font-bold text-gray-800 text-center text-sm md:text-base">Seleziona utente</h3>
          </div>
          <div class="p-3 md:p-4 space-y-2 max-h-64 overflow-y-auto">
            <button
              v-for="user in users"
              :key="user.id"
              @click="selectUser(user.id)"
              class="w-full flex items-center gap-3 p-3 md:p-4 rounded-2xl border border-gray-200 hover:bg-gray-50 active:scale-95 transition-all"
            >
              <div class="size-9 rounded-full flex items-center justify-center text-white font-black text-base shrink-0"
                   :style="{ background: 'var(--brand-primary)' }">
                {{ user.name.charAt(0).toUpperCase() }}
              </div>
              <span class="font-bold text-gray-800 text-sm">{{ user.name }}</span>
              <ChevronRight class="size-4 text-gray-400 ml-auto shrink-0" />
            </button>
          </div>
        </template>

        <!-- ── PIN entry (shown when a user is selected) ─────────────────── -->
        <template v-else>
          <!-- User header -->
          <div class="p-4 md:p-5 flex items-center gap-3 border-b border-gray-100">
            <button
              v-if="users.length > 1"
              @click="selectedUserId = null; pinDigits = []; pinError = ''"
              class="p-1.5 rounded-full hover:bg-gray-100 active:scale-95 transition-colors shrink-0"
              title="Cambia utente"
            >
              <ChevronLeft class="size-5 text-gray-500" />
            </button>
            <div class="size-9 rounded-full flex items-center justify-center text-white font-black text-base shrink-0"
                 :style="{ background: 'var(--brand-primary)' }">
              {{ selectedUser?.name?.charAt(0)?.toUpperCase() }}
            </div>
            <div class="min-w-0">
              <p class="font-bold text-gray-800 text-sm truncate">{{ selectedUser?.name }}</p>
              <p class="text-[10px] text-gray-500">Inserisci PIN</p>
            </div>
          </div>

          <!-- PIN dots -->
          <div class="flex justify-center gap-3 py-4 md:py-5">
            <span
              v-for="n in PIN_LENGTH"
              :key="n"
              class="size-3 rounded-full transition-all duration-150"
              :class="pinDigits.length >= n ? 'bg-[var(--brand-primary)] scale-110' : 'bg-gray-200'"
            />
          </div>

          <!-- Error message -->
          <p v-if="pinError" class="text-red-500 text-xs text-center -mt-2 mb-2 font-semibold px-4">
            {{ pinError }}
          </p>

          <!-- Numeric keypad -->
          <div class="grid grid-cols-3 gap-1.5 px-3 md:px-4 pb-3 md:pb-4">
            <button
              v-for="key in KEYPAD"
              :key="key"
              @click="onKeyPress(key)"
              :disabled="key === '' "
              class="h-12 md:h-14 rounded-2xl font-bold text-lg transition-all active:scale-95 disabled:invisible"
              :class="key === '⌫'
                ? 'bg-red-50 text-red-500 hover:bg-red-100'
                : 'bg-gray-100 text-gray-800 hover:bg-gray-200'"
            >
              {{ key }}
            </button>
          </div>
        </template>
      </div>

      <!-- Version / hint -->
      <p class="text-white/40 text-[10px] mt-6 uppercase tracking-widest">
        {{ requiresAuth ? 'Accesso richiesto' : '' }}
      </p>
    </div>
  </Transition>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { Lock, ChevronRight, ChevronLeft } from 'lucide-vue-next';
import { useAuth } from '../composables/useAuth.js';
import { useAppStore } from '../store/index.js';
import { appConfig } from '../utils/index.js';

const store = useAppStore();
const { visibleUsers: users, currentUser, requiresAuth, isLocked, login } = useAuth();

/** Whether the overlay should be rendered. */
const visible = computed(() => requiresAuth.value && isLocked.value);

const PIN_LENGTH = 4;
const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

// ── Local state ─────────────────────────────────────────────────────────────

const selectedUserId = ref(/** @type {string|null} */ (null));
const pinDigits = ref(/** @type {string[]} */ ([]));
const pinError = ref('');

const selectedUser = computed(
  () => users.value.find((u) => u.id === selectedUserId.value) ?? null,
);

// Pre-select the user when the lock screen becomes visible
watch(
  visible,
  (v) => {
    if (v) {
      pinDigits.value = [];
      pinError.value = '';
      // If there's a remembered user or only one user, pre-select them
      if (currentUser.value) {
        selectedUserId.value = currentUser.value.id;
      } else if (users.value.length === 1) {
        selectedUserId.value = users.value[0].id;
      } else {
        selectedUserId.value = null;
      }
    }
  },
  { immediate: true },
);

// ── Clock ────────────────────────────────────────────────────────────────────

const currentTime = ref(formatTime());
const currentDate = ref(formatDate());
let clockTimer = null;

function formatTime() {
  return new Date().toLocaleTimeString(appConfig.locale, { hour: '2-digit', minute: '2-digit', timeZone: appConfig.timezone });
}

function formatDate() {
  return new Date().toLocaleDateString(appConfig.locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: appConfig.timezone,
  });
}

onMounted(() => {
  clockTimer = setInterval(() => {
    currentTime.value = formatTime();
    currentDate.value = formatDate();
  }, 1000);
});

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer);
});

// ── Interaction ───────────────────────────────────────────────────────────────

function selectUser(id) {
  selectedUserId.value = id;
  pinDigits.value = [];
  pinError.value = '';
}

function onKeyPress(key) {
  if (key === '⌫') {
    pinDigits.value = pinDigits.value.slice(0, -1);
    pinError.value = '';
    return;
  }
  if (pinDigits.value.length >= PIN_LENGTH) return;
  pinDigits.value = [...pinDigits.value, key];

  if (pinDigits.value.length === PIN_LENGTH) {
    attemptLogin();
  }
}

async function attemptLogin() {
  const pin = pinDigits.value.join('');
  const ok = await login(selectedUserId.value, pin);
  if (!ok) {
    pinError.value = 'PIN non corretto. Riprova.';
    // Clear digits after a short delay
    setTimeout(() => {
      pinDigits.value = [];
    }, 600);
  }
}
</script>

<style scoped>
.lock-fade-enter-active,
.lock-fade-leave-active {
  transition: opacity 0.25s ease;
}
.lock-fade-enter-from,
.lock-fade-leave-to {
  opacity: 0;
}
</style>
