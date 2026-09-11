/**
 * @file useSelfOrderPreferencesSignal.test.js
 * Unit tests for the same-tab preferences update signal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import {
  PREFERENCES_UPDATED_EVENT,
  notifyPreferencesUpdated,
  usePreferencesTick,
} from '../useSelfOrderPreferencesSignal.js';

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

describe('useSelfOrderPreferencesSignal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('notifyPreferencesUpdated dispatches the documented event', () => {
    const spy = vi.fn();
    window.addEventListener(PREFERENCES_UPDATED_EVENT, spy);
    notifyPreferencesUpdated();
    expect(spy).toHaveBeenCalledTimes(1);
    window.removeEventListener(PREFERENCES_UPDATED_EVENT, spy);
  });

  it('usePreferencesTick starts at 0 and increments on each update', async () => {
    const { result } = withSetup(usePreferencesTick);
    expect(result.value).toBe(0);

    notifyPreferencesUpdated();
    expect(result.value).toBe(1);

    notifyPreferencesUpdated();
    expect(result.value).toBe(2);
  });

  it('stops reacting after the component is unmounted (no listener leak)', async () => {
    const { result, wrapper } = withSetup(usePreferencesTick);
    expect(result.value).toBe(0);

    notifyPreferencesUpdated();
    expect(result.value).toBe(1);

    wrapper.unmount();

    // After unmount the tick must not advance: the listener was removed.
    notifyPreferencesUpdated();
    notifyPreferencesUpdated();
    expect(result.value).toBe(1);
  });
});
