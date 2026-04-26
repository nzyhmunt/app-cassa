import { computed, onUnmounted, ref } from 'vue';
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
  const effectiveThresholdPx = Number.isFinite(thresholdPx) && thresholdPx > 0 ? thresholdPx : 80;
  const isSwipeRefreshing = ref(false);
  const isRefreshDone = ref(false);
  const isPulling = ref(false);
  /** @type {ReturnType<typeof setTimeout>|null} */
  let refreshDoneTimer = null;
  const pullDistance = ref(0);
  const isThresholdReached = computed(() => pullDistance.value >= effectiveThresholdPx);
  const pullProgress = computed(() => {
    return Math.max(0, Math.min(1, pullDistance.value / effectiveThresholdPx));
  });
  const maxPullRotationDeg = 180;
  const pullRotationDeg = computed(() => Math.round(pullProgress.value * maxPullRotationDeg));

  // Cap visual drag feedback to 160% of threshold to keep the indicator stable
  // and avoid over-stretch effects on long pull gestures.
  const pullDistanceMaxMultiplier = 1.6;
  // Ignore tiny finger jitter so taps and micro-movements don't show pull UI.
  const pullGestureMinPx = 6;
  let swipeStartY = 0;
  /** @type {number|null} */
  let activeTouchId = null;
  /** @type {EventTarget|null} */
  let swipeStartTarget = null;
  /** @type {boolean|null} */
  let swipeStartedAtTop = null;

  function canStartPullRefresh(target) {
    if (typeof window === 'undefined' || window.scrollY > 0) return false;
    const normalizedTarget =
      target instanceof Element
        ? target
        : typeof Node !== 'undefined' && target instanceof Node
          ? target.parentElement
          : null;
    let node = normalizedTarget;
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
    for (let i = 0; i < touchList.length; i += 1) {
      const touch = touchList[i];
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
    if (refreshDoneTimer != null) {
      clearTimeout(refreshDoneTimer);
      refreshDoneTimer = null;
      isRefreshDone.value = false;
    }
    isSwipeRefreshing.value = true;
    isRefreshDone.value = false;
    let success = false;
    try {
      if (directusEnabledRef.value) {
        await sync.reconfigureAndApply({ clearLocalConfig: false });
        await sync.forcePull();
      }
      await Promise.all([
        configStore.hydrateConfigFromIDB(),
        orderStore.refreshOperationalStateFromIDB(),
      ]);
      success = true;
    } catch (error) {
      console.warn(`[${logPrefix}] Swipe refresh failed:`, error);
    } finally {
      isSwipeRefreshing.value = false;
    }
    if (success) {
      isRefreshDone.value = true;
      refreshDoneTimer = setTimeout(() => {
        refreshDoneTimer = null;
        isRefreshDone.value = false;
      }, 800);
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
    if (deltaY < pullGestureMinPx) {
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
    pullDistance.value = Math.min(deltaY, effectiveThresholdPx * pullDistanceMaxMultiplier);
  }

  function onTouchEnd(event) {
    const touch = findTouchById(event.changedTouches);
    if (!touch) {
      resetPullState();
      return;
    }
    const deltaY = touch.clientY - swipeStartY;
    if (deltaY < pullGestureMinPx) {
      resetPullState();
      return;
    }
    const reachedThreshold = deltaY >= effectiveThresholdPx;
    if (!reachedThreshold) {
      resetPullState();
      return;
    }
    if (isSwipeRefreshing.value) {
      resetPullState();
      return;
    }
    const canRefresh = canPullFromStartTarget();
    resetPullState();
    if (!canRefresh) return;
    void runRefresh();
  }

  function onTouchCancel() {
    resetPullState();
  }

  onUnmounted(() => {
    if (refreshDoneTimer != null) {
      clearTimeout(refreshDoneTimer);
      refreshDoneTimer = null;
    }
    isRefreshDone.value = false;
  });

  return {
    isSwipeRefreshing,
    isRefreshDone,
    isPulling,
    isThresholdReached,
    pullDistance,
    pullProgress,
    pullRotationDeg,
    runRefresh,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
  };
}
