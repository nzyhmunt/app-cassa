import { computed, ref } from 'vue';
import { directusEnabledRef } from './useDirectusClient.js';

/**
 * Shared swipe-down refresh for app roots.
 * - Directus enabled: full reconfigure+pull, then local IDB hydration.
 * - Directus disabled: local IDB hydration only.
 */
export function useAppSwipeRefresh({
  configStore,
  orderStore,
  sync,
  logPrefix = 'App',
  thresholdPx = 80,
}) {
  const isSwipeRefreshing = ref(false);
  const isPulling = ref(false);
  const pullDistance = ref(0);
  const isThresholdReached = computed(() => pullDistance.value >= thresholdPx);
  const pullProgress = computed(() => {
    if (thresholdPx <= 0) return 1;
    return Math.max(0, Math.min(1, pullDistance.value / thresholdPx));
  });

  const PULL_DISTANCE_MAX_MULTIPLIER = 1.6;
  const PULL_GESTURE_MIN_PX = 6;
  let swipeStartY = 0;
  /** @type {number|null} */
  let activeTouchId = null;
  /** @type {EventTarget|null} */
  let swipeStartTarget = null;
  /** @type {boolean|null} */
  let swipeStartedAtTop = null;

  function canStartPullRefresh(target) {
    if (typeof window === 'undefined' || window.scrollY > 0) return false;
    let node = target instanceof Element ? target : null;
    while (node && node !== document.body) {
      const style = window.getComputedStyle(node);
      const overflowY = style?.overflowY ?? '';
      const isScrollable = /(auto|scroll|overlay)/.test(overflowY) && node.scrollHeight > node.clientHeight;
      if (isScrollable && node.scrollTop > 0) return false;
      node = node.parentElement;
    }
    return true;
  }

  function resetPullState() {
    isPulling.value = false;
    pullDistance.value = 0;
    activeTouchId = null;
    swipeStartY = 0;
    swipeStartTarget = null;
    swipeStartedAtTop = null;
  }

  function findTouchById(touchList) {
    if (activeTouchId == null || !touchList) return null;
    for (const touch of touchList) {
      if (touch.identifier === activeTouchId) return touch;
    }
    return null;
  }

  function canPullFromStartTarget() {
    if (swipeStartedAtTop != null) return swipeStartedAtTop;
    swipeStartedAtTop = canStartPullRefresh(swipeStartTarget);
    return swipeStartedAtTop;
  }

  async function runRefresh() {
    if (isSwipeRefreshing.value) return;
    isSwipeRefreshing.value = true;
    try {
      if (directusEnabledRef.value) {
        await sync.reconfigureAndApply({ clearLocalConfig: false });
        await sync.forcePull();
      }
      await Promise.all([
        configStore.hydrateConfigFromIDB(),
        orderStore.refreshOperationalStateFromIDB(),
      ]);
    } catch (error) {
      console.warn(`[${logPrefix}] Swipe refresh failed:`, error);
    } finally {
      isSwipeRefreshing.value = false;
    }
  }

  function onTouchStart(event) {
    if (activeTouchId != null) return;
    const touch = event.changedTouches?.[0] ?? event.touches?.[0];
    if (!touch) return;
    activeTouchId = touch.identifier;
    swipeStartY = touch.clientY;
    swipeStartTarget = event.target ?? null;
    swipeStartedAtTop = null;
    isPulling.value = false;
    pullDistance.value = 0;
  }

  function onTouchMove(event) {
    const touch = findTouchById(event.touches);
    if (!touch) return;
    const deltaY = touch.clientY - swipeStartY;
    if (deltaY <= PULL_GESTURE_MIN_PX) {
      isPulling.value = false;
      pullDistance.value = 0;
      return;
    }
    if (!canPullFromStartTarget()) {
      isPulling.value = false;
      pullDistance.value = 0;
      return;
    }
    isPulling.value = true;
    pullDistance.value = Math.min(deltaY, thresholdPx * PULL_DISTANCE_MAX_MULTIPLIER);
  }

  function onTouchEnd(event) {
    const touch = findTouchById(event.changedTouches);
    if (!touch) {
      resetPullState();
      return;
    }
    const deltaY = touch.clientY - swipeStartY;
    const canRefresh = canPullFromStartTarget();
    const reachedThreshold = deltaY >= thresholdPx;
    const shouldRefresh = !isSwipeRefreshing.value && canRefresh && reachedThreshold;
    resetPullState();
    if (!shouldRefresh) return;
    void runRefresh();
  }

  function onTouchCancel() {
    resetPullState();
  }

  return {
    isSwipeRefreshing,
    isPulling,
    isThresholdReached,
    pullDistance,
    pullProgress,
    runRefresh,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
  };
}
