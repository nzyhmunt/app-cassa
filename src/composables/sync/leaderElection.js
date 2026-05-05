/**
 * @file composables/sync/leaderElection.js
 * @description Web Lock leader election, sync lifecycle, and the public
 * `useDirectusSync()` composable factory.
 *
 * Responsibilities:
 *  - Leader election via Web Locks API (_acquireLeaderLock)
 *  - Start/stop of push/pull/WS loops (_startSyncLoopsAsLeader)
 *  - Online/offline event handlers (_onOnline, _onOffline)
 *  - Public composable factory (useDirectusSync)
 *  - Test reset helper (_resetDirectusSyncSingleton)
 *
 * Extracted from useDirectusSync.js (§11 refactor).
 */

import { appConfig, createRuntimeConfig, DEFAULT_SETTINGS } from '../../utils/index.js';
import { clearLocalConfigCacheFromIDB } from '../../store/persistence/config.js';
import { syncState, resetSyncState, _SYNC_TAB_ID } from './state.js';
import { PULL_CONFIG, GLOBAL_INTERVAL_MS } from './config.js';
import { _runPush } from './pushQueue.js';
import { _runPull } from './pullQueue.js';
import { _runGlobalPull, _hydrateConfigFromLocalCache } from './globalPull.js';
import { _startSubscriptions, _stopSubscriptions, _reconnectWs } from './wsManager.js';
import {
  _refreshStoreFromIDB,
  _refreshStoreConfigFromIDB,
  _applyDirectusRuntimeConfigToAppConfig,
  _emitProgress,
} from './storebridge.js';
import { _recentlyPushed } from './echoSuppression.js';

// ── Extracted leader body ─────────────────────────────────────────────────────

/**
 * NS2 — Extracted leader body.  Called both by `startSync()` (when this tab
 * immediately wins the leader lock) and by the standby lock callback (when a
 * previous leader tab closes and this tab is promoted automatically).
 */
async function _startSyncLoopsAsLeader() {
  const pullCfg = PULL_CONFIG[syncState._appType] ?? PULL_CONFIG.cassa;
  const venueId = appConfig.directus?.venueId ?? null;

  // Local-first: apply cached config snapshot from IDB before any remote call.
  try {
    await _hydrateConfigFromLocalCache(venueId);
  } catch (e) {
    console.warn(`[DirectusSync] WARN: Fallback to remote sync after local cache hydration failed for venue ${String(venueId)}:`, e);
  }

  // Initial push + deep global config pull
  _runPush().catch(() => {});
  _runGlobalPull().catch(() => {});

  // Push loop: retry every 30 s when online
  syncState._pushTimer = setInterval(() => _runPush().catch(() => {}), 30_000);

  // Global config pull: every 5 minutes
  syncState._globalTimer = setInterval(() => _runGlobalPull().catch(() => {}), GLOBAL_INTERVAL_MS);

  // WebSocket subscriptions are opt-in (wsEnabled must be explicitly true).
  // When disabled, fall back to periodic polling from the start.
  const wsEnabled = appConfig.directus?.wsEnabled === true;
  // When menu data comes from a local JSON file, exclude menu_items from WebSocket
  // subscriptions to avoid unnecessary subscription traffic and IDB fan-out.
  const menuSource = appConfig.menuSource ?? 'directus';
  const wsCollections = menuSource === 'json'
    ? pullCfg.collections.filter(c => c !== 'menu_items')
    : pullCfg.collections;
  // Persist the last computed collection list at module level; reconnect logic
  // recomputes the effective list from the current appConfig when reconnecting.
  syncState._wsCollections = wsCollections;

  if (wsEnabled) {
    // Try WebSocket subscriptions; fall back to polling if connect fails
    const subscribed = await _startSubscriptions(wsCollections);
    if (!subscribed) {
      _runPull().catch(() => {});
      syncState._pollTimer = setInterval(() => _runPull().catch(() => {}), pullCfg.intervalMs);
    } else {
      // Even with WebSocket active, run an initial REST pull to catch updates
      // missed between the last session and now, and arm the periodic poll timer
      // as a belt-and-suspenders safety net.  WS events can be silently dropped
      // when the device screen locks, the OS suspends the tab, or the TCP
      // connection becomes half-open without emitting an error.  The poll cycle
      // ensures cross-device consistency converges within at most one interval
      // even when a WS push is never delivered.
      _runPull().catch(() => {});
      syncState._pollTimer = setInterval(() => _runPull().catch(() => {}), pullCfg.intervalMs);
    }
  } else {
    // WebSocket disabled — use REST polling only
    _runPull().catch(() => {});
    syncState._pollTimer = setInterval(() => _runPull().catch(() => {}), pullCfg.intervalMs);
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', _onOnline);
    window.addEventListener('offline', _onOffline);
    window.addEventListener('sync-queue:enqueue', _onQueueEnqueue);
  }
  // Trigger an immediate catch-up pull whenever the page transitions from hidden
  // to visible (device unlocked, app brought to foreground).  The periodic poll
  // timer is frozen by the browser while the tab is backgrounded, so this
  // listener fills the gap by running a pull as soon as the user returns.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', _onVisibilityChange);
  }
  // Listen for pull-requested messages from follower tabs that became visible
  // while this (leader) tab was hidden.  When a follower comes to the foreground
  // it cannot run its own pull, so it posts this message to ask the leader to
  // do it.  Uses addEventListener (not onmessage) so this handler stacks on top
  // of any future BroadcastChannel listeners without clobbering them.
  if (syncState._idbChangeBroadcast) {
    syncState._idbChangeBroadcast.addEventListener('message', _onLeaderChannelMessage);
  }
  // PWA Background Sync: listen for messages from the service worker so that
  // background sync events (fired while the app was backgrounded/closed) can
  // trigger a push drain on the leader tab when the device reconnects.
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', _onSwMessage);
  }
}

