/**
 * useBeep — shared audio notification composable.
 *
 * Reads the `sounds` toggle from the Pinia store (populated from IndexedDB
 * via initStoreFromIDB before app mount) and exposes `playBeep()` so both
 * Navbar and SalaNavbar stay in sync.
 */

import { useAppStore } from '../store/index.js';

export function useBeep() {
  function playBeep() {
    try {
      const store = useAppStore();
      if (store.sounds === false) return;
    } catch {
      // Store not available (e.g. in test environments without Pinia) — play by default
    }
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.2);
      osc.stop(ctx.currentTime + 0.2);
      // Close the context once the sound has finished to free audio resources
      setTimeout(() => {
        Promise
          .resolve(ctx.close())
          .catch((err) => {
            console.warn('[useBeep] Failed to close AudioContext:', err);
          });
      }, 500);
    } catch (e) {
      console.warn('[useBeep] Failed to play beep:', e);
    }
  }

  return { playBeep };
}
