/**
 * @file composables/sync/pullQueue.js
 * @description Incremental REST-based pull queue for the Directus sync subsystem.
 *
 * Contains the REST client factory, the per-collection keyset-paginated fetch
 * loop, and the orchestrated multi-collection pull cycle.
 *
 * Extracted from useDirectusSync.js (§7/§8 refactor).
 */

import { createDirectus, staticToken, rest, readItems } from '@directus/sdk';
import { appConfig } from '../../utils/index.js';
import { upsertRecordsIntoIDB } from '../../store/persistence/operations.js';
import {
  loadLastPullTsFromIDB,
  saveLastPullTsToIDB,
  replaceTableMergesInIDB,
} from '../../store/persistence/config.js';
import { addSyncLog } from '../../store/persistence/syncLogs.js';
import { _mapRecord } from './mapper.js';
import { _atomicOrderItemsUpsertAndMerge, _preparePullRecordsForIDB } from './idbOperations.js';
import { _refreshStoreFromIDB } from './storebridge.js';
import { syncState } from './state.js';
import {
  PULL_CONFIG,
  COLLECTION_QUIRKS,
  SYNC_LOG_RECORDS_MAX,
  GLOBAL_TIMESTAMP_SKEW_TOLERANCE_MS,
} from './config.js';

/**
 * Builds a Directus SDK REST-only client for the given config.
 *
 * @param {{ url: string, staticToken: string }} cfg
 * @param {AbortSignal|null} [signal] - When provided, the signal is forwarded into every
 *   underlying fetch call so that network requests are cancelled immediately when the
 *   signal fires, rather than only taking effect between pages.
 */
export function _buildRestClient(cfg, signal = null) {
  const boundFetch = signal
    ? (url, opts) => globalThis.fetch(url, { ...opts, signal })
    : globalThis.fetch;
  return createDirectus(cfg.url, { globals: { fetch: boundFetch } })
    .with(staticToken(cfg.staticToken))
    .with(rest());
}

/**
 * Returns the current Directus connection config, or null if Directus is not enabled/configured.
 *
 * @returns {{ url: string, staticToken: string, venueId: string|null } | null}
 */
export function _getCfg() {
  const d = appConfig.directus;
  if (!d?.enabled || !d?.url || !d?.staticToken) return null;
  return { url: d.url, staticToken: d.staticToken, venueId: d.venueId ?? null };
}

/**
 * Fetches records updated since `sinceTs` for the given collection via the
 * Directus REST API.  Supports keyset pagination for large result sets.
 *
 * @param {string} collection
 * @param {string|null} sinceTs - ISO timestamp of last successful pull.
 * @param {number} [page]
 * @param {{ id: string, ts: string|null }|null} [cursor]
 * @param {AbortSignal|null} [signal] - Optional AbortSignal forwarded into every
 *   fetch call via `_buildRestClient`.  When the signal fires, the request
 *   rejects immediately and the catch block returns a clean empty result without
 *   logging so that intentional `forcePull()` / `stopSync()` cancellations do
 *   not pollute operational telemetry with spurious pull-failure entries.
 */
