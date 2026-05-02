/**
 * @file composables/sync/state.js
 * @description Shared singleton state for the Directus sync subsystem.
 *
 * All module-level mutable variables from useDirectusSync.js are centralised
 * here as properties of a single `syncState` object. Exporting a shared object
 * (rather than separate mutable primitives) is critical: ES-module imports are
 * live bindings, but imported bindings are read-only in the importing module.
 * That means exporting `_pushGeneration` as a standalone primitive would not
 * let other modules coordinate updates to it without additional setter APIs.
 * By keeping mutable state on a shared object, `syncState._pushGeneration++`
 * in any module updates the same singleton state observed by all importers.
 *
 * Risk 5 from the refactor plan: "primitives imported as
 * `import { _pushGeneration }` would not reflect post-import mutations."
 *
 * Extracted from useDirectusSync.js (§5.7 refactor).
 */

import { ref } from 'vue';

/**
 * Stable per-tab identifier included in BroadcastChannel messages so that the
 * follower `onmessage` handler can ignore messages that originated in the same
 * tab.  BroadcastChannel does not deliver a message back to the same
 * BroadcastChannel object that sent it (per the HTML spec), but this constant
 * provides defence-in-depth for role-transition edge cases and mirrors the
 * pattern already used in `store/persistence/syncLogs.js`.
 */
export const _SYNC_TAB_ID = Math.random().toString(36).slice(2);

/**
 * Singleton state container.  Never destructure this into local variables —
 * always access via `syncState.X` to preserve live binding semantics.
 */
