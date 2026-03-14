<template>
  <!-- MODAL: GESTIONE UTENTI -->
  <div v-if="modelValue" class="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4">
    <div class="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
      <!-- Header -->
      <div class="bg-gray-50 border-b border-gray-200 p-4 md:p-5 flex justify-between items-center shrink-0">
        <h3 class="font-bold text-base md:text-lg flex items-center gap-2 text-gray-800">
          <Users class="text-gray-500 size-4 md:size-5" /> Gestione Utenti
        </h3>
        <button @click="$emit('update:modelValue', false)" class="text-gray-400 hover:text-gray-800 bg-gray-200 hover:bg-gray-300 rounded-full p-1.5 transition-colors active:scale-95">
          <X class="size-5" />
        </button>
      </div>

      <!-- Scrollable content -->
      <div class="overflow-y-auto flex-1 p-4 md:p-6 space-y-4">

        <!-- ── Auto-lock timeout ─────────────────────────────────────────── -->
        <div class="bg-gray-50 rounded-2xl border border-gray-200 p-3 md:p-4">
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

        <!-- ── User list ─────────────────────────────────────────────────── -->
        <div>
          <p class="font-bold text-gray-700 text-xs uppercase tracking-wider mb-2">Utenti configurati</p>

          <div v-if="users.length === 0" class="text-center py-6 text-gray-400 text-sm">
            <ShieldOff class="size-8 mx-auto mb-2 text-gray-300" />
            Nessun utente. L'autenticazione è disabilitata.
          </div>

          <div v-else class="space-y-2">
            <div
              v-for="user in users"
              :key="user.id"
              class="flex items-center gap-3 p-3 rounded-2xl border border-gray-200 bg-white"
            >
              <!-- Avatar -->
              <div class="size-9 rounded-full flex items-center justify-center text-white font-black text-base shrink-0"
                   :style="{ background: 'var(--brand-primary)' }">
                {{ user.name.charAt(0).toUpperCase() }}
              </div>

              <!-- Name / edit inline -->
              <div class="flex-1 min-w-0">
                <template v-if="editingId !== user.id">
                  <p class="font-bold text-gray-800 text-sm truncate">{{ user.name }}</p>
                  <p class="text-[10px] text-gray-400">PIN: ••••</p>
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
                    placeholder="Nuovo PIN (4 cifre)"
                    class="w-full border border-gray-300 rounded-lg px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                  />
                  <p v-if="editError" class="text-red-500 text-[10px] mt-1">{{ editError }}</p>
                </template>
              </div>

              <!-- Actions -->
              <div class="flex gap-1 shrink-0">
                <template v-if="editingId !== user.id">
                  <button
                    @click="startEdit(user)"
                    class="p-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors active:scale-95"
                    title="Modifica"
                  >
                    <Pencil class="size-3.5" />
                  </button>
                  <button
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
          </div>
        </div>

        <!-- ── Add user form ──────────────────────────────────────────────── -->
        <div class="bg-gray-50 rounded-2xl border border-gray-200 p-3 md:p-4">
          <p class="font-bold text-gray-700 text-xs uppercase tracking-wider mb-3">Aggiungi utente</p>
          <div class="space-y-2">
            <input
              v-model="newName"
              type="text"
              maxlength="30"
              placeholder="Nome utente"
              class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
            />
            <input
              v-model="newPin"
              type="password"
              maxlength="8"
              inputmode="numeric"
              placeholder="PIN (4 cifre numeriche)"
              class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
            />
            <p v-if="addError" class="text-red-500 text-xs">{{ addError }}</p>
            <button
              @click="onAddUser"
              class="w-full py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-95 bg-[var(--brand-primary)] text-white hover:opacity-90 shadow-sm"
            >
              <UserPlus class="size-4" />
              Aggiungi utente
            </button>
          </div>
        </div>

        <!-- ── Remove confirm ─────────────────────────────────────────────── -->
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

      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { Users, X, Pencil, Trash2, Check, UserPlus, ShieldOff } from 'lucide-vue-next';
import { useAuth } from '../composables/useAuth.js';

defineProps({ modelValue: Boolean });
const emit = defineEmits(['update:modelValue']);

const { users, lockTimeoutMinutes, addUser, updateUser, removeUser, setLockTimeout, LOCK_TIMEOUT_OPTIONS } = useAuth();

// ── Add user ──────────────────────────────────────────────────────────────────
const newName = ref('');
const newPin = ref('');
const addError = ref('');

async function onAddUser() {
  addError.value = '';
  const name = newName.value.trim();
  if (!name) { addError.value = 'Inserisci un nome utente.'; return; }
  const pin = newPin.value.trim();
  if (!/^\d{4}$/.test(pin)) { addError.value = 'Il PIN deve essere esattamente di 4 cifre numeriche.'; return; }
  await addUser(name, pin);
  newName.value = '';
  newPin.value = '';
}

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
      editError.value = 'Il PIN deve essere esattamente di 4 cifre numeriche.';
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
</script>