/**
 * S1 — Attempts to acquire the exclusive "directus-sync-leader" Web Lock.
 *
 * Returns `true` when this tab becomes the sync leader (or when Web Locks are
 * not supported — both tabs then behave as independent leaders, matching the
 * pre-S1 behaviour).  Returns `false` when another tab already holds the lock.
 *
 * When the lock is acquired it is held in the background (by awaiting an
 * internal Promise) until `stopSync()` calls the resolver, effectively keeping
 * this tab as leader for the entire lifetime of its sync session.  When the
 * leader tab is closed or calls `stopSync()` the lock is released automatically
 * and the next tab that calls `startSync()` will win the election.
 *
 * NS2: A queued (blocking) standby request is registered when this tab is a
 * follower.  When the leader tab closes, the standby fires automatically and
 * promotes this tab to leader by calling `_startSyncLoopsAsLeader()` — no user
 * action or page reload required.
 */
async function _acquireLeaderLock() {
  // Web Locks not supported — every tab is its own leader (pre-S1 behaviour).
  if (typeof navigator === 'undefined' || !navigator.locks) {
    console.debug('[DirectusSync] Web Locks API not available — all tabs will run sync independently.');
    return true;
  }
  return new Promise((resolveAcquire) => {
    // First attempt: acquire immediately without queuing.
    navigator.locks.request(
      'directus-sync-leader',
      { mode: 'exclusive', ifAvailable: true },
      async (lock) => {
        if (!lock) {
          // Lock not immediately available — this tab is a follower for now.
          // NS2: Register a queued (blocking) standby request so that when the
          // current leader tab is closed (or calls stopSync), this tab is
          // automatically promoted to leader without requiring a reload.
          resolveAcquire(false);
          let resolveStandbyHold;
          const standbyHold = new Promise((res) => { resolveStandbyHold = res; });
          syncState._leaderLockResolve = resolveStandbyHold;
          navigator.locks.request(
            'directus-sync-leader',
            { mode: 'exclusive' },
            async () => {
              // Promoted to leader — start sync loops if still running.
              if (syncState._running) {
                syncState._isLeader = true;
                // Clear the follower onmessage handler now that this tab is the
                // leader.  The leader posts on this channel but must not receive
                // its own broadcasts (which would trigger a refresh→broadcast loop).
                if (syncState._idbChangeBroadcast) syncState._idbChangeBroadcast.onmessage = null;
                // Remove the follower's visibilitychange delegate listener — the
                // leader registers its own _onVisibilityChange in
                // _startSyncLoopsAsLeader() below.
                if (typeof document !== 'undefined') {
                  document.removeEventListener('visibilitychange', _onFollowerVisibilityChange);
                }
                await _startSyncLoopsAsLeader();
              }
              await standbyHold;
            },
          ).catch(() => {});
          return;
        }
        // This tab won the election immediately.
        let resolveHold;
        const holdPromise = new Promise((res) => { resolveHold = res; });
        syncState._leaderLockResolve = resolveHold;
        resolveAcquire(true);
        await holdPromise;
      },
    ).catch(() => {
      // Web Locks request rejected (e.g. opaque origin) — assume leader.
      if (syncState._leaderLockResolve) { syncState._leaderLockResolve = null; }
      resolveAcquire(true);
    });
  });
}

