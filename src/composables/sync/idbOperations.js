/**
 * @file composables/sync/idbOperations.js
 * @description Atomic IDB transaction helpers for the Directus sync subsystem.
 *
 * All functions in this module operate exclusively on IndexedDB and have no
 * direct network or Vue/Pinia store dependencies.  This isolation is critical
 * for maintaining IDB transaction atomicity (Risk 1 in the refactor plan):
 * no `await` on an external function is introduced between `db.transaction()`
 * and `await tx.done`.
 *
 * Extracted from useDirectusSync.js (§5.7 refactor).
 */

import { getDB } from '../useIDB.js';
import { loadStateFromIDB } from '../../store/persistence/operations.js';
import { deepEqual } from '../../utils/index.js';
import { relationId, mergeOrderItemFromWSPayload } from '../../utils/mappers.js';

/**
 * Prepares mapped pull records before IDB upsert.
 * `cachedState` reuses a previously loaded state snapshot across paginated
 * pulls, avoiding repeated `loadStateFromIDB()` calls per page. `undefined`
 * means "not loaded yet", while `null` means "loaded, but no state available".
 *
 * @param {string} collection
 * @param {object[]} mapped - Already-mapped records from `_mapRecord`.
 * @param {object|null|undefined} cachedState - Cached IDB state snapshot.
 * @returns {Promise<{records: object[], state: object|null}>}
 */
export async function _preparePullRecordsForIDB(collection, mapped, cachedState = undefined) {
  if (!Array.isArray(mapped) || mapped.length === 0) {
    return { records: mapped, state: cachedState };
  }
  if (collection !== 'orders' && collection !== 'bill_sessions') {
    return { records: mapped, state: cachedState };
  }

  const state = cachedState === undefined ? await loadStateFromIDB() : cachedState;
  if (!state) {
    return { records: mapped, state };
  }

  if (collection === 'orders') {
    const existingById = new Map(
      (Array.isArray(state.orders) ? state.orders : [])
        .filter((record) => record?.id)
        .map((record) => [String(record.id), record]),
    );
    const records = mapped.map((incoming) => {
      const existing = existingById.get(String(incoming?.id ?? ''));
      if (!existing) return incoming;
      if (Array.isArray(existing.orderItems) && existing.orderItems.length > 0) {
        const hasIncomingItems = Array.isArray(incoming.orderItems) && incoming.orderItems.length > 0;
        if (!hasIncomingItems) {
          return { ...incoming, orderItems: existing.orderItems };
        }
      }
      return incoming;
    });
    return { records, state };
  }

  const existingByBillSessionId = new Map(
    Object.values(state.tableCurrentBillSession ?? {})
      .filter((session) => session?.billSessionId)
      .map((session) => [String(session.billSessionId), session]),
  );
  const records = mapped.map((incoming) => {
    const billSessionId = incoming?.billSessionId ?? incoming?.id;
    const existing = billSessionId != null
      ? existingByBillSessionId.get(String(billSessionId))
      : null;
    if (!existing) return incoming;
    if ((incoming.opened_at == null || incoming.opened_at === '') && existing.opened_at) {
      return { ...incoming, opened_at: existing.opened_at };
    }
    return incoming;
  });
  return { records, state };
}

