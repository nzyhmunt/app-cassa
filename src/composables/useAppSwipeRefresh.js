import { ref } from 'vue';
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
  let swipeStartY = 0;
  let swipeStartedAtTop = false;

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
    const touch = event.touches?.[0];
    if (!touch) return;
    swipeStartY = touch.clientY;
    swipeStartedAtTop = canStartPullRefresh(event.target);
  }

  function onTouchEnd(event) {
    const touch = event.changedTouches?.[0];
    if (!touch || !swipeStartedAtTop || isSwipeRefreshing.value) return;
    const deltaY = touch.clientY - swipeStartY;
    if (deltaY < thresholdPx) return;
    void runRefresh();
  }

  return {
    isSwipeRefreshing,
    runRefresh,
    onTouchStart,
    onTouchEnd,
  };
}
