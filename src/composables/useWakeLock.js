/**
 * useWakeLock — prevents the screen from locking while the app is in PWA
 * (standalone display mode) and the user has enabled the setting.
 *
 * The WakeLock API sentinel is automatically re-acquired on `visibilitychange`
 * because the browser releases any active lock when the page becomes hidden.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API
 */

import { watch, onMounted, onUnmounted } from 'vue';
import { useAppStore } from '../store/index.js';

function isStandaloneDisplayMode() {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator || {};
  const isIOSStandalone = typeof nav.standalone === 'boolean' && nav.standalone;
  const isDisplayModeStandalone =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  return isIOSStandalone || isDisplayModeStandalone;
}

function isWakeLockSupported() {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

export function useWakeLock() {
  const store = useAppStore();
  let wakeLock = null;

  async function requestWakeLock() {
    if (!isStandaloneDisplayMode()) return;
    if (!store.preventScreenLock) return;
    if (!isWakeLockSupported()) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (err) {
      // Request may be rejected if the document is not visible or the
      // device does not support the feature; log and otherwise ignore.
      console.warn('[WakeLock] Failed to acquire:', err);
    }
  }

  async function releaseWakeLock() {
    if (wakeLock) {
      try {
        await wakeLock.release();
      } catch {
        // Ignore errors during release
      }
      wakeLock = null;
    }
  }

  async function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      // Re-acquire the lock after the page becomes visible again
      await requestWakeLock();
    }
  }

  watch(
    () => store.preventScreenLock,
    async (enabled) => {
      if (enabled) {
        await requestWakeLock();
      } else {
        await releaseWakeLock();
      }
    }
  );

  onMounted(async () => {
    document.addEventListener('visibilitychange', handleVisibilityChange);
    await requestWakeLock();
  });

  onUnmounted(async () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    await releaseWakeLock();
  });
}
