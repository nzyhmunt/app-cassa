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
        
        <div class="relative bg-white rounded-2xl p-6 w-full max-w-sm text-center">
          <div class="w-16 h-16 mx-auto mb-4 bg-red-100 rounded-full flex items-center justify-center">
            <AlertTriangle class="w-8 h-8 text-red-600" />
          </div>
          
          <h2 class="text-xl font-bold text-gray-800 mb-2">Terminare la sessione?</h2>
          <p class="text-gray-600 mb-6">
            Una volta chiusa, non potrai più ordinare da questo dispositivo. 
            I tuoi ordini già inviati saranno comunque elaborati.
          </p>
          
          <div class="flex gap-3">
            <button 
              class="flex-1 py-3 bg-gray-100 text-gray-700 rounded-xl font-medium"
              @click="$emit('update:modelValue', false)"
            >
              Annulla
            </button>
            <button 
              class="flex-1 py-3 bg-red-600 text-white rounded-xl font-medium"
              @click="handleEndSession"
            >
              Termina
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { inject } from 'vue';
import { AlertTriangle } from 'lucide-vue-next';

defineProps({
  modelValue: { type: Boolean, required: true }
});

const emit = defineEmits(['update:modelValue']);
const { endSession } = inject('selfOrderSession');

async function handleEndSession() {
  await endSession();
  emit('update:modelValue', false);
  window.location.hash = '/';
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