export async function _fetchUpdatedViaSDK(collection, sinceTs, page = 1, cursor = null, signal = null) {
  const cfg = _getCfg();
  if (!cfg) return { data: [], maxTs: null, lastCursor: null, error: null };

  const quirks = COLLECTION_QUIRKS[collection] ?? {};
  // Build the client with the abort signal forwarded into every fetch call so that
  // forcePull()/stopSync() cancellations interrupt in-flight HTTP requests immediately
  // rather than only taking effect between pages.
  const client = _buildRestClient(cfg, signal);
  // For orders, expand nested order_items and their modifiers so that the
  // detail view is populated even on a fresh device that has never locally
  // created those orders.
  // For order_items, also expand order_item_modifiers so that the modifier
  // detail is available when order_items are pulled as a standalone collection
  // (e.g. cucina app, or the fallback separate-pull path in cassa/sala).
  let pullFields;
  if (collection === 'orders') {
    pullFields = ['*', 'order_items.*', 'order_items.order_item_modifiers.*'];
  } else if (collection === 'order_items') {
    pullFields = ['*', 'order_item_modifiers.*'];
  } else {
    pullFields = ['*'];
  }
  // NS7 fix: When a keyset cursor is active, the cursor filter itself handles
  // exclusion of already-seen records.  Passing page > 1 on top of a keyset
  // filter causes Directus to apply an additional offset on the already-narrowed
  // result set, double-skipping records.  Force page = 1 whenever a cursor is
  // present so only the keyset filter determines the starting position.
  const isKeysetMode = !!(cursor?.id && cursor?.ts);
  const query = {
    limit: 200,
    page: isKeysetMode ? 1 : page,
    // Primary sort by date_updated (or id for quirk collections); secondary by
    // id to guarantee a stable, deterministic page order when many records share
    // the same date_updated value (including null).
    // Note: date_created is intentionally omitted from the sort so that the keyset
    // filter (which advances by id only) is always consistent with the sort order.
    // Adding date_created to the sort would cause records to be skipped when rows
    // share the same date_updated but have different date_created values, because
    // the keyset boundary uses only id > cursor.id.
    sort: quirks.noDateUpdated ? ['id'] : ['date_updated', 'id'],
    fields: pullFields,
  };

  // Incremental pull filter (only records updated/created at or after last known timestamp).
  // Skipped for collections that have no date_updated field (noDateUpdated quirk).
  //
  // Directus sets date_updated only when a record is PATCHed, not on initial creation,
  // so newly created records have date_updated = null. Without the _or clause those
  // records would be invisible to every incremental poll after the initial full pull.
  //
  // We use _gte (≥) instead of _gt (>) so that records whose date_updated/date_created
  // equals sinceTs are always re-fetched.  This is necessary because multiple PATCH
  // operations performed on the same record in rapid succession can land at the same
  // server-clock second (or even millisecond), meaning the final update shares the exact
  // same timestamp as the version already seen by the pulling device.  A strict _gt
  // filter would permanently skip those boundary records on every subsequent poll.
  // upsertRecordsIntoIDB handles the re-fetch idempotently: it only writes when the
  // incoming timestamp is ≥ the stored one (preferring the freshest server payload).
  //
  // NS7: When a keyset cursor is provided (page 2+), activate keyset mode regardless
  // of whether cursor.ts equals sinceTs.  The old condition `cursor.ts === sinceTs`
  // only fired when the last record's timestamp matched the global pull cursor exactly,
  // missing the common case where page-1 records have timestamps newer than sinceTs.
  // The keyset filter uses cursor.ts as the exclusion boundary so that any records
  // already seen (ts < cursor.ts, or ts === cursor.ts with id ≤ cursor.id) are skipped.
  const conditions = [];
  if (sinceTs && !quirks.noDateUpdated) {
    if (isKeysetMode) {
      // Keyset mode (page 2+): skip all records up to and including the cursor position.
      // The sort order is [date_updated, id], so we include:
      //   • records with date_updated strictly after cursor.ts, OR
      //   • records with date_updated === cursor.ts but id > cursor.id, OR
      //   • records with date_updated=null but date_created >= sinceTs (new, never-patched records).
      conditions.push({
        _or: [
          { date_updated: { _gt: cursor.ts } },
          { _and: [{ date_updated: { _eq: cursor.ts } }, { id: { _gt: cursor.id } }] },
          // NS7/P17 fix: add id._gt to the null-date condition so that when there
          // are more null-date records than TABLE_FETCH_BATCH_SIZE the cursor
          // advances by ID and the pager does not infinite-loop on page 1.
          { _and: [{ date_updated: { _null: true } }, { date_created: { _gte: sinceTs } }, { id: { _gt: cursor.id } }] },
        ],
      });
    } else {
      conditions.push({
        _or: [
          { date_updated: { _gte: sinceTs } },
          { _and: [{ date_updated: { _null: true } }, { date_created: { _gte: sinceTs } }] },
        ],
      });
    }
  }
  // Venue filter — skipped for collections without a `venue` FK (noVenueFilter quirk).
  // Collections with a custom `venueFilter` use a relational path instead of
  // the default `{ venue: { _eq: venueId } }`.
  // (This filtering logic lives inside `_fetchUpdatedViaSDK`, which owns REST pull queries.
  //  The WebSocket subscription path in `_startSubscriptions` applies the same quirks.)
  if (!quirks.noVenueFilter && cfg.venueId != null) {
    const venueCondition = quirks.venueFilter
      ? quirks.venueFilter(cfg.venueId)
      : { venue: { _eq: cfg.venueId } };
    conditions.push(venueCondition);
  }
  if (conditions.length === 1) {
    query.filter = conditions[0];
  } else if (conditions.length > 1) {
    query.filter = { _and: conditions };
  }

  const _pullStart = Date.now();
  try {
    const records = await client.request(readItems(collection, query));
    const _pullDuration = Date.now() - _pullStart;
    const data = Array.isArray(records) ? records : [];
    // Use date_updated as the primary cursor value, falling back to date_created
    // for records where date_updated is null (i.e. created but never patched).
    const timestamps = data.map(r => r.date_updated ?? r.date_created).filter(Boolean);
    const maxTs = timestamps.length > 0 ? timestamps.reduce((a, b) => (a > b ? a : b)) : null;
    // NS7: Build keyset cursor from the last record in this page.
    const lastRecord = data.length > 0 ? data[data.length - 1] : null;
    const lastCursor = lastRecord
      ? { id: lastRecord.id, ts: lastRecord.date_updated ?? lastRecord.date_created ?? null }
      : null;
    addSyncLog({
      direction: 'IN',
      type: 'PULL',
      endpoint: `/items/${collection}`,
      payload: { collection, page, filter: query.filter ?? null, since: sinceTs ?? null },
      response: { count: data.length, maxTs, records: data.length <= SYNC_LOG_RECORDS_MAX ? data : data.slice(0, SYNC_LOG_RECORDS_MAX) },
      status: 'success',
      statusCode: 200,
      durationMs: _pullDuration,
      collection,
      recordCount: data.length,
    });
    return { data, maxTs, lastCursor, error: null };
  } catch (e) {
    // AbortError: intentional cancellation by forcePull() / stopSync() / _runPull().
    // Return a clean result with aborted:true so callers can distinguish an
    // intentional cancellation from a genuine empty page.  No logging so
    // operational telemetry is not polluted with spurious pull-failure entries
    // (mirrors the push path's behaviour).
    if (e?.name === 'AbortError') {
      return { data: [], maxTs: null, lastCursor: null, error: null, aborted: true };
    }
    console.warn(`[DirectusSync] Pull ${collection} error:`, e?.message ?? e);
    addSyncLog({
      direction: 'IN',
      type: 'PULL',
      endpoint: `/items/${collection}`,
      payload: { collection, page, filter: query.filter ?? null, since: sinceTs ?? null },
      response: { error: e?.message ?? String(e) },
      status: 'error',
      statusCode: e?.response?.status ?? null,
      durationMs: Date.now() - _pullStart,
      collection,
      recordCount: 0,
    });
    return { data: [], maxTs: null, lastCursor: null, error: e };
  }
}

