/**
 * @file store/persistence/eventBus.js
 * @description In-process event bus for IDB write notifications.
 *
 * After a successful IDB write, persistence helpers call `emitIDBChange(state)`
 * with the state slice that was persisted. Subscribers (Pinia stores) can update
 * their reactive refs in response, and stores should prefer driving reactive
 * state from these persisted writes rather than direct ref assignments in
 * action bodies when possible.
 *
 * The goal is to converge on a single reactive-update path regardless of
 * whether the write originates from a UI action or the Sync Loop.
 */

const _listeners = new Set();

/**
 * Subscribes to IDB-change notifications.
 * @param {function(object): void} fn – Called with the persisted state slice.
 * @returns {function(): void} Unsubscribe function.
 */
export function onIDBChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/**
 * Emits an IDB-change notification to all active subscribers.
 * Called by persistence helpers immediately after a successful IDB write.
 * @param {object} state – The state slice that was persisted.
 */
export function emitIDBChange(state) {
  for (const fn of _listeners) {
    try {
      fn(state);
    } catch (e) {
      console.warn('[IDBEventBus] Subscriber error:', e);
    }
  }
}

/**
 * Removes all subscribers. Intended for use in test teardown only.
 * Prevents cross-test contamination when async IDB writes complete after a
 * test's Pinia instance has already been replaced.
 */
export function _resetListeners() {
  _listeners.clear();
}
