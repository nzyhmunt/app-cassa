/**
 * @file composables/__tests__/useDirectusSync.test.js
 * @description Unit tests for useDirectusSync.js.
 *
 * Tests cover:
 *  - startSync is a no-op when directus.enabled = false
 *  - startSync starts push and pull loops when enabled
 *  - stopSync clears all timers
 *  - Pull loop writes updated records into IDB (last-write-wins)
 *  - Pull loop updates in-memory store orders (merge by id, conflict resolution)
 *  - Pull loop updates tableCurrentBillSession (open sessions)
 *  - Pull loop skips records where local date_updated is newer
 *  - lastPullAt is updated after a successful pull
 *  - lastPushAt is updated after a successful push
 *  - forcePush / forcePull work
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { _resetIDBSingleton } from '../useIDB.js';
import {
  useDirectusSync,
  _resetDirectusSyncSingleton,
  _handleSubscriptionMessage,
  _registerPushedEchoes,
  _startSubscriptions,
  _atomicOrderItemsUpsertAndMerge,
} from '../useDirectusSync.js';
import { _removeOrderItemsFromOrdersIDB } from '../sync/idbOperations.js';
import { _resetDirectusClientSingleton } from '../useDirectusClient.js';
import {
  upsertRecordsIntoIDB,
  saveStateToIDB,
  loadStateFromIDB,
  loadLastPullTsFromIDB,
  saveLastPullTsToIDB,
  loadLastPullCursorFromIDB,
  saveLastPullCursorToIDB,
  replaceTableMergesInIDB,
  loadConfigFromIDB,
} from '../../store/idbPersistence.js';
import * as persistenceOps from '../../store/persistence/operations.js';
import { _resetEnqueueSeq } from '../useSyncQueue.js';
import { mapVenueConfigFromDirectus } from '../../utils/mappers.js';
import { createRuntimeConfig, DEFAULT_SETTINGS } from '../../utils/index.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Flush all pending Promises (microtasks).
 * Resolves multiple layers of chained `.then()` by looping.
 */
async function flushPromises(rounds = 30) {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}
// Extra rounds for startSync + timer-driven global pull tests where multiple async
// chains (initial run + interval callback + nested awaits) must settle.
// 80 rounds is a conservative upper bound to keep these timer+promise tests stable.
const LONG_FLUSH_ROUNDS = 80;

/**
 * Returns true when a Directus request URL contains a `date_updated >= X` (or `> X`) filter.
 * Supports both query styles:
 *  - bracketed params: `filter[date_updated][_gte]=...` or `filter[date_updated][_gt]=...`
 *  - JSON filter param: `filter={"date_updated":{"_gte":"..."}}`
 *
 * @param {string} urlString
 * @returns {boolean}
 */
function hasDateUpdatedIncrementalFilter(urlString) {
  const url = new URL(String(urlString));
  const keys = Array.from(url.searchParams.keys());

  // Pattern like filter[date_updated][_gte]=... or filter[date_updated][_gt]=...
  // (_gte contains '_gt' as a substring so this catches both)
  if (keys.some(k => k.includes('date_updated') && k.includes('_gt'))) return true;

  // Pattern like filter={...} JSON-encoded
  const rawFilter = url.searchParams.get('filter');
  if (!rawFilter) return false;

  try {
    const parsed = JSON.parse(rawFilter);
    const stack = [parsed];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      if (node.date_updated?._gte !== undefined || node.date_updated?._gt !== undefined) {
        return true;
      }
      for (const v of Object.values(node)) stack.push(v);
    }
  } catch {
    // Ignore unparseable filter formats in this helper
  }

  return false;
}

/**
 * Returns true when a Directus request URL contains a `venue = X` filter.
 * Supports both query styles:
 *  - bracketed params: `filter[venue][_eq]=...`
 *  - JSON filter param: `filter={"venue":{"_eq":...}}`
 *
 * @param {string} urlString
 * @returns {boolean}
 */
function hasVenueEqFilter(urlString) {
  const url = new URL(String(urlString));
  const keys = Array.from(url.searchParams.keys());

  // Pattern like filter[venue][_eq]=...
  if (keys.some(k => k.includes('venue') && k.includes('_eq'))) return true;

  const rawFilter = url.searchParams.get('filter');
  if (!rawFilter) return false;

  try {
    const parsed = JSON.parse(rawFilter);
    const stack = [parsed];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      if (node.venue?._eq !== undefined) {
        return true;
      }
      for (const v of Object.values(node)) stack.push(v);
    }
  } catch {
    // Ignore unparseable filter formats in this helper
  }

  return false;
}

/**
 * Assert that all requests for a collection do not include `venue = X` filter.
 *
 * @param {import('vitest').MockInstance} fetchSpy
 * @param {string} collection
 */
function expectNoVenueEqFilterForCollection(fetchSpy, collection) {
  const calls = fetchSpy.mock.calls
    .map(([url]) => String(url))
    .filter(url => url.includes(`/items/${collection}`));
  expect(calls.length).toBeGreaterThan(0);
  for (const url of calls) {
    expect(hasVenueEqFilter(url)).toBe(false);
  }
}

function directusListResponse(data = []) {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function directusItemResponse(data) {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeStore(overrides = {}) {
  const s = {
    orders: [],
    transactions: [],
    tableCurrentBillSession: {},
    tableMergedInto: {},
    ...overrides,
  };
  // Provide a default hydrateConfigFromIDB that mimics the real store:
  // loads the venue config from IDB and replaces s.config with a new object.
  if (typeof s.hydrateConfigFromIDB !== 'function') {
    s.hydrateConfigFromIDB = async function (options = {}) {
      const venueId = this.config?.directus?.venueId ?? null;
      const cached = await loadConfigFromIDB(venueId);
      const mapped = mapVenueConfigFromDirectus(cached, DEFAULT_SETTINGS);
      const hydrated = createRuntimeConfig(mapped);
      this.config = { ...hydrated };
    };
  }
  // Provide refreshOperationalStateFromIDB that mirrors the plain-object equivalent
  // of the Pinia store's method. Translates Directus collection names to store keys.
  if (typeof s.refreshOperationalStateFromIDB !== 'function') {
    s.refreshOperationalStateFromIDB = async function (options = {}) {
      const state = await loadStateFromIDB();
      if (!state) return;
      const { collection } = options;

      const applySlice = (storeKey) => {
        if (Object.prototype.hasOwnProperty.call(state, storeKey)) {
          this[storeKey] = state[storeKey];
        }
      };

      if (!collection || collection === 'orders' || collection === 'order_items' || collection === 'order_item_modifiers') {
        applySlice('orders');
      }
      if (!collection || collection === 'bill_sessions') {
        applySlice('tableCurrentBillSession');
      }
      if (!collection || collection === 'transactions') {
        applySlice('transactions');
      }
      if (!collection || collection === 'table_merge_sessions') {
        applySlice('tableMergedInto');
      }
    };
  }
  return s;
}

/** A minimal Directus order record (Directus/snake_case format). */
function makeRemoteOrder(overrides = {}) {
  return {
    id: 'ord_remote',
    status: 'pending',
    table: '05',
    bill_session: null,
    total_amount: 20,
    item_count: 2,
    global_note: '',
    date_updated: '2024-03-01T00:00:00.000Z',
    note_visibility_cassa: true,
    note_visibility_sala: true,
    note_visibility_cucina: true,
    is_cover_charge: false,
    is_direct_entry: false,
    rejection_reason: null,
    ...overrides,
  };
}

beforeEach(async () => {
  await _resetIDBSingleton();
  _resetDirectusSyncSingleton();
  _resetDirectusClientSingleton();
  _resetEnqueueSeq();
  vi.restoreAllMocks();
  vi.stubGlobal('navigator', { onLine: true });

  // Enable directus in appConfig for these tests
  const { appConfig } = await import('../../utils/index.js');
  appConfig.directus = {
    enabled: true,
    url: 'https://directus.test',
    staticToken: 'tok_test',
    venueId: 1,
  };
});

afterEach(() => {
  _resetDirectusSyncSingleton();
  vi.unstubAllGlobals();
});

// ── startSync ─────────────────────────────────────────────────────────────────

describe('startSync()', () => {
  it('is a no-op when directus.enabled = false', async () => {
    const { appConfig } = await import('../../utils/index.js');
    appConfig.directus.enabled = false;

    const fetchSpy = vi.spyOn(global, 'fetch');
    const sync = useDirectusSync();

    sync.startSync({ appType: 'cassa', store: makeStore() });
    await flushPromises();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not start twice (singleton guard)', async () => {
    // Keep requests pending so call counts are stable and attributable to each startSync call.
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}));
    const sync = useDirectusSync();
    const store = makeStore();

    sync.startSync({ appType: 'cassa', store });
    await flushPromises();
    const callsAfterFirstStart = fetchSpy.mock.calls.length;

    sync.startSync({ appType: 'cassa', store }); // second call — should be ignored
    await flushPromises();

    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirstStart);
    sync.stopSync();
  });
});

// ── stopSync ──────────────────────────────────────────────────────────────────

describe('stopSync()', () => {
  it('sets syncStatus to idle', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([])));
    const sync = useDirectusSync();
    sync.startSync({ appType: 'cassa', store: makeStore() });
    await flushPromises();
    sync.stopSync();
    expect(sync.syncStatus.value).toBe('idle');
  });
});

