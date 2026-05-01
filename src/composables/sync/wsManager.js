/**
 * @file composables/sync/wsManager.js
 * @description WebSocket subscription management for the Directus sync subsystem.
 *
 * Manages WS connection lifecycle, heartbeat watchdog, echo-suppressed
 * LWW-guarded message dispatch, and reconnect logic.
 *
 * Critical ordering invariant (Risk 3):
 *   `_resetWsHeartbeat()` MUST be the first call in `_handleSubscriptionMessage`
 *   so the timer resets before any `await` that could time out.
 *
 * Extracted from useDirectusSync.js (§7 refactor).
 */

import { appConfig } from '../../utils/index.js';
import { mergeOrderFromWSPayload, mergeOrderItemFromWSPayload } from '../../utils/mappers.js';
import { getDirectusClient, resetDirectusClient } from '../useDirectusClient.js';
import { upsertRecordsIntoIDB, deleteRecordsFromIDB } from '../../store/persistence/operations.js';
import { getDB } from '../useIDB.js';
import { addSyncLog } from '../../store/persistence/syncLogs.js';
import { _mapRecord, _extractRecordIds } from './mapper.js';
import { _isEchoSuppressed, WS_HEARTBEAT_INTERVAL_MS } from './echoSuppression.js';
import { _atomicOrderItemsUpsertAndMerge, _removeOrderItemsFromOrdersIDB } from './idbOperations.js';
import { _refreshStoreFromIDB } from './storebridge.js';
import { COLLECTION_QUIRKS, PULL_CONFIG } from './config.js';
import { syncState } from './state.js';
import { _pullCollection, _runPull } from './pullQueue.js';

/** Active unsubscribe callbacks (local to WS helpers, not shared state). */
const _unsubscribers = [];

/**
 * S5 — Resets (or starts) the WebSocket heartbeat watchdog timer.
 * Called after every incoming WS message and whenever a WS connection is
 * established.  If no message arrives within WS_HEARTBEAT_INTERVAL_MS the
 * connection is treated as silently dead: a REST catch-up pull is triggered
 * and a reconnect is scheduled so the app does not miss updates indefinitely.
 */
export function _resetWsHeartbeat() {
  if (syncState._wsHeartbeatTimer) { clearTimeout(syncState._wsHeartbeatTimer); syncState._wsHeartbeatTimer = null; }
  if (!syncState._running || appConfig.directus?.wsEnabled !== true) return;
  syncState._wsHeartbeatTimer = setTimeout(() => {
    syncState._wsHeartbeatTimer = null;
    if (!syncState._running || !syncState._wsConnected.value) return;
    console.warn(
      `[DirectusSync] WS heartbeat: no activity for ${WS_HEARTBEAT_INTERVAL_MS}ms — triggering REST catch-up pull and reconnect.`,
    );
    // Immediately do a REST pull to catch up on any missed messages.
    _runPull().catch(() => {});
    // Mark WS as disconnected and schedule a reconnect attempt.
    syncState._wsConnected.value = false;
    if (!syncState._reconnectTimer) {
      syncState._reconnectTimer = setTimeout(() => {
        syncState._reconnectTimer = null;
        if (!syncState._running) return;
        _reconnectWs().catch(() => {});
      }, 2_000);
    }
  }, WS_HEARTBEAT_INTERVAL_MS);
}

/**
 * Returns the effective timestamp for a record, using `date_updated` when
 * available and falling back to `date_created` for records that have never
 * been PATCHed.  Returns `null` if neither field is set.
 *
 * Used by the LWW echo-suppression guard to compare incoming vs local
 * timestamps without requiring `date_updated` to be non-null.
 *
 * @param {{ date_updated?: string|null, date_created?: string|null }|null|undefined} record
 * @returns {string|null}
 */
function _getEffectiveTs(record) {
  return (record?.date_updated ?? record?.date_created) ?? null;
}

/**
 * Processes an incoming realtime message from Directus Subscriptions.
 * Maps records to local format, upserts into IDB, and merges into the store.
 *
 * Self-echo suppression: records that this device pushed within the last
 * ECHO_SUPPRESS_TTL_MS are filtered out to prevent redundant IDB writes and
 * transient UI rewrites caused by receiving our own changes back via WebSocket.
 *
 * @param {string} collection
 * @param {{ event: string, data: Array<object|string> }} message
 */