/**
 * Merges an array of freshly-pulled order_items into their parent orders stored
 * in the `orders` IDB ObjectStore.
 *
 * The `orders` store persists each order with an embedded `orderItems` array
 * (populated when orders are fetched with `fields: ['*', 'order_items.*']`).
 * When the cucina app pulls order_items directly via the `order_items` collection
 * those records land in a separate `order_items` ObjectStore and never reach the
 * embedded arrays — causing the in-memory store to show stale item data even
 * after a successful pull.
 *
 * This function bridges the gap: for each affected order it loads the current
 * record, upserts the incoming items (last-write-wins on date_updated/date_created),
 * and writes the result back before the orders store refresh fires.
 *
 * @param {Array<object>} pulledItems - Mapped order_item records (from _mapRecord).
 * @param {Array<object>} [rawItems]  - Optional raw Directus records (snake_case, same
 *   length/order as pulledItems). May come from a WS event or a REST pull response.
 *   When provided, existing embedded items are merged via `mergeOrderItemFromWSPayload`
 *   so that absent mapped-default fields (quantity, unit_price, etc.) never clobber
 *   real IDB values with zeros.
 * @returns {Promise<number>} Number of orders whose `orderItems` array was actually
 *   rewritten in IDB.  Returns 0 when every candidate order was already up to date
 *   (no-change fast-path), so callers can skip the subsequent store refresh.
 */
export async function _mergeOrderItemsIntoOrdersIDB(pulledItems, rawItems = null) {
  if (!pulledItems || pulledItems.length === 0) return 0;
  try {
    const db = await getDB();

    // Build a raw-payload lookup if rawItems were provided (WS or REST pull path).
    const rawById = new Map();
    if (rawItems && rawItems.length === pulledItems.length) {
      for (let i = 0; i < rawItems.length; i++) {
        const id = String(pulledItems[i]?.id ?? pulledItems[i]?.uid ?? '');
        if (id) rawById.set(id, rawItems[i]);
      }
    }

    // Group items by parent order ID
    const itemsByOrderId = new Map();
    for (const item of pulledItems) {
      const orderId = item?.order ?? item?.orderId;
      if (!orderId) continue;
      const key = String(orderId);
      if (!itemsByOrderId.has(key)) itemsByOrderId.set(key, []);
      itemsByOrderId.get(key).push(item);
    }
    if (itemsByOrderId.size === 0) return 0;

    let ordersWritten = 0;
    const tx = db.transaction('orders', 'readwrite');
    for (const [orderId, items] of itemsByOrderId) {
      const order = await tx.store.get(orderId);
      if (!order) continue;

      const existingItems = Array.isArray(order.orderItems) ? order.orderItems : [];
      const byId = new Map(existingItems.map(i => [String(i.id ?? i.uid ?? ''), i]));

      for (const item of items) {
        const itemId = String(item.id ?? item.uid ?? '');
        if (!itemId) continue;
        const existing = byId.get(itemId);
        if (!existing) {
          byId.set(itemId, item);
        } else {
          // Last-write-wins using date_updated, falling back to date_created.
          // Use Date-based comparison (consistent with upsertRecordsIntoIDB):
          // incoming wins when existing has no timestamp (can't compare), or
          // the incoming timestamp is newer than or equal to the existing one.
          // Ties (same timestamp) favour the incoming payload so that rapid back-
          // to-back PATCHes processed within the same server-clock millisecond are
          // never silently dropped.
          // If incoming has no timestamp but existing does, keep the existing record.
          const existingTs = existing.date_updated ?? existing.date_created ?? null;
          const incomingTs = item.date_updated ?? item.date_created ?? null;
          const incomingWins = !existingTs || (incomingTs != null && new Date(incomingTs) >= new Date(existingTs));
          if (incomingWins) {
            // When a raw WS payload is available, use the selective merge so that
            // mapper-supplied defaults for absent fields (e.g. quantity → 0) never
            // overwrite real values already stored in the embedded item.
            const rawPayload = rawById.get(itemId);
            byId.set(itemId, rawPayload
              ? mergeOrderItemFromWSPayload(existing, rawPayload, item)
              : { ...existing, ...item });
          }
          // else: existing is newer — keep the map unchanged
        }
      }

      const mergedItems = Array.from(byId.values()).filter(i => i.id ?? i.uid);
      // No-change fast-path: skip the IDB put when the merged items array is
      // identical to what is already stored.  This prevents unnecessary IDB write
      // amplification and downstream store-refresh churn when _gte polling
      // re-fetches unchanged boundary records on an otherwise idle dataset.
      if (deepEqual(mergedItems, existingItems)) continue;

      ordersWritten++;
      // A shallow spread is intentional here: IDB's put() performs its own
      // structured-clone serialisation so shared nested references (notes,
      // modifiers) are safely deep-copied before being written to the store.
      await tx.store.put({ ...order, orderItems: mergedItems });
    }
    await tx.done;
    return ordersWritten;
  } catch (e) {
    console.warn('[DirectusSync] _mergeOrderItemsIntoOrdersIDB failed:', e);
    throw e;
  }
}

