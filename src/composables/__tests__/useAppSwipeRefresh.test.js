import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppSwipeRefresh } from '../useAppSwipeRefresh.js';

const { mockDirectusEnabledRef } = vi.hoisted(() => ({
  mockDirectusEnabledRef: { value: false },
}));

vi.mock('../useDirectusClient.js', () => ({
  directusEnabledRef: mockDirectusEnabledRef,
}));

function makeStoresAndSync() {
  const configStore = {
    hydrateConfigFromIDB: vi.fn().mockResolvedValue(undefined),
  };
  const orderStore = {
    refreshOperationalStateFromIDB: vi.fn().mockResolvedValue(undefined),
  };
  const sync = {
    reconfigureAndApply: vi.fn().mockResolvedValue({ ok: true, failedCollections: [] }),
    forcePull: vi.fn().mockResolvedValue(undefined),
  };
  return { configStore, orderStore, sync };
}

function touch(identifier, y) {
  return { identifier, clientY: y };
}

function setScrollY(value) {
  Object.defineProperty(window, 'scrollY', {
    value,
    writable: true,
    configurable: true,
  });
}

async function flushPromises(rounds = 10) {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
  }
}

describe('useAppSwipeRefresh()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockDirectusEnabledRef.value = false;
    setScrollY(0);
    document.body.innerHTML = '';
  });

  it('does not traverse DOM on touchstart and refreshes only after threshold', async () => {
    const { configStore, orderStore, sync } = makeStoresAndSync();
    const swipe = useAppSwipeRefresh({
      configStore,
      orderStore,
      sync,
      thresholdPx: 80,
    });
    const root = document.createElement('div');
    document.body.appendChild(root);
    const computedSpy = vi.spyOn(window, 'getComputedStyle');

    swipe.onTouchStart({ touches: [touch(1, 10)], target: root });
    expect(computedSpy).not.toHaveBeenCalled();

    swipe.onTouchEnd({ changedTouches: [touch(1, 70)] });
    expect(configStore.hydrateConfigFromIDB).not.toHaveBeenCalled();

    swipe.onTouchStart({ touches: [touch(2, 20)], target: root });
    swipe.onTouchEnd({ changedTouches: [touch(2, 120)] });
    await flushPromises();

    expect(computedSpy).toHaveBeenCalled();
    expect(configStore.hydrateConfigFromIDB).toHaveBeenCalledTimes(1);
    expect(orderStore.refreshOperationalStateFromIDB).toHaveBeenCalledTimes(1);
    expect(sync.reconfigureAndApply).not.toHaveBeenCalled();
    expect(sync.forcePull).not.toHaveBeenCalled();
  });

  it('uses IDB-only refresh when Directus is disabled', async () => {
    const { configStore, orderStore, sync } = makeStoresAndSync();
    const swipe = useAppSwipeRefresh({ configStore, orderStore, sync, thresholdPx: 40 });
    const root = document.createElement('div');
    document.body.appendChild(root);

    swipe.onTouchStart({ touches: [touch(1, 0)], target: root });
    swipe.onTouchEnd({ changedTouches: [touch(1, 60)] });
    await flushPromises();

    expect(configStore.hydrateConfigFromIDB).toHaveBeenCalledTimes(1);
    expect(orderStore.refreshOperationalStateFromIDB).toHaveBeenCalledTimes(1);
    expect(sync.reconfigureAndApply).not.toHaveBeenCalled();
    expect(sync.forcePull).not.toHaveBeenCalled();
  });

  it('uses full Directus path when enabled', async () => {
    mockDirectusEnabledRef.value = true;
    const { configStore, orderStore, sync } = makeStoresAndSync();
    const swipe = useAppSwipeRefresh({ configStore, orderStore, sync, thresholdPx: 40 });
    const root = document.createElement('div');
    document.body.appendChild(root);

    swipe.onTouchStart({ touches: [touch(1, 0)], target: root });
    swipe.onTouchEnd({ changedTouches: [touch(1, 80)] });
    await flushPromises();

    expect(sync.reconfigureAndApply).toHaveBeenCalledWith({ clearLocalConfig: false });
    expect(sync.forcePull).toHaveBeenCalledTimes(1);
    expect(configStore.hydrateConfigFromIDB).toHaveBeenCalledTimes(1);
    expect(orderStore.refreshOperationalStateFromIDB).toHaveBeenCalledTimes(1);
  });

  it('tracks pulling state and threshold progression from touchmove', () => {
    const { configStore, orderStore, sync } = makeStoresAndSync();
    const swipe = useAppSwipeRefresh({ configStore, orderStore, sync, thresholdPx: 100 });
    const root = document.createElement('div');
    document.body.appendChild(root);

    swipe.onTouchStart({ touches: [touch(1, 20)], target: root });
    swipe.onTouchMove({ touches: [touch(1, 35)] });
    expect(swipe.isPulling.value).toBe(true);
    expect(swipe.pullProgress.value).toBeCloseTo(0.15, 2);
    expect(swipe.isThresholdReached.value).toBe(false);

    swipe.onTouchMove({ touches: [touch(1, 150)] });
    expect(swipe.isThresholdReached.value).toBe(true);
  });

  it('matches touch identifier to avoid multi-touch false positives', async () => {
    const { configStore, orderStore, sync } = makeStoresAndSync();
    const swipe = useAppSwipeRefresh({ configStore, orderStore, sync, thresholdPx: 40 });
    const root = document.createElement('div');
    document.body.appendChild(root);

    swipe.onTouchStart({ touches: [touch(11, 0)], target: root });
    swipe.onTouchEnd({ changedTouches: [touch(22, 120)] });
    await Promise.resolve();

    expect(configStore.hydrateConfigFromIDB).not.toHaveBeenCalled();
    expect(orderStore.refreshOperationalStateFromIDB).not.toHaveBeenCalled();
  });

  it('resets gesture state on touchcancel', () => {
    const { configStore, orderStore, sync } = makeStoresAndSync();
    const swipe = useAppSwipeRefresh({ configStore, orderStore, sync, thresholdPx: 40 });
    const root = document.createElement('div');
    document.body.appendChild(root);

    swipe.onTouchStart({ touches: [touch(2, 0)], target: root });
    swipe.onTouchMove({ touches: [touch(2, 60)] });
    expect(swipe.isPulling.value).toBe(true);

    swipe.onTouchCancel();
    expect(swipe.isPulling.value).toBe(false);
    expect(swipe.pullDistance.value).toBe(0);
  });

  it('clamps non-positive thresholds to default to avoid accidental tap refresh', async () => {
    const { configStore, orderStore, sync } = makeStoresAndSync();
    const swipe = useAppSwipeRefresh({ configStore, orderStore, sync, thresholdPx: 0 });
    const root = document.createElement('div');
    document.body.appendChild(root);

    swipe.onTouchStart({ touches: [touch(5, 0)], target: root });
    swipe.onTouchEnd({ changedTouches: [touch(5, 10)] });
    await flushPromises();

    expect(configStore.hydrateConfigFromIDB).not.toHaveBeenCalled();
    expect(orderStore.refreshOperationalStateFromIDB).not.toHaveBeenCalled();
    expect(swipe.pullProgress.value).toBe(0);
  });

  it('normalizes non-element targets and blocks refresh inside scrolled containers', async () => {
    const { configStore, orderStore, sync } = makeStoresAndSync();
    const swipe = useAppSwipeRefresh({ configStore, orderStore, sync, thresholdPx: 40 });
    const scroller = document.createElement('div');
    scroller.style.overflowY = 'auto';
    Object.defineProperty(scroller, 'clientHeight', { value: 100, configurable: true });
    Object.defineProperty(scroller, 'scrollHeight', { value: 400, configurable: true });
    scroller.scrollTop = 10;
    const span = document.createElement('span');
    const textNode = document.createTextNode('content');
    span.appendChild(textNode);
    scroller.appendChild(span);
    document.body.appendChild(scroller);

    swipe.onTouchStart({ touches: [touch(8, 0)], target: textNode });
    swipe.onTouchEnd({ changedTouches: [touch(8, 80)] });
    await flushPromises();

    expect(configStore.hydrateConfigFromIDB).not.toHaveBeenCalled();
    expect(orderStore.refreshOperationalStateFromIDB).not.toHaveBeenCalled();
  });

  describe('isRefreshDone timer behaviour', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('sets isRefreshDone after successful refresh and clears it after 800ms', async () => {
      vi.useFakeTimers();
      const { configStore, orderStore, sync } = makeStoresAndSync();
      const swipe = useAppSwipeRefresh({ configStore, orderStore, sync, thresholdPx: 40 });
      const root = document.createElement('div');
      document.body.appendChild(root);

      swipe.onTouchStart({ touches: [touch(1, 0)], target: root });
      swipe.onTouchEnd({ changedTouches: [touch(1, 60)] });

      // Let async work finish but don't advance the 800 ms timer yet
      await flushPromises();

      expect(swipe.isRefreshDone.value).toBe(true);
      expect(swipe.isSwipeRefreshing.value).toBe(false);

      vi.advanceTimersByTime(800);
      await flushPromises();

      expect(swipe.isRefreshDone.value).toBe(false);
    });

    it('cancels a pending isRefreshDone timer when a second refresh starts', async () => {
      vi.useFakeTimers();
      const { configStore, orderStore, sync } = makeStoresAndSync();
      const swipe = useAppSwipeRefresh({ configStore, orderStore, sync, thresholdPx: 40 });
      const root = document.createElement('div');
      document.body.appendChild(root);

      // First refresh — finishes, starts 800 ms timer
      swipe.onTouchStart({ touches: [touch(1, 0)], target: root });
      swipe.onTouchEnd({ changedTouches: [touch(1, 60)] });
      await flushPromises();
      expect(swipe.isRefreshDone.value).toBe(true);

      // Second refresh starts before the first timer fires
      swipe.onTouchStart({ touches: [touch(2, 0)], target: root });
      swipe.onTouchEnd({ changedTouches: [touch(2, 60)] });
      // Timer should have been cancelled — isRefreshDone is false while refreshing
      expect(swipe.isRefreshDone.value).toBe(false);
      expect(swipe.isSwipeRefreshing.value).toBe(true);

      await flushPromises();
      // Second refresh completes, isRefreshDone is true again
      expect(swipe.isRefreshDone.value).toBe(true);

      vi.advanceTimersByTime(800);
      await flushPromises();
      expect(swipe.isRefreshDone.value).toBe(false);
    });

    it('does not set isRefreshDone when refresh throws', async () => {
      vi.useFakeTimers();
      const { configStore, orderStore, sync } = makeStoresAndSync();
      configStore.hydrateConfigFromIDB.mockRejectedValue(new Error('fail'));
      const swipe = useAppSwipeRefresh({ configStore, orderStore, sync, thresholdPx: 40 });
      const root = document.createElement('div');
      document.body.appendChild(root);

      swipe.onTouchStart({ touches: [touch(1, 0)], target: root });
      swipe.onTouchEnd({ changedTouches: [touch(1, 60)] });
      await flushPromises();

      expect(swipe.isRefreshDone.value).toBe(false);
      expect(swipe.isSwipeRefreshing.value).toBe(false);
    });
  });
});
