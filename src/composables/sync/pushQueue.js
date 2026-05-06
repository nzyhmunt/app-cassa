/**
 * @file composables/sync/pushQueue.js
 * @description Outbound sync queue drain logic for the Directus sync subsystem.
 *
 * Drains the local offline queue, registers pushed record IDs for echo
 * suppression, and updates reactive sync status.
 *
 * Extracted from useDirectusSync.js (§10 refactor).
 */

import { drainQueue, getPendingEntries } from '../useSyncQueue.js';
import { _getCfg } from './pullQueue.js';
import {
  ECHO_SUPPRESS_TTL_MS,
  ECHO_SUPPRESS_MAX_TTL_MS,
  ECHO_SUPPRESS_RTT_MULTIPLIER,
  _registerPushedEchoes,
} from './echoSuppression.js';
import { syncState } from './state.js';

/**
 * Drains the sync queue, sending all pending records to Directus.
 * Uses a per-push generation counter to detect preemption by `forcePush()`,
 * `_onOffline()`, or `stopSync()`.  A preempted push silently discards its
 * post-await side-effects so it cannot overwrite state set by the newer push.
 *
 * @returns {Promise<{pushed:number,failed:number,abandoned:number,pushedIds:Array<{collection:string,recordId:string}>,offline:boolean}>}
 */
export async function _runPush() {
  if (syncState._pushInFlight) {
    return syncState._pushInFlight;
  }
  // Clear the pending flag here so that items added during *this* drain
  // (between the guard above and drainQueue completion) are detected correctly
  // and trigger a follow-up rather than being swallowed by a stale flag.
  syncState._pushPending = false;
  // Advance and capture a new generation for this push attempt.  Every await
  // point is a potential preemption: if _onOffline(), forcePush(), or stopSync()
  // advance syncState._pushGeneration while this push is suspended on `await drainQueue()`,
  // the push becomes stale.  The invalidation path also aborts syncState._pushAbortController
  // which causes the hung SDK fetch to throw AbortError — _pushEntry returns
  // { aborted: true } and drainQueue() halts immediately (no sync_logs entry,
  // no attempt increments, offline: false).  All shared module state updates
  // (syncState.syncStatus, syncState.lastPushAt, _recentlyPushed) are still guarded by the generation
  // check so a superseded push cannot overwrite the state set by the newer push.
  const ac = new AbortController();
  syncState._pushAbortController = ac;
  const generation = ++syncState._pushGeneration;
  syncState._pushInFlight = (async () => {
    try {
      if (!navigator.onLine) {
        if (syncState._pushGeneration === generation) syncState.syncStatus.value = 'offline';
        return { pushed: 0, failed: 0, abandoned: 0, pushedIds: [], offline: true };
      }
      const cfg = _getCfg();
      if (!cfg) {
        if (syncState._pushGeneration === generation) syncState.syncStatus.value = 'idle';
        return {
          pushed: 0,
          failed: 0,
          abandoned: 0,
          pushedIds: [],
          offline: false,
          skippedReason: 'no-config',
        };
      }
      if (syncState._pushGeneration === generation) syncState.syncStatus.value = 'syncing';
      // S4: Measure push RTT to derive the adaptive echo suppression window.
      const pushStartMs = Date.now();
      const result = await drainQueue(cfg, ac.signal);
      const pushDurationMs = Date.now() - pushStartMs;
      // Guard all post-await side effects: by the time drainQueue() resolves
      // this push may have been superseded (offline/forcePush/stopSync).
      if (syncState._pushGeneration === generation) {
        if (result.pushed > 0 || result.abandoned > 0) {
          syncState.lastPushAt.value = new Date().toISOString();
        }
        // S4: Use an adaptive TTL — at least ECHO_SUPPRESS_TTL_MS but scaled to
        // ECHO_SUPPRESS_RTT_MULTIPLIER × the measured RTT so slow connections
        // (e.g. 3G) still suppress echoes reliably while fast LAN connections
        // keep the window tight.  Cap at ECHO_SUPPRESS_MAX_TTL_MS to avoid
        // blocking genuine cross-device updates.
        if (Array.isArray(result.pushedIds) && result.pushedIds.length > 0) {
          const adaptiveEchoTtl = Math.min(
            Math.max(ECHO_SUPPRESS_TTL_MS, pushDurationMs * ECHO_SUPPRESS_RTT_MULTIPLIER),
            ECHO_SUPPRESS_MAX_TTL_MS,
          );
          _registerPushedEchoes(result.pushedIds, adaptiveEchoTtl);
        }
        syncState.syncStatus.value = result.offline
          ? 'offline'
          : result.failed > 0 ? 'error' : 'idle';
        // Update queue depth telemetry after drain completes.
        // Best-effort: a failure here must not mask the drain result.
        getPendingEntries().then((entries) => {
          syncState.queueDepth.value = entries.length;
        }).catch((e) => {
          console.debug('[DirectusSync] queueDepth update failed (non-fatal):', e);
        });
      }
      return result;
    } catch (e) {
      if (syncState._pushGeneration === generation) {
        console.warn('[DirectusSync] Push error:', e);
        syncState.syncStatus.value = 'error';
      }
      return { pushed: 0, failed: 0, abandoned: 0, pushedIds: [], offline: false };
    } finally {
      if (syncState._pushGeneration === generation) {
        syncState._pushAbortController = null;
        syncState._pushInFlight = null;
        // If new items were enqueued while this drain was in-flight, start
        // another push immediately instead of waiting for the 30-second timer.
        // The navigator.onLine guard avoids a pointless offline-path retry loop;
        // _onOnline() will trigger the real drain when connectivity returns.
        if (syncState._pushPending && navigator.onLine) {
          syncState._pushPending = false;
          _runPush().catch(() => {});
        } else {
          syncState._pushPending = false;
        }
      }
    }
  })();
  return syncState._pushInFlight;
}
