/**
 * Vitest global setup file.
 *
 * Polyfills `localStorage.clear()` when the jsdom storage implementation does
 * not expose it. This prevents `TypeError: localStorage.clear is not a function`
 * in test files that call it in `beforeEach()` hooks to reset state between
 * test cases.
 */
if (typeof localStorage !== 'undefined' && typeof localStorage.clear !== 'function') {
  Storage.prototype.clear = function clear() {
    while (this.length > 0) {
      this.removeItem(this.key(0));
    }
  };
}