export const syncState = {
  // ── Lifecycle ────────────────────────────────────────────────────────────────
  /** Whether the sync loops are currently active. */
  _running: false,

  // ── Push ─────────────────────────────────────────────────────────────────────
  /** Debounce timer handle for the push loop. */
  _pushTimer: null,
  /** In-flight push promise (de-duplication guard). */
  _pushInFlight: null,
  /**
   * AbortController for the currently in-flight drainQueue() call.  Aborted
   * (and replaced with null) whenever a push is invalidated via _onOffline(),
   * forcePush(), or stopSync(), causing the hung SDK fetch to throw AbortError
   * and halt the drain without incrementing any attempt counters.
   */
  _pushAbortController: null,
  /**
   * Monotonically increasing generation counter. Incremented for every push
   * attempt started by `_runPush()`, and also incremented whenever a previous
   * in-flight push must be invalidated (for example on offline, manual
   * forcePush override, or stopSync). The `_runPush` finally block only clears
   * `_pushInFlight` when the generation it captured at start still matches the
   * current value — this prevents a stale/hung push that resolved late from
   * nulling out a newer in-flight push.
   */
  _pushGeneration: 0,

  // ── Pull ─────────────────────────────────────────────────────────────────────
  /** Polling timer handle for the incremental pull loop. */
  _pollTimer: null,
  /**
   * S3 — In-flight pull promise.  If non-null, `_runPull()` returns this promise
   * instead of starting a second concurrent pull, preventing duplicate incremental
   * fetches during polling intervals or rapid `_onOnline` / WS-reconnect events.
   * Reset to `null` by `forcePull()` before starting an override pull.
   */
  _pullInFlight: null,
  /**
   * Monotonically-increasing generation counter for `_runPull()`.  Incremented
   * both when a new pull starts (`_runPull`) and when the semaphore is reset by
   * `forcePull()` or `stopSync()`.  The `finally` block of each pull compares
   * its captured `generation` snapshot against the current value so that a
   * superseded (aborted) pull never clears the newer pull's `_pullInFlight`.
   */
  _pullGeneration: 0,
  /**
   * NS4 — In-flight promise for the `table_merge_sessions` full-replace pull.
   * When a WS delete event fires multiple times in rapid succession, only the
   * first fires a new `_pullCollection(…, { forceFull: true })` call; subsequent
   * events await the same promise.  Reset to `null` in a `.finally()` callback.
   */
  _tableMergePullInFlight: null,
  /**
   * NS9 — In-flight promise for the immediate `order_items` pull triggered by a
   * WS `orders:create` event.  Deduplicates concurrent pulls when multiple
   * `orders:create` events arrive in rapid succession so that only one
   * `_pullCollection('order_items')` is in flight at a time.  Reset to `null`
   * in a `.finally()` callback.
   */
  _orderItemsPullInFlight: null,
  /**
   * NS9 — AbortController for the currently in-flight WS-triggered
   * `order_items` pull.  Aborted (and set to `null`) by `_runPull()`,
   * `forcePull()`, and `stopSync()` so that a stale WS-initiated pull cannot
   * finish after a newer scheduled pull has already written a fresher
   * `last_pull_ts`, which would otherwise roll that checkpoint backwards.
   */
  _orderItemsPullAbortController: null,
  /**
   * NS9 — Set to `true` once `order_items` has been fetched in the currently
   * running `_runPull()` cycle.  Reset to `false` at the start of each new
   * `_runPull()` invocation.
   *
   * Used by `_triggerImmediateOrderItemsPull()` to distinguish two cases when
   * `_pullInFlight` is set:
   *  - `false` → `order_items` is still ahead in the cycle; skip the NS9 pull
   *    (it will be covered by the running `_runPull()`).
   *  - `true`  → `order_items` was already processed; the current cycle will
   *    NOT include items from a new `orders:create` event, so the NS9 pull
   *    should proceed to ensure prompt delivery on the second device.
   */
  _pullOrderItemsDone: false,
  /**
   * NS9 — Set to `true` when a WS `orders:create` event arrives while
   * `_orderItemsPullInFlight` is already set (i.e. a pull is in progress).
   * The in-flight pull's `.finally()` checks this flag and re-triggers
   * `_triggerImmediateOrderItemsPull()` so that items committed on the server
   * after the first pull started are not missed until the next 30-second poll.
   * Cleared by `forcePull()`, `stopSync()`, and `_runPull()` (which covers
   * `order_items` as part of its full collection cycle).
   */
  _orderItemsPullPending: false,
  /**
   * NS8 — AbortController for the currently running `_runPull()` loop.
   * Replaced with a fresh controller at the start of each pull invocation.
   * Aborted (and set to `null`) by `forcePull()` and `stopSync()` so that the
   * pull loop exits cleanly between page fetches rather than continuing to hammer
   * Directus when a newer pull has already been requested.
   */
  _pullAbortController: null,

  // ── Global pull ───────────────────────────────────────────────────────────────
  /** Periodic timer handle for the global (venue config) pull. */
  _globalTimer: null,
  /**
   * Monotonically increasing counter incremented by each `_runGlobalPull` call
   * that proceeds past the online/config early-exit checks.  Each such invocation
   * captures its own value; before writing runtime config back to the store it
   * checks whether a **newer pull has already successfully applied** config in the
   * meantime and, if so, skips the (now stale) write.
   */
  _globalPullGeneration: 0,
  /** Tracks the most recently applied global pull generation to detect stale writes. */
  _lastAppliedGlobalPullGeneration: 0,
  /**
   * NS5 — In-flight promise for `_runGlobalPullInner()`.
   * Prevents concurrent global pulls from hammering the Directus `/items/venues`
   * endpoint when the periodic timer fires while a pull is already in progress.
   * Reset to `null` in a `.finally()` callback inside `_runGlobalPull()`.
   */
  _globalPullInFlight: null,

  // ── WebSocket ─────────────────────────────────────────────────────────────────
  /** Single debounced timer for WS reconnect — prevents overlapping reconnect attempts. */
  _reconnectTimer: null,
  /** Debounced short-delay push retry scheduled by _onOnline() to recover from brief post-reconnect instability. */
  _onlineRetryTimer: null,
  /**
   * S5 — Heartbeat watchdog timer handle.  Set by `_resetWsHeartbeat()` after
   * every incoming WS message and every WS connect.  Cleared and nulled by
   * `_stopSubscriptions()` and `_resetDirectusSyncSingleton()`.
   */
  _wsHeartbeatTimer: null,
  /** Whether we are currently connected via WebSocket. */
  _wsConnected: ref(false),

  // ── Leadership ────────────────────────────────────────────────────────────────
  /**
   * S1 — Whether this browser tab currently holds the "directus-sync-leader"
   * Web Lock and therefore runs push/pull loops.  Defaults to `true` so that
   * existing behaviour is preserved when Web Locks are not supported.
   */
  _isLeader: true,
  /**
   * S1 — Resolver that releases the held Web Lock.
   * Set by `_acquireLeaderLock()` when the lock is acquired; called by `stopSync()`
   * and `_resetDirectusSyncSingleton()` to relinquish the lock.
   */
  _leaderLockResolve: null,

  // ── External dependencies ─────────────────────────────────────────────────────
  /** @type {object|null} */
  _store: null,
  /**
   * NS6 — BroadcastChannel used to notify follower tabs that IDB data has changed.
   * Opened in `startSync()` when this tab becomes the leader; closed in `stopSync()`.
   * Follower tabs open the same channel and refresh their in-memory store on receipt.
   * @type {BroadcastChannel|null}
   */
  _idbChangeBroadcast: null,
  /** @type {'cassa'|'sala'|'cucina'} */
  _appType: 'cassa',
  /** Collections currently subscribed via WebSocket (populated on startSync). */
  _wsCollections: [],

  // ── Reactive public refs ──────────────────────────────────────────────────────
  syncStatus: ref(/** @type {'idle'|'syncing'|'error'|'offline'} */ ('idle')),
  lastPushAt: ref(/** @type {string|null} */ (null)),
  lastPullAt: ref(/** @type {string|null} */ (null)),

  // ── Telemetry ─────────────────────────────────────────────────────────────────
  /**
   * Count of unexpected WebSocket disconnections since the sync session started.
   * Incremented in `wsManager.js` whenever a subscription iterator throws (i.e.
   * the connection was lost unexpectedly rather than via `stopSync()`).
   */
  wsDropCount: ref(/** @type {number} */ (0)),
  /**
   * Current depth of the IDB `sync_queue` (pending push entries).
   * Updated in `pushQueue.js` after each `drainQueue()` call completes.
   */
  queueDepth: ref(/** @type {number} */ (0)),
  /**
   * ISO timestamp of the last fully-successful incremental pull cycle (all
   * collections OK, at least one page fetched without errors).
   * Updated in `pullQueue.js` at the end of `_runPull()` when `allOk` is true.
   */
  lastSuccessfulPull: ref(/** @type {string|null} */ (null)),
};

