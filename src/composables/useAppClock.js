import { ref, onMounted, onUnmounted } from 'vue';
import { useAppStore } from '../store/index.js';

/**
 * Composable that provides a reactive current-time string updated every second.
 * Shared by CassaNavbar, SalaNavbar, and any other header that shows a clock.
 */
export function useAppClock() {
  const store = useAppStore();
  const locale = () => store.config?.locale ?? 'it-IT';
  const timezone = () => store.config?.timezone ?? 'Europe/Rome';
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