/**
 * S7 — Atomically writes `order_items` to the `order_items` IDB ObjectStore AND
 * merges them into the embedded `orderItems` arrays of their parent `orders`
 * records, all within a **single** multi-store IDB transaction
 * (`['order_items', 'orders']`).
 *
 * This replaces the previous two-step sequence (P5 — non-atomic upsert + merge):
 *
 *   upsertRecordsIntoIDB('order_items', prepared)  ← writes order_items
 *   _mergeOrderItemsIntoOrdersIDB(...)             ← merges into orders
 *
 * With that sequence, a failure in the merge left `order_items` written but
 * `orders.orderItems` stale, and the cursor (S2) still advanced — meaning the
 * inconsistency would persist until the next forced full pull.  A single
 * transaction guarantees atomicity: either both stores are updated or neither is.
 *
 * ⚠️  CRITICAL — IDB transaction atomicity:
 * No `await` on an imported function may be introduced between `db.transaction()`
 * and `await tx.done`.  IDB transactions auto-commit when the micro-task queue
 * drains between async calls.  All helper calls inside this function must be
 * synchronous operations on the already-open `tx` handles, or `await` calls that
 * themselves only use the existing `tx` (e.g. `tx.objectStore(...).get(...)`).
 *
 * @param {Array<object>} mappedItems  - Mapped order_item records from `_mapRecord`.
 * @param {Array<object>} [rawItems]   - Corresponding raw Directus records. When
 *   provided with the same length and order as `mappedItems`, each entry is used
 *   by `mergeOrderItemFromWSPayload` for selective field merging. If the arrays
 *   differ in length (e.g. after filtering), no raw-payload lookup is built and
 *   merging falls back to the non-raw selective/full-spread path.
 * @returns {Promise<{orderItemsWritten: number, ordersWritten: number, affectedOrderIds: Set<string>}>}
 */