/**
 * Pulls all updated records for a single collection, using keyset pagination
 * to handle large result sets, and writes them atomically to IDB.
 *
 * @param {string} collection
 * @param {{ forceFull?: boolean, lastPullTimestampOverride?: string|null, signal?: AbortSignal|null }} [options]
 */
export async function _pullCollection(collection, { forceFull = false, lastPullTimestampOverride = null, signal = null } = {}) {
  if (collection === 'table_merge_sessions' && forceFull) {
    let page = 1;
    let latestTs = null;
    const allMapped = [];
    let hadFetchError = false;
    while (true) { // eslint-disable-line no-constant-condition
      // Abort before making the next HTTP request — treat as fetch error so
      // replaceTableMergesInIDB is not called with an incomplete dataset.
      if (signal?.aborted) { hadFetchError = true; break; }
      const { data, maxTs, error, aborted } = await _fetchUpdatedViaSDK(collection, null, page, null, signal);
      if (error) hadFetchError = true;
      // Abort fired mid-fetch: treat as a fetch error so replaceTableMergesInIDB
      // is not called with an incomplete dataset, which would silently delete the
      // pages that were never fetched.
      if (aborted) { hadFetchError = true; break; }
      if (data.length === 0) break;
      const mapped = data.map(r => _mapRecord(collection, r));
      allMapped.push(...mapped);
      if (maxTs && (!latestTs || maxTs > latestTs)) latestTs = maxTs;
      if (data.length < 200) break;
      page++;
    }
    if (!hadFetchError) {
      await replaceTableMergesInIDB(allMapped);
      await _refreshStoreFromIDB('table_merge_sessions');
      // Guard the checkpoint write: if the signal fired while replaceTableMergesInIDB
      // or the store refresh was running, do not persist last_pull_ts — a superseding
      // forcePull() / stopSync() cycle may have already written a fresher value and
      // we must not overwrite it with a stale one.
      if (latestTs && !signal?.aborted) await saveLastPullTsToIDB(collection, latestTs);
    }
    return { merged: allMapped.length, ok: !hadFetchError };
  }

  // forceFull always wins: ignore both lastPullTimestampOverride and persisted cursor.
  // `let` (not `const`) so the clock-skew guard below can clamp it to now when needed.
  let storedSinceTs = forceFull
    ? null
    : lastPullTimestampOverride ?? await loadLastPullTsFromIDB(collection);

  // S6: Clock-skew guard — if the stored cursor is in the future by more than
  // GLOBAL_TIMESTAMP_SKEW_TOLERANCE_MS the device clock (or the cursor) is
  // probably invalid.
  //
  // Previous behaviour: force a full pull — but this caused a perpetual full pull
  // every sync cycle when the device clock was permanently mis-set, effectively
  // making the app unusable on offline/kiosk hardware with a drifted RTC.
  //
  // New behaviour: clamp the cursor to the device's current time and persist it so
  // subsequent polls proceed normally.  Any records created between "now" and the
  // bad future cursor are temporarily invisible until the next scheduled full pull
  // (or a manual forcePull), but the app remains functional and data-safe.
  if (!forceFull && storedSinceTs) {
    const nowMs = Date.now();
    const skewMs = new Date(storedSinceTs).getTime() - nowMs;
    if (skewMs > GLOBAL_TIMESTAMP_SKEW_TOLERANCE_MS) {
      const clampedTs = new Date(nowMs).toISOString();
      console.warn(
        `[DirectusSync] Clock skew on ${collection}: cursor ${storedSinceTs} is ${Math.round(skewMs / 3_600_000)}h in the future. ` +
        `Clamping cursor to ${clampedTs} to avoid perpetual full pulls.`,
      );
      await saveLastPullTsToIDB(collection, clampedTs);
      storedSinceTs = clampedTs;
    }
  }

  // NS7: Keyset cursor for within-poll pagination only.  Starts as null so the
  // first page always uses the safe _gte sinceTs filter (inclusive boundary);
  // advanced to lastCursor after each page so pages 2+ skip already-seen
  // records.  A stored cross-poll cursor is intentionally NOT loaded here:
  // applying it on page 1 would make the sinceTs boundary exclusive
  // (id > cursor.id), which can silently skip records with
  // date_updated == storedSinceTs that carry non-monotonic IDs and were
  // created between the previous poll and this one.  Correctness takes
  // priority over the bandwidth saving, so each poll starts fresh.
  let pageKeyCursor = null;

  let page = 1;
  let latestTs = storedSinceTs;
  // S2: track the last timestamp actually persisted so we only call
  // saveLastPullTsToIDB() when latestTs advances, not on every page.
  let lastSavedTs = storedSinceTs;
  let totalMerged = 0;
  let hadFetchError = false;
  let hadRemoteRecords = false;
  let cachedState = undefined;
  // S7: track how many parent orders had their embedded orderItems updated so we
  // know whether to trigger a store refresh after the loop without accumulating
  // all pages in memory.
  let totalOrdersWrittenFromItems = 0;
  // Issue 4 fix: accumulate the IDs of orders actually modified by order_items
  // pages so the store refresh can be targeted rather than replacing the whole
  // orders reactive array.
  const allAffectedOrderIds = new Set();

  while (true) { // eslint-disable-line no-constant-condition
    // Exit between pages when forcePull/stopSync aborts the pull session.
    if (signal?.aborted) break;
    const { data, maxTs, lastCursor, error, aborted } = await _fetchUpdatedViaSDK(collection, storedSinceTs, page, pageKeyCursor, signal);
    if (error) hadFetchError = true;
    // Abort fired mid-fetch: exit cleanly without advancing cursor or treating
    // the result as a genuine empty page.
    if (aborted) break;
    if (data.length === 0) break;
    hadRemoteRecords = true;

    const mapped = data.map(r => _mapRecord(collection, r));
    let written = 0;
    let pageWriteError = false;

    if (collection === 'order_items') {
      // S7: Atomic upsert+merge — writes to 'order_items' AND 'orders' in a
      // single IDB transaction so the two stores are never left inconsistent
      // (P5: non-atomic failure mode resolved).  If the transaction aborts,
      // neither store is modified and the cursor does not advance.
      try {
        const result = await _atomicOrderItemsUpsertAndMerge(mapped, data);
        written = result.orderItemsWritten;
        totalOrdersWrittenFromItems += result.ordersWritten;
        for (const id of result.affectedOrderIds) allAffectedOrderIds.add(id);
      } catch (e) {
        console.warn(`[DirectusSync] order_items atomic upsert+merge failed on page ${page}; cursor will not advance:`, e);
        hadFetchError = true;
        pageWriteError = true;
      }
    } else {
      const preparedResult = await _preparePullRecordsForIDB(collection, mapped, cachedState);
      cachedState = preparedResult.state;
      const prepared = preparedResult.records;
      written = await upsertRecordsIntoIDB(collection, prepared);
    }
    totalMerged += written;

    // Only advance the cursor when the page write succeeded.  `pageWriteError`
    // is set exclusively for the `order_items` atomic path: if the transaction
    // aborts, neither store is modified so the cursor must not advance.  For all
    // other collections, `upsertRecordsIntoIDB` swallows its errors internally
    // (returns 0 on failure) and always allows the cursor to advance — consistent
    // with pre-S7 behaviour where a silent IDB write failure would not stall the
    // poll cycle.
    if (!pageWriteError) {
      if (maxTs && (!latestTs || maxTs > latestTs)) latestTs = maxTs;
      // NS7: Advance the keyset cursor to the last record on this page.
      pageKeyCursor = lastCursor ?? null;
      // Do not write the checkpoint if the signal was aborted while the page IDB
      // write was in progress.  The data write itself is idempotent (the next poll
      // will re-fetch and upsert the same records), but persisting a stale
      // checkpoint could roll last_pull_ts backwards relative to a fresher
      // checkpoint already committed by the superseding forcePull() or
      // _runPull() cycle that issued the abort.
      if (signal?.aborted) break;
      // S2: Per-page timestamp checkpoint — persist immediately after each
      // successfully processed page so that a failure on page N+1 cannot roll
      // the timestamp back to before page N.  Only write when latestTs has
      // actually advanced to avoid redundant IDB writes on every page.
      if (latestTs && latestTs !== lastSavedTs) {
        await saveLastPullTsToIDB(collection, latestTs);
        lastSavedTs = latestTs;
      }
    }
    if (pageWriteError || data.length < 200) break;
    page++;
  }

  if (hadRemoteRecords) {
    if (collection === 'order_items') {
      // S7: The atomic function handled both the order_items write and the merge
      // into orders.orderItems.  Only refresh the in-memory store when at least
      // one order record was actually rewritten (avoids needless store churn on
      // unchanged boundary records re-fetched by the _gte incremental strategy).
      // Issue 4 fix: pass affectedOrderIds so the store can do a targeted refresh
      // of only those orders instead of replacing the whole reactive array.
      if (totalOrdersWrittenFromItems > 0) await _refreshStoreFromIDB('orders', allAffectedOrderIds);
    } else {
      await _refreshStoreFromIDB(collection);
    }
  }

  return { merged: totalMerged, ok: !hadFetchError };
}

