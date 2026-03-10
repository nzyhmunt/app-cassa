/**
 * useBeep — shared audio notification composable.
 *
 * Reads the `sounds` toggle from `app-settings` in localStorage and
 * exposes `playBeep()` so both Navbar and SalaNavbar stay in sync.
 */

const SETTINGS_STORAGE_KEY = 'app-settings';

function isSoundsEnabled() {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
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
