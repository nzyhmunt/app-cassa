<template>
  <SharedSettingsModal
    v-bind="$props"
    v-on="$attrs"
    title="Impostazioni Cassa"
    @update:modelValue="value => emit('update:modelValue', value)"
    @settings-changed="payload => emit('settings-changed', payload)"
  />
</template>

<script setup>
import SharedSettingsModal from './shared/SettingsModal.vue';

defineProps({ modelValue: Boolean });
const emit = defineEmits(['update:modelValue', 'settings-changed']);
</script>