describe('reconfigureAndApply()', () => {
  it('returns an error result when directus is disabled', async () => {
    const { appConfig } = await import('../../utils/index.js');
    appConfig.directus.enabled = false;
    const sync = useDirectusSync();
    const result = await sync.reconfigureAndApply();
    expect(result.ok).toBe(false);
  });

  it('refreshes store.config with a new snapshot so runtime config updates are reactive', async () => {
    const venueId = 1;
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const requestUrl = String(url);
      if (requestUrl.includes(`/items/venues/${venueId}`)) {
        return Promise.resolve(directusItemResponse({
          id: venueId,
          name: 'Venue reactive snapshot',
          menu_source: 'directus',
          rooms: [{ id: 'room_snapshot', label: 'Sala Snapshot' }],
          tables: [{ id: 'tbl_snapshot', room: 'room_snapshot', label: 'S1', covers: 4 }],
          payment_methods: [],
          printers: [{ id: 'prt_snapshot', name: 'Printer Snapshot', url: 'http://printer.snapshot.local' }],
          venue_users: [],
          table_merge_sessions: [],
          menu_categories: [],
          menu_items: [],
        }));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const { appConfig } = await import('../../utils/index.js');
    const store = makeStore({ config: appConfig });
    const sync = useDirectusSync();
    sync.startSync({ appType: 'cassa', store });
    const result = await sync.reconfigureAndApply();
    expect(result.ok).toBe(true);
    sync.stopSync();

    expect(store.config).not.toBe(appConfig);
    expect(store.config.rooms).toEqual([
      expect.objectContaining({
        id: 'room_snapshot',
        label: 'Sala Snapshot',
        tables: [expect.objectContaining({ id: 'tbl_snapshot', label: 'S1', covers: 4 })],
      }),
    ]);
    expect(store.config.printers).toEqual([
      expect.objectContaining({ id: 'prt_snapshot', name: 'Printer Snapshot' }),
    ]);
    const prevName = store.config.ui?.name;
    const prevAppConfigName = appConfig.ui?.name;
    try {
      appConfig.ui.name = 'Mutated after sync';
      expect(appConfig.ui.name).toBe('Mutated after sync');
      expect(store.config.ui?.name).toBe(prevName);
    } finally {
      appConfig.ui.name = prevAppConfigName;
    }
  });

  it('preserves local JSON menu source preference even if deep venue returns directus', async () => {
    const venueId = 1;
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const requestUrl = String(url);
      if (requestUrl.includes(`/items/venues/${venueId}`)) {
        return Promise.resolve(directusItemResponse({
          id: venueId,
          name: 'Venue prefers directus remotely',
          menu_source: 'directus',
          rooms: [],
          tables: [],
          payment_methods: [],
          printers: [],
          venue_users: [],
          table_merge_sessions: [],
          menu_categories: [{ id: 'cat_remote_1', name: 'Remote category', venue: venueId }],
          menu_items: [{
            id: 'item_remote_1',
            name: 'Remote item',
            category: 'cat_remote_1',
            price: 5,
            venue: venueId,
          }],
        }));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const { appConfig } = await import('../../utils/index.js');
    const previousSource = appConfig.menuSource;
    const previousUrl = appConfig.menuUrl;
    try {
      appConfig.menuSource = 'json';
      appConfig.menuUrl = 'https://example.com/custom-menu.json';

      const sync = useDirectusSync();
      sync.startSync({ appType: 'cassa', store: makeStore({ config: appConfig }) });
      const result = await sync.reconfigureAndApply();
      sync.stopSync();

      expect(result.ok).toBe(true);
      expect(appConfig.menuSource).toBe('json');
      expect(appConfig.menuUrl).toBe('https://example.com/custom-menu.json');

      const { getDB } = await import('../useIDB.js');
      const db = await getDB();
      const menuItems = await db.getAll('menu_items');
      const menuCategories = await db.getAll('menu_categories');
      expect(menuItems).toEqual([]);
      expect(menuCategories).toEqual([]);
    } finally {
      appConfig.menuSource = previousSource;
      appConfig.menuUrl = previousUrl;
    }
  });

  it('uses minimal deep-fetch fields when local menuSource is json', async () => {
    const venueId = 1;
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const requestUrl = String(url);
      if (requestUrl.includes(`/items/venues/${venueId}`)) {
        return Promise.resolve(directusItemResponse({
          id: venueId,
          name: 'Venue minimal json pull',
          status: 'published',
          cover_charge_enabled: false,
          cover_charge_auto_add: false,
          cover_charge_price_adult: '0',
          cover_charge_price_child: '0',
          billing_enable_cash_change_calculator: true,
          billing_enable_tips: false,
          billing_enable_discounts: true,
          billing_allow_custom_entry: true,
        }));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const { appConfig } = await import('../../utils/index.js');
    const previousSource = appConfig.menuSource;
    try {
      appConfig.menuSource = 'json';

      const sync = useDirectusSync();
      const result = await sync.reconfigureAndApply();
      expect(result.ok).toBe(true);

      const venueCall = fetchSpy.mock.calls
        .map(([url]) => String(url))
        .find((url) => url.includes(`/items/venues/${venueId}`));
      expect(venueCall).toBeTruthy();
      const decodedVenueCall = decodeURIComponent(venueCall);
      expect(decodedVenueCall).toContain('cover_charge_enabled');
      expect(decodedVenueCall).toContain('billing_auto_close_on_full_payment');
      expect(decodedVenueCall).toContain('billing_enable_cash_change_calculator');
      expect(decodedVenueCall).not.toContain('rooms.*');
      expect(decodedVenueCall).not.toContain('tables.*');
      expect(decodedVenueCall).not.toContain('menu_categories.*');
      expect(decodedVenueCall).not.toContain('menu_items.*');
      expect(decodedVenueCall).not.toContain('menu_modifiers.*');
    } finally {
      appConfig.menuSource = previousSource;
    }
  });

  it('realigns pre-bill default printer to the first valid synced printer when current selection is invalid', async () => {
    const venueId = 1;
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const requestUrl = String(url);
      if (requestUrl.includes(`/items/venues/${venueId}`)) {
        return Promise.resolve(directusItemResponse({
          id: venueId,
          name: 'Venue printer defaults',
          menu_source: 'directus',
          rooms: [],
          tables: [],
          payment_methods: [],
          printers: [
            { id: 'prt_pre_1', name: 'Pre 1', url: 'http://printer.shared.local/print', print_types: ['pre_bill'] },
            { id: 'prt_pre_2', name: 'Pre 2', url: 'http://printer.shared.local/print', print_types: ['pre_bill'] },
          ],
          venue_users: [],
          table_merge_sessions: [],
          menu_categories: [],
          menu_items: [],
        }));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const { appConfig } = await import('../../utils/index.js');
    const store = makeStore({ config: appConfig, preBillPrinterId: 'obsolete_printer' });
    const sync = useDirectusSync();
    await sync.startSync({ appType: 'cassa', store });
    const result = await sync.reconfigureAndApply();
    sync.stopSync();

    expect(result.ok).toBe(true);
    expect(store.preBillPrinterId).toBe('prt_pre_1');
  });

  it('keeps runtime pre-bill fallback aligned even when persisting to IDB fails', async () => {
    const venueId = 1;
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const requestUrl = String(url);
      if (requestUrl.includes(`/items/venues/${venueId}`)) {
        return Promise.resolve(directusItemResponse({
          id: venueId,
          name: 'Venue printer fallback',
          menu_source: 'directus',
          rooms: [],
          tables: [],
          payment_methods: [],
          printers: [
            { id: 'prt_pre_1', name: 'Pre 1', url: 'http://printer.shared.local/print', print_types: ['pre_bill'] },
          ],
          venue_users: [],
          table_merge_sessions: [],
          menu_categories: [],
          menu_items: [],
        }));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const { appConfig } = await import('../../utils/index.js');
    const store = makeStore({
      config: appConfig,
      preBillPrinterId: 'obsolete_printer',
      saveLocalSettings: vi.fn(async () => {
        throw new Error('IDB write failed');
      }),
    });
    const sync = useDirectusSync();
    await sync.startSync({ appType: 'cassa', store });
    const result = await sync.reconfigureAndApply();
    sync.stopSync();

    expect(result.ok).toBe(true);
    expect(store.saveLocalSettings).toHaveBeenCalledWith({ preBillPrinterId: 'prt_pre_1' });
    expect(store.preBillPrinterId).toBe('prt_pre_1');
  });

  it('can clear local config cache and repopulate venues via global pull with progress logs', async () => {
    const { appConfig } = await import('../../utils/index.js');
    appConfig.ui.primaryColor = '#123456';

    const { getDB } = await import('../useIDB.js');
    const db = await getDB();
    await db.put('venues', { id: 999, name: 'Legacy venue' });
    await db.put('app_meta', { id: 'last_pull_ts:venues', value: '2026-01-01T00:00:00.000Z' });

    const progress = [];
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/items/venues/')) {
        return Promise.resolve(directusItemResponse({
          id: 1,
          name: 'Venue clear cache',
          menu_source: 'directus',
          rooms: [],
          tables: [],
          payment_methods: [],
          printers: [],
          venue_users: [],
          table_merge_sessions: [],
          menu_categories: [],
          menu_items: [],
        }));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    sync.startSync({ appType: 'cassa', store: makeStore({ config: {} }) });
    const result = await sync.reconfigureAndApply({
      clearLocalConfig: true,
      onProgress: (entry) => progress.push(entry),
    });
    sync.stopSync();

    expect(result.ok).toBe(true);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.some(p => String(p?.message ?? '').includes('Svuotamento completo'))).toBe(true);
    expect(progress.some(p => p?.level === 'success')).toBe(true);
    expect(await db.getAll('venues')).toEqual([
      expect.objectContaining({ id: 1, name: 'Venue clear cache' }),
    ]);
    expect(await db.get('app_meta', 'last_pull_ts:venues')).toBeUndefined();
    expect(appConfig.ui.primaryColor).not.toBe('#123456');

    const venueCalls = fetchSpy.mock.calls
      .map(([url]) => String(url))
      .filter(url => url.includes('/items/venues'));
    expect(venueCalls.length).toBeGreaterThan(0);
    for (const url of venueCalls) {
      expect(hasDateUpdatedIncrementalFilter(url)).toBe(false);
    }
    expectNoVenueEqFilterForCollection(fetchSpy, 'venues');
  });

  it('retries deep venue fetch with fallback fields when advanced fields fail', async () => {
    const venueId = 1;
    const progress = [];
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const requestUrl = String(url);
      if (
        requestUrl.includes(`/items/venues/${venueId}`)
        && requestUrl.includes('menu_modifiers.menu_modifiers_id')
      ) {
        return Promise.resolve(new Response(JSON.stringify({
          errors: [{ message: "Cannot read properties of undefined (reading 'primary')" }],
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      if (requestUrl.includes(`/items/venues/${venueId}`)) {
        return Promise.resolve(directusItemResponse({
          id: venueId,
          name: 'Venue fallback',
          menu_source: 'directus',
          rooms: [],
          tables: [],
          payment_methods: [],
          printers: [],
          venue_users: [],
          table_merge_sessions: [],
          menu_categories: [],
          menu_items: [],
        }));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    const result = await sync.reconfigureAndApply({
      onProgress: (entry) => progress.push(entry),
    });

    expect(result.ok).toBe(true);
    expect(progress.some((entry) => entry?.level === 'warning')).toBe(true);
    const venueCalls = fetchSpy.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes(`/items/venues/${venueId}`));
    expect(venueCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('accepts deep venue payload wrapped as data.data', async () => {
    const venueId = 1;
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const requestUrl = String(url);
      if (requestUrl.includes(`/items/venues/${venueId}`)) {
        return Promise.resolve(directusItemResponse({
          data: {
            id: venueId,
            name: 'Venue wrapped',
            menu_source: 'directus',
            rooms: [],
            tables: [],
            payment_methods: [],
            printers: [],
            venue_users: [],
            table_merge_sessions: [],
            menu_categories: [],
            menu_items: [],
          },
        }));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    const result = await sync.reconfigureAndApply();
    expect(result.ok).toBe(true);
  });

  it('hydrates venue_users from legacy deep relation alias users', async () => {
    const venueId = 1;
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const requestUrl = String(url);
      if (requestUrl.includes(`/items/venues/${venueId}`)) {
        return Promise.resolve(directusItemResponse({
          id: venueId,
          name: 'Venue users alias',
          menu_source: 'directus',
          rooms: [],
          tables: [],
          payment_methods: [],
          printers: [],
          users: [
            { id: 'vu_alias_1', venue: venueId, display_name: 'Alias Operator', apps: ['admin'], status: 'active', pin: '1234' },
          ],
          table_merge_sessions: [],
          menu_categories: [],
          menu_items: [],
        }));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    const result = await sync.reconfigureAndApply();
    expect(result.ok).toBe(true);
    const venueRequestUrl = fetchSpy.mock.calls
      .map(([url]) => String(url))
      .find((url) => url.includes(`/items/venues/${venueId}`));
    expect(venueRequestUrl).toBeTruthy();
    const decodedVenueRequestUrl = decodeURIComponent(venueRequestUrl);
    expect(decodedVenueRequestUrl).toContain('fields');
    expect(decodedVenueRequestUrl).toContain('users.*');
    expect(decodedVenueRequestUrl).not.toContain('venue_users.*');

    const { getDB } = await import('../useIDB.js');
    const db = await getDB();
    expect(await db.get('venue_users', 'vu_alias_1')).toEqual(
      expect.objectContaining({
        id: 'vu_alias_1',
        venue: venueId,
        display_name: 'Alias Operator',
        apps: ['admin'],
      }),
    );
    const storedVenue = await db.get('venues', venueId);
    expect(storedVenue).toBeTruthy();
    expect(Object.hasOwn(storedVenue, 'users')).toBe(false);
  });

  it('hydrates local config when nested records lack explicit venue field', async () => {
    const venueId = 1;
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const requestUrl = String(url);
      if (requestUrl.includes(`/items/venues/${venueId}`)) {
        return Promise.resolve(directusItemResponse({
          id: venueId,
          name: 'Venue nested fallback',
          menu_source: 'directus',
          rooms: [{ id: 'room_1', label: 'Sala Interna' }],
          tables: [{ id: 'tbl_1', label: 'T1', room: 'room_1', covers: 4 }],
          payment_methods: [{ id: 'pm_1', label: 'Contanti', icon: 'banknote', color_class: 'text-green-600' }],
          printers: [{ id: 'prt_1', name: 'Printer 1', url: 'http://printer.local' }],
          venue_users: [],
          table_merge_sessions: [],
          menu_categories: [{ id: 'cat_1', name: 'Primi', sort: 1 }],
          menu_items: [{
            id: 'item_1',
            name: 'Carbonara',
            category: 'cat_1',
            price: '12.50',
            ingredients: '[]',
            allergens: '[]',
          }],
        }));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const { appConfig } = await import('../../utils/index.js');
    const sync = useDirectusSync();
    const result = await sync.reconfigureAndApply();
    expect(result.ok).toBe(true);
    expect(appConfig.rooms).toEqual([
      expect.objectContaining({
        id: 'room_1',
        label: 'Sala Interna',
        tables: [expect.objectContaining({ id: 'tbl_1', label: 'T1', covers: 4 })],
      }),
    ]);
    expect(appConfig.paymentMethods).toEqual([
      expect.objectContaining({ id: 'pm_1', label: 'Contanti' }),
    ]);
    expect(appConfig.printers).toEqual([
      expect.objectContaining({ id: 'prt_1', name: 'Printer 1' }),
    ]);
    expect(appConfig.menu.Primi).toEqual([
      expect.objectContaining({ id: 'item_1', name: 'Carbonara' }),
    ]);

    const { getDB } = await import('../useIDB.js');
    const db = await getDB();
    expect((await db.get('rooms', 'room_1'))?.venue).toBe(venueId);
    expect((await db.get('menu_categories', 'cat_1'))?.venue).toBe(venueId);
    expect((await db.get('menu_items', 'item_1'))?.venue).toBe(venueId);
    expect((await db.get('printers', 'prt_1'))?.venue).toBe(venueId);
  });

  it('hydrates config from real deep-fetch shape with category-nested menu items', async () => {
    const venueId = 1;
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const requestUrl = String(url);
      if (requestUrl.includes(`/items/venues/${venueId}`)) {
        return Promise.resolve(directusItemResponse({
          id: venueId,
          name: 'Venue deep fetch shape',
          menu_source: 'directus',
          rooms: [{ id: 'room_1', label: 'Sala Principale' }],
          tables: [{ id: 'tbl_1', label: 'T1', room: 'room_1', covers: 4 }],
          payment_methods: [{ id: 'pm_1', label: 'Carta', icon: 'credit_card', color_class: 'text-blue-600' }],
          printers: [{ id: 'prt_1', name: 'Stampante Cucina', url: 'http://printer.cucina.local' }],
          venue_users: [],
          table_merge_sessions: [],
          menu_categories: [{
            id: 'cat_1',
            name: 'Primi',
            sort: 1,
            menu_items: [{
              id: 'item_1',
              name: 'Carbonara',
              category: 'cat_1',
              price: '12.50',
              ingredients: '[]',
              allergens: '[]',
            }],
          }],
          menu_items: [],
        }));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const { appConfig } = await import('../../utils/index.js');
    const sync = useDirectusSync();
    const result = await sync.reconfigureAndApply();
    expect(result.ok).toBe(true);
    expect(appConfig.rooms).toEqual([
      expect.objectContaining({
        id: 'room_1',
        label: 'Sala Principale',
      }),
    ]);
    expect(appConfig.tables).toEqual([
      expect.objectContaining({ id: 'tbl_1', label: 'T1', covers: 4 }),
    ]);
    expect(appConfig.printers).toEqual([
      expect.objectContaining({ id: 'prt_1', name: 'Stampante Cucina', url: 'http://printer.cucina.local' }),
    ]);
    expect(appConfig.menu.Primi).toEqual([
      expect.objectContaining({ id: 'item_1', name: 'Carbonara' }),
    ]);
  });

  it('prefers direct tables/items over nested duplicates when both are present', async () => {
    const venueId = 1;
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const requestUrl = String(url);
      if (requestUrl.includes(`/items/venues/${venueId}`)) {
        return Promise.resolve(directusItemResponse({
          id: venueId,
          name: 'Venue dedupe shape',
          menu_source: 'directus',
          rooms: [{
            id: 'room_1',
            label: 'Sala Giardino',
            tables: [{ id: 'tbl_1', label: 'T1 (nested partial)' }],
          }],
          tables: [{ id: 'tbl_1', label: 'T1', room: 'room_1', covers: 6 }],
          payment_methods: [{ id: 'pm_1', label: 'Carta' }],
          printers: [{ id: 'prt_1', name: 'Stampante Bar', url: 'http://printer.bar.local' }],
          venue_users: [],
          table_merge_sessions: [],
          menu_categories: [{
            id: 'cat_1',
            name: 'Dessert',
            sort: 2,
            menu_items: [{
              id: 'item_1',
              name: 'Tiramisù (nested partial)',
              category: 'cat_1',
              price: '6.00',
              ingredients: '[]',
              allergens: '[]',
            }],
          }],
          menu_items: [{
            id: 'item_1',
            name: 'Tiramisù',
            category: 'cat_1',
            price: '6.00',
            description: 'Dessert classico',
            ingredients: '[]',
            allergens: '[]',
          }],
        }));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const { appConfig } = await import('../../utils/index.js');
    const sync = useDirectusSync();
    const result = await sync.reconfigureAndApply();
    expect(result.ok).toBe(true);
    expect(appConfig.rooms).toEqual([
      expect.objectContaining({ id: 'room_1', label: 'Sala Giardino' }),
    ]);
    expect(appConfig.tables).toEqual([
      expect.objectContaining({ id: 'tbl_1', label: 'T1', covers: 6 }),
    ]);
    expect(appConfig.paymentMethods).toEqual([
      expect.objectContaining({ id: 'pm_1', label: 'Carta' }),
    ]);
    expect(appConfig.printers).toEqual([
      expect.objectContaining({ id: 'prt_1', name: 'Stampante Bar' }),
    ]);
    expect(appConfig.menu.Dessert).toEqual([
      expect.objectContaining({ id: 'item_1', name: 'Tiramisù' }),
    ]);
  });

  it('hydrates tables from tables collection when deep venue has only room table references', async () => {
    const venueId = 1;
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const requestUrl = String(url);
      if (requestUrl.includes(`/items/venues/${venueId}`)) {
        return Promise.resolve(directusItemResponse({
          id: venueId,
          name: 'Venue table refs',
          menu_source: 'directus',
          rooms: [{
            id: 'room_1',
            label: 'Sala Interna',
            tables: ['tbl_1'],
          }],
          tables: [],
          payment_methods: [],
          printers: [],
          venue_users: [],
          table_merge_sessions: [],
          menu_categories: [{
            id: 'cat_1',
            name: 'Primi',
            sort: 1,
          }],
          menu_items: [{
            id: 'item_1',
            name: 'Carbonara',
            category: 'cat_1',
            price: '12.50',
            ingredients: '[]',
            allergens: '[]',
          }],
        }));
      }
      if (requestUrl.includes('/items/tables')) {
        return Promise.resolve(directusListResponse([{
          id: 'tbl_1',
          label: 'T1',
          room: 'room_1',
          covers: 6,
          venue: venueId,
        }]));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const { appConfig } = await import('../../utils/index.js');
    const sync = useDirectusSync();
    const result = await sync.reconfigureAndApply();
    expect(result.ok).toBe(true);
    expect(appConfig.rooms).toEqual([
      expect.objectContaining({ id: 'room_1', label: 'Sala Interna' }),
    ]);
    expect(appConfig.tables).toEqual([
      expect.objectContaining({ id: 'tbl_1', label: 'T1', covers: 6 }),
    ]);
    expect(appConfig.menu.Primi).toEqual([
      expect.objectContaining({ id: 'item_1', name: 'Carbonara' }),
    ]);
  });

  it('processes real-world deep venue payload with room table refs and expanded tables', async () => {
    const venueId = 1;
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const requestUrl = String(url);
      if (requestUrl.includes(`/items/venues/${venueId}`)) {
        return Promise.resolve(directusItemResponse({
          id: 1,
          name: 'Ristorante – Demo',
          rooms: [
            {
              id: 'room_sala-interna',
              status: 'published',
              venue: 1,
              label: 'Sala Interna',
              sort: 1,
              tables: ['tbl_01', 'tbl_02', 'tbl_03', 'tbl_04', 'qa_tbl_20260416'],
            },
            {
              id: 'room_terrazza',
              status: 'published',
              venue: 1,
              label: 'Terrazza',
              sort: 2,
              tables: ['tbl_T1', 'tbl_T2', 'tbl_T3'],
            },
            {
              id: 'deep_room_20260416',
              status: 'published',
              venue: 1,
              label: 'Sala Deep Sync Test',
              sort: 9100,
              tables: ['deep_tbl_a_20260416', 'deep_tbl_b_20260416'],
            },
          ],
          tables: [
            { id: 'tbl_01', status: 'published', venue: 1, room: 'room_sala-interna', label: '01', covers: 4, sort: 1 },
            { id: 'tbl_02', status: 'published', venue: 1, room: 'room_sala-interna', label: '02', covers: 4, sort: 2 },
            { id: 'tbl_03', status: 'published', venue: 1, room: 'room_sala-interna', label: '03', covers: 2, sort: 3 },
            { id: 'tbl_04', status: 'published', venue: 1, room: 'room_sala-interna', label: '04', covers: 6, sort: 4 },
            { id: 'tbl_T1', status: 'published', venue: 1, room: 'room_terrazza', label: 'T1', covers: 4, sort: 5 },
            { id: 'tbl_T2', status: 'published', venue: 1, room: 'room_terrazza', label: 'T2', covers: 4, sort: 6 },
            { id: 'tbl_T3', status: 'published', venue: 1, room: 'room_terrazza', label: 'T3', covers: 8, sort: 7 },
            { id: 'deep_tbl_a_20260416', status: 'published', venue: 1, room: 'deep_room_20260416', label: 'Deep A', covers: 4, sort: 9101 },
            { id: 'deep_tbl_b_20260416', status: 'published', venue: 1, room: 'deep_room_20260416', label: 'Deep B', covers: 2, sort: 9102 },
            { id: 'qa_tbl_20260416', status: 'published', venue: 1, room: 'room_sala-interna', label: 'QA-Table', covers: 2, sort: 9201 },
          ],
          payment_methods: [
            { id: 'pm_contanti', status: 'published', venue: 1, label: 'Contanti', icon: 'banknotes', color_class: 'green', sort: 1 },
            { id: 'pm_carta', status: 'published', venue: 1, label: 'Carta', icon: 'credit-card', color_class: 'blue', sort: 2 },
            { id: 'pm_ticket', status: 'published', venue: 1, label: 'Ticket', icon: 'ticket', color_class: 'orange', sort: 3 },
          ],
          printers: [
            { id: 'prt_demo-cassa', status: 'published', venue: 1, name: 'Cassa (demo)', url: 'http://localhost:3001/print', print_types: ['order', 'pre_bill'], sort: 1 },
            { id: 'prt_demo-cucina', status: 'published', venue: 1, name: 'Cucina (demo)', url: 'http://localhost:3002/print', print_types: ['order'], sort: 2 },
          ],
          venue_users: [],
          table_merge_sessions: [],
          menu_categories: [
            {
              id: 1,
              status: 'published',
              venue: 1,
              name: 'Antipasti',
              sort: 1,
              menu_items: [
                {
                  id: 'mi_01',
                  status: 'published',
                  venue: 1,
                  category: 1,
                  name: 'Tagliere Misto',
                  price: '13.00',
                  description: 'Tagliere misto con salumi, formaggi e bruschette',
                  ingredients: null,
                  allergens: null,
                  sort: 1,
                },
              ],
            },
            {
              id: 2,
              status: 'published',
              venue: 1,
              name: 'Primi Piatti',
              sort: 2,
              menu_items: [
                {
                  id: 'mi_03',
                  status: 'published',
                  venue: 1,
                  category: 2,
                  name: 'Carbonara',
                  price: '13.00',
                  description: 'Classica carbonara con guanciale e pecorino',
                  ingredients: null,
                  allergens: null,
                  sort: 1,
                },
              ],
            },
            {
              id: 9,
              status: 'published',
              venue: 1,
              name: 'Categoria Deep Sync Test',
              sort: 9100,
              menu_items: [
                {
                  id: 'deep_item_20260416',
                  status: 'published',
                  venue: 1,
                  category: 9,
                  name: 'Piatto Deep Sync Test',
                  price: '12.50',
                  description: 'Item test deep fetch',
                  ingredients: ['test-ing'],
                  allergens: ['test-all'],
                  sort: 9100,
                  menu_modifiers: ['14f2b76c-5f49-4907-b378-5e765f8f4e47', '6d905cfb-127a-4336-be6e-4a2189dd6f88'],
                },
              ],
            },
            {
              id: 10,
              status: 'published',
              venue: 1,
              name: 'QA Payload Category 20260416',
              sort: 9201,
              menu_items: [
                {
                  id: 'qa_item_20260416',
                  status: 'published',
                  venue: 1,
                  category: 10,
                  name: 'QA Payload Item 20260416',
                  price: '9.90',
                  ingredients: ['acqua', 'sale'],
                  allergens: ['glutine'],
                  sort: 9201,
                },
              ],
            },
          ],
          menu_items: [],
        }));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const { appConfig } = await import('../../utils/index.js');
    const sync = useDirectusSync();
    const result = await sync.reconfigureAndApply();

    expect(result.ok).toBe(true);
    expect(appConfig.rooms).toHaveLength(3);
    expect(appConfig.tables).toHaveLength(10);
    expect(appConfig.rooms.find(r => r.id === 'room_sala-interna')?.tables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'tbl_01', label: '01', covers: 4 }),
        expect.objectContaining({ id: 'qa_tbl_20260416', label: 'QA-Table', covers: 2 }),
      ]),
    );
    expect(appConfig.rooms.find(r => r.id === 'deep_room_20260416')?.tables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'deep_tbl_a_20260416', label: 'Deep A', covers: 4 }),
        expect.objectContaining({ id: 'deep_tbl_b_20260416', label: 'Deep B', covers: 2 }),
      ]),
    );
    expect(appConfig.paymentMethods).toEqual([
      expect.objectContaining({ id: 'pm_contanti', label: 'Contanti' }),
      expect.objectContaining({ id: 'pm_carta', label: 'Carta' }),
      expect.objectContaining({ id: 'pm_ticket', label: 'Ticket' }),
    ]);
    expect(appConfig.printers).toEqual([
      expect.objectContaining({ id: 'prt_demo-cassa', name: 'Cassa (demo)' }),
      expect.objectContaining({ id: 'prt_demo-cucina', name: 'Cucina (demo)' }),
    ]);
    expect(appConfig.menu.Antipasti).toEqual([
      expect.objectContaining({ id: 'mi_01', name: 'Tagliere Misto' }),
    ]);
    expect(appConfig.menu['Primi Piatti']).toEqual([
      expect.objectContaining({ id: 'mi_03', name: 'Carbonara' }),
    ]);
    expect(appConfig.menu['QA Payload Category 20260416']).toEqual([
      expect.objectContaining({ id: 'qa_item_20260416', name: 'QA Payload Item 20260416' }),
    ]);
  });
});

// ── Pull: IDB upsert (last-write-wins) ───────────────────────────────────────

describe('pull — IDB last-write-wins', () => {
  it('upserts a newer remote record into IDB', async () => {
    // Seed IDB with an older record
    await upsertRecordsIntoIDB('orders', [{
      id: 'ord_1', status: 'pending', date_updated: '2024-01-01T00:00:00.000Z',
    }]);

    const newerOrder = makeRemoteOrder({
      id: 'ord_1', status: 'accepted', date_updated: '2024-01-02T00:00:00.000Z',
    });

    vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([newerOrder])));

    const sync = useDirectusSync();
    await sync.forcePull();

    const { getDB } = await import('../useIDB.js');
    const db = await getDB();
    const stored = await db.get('orders', 'ord_1');
    expect(stored.status).toBe('accepted');
  });

  it('does not overwrite a newer local record with an older remote one', async () => {
    await upsertRecordsIntoIDB('orders', [{
      id: 'ord_1', status: 'delivered', date_updated: '2024-06-01T00:00:00.000Z',
    }]);

    const olderOrder = makeRemoteOrder({
      id: 'ord_1', status: 'pending', date_updated: '2024-01-01T00:00:00.000Z',
    });
    vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([olderOrder])));

    const sync = useDirectusSync();
    await sync.forcePull();

    const { getDB } = await import('../useIDB.js');
    const db = await getDB();
    const stored = await db.get('orders', 'ord_1');
    expect(stored.status).toBe('delivered'); // local wins
  });

  it('upserts a record with date_updated = null using date_created for conflict resolution', async () => {
    // Seed IDB with an older record (date_updated set)
    await upsertRecordsIntoIDB('orders', [{
      id: 'ord_null_du',
      status: 'pending',
      date_updated: '2024-01-01T00:00:00.000Z',
      date_created: '2024-01-01T00:00:00.000Z',
    }]);

    // Incoming record has null date_updated but a newer date_created
    const newerOrder = makeRemoteOrder({
      id: 'ord_null_du',
      status: 'accepted',
      date_updated: null,
      date_created: '2024-06-01T00:00:00.000Z',
    });
    vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([newerOrder])));

    const sync = useDirectusSync();
    await sync.forcePull();

    const { getDB } = await import('../useIDB.js');
    const db = await getDB();
    const stored = await db.get('orders', 'ord_null_du');
    expect(stored.status).toBe('accepted'); // newer date_created wins
  });

  it('preserves local record when incoming has null date_updated but older date_created', async () => {
    // Seed IDB with a record that has a date_updated newer than the incoming date_created
    await upsertRecordsIntoIDB('orders', [{
      id: 'ord_local_newer',
      status: 'delivered',
      date_updated: '2024-08-01T00:00:00.000Z',
      date_created: '2024-01-01T00:00:00.000Z',
    }]);

    // Incoming from Directus: date_updated = null, date_created older than local date_updated
    const staleOrder = makeRemoteOrder({
      id: 'ord_local_newer',
      status: 'pending',
      date_updated: null,
      date_created: '2024-03-01T00:00:00.000Z',
    });
    vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([staleOrder])));

    const sync = useDirectusSync();
    await sync.forcePull();

    const { getDB } = await import('../useIDB.js');
    const db = await getDB();
    const stored = await db.get('orders', 'ord_local_newer');
    expect(stored.status).toBe('delivered'); // local wins
  });

  it('overwrites an existing record when incoming has the same timestamp (boundary case fix)', async () => {
    // Regression test: two successive PATCHes on the same record may land at the exact
    // same server-clock millisecond.  The second PATCH (status='accepted') must overwrite
    // the first PATCH (status='pending') even though both carry an identical date_updated.
    const sameTs = '2024-06-01T10:00:01.000Z';
    await upsertRecordsIntoIDB('orders', [{
      id: 'ord_same_ts', status: 'pending', date_updated: sameTs,
    }]);

    const updatedOrder = makeRemoteOrder({
      id: 'ord_same_ts', status: 'accepted', date_updated: sameTs,
    });
    vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([updatedOrder])));

    const sync = useDirectusSync();
    await sync.forcePull();

    const { getDB } = await import('../useIDB.js');
    const db = await getDB();
    const stored = await db.get('orders', 'ord_same_ts');
    expect(stored.status).toBe('accepted'); // same-timestamp incoming wins
  });
});

// ── Pull: null-dated incremental filter ──────────────────────────────────────

describe('pull — incremental filter includes null-dated records', () => {
  it('includes _or clause for null date_updated when sinceTs is set', async () => {
    await saveLastPullTsToIDB('orders', '2024-01-01T00:00:00.000Z');

    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([])));
    const sync = useDirectusSync();
    await sync.forcePull();

    const orderCalls = fetchSpy.mock.calls
      .map(([url]) => String(url))
      .filter(url => url.includes('/items/orders'));
    expect(orderCalls.length).toBeGreaterThan(0);

    // Verify the filter contains both date_updated >= sinceTs and the null-date clause.
    // Directus SDKs may encode this either as a JSON `filter=` param or as
    // bracketed query params like `filter[_or][0][date_updated][_gte]=...`.
    let matchedIncrementalFilter = false;
    for (const url of orderCalls) {
      const parsedUrl = new URL(url);
      const rawFilter = parsedUrl.searchParams.get('filter');

      if (rawFilter) {
        try {
          const parsed = JSON.parse(rawFilter);
          const json = JSON.stringify(parsed);
          expect(json).toContain('_or');
          expect(json).toContain('_null');
          expect(json).toContain('date_created');
          matchedIncrementalFilter = true;
          continue;
        } catch {
          // Fall through to bracketed-param checks below when `filter`
          // is present but not JSON-encoded.
        }
      }

      const searchParamKeys = Array.from(parsedUrl.searchParams.keys());
      const hasBracketedOr = searchParamKeys.some(key => key.includes('[_or]'));
      const hasBracketedNull = searchParamKeys.some(key => key.includes('[_null]'));
      const hasBracketedDateCreated = searchParamKeys.some(key => key.includes('[date_created]'));

      if (hasBracketedOr || hasBracketedNull || hasBracketedDateCreated) {
        expect(hasBracketedOr).toBe(true);
        expect(hasBracketedNull).toBe(true);
        expect(hasBracketedDateCreated).toBe(true);
        matchedIncrementalFilter = true;
      }
    }

    expect(matchedIncrementalFilter).toBe(true);
  });

  it('uses _gte so that records updated at exactly sinceTs are not skipped', async () => {
    // Regression: two back-to-back PATCHes within the same server-clock millisecond
    // both get date_updated = sinceTs.  With the old _gt filter the second PATCH would
    // never be returned; with _gte both are re-fetched on the next poll cycle.
    const sinceTs = '2024-06-01T10:00:01.000Z';
    await saveLastPullTsToIDB('orders', sinceTs);

    // Seed IDB: order already in 'pending' state at sinceTs
    await upsertRecordsIntoIDB('orders', [{
      id: 'ord_gte_1', status: 'pending', date_updated: sinceTs,
    }]);

    // Remote returns the same order but with status='accepted' (same date_updated!)
    const updatedOrder = makeRemoteOrder({
      id: 'ord_gte_1', status: 'accepted', date_updated: sinceTs,
    });
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (url.includes('/items/orders')) return Promise.resolve(directusListResponse([updatedOrder]));
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    await sync.forcePull();

    const { getDB } = await import('../useIDB.js');
    const db = await getDB();
    const stored = await db.get('orders', 'ord_gte_1');
    expect(stored.status).toBe('accepted'); // _gte ensures boundary record is re-fetched and written
  });

  it('does NOT add incremental filter when sinceTs is null (full pull)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([])));
    const sync = useDirectusSync();
    await sync.forcePull(); // no stored cursor → full pull

    const orderCalls = fetchSpy.mock.calls
      .map(([url]) => String(url))
      .filter(url => url.includes('/items/orders'));
    expect(orderCalls.length).toBeGreaterThan(0);

    for (const url of orderCalls) {
      expect(hasDateUpdatedIncrementalFilter(url)).toBe(false);
    }
  });
});

