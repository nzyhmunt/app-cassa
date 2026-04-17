import { ref, onMounted, onUnmounted } from 'vue';
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
    store = null;
  }
  const locale = () => store?.config?.locale ?? DEFAULT_SETTINGS.locale;
  const timezone = () => store?.config?.timezone ?? DEFAULT_SETTINGS.timezone;
  const currentTime = ref(
    new Date().toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', timeZone: timezone() }),
  );

  let clockTimer = null;

  onMounted(() => {
    clockTimer = setInterval(() => {
      currentTime.value = new Date().toLocaleTimeString(locale(), {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: timezone(),
      });
    }, 1000);
  });

  onUnmounted(() => {
    if (clockTimer !== null) clearInterval(clockTimer);
  });

  return { currentTime };
}
