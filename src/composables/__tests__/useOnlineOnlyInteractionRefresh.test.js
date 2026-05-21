import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { mount } from '@vue/test-utils';
import {
  INTERACTION_PULL_THROTTLE_MS,
  INTERACTION_PULL_STALENESS_MS,
  useOnlineOnlyInteractionRefresh,
} from '../useOnlineOnlyInteractionRefresh.js';
import { OPERATING_MODES } from '../../utils/index.js';

function makeHarness({
  operatingMode = OPERATING_MODES.ONLINE_ONLY,
  routePath = '/start',
  resolveCollectionsForRoute = null,
  hasScopedPullApi = true,
} = {}) {
  const sync = {
    forcePull: vi.fn().mockResolvedValue({ ok: true, failedCollections: [] }),
    forcePullCollections: vi.fn().mockResolvedValue({ ok: true, failedCollections: [] }),
    lastPullAt: ref(null),
    lastInteractionPullAt: ref(null),
  };
  if (!hasScopedPullApi) {
    delete sync.forcePullCollections;
  }
  const configStore = { operatingMode };
  const routePathRef = ref(routePath);

  const Comp = defineComponent({
    setup() {
      const refresh = useOnlineOnlyInteractionRefresh({
        sync,
        configStore,
        routePathRef,
        resolveCollectionsForRoute,
      });
      return { refresh, routePathRef };
    },
    template: '<div />',
  });

  const wrapper = mount(Comp);
  return { wrapper, sync, configStore, routePathRef };
}

async function flushPromises(rounds = 5) {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
  }
}

describe('useOnlineOnlyInteractionRefresh()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
    vi.stubGlobal('navigator', { ...navigator, onLine: true });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('triggers pull on route change in online_only mode', async () => {
    const { wrapper, sync, routePathRef } = makeHarness();

    routePathRef.value = '/orders';
    await flushPromises();
    vi.advanceTimersByTime(INTERACTION_PULL_THROTTLE_MS - 1);
    expect(sync.forcePull).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await flushPromises();
    expect(sync.forcePull).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it('dedups focus/visibility/online bursts with throttle', async () => {
    const { wrapper, sync } = makeHarness();

    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(INTERACTION_PULL_THROTTLE_MS);
    await flushPromises();

    expect(sync.forcePull).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it('skips pull when last pull is too recent (staleness guard)', async () => {
    const { wrapper, sync, routePathRef } = makeHarness();
    sync.lastPullAt.value = new Date().toISOString();

    routePathRef.value = '/tables';
    await flushPromises();
    vi.advanceTimersByTime(INTERACTION_PULL_THROTTLE_MS);
    await flushPromises();

    expect(sync.forcePull).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it('does not trigger interaction pull outside online_only mode', async () => {
    const modes = [OPERATING_MODES.OFFLINE_FIRST, OPERATING_MODES.OFFLINE_ONLY];
    for (const mode of modes) {
      const { wrapper, sync, routePathRef } = makeHarness({ operatingMode: mode });
      routePathRef.value = `/mode-${mode}`;
      await flushPromises();
      vi.advanceTimersByTime(INTERACTION_PULL_THROTTLE_MS);
      await flushPromises();
      window.dispatchEvent(new Event('focus'));
      vi.advanceTimersByTime(INTERACTION_PULL_THROTTLE_MS);
      await flushPromises();
      expect(sync.forcePull).not.toHaveBeenCalled();
      expect(sync.forcePullCollections).not.toHaveBeenCalled();
      wrapper.unmount();
    }
  });

  it('re-enables interaction pull when the previous pull becomes stale', async () => {
    const { wrapper, sync, routePathRef } = makeHarness();
    sync.lastPullAt.value = new Date().toISOString();
    routePathRef.value = '/blocked';
    await flushPromises();
    vi.advanceTimersByTime(INTERACTION_PULL_THROTTLE_MS);
    await flushPromises();
    expect(sync.forcePull).not.toHaveBeenCalled();

    vi.advanceTimersByTime(INTERACTION_PULL_STALENESS_MS + 50);
    routePathRef.value = '/allowed';
    await flushPromises();
    vi.advanceTimersByTime(INTERACTION_PULL_THROTTLE_MS);
    await flushPromises();
    expect(sync.forcePull).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it('uses scoped pull API when route collections resolver is provided', async () => {
    const resolveCollectionsForRoute = vi.fn().mockReturnValue(['orders', 'order_items']);
    const { wrapper, sync, routePathRef } = makeHarness({ resolveCollectionsForRoute });

    routePathRef.value = '/ordini';
    await flushPromises();
    vi.advanceTimersByTime(INTERACTION_PULL_THROTTLE_MS);
    await flushPromises();

    expect(resolveCollectionsForRoute).toHaveBeenCalled();
    expect(sync.forcePullCollections).toHaveBeenCalledWith(['orders', 'order_items']);
    expect(sync.forcePull).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it('falls back to forcePull when scoped pull API is unavailable', async () => {
    const resolveCollectionsForRoute = vi.fn().mockReturnValue(['orders']);
    const { wrapper, sync, routePathRef } = makeHarness({
      resolveCollectionsForRoute,
      hasScopedPullApi: false,
    });

    routePathRef.value = '/ordini';
    await flushPromises();
    vi.advanceTimersByTime(INTERACTION_PULL_THROTTLE_MS);
    await flushPromises();

    expect(sync.forcePull).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });
});