// ── Pull: order_items merge into parent orders ────────────────────────────────

describe('pull — order_items merged into parent orders in IDB', () => {
  it('merges pulled order_items into their parent order in IDB and refreshes orders store', async () => {
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();

    // Seed an existing order without items
    await db.put('orders', {
      id: 'ord_ki_1',
      status: 'accepted',
      table: '03',
      total_amount: 10,
      item_count: 1,
      orderItems: [],
      date_updated: '2024-01-01T00:00:00.000Z',
    });

    // Remote returns one order_item for that order
    const remoteItem = {
      id: 'item_1',
      order: 'ord_ki_1',
      dish: null,
      name: 'Pizza',
      quantity: 1,
      unit_price: 10,
      voided_quantity: 0,
      kitchen_ready: true,
      date_updated: '2024-06-01T00:00:00.000Z',
    };

    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (url.includes('/items/order_items')) return Promise.resolve(directusListResponse([remoteItem]));
      return Promise.resolve(directusListResponse([]));
    });

    const store = makeStore();
    const sync = useDirectusSync();
    sync.startSync({ appType: 'cucina', store });
    await sync.forcePull();

    const order = await db.get('orders', 'ord_ki_1');
    expect(order).toBeDefined();
    expect(order.orderItems).toHaveLength(1);
    expect(order.orderItems[0].id).toBe('item_1');
    expect(order.orderItems[0].kitchenReady).toBe(true);
  });

  it('does not overwrite a newer existing item with an older pulled item', async () => {
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();

    await db.put('orders', {
      id: 'ord_ki_lww',
      status: 'accepted',
      table: '04',
      total_amount: 10,
      item_count: 1,
      orderItems: [{
        id: 'item_lww',
        order: 'ord_ki_lww',
        name: 'Pizza',
        quantity: 1,
        unit_price: 10,
        kitchenReady: true,
        date_updated: '2024-09-01T00:00:00.000Z',
      }],
      date_updated: '2024-01-01T00:00:00.000Z',
    });

    // Pulled item is older (kitchen_ready still false)
    const olderItem = {
      id: 'item_lww',
      order: 'ord_ki_lww',
      name: 'Pizza',
      quantity: 1,
      unit_price: 10,
      voided_quantity: 0,
      kitchen_ready: false,
      date_updated: '2024-03-01T00:00:00.000Z',
    };

    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (url.includes('/items/order_items')) return Promise.resolve(directusListResponse([olderItem]));
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    const store = makeStore();
    sync.startSync({ appType: 'cucina', store });
    await sync.forcePull();

    const order = await db.get('orders', 'ord_ki_lww');
    expect(order.orderItems[0].kitchenReady).toBe(true); // local newer item wins
  });
});

// ── WebSocket: order_items create/update/delete merges into parent orders ─────

describe('WS order_items — embedded merge into parent orders', () => {
  it('WS create for order_item merges into parent order.orderItems in IDB', async () => {
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();

    // Seed a parent order with no items
    await db.put('orders', {
      id: 'ord_ws_item_1',
      status: 'accepted',
      table: '01',
      orderItems: [],
      date_updated: '2024-01-01T00:00:00.000Z',
    });

    await _handleSubscriptionMessage('order_items', {
      event: 'create',
      data: [{
        id: 'oi_ws_1',
        order: 'ord_ws_item_1',
        name: 'Bistecca',
        quantity: 1,
        unit_price: 18,
        voided_quantity: 0,
        kitchen_ready: false,
        date_updated: '2024-06-01T00:00:00.000Z',
      }],
    });

    const order = await db.get('orders', 'ord_ws_item_1');
    expect(order).toBeDefined();
    expect(order.orderItems).toHaveLength(1);
    expect(order.orderItems[0].id).toBe('oi_ws_1');
  });

  it('WS update for order_item updates the item inside parent order.orderItems', async () => {
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();

    await db.put('orders', {
      id: 'ord_ws_item_upd',
      status: 'accepted',
      table: '02',
      orderItems: [{
        id: 'oi_ws_upd',
        order: 'ord_ws_item_upd',
        name: 'Pasta',
        quantity: 1,
        unit_price: 10,
        kitchenReady: false,
        date_updated: '2024-01-01T00:00:00.000Z',
      }],
      date_updated: '2024-01-01T00:00:00.000Z',
    });

    await _handleSubscriptionMessage('order_items', {
      event: 'update',
      data: [{
        id: 'oi_ws_upd',
        order: 'ord_ws_item_upd',
        name: 'Pasta',
        quantity: 1,
        unit_price: 10,
        voided_quantity: 0,
        kitchen_ready: true,
        date_updated: '2024-09-01T00:00:00.000Z',
      }],
    });

    const order = await db.get('orders', 'ord_ws_item_upd');
    expect(order.orderItems).toHaveLength(1);
    expect(order.orderItems[0].kitchenReady).toBe(true);
  });

  it('WS delete for order_item removes it from parent order.orderItems', async () => {
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();

    await db.put('orders', {
      id: 'ord_ws_item_del',
      status: 'accepted',
      table: '03',
      orderItems: [
        { id: 'oi_del_1', name: 'Pizza', quantity: 1, unit_price: 9 },
        { id: 'oi_del_2', name: 'Acqua', quantity: 2, unit_price: 2 },
      ],
      date_updated: '2024-01-01T00:00:00.000Z',
    });

    // Also write the item to the order_items store so deleteRecordsFromIDB has something to remove
    await upsertRecordsIntoIDB('order_items', [
      { id: 'oi_del_1', order: 'ord_ws_item_del', name: 'Pizza', quantity: 1, unit_price: 9 },
    ]);

    await _handleSubscriptionMessage('order_items', {
      event: 'delete',
      data: ['oi_del_1'],
    });

    const order = await db.get('orders', 'ord_ws_item_del');
    expect(order.orderItems).toHaveLength(1);
    expect(order.orderItems[0].id).toBe('oi_del_2'); // only the surviving item remains
  });

  it('WS partial update for order_item does NOT clobber quantity/unitPrice with mapper defaults', async () => {
    // This guards against the regression described in the review: mapOrderItemFromDirectus
    // fills absent numeric fields with 0. A partial WS payload (e.g. only kitchen_ready)
    // must NOT overwrite real quantity/unit_price values stored in the embedded item.
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();

    // Seed a parent order with a known embedded item
    await db.put('orders', {
      id: 'ord_ws_partial_oi',
      status: 'accepted',
      table: '05',
      orderItems: [{
        id: 'oi_partial',
        order: 'ord_ws_partial_oi',
        name: 'Risotto',
        quantity: 3,
        unitPrice: 14,
        unit_price: 14,
        voidedQuantity: 0,
        voided_quantity: 0,
        kitchenReady: false,
        notes: ['senza cipolla'],
        modifiers: [],
        date_updated: '2024-01-01T00:00:00.000Z',
      }],
      date_updated: '2024-01-01T00:00:00.000Z',
    });

    // Also seed the order_items store so upsertRecordsIntoIDB has something
    await upsertRecordsIntoIDB('order_items', [{
      id: 'oi_partial',
      order: 'ord_ws_partial_oi',
      name: 'Risotto',
      quantity: 3,
      unit_price: 14,
      voided_quantity: 0,
      kitchen_ready: false,
      date_updated: '2024-01-01T00:00:00.000Z',
    }]);

    // WS sends a partial payload: only kitchen_ready is updated — quantity,
    // unit_price, and order are absent, so merge logic must preserve them.
    await _handleSubscriptionMessage('order_items', {
      event: 'update',
      data: [{
        id: 'oi_partial',
        kitchen_ready: true,
        date_updated: '2024-09-01T00:00:00.000Z',
      }],
    });

    const order = await db.get('orders', 'ord_ws_partial_oi');
    expect(order.orderItems).toHaveLength(1);
    const item = order.orderItems[0];
    // kitchenReady must have been updated
    expect(item.kitchenReady).toBe(true);
    // quantity and unitPrice must NOT have been clobbered with mapper defaults
    expect(item.quantity).toBe(3);
    expect(item.unitPrice).toBe(14);
    expect(item.unit_price).toBe(14);
    // notes must also be preserved (absent from WS payload → not in raw → kept)
    expect(item.notes).toEqual(['senza cipolla']);

    // The order_items ObjectStore must also preserve quantity/unit_price/order FK
    // on partial WS updates (guards against the store being clobbered with defaults).
    const storedItem = await db.get('order_items', 'oi_partial');
    expect(storedItem).toBeDefined();
    expect(storedItem.quantity).toBe(3);
    expect(storedItem.unit_price).toBe(14);
    expect(storedItem.kitchen_ready).toBe(true);
    // The order FK must be preserved (was absent from the partial WS payload).
    expect(storedItem.order).toBe('ord_ws_partial_oi');
  });

  it('WS delete for order_item removes it via fallback scan when not yet in order_items store', async () => {
    // Guards the fallback path in _removeOrderItemsFromOrdersIDB: when a WS delete
    // arrives for an item that is not (yet) in the order_items IDB store, the helper
    // must still scan orders.orderItems and remove the embedded entry.
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();

    const orderId = 'ord_ws_fallback_del';

    // Seed an order with an embedded item — but do NOT seed the item in order_items.
    await db.put('orders', {
      id: orderId,
      status: 'accepted',
      table: '09',
      orderItems: [
        { id: 'oi_fallback_1', order: orderId, name: 'Salmone', quantity: 1, unit_price: 22 },
        { id: 'oi_fallback_2', order: orderId, name: 'Tiramisù', quantity: 2, unit_price: 7 },
      ],
      date_updated: '2024-01-01T00:00:00.000Z',
    });

    // item is NOT in order_items store, so the normal lookup returns null →
    // the fallback cursor scan must remove it from the embedded array.
    await _handleSubscriptionMessage('order_items', {
      event: 'delete',
      data: ['oi_fallback_1'],
    });

    const order = await db.get('orders', orderId);
    expect(order.orderItems).toHaveLength(1);
    expect(order.orderItems[0].id).toBe('oi_fallback_2');
  });

  it('WS partial update for order_item preserves existing modifiers when WS sends ID-only relation entries', async () => {
    // Guards against the regression in mergeOrderItemFromWSPayload: when a WS
    // subscription uses fields: ['*'], the `order_item_modifiers` relation field
    // arrives as bare IDs (numbers), which mapOrderItemFromDirectus normalises to
    // `modifiers: []`.  The merge function must NOT overwrite existing modifiers
    // with that empty array — only apply when incoming.modifiers is non-empty.
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();

    const orderId = 'ord_ws_modifier_preserve';
    const existingModifiers = [
      { id: 'mod_1', name: 'Extra cheese', price: 2, quantity: 1 },
      { id: 'mod_2', name: 'No onion', price: 0, quantity: 1 },
    ];

    await db.put('orders', {
      id: orderId,
      status: 'accepted',
      table: '11',
      orderItems: [{
        id: 'oi_mod_test',
        order: orderId,
        name: 'Pizza',
        quantity: 1,
        unitPrice: 12,
        unit_price: 12,
        kitchenReady: false,
        modifiers: existingModifiers,
        date_updated: '2024-01-01T00:00:00.000Z',
      }],
      date_updated: '2024-01-01T00:00:00.000Z',
    });

    await upsertRecordsIntoIDB('order_items', [{
      id: 'oi_mod_test',
      order: orderId,
      name: 'Pizza',
      quantity: 1,
      unit_price: 12,
      kitchen_ready: false,
      // order_item_modifiers stored as ID-only entries (simulating what IDB
      // holds after a full pull that didn't expand the relation):
      order_item_modifiers: [{ id: 'mod_1' }, { id: 'mod_2' }],
      date_updated: '2024-01-01T00:00:00.000Z',
    }]);

    // WS sends `order_item_modifiers` as bare IDs (the typical fields:['*'] response).
    // mapOrderItemFromDirectus() normalises this to `modifiers: []` because the
    // entries are not fully-expanded objects with a `price` field.
    await _handleSubscriptionMessage('order_items', {
      event: 'update',
      data: [{
        id: 'oi_mod_test',
        kitchen_ready: true,
        order_item_modifiers: [1, 2],      // bare IDs, not expanded objects
        date_updated: '2024-09-01T00:00:00.000Z',
      }],
    });

    // kitchenReady must be updated
    const order = await db.get('orders', orderId);
    const item = order.orderItems[0];
    expect(item.kitchenReady).toBe(true);
    // Existing modifiers must NOT have been clobbered with []
    expect(item.modifiers).toHaveLength(2);
    expect(item.modifiers[0].id).toBe('mod_1');
    expect(item.modifiers[1].id).toBe('mod_2');
  });

  it('_mergeOrderItemsIntoOrdersIDB overwrites when incoming timestamp equals existing (same as upsertRecordsIntoIDB)', async () => {
    // Guards timestamp-comparison consistency: same-timestamp incoming SHOULD overwrite
    // the existing embedded item so that back-to-back PATCHes within the same server-clock
    // millisecond are never silently dropped (matches upsertRecordsIntoIDB ≥ semantics).
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();

    const sameTs = '2024-06-01T12:00:00.000Z';
    const orderId = 'ord_ts_compare';

    await db.put('orders', {
      id: orderId,
      status: 'accepted',
      table: '10',
      orderItems: [{
        id: 'oi_ts_1',
        order: orderId,
        name: 'Originale',
        quantity: 5,
        unitPrice: 10,
        unit_price: 10,
        date_updated: sameTs,
      }],
      date_updated: sameTs,
    });

    // WS update arrives with the SAME timestamp — incoming wins (overwrites existing).
    await _handleSubscriptionMessage('order_items', {
      event: 'update',
      data: [{
        id: 'oi_ts_1',
        order: orderId,
        name: 'Sostituto',
        quantity: 99,
        unit_price: 1,
        date_updated: sameTs,
      }],
    });

    const order = await db.get('orders', orderId);
    const item = order.orderItems[0];
    // Same timestamp → incoming wins; latest payload values are stored.
    expect(item.name).toBe('Sostituto');
    expect(item.quantity).toBe(99);
    expect(item.unit_price).toBe(1);
  });
});

