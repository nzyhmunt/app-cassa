import { ref, onMounted, onUnmounted } from 'vue';
import { appConfig } from '../utils/index.js';

/**
 * Composable that provides a reactive current-time string updated every second.
 * Shared by CassaNavbar, SalaNavbar, and any other header that shows a clock.
 */
export function useAppClock() {
  const currentTime = ref(
    new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: appConfig.timezone }),
  );

  let clockTimer = null;

  onMounted(() => {
    clockTimer = setInterval(() => {
      currentTime.value = new Date().toLocaleTimeString('it-IT', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: appConfig.timezone,
      });
    }, 1000);
  });

  onUnmounted(() => {
    if (clockTimer !== null) clearInterval(clockTimer);
  });

  return { currentTime };
}
