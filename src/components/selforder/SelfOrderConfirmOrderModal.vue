<template>
  <Teleport to="body">
    <Transition name="fade">
      <div 
        v-if="modelValue"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <div 
          class="absolute inset-0 bg-black/50"
          @click="$emit('update:modelValue', false)"
        ></div>
        
        <div class="relative bg-white rounded-2xl p-6 w-full max-w-sm">
          <h2 class="text-xl font-bold text-gray-800 mb-4">Conferma l'ordine</h2>
          
          <div class="mb-4 max-h-60 overflow-y-auto">
            <div 
              v-for="item in items" 
              :key="item.id"
              class="flex justify-between py-2 border-b border-gray-100 last:border-0"
            >
              <span class="text-gray-800">
                {{ item.quantity }}x {{ item.name }}
              </span>
              <span class="text-gray-600">
                {{ formatPrice(itemPrice(item)) }}
              </span>
            </div>
          </div>
          
          <div class="flex justify-between items-center py-3 border-t border-gray-200 mb-4">
            <span class="font-bold text-gray-800">Totale</span>
            <span class="text-xl font-bold text-emerald-600">{{ formatPrice(totalPrice) }}</span>
          </div>
          
          <div class="flex gap-3">
            <button 
              class="flex-1 py-3 bg-gray-100 text-gray-700 rounded-xl font-medium"
              @click="$emit('update:modelValue', false)"
            >
              Annulla
            </button>
            <button 
              class="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-medium flex items-center justify-center gap-2"
              :disabled="submitting"
              @click="$emit('confirm')"
            >
              <Loader2 v-if="submitting" class="w-5 h-5 animate-spin" />
              <span>{{ submitting ? 'Invio...' : 'Conferma' }}</span>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref } from 'vue';
import { Loader2 } from 'lucide-vue-next';
import { useSelfOrderCart } from '../../composables/useSelfOrderCart.js';

defineProps({
  modelValue: { type: Boolean, required: true }
});

defineEmits(['confirm']);

const { items, totalPrice } = useSelfOrderCart();
const submitting = ref(false);

function itemPrice(item) {
  const basePrice = item.price * item.quantity;
  const modifiersPrice = item.modifiers?.reduce((sum, m) => sum + (m.price || 0) * item.quantity, 0) || 0;
  return basePrice + modifiersPrice;
}

function formatPrice(price) {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR'
  }).format(price);
}

defineExpose({ setSubmitting: (v) => { submitting.value = v; } });
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
