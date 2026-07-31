<template>
  <Teleport to="body">
    <Transition name="slide-up">
      <div 
        v-if="modelValue"
        class="fixed inset-0 z-50 flex flex-col justify-end"
      >
        <div 
          class="absolute inset-0 bg-black/50"
          @click="$emit('update:modelValue', false)"
        ></div>
        
        <div class="relative bg-white rounded-t-3xl max-h-[80vh] flex flex-col">
          <!-- Handle -->
          <div class="flex justify-center py-3">
            <div class="w-12 h-1 bg-gray-300 rounded-full"></div>
          </div>
          
          <!-- Header -->
          <div class="px-4 pb-3 border-b border-gray-100">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-bold text-gray-800">Il tuo carrello</h2>
              <button 
                class="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center"
                @click="$emit('update:modelValue', false)"
              >
                <X class="w-5 h-5 text-gray-600" />
              </button>
            </div>
          </div>
          
          <!-- Items list -->
          <div class="flex-1 overflow-y-auto p-4">
            <div v-if="items.length === 0" class="text-center py-8">
              <ShoppingCart class="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p class="text-gray-500">Il carrello è vuoto</p>
            </div>
            
            <div v-else class="space-y-4">
              <div
                v-for="item in items"
                :key="item.id"
                class="flex gap-3"
              >
                <div class="flex-1">
                  <h3 class="font-medium text-gray-800">{{ item.name }}</h3>
                  <p v-if="item.modifiers?.length" class="text-xs text-gray-500 mt-1">
                    {{ formatModifiers(item.modifiers) }}
                  </p>
                  <p class="text-emerald-600 font-medium mt-1">
                    {{ formatPrice(itemPrice(item)) }}
                  </p>
                </div>
                
                <div class="flex items-center gap-2">
                  <button 
                    class="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center"
                    @click="removeItem(item.id)"
                  >
                    <Minus class="w-4 h-4 text-gray-600" />
                  </button>
                  <span class="w-6 text-center font-medium">{{ item.quantity }}</span>
                  <button 
                    class="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center"
                    @click="updateQuantity(item.id, item.quantity + 1)"
                  >
                    <Plus class="w-4 h-4 text-emerald-600" />
                  </button>
                </div>
              </div>
            </div>
          </div>
          
          <!-- Footer with total and checkout -->
          <div v-if="items.length > 0" class="p-4 border-t border-gray-100 bg-gray-50">
            <div class="flex justify-between items-center mb-4">
              <span class="font-medium text-gray-600">Totale</span>
              <span class="text-xl font-bold text-emerald-600">{{ formatPrice(totalPrice) }}</span>
            </div>
            
            <button 
              class="w-full py-4 bg-emerald-600 text-white rounded-xl font-bold"
              @click="confirmOrder"
            >
              Invia Ordine
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed, inject } from 'vue';
import { X, ShoppingCart, Minus, Plus } from 'lucide-vue-next';
import { useSelfOrderCart } from '../../composables/useSelfOrderCart.js';

defineProps({
  modelValue: { type: Boolean, required: true }
});

const emit = defineEmits(['update:modelValue']);

const { items, totalPrice, removeItem, updateQuantity } = useSelfOrderCart();
const submitOrder = inject('submitOrder');

function itemPrice(item) {
  const basePrice = item.price * item.quantity;
  const modifiersPrice = item.modifiers?.reduce((sum, m) => sum + (m.price || 0) * item.quantity, 0) || 0;
  return basePrice + modifiersPrice;
}

function formatModifiers(modifiers) {
  return modifiers.map(m => m.name).join(', ');
}

function formatPrice(price) {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR'
  }).format(price);
}

function confirmOrder() {
  emit('update:modelValue', false);
  submitOrder?.();
}
</script>

<style scoped>
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateY(100%);
}
</style>
