<template>
  <!-- Native decimal input: rendered when the custom keyboard is disabled -->
  <input
    v-if="!isKeyboardEnabled"
    type="text"
    inputmode="decimal"
    autocomplete="off"
    v-bind="$attrs"
    :value="modelValue"
    @input="onNativeInput"
  />
  <!-- Custom keyboard input: readonly text field that opens the keyboard overlay -->
  <input
    v-else
    type="text"
    inputmode="none"
    v-bind="$attrs"
    :value="displayVal"
    readonly
    @click="onActivate"
    @focus="onActivate"
  />
</template>

<script setup>
import { computed } from 'vue';
import { useConfigStore, useOrderStore } from '../store/index.js';
import { useNumericKeyboard } from '../composables/useNumericKeyboard.js';

defineOptions({ inheritAttrs: false });

const props = defineProps({
  modelValue: { type: [Number, String], default: '' },
  prefix: { type: String, default: '' },
  /** Labels for an optional toggle shown inside the keyboard (e.g. ['%', '€']). */
  typeToggleLabels: { type: Array, default: () => [] },
  /** Index of the currently active toggle option. */
  typeToggleIndex: { type: Number, default: 0 },
});

const emit = defineEmits(['update:modelValue', 'update:typeToggleIndex']);

const configStore = useConfigStore();
const orderStore = useOrderStore();
const keyboard = useNumericKeyboard();

const isKeyboardEnabled = computed(() => configStore.customKeyboard !== 'disabled');

/** Value shown in the read-only text input (custom keyboard mode). */
const displayVal = computed(() => {
  if (props.modelValue === '' || props.modelValue === null || props.modelValue === undefined) return '';
  return String(props.modelValue);
});

/** Emit the native input value as a normalized string, or empty string. */
function onNativeInput(event) {
  const raw = event.target.value;
  if (raw === '') {
    emit('update:modelValue', '');
    return;
  }
  // Normalize: Italian locale uses comma as decimal separator — replace all commas with period.
  const normalized = raw.replace(/,/g, '.');
  // Accept only valid partial numeric strings (digits with at most one decimal point).
  if (/^\d*\.?\d*$/.test(normalized)) {
    if (normalized !== raw) event.target.value = normalized;
    emit('update:modelValue', normalized);
  } else {
    // Revert to the last known good value if the input contains invalid characters.
    event.target.value = props.modelValue !== '' && props.modelValue != null
      ? String(props.modelValue)
      : '';
  }
}

/** Open the numeric keyboard overlay when the field is activated. */
function onActivate(event) {
  // Prevent the native virtual keyboard from appearing
  event.target.blur();

  const toggleOptions = props.typeToggleLabels.length >= 2
    ? {
        labels: props.typeToggleLabels,
        activeIndex: props.typeToggleIndex,
        callback: (i) => emit('update:typeToggleIndex', i),
      }
    : undefined;

  keyboard.openKeyboard(
    props.modelValue,
    (newValue) => emit('update:modelValue', newValue),
    { allowDecimal: true, prefix: props.prefix, typeToggle: toggleOptions },
  );
}
</script>