// ── Pull cancellation helpers ─────────────────────────────────────────────────

/**
 * Cancels all active pull operations in a single consistent sweep.
 *
 * Aborts and nulls every AbortController / semaphore used by the four
 * concurrent pull types (incremental pull, NS9 order-items, NS4 TMS
 * full-replace, NS5 global config), then bumps the generation counters that
 * guard `_runPull` / `_runGlobalPullInner` against stale late-arriving
 * responses.
 *
 * Called by `_onOffline()`, `stopSync()`, and `_resetDirectusSyncSingleton()`
 * so there is exactly one place to update when a new pull slot is added.
 */
function cancelAllPulls() {
  // NS8: Abort any in-flight _runPull() so the collection loop exits cleanly.
  syncState._pullAbortController?.abort();
  syncState._pullAbortController = null;
  syncState._pullInFlight = null;
  syncState._pullGeneration++;
  // NS9: Abort any in-flight WS-triggered order_items pull.  A hanging fetch
  // would hold _orderItemsPullInFlight indefinitely and block every subsequent
  // orders:create trigger.  Clearing the pending flag prevents the .finally()
  // from immediately restarting a pull while the app is offline / stopped.
  syncState._orderItemsPullAbortController?.abort();
  syncState._orderItemsPullAbortController = null;
  syncState._orderItemsPullInFlight = null;
  syncState._orderItemsPullPending = false;
  // NS4: Abort any in-flight table_merge_sessions full-replace pull.  The
  // AbortController causes _pullCollection to discard any HTTP response that
  // arrives after going offline, preventing a stale snapshot from overwriting
  // a fresh post-reconnect replace.
  syncState._tableMergeAbortController?.abort();
  syncState._tableMergeAbortController = null;
  syncState._tableMergePullInFlight = null;
  // NS5: Release the global config dedup semaphore and bump the
  // offline-generation counter.  _runGlobalPullInner captures this counter on
  // entry (myOfflineGen); a higher value after HTTP response arrival means the
  // network dropped or sync was torn down, so the pull skips both the IDB
  // fan-out write and the config-apply step.
  syncState._globalPullOfflineGeneration++;
  syncState._globalPullInFlight = null;
}

// ── Online/offline listeners ──────────────────────────────────────────────────

function _onOffline() {
  // Immediately reflect the offline state on the WS indicator.  The Directus
  // SDK may continue its internal reconnect retry loop for up to ~20 s before
  // the subscription iterator throws, so without this listener the indicator
  // would stay "connected" even though no WS traffic can flow.
  syncState._wsConnected.value = false;
  // Cancel any pending reconnect timer — the reconnect will be rescheduled
  // by _onOnline() once the network is restored.
  if (syncState._reconnectTimer) { clearTimeout(syncState._reconnectTimer); syncState._reconnectTimer = null; }
  // Cancel any pending delayed push retry so it doesn't fire if the device
  // went offline again before the 5-second window elapsed.
  if (syncState._onlineRetryTimer) { clearTimeout(syncState._onlineRetryTimer); syncState._onlineRetryTimer = null; }
  // Invalidate any in-flight push.  When the network drops, the underlying
  // fetch() inside sdkClient.request() can hang indefinitely waiting for a TCP
  // timeout (typically 10-20+ minutes).  Aborting syncState._pushAbortController causes
  // the SDK fetch to throw AbortError immediately, which drainQueue treats as a
  // caller-initiated abort and uses to stop the drain cleanly without marking
  // the result as offline or incrementing attempts.
  // Clearing syncState._pushInFlight and advancing syncState._pushGeneration then ensures the next
  // _runPush() call (from _onOnline()) starts a completely fresh push rather
  // than waiting on the hung promise or running a second concurrent drain.
  syncState._pushAbortController?.abort();
  syncState._pushAbortController = null;
  syncState._pushGeneration++;
  syncState._pushInFlight = null;
  // Abort all four concurrent pull types in one call; see cancelAllPulls() for
  // the full rationale behind each abort.
  cancelAllPulls();
  // If an in-flight push had already set syncState.syncStatus to "syncing", the
  // generation bump above causes that superseded _runPush() to skip its
  // post-await status update.  Reflect the offline state here so the UI
  // cannot remain stuck showing "syncing" while the app is offline.
  if (syncState._running) { syncState.syncStatus.value = 'offline'; }
}