/**
 * NS9 — Triggers an immediate `_pullCollection('order_items')` after a WS
 * `orders:create` event, so that item details are merged within seconds rather
 * than waiting for the next 30-second scheduled poll.
 *
 * Concurrency guarantees:
 *  - Returns immediately when `stopSync()` has been called (`_running` guard).
 *  - If `_runPull()` is in progress but `order_items` is still ahead in the
 *    cycle (`_pullOrderItemsDone = false`), sets `_orderItemsPullPending` so
 *    `_runPull()` fires a follow-up NS9 pull after it finishes (covers items
 *    committed during the in-flight order_items request window), then returns.
 *  - If only a previous NS9 pull is in-flight, sets `_orderItemsPullPending`
 *    and returns.  The in-flight pull's `.finally()` re-triggers once it
 *    settles, ensuring items committed after the current pull started are not
 *    missed.
 *  - The promise is stored as `_orderItemsPullInFlight` (semaphore) so that
 *    rapid bursts of `orders:create` events share one pull.
 *  - An `AbortController` is stored in `_orderItemsPullAbortController` so
 *    `forcePull()`, `stopSync()`, and `_runPull()` can cancel a stale pull.
 *  - The `.finally()` uses an identity check on `_orderItemsPullInFlight` so a
 *    stale settled promise cannot wipe a newer semaphore installed after an abort.
 */
