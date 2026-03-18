import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { useAppClock } from '../useAppClock.js';

// ---------------------------------------------------------------------------
// Helper: mount a component that calls the composable and exposes its return
// ---------------------------------------------------------------------------
function withSetup(composable) {
  let result;
  const TestComponent = defineComponent({
    setup() {
      result = composable();
      return {};
    },
    template: '<div></div>',
  });
  const wrapper = mount(TestComponent);
  return { result, wrapper };
}

describe('useAppClock()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a currentTime ref with the current time formatted as HH:MM', () => {
    const { result } = withSetup(useAppClock);
    // currentTime should be a string matching HH:MM pattern
    expect(result.currentTime.value).toMatch(/^\d{2}:\d{2}$/);
  });

  it('updates currentTime every second via setInterval', async () => {
    const { result } = withSetup(useAppClock);

    // Advance by 1 second to trigger the interval
    vi.advanceTimersByTime(1000);

    // The value should still be a valid HH:MM string after the tick
    expect(result.currentTime.value).toMatch(/^\d{2}:\d{2}$/);
  });

  it('clears the interval on unmount to prevent memory leaks', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const { wrapper } = withSetup(useAppClock);

    wrapper.unmount();

    expect(clearSpy).toHaveBeenCalled();
  });

  // ── Timezone verification ────────────────────────────────────────────────
  // Verifies that the clock always displays time in the Europe/Rome timezone
  // regardless of the process/server timezone. This is critical for the
  // Italian restaurant app to show correct local times in all environments
  // (dev, CI, production servers that may run in UTC).
  it('formats time using the Europe/Rome timezone', () => {
    // Pin the fake clock to a known UTC instant:
    // 2026-01-15 11:30:00 UTC == 12:30:00 CET (Europe/Rome, UTC+1 in January)
    const utcMs = Date.UTC(2026, 0, 15, 11, 30, 0);
    vi.setSystemTime(utcMs);

    const { result } = withSetup(useAppClock);

    // The clock must show 12:30 (Europe/Rome) not 11:30 (UTC)
    expect(result.currentTime.value).toBe('12:30');
  });

  it('updates with correct Europe/Rome time after interval tick', () => {
    // Start at 2026-07-15 10:00:00 UTC == 12:00:00 CEST (Europe/Rome, UTC+2 in July)
    const utcMs = Date.UTC(2026, 6, 15, 10, 0, 0);
    vi.setSystemTime(utcMs);

    const { result } = withSetup(useAppClock);
    expect(result.currentTime.value).toBe('12:00');

    // Advance by 1 minute (60 s → fires the interval once)
    vi.advanceTimersByTime(60_000);

    expect(result.currentTime.value).toBe('12:01');
  });
});