/**
 * Resets all singleton state back to initial values.
 * Intended for test isolation and other internal reset flows.
 * Preserves existing ref identity (does not replace the ref objects themselves,
 * only resets their `.value`) so that any Vue components that have already
 * destructured refs from `useDirectusSync()` continue to receive updates.
 */
export function resetSyncState() {
  // Lifecycle
  syncState._running = false;

  // Push
  syncState._pushTimer = null;
  syncState._pushInFlight = null;
  syncState._pushAbortController = null;
  syncState._pushGeneration = 0;

  // Pull
  syncState._pollTimer = null;
  syncState._pullInFlight = null;
  syncState._pullGeneration = 0;
  syncState._tableMergePullInFlight = null;
  syncState._orderItemsPullInFlight = null;
  syncState._orderItemsPullAbortController = null;
  syncState._orderItemsPullPending = false;
  syncState._pullOrderItemsDone = false;
  syncState._pullAbortController = null;

  // Global pull
  syncState._globalTimer = null;
  syncState._globalPullGeneration = 0;
  syncState._lastAppliedGlobalPullGeneration = 0;
  syncState._globalPullInFlight = null;

  // WebSocket
  syncState._reconnectTimer = null;
  syncState._onlineRetryTimer = null;
  syncState._wsHeartbeatTimer = null;
  syncState._wsConnected.value = false;

  // Leadership
  syncState._isLeader = true;
  syncState._leaderLockResolve = null;

  // External dependencies
  syncState._store = null;
  syncState._idbChangeBroadcast = null;
  syncState._appType = 'cassa';
  syncState._wsCollections = [];

  // Reactive refs
  syncState.syncStatus.value = 'idle';
  syncState.lastPushAt.value = null;
  syncState.lastPullAt.value = null;

  // Telemetry
  syncState.wsDropCount.value = 0;
  syncState.queueDepth.value = 0;
  syncState.lastSuccessfulPull.value = null;
}