export function _triggerImmediateOrderItemsPull() {
  // If a full _runPull() cycle is already in progress AND has not yet processed
  // order_items — set the pending flag so _runPull() fires a follow-up NS9 pull
  // after it finishes (covers items committed during the in-flight fetch window),
  // then return; _runPull() covers order_items itself.
  //
  // If _runPull() has already processed order_items (_pullOrderItemsDone = true),
  // the current cycle will NOT include items from this event. Fall through to
  // start the NS9 pull so item details appear promptly.
  if (syncState._pullInFlight && !syncState._pullOrderItemsDone) {
    syncState._orderItemsPullPending = true;
    return;
  }
  if (syncState._orderItemsPullInFlight) {
    // A pull is already in-flight.  Mark pending so the current pull's .finally()
    // re-triggers once it settles, covering items committed after the current pull
    // started.
    syncState._orderItemsPullPending = true;
    return;
  }
  // Guard: do not start any new pull after stopSync() has been called.
  if (!syncState._running) return;
  const ac = new AbortController();
  syncState._orderItemsPullAbortController = ac;
  const p = _pullCollection('order_items', { signal: ac.signal })
    .catch(e => console.warn('[DirectusSync] WS orders:create — immediate order_items pull failed:', e))
    .finally(() => {
      // Identity-guard: only clear the semaphore / controller if they still refer
      // to THIS pull.  If forcePull() / stopSync() already nulled them and a newer
      // pull was started, we must not overwrite those newer references.
      if (syncState._orderItemsPullInFlight === p) syncState._orderItemsPullInFlight = null;
      if (syncState._orderItemsPullAbortController === ac) syncState._orderItemsPullAbortController = null;
      // Re-trigger if another orders:create arrived while this pull was in-flight
      // (i.e. items from a later order may not have been included in this pull).
      if (syncState._orderItemsPullPending) {
        syncState._orderItemsPullPending = false;
        _triggerImmediateOrderItemsPull();
      }
    });
  syncState._orderItemsPullInFlight = p;
}

