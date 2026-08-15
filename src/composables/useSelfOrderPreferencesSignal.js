import { ref, onMounted, onUnmounted } from 'vue';

/**
 * Same-tab signal used to notify self-order views/components that the user's
 * dietary preferences (stored under `selforder_preferences` in localStorage)
 * have changed. Without this, `localStorage`-backed computed values (e.g. the
 * navbar's preferences indicator) and the menu's allergen filtering only react
 * after a full reload/remount, since `localStorage` is not reactive and the
 * `storage` event does not fire in the same tab that wrote it.
 */
export const PREFERENCES_UPDATED_EVENT = 'selforder:preferences-updated';

/** Fire the signal; call right after writing preferences to localStorage. */
export function notifyPreferencesUpdated() {
  window.dispatchEvent(new CustomEvent(PREFERENCES_UPDATED_EVENT));
}

/**
 * Reactive counter that increments whenever preferences are updated.
 * Subscribe it (and tear it down) to the component lifecycle so listeners
 * don't leak across navigation. Reference `.value` inside a computed/watch to
 * make localStorage-backed derivations update live in the same tab.
 */
export function usePreferencesTick() {
  const tick = ref(0);
  const handler = () => { tick.value++; };
  onMounted(() => window.addEventListener(PREFERENCES_UPDATED_EVENT, handler));
  onUnmounted(() => window.removeEventListener(PREFERENCES_UPDATED_EVENT, handler));
  return tick;
}
