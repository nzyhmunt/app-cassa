/**
 * useBeep — shared audio notification composable.
 *
 * Reads the `sounds` toggle from the instance-specific settings key in
 * localStorage and exposes `playBeep()` so both Navbar and SalaNavbar
 * stay in sync. The key is derived via `resolveStorageKeys()` to support
 * multi-instance builds where each instance has an isolated settings entry.
 */

import { resolveStorageKeys } from '../store/persistence.js';

function isSoundsEnabled() {
  try {
    const { settingsKey } = resolveStorageKeys();
    const raw = window.localStorage.getItem(settingsKey);
    if (!raw) return true;
    const parsed = JSON.parse(raw);
    return typeof parsed.sounds === 'boolean' ? parsed.sounds : true;
  } catch {
    return true;
  }
}

export function useBeep() {
  function playBeep() {
    if (!isSoundsEnabled()) return;
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