/**
 * Orchestrates an incremental pull cycle across all configured collections.
 * Uses a semaphore (`syncState._pullInFlight`) to prevent concurrent pulls.
 *
 * @returns {Promise<{ ok: boolean, failedCollections: string[] }>}
 */
export async function _runPull() {
  // S3: Semaphore — return the in-flight pull promise when a pull is already
  // running.  This prevents duplicate incremental fetches from accumulating
  // during rapid back-to-back triggers (polling interval, _onOnline, WS reconnect).
  // `forcePull()` resets syncState._pullInFlight to null before calling _runPull() so that
  // user-initiated pulls can always bypass a pending background pull.
  if (syncState._pullInFlight) return syncState._pullInFlight;
  const generation = ++syncState._pullGeneration;
  syncState._pullInFlight = (async () => {
    // NS8: Mint a fresh AbortController for this pull session so forcePull/stopSync
    // can cancel between collections without letting a superseded loop continue.
    const ac = new AbortController();
    syncState._pullAbortController = ac;
    // NS9: Cancel any in-flight WS-triggered order_items pull — this full cycle
    // covers order_items, so a concurrent NS9 pull is redundant and could roll
    // last_pull_ts backwards after this cycle commits a fresher checkpoint.
    // Also clear the pending flag: this pull will handle order_items.
    syncState._orderItemsPullAbortController?.abort();
    syncState._orderItemsPullAbortController = null;
    syncState._orderItemsPullInFlight = null;
    syncState._orderItemsPullPending = false;
    syncState._pullOrderItemsDone = false;
    try {
      if (!navigator.onLine) {
        return { ok: false, failedCollections: [], skippedReason: 'offline' };
      }
      if (!_getCfg()) {
        return { ok: false, failedCollections: [], skippedReason: 'no-config' };
      }

      const pullCfg = PULL_CONFIG[syncState._appType] ?? PULL_CONFIG.cassa;
      const menuSource = appConfig.menuSource ?? 'directus';

      let anyMerged = false;
      let allOk = true;
      const mergedSummary = [];
      const failedCollections = [];
      for (const collection of pullCfg.collections) {
        // NS8: Exit cleanly between collections if this pull was aborted by
        // forcePull() or stopSync() starting a fresh pull session.
        if (ac.signal.aborted) break;
        if (menuSource === 'json' && collection === 'menu_items') continue;
        const { merged, ok } = await _pullCollection(collection, { signal: ac.signal });
        if (ac.signal.aborted) break;
        // Track that order_items has been processed in this cycle so that
        // _triggerImmediateOrderItemsPull() can distinguish "order_items still
        // ahead" from "order_items already done" when a WS orders:create arrives
        // late in the pull cycle (after _runPull() has already pulled order_items).
        if (collection === 'order_items') syncState._pullOrderItemsDone = true;
        if (merged > 0) anyMerged = true;
        if (!ok) allOk = false;
        if (merged > 0) mergedSummary.push(`${collection}:${merged}`);
        if (!ok) failedCollections.push(collection);
      }
      if (mergedSummary.length > 0 || failedCollections.length > 0) {
        console.info(
          `[DirectusSync] Pull cycle details — merged: ${mergedSummary.join(', ') || 'none'}; failed: ${failedCollections.join(', ') || 'none'}.`,
        );
      }
      if (allOk && !ac.signal.aborted) {
        syncState.lastPullAt.value = new Date().toISOString();
        syncState.lastSuccessfulPull.value = syncState.lastPullAt.value;
        if (anyMerged) {
          console.info('[DirectusSync] Pull cycle completed: merged records from server.');
        } else {
          console.info('[DirectusSync] Pull cycle completed: all collections up to date.');
        }
      } else if (ac.signal.aborted) {
        console.info('[DirectusSync] Pull cycle aborted (superseded by forcePull/stopSync).');
      } else {
        console.warn('[DirectusSync] Pull cycle incomplete: at least one collection failed.');
      }
      // NS9: If a WS orders:create arrived while order_items was being fetched in
      // this cycle, _orderItemsPullPending was set by _triggerImmediateOrderItemsPull.
      // Trigger a follow-up NS9 pull now (not aborted) so items committed during
      // the in-flight order_items request window are not missed until the next poll.
      if (!ac.signal.aborted && syncState._orderItemsPullPending) {
        syncState._orderItemsPullPending = false;
        _triggerImmediateOrderItemsPull();
      }
      return { ok: allOk && !ac.signal.aborted, aborted: ac.signal.aborted, failedCollections };
    } catch (e) {
      console.warn('[DirectusSync] Pull error:', e);
      return { ok: false, failedCollections: [] };
    } finally {
      // Only clear shared state if this is still the current pull generation.
      // A superseded pull must not null out a newer pull's syncState._pullInFlight.
      if (syncState._pullGeneration === generation) syncState._pullInFlight = null;
      // NS8: Only clear the controller reference if it still belongs to this pull.
      if (syncState._pullAbortController === ac) syncState._pullAbortController = null;
    }
  })();
  return syncState._pullInFlight;
}
