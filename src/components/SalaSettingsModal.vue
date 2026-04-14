<template>
  <SharedSettingsModal
    v-bind="$props"
    title="Impostazioni Sala"
    :showMenuSync="isAdmin"
    :showDirectusSync="isAdmin"
    @update:modelValue="value => emit('update:modelValue', value)"
    @settings-changed="payload => emit('settings-changed', payload)"
  />
</template>

<script setup>
import SharedSettingsModal from './shared/SettingsModal.vue';
import { useAuth } from '../composables/useAuth.js';

defineProps({ modelValue: Boolean });
const emit = defineEmits(['update:modelValue', 'settings-changed']);

const { isAdmin } = useAuth();
</script>
