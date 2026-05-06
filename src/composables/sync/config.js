/**
 * @file composables/sync/config.js
 * @description Compile-time constants for the Directus sync subsystem.
 *
 * All pure data — no side-effects, no imports from the project.
 * Extracted from useDirectusSync.js (§5.7 refactor).
 */

// ── Per-app pull config (§5.7.6) ─────────────────────────────────────────────

/** @type {Record<string, { collections: string[], intervalMs: number }>} */
export const PULL_CONFIG = {
  cassa: {
    collections: ['orders', 'order_items', 'bill_sessions', 'tables', 'transactions', 'fiscal_receipts', 'invoice_requests'],
    // 30 s polling: frequent enough for near-real-time UX while keeping
    // backend load low. Use wsEnabled=true for sub-second updates if the
    // Directus instance supports WebSocket subscriptions.
    intervalMs: 30_000,
  },
  sala: {
    collections: ['orders', 'order_items', 'bill_sessions', 'tables', 'menu_items', 'transactions'],
    intervalMs: 30_000,
  },
  cucina: {
    collections: ['orders', 'order_items'],
    intervalMs: 30_000,
  },
};

/** Collections for all apps: fetched once at startup and every 5 minutes. */
export const VENUE_RELATED_COLLECTIONS = [
  'venues', 'rooms', 'tables', 'payment_methods',
  'menu_categories', 'menu_items', 'menu_modifiers',
  'menu_categories_menu_modifiers', 'menu_items_menu_modifiers',
  'printers', 'venue_users', 'table_merge_sessions',
];

export const DEEP_FETCH_FIELDS = [
  '*',
  'rooms.*',
  'rooms.tables.*',
  'tables.*',
  'payment_methods.*',
  'menu_categories.*',
  'menu_categories.menu_items.*',
  'menu_categories.menu_modifiers.menu_modifiers_id.*',
  'menu_items.*',
  'menu_items.menu_modifiers.menu_modifiers_id.*',
  'printers.*',
  'users.*',
  'table_merge_sessions.*',
];

export const DEEP_FETCH_BASE_RELATION_FIELDS = [
  '*',
  'rooms.*',
  'tables.*',
  'payment_methods.*',
  'printers.*',
  'users.*',
  'table_merge_sessions.*',
];

export const DEEP_FETCH_FALLBACK_FIELDS = [
  ...DEEP_FETCH_BASE_RELATION_FIELDS,
  'rooms.tables.*',
  'menu_categories.*',
  'menu_categories.menu_items.*',
  'menu_items.*',
];

export const DEEP_FETCH_FIELD_SETS = [
  { key: 'full', fields: DEEP_FETCH_FIELDS },
  { key: 'fallback', fields: DEEP_FETCH_FALLBACK_FIELDS },
];

export const DEEP_FETCH_JSON_FIELDS = [
  'id',
  'name',
  'status',
  'date_updated',
  'primary_color',
  'primary_color_dark',
  'currency_symbol',
  'allow_custom_variants',
  'orders_rejection_reasons',
  'users.*',
  'cover_charge_enabled',
  'cover_charge_auto_add',
  'cover_charge_price_adult',
  'cover_charge_price_child',
  'billing_auto_close_on_full_payment',
  'billing_enable_cash_change_calculator',
  'billing_enable_tips',
  'billing_enable_discounts',
  'billing_allow_custom_entry',
];

export const DEEP_FETCH_JSON_FIELD_SETS = [
  { key: 'json_minimal', fields: DEEP_FETCH_JSON_FIELDS },
];

export const VENUE_NESTED_RELATION_KEYS = [
  'rooms',
  'tables',
  'payment_methods',
  'menu_categories',
  'menu_items',
  'printers',
  'venue_users',
  'table_merge_sessions',
];

export const VENUE_USERS_RELATION_KEYS = ['venue_users', 'users'];

export const GLOBAL_INTERVAL_MS = 5 * 60_000;
export const TABLE_FETCH_BATCH_SIZE = 200;
export const DEEP_FETCH_PAYLOAD_UNWRAP_MAX_DEPTH = 3;

// Maximum number of records stored verbatim in a sync log entry.
// Keeps the Activity Monitor readable and IDB storage bounded on large pulls.
export const SYNC_LOG_RECORDS_MAX = 20;

export const SUPPORTS_STRUCTURED_CLONE = typeof structuredClone === 'function';

// Allow substantial device/server clock drift before treating last_pull_ts as invalid.
// 24h avoids perpetual full-refreshes on slightly misconfigured tablets while still
// catching clearly bogus cursors (for example, year 2099).
export const GLOBAL_TIMESTAMP_SKEW_TOLERANCE_MS = 24 * 60 * 60_000;

/**
 * Per-collection quirks for collections that deviate from the default schema
 * assumed by _fetchUpdatedViaSDK (venue FK + date_updated timestamp field).
 *
 * H3: Some collections don't expose the standard `venue` FK and/or `date_updated`.
 * In these cases we must skip unsupported filters to avoid Directus API errors.
 *
 * Some collections (for example `venues`) intentionally don't expose a `venue`
 * FK and therefore must skip the tenant filter in REST/WS queries.
 *
 * Collections without a direct `venue` FK but reachable via a relational path
 * can use a `venueFilter` function to return the appropriate Directus filter
 * object instead of the default `{ venue: { _eq: venueId } }`.
 */
export const COLLECTION_QUIRKS = {
  venues: { noVenueFilter: true },
  // `order_items` has no direct `venue` FK — it is scoped to the venue via its
  // parent order.  Filtering by `order.venue` avoids the Directus 403 error that
  // would result from referencing a non-existent top-level field.
  order_items: { venueFilter: (venueId) => ({ order: { venue: { _eq: venueId } } }) },
};