/**
 * Schedules a 5-second retry push after an online reconnect push failed.
 * Re-schedules itself as long as the device remains online and sync is
 * running so that the queue drains as soon as Directus becomes reachable
 * again (e.g. while DHCP / DNS is still settling after reconnect).
 * Cancelled by `_onOffline`, `stopSync`, or a new `_onOnline` event.
 */
function _scheduleOnlineRetry() {
  if (syncState._onlineRetryTimer) { clearTimeout(syncState._onlineRetryTimer); }
  syncState._onlineRetryTimer = setTimeout(() => {
    syncState._onlineRetryTimer = null;
    if (!syncState._running || !navigator.onLine) return;
    // Capture the generation that _runPush() will assign synchronously.  Since
    // _runPush() increments syncState._pushGeneration before its first await, reading
    // syncState._pushGeneration immediately after the call gives the generation used by
    // this specific push attempt.  If syncState._pushGeneration is subsequently advanced
    // (offline/forcePush/stopSync), the result belongs to a superseded attempt
    // and must not re-schedule a retry for the new online cycle.
    const retryPush = _runPush();
    const genAtStart = syncState._pushGeneration;
    retryPush.then((result) => {
      if (result?.offline && syncState._running && navigator.onLine && syncState._pushGeneration === genAtStart) {
        _scheduleOnlineRetry();
      }
    }).catch(() => {});
  }, 5_000);
}

function _onOnline() {
  // Clear any stale retry timer from a previous online/offline cycle.
  if (syncState._onlineRetryTimer) { clearTimeout(syncState._onlineRetryTimer); syncState._onlineRetryTimer = null; }
  // Immediate push attempt: when the network is already stable the queue drains
  // here and no retry is needed.  Only schedule the 5 s follow-up when the push
  // reports an offline/network failure (e.g. DHCP still settling) AND the
  // device is still online when the result arrives — this avoids a redundant
  // drainQueue() cycle on every reconnect when the first push already succeeded.
  // Also clear any timer already set by a concurrent push from a rapid second
  // 'online' event so only the most recent push's retry is scheduled.
  // If the retry also fails, _scheduleOnlineRetry() reschedules itself every
  // 5 s until the push succeeds, the device goes offline, or stopSync() is called.
  // Capture the generation that _runPush() assigns synchronously (it increments
  // syncState._pushGeneration before its first await).  If syncState._pushGeneration is subsequently
  // advanced (offline/forcePush/stopSync), the result belongs to a superseded
  // attempt and must not schedule a retry for the new online cycle.
  const onlinePush = _runPush();
  const genAtStart = syncState._pushGeneration;
  onlinePush.then((result) => {
    if (result?.offline && syncState._running && navigator.onLine && syncState._pushGeneration === genAtStart) {
      _scheduleOnlineRetry();
    }
  }).catch(() => {});
  _runPull().catch(() => {});
  // If WebSocket was enabled but is currently disconnected, attempt to reconnect.
  if (appConfig.directus?.wsEnabled === true && !syncState._wsConnected.value && syncState._running) {
    _reconnectWs().catch(() => {});
  }
}

function _onQueueEnqueue() {
  _runPush().catch(() => {});
}

/**
 * Handles document `visibilitychange` events for the **leader** tab.
 *
 * When the page transitions from hidden → visible (device unlocked, PWA brought
 * to foreground) the browser may have suspended or silently dropped the
 * WebSocket connection, and the periodic `_pollTimer` interval was frozen for
 * the duration of the hidden period.  Triggering an immediate REST pull as soon
 * as the user returns ensures cross-device updates appear within a few seconds
 * of the device becoming active again, regardless of the WS state.
 *
 * Additionally, if WebSocket is enabled but reports as disconnected, a
 * reconnect attempt is started so the subscription resumes promptly.
 */
