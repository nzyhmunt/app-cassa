<template>
  <!-- MODAL: GESTIONE UTENTI -->
  <div v-if="modelValue" class="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4">
    <div class="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[92vh]">

      <!-- Header -->
      <div class="bg-gray-50 border-b border-gray-200 p-4 md:p-5 flex justify-between items-center shrink-0">
        <h3 class="font-bold text-base md:text-lg flex items-center gap-2 text-gray-800">
          <Users class="text-gray-500 size-4 md:size-5" /> Gestione Utenti
        </h3>
        <button @click="$emit('update:modelValue', false)"
          class="text-gray-400 hover:text-gray-800 bg-gray-200 hover:bg-gray-300 rounded-full p-1.5 transition-colors active:scale-95">
          <X class="size-5" />
        </button>
      </div>

      <!-- Scrollable body -->
      <div class="overflow-y-auto flex-1 p-4 md:p-6 space-y-4">

        <!-- ── No users at all: add first (admin) user ──────────────────── -->
        <template v-if="allUsers.length === 0">
          <div class="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-sm text-blue-800 flex items-start gap-3">
            <ShieldCheck class="size-5 shrink-0 text-blue-500 mt-0.5" />
            <div>
              <p class="font-bold mb-1">Nessun utente configurato</p>
              <p class="text-[11px] leading-relaxed">L'accesso è libero. Il primo utente che aggiungi diventerà <strong>amministratore</strong> e potrà gestire gli altri utenti e le impostazioni di blocco.</p>
            </div>
          </div>
          <AddUserForm :is-first="true" @added="onAdded" />
        </template>

        <!-- ── Users exist ────────────────────────────────────────────── -->
        <template v-else>

          <!-- ── Non-admin notice ────────────────────────────────────── -->
          <div v-if="!isAdmin && hasAdmin" class="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800 flex items-start gap-3">
            <ShieldOff class="size-5 shrink-0 text-amber-500 mt-0.5" />
            <div>
              <p class="font-bold mb-1">Accesso limitato</p>
              <p class="text-[11px] leading-relaxed">Solo l'amministratore può modificare utenti, PIN e impostazioni di blocco.</p>
            </div>
          </div>

          <!-- ── Auto-lock (admin only) ─────────────────────────────── -->
          <div v-if="isAdmin" class="bg-gray-50 rounded-2xl border border-gray-200 p-3 md:p-4">
            <p class="font-bold text-gray-800 text-sm mb-1">Blocco automatico</p>
            <p class="text-[10px] text-gray-500 mb-3">Blocca lo schermo dopo un periodo di inattività.</p>
            <div class="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
              <button
                v-for="opt in LOCK_TIMEOUT_OPTIONS"
                :key="opt.value"
                @click="setLockTimeout(opt.value)"
                class="py-2 rounded-xl text-xs font-bold border transition-all active:scale-95"
                :class="lockTimeoutMinutes === opt.value
                  ? 'bg-[var(--brand-primary)] text-white border-[var(--brand-primary)]'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-[var(--brand-primary)]/50 hover:bg-[var(--brand-primary)]/5'"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <!-- ── User list ──────────────────────────────────────────── -->
          <div>
            <p class="font-bold text-gray-700 text-xs uppercase tracking-wider mb-2">
              Utenti configurati
            </p>

            <div class="space-y-2">
              <div
                v-for="user in allUsers"
                :key="user.id"
                class="rounded-2xl border border-gray-200 bg-white overflow-hidden"
              >
                <!-- User row -->
                <div class="flex items-center gap-3 p-3">
                  <!-- Avatar -->
                  <div class="size-9 rounded-full flex items-center justify-center text-white font-black text-base shrink-0"
                       :style="{ background: 'var(--brand-primary)' }">
                    {{ user.name.charAt(0).toUpperCase() }}
                  </div>

                  <!-- Name / edit -->
                  <div class="flex-1 min-w-0">
                    <template v-if="editingId !== user.id">
                      <p class="font-bold text-gray-800 text-sm truncate flex items-center gap-1.5">
                        {{ user.name }}
                        <span v-if="user.isAdmin"
                          class="inline-flex items-center gap-0.5 bg-[var(--brand-primary)]/10 text-[var(--brand-primary)] text-[9px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-full">
                          <ShieldCheck class="size-2.5" /> Admin
                        </span>
                        <span v-if="user.fromConfig"
                          class="inline-flex items-center gap-0.5 bg-gray-100 text-gray-500 text-[9px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-full">
                          <Lock class="size-2.5" /> Config
                        </span>
                      </p>
                      <p class="text-[10px] text-gray-400 mt-0.5">
                        PIN: ••••
                        <span v-if="user.apps && user.apps.length < ALL_APPS.length" class="ml-2 text-gray-400">
                          · {{ user.apps.join(', ') }}
                        </span>
                      </p>
                    </template>
                    <template v-else>
                      <input
                        v-model="editName"
                        type="text"
                        maxlength="30"
                        placeholder="Nome"
                        class="w-full border border-gray-300 rounded-lg px-2 py-1 text-sm font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] mb-1"
                      />
                      <input
                        v-model="editPin"
                        type="password"
                        maxlength="8"
                        inputmode="numeric"
                        placeholder="Nuovo PIN (4 cifre, lascia vuoto per non cambiare)"
                        class="w-full border border-gray-300 rounded-lg px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                      />
                      <p v-if="editError" class="text-red-500 text-[10px] mt-1">{{ editError }}</p>
                    </template>
                  </div>

                  <!-- Action buttons (admin only, not for config users) -->
                  <div v-if="isAdmin && !user.fromConfig" class="flex gap-1 shrink-0">
                    <template v-if="editingId !== user.id">
                      <button
                        @click="startEdit(user)"
                        class="p-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors active:scale-95"
                        title="Modifica"
                      >
                        <Pencil class="size-3.5" />
                      </button>
                      <button
                        v-if="!user.isAdmin"
                        @click="askRemove(user.id)"
                        class="p-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-500 transition-colors active:scale-95"
                        title="Elimina"
                      >
                        <Trash2 class="size-3.5" />
                      </button>
                    </template>
                    <template v-else>
                      <button
                        @click="confirmEdit(user.id)"
                        class="p-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-600 transition-colors active:scale-95"
                        title="Salva"
                      >
                        <Check class="size-3.5" />
                      </button>
                      <button
                        @click="cancelEdit"
                        class="p-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-500 transition-colors active:scale-95"
                        title="Annulla"
                      >
                        <X class="size-3.5" />
                      </button>
                    </template>
                  </div>
                </div>

                <!-- App access toggles (admin only, not for config users, not for admin user themselves) -->
                <div
                  v-if="isAdmin && !user.fromConfig && !user.isAdmin && editingId !== user.id"
                  class="border-t border-gray-100 px-3 py-2 flex items-center gap-2 bg-gray-50"
                >
                  <span class="text-[10px] text-gray-500 font-bold uppercase tracking-wide mr-1">App:</span>
                  <button
                    v-for="app in ALL_APPS"
                    :key="app"
                    @click="toggleApp(user.id, app)"
                    class="text-[10px] font-bold px-2 py-0.5 rounded-full border transition-all active:scale-95"
                    :class="user.apps.includes(app)
                      ? 'bg-[var(--brand-primary)] text-white border-[var(--brand-primary)]'
                      : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'"
                  >
                    {{ app }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- ── Add user form (admin only) ─────────────────────────── -->
          <div v-if="isAdmin">
            <p class="font-bold text-gray-700 text-xs uppercase tracking-wider mb-2">Aggiungi utente</p>
            <AddUserForm :is-first="false" @added="onAdded" />
          </div>

          <!-- ── Remove confirm ──────────────────────────────────────── -->
          <div v-if="removeConfirmId" class="bg-red-50 border border-red-200 rounded-2xl p-3 md:p-4">
            <p class="text-sm text-red-700 font-semibold text-center mb-3">
              Eliminare questo utente? L'operazione non è reversibile.
            </p>
            <div class="flex gap-2">
              <button @click="removeConfirmId = null"
                class="flex-1 py-3 bg-white hover:bg-gray-100 text-gray-700 font-bold rounded-2xl border border-gray-200 transition-colors active:scale-95 text-sm">
                Annulla
              </button>
              <button @click="confirmRemove"
                class="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-2xl border border-red-600 transition-colors active:scale-95 text-sm">
                Sì, elimina
              </button>
            </div>
          </div>

        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, defineComponent } from 'vue';
