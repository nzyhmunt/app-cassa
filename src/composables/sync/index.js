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
