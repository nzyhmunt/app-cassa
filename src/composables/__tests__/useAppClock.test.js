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
});
