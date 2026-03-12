<template>
  <SharedSettingsModal v-bind="$props" v-on="$attrs" title="Impostazioni Cassa" />
</template>

<script setup>
import SharedSettingsModal from './shared/SettingsModal.vue';

defineProps({ modelValue: Boolean });
defineEmits(['update:modelValue', 'settings-changed']);
</script>
