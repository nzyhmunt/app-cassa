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
  loadLastPullCursorFromIDB,
  saveLastPullCursorToIDB,
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
 */
export function _buildRestClient(cfg) {
  return createDirectus(cfg.url, { globals: { fetch: globalThis.fetch } })
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
 */
export async function _fetchUpdatedViaSDK(collection, sinceTs, page = 1, cursor = null) {
  const cfg = _getCfg();
  if (!cfg) return { data: [], maxTs: null, lastCursor: null, error: null };

  const quirks = COLLECTION_QUIRKS[collection] ?? {};
  const client = _buildRestClient(cfg);
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
      if (signal?.aborted) break;
      const { data, maxTs, error } = await _fetchUpdatedViaSDK(collection, null, page);
      if (error) hadFetchError = true;
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
      if (latestTs) await saveLastPullTsToIDB(collection, latestTs);
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

  // Cross-poll keyset cursor: load the {ts, id} position where the last poll cycle
  // ended.  When valid, the first page of this poll uses the same keyset filter as
  // page 2+ already does — meaning already-seen boundary records (those with
  // date_updated === storedSinceTs) are excluded without a separate network round-trip.
  //
  // Only load the cursor when we have a valid storedSinceTs (genuine incremental pull).
  // forceFull and first-run polls (storedSinceTs = null) always bypass it.
  //
  // Guard: discard the cursor when cursor.ts !== storedSinceTs.  Both values are
  // updated together at the end of every successful page, so they should always
  // be in sync.  A mismatch signals an inconsistency — most commonly caused by a
  // clock-skew clamp above that rewrote storedSinceTs to "now" without touching
  // the cursor.  Using a cursor whose ts differs from storedSinceTs would produce
  // an incorrect keyset filter (e.g. skipping records between "now" and the old
  // future timestamp), so we discard it and fall back to a plain _gte pull for
  // this one cycle, after which the cursor is re-aligned automatically.
  const rawCursor = (!forceFull && storedSinceTs)
    ? await loadLastPullCursorFromIDB(collection)
    : null;
  const storedCursor = (rawCursor?.ts === storedSinceTs) ? rawCursor : null;

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
  // NS7 / cross-poll keyset cursor: initialise from the persisted cursor so the
  // first page of each poll already uses the keyset filter (avoiding redundant
  // re-downloads of boundary records already seen in the previous cycle).
  // Falls back to null for full pulls and first-run polls (storedCursor = null).
  let pageKeyCursor = storedCursor ?? null;

  while (true) { // eslint-disable-line no-constant-condition
    // Exit between pages when forcePull/stopSync aborts the pull session.
    if (signal?.aborted) break;
    const { data, maxTs, lastCursor, error } = await _fetchUpdatedViaSDK(collection, storedSinceTs, page, pageKeyCursor);
    if (error) hadFetchError = true;
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
      // Persist the cross-poll keyset cursor so the next poll cycle can start
      // from where this page ended (avoiding re-downloads of boundary records).
      if (pageKeyCursor) {
        await saveLastPullCursorToIDB(collection, pageKeyCursor);
      }
      // S2: Per-page cursor checkpoint — persist the cursor immediately after each
      // successfully processed page.  A failure on page N+1 therefore cannot roll
      // the cursor back to before page N, so the next polling cycle restarts from
      // the end of the last successful page rather than re-fetching everything.
      // Only write when latestTs has actually advanced beyond the last persisted
      // value to avoid redundant IDB writes on every page of a multi-page pull.
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
      if (allOk) {
        syncState.lastPullAt.value = new Date().toISOString();
        syncState.lastSuccessfulPull.value = syncState.lastPullAt.value;
        if (anyMerged) {
          console.info('[DirectusSync] Pull cycle completed: merged records from server.');
        } else {
          console.info('[DirectusSync] Pull cycle completed: all collections up to date.');
        }
      } else {
        console.warn('[DirectusSync] Pull cycle incomplete: at least one collection failed.');
      }
      return { ok: allOk, failedCollections };
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
