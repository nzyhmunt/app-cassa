/**
 * Vitest global setup file.
 *
 * ── Timezone ─────────────────────────────────────────────────────────────────
 * Pin the process timezone to Europe/Rome so that all `new Date()` calls and
 * `toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome' })` assertions in
 * tests produce consistent results regardless of the CI server's system clock.
 * This must be set before any module that reads Date is imported.
 */
process.env.TZ = 'Europe/Rome';

/**
 * ── localStorage polyfill ────────────────────────────────────────────────────
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

/**
 * ── IndexedDB polyfill ───────────────────────────────────────────────────────
 * jsdom does not implement IndexedDB. `fake-indexeddb/auto` provides a complete
 * in-memory implementation. Vitest runs each test file in an isolated worker
 * context, so every file automatically gets a fresh IDB environment.
 * Individual test files reset the `useIDB` singleton in their own `beforeEach`
 * hooks via `_resetIDBSingleton()` to ensure clean state between test cases.
 */
import 'fake-indexeddb/auto';