export async function _handleSubscriptionMessage(collection, message) {
  // S5: Reset the heartbeat watchdog on every incoming WS message so the timer
  // only fires when the connection has been truly silent for WS_HEARTBEAT_INTERVAL_MS.
  _resetWsHeartbeat();
  const { event, data } = message;
  if (!data || !Array.isArray(data) || data.length === 0) return;

  let processedCount = data.length;
  let suppressedCount = 0;

  if (event === 'delete') {
    // Filter out records that this device just pushed (self-echo suppression).
    const ids = _extractRecordIds(data);
    const nonEchoIds = ids.filter(id => !_isEchoSuppressed(collection, id != null ? String(id) : null));
    suppressedCount = ids.length - nonEchoIds.length;
    processedCount = nonEchoIds.length;
    if (suppressedCount > 0) {
      console.debug(
        `[DirectusSync] WS ${event} on ${collection}: suppressed ${suppressedCount} self-echo(es)`,
      );
    }
    if (nonEchoIds.length === 0) return;
    if (collection === 'table_merge_sessions') {
      // NS4: Deduplicate concurrent pulls triggered by rapid delete events using
      // a semaphore so only one full-replace is in flight at a time.
      if (!syncState._tableMergePullInFlight) {
        syncState._tableMergePullInFlight = _pullCollection('table_merge_sessions', { forceFull: true })
          .finally(() => { syncState._tableMergePullInFlight = null; });
      }
      await syncState._tableMergePullInFlight;
      return;
    }
    if (collection === 'order_items') {
      // Issue 1 fix: _removeOrderItemsFromOrdersIDB now performs both the
      // orders.orderItems array clean-up AND the deletion from the order_items
      // ObjectStore in a single IDB transaction, eliminating the previous
      // two-step non-atomic sequence.
      // NP1 fix: the function now returns the set of affected parent order IDs
      // so the store refresh can be targeted rather than replacing the whole
      // orders reactive array (mirrors the create/update path that uses
      // result.affectedOrderIds from _atomicOrderItemsUpsertAndMerge).
      try {
        const affectedOrderIds = await _removeOrderItemsFromOrdersIDB(nonEchoIds);
        // _refreshStoreFromIDB ignores an empty Set (falls back to full refresh),
        // so passing undefined for the empty case is more explicit about intent.
        await _refreshStoreFromIDB('orders', affectedOrderIds.size > 0 ? affectedOrderIds : undefined);
      } catch (e) {
        console.warn('[DirectusSync] WS order_items delete cleanup failed:', e);
        await _refreshStoreFromIDB('orders');
      }
      // Shared telemetry/activity-log: also update lastPullAt and emit an activity
      // log entry for this delete path so WS order_items deletes appear in the
      // Activity Monitor and are reflected in telemetry (mirrors the non-early-return
      // path used by all other collections).
      syncState.lastPullAt.value = new Date().toISOString();
      const deleteEchoNote = suppressedCount > 0 ? ` (${suppressedCount} self-echo(es) suppressed)` : '';
      console.info(`[DirectusSync] WS ${event} on ${collection}: ${processedCount} record(s) deleted${deleteEchoNote}`);
      addSyncLog({
        direction: 'IN',
        type: 'WS',
        endpoint: `/subscriptions/${collection}`,
        payload: { event, count: data.length, suppressedCount },
        response: { deletedCount: processedCount },
        status: 'success',
        statusCode: null,
        durationMs: null,
        collection,
        recordCount: processedCount,
      });
      return;
    }
    await deleteRecordsFromIDB(collection, nonEchoIds);
    await _refreshStoreFromIDB(collection);
  } else {
    // Defensively drop any non-object entries that should never appear for
    // non-delete events but could arrive from a malformed or unexpected
    // subscription message shape (e.g. bare ID strings).  Spreading a string
    // in _mapRecord would produce corrupted character-indexed records in IDB.
    const objectData = data.filter(r => {
      if (typeof r === 'object' && r !== null) return true;
      console.warn(`[DirectusSync] WS ${event} on ${collection}: unexpected non-object entry ignored`, r);
      return false;
    });
    // Filter out records that this device just pushed (self-echo suppression).
    // Issue 3 fix: for TTL-suppressed records, apply a Last-Write-Wins guard —
    // if the incoming payload has a strictly newer date_updated than the local
    // IDB record, another device modified the same record inside our echo window
    // and the update must not be silently dropped (data loss prevention).
    const nonEcho = [];
    suppressedCount = 0;
    // Fetch the IDB handle once per message so the LWW guard inside the loop
    // doesn't pay the getDB() lookup cost for every suppressed record.
    let db;
    try {
      db = await getDB();
    } catch (e) {
      console.warn('[DirectusSync] LWW echo check: IDB unavailable', e);
    }
    for (const r of objectData) {
      const id = r.id != null ? String(r.id) : null;
      if (!_isEchoSuppressed(collection, id)) {
        nonEcho.push(r);
        continue;
      }
      // LWW guard: allow through when incoming is strictly newer than stored.
      // Directus timestamps are ISO 8601 UTC strings (e.g. "2024-06-01T12:00:00.000Z")
      // which are lexicographically comparable — no Date parsing overhead needed.
      // Use _getEffectiveTs (date_updated ?? date_created) for both sides so that
      // records with date_updated=null (never patched locally) are not incorrectly
      // suppressed when a cross-device PATCH sets date_updated for the first time.
      // Example: local has date_updated=null, date_created="2024-01-01", incoming PATCH
      // has date_updated="2024-06-01" — we want to allow through because the incoming
      // timestamp is strictly after the effective local timestamp.
      const incomingTs = _getEffectiveTs(r);
      let isCrossDeviceUpdate = false;
      if (incomingTs && id && db) {
        try {
          const local = await db.get(collection, id);
          const localTs = _getEffectiveTs(local);
          if (localTs && incomingTs > localTs) {
            isCrossDeviceUpdate = true;
          }
        } catch (e) {
          console.warn('[DirectusSync] LWW echo check failed for', collection, id, e);
        }
      }
      if (isCrossDeviceUpdate) {
        nonEcho.push(r);
      } else {
        suppressedCount++;
      }
    }
    processedCount = nonEcho.length;
    if (suppressedCount > 0) {
      console.debug(
        `[DirectusSync] WS ${event} on ${collection}: suppressed ${suppressedCount} self-echo(es)`,
      );
    }
    if (nonEcho.length === 0) return;
    const mapped = nonEcho.map(r => _mapRecord(collection, r));
    // WS subscriptions use fields:['*'] which does NOT expand nested relations
    // (e.g. order_items), and can also send partial payloads (e.g. only
    // {id, status, date_updated}) for status-change events. mapOrderFromDirectus()
    // fills all absent fields with zero/empty defaults, so a straight put() would
    // wipe IDB fields like totalAmount, globalNote, orderItems etc.
    //
    // For update events we therefore fetch the existing IDB record and merge via
    // mergeOrderFromWSPayload(), overwriting only the fields present in the raw
    // WS payload. create events use the incoming record as-is.
    let prepared = mapped;
    if (collection === 'orders' && event !== 'create') {
      try {
        const db = await getDB();
        prepared = await Promise.all(nonEcho.map(async (raw, i) => {
          const incoming = mapped[i];
          const id = incoming?.id;
          if (!id) return incoming;
          try {
            const existing = await db.get('orders', String(id));
            if (!existing) return incoming;
            return mergeOrderFromWSPayload(existing, raw, incoming);
          } catch (e) {
            console.warn('[DirectusSync] WS order merge: IDB lookup failed for', id, e);
            return incoming;
          }
        }));
      } catch (e) {
        console.warn('[DirectusSync] WS order merge: IDB unavailable, falling back to incoming records', e);
        prepared = mapped;
      }
    }
    // For order_items updates, apply the same selective-merge strategy: load the
    // existing IDB record and merge only the fields present in the raw WS payload.
    // This prevents absent numeric/relation fields (quantity, unit_price, order FK,
    // notes, etc.) from being clobbered with mapper-supplied defaults (e.g. quantity → 0)
    // when Directus sends a partial payload (e.g. {id, kitchen_ready, date_updated}).
    // create events use the incoming record as-is (no prior IDB record to merge with).
    if (collection === 'order_items' && event !== 'create') {
      try {
        const db = await getDB();
        prepared = await Promise.all(nonEcho.map(async (raw, i) => {
          const incoming = mapped[i];
          const id = incoming?.id;
          if (!id) return incoming;
          try {
            const existing = await db.get('order_items', String(id));
            if (!existing) return incoming;
            return mergeOrderItemFromWSPayload(existing, raw, incoming);
          } catch (e) {
            console.warn('[DirectusSync] WS order_items merge: IDB lookup failed for', id, e);
            return incoming;
          }
        }));
      } catch (e) {
        console.warn('[DirectusSync] WS order_items merge: IDB unavailable, falling back to incoming records', e);
        prepared = mapped;
      }
    }
    // For order_items, skip the unconditional upsert here — the atomic helper
    // below writes order_items AND the embedded orderItems arrays in orders
    // together in a single IDB transaction.  Writing to order_items twice would
    // create a partial-write window where order_items is updated but orders is
    // still stale if the atomic path throws/aborts.
    if (collection !== 'order_items') {
      await upsertRecordsIntoIDB(collection, prepared);
    }
    if (collection === 'order_items') {
      // NS1: Use the same atomic upsert+merge that the REST pull path uses so
      // that the order_items ObjectStore and the embedded orderItems arrays in
      // orders are always updated together in a single IDB transaction.
      // Pass the raw nonEcho payloads as the second argument so that
      // _atomicOrderItemsUpsertAndMerge can use mergeOrderItemFromWSPayload for
      // selective-merge semantics (i.e. only overwrite fields present in the WS
      // payload, not all mapper-supplied defaults).
      // Issue 4 fix: capture affectedOrderIds from the atomic result and pass them
      // to _refreshStoreFromIDB for a targeted reactive update instead of
      // replacing the entire orders array.
      try {
        const result = await _atomicOrderItemsUpsertAndMerge(prepared, nonEcho);
        await _refreshStoreFromIDB('orders', result.affectedOrderIds);
      } catch (e) {
        console.warn('[DirectusSync] WS order_items atomic upsert+merge failed:', e);
        await _refreshStoreFromIDB('orders');
      }
    } else {
      await _refreshStoreFromIDB(collection);
    }
  }

  syncState.lastPullAt.value = new Date().toISOString();
  const echoNote = suppressedCount > 0 ? ` (${suppressedCount} self-echo(es) suppressed)` : '';
  const actionWord = event === 'delete' ? 'deleted' : 'written';
  console.info(`[DirectusSync] WS ${event} on ${collection}: ${processedCount} record(s) ${actionWord}${echoNote}`);

  addSyncLog({
    direction: 'IN',
    type: 'WS',
    endpoint: `/subscriptions/${collection}`,
    payload: { event, count: data.length, suppressedCount },
    response: event === 'delete' ? { deletedCount: processedCount } : { writtenCount: processedCount },
    status: 'success',
    statusCode: null,
    durationMs: null,
    collection,
    recordCount: processedCount,
  });
}

