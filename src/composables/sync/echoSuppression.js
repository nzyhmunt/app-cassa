/**
 * @file composables/sync/echoSuppression.js
 * @description Self-echo suppression for the Directus sync subsystem.
 *
 * After a local push is sent to Directus, the server echoes the same records
 * back via WebSocket subscriptions.  This module tracks recently-pushed records
 * in a TTL map so that `_handleSubscriptionMessage` can filter them out and
 * avoid redundant IDB writes and transient UI rewrites.
 *
 * Extracted from useDirectusSync.js (§5.7 refactor).
 */

/**
 * TTL for self-echo suppression entries (ms).
 * 5 s covers typical push → WS echo round-trip time (< 1 s on LAN) with a
 * comfortable margin for slow connections (3G / congested Wi-Fi) while keeping
 * the suppression window short enough to allow genuine cross-device updates
 * that arrive shortly after a push to pass through correctly.
 * Reduce only if sub-second cross-device echo conflicts are observed.
 */
export const ECHO_SUPPRESS_TTL_MS = 5_000;

/**
 * S4 — Maximum TTL cap for adaptive echo suppression.
 * Even on very slow connections (high RTT) the suppression window is capped at
 * 30 s to prevent genuine cross-device updates from being indefinitely blocked.
 */
export const ECHO_SUPPRESS_MAX_TTL_MS = 30_000;

/**
 * S4 — Multiplier applied to the measured push RTT to compute the adaptive
 * echo suppression window.  3× gives a comfortable margin: at 1 s RTT (LAN)
 * the window stays at the 5 s floor; at 3 s RTT (3G) it grows to 9 s.
 */
export const ECHO_SUPPRESS_RTT_MULTIPLIER = 3;

/**
 * S5 — Heartbeat watchdog interval (ms).
 * If no WebSocket subscription event is received for this duration, a REST
 * catch-up pull is triggered as a safety net for messages that may have been
 * missed while the connection was idle.  After WS_HEARTBEAT_STALE_COUNT
 * consecutive fires without a real WS event, the watchdog concludes the socket
 * is likely half-open and triggers a reconnect (see wsManager._resetWsHeartbeat
 * for full rationale).  Genuine failures are also detected when the subscription
 * iterator throws.
 *
 * Note: Directus WebSocket protocol-level pings are handled transparently by
 * the browser and never surface as application-level subscription iterator
 * yields, so an idle subscription is always silent at the JS level.
 */
export const WS_HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * S5 — Number of consecutive heartbeat fires (without a real WS subscription
 * event resetting the timer) before the watchdog concludes the socket is
 * likely half-open and triggers a reconnect.
 *
 * With WS_HEARTBEAT_INTERVAL_MS = 30 s and this value = 3, a dead socket is
 * detected within 90 s.  Healthy idle connections also reconnect every 90 s,
 * which is a much lower reconnect rate than firing on every 30 s silence.
 */
export const WS_HEARTBEAT_STALE_COUNT = 3;

/**
 * Map of "collection:recordId" → expiry timestamp (ms since epoch).
 * Populated by `_runPush()` after each successful `drainQueue()` cycle.
 * Expired entries are lazily deleted in `_isEchoSuppressed`.
 */
export const _recentlyPushed = new Map();

/**
 * Registers a list of just-pushed records in the echo-suppression map and
 * prunes any entries whose TTL has already expired to bound memory usage.
 * Expired entries are additionally removed lazily in `_isEchoSuppressed`
 * on every check so the Map stays compact even without frequent pushes.
 *
 * S4 — `ttlMs` is now caller-supplied: `_runPush` passes an adaptive value
 * based on the measured push round-trip time so that slow connections
 * (high RTT) receive a proportionally larger suppression window while still
 * capping at `ECHO_SUPPRESS_MAX_TTL_MS` to avoid blocking genuine cross-device
 * updates indefinitely.
 *
 * @param {{collection: string, recordId: string}[]} pushedIds
 * @param {number} [ttlMs] - Suppression window in ms.  Defaults to ECHO_SUPPRESS_TTL_MS.
 */
export function _registerPushedEchoes(pushedIds, ttlMs = ECHO_SUPPRESS_TTL_MS) {
  // Guard: a non-positive TTL would immediately expire and serve no purpose.
  if (typeof ttlMs !== 'number' || ttlMs <= 0) return;
  const now = Date.now();
  const expiry = now + ttlMs;
  for (const { collection, recordId } of pushedIds) {
    if (recordId) _recentlyPushed.set(`${collection}:${recordId}`, expiry);
  }
  // Prune expired entries to keep the Map size bounded even when the
  // WebSocket is unavailable and _isEchoSuppressed is never called.
  for (const [key, exp] of _recentlyPushed) {
    if (now >= exp) _recentlyPushed.delete(key);
  }
}

/**
 * Returns `true` when the given record should be suppressed as a self-echo.
 * Lazily removes expired entries encountered during the check.
 * @param {string} collection
 * @param {string|null|undefined} recordId
 */
export function _isEchoSuppressed(collection, recordId) {
  if (!recordId) return false;
  const key = `${collection}:${recordId}`;
  const expiry = _recentlyPushed.get(key);
  if (expiry == null) return false;
  if (Date.now() >= expiry) {
    _recentlyPushed.delete(key);
    return false;
  }
  return true;
}
