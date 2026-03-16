import { ref } from 'vue';

/**
 * Singleton state for the custom numeric keyboard overlay.
 * Module-level refs are shared across all component instances that import this composable.
 */
const isVisible = ref(false);
const displayValue = ref('');
const prefix = ref('');
/**
 * Optional type-toggle shown inside the keyboard display.
 * @type {import('vue').Ref<{ labels: string[], activeIndex: number } | null>}
 */
const typeToggle = ref(null);
/** @type {{ allowDecimal: boolean } | null} */
let _options = null;
/** @type {((value: string) => void) | null} */
let _callback = null;
/** @type {((index: number) => void) | null} */
let _typeToggleCallback = null;
/** When true, the next digit appended will overwrite the current display value. */
let _freshOpen = false;

/**
 * Composable for the custom numeric keyboard used in Cassa.
 * Provides a shared (singleton) keyboard state that can be opened by any
 * numeric input component and rendered by the single NumericKeyboard overlay.
 *
 * @returns {{ isVisible, displayValue, prefix, typeToggle, openKeyboard, closeKeyboard, confirm, appendDigit, backspace, clear, setTypeToggle }}
 */
export function useNumericKeyboard() {
  /**
   * Open the keyboard for a given input.
   * @param {string|number|null|undefined} currentValue  Current input value to pre-fill the display.
   * @param {(value: string) => void} callback           Called with the final string value on confirm.
   * @param {{ allowDecimal?: boolean, prefix?: string, typeToggle?: { labels: string[], activeIndex?: number, callback?: (index: number) => void } }} [options]
   */
  function openKeyboard(currentValue, callback, options = {}) {
    displayValue.value =
      currentValue !== null && currentValue !== undefined && currentValue !== ''
        ? String(currentValue)
        : '';
    _callback = callback;
    _options = { allowDecimal: options.allowDecimal ?? true };
    prefix.value = options.prefix ?? '';
    if (options.typeToggle && options.typeToggle.labels?.length >= 2) {
      typeToggle.value = {
        labels: options.typeToggle.labels,
        activeIndex: options.typeToggle.activeIndex ?? 0,
      };
      _typeToggleCallback = options.typeToggle.callback ?? null;
    } else {
      typeToggle.value = null;
      _typeToggleCallback = null;
    }
    _freshOpen = true;
    isVisible.value = true;
  }

  /** Close the keyboard without confirming. */
  function closeKeyboard() {
    isVisible.value = false;
    displayValue.value = '';
    prefix.value = '';
    typeToggle.value = null;
    _callback = null;
    _options = null;
    _typeToggleCallback = null;
    _freshOpen = false;
  }

  /** Confirm the current display value, invoke the callback, then close. */
  function confirm() {
    if (_callback) {
      _callback(displayValue.value);
    }
    closeKeyboard();
  }

  /**
   * Append a digit or decimal separator to the display value.
   * @param {string} digit  A single character: '0'–'9' or '.'
   */
  function appendDigit(digit) {
    // On first digit after opening, overwrite the pre-filled value
    if (_freshOpen) {
      _freshOpen = false;
      if (digit === '.') {
        if (_options?.allowDecimal === false) return;
        displayValue.value = '0.';
        return;
      }
      displayValue.value = digit;
      return;
    }
    if (digit === '.') {
      if (_options?.allowDecimal === false) return;
      if (displayValue.value.includes('.')) return;
      // Prepend a leading zero when the display is empty
      if (!displayValue.value) {
        displayValue.value = '0.';
        return;
      }
    }
    displayValue.value += digit;
  }

  /** Remove the last character from the display. */
  function backspace() {
    _freshOpen = false;
    if (displayValue.value.length > 0) {
      displayValue.value = displayValue.value.slice(0, -1);
    }
  }

  /** Clear the display entirely. */
  function clear() {
    _freshOpen = false;
    displayValue.value = '';
  }

  /**
   * Switch the active type-toggle option (e.g. % ↔ €).
   * Updates the activeIndex and invokes the registered callback.
   * @param {number} index  Index within typeToggle.value.labels to activate.
   */
  function setTypeToggle(index) {
    if (!typeToggle.value) return;
    typeToggle.value = { ...typeToggle.value, activeIndex: index };
    if (_typeToggleCallback) _typeToggleCallback(index);
  }

  return {
    isVisible,
    displayValue,
    prefix,
    typeToggle,
    openKeyboard,
    closeKeyboard,
    confirm,
    appendDigit,
    backspace,
    clear,
    setTypeToggle,
  };
}