function _onVisibilityChange() {
  if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
  if (!syncState._running) return;
  _runPull().catch(() => {});
  if (appConfig.directus?.wsEnabled === true && !syncState._wsConnected.value) {
    _reconnectWs().catch(() => {});
  }
}

/**
 * Handles document `visibilitychange` events for **follower** tabs.
 *
 * The leader tab's `setInterval` timers are frozen by the browser while it is
 * backgrounded.  If the leader is hidden and a follower tab is brought to the
 * foreground, neither the leader's `_pollTimer` nor the leader's own
 * `_onVisibilityChange` will fire — leaving the visible follower stale until
 * the leader tab itself becomes visible.
 *
 * This handler lets the follower delegate the catch-up to the leader: when the
 * follower becomes visible it broadcasts a `pull-requested` message over the
 * existing `_idbChangeBroadcast` BroadcastChannel.  The leader listens for
 * this message via `_onLeaderChannelMessage` and responds by running a pull.
 */
function _onFollowerVisibilityChange() {
  if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
  if (!syncState._running || syncState._isLeader) return;
  // Include sourceId so the leader (and any future diagnostic tooling) can
  // correlate which follower tab triggered the pull request.
  // _SYNC_TAB_ID is a per-module-instance random string defined in state.js
  // that uniquely identifies this browser tab for the lifetime of the session.
  syncState._idbChangeBroadcast?.postMessage({ type: 'pull-requested', sourceId: _SYNC_TAB_ID });
}
export { _onFollowerVisibilityChange };

/**
 * Handles BroadcastChannel messages received by the **leader** tab.
 *
 * Currently only handles `type: 'pull-requested'` — posted by follower tabs
 * when they transition from hidden to visible and want the leader to run a
 * catch-up REST pull on their behalf (because the leader's own poll timer may
 * be frozen while it is in the background).
 */
function _onLeaderChannelMessage(event) {
  if (event?.data?.type !== 'pull-requested') return;
  if (!syncState._running || !syncState._isLeader) return;
  _runPull().catch(() => {});
}
export { _onLeaderChannelMessage };

/**
 * PWA Background Sync: handles the 'bg-sync:drain-queue' message posted by
 * the service worker when a background sync fires (device came back online
 * while the user had closed or backgrounded the app).  Only the leader tab
 * should drain the queue; followers ignore this message because _runPush() is
 * managed exclusively by the leader.
 */
function _onSwMessage(event) {
  if (event?.data?.type !== 'bg-sync:drain-queue') return;
  if (!syncState._isLeader) return;
  _runPush().catch(() => {});
}

// ── Public composable ─────────────────────────────────────────────────────────

/**
 * Bidirectional Directus sync composable.
 *
 * Returns reactive refs and control methods.  The same singleton instance is
 * shared across all composable calls in the same module scope.
 */
