/**
 * @file composables/sync/index.js
 * @description Public entry point for the Directus sync subsystem.
 *
 * Re-exports `useDirectusSync`, `_resetDirectusSyncSingleton`, and the
 * internal helpers that the test suite imports directly.
 *
 * The `useDirectusSync.js` composable is a one-line shim that re-exports
 * everything from this file so that all consumers importing from
 * `composables/useDirectusSync.js` continue to work without changes.
 */

export { useDirectusSync, _resetDirectusSyncSingleton } from './leaderElection.js';
export { _handleSubscriptionMessage, _startSubscriptions } from './wsManager.js';
export { _registerPushedEchoes } from './echoSuppression.js';
export { _atomicOrderItemsUpsertAndMerge } from './idbOperations.js';

import { syncState } from './state.js';

/**
 * Returns a plain-object snapshot of the current sync telemetry metrics.
 * Suitable for logging to an external monitoring endpoint.
 *
 * @returns {{
 *   wsDropCount: number,
 *   queueDepth: number,
 *   lastSuccessfulPull: string|null,
 *   lastPushAt: string|null,
 *   lastPullAt: string|null,
 *   syncStatus: string,
 *   wsConnected: boolean,
 * }}
 */
export function getSyncTelemetry() {
  return {
    wsDropCount: syncState.wsDropCount.value,
    queueDepth: syncState.queueDepth.value,
    lastSuccessfulPull: syncState.lastSuccessfulPull.value,
    lastPushAt: syncState.lastPushAt.value,
    lastPullAt: syncState.lastPullAt.value,
    syncStatus: syncState.syncStatus.value,
    wsConnected: syncState._wsConnected.value,
  };
}
