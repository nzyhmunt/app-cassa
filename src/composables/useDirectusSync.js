/**
 * @file composables/useDirectusSync.js
 * @description Public shim — re-exports the Directus sync composable and all
 * internal test helpers from the `sync/` sub-package.
 *
 * All logic now lives in:
 *   composables/sync/
 *     config.js          — constants
 *     echoSuppression.js — echo suppression
 *     mapper.js          — field mapping
 *     idbOperations.js   — IDB transactions
 *     state.js           — singleton mutable state
 *     storebridge.js     — Pinia/IDB bridge
 *     pullQueue.js       — incremental REST pull
 *     wsManager.js       — WebSocket subscriptions
 *     globalPull.js      — full venue-config pull
 *     pushQueue.js       — sync-queue drain
 *     leaderElection.js  — lifecycle + public composable
 *     index.js           — aggregated re-exports
 *
 * Consumers that import `useDirectusSync` from this path continue to work
 * without any change.
 */

export {
  useDirectusSync,
  _resetDirectusSyncSingleton,
  _handleSubscriptionMessage,
  _registerPushedEchoes,
  _startSubscriptions,
  _atomicOrderItemsUpsertAndMerge,
} from './sync/index.js';
