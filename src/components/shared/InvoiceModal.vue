<template>
  <!-- ================================================================ -->
  <!-- SHARED: DATI FATTURA MODAL                                        -->
  <!-- Displayed when requesting electronic invoice at bill close.       -->
  <!-- Used by CassaTableManager (live bill) and CassaBillCard (history) -->
  <!-- Props: show                                                        -->
  <!-- Emits: cancel, confirm(billingData)                               -->
  <!-- ================================================================ -->
  <Teleport to="body">
    <div v-if="show" class="fixed inset-0 z-[96] bg-black/70 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4">
      <div class="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden max-h-[95dvh] md:max-h-[90dvh]">
        <!-- Header -->
        <div class="bg-violet-700 text-white p-4 md:p-5 flex justify-between items-center shrink-0">
          <div class="flex items-center gap-3">
            <div class="size-10 rounded-full bg-white/10 flex items-center justify-center shrink-0">
              <FileText class="size-5" />
            </div>
            <div>
              <h3 class="font-bold text-base md:text-lg leading-tight">Dati Fattura</h3>
              <span class="text-[10px] text-white/70">Fatturazione elettronica</span>
            </div>
          </div>
          <button @click="$emit('cancel')" class="bg-white/10 hover:bg-white/20 p-2 rounded-full transition-colors active:scale-95">
            <X class="size-5" />
          </button>
        </div>
        <!-- Body -->
        <div class="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
          <!-- Denominazione / Ragione Sociale -->
          <div>
            <label class="block text-xs font-bold text-gray-700 mb-1">Denominazione / Ragione Sociale *</label>
            <input
              v-model="form.denominazione"
              type="text"
              placeholder="Es. Mario Rossi / Rossi S.r.l."
              class="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
          </div>
          <!-- Codice Fiscale / P.IVA -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-bold text-gray-700 mb-1">Codice Fiscale</label>
              <input
                v-model="form.codiceFiscale"
                type="text"
                placeholder="RSSMRA80A01H501Z"
                class="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
            </div>
            <div>
              <label class="block text-xs font-bold text-gray-700 mb-1">P.IVA</label>
              <input
                v-model="form.piva"
                type="text"
                placeholder="01234567890"
                class="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
            </div>
          </div>
          <!-- Indirizzo -->
          <div>
            <label class="block text-xs font-bold text-gray-700 mb-1">Indirizzo *</label>
            <input
              v-model="form.indirizzo"
              type="text"
              placeholder="Via Roma 1"
              class="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
          </div>
          <!-- CAP / Comune / Provincia -->
          <div class="grid grid-cols-3 gap-3">
            <div>
              <label class="block text-xs font-bold text-gray-700 mb-1">CAP *</label>
              <input
                v-model="form.cap"
                type="text"
                placeholder="00100"
                maxlength="5"
                class="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
            </div>
            <div>
              <label class="block text-xs font-bold text-gray-700 mb-1">Comune *</label>
              <input
                v-model="form.comune"
                type="text"
                placeholder="Roma"
                class="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
            </div>
            <div>
              <label class="block text-xs font-bold text-gray-700 mb-1">Prov.</label>
              <input
                v-model="form.provincia"
                type="text"
                placeholder="RM"
                maxlength="2"
                class="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
            </div>
          </div>
          <!-- Paese -->
          <div>
            <label class="block text-xs font-bold text-gray-700 mb-1">Paese *</label>
            <input
              v-model="form.paese"
              type="text"
              placeholder="IT"
              maxlength="2"
              class="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
          </div>
          <!-- Codice Destinatario / PEC -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-bold text-gray-700 mb-1">Codice SDI</label>
              <input
                v-model="form.codiceDestinatario"
                type="text"
                placeholder="0000000"
                maxlength="7"
                class="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
            </div>
            <div>
              <label class="block text-xs font-bold text-gray-700 mb-1">PEC</label>
              <input
                v-model="form.pec"
                type="email"
                placeholder="fatture@pec.it"
                class="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
            </div>
          </div>
          <!-- Validation error -->
          <p v-if="errorMessage" class="text-xs text-red-600 font-bold">{{ errorMessage }}</p>
        </div>
        <!-- Footer -->
        <div class="p-4 border-t border-gray-200 bg-gray-50 rounded-b-3xl flex gap-3">
          <button @click="$emit('cancel')" class="flex-1 py-3 border border-gray-300 text-gray-700 font-bold rounded-xl active:scale-95 transition-all text-sm">
            Annulla
          </button>
          <button @click="handleConfirm" class="flex-1 py-3 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl active:scale-95 transition-all shadow-md flex items-center justify-center gap-2 text-sm">
            <Building2 class="size-4" /> Conferma Fattura
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, watch } from 'vue';
import { FileText, Building2, X } from 'lucide-vue-next';

const props = defineProps({
  show: {
    type: Boolean,
    required: true,
  },
});

const emit = defineEmits(['cancel', 'confirm']);

const _emptyForm = () => ({
  denominazione: '',
  codiceFiscale: '',
  piva: '',
  indirizzo: '',
  cap: '',
  comune: '',
  provincia: '',
  paese: 'IT',
  codiceDestinatario: '',
  pec: '',
});

const form = ref(_emptyForm());
const errorMessage = ref('');

// Reset form each time the modal is opened
watch(() => props.show, (val) => {
  if (val) {
    form.value = _emptyForm();
    errorMessage.value = '';
  }
});

function handleConfirm() {
  const f = form.value;
  const trim = v => (v ?? '').trim();
  errorMessage.value = '';

  if (!trim(f.denominazione)) {
    errorMessage.value = 'Denominazione obbligatoria.';
    return;
  }
  if (!trim(f.codiceFiscale) && !trim(f.piva)) {
    errorMessage.value = 'Inserire almeno Codice Fiscale o P.IVA.';
    return;
  }
  if (!trim(f.indirizzo) || !trim(f.cap) || !trim(f.comune)) {
    errorMessage.value = 'Indirizzo, CAP e Comune sono obbligatori.';
    return;
  }
  if (!/^\d{5}$/.test(trim(f.cap))) {
    errorMessage.value = 'Il CAP deve essere di 5 cifre.';
    return;
  }
  if (!trim(f.paese)) {
    errorMessage.value = 'Il campo Paese è obbligatorio.';
    return;
  }
  // provincia is intentionally optional (not required for foreign addresses or
  // when the country is not IT; left blank by the user if not applicable)
  const sdi = trim(f.codiceDestinatario);
  const pec = trim(f.pec);
  if (!sdi && !pec) {
    errorMessage.value = 'Inserire Codice SDI o PEC per la trasmissione della fattura.';
    return;
  }
  if (sdi && !/^[A-Z0-9]{7}$/i.test(sdi)) {
    errorMessage.value = 'Il Codice SDI deve essere di 7 caratteri alfanumerici.';
    return;
  }
  if (pec && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pec)) {
    errorMessage.value = 'Indirizzo PEC non valido.';
    return;
  }

  emit('confirm', {
    ...f,
    denominazione: trim(f.denominazione),
    codiceFiscale: trim(f.codiceFiscale),
    piva: trim(f.piva),
    indirizzo: trim(f.indirizzo),
    cap: trim(f.cap),
    comune: trim(f.comune),
    paese: trim(f.paese).toUpperCase(),
    provincia: trim(f.provincia).toUpperCase(),
    codiceDestinatario: sdi.toUpperCase(),
    pec,
  });
}
</script>