export async function _atomicOrderItemsUpsertAndMerge(mappedItems, rawItems = []) {
  if (!mappedItems || mappedItems.length === 0) {
    return { orderItemsWritten: 0, ordersWritten: 0, affectedOrderIds: new Set() };
  }

  const db = await getDB();

  // Build a lookup from order_item ID → raw Directus record for selective merge.
  const rawById = new Map();
  if (Array.isArray(rawItems) && rawItems.length === mappedItems.length) {
    for (let i = 0; i < rawItems.length; i++) {
      const id = String(mappedItems[i]?.id ?? mappedItems[i]?.uid ?? '');
      if (id) rawById.set(id, rawItems[i]);
    }
  }

  // Single transaction covering both ObjectStores — atomicity guarantee.
  const tx = db.transaction(['order_items', 'orders'], 'readwrite');
  const orderItemsStore = tx.objectStore('order_items');
  const ordersStore = tx.objectStore('orders');

  // ── Phase 1: LWW upsert into `order_items` ─────────────────────────────────
  // Replicates the conflict-resolution logic of `upsertRecordsIntoIDB` but
  // inside this shared transaction so Phase 2 (merge into orders) sees the
  // freshly written records and both phases commit or abort together.
  const toWrite = [];
  // Track IDs of items that were skipped because the IDB already holds a
  // strictly-newer version.  Phase 2 must not embed these stale incoming items
  // into `orders.orderItems` or it would make the embedded array older than the
  // canonical `order_items` store.
  const skipInPhase2 = new Set();
  for (const incomingRaw of mappedItems) {
    // Normalise FK fields (order → orderId, dish → dishId) the same way that
    // `_normalizeIncomingSync('order_items', ...)` in operations.js does.
    const incoming = { ...incomingRaw };
    const orderId = relationId(incoming.order ?? incoming.orderId);
    if (orderId != null) { incoming.order = orderId; incoming.orderId = orderId; }
    const dishId = relationId(incoming.dish ?? incoming.dishId);
    if (dishId != null) { incoming.dish = dishId; incoming.dishId = dishId; }

    const pk = incoming.id;
    if (!pk) continue;

    // Strip internal tracking field once; reuse the clean copy for both the
    // LWW comparison and the eventual IDB put to avoid duplicating the spread.
    const { _sync_status: _s, ...clean } = incoming;

    const existing = await orderItemsStore.get(pk);
    if (existing) {
      const existingTs = existing.date_updated ?? existing.date_created;
      const incomingTs = clean.date_updated ?? clean.date_created;
      // If existing has a timestamp but incoming does not → keep existing.
      // Mark as skip-for-phase-2: incoming is effectively stale.
      if (existingTs && !incomingTs) { skipInPhase2.add(pk); continue; }
      if (existingTs && incomingTs) {
        const existingMs = new Date(existingTs).getTime();
        const incomingMs = new Date(incomingTs).getTime();
        if (incomingMs < existingMs) { skipInPhase2.add(pk); continue; } // strictly older → skip Phase 2 too
        if (incomingMs === existingMs) {
          // Same timestamp: skip Phase 1 write only when the payload is identical.
          // Phase 2 can still merge (same data, harmless for idempotency).
          if (deepEqual(clean, existing)) continue;
        }
        // incomingMs > existingMs, or equal but different payload → write
      }
    }

    toWrite.push(clean);
    await orderItemsStore.put(clean);
  }

  // ── Phase 2: Merge into `orders.orderItems` ─────────────────────────────────
  // Same logic as `_mergeOrderItemsIntoOrdersIDB` but using the same `tx` so
  // both phases are part of the same atomic commit.
  // Items in `skipInPhase2` were skipped in Phase 1 because IDB already holds a
  // strictly-newer version; embedding their stale payload into `orders.orderItems`
  // would make the embedded array inconsistent with the canonical `order_items` store.
  const itemsByOrderId = new Map();
  for (const item of mappedItems) {
    const pk = item?.id ?? item?.uid;
    if (pk && skipInPhase2.has(String(pk))) continue; // stale incoming — don't corrupt embedded array
    const orderId = item?.order ?? item?.orderId;
    if (!orderId) continue;
    const key = String(orderId);
    if (!itemsByOrderId.has(key)) itemsByOrderId.set(key, []);
    itemsByOrderId.get(key).push(item);
  }

  let ordersWritten = 0;
  const affectedOrderIds = new Set();
  for (const [orderId, items] of itemsByOrderId) {
    const order = await ordersStore.get(orderId);
    if (!order) continue;

    const existingItems = Array.isArray(order.orderItems) ? order.orderItems : [];
    const byId = new Map(existingItems.map(i => [String(i.id ?? i.uid ?? ''), i]));

    for (const item of items) {
      const itemId = String(item.id ?? item.uid ?? '');
      if (!itemId) continue;
      const existing = byId.get(itemId);
      if (!existing) {
        byId.set(itemId, item);
      } else {
        const existingTs = existing.date_updated ?? existing.date_created ?? null;
        const incomingTs = item.date_updated ?? item.date_created ?? null;
        const incomingWins = !existingTs || (incomingTs != null && new Date(incomingTs) >= new Date(existingTs));
        if (incomingWins) {
          const rawPayload = rawById.get(itemId);
          byId.set(itemId, rawPayload
            ? mergeOrderItemFromWSPayload(existing, rawPayload, item)
            : { ...existing, ...item });
        }
      }
    }

    const mergedItems = Array.from(byId.values()).filter(i => i.id ?? i.uid);
    if (deepEqual(mergedItems, existingItems)) continue;
    ordersWritten++;
    affectedOrderIds.add(orderId);
    await ordersStore.put({ ...order, orderItems: mergedItems });
  }

  await tx.done;
  return { orderItemsWritten: toWrite.length, ordersWritten, affectedOrderIds };
}

