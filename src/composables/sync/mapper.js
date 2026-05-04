/**
 * @file composables/sync/mapper.js
 * @description Field-mapping dispatch layer for the Directus sync subsystem.
 *
 * Maps raw Directus REST/WS payloads into the local in-memory store format.
 * Pure functions with no side-effects or shared mutable state.
 *
 * Extracted from useDirectusSync.js (§5.7 refactor).
 */

import {
  mapOrderFromDirectus,
  mapOrderItemFromDirectus,
  mapBillSessionFromDirectus,
  mapTransactionFromDirectus,
  mapMenuItemFromDirectus,
  mapMenuCategoryFromDirectus,
  mapMenuModifierFromDirectus,
  mapMenuCategoryModifierLinkFromDirectus,
  mapMenuItemModifierLinkFromDirectus,
  mapTableMergeSessionFromDirectus,
} from '../../utils/mappers.js';

/**
 * Maps a raw Directus record to the local store format for the given collection.
 * Falls back to shallow-copying the record with `_sync_status: 'synced'` for
 * any collection that has no dedicated mapper.
 *
 * @param {string} collection
 * @param {object} r - Raw Directus record
 * @returns {object}
 */
export function _mapRecord(collection, r) {
  if (collection === 'orders') return mapOrderFromDirectus(r);
  if (collection === 'bill_sessions') return mapBillSessionFromDirectus(r);
  if (collection === 'order_items') return mapOrderItemFromDirectus(r);
  if (collection === 'transactions') return mapTransactionFromDirectus(r);
  if (collection === 'menu_items') return mapMenuItemFromDirectus(r);
  if (collection === 'menu_categories') return mapMenuCategoryFromDirectus(r);
  if (collection === 'menu_modifiers') return mapMenuModifierFromDirectus(r);
  if (collection === 'menu_categories_menu_modifiers') return mapMenuCategoryModifierLinkFromDirectus(r);
  if (collection === 'menu_items_menu_modifiers') return mapMenuItemModifierLinkFromDirectus(r);
  if (collection === 'table_merge_sessions') return mapTableMergeSessionFromDirectus(r);
  return { ...r, _sync_status: 'synced' };
}

/**
 * Extracts string IDs from a list of mapped records.
 * @param {object[]} records
 * @returns {string[]}
 */
export function _extractRecordIds(records) {
  return records
    .map((r) => String(r?.id ?? r))
    .filter(Boolean);
}