import { Users, X, Pencil, Trash2, Check, Lock, ShieldCheck, ShieldOff } from 'lucide-vue-next';
import { useAuth } from '../composables/useAuth.js';

defineProps({ modelValue: Boolean });
defineEmits(['update:modelValue']);

const {
  users: allUsers,
  isAdmin,
  hasAdmin,
  lockTimeoutMinutes,
  addUser,
  updateUser,
  removeUser,
  setLockTimeout,
  LOCK_TIMEOUT_OPTIONS,
  ALL_APPS,
} = useAuth();

// ── Inline form component ─────────────────────────────────────────────────────
// Extracted to avoid duplicate template logic for "add first user" vs "add user".
const AddUserForm = defineComponent({
  name: 'AddUserForm',
  props: { isFirst: Boolean },
  emits: ['added'],
  setup(props, { emit }) {
    const name = ref('');
    const pin = ref('');
    const error = ref('');
    const apps = ref([...ALL_APPS]);

    async function submit() {
      error.value = '';
      const n = name.value.trim();
      if (!n) { error.value = 'Inserisci un nome utente.'; return; }
      const p = pin.value.trim();
      if (!/^\d{4}$/.test(p)) { error.value = 'Il PIN deve essere esattamente 4 cifre numeriche.'; return; }
      await addUser(n, p, props.isFirst ? [...ALL_APPS] : apps.value);
      name.value = '';
      pin.value = '';
      apps.value = [...ALL_APPS];
      emit('added');
    }

    function toggleApp(app) {
      if (apps.value.includes(app)) {
        if (apps.value.length === 1) return; // keep at least one
        apps.value = apps.value.filter(a => a !== app);
      } else {
        apps.value = [...apps.value, app];
      }
    }

    return { name, pin, error, apps, submit, toggleApp, ALL_APPS };
  },
  template: `
    <div class="bg-gray-50 rounded-2xl border border-gray-200 p-3 md:p-4 space-y-2">
      <input v-model="name" type="text" maxlength="30" placeholder="Nome utente"
        class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]" />
      <input v-model="pin" type="password" maxlength="8" inputmode="numeric" placeholder="PIN (4 cifre numeriche)"
        class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]" />
      <div v-if="!isFirst" class="flex items-center gap-2">
        <span class="text-[10px] text-gray-500 font-bold uppercase tracking-wide">App:</span>
        <button v-for="app in ALL_APPS" :key="app" @click="toggleApp(app)"
          class="text-[10px] font-bold px-2 py-0.5 rounded-full border transition-all active:scale-95"
          :class="apps.includes(app) ? 'bg-[var(--brand-primary)] text-white border-[var(--brand-primary)]' : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'">
          {{ app }}
        </button>
      </div>
      <p v-if="error" class="text-red-500 text-xs">{{ error }}</p>
      <button @click="submit"
        class="w-full py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-95 bg-[var(--brand-primary)] text-white hover:opacity-90 shadow-sm">
        <svg v-if="isFirst" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
        {{ isFirst ? 'Crea account amministratore' : 'Aggiungi utente' }}
      </button>
    </div>
  `,
});

