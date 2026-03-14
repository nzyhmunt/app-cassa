import { ref } from 'vue';

/**
 * Singleton state for the custom numeric keyboard overlay.
 * Module-level refs are shared across all component instances that import this composable.
 */
const isVisible = ref(false);
const displayValue = ref('');
/** @type {{ allowDecimal: boolean } | null} */
let _options = null;
/** @type {((value: string) => void) | null} */
let _callback = null;

/**
 * Composable for the custom numeric keyboard used in Cassa.
 * Provides a shared (singleton) keyboard state that can be opened by any
 * numeric input component and rendered by the single NumericKeyboard overlay.
 *
 * @returns {{ isVisible, displayValue, openKeyboard, closeKeyboard, confirm, appendDigit, backspace, clear }}
 */
export function useNumericKeyboard() {
  /**
   * Open the keyboard for a given input.
   * @param {string|number|null|undefined} currentValue  Current input value to pre-fill the display.
   * @param {(value: string) => void} callback           Called with the final string value on confirm.
   * @param {{ allowDecimal?: boolean }} [options]
   */
  function openKeyboard(currentValue, callback, options = {}) {
    displayValue.value =
      currentValue !== null && currentValue !== undefined && currentValue !== ''
        ? String(currentValue)
        : '';
    _callback = callback;
    _options = { allowDecimal: options.allowDecimal !== false };
    isVisible.value = true;
  }

  /** Close the keyboard without confirming. */
  function closeKeyboard() {
    isVisible.value = false;
    displayValue.value = '';
    _callback = null;
    _options = null;
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
    if (displayValue.value.length > 0) {
      displayValue.value = displayValue.value.slice(0, -1);
    }
  }

  /** Clear the display entirely. */
  function clear() {
    displayValue.value = '';
  }

  return {
    isVisible,
    displayValue,
    openKeyboard,
    closeKeyboard,
    confirm,
    appendDigit,
    backspace,
    clear,
  };
}
