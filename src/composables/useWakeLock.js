/**
 * useWakeLock — prevents the screen from locking while the app is in PWA
 * (standalone display mode) and the user has enabled the setting.
 *
 * The WakeLock API sentinel is automatically re-acquired when:
 *  - The page becomes visible again after being hidden (`visibilitychange`).
 *  - The sentinel is released by the OS or browser policy (`release` event).
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
  // Incremented each time requestWakeLock() is called; used to detect
  // whether the setting was toggled off while a request was in flight.
  let requestToken = 0;

  async function requestWakeLock() {
    if (!isStandaloneDisplayMode()) return;
    if (!store.preventScreenLock) return;
    if (!isWakeLockSupported()) return;

    const token = ++requestToken;
    let sentinel = null;
    try {
      sentinel = await navigator.wakeLock.request('screen');
    } catch (err) {
      // Request may be rejected if the document is not visible or the
      // device does not support the feature; log and otherwise ignore.
      console.warn('[WakeLock] Failed to acquire:', err);
      return;
    }

    // If the setting was disabled while the request was in flight, release
    // immediately instead of keeping the lock open.
    if (token !== requestToken || !store.preventScreenLock) {
      try { sentinel.release(); } catch { /* ignore */ }
      return;
    }

    wakeLock = sentinel;

    // Re-acquire if the browser or OS releases the sentinel autonomously
    // (e.g. power-saving policy), while the setting is still enabled.
    // Use { once: true } so the listener is automatically removed after firing.
    wakeLock.addEventListener('release', () => {
      if (wakeLock === sentinel) wakeLock = null;
      if (store.preventScreenLock && document.visibilityState === 'visible') {
        requestWakeLock();
      }
    }, { once: true });
  }

  async function releaseWakeLock() {
    const sentinel = wakeLock;
    wakeLock = null;
    // Advance the token so any in-flight request discards its result.
    requestToken++;
    if (sentinel) {
      try {
        await sentinel.release();
      } catch {
        // Ignore errors during release
      }
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