// ── Edit user ─────────────────────────────────────────────────────────────────
const editingId = ref(null);
const editName = ref('');
const editPin = ref('');
const editError = ref('');

function startEdit(user) {
  editingId.value = user.id;
  editName.value = user.name;
  editPin.value = '';
  editError.value = '';
}

async function confirmEdit(id) {
  editError.value = '';
  const name = editName.value.trim();
  if (!name) { editError.value = 'Il nome non può essere vuoto.'; return; }
  const updates = { name };
  if (editPin.value.trim()) {
    if (!/^\d{4}$/.test(editPin.value.trim())) {
      editError.value = 'Il PIN deve essere esattamente 4 cifre numeriche.';
      return;
    }
    updates.pin = editPin.value.trim();
  }
  await updateUser(id, updates);
  editingId.value = null;
}

function cancelEdit() {
  editingId.value = null;
  editError.value = '';
}

// ── App access toggle ─────────────────────────────────────────────────────────
async function toggleApp(userId, app) {
  const user = allUsers.value.find(u => u.id === userId);
  if (!user) return;
  let newApps;
  if (user.apps.includes(app)) {
    if (user.apps.length === 1) return; // keep at least one app
    newApps = user.apps.filter(a => a !== app);
  } else {
    newApps = [...user.apps, app];
  }
  await updateUser(userId, { apps: newApps });
}

// ── Remove user ───────────────────────────────────────────────────────────────
const removeConfirmId = ref(null);

function askRemove(id) {
  removeConfirmId.value = id;
}

function confirmRemove() {
  if (removeConfirmId.value) {
    removeUser(removeConfirmId.value);
    removeConfirmId.value = null;
  }
}

// ── After adding ──────────────────────────────────────────────────────────────
function onAdded() {
  // nothing extra needed; reactivity updates the list automatically
}
</script>