/**
 * Starts WebSocket subscriptions for the given collections.
 * Falls back silently if the WebSocket connection fails.
 *
 * @param {string[]} collections
 * @returns {Promise<boolean>} `true` if subscriptions were established
 */
export async function _startSubscriptions(collections) {
  const client = getDirectusClient();
  if (!client) return false;

  const venueId = appConfig.directus?.venueId ?? null;

  try {
    await client.connect();
    syncState._wsConnected.value = true;
    // S5: Start the heartbeat watchdog now that the WS connection is live.
    _resetWsHeartbeat();

    for (const collection of collections) {
      const query = { fields: ['*'] };
      const quirks = COLLECTION_QUIRKS[collection] ?? {};
      if (!quirks.noVenueFilter && venueId != null) {
        query.filter = quirks.venueFilter
          ? quirks.venueFilter(venueId)
          : { venue: { _eq: venueId } };
      }

      const { subscription, unsubscribe } = await client.subscribe(collection, { query });
      _unsubscribers.push(unsubscribe);

      // Process subscription messages as they arrive
      async function processSubscription() {
        try {
          for await (const message of subscription) {
            await _handleSubscriptionMessage(collection, message);
          }
        } catch (e) {
          console.warn(`[DirectusSync] Subscription ${collection} closed:`, e?.message ?? e);
          syncState._wsConnected.value = false;
          // Increment the WS drop telemetry counter on unexpected disconnections.
          // Only counts true transport errors (caught exceptions from the subscription
          // iterator), not intentional teardowns via _stopSubscriptions() which never
          // reach this catch block.
          // JavaScript's event-loop single-threaded model ensures this increment is
          // effectively atomic; concurrent subscription failures are serialised through
          // the microtask queue so no mutex is needed.
          syncState.wsDropCount.value++;
          if (!syncState._running) return;
          // If wsEnabled is still on, schedule a reconnect attempt.
          // Otherwise fall back to polling.
          if (appConfig.directus?.wsEnabled === true) {
            // Use a single shared timer so that concurrent subscription errors for
            // multiple collections don't queue overlapping _reconnectWs() calls.
            if (!syncState._reconnectTimer) {
              syncState._reconnectTimer = setTimeout(() => {
                syncState._reconnectTimer = null;
                if (!syncState._running) return;
                if (!syncState._wsConnected.value && appConfig.directus?.wsEnabled === true) {
                  _reconnectWs().catch(() => {});
                } else if (!syncState._pollTimer && appConfig.directus?.wsEnabled !== true) {
                  // wsEnabled was turned off while reconnect was pending — fall back to polling.
                  const pullCfg = PULL_CONFIG[syncState._appType] ?? PULL_CONFIG.cassa;
                  syncState._pollTimer = setInterval(() => _runPull().catch(() => {}), pullCfg.intervalMs);
                }
              }, 5_000);
            }
          } else if (!syncState._pollTimer) {
            const pullCfg = PULL_CONFIG[syncState._appType] ?? PULL_CONFIG.cassa;
            syncState._pollTimer = setInterval(() => _runPull().catch(() => {}), pullCfg.intervalMs);
          }
        }
      }
      processSubscription();
    }

    console.info('[DirectusSync] WebSocket subscriptions active for:', collections.join(', '));
    return true;
  } catch (e) {
    console.warn('[DirectusSync] WebSocket unavailable, falling back to polling:', e?.message ?? e);
    _stopSubscriptions();
    return false;
  }
}