export function useDirectusSync() {
  /**
   * Starts the push loop, WebSocket subscriptions (with polling fallback), and
   * global config pull.
   *
   * @param {{ appType: 'cassa'|'sala'|'cucina', store: object }} opts
   */
  async function startSync({ appType, store }) {
    if (syncState._running) return;
    if (!appConfig.directus?.enabled) return;

    syncState._appType = appType ?? 'cassa';
    syncState._store = store;
    syncState._running = true;

    // NS6: Open BroadcastChannel for cross-tab IDB-change notifications.
    // Both leaders and followers open the channel so followers can react to
    // IDB writes made by the leader and keep their in-memory store in sync.
    if (typeof BroadcastChannel !== 'undefined') {
      syncState._idbChangeBroadcast = new BroadcastChannel('directus-sync-idb-changes');
    }

    // S1: Leader election via Web Locks API.
    // Only one browser tab should run push/pull loops at a time — concurrent
    // loops from multiple tabs hammer Directus with duplicate requests and can
    // cause race conditions in IDB writes.  `_acquireLeaderLock()` tries to
    // claim the exclusive "directus-sync-leader" lock; if another tab already
    // holds it this call returns false and startSync() exits early.
    // Falls back to `true` (every tab is a leader) when Web Locks are unsupported.
    // NS2: `_acquireLeaderLock()` now also registers a standby lock request
    // in the background, so when the leader tab closes this tab is promoted
    // automatically without requiring a reload.
    const isLeader = await _acquireLeaderLock();
    if (!isLeader) {
      // NS2: Keep syncState._running = true so that the standby lock callback in
      // `_acquireLeaderLock` can call `_startSyncLoopsAsLeader` when promoted.
      // Mark this tab as a follower so _emitProgress / storebridge never broadcast
      // idb-change messages from the follower side (which would cause broadcast loops).
      syncState._isLeader = false;
      console.info('[DirectusSync] Non-leader tab: push/pull loops managed by another tab.');
      // NS6: Listen for leader's IDB-change broadcasts and refresh in-memory store.
      if (syncState._idbChangeBroadcast) {
        syncState._idbChangeBroadcast.onmessage = ({ data }) => {
          if (data?.type !== 'idb-change') return;
          // Defence-in-depth: ignore broadcasts that this tab sent itself.
          // (BroadcastChannel spec already prevents same-object delivery, but
          // this guard protects against role-transition race windows.)
          if (data?.sourceId === _SYNC_TAB_ID) return;
          const col = data.collection ?? null;
          if (col === 'config') {
            _refreshStoreConfigFromIDB({
              menuSource: appConfig.menuSource,
              menuUrl: appConfig.menuUrl,
            }).catch(() => {});
          } else {
            // Reconstruct ids Set from the broadcast array (Sets are not serializable).
            const ids = Array.isArray(data.ids) && data.ids.length > 0
              ? new Set(data.ids)
              : null;
            _refreshStoreFromIDB(col, ids).catch(() => {});
          }
        };
      }
      // When this follower tab becomes visible while the leader is backgrounded,
      // the leader's poll timers are frozen by the browser.  Broadcast a
      // pull-requested message so the leader runs a catch-up REST pull on behalf
      // of this visible tab.
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', _onFollowerVisibilityChange);
      }
      return;
    }
    syncState._isLeader = true;
    await _startSyncLoopsAsLeader();
  }

  function stopSync() {
    syncState._running = false;
    syncState._store = null;
    // Abort any in-flight push and advance the generation so any push started
    // before stopSync() does not clear a new syncState._pushInFlight that might be
    // created after the next startSync() call.  The AbortController abort causes
    // the SDK fetch to throw AbortError so the drain halts immediately without
    // corrupting the queue.
    syncState._pushAbortController?.abort();
    syncState._pushAbortController = null;
    syncState._pushGeneration++;
    syncState._pushInFlight = null;
    // Abort all four concurrent pull types in one call; see cancelAllPulls() for
    // the full rationale behind each abort and generation-counter increment.
    cancelAllPulls();
    if (syncState._pushTimer) { clearInterval(syncState._pushTimer); syncState._pushTimer = null; }
    if (syncState._pollTimer) { clearInterval(syncState._pollTimer); syncState._pollTimer = null; }
    if (syncState._globalTimer) { clearInterval(syncState._globalTimer); syncState._globalTimer = null; }
    if (syncState._reconnectTimer) { clearTimeout(syncState._reconnectTimer); syncState._reconnectTimer = null; }
    if (syncState._onlineRetryTimer) { clearTimeout(syncState._onlineRetryTimer); syncState._onlineRetryTimer = null; }
    _stopSubscriptions();
    // S1: Release the Web Lock so another tab can become the leader.
    if (syncState._leaderLockResolve) { syncState._leaderLockResolve(); syncState._leaderLockResolve = null; }
    syncState._isLeader = true;
    // NS6: Close the BroadcastChannel.
    // Explicitly remove the leader message listener before close() so the
    // handler cannot fire in the narrow window between the close() call and
    // the channel becoming inert.
    if (syncState._idbChangeBroadcast) {
      syncState._idbChangeBroadcast.removeEventListener('message', _onLeaderChannelMessage);
      syncState._idbChangeBroadcast.close();
      syncState._idbChangeBroadcast = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', _onOnline);
      window.removeEventListener('offline', _onOffline);
      window.removeEventListener('sync-queue:enqueue', _onQueueEnqueue);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', _onVisibilityChange);
      document.removeEventListener('visibilitychange', _onFollowerVisibilityChange);
    }
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.removeEventListener('message', _onSwMessage);
    }
    syncState.syncStatus.value = 'idle';
  }

  /**
   * Manually triggers a full push drain of the sync queue.
   * @returns {Promise<{
   *   pushed: number,
   *   failed: number,
   *   abandoned: number,
   *   pushedIds: Array<{ collection: string, recordId: string }>,
   *   offline: boolean,
   *   skippedReason?: 'no-config' | 'disabled',
   * }>}
   */
  async function forcePush() {
    if (!appConfig.directus?.enabled) return { pushed: 0, failed: 0, abandoned: 0, pushedIds: [], offline: false, skippedReason: 'disabled' };
    // Abort any in-flight push and start fresh. This handles both the
    // "push is stuck on a hung fetch (TCP timeout)" case and the more benign
    // "push is already running" case: aborting the AbortController cancels the
    // current drain immediately, returning the caller-initiated cancellation
    // path (aborted: true) without marking the client offline, incrementing
    // attempt counters, or leaving a second concurrent drain running in parallel.
    syncState._pushAbortController?.abort();
    syncState._pushAbortController = null;
    syncState._pushGeneration++;
    syncState._pushInFlight = null;
    return _runPush();
  }

  async function forcePull() {
    if (!appConfig.directus?.enabled) return { ok: true, failedCollections: [] };
    // NS8: Abort any in-flight pull so the loop exits cleanly between collections
    // before starting the new user-initiated pull.
    syncState._pullAbortController?.abort();
    syncState._pullAbortController = null;
    // NS9: Abort any in-flight WS-triggered order_items pull so it cannot write a
    // stale last_pull_ts after the new forcePull() cycle commits a fresher checkpoint.
    syncState._orderItemsPullAbortController?.abort();
    syncState._orderItemsPullAbortController = null;
    // S3: Reset the in-flight semaphore so this user-initiated pull is not
    // silently deduped against a concurrent background pull.
    syncState._pullInFlight = null;
    syncState._pullGeneration++;
    syncState._orderItemsPullInFlight = null;
    // NS9: Clear pending flag — forcePull() will cover order_items as part of
    // its full collection cycle, so no follow-up NS9 pull is needed.
    syncState._orderItemsPullPending = false;
    syncState.syncStatus.value = 'syncing';
    try {
      const result = await _runPull();
      if (result?.aborted) {
        // Pull was cancelled by stopSync() / a superseding forcePull() — whoever
        // called abort() already updated syncStatus; don't overwrite it here.
      } else if (result?.ok !== false) {
        syncState.syncStatus.value = 'idle';
      } else if (result?.skippedReason === 'offline') {
        syncState.syncStatus.value = 'offline';
      } else {
        syncState.syncStatus.value = 'error';
      }
      return result;
    } catch (e) {
      syncState.syncStatus.value = 'error';
      console.warn('forcePull failed unexpectedly', e);
      return {
        ok: false,
        failedCollections: [],
        ...(e && typeof e === 'object' && 'skippedReason' in e ? { skippedReason: e.skippedReason } : {}),
        ...(e instanceof Error ? { message: e.message } : {}),
        error: e,
      };
    }
  }

  /**
   * Applies a fresh Directus configuration snapshot with an optional local cache wipe.
   * Intended for explicit post-save reconfiguration from the settings UI.
   *
   * @param {{ clearLocalConfig?: boolean, onProgress?: Function }} [opts]
   * @returns {Promise<{ ok: boolean, failedCollections: string[] }>}
   */
  async function reconfigureAndApply({
    clearLocalConfig = false,
    onProgress = null,
  } = {}) {
    if (!appConfig.directus?.enabled) {
      const result = { ok: false, failedCollections: [] };
      _emitProgress(onProgress, {
        level: 'error',
        message: 'Sincronizzazione Directus disabilitata: impossibile applicare la configurazione.',
      });
      return result;
    }

    syncState.syncStatus.value = 'syncing';
    try {
      // Immediately invalidate any in-flight background global pull so its HTTP
      // response cannot overwrite this user-initiated pull with a stale
      // venue/config snapshot — even during the async clearLocalConfig work below.
      syncState._globalPullReconfigGeneration++;

      if (clearLocalConfig) {
        _emitProgress(onProgress, { level: 'info', message: 'Svuotamento completo cache configurazione locale…' });
        await clearLocalConfigCacheFromIDB();
        const preservedDirectus = JSON.parse(JSON.stringify(appConfig.directus ?? {}));
        _applyDirectusRuntimeConfigToAppConfig(createRuntimeConfig(DEFAULT_SETTINGS), {
          preservedDirectus,
        });
        await _refreshStoreConfigFromIDB({
          menuSource: appConfig.menuSource,
          menuUrl: appConfig.menuUrl,
        });
        _emitProgress(onProgress, { level: 'info', message: 'Cache configurazione locale svuotata.' });
      }

      // Reset the NS5 in-flight semaphore so this user-initiated pull always
      // starts a fresh fetch with the correct onProgress callback rather than
      // reusing a background pull that lacks it (including any pull that may
      // have started during the clearLocalConfig async work above).
      syncState._globalPullInFlight = null;
      const result = await _runGlobalPull({ onProgress, userInitiated: true });
      // Only update syncStatus when we are still in a non-offline state;
      // if _onOffline() fired while the pull was running it already set
      // syncStatus to 'offline' and we must not overwrite that with 'idle'.
      if (syncState.syncStatus.value !== 'offline') {
        syncState.syncStatus.value = result?.ok ? 'idle' : 'error';
      }
      return result ?? { ok: false, failedCollections: [] };
    } catch (e) {
      syncState.syncStatus.value = 'error';
      _emitProgress(onProgress, {
        level: 'error',
        message: 'Errore durante la procedura di applicazione configurazione.',
        details: String(e?.message ?? e),
      });
      return { ok: false, failedCollections: [] };
    }
  }

  /**
   * Exposes the internal `_reconnectWs` function so callers (e.g. swipe-down
   * refresh) can actively trigger a WebSocket reconnect attempt.  No-ops when
   * sync is not running, WS is already connected, or WS is disabled.
   *
   * @returns {Promise<void>}
   */
  function reconnectWs() {
    return _reconnectWs();
  }

  return {
    syncStatus: syncState.syncStatus,
    lastPushAt: syncState.lastPushAt,
    lastPullAt: syncState.lastPullAt,
    wsConnected: syncState._wsConnected,
    wsDropCount: syncState.wsDropCount,
    queueDepth: syncState.queueDepth,
    lastSuccessfulPull: syncState.lastSuccessfulPull,
    startSync,
    stopSync,
    forcePush,
    forcePull,
    reconfigureAndApply,
    reconnectWs,
  };
}