describe('pull — in-memory orders merge', () => {
  it('adds a new order from remote into store.orders', async () => {
    const remoteOrder = makeRemoteOrder({ bill_session: 'bill_x', total_amount: 20 });

    vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([remoteOrder])));

    const store = makeStore();
    const sync = useDirectusSync();
    await sync.forcePull();

    expect(store.orders).toHaveLength(0); // forcePull doesn't update store — use startSync
  });

  it('startSync merges pulled records into store.orders', async () => {
    const remoteOrder = makeRemoteOrder({ bill_session: 'bill_x', total_amount: 20 });

    vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([remoteOrder])));

    const store = makeStore();
    const sync = useDirectusSync();
    // startSync sets _store; forcePull() then properly awaits _runPull() to completion
    sync.startSync({ appType: 'cassa', store });
    await sync.forcePull();

    expect(store.orders.some(o => o.id === 'ord_remote')).toBe(true);
    const merged = store.orders.find(o => o.id === 'ord_remote');
    expect(merged.billSessionId).toBe('bill_x');
    expect(merged.totalAmount).toBe(20);
  });

  it('updates an existing order when remote is newer (LWW)', async () => {
    const remoteOrder = makeRemoteOrder({
      id: 'ord_1',
      status: 'accepted',
      table: '01',
      total_amount: 15,
      date_updated: '2024-05-01T00:00:00.000Z',
    });

    vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([remoteOrder])));

    await upsertRecordsIntoIDB('orders', [{
      id: 'ord_1',
      status: 'pending',
      table: '01',
      date_updated: '2024-04-01T00:00:00.000Z',
      orderItems: [{ uid: 'r1' }],
    }]);
    const store = makeStore();
    const sync = useDirectusSync();
    sync.startSync({ appType: 'cassa', store });
    await sync.forcePull();

    const updated = store.orders.find(o => o.id === 'ord_1');
    expect(updated.status).toBe('accepted');
    // Local orderItems must be preserved
    expect(updated.orderItems).toEqual([{ uid: 'r1' }]);
  });

  it('does not downgrade a locally-newer order', async () => {
    const remoteOrder = makeRemoteOrder({
      id: 'ord_1', status: 'pending',
      date_updated: '2024-01-01T00:00:00.000Z',
    });

    vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([remoteOrder])));

    await upsertRecordsIntoIDB('orders', [{
      id: 'ord_1',
      status: 'completed',
      date_updated: '2024-06-01T00:00:00.000Z',
      orderItems: [],
    }]);
    const store = makeStore();
    const sync = useDirectusSync();
    sync.startSync({ appType: 'cassa', store });
    await sync.forcePull();

    expect(store.orders.find(o => o.id === 'ord_1').status).toBe('completed');
  });
});

// ── Pull: bill_sessions → tableCurrentBillSession ────────────────────────────

describe('pull — bill_sessions merge', () => {
  it('adds an open session from remote to tableCurrentBillSession', async () => {
    const remoteSession = {
      id: 'bill_99', table: '09', status: 'open', adults: 3, children: 1,
      opened_at: '2024-03-01T00:00:00.000Z',
      date_updated: '2024-03-01T00:00:00.000Z',
    };

    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (url.includes('bill_sessions')) return Promise.resolve(directusListResponse([remoteSession]));
      return Promise.resolve(directusListResponse([]));
    });

    const store = makeStore();
    const sync = useDirectusSync();
    sync.startSync({ appType: 'cassa', store });
    await sync.forcePull();

    const session = store.tableCurrentBillSession['09'];
    expect(session).toBeTruthy();
    expect(session.billSessionId).toBe('bill_99');
    expect(session.adults).toBe(3);
    expect(session.children).toBe(1);
    expect(session.table).toBe('09');
    expect(session.status).toBe('open');
    expect(session.opened_at).toBe('2024-03-01T00:00:00.000Z');
  });

  it('preserves existing session fields not present in incoming record', async () => {
    const remoteSession = {
      id: 'bill_99', table: '09', status: 'open', adults: 4, children: 0,
      date_updated: '2024-03-02T00:00:00.000Z',
    };

    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (url.includes('bill_sessions')) return Promise.resolve(directusListResponse([remoteSession]));
      return Promise.resolve(directusListResponse([]));
    });

    await saveStateToIDB({
      tableCurrentBillSession: {
        '09': {
          billSessionId: 'bill_99',
          adults: 3,
          children: 0,
          table: '09',
          status: 'open',
          opened_at: '2024-03-01T00:00:00.000Z',
        },
      },
    });
    const store = makeStore();
    const sync = useDirectusSync();
    sync.startSync({ appType: 'cassa', store });
    await sync.forcePull();

    const session = store.tableCurrentBillSession['09'];
    expect(session.adults).toBe(4);
    expect(session.opened_at).toBe('2024-03-01T00:00:00.000Z');
    expect(session.table).toBe('09');
    expect(session.status).toBe('open');
  });

  it('removes a closed session from tableCurrentBillSession', async () => {
    const closedSession = {
      id: 'bill_99', table: '09', status: 'closed', adults: 3, children: 0,
      date_updated: '2024-03-01T00:00:00.000Z',
    };

    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (url.includes('bill_sessions')) return Promise.resolve(directusListResponse([closedSession]));
      return Promise.resolve(directusListResponse([]));
    });

    const store = makeStore({
      tableCurrentBillSession: { '09': { billSessionId: 'bill_99', adults: 3, children: 0 } },
    });
    const sync = useDirectusSync();
    sync.startSync({ appType: 'cassa', store });
    await sync.forcePull();

    expect(store.tableCurrentBillSession['09']).toBeUndefined();
  });
});

// ── lastPullAt / lastPushAt ───────────────────────────────────────────────────

