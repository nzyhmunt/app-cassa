import { describe, it, expect, beforeEach } from 'vitest';
import { useNumericKeyboard } from '../useNumericKeyboard.js';

/**
 * Reset the module-level singleton state between tests by calling closeKeyboard().
 */
function resetKeyboard() {
  const kb = useNumericKeyboard();
  kb.closeKeyboard();
}

describe('useNumericKeyboard()', () => {
  beforeEach(() => {
    resetKeyboard();
  });

  // ── initial state ──────────────────────────────────────────────────────────

  it('starts hidden with an empty display value', () => {
    const kb = useNumericKeyboard();
    expect(kb.isVisible.value).toBe(false);
    expect(kb.displayValue.value).toBe('');
  });

  // ── openKeyboard() ─────────────────────────────────────────────────────────

  it('openKeyboard() makes the keyboard visible', () => {
    const kb = useNumericKeyboard();
    kb.openKeyboard(null, () => {});
    expect(kb.isVisible.value).toBe(true);
  });

  it('openKeyboard() pre-fills the display with the provided value', () => {
    const kb = useNumericKeyboard();
    kb.openKeyboard(12.5, () => {});
    expect(kb.displayValue.value).toBe('12.5');
  });

  it('openKeyboard() leaves display empty when value is null', () => {
    const kb = useNumericKeyboard();
    kb.openKeyboard(null, () => {});
    expect(kb.displayValue.value).toBe('');
  });

  it('openKeyboard() leaves display empty when value is empty string', () => {
    const kb = useNumericKeyboard();
    kb.openKeyboard('', () => {});
    expect(kb.displayValue.value).toBe('');
  });

  // ── closeKeyboard() ────────────────────────────────────────────────────────

  it('closeKeyboard() hides the keyboard and clears the display', () => {
    const kb = useNumericKeyboard();
    kb.openKeyboard(5, () => {});
    kb.closeKeyboard();
    expect(kb.isVisible.value).toBe(false);
    expect(kb.displayValue.value).toBe('');
  });

  // ── confirm() ─────────────────────────────────────────────────────────────

  it('confirm() calls the callback with the current display value', () => {
    const kb = useNumericKeyboard();
    let received = null;
    kb.openKeyboard(null, (v) => { received = v; });
    kb.appendDigit('4');
    kb.appendDigit('2');
    kb.confirm();
    expect(received).toBe('42');
  });

  it('confirm() hides the keyboard after invoking the callback', () => {
    const kb = useNumericKeyboard();
    kb.openKeyboard(1, () => {});
    kb.confirm();
    expect(kb.isVisible.value).toBe(false);
  });

  // ── appendDigit() ─────────────────────────────────────────────────────────

  it('appendDigit() adds digits to the display', () => {
    const kb = useNumericKeyboard();
    kb.openKeyboard(null, () => {});
    kb.appendDigit('1');
    kb.appendDigit('2');
    kb.appendDigit('3');
    expect(kb.displayValue.value).toBe('123');
  });

  it('appendDigit(".") inserts a decimal point', () => {
    const kb = useNumericKeyboard();
    kb.openKeyboard(null, () => {});
    kb.appendDigit('1');
    kb.appendDigit('.');
    kb.appendDigit('5');
    expect(kb.displayValue.value).toBe('1.5');
  });

  it('appendDigit(".") prepends "0." when the display is empty', () => {
    const kb = useNumericKeyboard();
    kb.openKeyboard(null, () => {});
    kb.appendDigit('.');
    expect(kb.displayValue.value).toBe('0.');
  });

  it('appendDigit(".") is ignored when a decimal already exists', () => {
    const kb = useNumericKeyboard();
    kb.openKeyboard(null, () => {});
    kb.appendDigit('1');
    kb.appendDigit('.');
    kb.appendDigit('.');
    expect(kb.displayValue.value).toBe('1.');
  });

  it('appendDigit(".") is ignored when allowDecimal is false', () => {
    const kb = useNumericKeyboard();
    kb.openKeyboard(null, () => {}, { allowDecimal: false });
    kb.appendDigit('5');
    kb.appendDigit('.');
    expect(kb.displayValue.value).toBe('5');
  });

  // ── backspace() ────────────────────────────────────────────────────────────

  it('backspace() removes the last character', () => {
    const kb = useNumericKeyboard();
    kb.openKeyboard(null, () => {});
    kb.appendDigit('9');
    kb.appendDigit('8');
    kb.backspace();
    expect(kb.displayValue.value).toBe('9');
  });

  it('backspace() on empty display leaves it empty', () => {
    const kb = useNumericKeyboard();
    kb.openKeyboard(null, () => {});
    kb.backspace();
    expect(kb.displayValue.value).toBe('');
  });

  // ── clear() ────────────────────────────────────────────────────────────────

  it('clear() empties the display', () => {
    const kb = useNumericKeyboard();
    kb.openKeyboard(null, () => {});
    kb.appendDigit('9');
    kb.appendDigit('9');
    kb.clear();
    expect(kb.displayValue.value).toBe('');
  });

  // ── singleton behavior ─────────────────────────────────────────────────────

  it('shares state between two instances obtained from useNumericKeyboard()', () => {
    const kb1 = useNumericKeyboard();
    const kb2 = useNumericKeyboard();
    kb1.openKeyboard(7, () => {});
    expect(kb2.isVisible.value).toBe(true);
    expect(kb2.displayValue.value).toBe('7');
  });
});