// ── Test helpers ──────────────────────────────────────────────────────────────

/**
 * @internal For test isolation only.
 */
export function _resetDirectusSyncSingleton() {
  // Abort in-flight async operations before resetting their handles.
  // Push must be aborted explicitly (cancelAllPulls covers only pull slots).
  syncState._pushAbortController?.abort();
  // Abort all four concurrent pull types and bump generation counters so any
  // in-transit response from the previous test discards its IDB write;
  // resetSyncState() will zero out the handles afterwards.
  cancelAllPulls();

  // Clear all timer handles before resetSyncState() nulls them out.
  if (syncState._pushTimer) { clearInterval(syncState._pushTimer); }
  if (syncState._pollTimer) { clearInterval(syncState._pollTimer); }
  if (syncState._globalTimer) { clearInterval(syncState._globalTimer); }
  if (syncState._reconnectTimer) { clearTimeout(syncState._reconnectTimer); }
  if (syncState._onlineRetryTimer) { clearTimeout(syncState._onlineRetryTimer); }
  // S5: Clear heartbeat watchdog.
  if (syncState._wsHeartbeatTimer) { clearTimeout(syncState._wsHeartbeatTimer); }

  // Stop WS subscriptions and clear the echo-suppression registry.
  _stopSubscriptions();
  _recentlyPushed.clear();

  // S1: Release the Web Lock.
  if (syncState._leaderLockResolve) { syncState._leaderLockResolve(); }

  // NS6: Close the BroadcastChannel.
  // Explicitly remove the leader message listener before close() so the
  // handler cannot fire in the narrow window between the close() call and
  // the channel becoming inert.
  if (syncState._idbChangeBroadcast) {
    syncState._idbChangeBroadcast.removeEventListener('message', _onLeaderChannelMessage);
    syncState._idbChangeBroadcast.close();
  }

  // Remove window event listeners.
  if (typeof window !== 'undefined') {
    window.removeEventListener('online', _onOnline);
    window.removeEventListener('offline', _onOffline);
    window.removeEventListener('sync-queue:enqueue', _onQueueEnqueue);
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', _onVisibilityChange);
    document.removeEventListener('visibilitychange', _onFollowerVisibilityChange);
  }
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.removeEventListener('message', _onSwMessage);
  }

  // Reset all syncState fields to their initial values (single source of truth).
  resetSyncState();
}