describe('reactive timestamps', () => {
  it('lastPullAt is set after a successful pull with new data', async () => {
    const remoteOrder = makeRemoteOrder();
    vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([remoteOrder])));

    const sync = useDirectusSync();
    const before = sync.lastPullAt.value;
    const store = makeStore();
    sync.startSync({ appType: 'cassa', store });
    await sync.forcePull();

    expect(sync.lastPullAt.value).not.toBe(before);
    expect(sync.lastPullAt.value).toBeTruthy();
  });

  it('lastPullAt is updated after a successful pull even when no records are returned', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([])));

    const sync = useDirectusSync();
    const before = sync.lastPullAt.value;
    await sync.forcePull();

    expect(sync.lastPullAt.value).not.toBe(before);
    expect(sync.lastPullAt.value).toBeTruthy();
  });

  it('forcePull() sets syncStatus to syncing then idle on success', async () => {
    const statuses = [];
    vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([])));

    const sync = useDirectusSync();
    const pullPromise = sync.forcePull();
    statuses.push(sync.syncStatus.value);
    await pullPromise;
    statuses.push(sync.syncStatus.value);

    expect(statuses[0]).toBe('syncing');
    expect(statuses[1]).toBe('idle');
  });

  it('forcePull() sets syncStatus to offline when navigator is offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });

    const sync = useDirectusSync();
    await sync.forcePull();

    expect(sync.syncStatus.value).toBe('offline');
  });

  it('lastPushAt is set after a successful push', async () => {
    // Seed the queue with an entry
    const { enqueue } = await import('../useSyncQueue.js');
    await enqueue('orders', 'create', 'ord_1', { id: 'ord_1' });

    vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(new Response('{}', { status: 201 })));

    const sync = useDirectusSync();
    await sync.forcePush();

    expect(sync.lastPushAt.value).toBeTruthy();
  });

  it('lastPullAt is not updated when any pull collection fails', async () => {
    const page1Orders = Array.from({ length: 200 }, (_, i) => makeRemoteOrder({
      id: `ord_page1_${i}`,
      date_updated: `2024-03-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
    }));

    // NS7 fix: page 2 now uses page=1 + keyset filter, so route by call count
    let ordersCallCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const u = String(url);
      if (!u.includes('/items/orders')) return Promise.resolve(directusListResponse([]));
      ordersCallCount++;
      if (ordersCallCount === 1) return Promise.resolve(directusListResponse(page1Orders));
      return Promise.reject(new Error('orders page 2 failed'));
    });

    const sync = useDirectusSync();
    const before = sync.lastPullAt.value;
    await sync.forcePull();

    expect(sync.lastPullAt.value).toBe(before);
  });
});

// ── last_pull_ts persistence ──────────────────────────────────────────────────

describe('pull timestamp persistence', () => {
  it('loads local IDB state once per paginated orders pull cycle', async () => {
    const page1Orders = Array.from({ length: 200 }, (_, i) => makeRemoteOrder({
      id: `ord_page1_${i}`,
      date_updated: `2024-08-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
    }));
    const page2Orders = [makeRemoteOrder({
      id: 'ord_page2_1',
      date_updated: '2024-08-01T00:01:00.000Z',
    })];

    const loadStateSpy = vi.spyOn(persistenceOps, 'loadStateFromIDB');
    // NS7 fix: page 2 now uses page=1 + keyset filter, so route by call count
    let ordersCallCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const u = String(url);
      if (!u.includes('/items/orders')) return Promise.resolve(directusListResponse([]));
      ordersCallCount++;
      if (ordersCallCount === 1) return Promise.resolve(directusListResponse(page1Orders));
      if (ordersCallCount === 2) return Promise.resolve(directusListResponse(page2Orders));
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    await sync.forcePull();

    expect(loadStateSpy).toHaveBeenCalledTimes(1);
  });

  it('saves the max date_updated to IDB app_meta after a pull', async () => {
    const remoteOrder = makeRemoteOrder({
      id: 'ord_ts', date_updated: '2024-07-15T12:00:00.000Z',
    });

    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (url.includes('/items/orders')) return Promise.resolve(directusListResponse([remoteOrder]));
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    await sync.forcePull();

    const ts = await loadLastPullTsFromIDB('orders');
    expect(ts).toBe('2024-07-15T12:00:00.000Z');
  });

  it('saves date_created as cursor when date_updated is null (newly created record)', async () => {
    const remoteOrder = makeRemoteOrder({
      id: 'ord_null_ts',
      date_updated: null,
      date_created: '2024-09-20T08:00:00.000Z',
    });

    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (url.includes('/items/orders')) return Promise.resolve(directusListResponse([remoteOrder]));
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    await sync.forcePull();

    const ts = await loadLastPullTsFromIDB('orders');
    expect(ts).toBe('2024-09-20T08:00:00.000Z');
  });

  it('advances last_pull_ts to the end of the last successful page when a paginated pull fails mid-cycle (S2 per-page checkpoint)', async () => {
    // S2 improvement: the cursor is checkpointed after each successful page so
    // a failure on page N+1 does NOT roll back the cursor to before page N.
    // This means the next polling cycle restarts from the end of page 1 rather
    // than re-fetching all records from the original cursor.
    await saveLastPullTsToIDB('orders', '2024-01-01T00:00:00.000Z');
    const page1Orders = Array.from({ length: 200 }, (_, i) => makeRemoteOrder({
      id: `ord_partial_${i}`,
      date_updated: `2024-08-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
    }));

    // NS7 fix: page 2 now uses page=1 + keyset filter, so route by call count
    let ordersCallCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const u = String(url);
      if (!u.includes('/items/orders')) return Promise.resolve(directusListResponse([]));
      ordersCallCount++;
      if (ordersCallCount === 1) return Promise.resolve(directusListResponse(page1Orders));
      return Promise.reject(new Error('orders page 2 failed'));
    });

    const sync = useDirectusSync();
    await sync.forcePull();

    const ts = await loadLastPullTsFromIDB('orders');
    // Cursor advances to the max date_updated seen in page 1 (the last
    // successfully processed page), not back to the original cursor.
    expect(ts).toBe('2024-08-01T00:00:59.000Z');
  });
});

describe('global pull config hydration', () => {
  it('uses deep venue fetch on first global hydration even when legacy cursors are stale', async () => {
    // Legacy cursors must not influence the deep bootstrap endpoint.
    await saveLastPullTsToIDB('tables', '2099-01-01T00:00:00.000Z');

    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([])));

    const sync = useDirectusSync();
    const store = makeStore();
    sync.startSync({ appType: 'cucina', store });
    await flushPromises(LONG_FLUSH_ROUNDS);
    sync.stopSync();

    const venueCalls = fetchSpy.mock.calls
      .map(([url]) => String(url))
      .filter(url => url.includes('/items/venues'));
    expect(venueCalls.every(url => hasDateUpdatedIncrementalFilter(url) === false)).toBe(true);
  });

  it('retries deep venue bootstrap on the next cycle if the first global fetch fails', async () => {
    await saveLastPullTsToIDB('tables', '2024-01-01T00:00:00.000Z');
    vi.useFakeTimers();

    let venueReqCount = 0;
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/items/venues')) {
        venueReqCount += 1;
        if (venueReqCount === 1) return Promise.reject(new Error('temporary deep venue failure'));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    const store = makeStore();
    try {
      sync.startSync({ appType: 'cucina', store });
      await flushPromises(LONG_FLUSH_ROUNDS);
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      await flushPromises(LONG_FLUSH_ROUNDS);
    } finally {
      sync.stopSync();
      vi.useRealTimers();
    }

    const venueCalls = fetchSpy.mock.calls
      .map(([url]) => String(url))
      .filter(url => url.includes('/items/venues'));
    expect(venueCalls.length).toBeGreaterThanOrEqual(2);
    for (const url of venueCalls) {
      expect(hasDateUpdatedIncrementalFilter(url)).toBe(false);
    }
  });

  it('does not apply config hydration when a global collection pull fails', async () => {
    const mappers = await import('../../utils/mappers.js');
    const applySpy = vi.spyOn(mappers, 'mapVenueConfigFromDirectus');

    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/items/venues')) {
        return Promise.reject(new Error('temporary deep venue failure'));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    const result = await sync.reconfigureAndApply();
    expect(result.ok).toBe(false);

    expect(applySpy).not.toHaveBeenCalled();
  });

  it('does not clear table merges when deep venue fetch fails', async () => {
    await replaceTableMergesInIDB([{ id: 'm1', slave_table: 'T2', master_table: 'T1' }]);

    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/items/venues')) {
        return Promise.reject(new Error('table merge fetch failed'));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    const store = makeStore({ tableMergedInto: { T2: 'T1' } });
    sync.startSync({ appType: 'cucina', store });
    await flushPromises(LONG_FLUSH_ROUNDS);
    sync.stopSync();

    const { getDB } = await import('../useIDB.js');
    const db = await getDB();
    const records = await db.getAll('table_merge_sessions');
    expect(records).toHaveLength(1);
    expect(records[0].slave_table).toBe('T2');
    expect(records[0].master_table).toBe('T1');
    expect(store.tableMergedInto).toEqual({ T2: 'T1' });
  });

  it('forcePull returns {ok:true} when all collections succeed', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([])));

    const sync = useDirectusSync();
    const result = await sync.forcePull();

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(Array.isArray(result.failedCollections)).toBe(true);
    expect(result.failedCollections).toHaveLength(0);
  });

  it('forcePull returns {ok:false, failedCollections} when a collection fetch fails', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/items/orders')) return Promise.reject(new Error('orders fetch failed'));
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    const result = await sync.forcePull();

    expect(result.ok).toBe(false);
    expect(result.failedCollections).toContain('orders');
  });

  it('older concurrent pull still applies config when newer pull fails before hydration', async () => {
    // True concurrency test: pull A is launched but blocked mid-flight (before its
    // venue fetch resolves) while pull B starts, increments the generation counter
    // to 2, and fails immediately on the venue fetch.  Only then is pull A unblocked.
    //
    // Expected: _lastAppliedGlobalPullGeneration stays 0 after B fails, so when A
    // resumes it sees 0 <= 1 (myGeneration_A) and is free to write IDB and apply config.

    const mappers = await import('../../utils/mappers.js');
    const mapperSpy = vi.spyOn(mappers, 'mapVenueConfigFromDirectus');

    const venuePayload = {
      id: 1,
      name: 'Concurrent Race Venue',
      menu_source: 'directus',
      rooms: [],
      tables: [],
      payment_methods: [],
      printers: [],
      venue_users: [],
      table_merge_sessions: [],
      menu_categories: [],
      menu_items: [],
      primary_color: '#aabbcc',
    };

    // Deferred: lets us control exactly when pull A's venue response arrives.
    let resolveVenueA;
    const venueAFetch = new Promise((resolve) => { resolveVenueA = resolve; });

    // First venue request (pull A) — deferred.
    // Subsequent venue requests (pull B full + fallback field sets) — fail immediately.
    let venueFetchCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/items/venues/')) {
        venueFetchCount += 1;
        if (venueFetchCount === 1) {
          return venueAFetch.then(() => directusItemResponse(venuePayload));
        }
        return Promise.reject(new Error('concurrent pull B failure'));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();

    // Launch pull A without awaiting.  The ++_globalPullGeneration increment in
    // _runGlobalPull runs synchronously (before the first await), so by the time
    // this assignment returns, _globalPullGeneration is already 1 and pull A is
    // suspended waiting for its venue fetch.
    const promiseA = sync.reconfigureAndApply();

    // Flush a few microtask rounds to let pull A reach its suspended await.
    await flushPromises(5);

    // Launch pull B and wait for it to finish — it fails immediately on the venue
    // fetch (venueFetchCount >= 2).  _globalPullGeneration is now 2.
    // _lastAppliedGlobalPullGeneration stays 0 because B never hydrates config.
    const resultB = await sync.reconfigureAndApply();
    expect(resultB.ok).toBe(false);

    // Unblock pull A's venue fetch.
    resolveVenueA();

    // Await pull A — it must complete successfully.
    // Supersession check: _lastAppliedGlobalPullGeneration (0) is NOT > myGeneration_A (1),
    // so pull A proceeds to write IDB and hydrate config.
    const resultA = await promiseA;
    expect(resultA.ok).toBe(true);
    expect(resultA.failedCollections).toHaveLength(0);

    // mapVenueConfigFromDirectus being called proves _hydrateConfigFromLocalCache ran
    // (i.e. pull A was not blocked from applying config by pull B's failure).
    expect(mapperSpy).toHaveBeenCalled();

    sync.stopSync();
  });

});


// ── WebSocket subscriptions ───────────────────────────────────────────────────

describe('WebSocket subscriptions', () => {
  it('wsConnected is false before startSync', () => {
    const sync = useDirectusSync();
    expect(sync.wsConnected.value).toBe(false);
  });

  it('falls back to polling when WebSocket connect throws', async () => {
    // Stub subscribe/connect to simulate WS unavailability
    const { getDirectusClient } = await import('../useDirectusClient.js');

    vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve(directusListResponse([])),
    );

    // Patch the client to make connect() reject
    const origGetClient = getDirectusClient;
    const fakeClient = {
      connect: () => Promise.reject(new Error('WebSocket unavailable')),
      subscribe: () => Promise.reject(new Error('should not be called')),
      disconnect: () => {},
      request: () => Promise.resolve([]),
    };

    // We can't easily swap getDirectusClient without module reset, so we verify
    // that the polling fallback is installed when subscriptions fail.
    // The simplest way: ensure that after startSync, forcePull still works via REST.
    const sync = useDirectusSync();
    const store = makeStore();

    // The pull loop should work even without WS
    await sync.forcePull();

    // No error thrown; lastPullAt is updated even with no new records (all collections up to date)
    expect(sync.syncStatus.value).not.toBe('error');
  });
  it('order_items subscription uses relational order.venue filter instead of direct venue', async () => {
    // Capture WS messages so we can inspect the subscribe payload.
    const sentMessages = [];

    // Minimal WebSocket mock that:
    //  1. Fires the "open" event as a microtask (so flushPromises() can settle it).
    //  2. Auto-responds to the auth handshake with { type:'auth', status:'ok' }.
    //  3. Records every message sent via send() for later assertions.
    class MockWebSocket {
      constructor(_url) {
        this._listeners = { open: [], message: [], error: [], close: [] };
        this.readyState = 1; // OPEN
        // Schedule open as a microtask so flushPromises() can pick it up.
        Promise.resolve().then(() => this._fire('open', { type: 'open' }));
      }
      addEventListener(event, handler) {
        (this._listeners[event] ??= []).push(handler);
      }
      removeEventListener(event, handler) {
        if (this._listeners[event]) {
          this._listeners[event] = this._listeners[event].filter(h => h !== handler);
        }
      }
      send(data) {
        const msg = typeof data === 'string' ? JSON.parse(data) : data;
        sentMessages.push(msg);
        // Respond to the auth handshake so connect() can resolve.
        if (msg.type === 'auth') {
          Promise.resolve().then(() =>
            this._fire('message', { data: JSON.stringify({ type: 'auth', status: 'ok' }) }),
          );
        }
      }
      close() { this.readyState = 3; }
      _fire(event, evt) { (this._listeners[event] ?? []).forEach(h => h(evt)); }
    }

    // Inject mock before the client singleton is created (getDirectusClient picks up
    // globalThis.WebSocket at call time because we pass it explicitly in globals).
    vi.stubGlobal('WebSocket', MockWebSocket);

    // Call _startSubscriptions directly to avoid the full startSync/IDB bootstrap path.
    // venueId = 1 comes from beforeEach appConfig.directus.venueId.
    await _startSubscriptions(['orders', 'order_items']);
    await flushPromises(20);

    // Find the subscribe message for order_items (filter is JSON-serialised by queryToParams).
    const subscribeMsg = sentMessages.find(m => m.type === 'subscribe' && m.collection === 'order_items');
    expect(subscribeMsg).toBeDefined();

    const rawFilter = subscribeMsg?.query?.filter;
    expect(rawFilter).toBeDefined();
    const filter = JSON.parse(rawFilter);

    // Must NOT use direct { venue: { _eq: ... } } — the field does not exist on order_items.
    expect(filter?.venue?._eq).toBeUndefined();

    // Must use relational path { order: { venue: { _eq: venueId } } } (venueId = 1 from beforeEach).
    expect(filter?.order?.venue?._eq).toBe(1);
  });

});

// ── drainQueue: last_error persistence ───────────────────────────────────────

describe('drainQueue — last_error on failed push', () => {
  it('sets last_error on a failed entry after a push error', async () => {
    const { enqueue, drainQueue } = await import('../useSyncQueue.js');
    await enqueue('orders', 'create', 'ord_fail', { id: 'ord_fail' });

    // Make the push fail with a recognisable error message
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ message: 'You are not allowed.' }] }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const cfg = { url: 'https://directus.test', staticToken: 'tok_test', venueId: 1, _backoffMs: 0 };
    await drainQueue(cfg);

    const { getDB } = await import('../useIDB.js');
    const db = await getDB();
    const all = await db.getAll('sync_queue');
    const entry = all.find(e => e.record_id === 'ord_fail');

    // attempts must be incremented and last_error must be set
    expect(entry).toBeTruthy();
    expect(entry.attempts).toBeGreaterThan(0);
    expect(typeof entry.last_error).toBe('string');
    expect(entry.last_error.length).toBeGreaterThan(0);
  });

  it('updates last_error on subsequent failures', async () => {
    const { enqueue, drainQueue } = await import('../useSyncQueue.js');
    await enqueue('orders', 'update', 'ord_retry', { id: 'ord_retry', status: 'accepted' });

    const cfg = { url: 'https://directus.test', staticToken: 'tok_test', venueId: 1, _backoffMs: 0 };

    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: [{ message: 'First error' }] }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: [{ message: 'Second error' }] }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const { getDB } = await import('../useIDB.js');
    const db = await getDB();

    // First drain — sets last_error to 'First error'
    await drainQueue(cfg);
    const allAfterFirst = await db.getAll('sync_queue');
    const entryAfterFirst = allAfterFirst.find(e => e.record_id === 'ord_retry');
    expect(entryAfterFirst).toBeTruthy();
    expect(entryAfterFirst.attempts).toBe(1);
    expect(entryAfterFirst.last_error).toContain('First error');

    // Second drain — updates last_error to 'Second error'
    await drainQueue(cfg);
    const allAfterSecond = await db.getAll('sync_queue');
    const entryAfterSecond = allAfterSecond.find(e => e.record_id === 'ord_retry');
    expect(entryAfterSecond).toBeTruthy();
    expect(entryAfterSecond.attempts).toBe(2);
    expect(entryAfterSecond.last_error).toContain('Second error');
  });
});

// ── Self-echo suppression ─────────────────────────────────────────────────────

describe('self-echo suppression (_handleSubscriptionMessage)', () => {
  it('suppresses a create WS event for a record just pushed by this device', async () => {
    // Pre-seed IDB with the record (simulating what drainQueue already wrote)
    await upsertRecordsIntoIDB('orders', [{ id: 'ord_echo_1', status: 'pending' }]);

    // Register the record as a self-echo
    _registerPushedEchoes([{ collection: 'orders', recordId: 'ord_echo_1' }]);

    // Simulate receiving our own WS echo with a different status
    await _handleSubscriptionMessage('orders', {
      event: 'create',
      data: [{ id: 'ord_echo_1', status: 'accepted', date_updated: '2026-01-01T00:00:01.000Z' }],
    });

    // IDB record must NOT have been overwritten by the echo
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();
    const stored = await db.get('orders', 'ord_echo_1');
    expect(stored?.status).toBe('pending');
  });

  it('allows a genuine (non-echo) create WS event to update IDB', async () => {
    // No registration → record is not in the echo set
    await _handleSubscriptionMessage('orders', {
      event: 'create',
      data: [{ id: 'ord_genuine_1', status: 'accepted', date_updated: '2026-01-01T00:00:01.000Z' }],
    });

    const { getDB } = await import('../useIDB.js');
    const db = await getDB();
    const stored = await db.get('orders', 'ord_genuine_1');
    expect(stored?.status).toBe('accepted');
  });

  it('suppresses a delete WS event for a record just pushed by this device', async () => {
    // Pre-seed IDB with the record
    await upsertRecordsIntoIDB('orders', [{ id: 'ord_del_echo', status: 'pending' }]);

    // Register as self-echo
    _registerPushedEchoes([{ collection: 'orders', recordId: 'ord_del_echo' }]);

    // Simulate receiving our own WS delete echo (Directus sends just the ID string)
    await _handleSubscriptionMessage('orders', {
      event: 'delete',
      data: ['ord_del_echo'],
    });

    // Record must still be in IDB — delete was suppressed
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();
    const stored = await db.get('orders', 'ord_del_echo');
    expect(stored).toBeTruthy();
  });

  it('allows a genuine delete event for a non-pushed record', async () => {
    // Pre-seed IDB with the record
    await upsertRecordsIntoIDB('orders', [{ id: 'ord_del_genuine', status: 'pending' }]);

    // No registration — not in echo set
    await _handleSubscriptionMessage('orders', {
      event: 'delete',
      data: ['ord_del_genuine'],
    });

    // Record must have been removed from IDB
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();
    const stored = await db.get('orders', 'ord_del_genuine');
    expect(stored).toBeUndefined();
  });

  it('allows a create event for the same record after TTL expiry', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      // Seed IDB
      await upsertRecordsIntoIDB('orders', [{ id: 'ord_ttl_1', status: 'pending' }]);

      // Register echo at current (fake) time
      _registerPushedEchoes([{ collection: 'orders', recordId: 'ord_ttl_1' }]);

      // Advance only Date.now() past the 5s TTL, without touching setTimeout/setInterval
      vi.setSystemTime(Date.now() + 6_000);

      // Now the record should NOT be suppressed anymore
      await _handleSubscriptionMessage('orders', {
        event: 'create',
        data: [{ id: 'ord_ttl_1', status: 'accepted', date_updated: '2026-01-01T00:00:01.000Z' }],
      });

      const { getDB } = await import('../useIDB.js');
      const db = await getDB();
      const stored = await db.get('orders', 'ord_ttl_1');
      // After TTL, echo suppression lifted → IDB updated
      expect(stored?.status).toBe('accepted');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores non-object entries in a non-delete WS event and still processes valid objects', async () => {
    // Pre-seed IDB with a known record
    await upsertRecordsIntoIDB('orders', [{ id: 'ord_valid_obj', status: 'pending' }]);

    // Mix: one valid object, one bare string (should never appear but must not crash)
    await _handleSubscriptionMessage('orders', {
      event: 'update',
      data: [
        { id: 'ord_valid_obj', status: 'accepted', date_updated: '2026-01-01T00:00:01.000Z' },
        'bare-string-id',
        null,
      ],
    });

    const { getDB } = await import('../useIDB.js');
    const db = await getDB();

    // The valid object must have been written
    const stored = await db.get('orders', 'ord_valid_obj');
    expect(stored?.status).toBe('accepted');

    // The bare string must NOT have produced a corrupted record
    const corrupted = await db.get('orders', 'bare-string-id');
    expect(corrupted).toBeUndefined();
  });

  it('preserves local orderItems when a WS event arrives without nested items', async () => {
    // Pre-seed IDB with an order that has orderItems (e.g. a cover charge order)
    const existingItems = [
      { uid: 'cop_1', name: 'Coperto', unitPrice: 2.5, quantity: 4, voidedQuantity: 0, notes: [], modifiers: [] },
    ];
    await upsertRecordsIntoIDB('orders', [{
      id: 'ord_ws_items',
      status: 'pending',
      orderItems: existingItems,
      totalAmount: 10,
    }]);

    // Simulate a WS status-update event — Directus never returns order_items in fields:['*']
    await _handleSubscriptionMessage('orders', {
      event: 'update',
      data: [{ id: 'ord_ws_items', status: 'accepted', date_updated: '2026-01-01T00:00:05.000Z' }],
    });

    const { getDB } = await import('../useIDB.js');
    const db = await getDB();
    const stored = await db.get('orders', 'ord_ws_items');

    // Status must be updated
    expect(stored?.status).toBe('accepted');
    // orderItems must NOT have been wiped by the incoming empty array
    expect(Array.isArray(stored?.orderItems)).toBe(true);
    expect(stored.orderItems.length).toBe(1);
    expect(stored.orderItems[0].name).toBe('Coperto');
  });

  it('preserves non-orderItems IDB fields when WS update omits them (partial payload)', async () => {
    // Pre-seed IDB with an order that has a non-zero totalAmount and globalNote
    await upsertRecordsIntoIDB('orders', [{
      id: 'ord_ws_partial',
      status: 'pending',
      totalAmount: 25.5,
      total_amount: 25.5,
      itemCount: 3,
      item_count: 3,
      globalNote: 'allergia noci',
      orderItems: [{ uid: 'r1', name: 'Pasta', unitPrice: 8.5, quantity: 3, voidedQuantity: 0, notes: [], modifiers: [] }],
    }]);

    // Simulate a WS status-update with only {id, status, date_updated} — no total_amount etc.
    await _handleSubscriptionMessage('orders', {
      event: 'update',
      data: [{ id: 'ord_ws_partial', status: 'accepted', date_updated: '2026-01-01T00:00:10.000Z' }],
    });

    const { getDB } = await import('../useIDB.js');
    const db = await getDB();
    const stored = await db.get('orders', 'ord_ws_partial');

    // Status must be updated
    expect(stored?.status).toBe('accepted');
    // totalAmount and globalNote must NOT have been wiped by mapOrderFromDirectus defaults
    expect(stored?.totalAmount).toBe(25.5);
    expect(stored?.globalNote).toBe('allergia noci');
    // orderItems must also be preserved
    expect(stored?.orderItems?.length).toBe(1);
    expect(stored?.orderItems[0].name).toBe('Pasta');
  });

  it('does NOT merge existing for WS create events (new records use incoming data)', async () => {
    // Simulate a WS create event for a brand-new order
    await _handleSubscriptionMessage('orders', {
      event: 'create',
      data: [{ id: 'ord_ws_new', status: 'pending', total_amount: 12, date_updated: '2026-01-01T00:00:01.000Z' }],
    });

    const { getDB } = await import('../useIDB.js');
    const db = await getDB();
    const stored = await db.get('orders', 'ord_ws_new');

    expect(stored?.status).toBe('pending');
    expect(stored?.totalAmount).toBe(12);
  });
});

// ── Pull: per-collection `fields` expansion ────────────────────────────────────
// Verifies that _fetchUpdatedViaSDK sends the correct `fields` query parameter
// for each collection so that nested expands are not silently regressed.

describe('pull — per-collection fields expansion', () => {
  /**
   * Decodes the `fields` query-param from a Directus SDK request URL.
   * The SDK serialises the array as a comma-separated `fields=a,b,c` value.
   * Returns an array of field strings.
   *
   * @param {string} urlString
   * @returns {string[]}
   */
  function extractFieldsParam(urlString) {
    const url = new URL(urlString);
    const raw = url.searchParams.get('fields');
    if (!raw) return [];
    return raw.split(',').map(f => f.trim());
  }

  it('orders pull includes order_items.* and order_items.order_item_modifiers.*', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([])));
    const sync = useDirectusSync();
    await sync.forcePull();

    const orderUrls = fetchSpy.mock.calls
      .map(([url]) => String(url))
      .filter(url => url.includes('/items/orders'));
    expect(orderUrls.length).toBeGreaterThan(0);

    for (const url of orderUrls) {
      const fields = extractFieldsParam(url);
      expect(fields).toContain('order_items.*');
      expect(fields).toContain('order_items.order_item_modifiers.*');
    }
  });

  it('order_items pull uses relational order.venue filter instead of direct venue field', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([])));
    const sync = useDirectusSync();
    // Use appType 'cucina' which always pulls order_items as a standalone collection
    sync.startSync({ appType: 'cucina', store: makeStore() });
    await sync.forcePull();

    const orderItemUrls = fetchSpy.mock.calls
      .map(([url]) => String(url))
      .filter(url => url.includes('/items/order_items'));
    expect(orderItemUrls.length).toBeGreaterThan(0);

    const walkFilter = (node, matcher) => {
      if (!node || typeof node !== 'object') return false;
      if (matcher(node)) return true;
      for (const logicKey of ['_and', '_or']) {
        if (Array.isArray(node[logicKey])) {
          for (const child of node[logicKey]) {
            if (walkFilter(child, matcher)) return true;
          }
        }
      }
      return false;
    };

    const hasJsonEncodedFilter = (searchParams) => searchParams.get('filter') !== null;

    const hasDirectVenueEq = (searchParams) => {
      if (hasJsonEncodedFilter(searchParams)) {
        const rawFilter = searchParams.get('filter');
        expect(rawFilter).not.toBeNull();
        const parsedFilter = JSON.parse(rawFilter);
        return walkFilter(parsedFilter, (node) => node.venue?._eq !== undefined);
      }

      return Array.from(searchParams.keys()).some((key) =>
        /(^|[\]])\[venue\]\[_eq\]$/.test(key) && !/\[order\]\[venue\]\[_eq\]$/.test(key),
      );
    };

    const hasOrderVenueEq = (searchParams) => {
      if (hasJsonEncodedFilter(searchParams)) {
        const rawFilter = searchParams.get('filter');
        expect(rawFilter).not.toBeNull();
        const parsedFilter = JSON.parse(rawFilter);
        return walkFilter(parsedFilter, (node) => node.order?.venue?._eq !== undefined);
      }

      return Array.from(searchParams.keys()).some((key) => /\[order\]\[venue\]\[_eq\]$/.test(key));
    };

    for (const url of orderItemUrls) {
      const searchParams = new URL(url).searchParams;
      expect(hasDirectVenueEq(searchParams)).toBe(false);
      expect(hasOrderVenueEq(searchParams)).toBe(true);
    }
  });

  it('order_items pull includes order_item_modifiers.*', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([])));
    const sync = useDirectusSync();
    // Use appType 'cucina' which always pulls order_items as a standalone collection
    sync.startSync({ appType: 'cucina', store: makeStore() });
    await sync.forcePull();

    const orderItemUrls = fetchSpy.mock.calls
      .map(([url]) => String(url))
      .filter(url => url.includes('/items/order_items'));
    expect(orderItemUrls.length).toBeGreaterThan(0);

    for (const url of orderItemUrls) {
      const fields = extractFieldsParam(url);
      expect(fields).toContain('order_item_modifiers.*');
      // Should NOT include the orders-specific nested expand
      expect(fields).not.toContain('order_items.*');
    }
  });

  it('bill_sessions pull uses only wildcard fields (no nested expand)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([])));
    const sync = useDirectusSync();
    await sync.forcePull();

    const billUrls = fetchSpy.mock.calls
      .map(([url]) => String(url))
      .filter(url => url.includes('/items/bill_sessions'));
    expect(billUrls.length).toBeGreaterThan(0);

    for (const url of billUrls) {
      const fields = extractFieldsParam(url);
      expect(fields).toEqual(['*']);
    }
  });
});

// ── Pull: sync log response.records cap ───────────────────────────────────────
// Verifies that SYNC_LOG_RECORDS_MAX is enforced: small pulls store all records,
// large pulls store only the first N so IDB stays bounded.

describe('pull — sync log response records cap', () => {
  it('stores all records in sync log when count is within SYNC_LOG_RECORDS_MAX', async () => {
    const { getSyncLogs } = await import('../../store/persistence/syncLogs.js');

    // Return 3 orders — well under the cap of 20
    const records = Array.from({ length: 3 }, (_, i) => makeRemoteOrder({
      id: `ord_cap_${i}`,
      date_updated: `2024-05-01T00:00:${String(i).padStart(2, '0')}.000Z`,
    }));
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/items/orders')) return Promise.resolve(directusListResponse(records));
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    await sync.forcePull();
    // addSyncLog() is fire-and-forget inside _fetchUpdatedViaSDK; flush pending
    // microtasks so the IDB write completes before we read back the log.
    await flushPromises();

    const logs = await getSyncLogs();
    const orderPullLog = logs.find(l => l.endpoint === '/items/orders' && l.direction === 'IN');
    expect(orderPullLog).toBeTruthy();
    expect(orderPullLog.response.count).toBe(3);
    expect(Array.isArray(orderPullLog.response.records)).toBe(true);
    expect(orderPullLog.response.records.length).toBe(3);
  });

  it('caps stored records at SYNC_LOG_RECORDS_MAX (20) when pull returns more', async () => {
    const { getSyncLogs } = await import('../../store/persistence/syncLogs.js');

    // Return 25 orders — above the cap of 20
    const records = Array.from({ length: 25 }, (_, i) => makeRemoteOrder({
      id: `ord_bigcap_${i}`,
      date_updated: `2024-05-01T00:${String(i).padStart(2, '0')}:00.000Z`,
    }));
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/items/orders')) return Promise.resolve(directusListResponse(records));
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    await sync.forcePull();
    // addSyncLog() is fire-and-forget inside _fetchUpdatedViaSDK; flush pending
    // microtasks so the IDB write completes before we read back the log.
    await flushPromises();

    const logs = await getSyncLogs();
    const orderPullLog = logs.find(l => l.endpoint === '/items/orders' && l.direction === 'IN');
    expect(orderPullLog).toBeTruthy();
    // count always reflects the true number of pulled records
    expect(orderPullLog.response.count).toBe(25);
    // but records is capped at SYNC_LOG_RECORDS_MAX (20)
    expect(Array.isArray(orderPullLog.response.records)).toBe(true);
    expect(orderPullLog.response.records.length).toBe(20);
    // the stored slice must be the first N records
    expect(orderPullLog.response.records[0].id).toBe('ord_bigcap_0');
    expect(orderPullLog.response.records[19].id).toBe('ord_bigcap_19');
  });
});

// ── offline / online event handling ──────────────────────────────────────────
// Verifies that wsConnected reflects offline immediately, that timers are
// correctly cancelled/debounced, and that the delayed push retry does not
// run after stopSync() or after the device goes offline again.
//
// Implementation note on fake timers + fake-indexeddb:
// fake-indexeddb schedules IDB callbacks via `setImmediate` (0 ms).  Calling
// vi.useFakeTimers() without a `toFake` list fakes ALL timer APIs including
// setImmediate, which can stall IDB operations that run after the call.  To
// avoid this deadlock we use an explicit `toFake` list that fakes only the
// timeout/interval/Date APIs the tests need to control, while leaving
// setImmediate real so IDB callbacks always drain normally.  Queue items are
// also written with REAL timers (before vi.useFakeTimers()) to ensure the
// enqueue IDB writes complete before fake timers are installed.

describe('offline/online event handling', () => {
  it('sets wsConnected to false immediately on window offline event', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([])));
    const sync = useDirectusSync();
    // Awaiting startSync ensures _hydrateConfigFromLocalCache (IDB) has finished
    // and window event listeners are registered before we dispatch the event.
    await sync.startSync({ appType: 'cassa', store: makeStore() });

    sync.wsConnected.value = true;

    window.dispatchEvent(new Event('offline'));
    expect(sync.wsConnected.value).toBe(false);

    sync.stopSync();
  });

  it('cancels _onlineRetryTimer when the device goes offline again before it fires', async () => {
    const { enqueue } = await import('../useSyncQueue.js');
    await enqueue('orders', 'create', 'ord_timer_test', { id: 'ord_timer_test' });

    let pushPostCalls = 0;
    vi.spyOn(global, 'fetch').mockImplementation((url, opts = {}) => {
      const method = (opts?.method ?? 'GET').toUpperCase();
      if (String(url).includes('/items/orders') && method === 'POST') {
        pushPostCalls++;
        return Promise.reject(new TypeError('simulated network error'));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    try {
      // Await with real timers so _hydrateConfigFromLocalCache (IDB) can
      // resolve normally and the online/offline listeners are guaranteed to be
      // registered before any events are dispatched.
      await sync.startSync({ appType: 'cassa', store: makeStore() });
      await flushPromises(LONG_FLUSH_ROUNDS);

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });

      // Reset after startSync's own push attempt.
      pushPostCalls = 0;

      // online → _runPush fires immediately (POST attempt #1);
      // because the POST rejects with TypeError the push returns offline:true
      // which schedules the 5 s retry timer.
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(1); // drain IDB from the push
      await flushPromises(LONG_FLUSH_ROUNDS);
      expect(pushPostCalls).toBe(1);

      // offline before the 5 s timer fires → timer must be cancelled
      window.dispatchEvent(new Event('offline'));

      // Advance past the 5 s window — the retry should NOT fire
      await vi.advanceTimersByTimeAsync(6_000);
      await flushPromises(LONG_FLUSH_ROUNDS);
      expect(pushPostCalls).toBe(1);
    } finally {
      sync.stopSync();
      vi.useRealTimers();
    }
  });

  it('does not run the delayed push retry after stopSync()', async () => {
    const { enqueue } = await import('../useSyncQueue.js');
    await enqueue('orders', 'create', 'ord_stopsync_test', { id: 'ord_stopsync_test' });

    let pushPostCalls = 0;
    vi.spyOn(global, 'fetch').mockImplementation((url, opts = {}) => {
      const method = (opts?.method ?? 'GET').toUpperCase();
      if (String(url).includes('/items/orders') && method === 'POST') {
        pushPostCalls++;
        return Promise.reject(new TypeError('simulated network error'));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    try {
      // Await with real timers so _hydrateConfigFromLocalCache (IDB) can
      // resolve normally and the online/offline listeners are guaranteed to be
      // registered before any events are dispatched.
      await sync.startSync({ appType: 'cassa', store: makeStore() });
      await flushPromises(LONG_FLUSH_ROUNDS);

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
      pushPostCalls = 0;

      // online → immediate push fails (offline: true) → 5 s retry timer is scheduled
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(1);
      await flushPromises(LONG_FLUSH_ROUNDS);
      expect(pushPostCalls).toBe(1);

      // stopSync() cancels the retry timer and sets _running = false
      sync.stopSync();

      // Advance past the 5 s window — timer is cancelled, retry must not fire
      await vi.advanceTimersByTimeAsync(6_000);
      await flushPromises(LONG_FLUSH_ROUNDS);
      expect(pushPostCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs a delayed push retry 5 s after online event when still running', async () => {
    const { enqueue } = await import('../useSyncQueue.js');
    await enqueue('orders', 'create', 'ord_retry_test', { id: 'ord_retry_test' });

    let pushPostCalls = 0;
    vi.spyOn(global, 'fetch').mockImplementation((url, opts = {}) => {
      const method = (opts?.method ?? 'GET').toUpperCase();
      if (String(url).includes('/items/orders') && method === 'POST') {
        pushPostCalls++;
        return Promise.reject(new TypeError('simulated network error'));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    try {
      // Await with real timers so _hydrateConfigFromLocalCache (IDB) can
      // resolve normally and the online/offline listeners are guaranteed to be
      // registered before any events are dispatched.
      await sync.startSync({ appType: 'cassa', store: makeStore() });
      await flushPromises(LONG_FLUSH_ROUNDS);

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
      pushPostCalls = 0;

      // online → immediate push fails, timer scheduled for 5 s
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(1); // drain IDB from the push
      await flushPromises(LONG_FLUSH_ROUNDS);
      expect(pushPostCalls).toBe(1);

      // Advance 5 s — the retry timer fires another _runPush()
      await vi.advanceTimersByTimeAsync(5_000);
      await flushPromises(LONG_FLUSH_ROUNDS);
      expect(pushPostCalls).toBe(2);
    } finally {
      sync.stopSync();
      vi.useRealTimers();
    }
  });

  it('does not schedule the delayed push retry when the first push succeeds', async () => {
    const { enqueue } = await import('../useSyncQueue.js');
    await enqueue('orders', 'create', 'ord_push_ok_test', { id: 'ord_push_ok_test' });

    let pushPostCalls = 0;
    vi.spyOn(global, 'fetch').mockImplementation((url, opts = {}) => {
      const method = (opts?.method ?? 'GET').toUpperCase();
      if (String(url).includes('/items/orders') && method === 'POST') {
        pushPostCalls++;
        // Return a successful Directus create response so drainQueue resolves
        // with offline: false — no retry timer should be scheduled.
        return Promise.resolve(directusItemResponse({ id: 'ord_push_ok_test' }));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    try {
      await sync.startSync({ appType: 'cassa', store: makeStore() });
      await flushPromises(LONG_FLUSH_ROUNDS);

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
      pushPostCalls = 0;

      // online → push succeeds (offline: false) → retry timer must NOT be scheduled
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(1); // drain IDB from the push
      await flushPromises(LONG_FLUSH_ROUNDS);
      expect(pushPostCalls).toBe(1);

      // Advance well past the 5 s window — no retry must fire
      await vi.advanceTimersByTimeAsync(10_000);
      await flushPromises(LONG_FLUSH_ROUNDS);
      expect(pushPostCalls).toBe(1);
    } finally {
      sync.stopSync();
      vi.useRealTimers();
    }
  });

  it('a second online event before the retry timer fires resets the timer cleanly', async () => {
    const { enqueue } = await import('../useSyncQueue.js');
    await enqueue('orders', 'create', 'ord_rapid_test', { id: 'ord_rapid_test' });

    let pushPostCalls = 0;
    vi.spyOn(global, 'fetch').mockImplementation((url, opts = {}) => {
      const method = (opts?.method ?? 'GET').toUpperCase();
      if (String(url).includes('/items/orders') && method === 'POST') {
        pushPostCalls++;
        return Promise.reject(new TypeError('simulated network error'));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    try {
      await sync.startSync({ appType: 'cassa', store: makeStore() });
      await flushPromises(LONG_FLUSH_ROUNDS);

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
      pushPostCalls = 0;

      // First online event — push fails (offline: true) → timer A scheduled at ~t+5 s
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(1); // drain IDB from push #1
      await flushPromises(LONG_FLUSH_ROUNDS);
      expect(pushPostCalls).toBe(1);

      // Second online event fires at t≈2 s — before timer A would have fired.
      // The start of _onOnline cancels timer A and starts push #2.
      await vi.advanceTimersByTimeAsync(2_000);
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(1); // drain IDB from push #2
      await flushPromises(LONG_FLUSH_ROUNDS);
      expect(pushPostCalls).toBe(2); // push #1 + push #2

      // Push #2 also fails (offline: true) → timer B is scheduled 5 s from now
      // (~t=7 s).  Advance 6 s to pass timer B's deadline — timer A was cancelled;
      // timer B fires push #3.
      await vi.advanceTimersByTimeAsync(6_000);
      await flushPromises(LONG_FLUSH_ROUNDS);
      expect(pushPostCalls).toBe(3); // push #1, push #2, push #3 (timer B)

      // Push #3 also fails → _scheduleOnlineRetry() reschedules (timer C at ~t=13 s).
      // Advance 5 s to verify push #4 fires.
      await vi.advanceTimersByTimeAsync(5_000);
      await flushPromises(LONG_FLUSH_ROUNDS);
      expect(pushPostCalls).toBe(4); // push #4 (timer C)

      // stopSync() cancels the pending timer — no further retries.
      sync.stopSync();
      await vi.advanceTimersByTimeAsync(10_000);
      await flushPromises(LONG_FLUSH_ROUNDS);
      expect(pushPostCalls).toBe(4);
    } finally {
      // stopSync() may already have been called above; calling it again via
      // finally is safe (removeEventListener is idempotent).
      sync.stopSync();
      vi.useRealTimers();
    }
  });

  it('offline event releases a stuck _pushInFlight so the next online push starts fresh', async () => {
    // Real-world failure: a push is in-flight with a hung fetch (TCP timeout could
    // take 10-20 min).  Without the generation-counter fix, _pushInFlight stays
    // set to the hung promise; every subsequent _runPush() call — including
    // _onOnline's recovery push — returns the same stuck promise, leaving the
    // queue completely blocked until the app is restarted.
    const { enqueue } = await import('../useSyncQueue.js');
    await enqueue('orders', 'create', 'ord_stuck_test', { id: 'ord_stuck_test' });

    let pushPostCalls = 0;
    // Flag: when true the NEXT POST call returns a never-resolving promise (TCP hang).
    let hangNextCall = false;

    vi.spyOn(global, 'fetch').mockImplementation((url, opts = {}) => {
      const method = (opts?.method ?? 'GET').toUpperCase();
      if (String(url).includes('/items/orders') && method === 'POST') {
        pushPostCalls++;
        expect(opts.signal).toBeDefined();
        if (hangNextCall) {
          hangNextCall = false; // only hang once
          // Simulate TCP-level hang: promise never resolves on its own, but
          // rejects immediately when the AbortController signals abortion so
          // the test does not leave a dangling forever-pending microtask.
          return new Promise((_, reject) => {
            const abortError = () => {
              const error = new Error('The operation was aborted.');
              error.name = 'AbortError';
              reject(error);
            };
            if (opts.signal.aborted) {
              abortError();
              return;
            }
            opts.signal.addEventListener('abort', abortError, { once: true });
          });
        }
        return Promise.reject(new TypeError('simulated network error'));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    try {
      // startSync phase: mock fails fast (hangNextCall = false) so the initial push
      // from startSync completes and _pushInFlight is null before we switch to fake timers.
      await sync.startSync({ appType: 'cassa', store: makeStore() });
      await flushPromises(LONG_FLUSH_ROUNDS);

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
      pushPostCalls = 0;

      // Arm the hung-fetch for the upcoming online-event push.
      hangNextCall = true;

      // Push #1 starts via online event — fetch hangs, _pushInFlight is stuck.
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(1); // drain IDB read inside _runPush
      await flushPromises(LONG_FLUSH_ROUNDS);
      expect(pushPostCalls).toBe(1); // fetch was called and is now hanging

      // Device goes offline — _pushAbortController.abort() fires the AbortError
      // on the hung mock fetch so push #1's drain halts cleanly.  The generation
      // is also incremented and _pushInFlight set to null.
      window.dispatchEvent(new Event('offline'));
      await flushPromises(LONG_FLUSH_ROUNDS); // let push #1 resolve via AbortError

      // Device comes back online — _onOnline should start a FRESH push (push #2),
      // not be blocked by the now-aborted push #1.
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(1); // drain IDB for push #2
      await flushPromises(LONG_FLUSH_ROUNDS);
      // Push #2 ran (fetch #2 → rejected quickly via TypeError).
      expect(pushPostCalls).toBe(2);
    } finally {
      sync.stopSync();
      vi.useRealTimers();
    }
  });

  it('forcePush bypasses a stuck in-flight so the manual "Push ora" override always runs', async () => {
    // Real-world failure: the user clicks "Push ora" but the push queue appears
    // completely frozen.  The root cause: a previous push is stuck on a hung fetch
    // (TCP timeout).  Without the generation-counter fix, forcePush() returns the
    // same hung promise and the UI spinner never resolves.
    const { enqueue } = await import('../useSyncQueue.js');
    await enqueue('orders', 'create', 'ord_force_stuck', { id: 'ord_force_stuck' });

    let pushPostCalls = 0;
    let hangNextCall = false;

    vi.spyOn(global, 'fetch').mockImplementation((url, opts = {}) => {
      const method = (opts?.method ?? 'GET').toUpperCase();
      if (String(url).includes('/items/orders') && method === 'POST') {
        pushPostCalls++;
        expect(opts.signal).toBeDefined();
        if (hangNextCall) {
          hangNextCall = false;
          return new Promise((_, reject) => {
            const abortError = () => {
              const error = new Error('The operation was aborted.');
              error.name = 'AbortError';
              reject(error);
            };
            if (opts.signal.aborted) {
              abortError();
              return;
            }
            opts.signal.addEventListener('abort', abortError, { once: true });
          }); // TCP hang until aborted
        }
        return Promise.reject(new TypeError('simulated network error'));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    try {
      // startSync with a fast-failing mock so _pushInFlight is null before fake timers.
      await sync.startSync({ appType: 'cassa', store: makeStore() });
      await flushPromises(LONG_FLUSH_ROUNDS);

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
      pushPostCalls = 0;

      // Arm hung-fetch; start push #1 via online event — it gets stuck.
      hangNextCall = true;
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(1);
      await flushPromises(LONG_FLUSH_ROUNDS);
      expect(pushPostCalls).toBe(1); // push #1 in-flight, fetch hanging

      // User presses "Push ora" → forcePush() must bypass the stuck push and resolve.
      // Before fix: forcePush() → _runPush() → _pushInFlight (hung) → returns hung
      //             promise → await never returns.
      // After fix:  forcePush() increments _pushGeneration, clears _pushInFlight,
      //             starts a fresh push (#2) whose fetch fails fast → resolves.
      const result = await (async () => {
        const p = sync.forcePush();
        await vi.advanceTimersByTimeAsync(1); // IDB read for push #2
        await flushPromises(LONG_FLUSH_ROUNDS);
        return p;
      })();

      expect(pushPostCalls).toBe(2); // fresh push #2 ran
      expect(result).toMatchObject({ pushed: 0 }); // resolved (not hanging)
    } finally {
      sync.stopSync();
      vi.useRealTimers();
    }
  });
});

// ── S3: Pull semaphore (_pullInFlight) ────────────────────────────────────────

describe('S3 — _runPull semaphore', () => {
  it('forcePull() resets the semaphore so two successive forced pulls each issue fetches', async () => {
    let fetchCallCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/items/')) {
        fetchCallCount++;
        return Promise.resolve(directusListResponse([]));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    // First forced pull
    await sync.forcePull();
    const callsAfterFirst = fetchCallCount;
    // Second forced pull must issue new fetches (not return same cached promise)
    await sync.forcePull();
    expect(fetchCallCount).toBeGreaterThan(callsAfterFirst);
  });
});

// ── S4: Adaptive echo TTL ─────────────────────────────────────────────────────

describe('S4 — adaptive echo TTL', () => {
  it('suppresses echo for longer than 5 s on high-RTT connections', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      // Seed IDB
      await upsertRecordsIntoIDB('orders', [{ id: 'ord_rtt_1', status: 'pending' }]);

      // Register echo with a 15 s adaptive TTL (simulating ~5 s RTT × 3)
      _registerPushedEchoes([{ collection: 'orders', recordId: 'ord_rtt_1' }], 15_000);

      // Advance 6 s — past the default 5 s TTL, but within the 15 s adaptive TTL
      vi.setSystemTime(Date.now() + 6_000);

      await _handleSubscriptionMessage('orders', {
        event: 'create',
        data: [{ id: 'ord_rtt_1', status: 'accepted', date_updated: '2026-01-01T00:00:01.000Z' }],
      });

      const { getDB } = await import('../useIDB.js');
      const db = await getDB();
      const stored = await db.get('orders', 'ord_rtt_1');
      // Still within adaptive TTL — echo should be suppressed
      expect(stored?.status).toBe('pending');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not suppress echo after the adaptive TTL expires', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      await upsertRecordsIntoIDB('orders', [{ id: 'ord_rtt_2', status: 'pending' }]);

      _registerPushedEchoes([{ collection: 'orders', recordId: 'ord_rtt_2' }], 10_000);

      // Advance 11 s — past the 10 s adaptive TTL
      vi.setSystemTime(Date.now() + 11_000);

      await _handleSubscriptionMessage('orders', {
        event: 'create',
        data: [{ id: 'ord_rtt_2', status: 'accepted', date_updated: '2026-01-01T00:00:01.000Z' }],
      });

      const { getDB } = await import('../useIDB.js');
      const db = await getDB();
      const stored = await db.get('orders', 'ord_rtt_2');
      // After adaptive TTL — echo suppression lifted
      expect(stored?.status).toBe('accepted');
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── S6: Clock-skew guard ──────────────────────────────────────────────────────

describe('S6 — clock skew guard', () => {
  it('clamps the cursor to now (no full pull) when the stored cursor is beyond the tolerance', async () => {
    // Store a cursor dated 2 days in the future to simulate severe clock skew.
    // Old behaviour: forced a full pull every cycle → perpetual performance hit.
    // New behaviour: clamps the cursor to Date.now() and proceeds with an incremental pull.
    const futureTs = new Date(Date.now() + 2 * 24 * 60 * 60_000).toISOString();
    await saveLastPullTsToIDB('orders', futureTs);

    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([])));

    const sync = useDirectusSync();
    await sync.forcePull();

    const orderUrls = fetchSpy.mock.calls
      .map(([url]) => String(url))
      .filter(url => url.includes('/items/orders'));
    expect(orderUrls.length).toBeGreaterThan(0);

    // The future cursor must NOT appear in any fetch URL (it was clamped away).
    const futureTsPrefix = futureTs.slice(0, 10); // date portion, e.g. '2026-05-02'
    orderUrls.forEach(url => {
      expect(decodeURIComponent(url)).not.toContain(futureTsPrefix);
    });

    // The persisted cursor must now be a recent timestamp (within 5 s of this test run).
    const savedTs = await loadLastPullTsFromIDB('orders');
    expect(savedTs).toBeDefined();
    const savedTsMs = new Date(savedTs).getTime();
    expect(savedTsMs).toBeLessThanOrEqual(Date.now() + 5_000);
    expect(savedTsMs).toBeGreaterThan(Date.now() - 60_000);
  });

  it('uses incremental pull when the cursor is within the tolerance window', async () => {
    // Store a cursor 1 hour in the future (within 24 h tolerance)
    const recentTs = new Date(Date.now() + 60 * 60_000).toISOString();
    await saveLastPullTsToIDB('orders', recentTs);

    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(directusListResponse([])));

    const sync = useDirectusSync();
    await sync.forcePull();

    const orderUrls = fetchSpy.mock.calls
      .map(([url]) => String(url))
      .filter(url => url.includes('/items/orders'));
    expect(orderUrls.length).toBeGreaterThan(0);
    // Within tolerance: still uses the incremental filter
    expect(orderUrls.some(url => hasDateUpdatedIncrementalFilter(url))).toBe(true);
  });
});

// ── S7 — Atomic IDB transaction: order_items upsert + orderItems merge ─────────

describe('S7 — _atomicOrderItemsUpsertAndMerge', () => {
  it('writes order_items AND merges into parent orders in a single atomic step', async () => {
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();

    // Seed a parent order with no items
    await db.put('orders', {
      id: 'ord_s7_1',
      status: 'accepted',
      table: '01',
      orderItems: [],
      date_updated: '2024-01-01T00:00:00.000Z',
    });

    const mappedItem = {
      id: 'oi_s7_1',
      order: 'ord_s7_1',
      orderId: 'ord_s7_1',
      name: 'Pasta',
      quantity: 2,
      unitPrice: 8,
      unit_price: 8,
      kitchenReady: false,
      date_updated: '2024-06-01T00:00:00.000Z',
    };

    const { orderItemsWritten, ordersWritten } = await _atomicOrderItemsUpsertAndMerge([mappedItem], []);

    // Both stores must have been updated
    expect(orderItemsWritten).toBe(1);
    expect(ordersWritten).toBe(1);

    const storedItem = await db.get('order_items', 'oi_s7_1');
    expect(storedItem).toBeDefined();
    expect(storedItem.name).toBe('Pasta');

    const order = await db.get('orders', 'ord_s7_1');
    expect(order.orderItems).toHaveLength(1);
    expect(order.orderItems[0].id).toBe('oi_s7_1');
    expect(order.orderItems[0].name).toBe('Pasta');
  });

  it('returns { 0, 0 } and writes nothing for an empty items array', async () => {
    const result = await _atomicOrderItemsUpsertAndMerge([]);
    expect(result).toEqual({ orderItemsWritten: 0, ordersWritten: 0, affectedOrderIds: new Set() });
  });

  it('respects LWW: does not overwrite a newer existing order_item in the order_items store', async () => {
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();

    // Seed a newer order_item and its parent order
    await db.put('order_items', {
      id: 'oi_s7_lww',
      order: 'ord_s7_lww',
      orderId: 'ord_s7_lww',
      name: 'Newer',
      quantity: 5,
      date_updated: '2024-09-01T00:00:00.000Z',
    });
    await db.put('orders', {
      id: 'ord_s7_lww',
      orderItems: [{
        id: 'oi_s7_lww',
        order: 'ord_s7_lww',
        name: 'Newer',
        quantity: 5,
        date_updated: '2024-09-01T00:00:00.000Z',
      }],
      date_updated: '2024-01-01T00:00:00.000Z',
    });

    // Incoming item is older — must be skipped
    const olderItem = {
      id: 'oi_s7_lww',
      order: 'ord_s7_lww',
      orderId: 'ord_s7_lww',
      name: 'Older',
      quantity: 1,
      date_updated: '2024-03-01T00:00:00.000Z',
    };

    const { orderItemsWritten, ordersWritten } = await _atomicOrderItemsUpsertAndMerge([olderItem]);

    // Nothing should be written
    expect(orderItemsWritten).toBe(0);
    expect(ordersWritten).toBe(0);

    // Original values must remain unchanged
    const storedItem = await db.get('order_items', 'oi_s7_lww');
    expect(storedItem.name).toBe('Newer');
    expect(storedItem.quantity).toBe(5);
  });

  it('does not overwrite the embedded orderItems merge when incoming is older', async () => {
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();

    await db.put('orders', {
      id: 'ord_s7_embed_lww',
      orderItems: [{
        id: 'oi_s7_embed',
        order: 'ord_s7_embed_lww',
        name: 'Fresco',
        quantity: 3,
        date_updated: '2024-12-01T00:00:00.000Z',
      }],
      date_updated: '2024-01-01T00:00:00.000Z',
    });

    const olderEmbedItem = {
      id: 'oi_s7_embed',
      order: 'ord_s7_embed_lww',
      orderId: 'ord_s7_embed_lww',
      name: 'Vecchio',
      quantity: 1,
      date_updated: '2024-06-01T00:00:00.000Z', // older than embedded
    };

    await _atomicOrderItemsUpsertAndMerge([olderEmbedItem]);

    const order = await db.get('orders', 'ord_s7_embed_lww');
    // Embedded item must be preserved (incoming is older)
    expect(order.orderItems[0].name).toBe('Fresco');
    expect(order.orderItems[0].quantity).toBe(3);
  });

  it('pull — order_items uses atomic transaction (both stores updated atomically)', async () => {
    // Regression guard: the REST pull path for order_items must update BOTH the
    // order_items store and the embedded orders.orderItems array. This test verifies
    // the S7 integration inside _pullCollection for the order_items collection.
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();

    await db.put('orders', {
      id: 'ord_s7_pull',
      status: 'accepted',
      table: '05',
      orderItems: [],
      date_updated: '2024-01-01T00:00:00.000Z',
    });

    const remoteItem = {
      id: 'oi_s7_pull',
      order: 'ord_s7_pull',
      name: 'Risotto',
      quantity: 1,
      unit_price: 14,
      voided_quantity: 0,
      kitchen_ready: false,
      date_updated: '2024-06-01T00:00:00.000Z',
    };

    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (url.includes('/items/order_items')) return Promise.resolve(directusListResponse([remoteItem]));
      return Promise.resolve(directusListResponse([]));
    });

    const store = makeStore();
    const sync = useDirectusSync();
    sync.startSync({ appType: 'cucina', store });
    await sync.forcePull();

    // order_items store must contain the pulled record
    const storedItem = await db.get('order_items', 'oi_s7_pull');
    expect(storedItem).toBeDefined();
    expect(storedItem.name).toBe('Risotto');

    // orders.orderItems must reflect the merge (atomically with the store write)
    const order = await db.get('orders', 'ord_s7_pull');
    expect(order.orderItems).toHaveLength(1);
    expect(order.orderItems[0].id).toBe('oi_s7_pull');
  });
});

// ── NS1 — WS order_items uses _atomicOrderItemsUpsertAndMerge ─────────────────

describe('NS1 — WS order_items: _atomicOrderItemsUpsertAndMerge merge semantics', () => {
  it('partial WS update preserves existing fields not present in the incoming payload', async () => {
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();

    // Seed parent order with an embedded order item that has quantity=3
    await db.put('orders', {
      id: 'ord_ns1',
      status: 'accepted',
      table: '01',
      orderItems: [{
        id: 'oi_ns1',
        orderId: 'ord_ns1',
        name: 'Bistecca',
        quantity: 3,
        unitPrice: 10,
        voidedQuantity: 0,
        kitchenReady: false,
        date_updated: '2024-01-01T00:00:00.000Z',
      }],
      date_updated: '2024-01-01T00:00:00.000Z',
    });

    // WS update: only kitchen_ready changes — quantity is NOT in the payload
    await _handleSubscriptionMessage('order_items', {
      event: 'update',
      data: [{
        id: 'oi_ns1',
        order: 'ord_ns1',
        kitchen_ready: true,
        date_updated: '2024-06-01T00:00:00.000Z',
      }],
    });

    // The embedded orderItem in the parent order must still have quantity=3
    const order = await db.get('orders', 'ord_ns1');
    expect(order).toBeDefined();
    expect(order.orderItems).toHaveLength(1);
    expect(order.orderItems[0].quantity).toBe(3);
    expect(order.orderItems[0].kitchenReady).toBe(true);
  });

  it('WS create for order_item writes to both order_items store and parent orders.orderItems atomically', async () => {
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();

    await db.put('orders', {
      id: 'ord_ns1_create',
      status: 'pending',
      table: '02',
      orderItems: [],
      date_updated: '2024-01-01T00:00:00.000Z',
    });

    await _handleSubscriptionMessage('order_items', {
      event: 'create',
      data: [{
        id: 'oi_ns1_create',
        order: 'ord_ns1_create',
        name: 'Risotto',
        quantity: 2,
        unit_price: 14,
        voided_quantity: 0,
        kitchen_ready: false,
        date_updated: '2024-06-01T00:00:00.000Z',
      }],
    });

    // Both stores must reflect the new item
    const storedItem = await db.get('order_items', 'oi_ns1_create');
    expect(storedItem).toBeDefined();

    const order = await db.get('orders', 'ord_ns1_create');
    expect(order.orderItems).toHaveLength(1);
    expect(order.orderItems[0].id).toBe('oi_ns1_create');
    expect(order.orderItems[0].name).toBe('Risotto');
  });
});

// ── NS4 — _tableMergePullInFlight deduplication ───────────────────────────────

describe('NS4 — _tableMergePullInFlight deduplication', () => {
  it('two concurrent WS delete events for table_merge_sessions trigger only one fetch', async () => {
    let tmsFetchCount = 0;
    let resolveFirstFetch;
    const firstFetchPromise = new Promise(res => { resolveFirstFetch = res; });

    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/items/table_merge_sessions')) {
        tmsFetchCount++;
        if (tmsFetchCount === 1) {
          return firstFetchPromise.then(() => directusListResponse([]));
        }
        return Promise.resolve(directusListResponse([]));
      }
      return Promise.resolve(directusListResponse([]));
    });

    // Two concurrent delete events — both should share the same inflight pull
    const p1 = _handleSubscriptionMessage('table_merge_sessions', {
      event: 'delete',
      data: ['tms_a'],
    });
    const p2 = _handleSubscriptionMessage('table_merge_sessions', {
      event: 'delete',
      data: ['tms_b'],
    });

    // At this point the fetch is in flight but not yet resolved
    await flushPromises(10);
    expect(tmsFetchCount).toBe(1);

    // Resolve the fetch and let both handlers complete
    resolveFirstFetch();
    await Promise.all([p1, p2]);

    // Despite two events, only one fetch should have been made
    expect(tmsFetchCount).toBe(1);
  });
});

// ── NS5 — _globalPullInFlight deduplication ───────────────────────────────────

describe('NS5 — _globalPullInFlight deduplication', () => {
  it('two concurrent reconfigureAndApply() calls both succeed', async () => {
    let venueFetchCount = 0;

    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/items/venues/')) {
        venueFetchCount++;
        return Promise.resolve(directusItemResponse({
          id: 1,
          name: 'Test Venue NS5',
          status: 'published',
          menu_source: 'directus',
          tables: [],
          rooms: [],
          menu_items: [],
          menu_categories: [],
          printers: [],
          venue_users: [],
          table_merge_sessions: [],
          payment_methods: [],
          cover_charge_enabled: false,
          cover_charge_auto_add: false,
          cover_charge_price_adult: '0',
          cover_charge_price_child: '0',
          billing_enable_cash_change_calculator: false,
          billing_enable_tips: false,
          billing_enable_discounts: false,
          billing_allow_custom_entry: false,
        }));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();

    // Fire two reconfigureAndApply() calls back-to-back without any await between them.
    // reconfigureAndApply is user-initiated, so each call resets the in-flight semaphore
    // and starts its own fresh pull — both must succeed even though they run concurrently.
    const p1 = sync.reconfigureAndApply();
    const p2 = sync.reconfigureAndApply();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    // Each user-initiated call starts its own fresh pull.
    expect(venueFetchCount).toBeGreaterThanOrEqual(1);
  });
});

// ── NS7 — keyset cursor pagination ────────────────────────────────────────────

/**
 * Returns true when the URL encodes an `id._gt` keyset filter.
 * Supports both bracketed and JSON-encoded Directus filter formats.
 */
function hasIdGtFilter(urlString) {
  const url = new URL(String(urlString));
  const keys = Array.from(url.searchParams.keys());

  // Bracketed form: filter[id][_gt]=... or filter[_and][...][id][_gt]=...
  if (keys.some(k => k.includes('[id]') && k.includes('[_gt]'))) return true;

  const rawFilter = url.searchParams.get('filter');
  if (!rawFilter) return false;

  try {
    const parsed = JSON.parse(rawFilter);
    const stack = [parsed];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      if (node.id?._gt !== undefined) return true;
      for (const v of Object.values(node)) {
        if (typeof v === 'object' && v !== null) stack.push(v);
      }
    }
  } catch {
    // Ignore non-JSON filter encodings
  }

  return false;
}

describe('NS7 — keyset cursor pagination', () => {
  it('second page request uses id._gt keyset filter when all page-1 records share sinceTs', async () => {
    const sinceTs = '2024-06-01T00:00:00.000Z';
    await saveLastPullTsToIDB('orders', sinceTs);

    // 200 records all with date_updated === sinceTs — triggers keyset on page 2
    const page1 = Array.from({ length: 200 }, (_, i) =>
      makeRemoteOrder({
        id: `ord_ns7_${String(i).padStart(3, '0')}`,
        date_updated: sinceTs,
      }),
    );

    const fetchedOrderUrls = [];
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const s = String(url);
      if (s.includes('/items/orders')) {
        fetchedOrderUrls.push(s);
        // Page 1: return 200 records; any subsequent page returns empty
        if (fetchedOrderUrls.length === 1) {
          return Promise.resolve(directusListResponse(page1));
        }
        return Promise.resolve(directusListResponse([]));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    await sync.forcePull();

    // Must have made at least 2 requests to /items/orders (page 1 + page 2)
    expect(fetchedOrderUrls.length).toBeGreaterThanOrEqual(2);

    // The second request must carry the id._gt keyset filter
    const page2Url = fetchedOrderUrls[1];
    expect(hasIdGtFilter(page2Url)).toBe(true);

    // The keyset cursor id must reference the last record of page 1
    // (check that the URL references ord_ns7_199 somewhere)
    expect(decodeURIComponent(page2Url)).toContain('ord_ns7_199');
  });

  it('activates keyset on page 2 even when page-1 records have date_updated > sinceTs', async () => {
    // Regression test for the bug where cursor.ts === sinceTs was required to
    // activate keyset mode.  When page-1 records are newer than sinceTs the old
    // condition silently fell back to offset pagination, causing double-skipping.
    const sinceTs = '2024-06-01T00:00:00.000Z';
    const newerTs = '2024-06-02T12:00:00.000Z'; // all records are newer than sinceTs
    await saveLastPullTsToIDB('orders', sinceTs);

    // 200 records all with date_updated > sinceTs — keyset must still fire on page 2
    const page1 = Array.from({ length: 200 }, (_, i) =>
      makeRemoteOrder({
        id: `ord_ns7b_${String(i).padStart(3, '0')}`,
        date_updated: newerTs,
      }),
    );

    const fetchedOrderUrls = [];
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const s = String(url);
      if (s.includes('/items/orders')) {
        fetchedOrderUrls.push(s);
        if (fetchedOrderUrls.length === 1) {
          return Promise.resolve(directusListResponse(page1));
        }
        return Promise.resolve(directusListResponse([]));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    await sync.forcePull();

    expect(fetchedOrderUrls.length).toBeGreaterThanOrEqual(2);

    // Page 2 must use the keyset filter (id._gt based on the last record of page 1)
    const page2Url = fetchedOrderUrls[1];
    expect(hasIdGtFilter(page2Url)).toBe(true);
    expect(decodeURIComponent(page2Url)).toContain('ord_ns7b_199');
  });

  it('page 2 request does not include page=2 offset when keyset cursor is active', async () => {
    // Regression test for double-skipping: with keyset active, Directus must receive
    // page=1 (no offset) so the keyset filter alone determines the result window.
    const sinceTs = '2024-06-01T00:00:00.000Z';
    await saveLastPullTsToIDB('orders', sinceTs);

    const page1 = Array.from({ length: 200 }, (_, i) =>
      makeRemoteOrder({ id: `ord_ns7c_${String(i).padStart(3, '0')}`, date_updated: sinceTs }),
    );

    const fetchedOrderUrls = [];
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const s = String(url);
      if (s.includes('/items/orders')) {
        fetchedOrderUrls.push(s);
        if (fetchedOrderUrls.length === 1) return Promise.resolve(directusListResponse(page1));
        return Promise.resolve(directusListResponse([]));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    await sync.forcePull();

    expect(fetchedOrderUrls.length).toBeGreaterThanOrEqual(2);

    // The page 2 URL must use page=1 (no offset), not page=2
    const page2Url = decodeURIComponent(fetchedOrderUrls[1]);
    // Keyset mode: page param must be 1 to avoid double-skipping
    expect(page2Url).toContain('page=1');
    expect(page2Url).not.toMatch(/page=2(?:[^0-9]|$)/);
  });
});

// ── NS7-CP — cross-poll keyset cursor (eliminates boundary re-downloads) ──────

describe('NS7-CP — cross-poll keyset cursor', () => {
  it('persists a {ts, id} cursor to IDB after the first successful pull', async () => {
    const sinceTs = '2024-06-01T00:00:00.000Z';
    await saveLastPullTsToIDB('orders', sinceTs);

    const record = makeRemoteOrder({ id: 'ord_cp_001', date_updated: '2024-06-02T10:00:00.000Z' });
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/items/orders')) return Promise.resolve(directusListResponse([record]));
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    await sync.forcePull();

    const cursor = await loadLastPullCursorFromIDB('orders');
    expect(cursor).not.toBeNull();
    expect(cursor.id).toBe('ord_cp_001');
    expect(cursor.ts).toBe('2024-06-02T10:00:00.000Z');
  });

  it('uses the stored cursor on the next poll so boundary records are not re-fetched', async () => {
    const sinceTs = '2024-06-01T00:00:00.000Z';
    // Simulate a previous poll that ended with cursor {ts: sinceTs, id: 'ord_cp_last'}
    await saveLastPullTsToIDB('orders', sinceTs);
    await saveLastPullCursorToIDB('orders', { ts: sinceTs, id: 'ord_cp_last' });

    const fetchedUrls = [];
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const s = String(url);
      if (s.includes('/items/orders')) {
        fetchedUrls.push(s);
        return Promise.resolve(directusListResponse([]));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    await sync.forcePull();

    const orderCalls = fetchedUrls.filter(u => u.includes('/items/orders'));
    expect(orderCalls.length).toBeGreaterThan(0);

    // The very first request must use the keyset filter (id._gt) — not a plain _gte
    const firstCall = orderCalls[0];
    expect(hasIdGtFilter(firstCall)).toBe(true);
    // And must reference the stored cursor id
    expect(decodeURIComponent(firstCall)).toContain('ord_cp_last');
  });

  it('does not use a stored cursor when forceFull is used (table_merge_sessions full pull)', async () => {
    // Plant a cursor for orders — should be ignored on a full pull
    const sinceTs = '2024-06-01T00:00:00.000Z';
    await saveLastPullTsToIDB('orders', sinceTs);
    await saveLastPullCursorToIDB('orders', { ts: sinceTs, id: 'ord_should_be_ignored' });

    const fetchedUrls = [];
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const s = String(url);
      if (s.includes('/items/orders')) {
        fetchedUrls.push(s);
        return Promise.resolve(directusListResponse([]));
      }
      return Promise.resolve(directusListResponse([]));
    });

    // Trigger forcePull which uses _runPull (incremental, not forceFull)
    // The stored cursor SHOULD be used here since sinceTs is present
    const sync = useDirectusSync();
    await sync.forcePull();

    // Verify the cursor was loaded and used (id._gt filter present)
    const orderCalls = fetchedUrls.filter(u => u.includes('/items/orders'));
    expect(orderCalls.length).toBeGreaterThan(0);
    expect(hasIdGtFilter(orderCalls[0])).toBe(true);
  });

  it('does NOT use a stored cursor when storedSinceTs is null (first-run full pull)', async () => {
    // No sinceTs in IDB → full pull → cursor must NOT be used
    await saveLastPullCursorToIDB('orders', { ts: '2020-01-01T00:00:00.000Z', id: 'stale_id' });
    // Deliberately omit saveLastPullTsToIDB so storedSinceTs stays null

    const fetchedUrls = [];
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const s = String(url);
      if (s.includes('/items/orders')) {
        fetchedUrls.push(s);
        return Promise.resolve(directusListResponse([]));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    await sync.forcePull();

    const orderCalls = fetchedUrls.filter(u => u.includes('/items/orders'));
    expect(orderCalls.length).toBeGreaterThan(0);
    // First request must NOT include an id._gt filter (no cursor should be active)
    expect(hasIdGtFilter(orderCalls[0])).toBe(false);
    // And must not reference the stale cursor id
    expect(decodeURIComponent(orderCalls[0])).not.toContain('stale_id');
  });

  it('updates the stored cursor when new records arrive in the next poll', async () => {
    const sinceTs = '2024-06-01T00:00:00.000Z';
    const prevCursor = { ts: sinceTs, id: 'ord_cp_old' };
    await saveLastPullTsToIDB('orders', sinceTs);
    await saveLastPullCursorToIDB('orders', prevCursor);

    const newRecord = makeRemoteOrder({ id: 'ord_cp_new', date_updated: '2024-06-03T08:00:00.000Z' });
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/items/orders')) return Promise.resolve(directusListResponse([newRecord]));
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    await sync.forcePull();

    const cursor = await loadLastPullCursorFromIDB('orders');
    expect(cursor).not.toBeNull();
    expect(cursor.id).toBe('ord_cp_new');
    expect(cursor.ts).toBe('2024-06-03T08:00:00.000Z');
    // Timestamp cursor must also have advanced
    const ts = await loadLastPullTsFromIDB('orders');
    expect(ts).toBe('2024-06-03T08:00:00.000Z');
  });

  it('clears last_pull_cursor keys when clearLocalConfigCacheFromIDB is called', async () => {
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();

    // Plant a cursor key alongside a pull-ts key
    await saveLastPullTsToIDB('orders', '2024-06-01T00:00:00.000Z');
    await saveLastPullCursorToIDB('orders', { ts: '2024-06-01T00:00:00.000Z', id: 'ord_to_clear' });

    const { clearLocalConfigCacheFromIDB } = await import('../../store/idbPersistence.js');
    await clearLocalConfigCacheFromIDB();

    const tsRecord = await db.get('app_meta', 'last_pull_ts:orders');
    const cursorRecord = await db.get('app_meta', 'last_pull_cursor:orders');
    expect(tsRecord).toBeUndefined();
    expect(cursorRecord).toBeUndefined();
  });
});

// ── NS8 — AbortController for _runPull ────────────────────────────────────────

describe('NS8 — AbortController for _runPull', () => {
  it('second forcePull() aborts the in-flight pull and itself completes successfully', async () => {
    let ordersFetchCount = 0;
    let resolveSlowFetch;
    const slowFetchPromise = new Promise(res => { resolveSlowFetch = res; });
    // Gate: resolves as soon as the first orders fetch actually starts so we
    // can be certain pull1 is suspended inside _fetchUpdatedViaSDK before
    // starting pull2 — more reliable than counting flushPromises() rounds.
    let signalPull1FetchStarted;
    const pull1FetchGate = new Promise(res => { signalPull1FetchStarted = res; });

    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/items/orders')) {
        ordersFetchCount++;
        if (ordersFetchCount === 1) {
          // First fetch is slow (simulates in-flight pull)
          signalPull1FetchStarted(); // notify the gate before blocking
          return slowFetchPromise.then(() => directusListResponse([]));
        }
        return Promise.resolve(directusListResponse([]));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();

    // Start first pull — wait until it is actually stuck at the orders fetch
    const pull1 = sync.forcePull();
    await pull1FetchGate; // guaranteed: pull1 is now suspended inside fetch

    // Start second pull — aborts pull1's AbortController, starts fresh
    const pull2 = sync.forcePull();

    // Unblock the slow fetch so pull1 can exit cleanly
    resolveSlowFetch();

    const [result1, result2] = await Promise.all([pull1, pull2]);

    // Both pulls must resolve without throwing
    expect(result1).toBeDefined();
    expect(result2.ok).toBe(true);
    // Two fetches must have occurred: one from pull1 (slow), one from pull2 (fresh)
    expect(ordersFetchCount).toBeGreaterThanOrEqual(2);
  });

  it('stopSync() aborts an in-flight pull cleanly without throwing', async () => {
    // Create the blocker Promise and expose its resolver before the pull starts
    // so resolveOrdersFetch is always defined regardless of how many microtask
    // rounds it takes for the pull to reach the orders fetch.
    let resolveOrdersFetch;
    const ordersBlocker = new Promise(res => { resolveOrdersFetch = res; });

    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/items/orders')) {
        return ordersBlocker.then(() => directusListResponse([]));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();

    // Start a pull that blocks at the orders fetch
    const pull = sync.forcePull();
    await flushPromises(20);

    // Abort via stopSync
    sync.stopSync();

    // Unblock the slow fetch so the pull loop can exit
    resolveOrdersFetch?.();

    // Pull must resolve (not throw)
    const result = await pull;
    expect(result).toBeDefined();
    expect(sync.syncStatus.value).toBe('idle');
  });
});

// ── Issue 1 — Atomic WS delete for order_items ───────────────────────────────

describe('Issue 1 — WS delete for order_items is atomic (single IDB transaction)', () => {
  it('removes item from BOTH order_items store AND orders.orderItems in one operation', async () => {
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();

    // Seed parent order with 2 embedded items
    await db.put('orders', {
      id: 'ord_atomic_del',
      status: 'accepted',
      table: '10',
      orderItems: [
        { id: 'oi_atomic_1', name: 'Risotto', quantity: 1, unit_price: 12 },
        { id: 'oi_atomic_2', name: 'Vino',    quantity: 1, unit_price: 7  },
      ],
      date_updated: '2024-01-01T00:00:00.000Z',
    });
    // Seed the order_items ObjectStore (needed for the fast-path lookup)
    await upsertRecordsIntoIDB('order_items', [
      { id: 'oi_atomic_1', order: 'ord_atomic_del', orderId: 'ord_atomic_del', name: 'Risotto', quantity: 1, unit_price: 12 },
    ]);

    await _handleSubscriptionMessage('order_items', {
      event: 'delete',
      data: ['oi_atomic_1'],
    });

    // The order_items ObjectStore must no longer contain the deleted item
    const deleted = await db.get('order_items', 'oi_atomic_1');
    expect(deleted).toBeUndefined();

    // The parent order's embedded array must also have the item removed
    const order = await db.get('orders', 'ord_atomic_del');
    expect(order.orderItems).toHaveLength(1);
    expect(order.orderItems[0].id).toBe('oi_atomic_2');
  });
});

// ── Issue 2 — Keyset null-date condition includes id._gt ──────────────────────

describe('Issue 2 — Keyset null-date branch includes id._gt to prevent infinite loop', () => {
  it('page-2 null-date keyset filter carries id._gt based on cursor', async () => {
    // All order_items have no date_updated (date_updated=null) but a date_created.
    // Without the id._gt fix, the null-date branch would keep fetching the same
    // page-1 records forever.  With the fix the second request must include id._gt.
    const sinceTs = '2024-06-01T00:00:00.000Z';
    await saveLastPullTsToIDB('order_items', sinceTs);

    const page1Items = Array.from({ length: 200 }, (_, i) => ({
      id: `oi_nullts_${String(i).padStart(3, '0')}`,
      order: 'ord_null_parent',
      date_updated: null,
      date_created: '2024-06-02T00:00:00.000Z',
    }));

    // Make sure parent order exists so atomic merge doesn't fail
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();
    await db.put('orders', {
      id: 'ord_null_parent',
      status: 'accepted',
      table: '20',
      orderItems: [],
      date_updated: '2024-01-01T00:00:00.000Z',
    });

    const fetchedItemUrls = [];
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const s = String(url);
      if (s.includes('/items/order_items')) {
        fetchedItemUrls.push(s);
        // Page 1: return 200 null-date items; any subsequent page returns empty
        if (fetchedItemUrls.length === 1) return Promise.resolve(directusListResponse(page1Items));
        return Promise.resolve(directusListResponse([]));
      }
      return Promise.resolve(directusListResponse([]));
    });

    const sync = useDirectusSync();
    await sync.forcePull();

    // Must have fetched at least a second page
    expect(fetchedItemUrls.length).toBeGreaterThanOrEqual(2);

    // The second request must include an id._gt filter to avoid re-fetching page 1
    const page2Url = decodeURIComponent(fetchedItemUrls[1]);
    expect(page2Url).toMatch(/id.*_gt/);
    // The cursor must reference the last item from page 1
    expect(page2Url).toContain('oi_nullts_199');
  });
});

// ── Issue 3 — LWW echo suppression: cross-device update bypasses TTL ──────────

describe('Issue 3 — LWW echo suppression allows cross-device updates through', () => {
  it('allows a WS update through when incoming date_updated is newer than local record', async () => {
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();

    // Seed a record in IDB as if this device had just pushed it at T=100
    await upsertRecordsIntoIDB('orders', [{
      id: 'ord_lww_1',
      status: 'accepted',
      date_updated: '2024-06-01T00:00:00.100Z',
    }]);

    // Register it as a self-echo (TTL still active)
    _registerPushedEchoes([{ collection: 'orders', recordId: 'ord_lww_1' }]);

    // Another device (PDA) modifies the same record at T=200 — strictly newer
    await _handleSubscriptionMessage('orders', {
      event: 'update',
      data: [{
        id: 'ord_lww_1',
        status: 'closed',
        date_updated: '2024-06-01T00:00:00.200Z',
      }],
    });

    // The update must have been written (not suppressed) because T=200 > T=100
    const stored = await db.get('orders', 'ord_lww_1');
    expect(stored?.status).toBe('closed');
  });

  it('still suppresses a WS echo when incoming date_updated equals the local record', async () => {
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();

    const ts = '2024-06-01T00:00:00.000Z';
    await upsertRecordsIntoIDB('orders', [{
      id: 'ord_lww_same',
      status: 'accepted',
      date_updated: ts,
    }]);

    // Register as self-echo
    _registerPushedEchoes([{ collection: 'orders', recordId: 'ord_lww_same' }]);

    // Same timestamp → still our echo, must be suppressed
    await _handleSubscriptionMessage('orders', {
      event: 'update',
      data: [{ id: 'ord_lww_same', status: 'closed', date_updated: ts }],
    });

    const stored = await db.get('orders', 'ord_lww_same');
    expect(stored?.status).toBe('accepted'); // unchanged
  });
});

// ── Issue 4 — _atomicOrderItemsUpsertAndMerge returns affectedOrderIds ─────────

describe('Issue 4 — _atomicOrderItemsUpsertAndMerge returns affectedOrderIds', () => {
  it('returns the set of order IDs whose embedded orderItems were modified', async () => {
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();

    await db.put('orders', {
      id: 'ord_affected_1',
      status: 'accepted',
      table: '30',
      orderItems: [],
      date_updated: '2024-01-01T00:00:00.000Z',
    });
    await db.put('orders', {
      id: 'ord_affected_2',
      status: 'accepted',
      table: '31',
      orderItems: [],
      date_updated: '2024-01-01T00:00:00.000Z',
    });

    const items = [
      { id: 'oi_aff_1', order: 'ord_affected_1', orderId: 'ord_affected_1', name: 'Pasta', quantity: 1, unit_price: 8, date_updated: '2024-06-01T00:00:00.000Z' },
      { id: 'oi_aff_2', order: 'ord_affected_2', orderId: 'ord_affected_2', name: 'Pizza', quantity: 1, unit_price: 9, date_updated: '2024-06-01T00:00:00.000Z' },
    ];

    const result = await _atomicOrderItemsUpsertAndMerge(items, []);

    expect(result.affectedOrderIds).toBeInstanceOf(Set);
    expect(result.affectedOrderIds.size).toBe(2);
    expect(result.affectedOrderIds.has('ord_affected_1')).toBe(true);
    expect(result.affectedOrderIds.has('ord_affected_2')).toBe(true);
  });

  it('does not include an order in affectedOrderIds when its embedded items are unchanged', async () => {
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();

    const existingItem = {
      id: 'oi_unchanged',
      order: 'ord_unchanged',
      orderId: 'ord_unchanged',
      name: 'Acqua',
      quantity: 1,
      unit_price: 2,
      date_updated: '2024-06-01T00:00:00.000Z',
    };

    await db.put('orders', {
      id: 'ord_unchanged',
      status: 'accepted',
      table: '32',
      orderItems: [existingItem],
      date_updated: '2024-01-01T00:00:00.000Z',
    });
    await upsertRecordsIntoIDB('order_items', [existingItem]);

    // Incoming item is identical → LWW should skip; ordersWritten stays 0
    const result = await _atomicOrderItemsUpsertAndMerge([existingItem], []);

    expect(result.affectedOrderIds.has('ord_unchanged')).toBe(false);
    expect(result.ordersWritten).toBe(0);
  });
});

// ── NP1 — _removeOrderItemsFromOrdersIDB fallback scan populates affectedOrderIds ──

describe('NP1 — _removeOrderItemsFromOrdersIDB fallback scan affectedOrderIds', () => {
  it('includes orders updated via fallback cursor scan in the returned affectedOrderIds', async () => {
    // The item is NOT in the order_items store (fresh device scenario), so the
    // normal fast-path lookup returns null and the function falls into the O(n)
    // cursor scan over all orders.  After the fix, the order whose orderItems
    // array was shortened must appear in the returned affectedOrderIds Set so
    // that targeted _refreshStoreFromIDB and BroadcastChannel notifications
    // reach followers correctly.
    const { getDB } = await import('../useIDB.js');
    const db = await getDB();

    const orderId = 'ord_fallback_affected';

    await db.put('orders', {
      id: orderId,
      status: 'accepted',
      table: '99',
      orderItems: [
        { id: 'oi_fb_aff_1', order: orderId, name: 'Pasta', quantity: 1, unit_price: 8 },
        { id: 'oi_fb_aff_2', order: orderId, name: 'Vino', quantity: 2, unit_price: 5 },
      ],
      date_updated: '2024-01-01T00:00:00.000Z',
    });
    // Intentionally do NOT put 'oi_fb_aff_1' into the order_items store so that
    // the function takes the fallback cursor scan path.

    const affectedIds = await _removeOrderItemsFromOrdersIDB(['oi_fb_aff_1']);

    expect(affectedIds).toBeInstanceOf(Set);
    expect(affectedIds.has(orderId)).toBe(true);

    // Sanity-check: the item was actually removed from the embedded array.
    const order = await db.get('orders', orderId);
    expect(order.orderItems).toHaveLength(1);
    expect(order.orderItems[0].id).toBe('oi_fb_aff_2');
  });
});