/**
 * Tears down all active WebSocket subscriptions and clears related timers.
 */
export function _stopSubscriptions() {
  for (const unsub of _unsubscribers) {
    try { unsub(); } catch (_) { /* best-effort */ }
  }
  _unsubscribers.length = 0;
  // S5: Cancel the heartbeat watchdog when subscriptions are torn down.
  if (syncState._wsHeartbeatTimer) { clearTimeout(syncState._wsHeartbeatTimer); syncState._wsHeartbeatTimer = null; }
  // Use resetDirectusClient() rather than getDirectusClient() + disconnect() to avoid
  // creating a brand-new SDK client just to immediately disconnect it.  When stopSync()
  // is called after a config change (loadDirectusConfigFromStorage already called
  // resetDirectusClient()), getDirectusClient() would create a new client and cache it,
  // so the subsequent _startSubscriptions() → connect() would attempt to reconnect a
  // client that was just disconnected — causing the WebSocket to never come back up.
  resetDirectusClient();
  syncState._wsConnected.value = false;
}

/**
 * Attempts to restore WebSocket subscriptions after a connection loss.
 * Cleans up any stale subscriptions/poll timer first, then calls
 * `_startSubscriptions`.  If that fails, re-enables the polling fallback.
 */
export async function _reconnectWs() {
  if (!syncState._running || syncState._wsConnected.value) return;
  if (appConfig.directus?.wsEnabled !== true) return;

  // Recompute the collection list from the current config so that changes to
  // appConfig.menuSource (json ↔ directus) or syncState._appType are picked up at
  // reconnect time rather than using the potentially-stale list captured at
  // startSync() time.
  const pullCfg = PULL_CONFIG[syncState._appType] ?? PULL_CONFIG.cassa;
  const menuSource = appConfig.menuSource ?? 'directus';
  const wsCollections = menuSource === 'json'
    ? pullCfg.collections.filter(c => c !== 'menu_items')
    : pullCfg.collections;
  syncState._wsCollections = wsCollections;

  if (syncState._wsCollections.length === 0) return;

  // Cancel any pending debounced reconnect timer — this call IS the reconnect.
  if (syncState._reconnectTimer) { clearTimeout(syncState._reconnectTimer); syncState._reconnectTimer = null; }

  console.info('[DirectusSync] Attempting WebSocket reconnect…');

  // Stop polling before trying WS — avoids duplicate pulls during reconnect.
  if (syncState._pollTimer) { clearInterval(syncState._pollTimer); syncState._pollTimer = null; }

  // Clean up stale subscriptions/connection before reconnecting.
  _stopSubscriptions();

  const subscribed = await _startSubscriptions(syncState._wsCollections);
  if (!subscribed) {
    // Reconnect failed — restart polling fallback.
    const pullCfg2 = PULL_CONFIG[syncState._appType] ?? PULL_CONFIG.cassa;
    if (!syncState._pollTimer) {
      syncState._pollTimer = setInterval(() => _runPull().catch(() => {}), pullCfg2.intervalMs);
    }
  } else {
    // WS is back — do an immediate pull to catch up on missed updates.
    _runPull().catch(() => {});
  }
}
