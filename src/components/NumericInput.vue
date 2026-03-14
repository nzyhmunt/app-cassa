<template>
  <!-- Native numeric input: rendered when the custom keyboard is disabled -->
  <input
    v-if="!isKeyboardEnabled"
    type="number"
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
import { useAppStore } from '../store/index.js';
import { useNumericKeyboard } from '../composables/useNumericKeyboard.js';

defineOptions({ inheritAttrs: false });

const props = defineProps({
  modelValue: { type: [Number, String], default: '' },
});

const emit = defineEmits(['update:modelValue']);

const store = useAppStore();
const keyboard = useNumericKeyboard();

const isKeyboardEnabled = computed(() => store.customKeyboard);

/** Value shown in the read-only text input (custom keyboard mode). */
const displayVal = computed(() => {
  if (props.modelValue === '' || props.modelValue === null || props.modelValue === undefined) return '';
  return String(props.modelValue);
});

/** Emit the native input value (numeric or empty string). */
function onNativeInput(event) {
  const raw = event.target.value;
  emit('update:modelValue', raw === '' ? '' : Number(raw));
}

/** Open the numeric keyboard overlay when the field is activated. */
function onActivate(event) {
  // Prevent the native virtual keyboard from appearing
  event.target.blur();

  keyboard.openKeyboard(
    props.modelValue,
    (newValue) => emit('update:modelValue', newValue),
    { allowDecimal: true },
  );
}
</script>
