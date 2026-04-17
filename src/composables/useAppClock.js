import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useAppStore } from '../store/index.js';
import { DEFAULT_SETTINGS } from '../utils/index.js';

/**
 * Composable that provides a reactive current-time string updated every second.
 * Shared by CassaNavbar, SalaNavbar, and any other header that shows a clock.
 */
export function useAppClock() {
  let store = null;
  try {
    store = useAppStore();
  } catch {
    // Expected in isolated unit tests where Pinia isn't mounted.
    store = null;
  }
  const locale = computed(() => store?.config?.locale ?? DEFAULT_SETTINGS.locale);
  const timezone = computed(() => store?.config?.timezone ?? DEFAULT_SETTINGS.timezone);
  const currentTime = ref(
    new Date().toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit', timeZone: timezone.value }),
  );

  let clockTimer = null;

  onMounted(() => {
    clockTimer = setInterval(() => {
      currentTime.value = new Date().toLocaleTimeString(locale.value, {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: timezone.value,
      });
    }, 60_000);
  });

  onUnmounted(() => {
    if (clockTimer !== null) clearInterval(clockTimer);
  });

  return { currentTime };
}