/**
 * Removes deleted order_items (identified by their IDs) from the embedded
 * `orderItems` arrays of their parent orders in the `orders` IDB ObjectStore.
 *
 * Called by `_handleSubscriptionMessage` when a WS `delete` event arrives for
 * the `order_items` collection so that cucina devices with wsEnabled see the
 * deletion reflected in the orders store without waiting for the next poll.
 *
 * @param {string[]} deletedIds - IDs of the deleted order_item records.
 */
export async function _removeOrderItemsFromOrdersIDB(deletedIds) {
  if (!deletedIds || deletedIds.length === 0) return;
  try {
    const db = await getDB();
    const deletedSet = new Set(deletedIds.map(String));
    const tx = db.transaction(['order_items', 'orders'], 'readwrite');
    const orderItemsStore = tx.objectStore('order_items');
    const ordersStore = tx.objectStore('orders');
    const affectedOrderIds = new Set();

    // Resolve only the parent orders for the deleted items, so we do not scan
    // the entire orders store on every WS delete event.
    const resolvedIds = new Set();
    for (const deletedId of deletedSet) {
      const orderItem = await orderItemsStore.get(deletedId);
      if (!orderItem) continue;
      resolvedIds.add(deletedId);

      const parentOrderId = relationId(
        orderItem.order ?? orderItem.orders_id ?? orderItem.order_id ?? orderItem.orderId,
      );
      if (parentOrderId != null && parentOrderId !== '') {
        affectedOrderIds.add(String(parentOrderId));
      }
    }

    for (const orderId of affectedOrderIds) {
      const order = await ordersStore.get(orderId);
      if (!order) continue;

      const items = Array.isArray(order.orderItems) ? order.orderItems : [];
      const filtered = items.filter(i => {
        const itemId = String(i.id ?? i.uid ?? '');
        return !deletedSet.has(itemId);
      });

      if (filtered.length !== items.length) {
        await ordersStore.put({ ...order, orderItems: filtered });
      }
    }

    // Fallback: for deleted IDs that weren't in the order_items store (e.g. on a
    // fresh device before the first order_items pull), scan all orders to remove
    // any matching embedded items.  This O(#orders) pass only runs when some IDs
    // could not be resolved via the fast lookup above.
    const unresolvedIds = new Set();
    for (const id of deletedSet) {
      if (!resolvedIds.has(id)) unresolvedIds.add(id);
    }
    if (unresolvedIds.size > 0) {
      let cursor = await ordersStore.openCursor();
      while (cursor) {
        const order = cursor.value;
        const items = Array.isArray(order.orderItems) ? order.orderItems : [];
        const filtered = items.filter(i => !unresolvedIds.has(String(i.id ?? i.uid ?? '')));
        if (filtered.length !== items.length) {
          await cursor.update({ ...order, orderItems: filtered });
        }
        cursor = await cursor.continue();
      }
    }

    // Issue 1 fix: delete from order_items store within the same transaction so
    // the orders.orderItems update and the items deletion are fully atomic.
    // The delete is placed after the order lookups (which used orderItemsStore.get)
    // so that parent-order resolution always reads live data before the items
    // are removed.  delete() on a non-existent key is a safe no-op in IDB.
    for (const id of deletedSet) {
      await orderItemsStore.delete(id);
    }
    await tx.done;
  } catch (e) {
    console.warn('[DirectusSync] _removeOrderItemsFromOrdersIDB failed:', e);
    throw e;
  }
}
