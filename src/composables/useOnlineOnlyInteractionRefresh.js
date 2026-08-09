import { onMounted, onUnmounted, ref, watch } from 'vue';
import { normalizeOperatingMode, OPERATING_MODES } from '../utils/index.js';
import { normalizeCollectionScope } from './sync/collectionScope.js';

export const INTERACTION_PULL_THROTTLE_MS = 500;
export const INTERACTION_PULL_STALENESS_MS = 2_500;

export function useOnlineOnlyInteractionRefresh({
  sync,
  configStore,
  routePathRef = null,
  resolveCollectionsForRoute = null,
  logPrefix = 'OnlineOnlyInteractionRefresh',
  throttleMs = INTERACTION_PULL_THROTTLE_MS,
  stalenessMs = INTERACTION_PULL_STALENESS_MS,
}) {
  const lastInteractionPullAt = ref(null);
  let pullTimer = null;
  let inFlight = false;
  let queuedWhileInFlight = false;
  const hasScopedPullApi = typeof sync?.forcePullCollections === 'function';

  function isOnlineOnlyMode() {
    const mode = normalizeOperatingMode(configStore?.operatingMode, OPERATING_MODES.OFFLINE_FIRST);
    return mode === OPERATING_MODES.ONLINE_ONLY;
  }

  function isOnline() {
    return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  }

  function isRecentPull() {
    const baselineTs = sync?.lastInteractionPullAt?.value ?? sync?.lastPullAt?.value ?? null;
    if (!baselineTs) return false;
    const parsed = Date.parse(baselineTs);
    if (Number.isNaN(parsed)) return false;
    return Date.now() - parsed < stalenessMs;
  }

  async function runInteractionPull(triggerSource) {
    if (inFlight) {
      queuedWhileInFlight = true;
      return;
    }
    if (!isOnlineOnlyMode() || !isOnline()) return;
    if (isRecentPull()) return;
    if (typeof sync?.forcePull !== 'function') return;

    inFlight = true;
    let scopedCollections = null;
    if (typeof resolveCollectionsForRoute === 'function') {
      try {
        const resolved = resolveCollectionsForRoute(getRoutePathValue(), triggerSource);
        scopedCollections = normalizeCollectionScope(resolved);
      } catch (error) {
        console.warn(`[${logPrefix}] Failed to resolve route collections (${triggerSource}):`, error);
      }
    }

    try {
      const shouldUseScopedPull = hasScopedPullApi
        && Array.isArray(scopedCollections)
        && scopedCollections.length > 0;
      const result = shouldUseScopedPull
        ? await sync.forcePullCollections(scopedCollections)
        : await sync.forcePull();
      if (result?.ok === false) return;
      const nowIso = new Date().toISOString();
      lastInteractionPullAt.value = nowIso;
      if (sync?.lastInteractionPullAt) sync.lastInteractionPullAt.value = nowIso;
    } catch (error) {
      console.warn(`[${logPrefix}] Interaction pull failed (${triggerSource}):`, error);
    } finally {
      inFlight = false;
      if (queuedWhileInFlight) {
        queuedWhileInFlight = false;
        scheduleInteractionPull('queued');
      }
    }
  }

  function scheduleInteractionPull(reason = 'interaction') {
    if (!isOnlineOnlyMode() || !isOnline()) return;
    if (pullTimer) clearTimeout(pullTimer);
    pullTimer = setTimeout(() => {
      pullTimer = null;
      runInteractionPull(reason).catch(() => {});
    }, throttleMs);
  }

  function onWindowFocus() {
    scheduleInteractionPull('focus');
  }

  function onVisibilityChange() {
    if (typeof document === 'undefined') return;
    if (document.visibilityState !== 'visible') return;
    scheduleInteractionPull('visibility');
  }

  function onNetworkOnline() {
    scheduleInteractionPull('online');
  }

  function getRoutePathValue() {
    if (!routePathRef) return null;
    if (typeof routePathRef === 'function') return routePathRef();
    if (typeof routePathRef === 'object' && routePathRef !== null) {
      if ('value' in routePathRef) return routePathRef.value;
      if ('fullPath' in routePathRef) return routePathRef.fullPath;
    }
    return null;
  }

  watch(
    () => getRoutePathValue(),
    (nextPath, prevPath) => {
      if (!nextPath || nextPath === prevPath) return;
      scheduleInteractionPull('route-change');
    },
  );

  onMounted(() => {
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onWindowFocus);
      window.addEventListener('online', onNetworkOnline);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
  });

  onUnmounted(() => {
    if (pullTimer) {
      clearTimeout(pullTimer);
      pullTimer = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', onWindowFocus);
      window.removeEventListener('online', onNetworkOnline);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  });

  return {
    lastInteractionPullAt,
    scheduleInteractionPull,
  };
}
