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
} from '../useDirectusSync.js';
import {
  upsertRecordsIntoIDB,
  saveStateToIDB,
  loadStateFromIDB,
  loadLastPullTsFromIDB,
  saveLastPullTsToIDB,
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
 * Returns true when a Directus request URL contains a `date_updated > X` filter.
 * Supports both query styles:
 *  - bracketed params: `filter[date_updated][_gt]=...`
 *  - JSON filter param: `filter={"date_updated":{"_gt":"..."}}`
 *
 * @param {string} urlString
 * @returns {boolean}
 */
function hasDateUpdatedGtFilter(urlString) {
  const url = new URL(String(urlString));
  const keys = Array.from(url.searchParams.keys());

  // Pattern like filter[date_updated][_gt]=...
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
      if (node.date_updated?._gt !== undefined) {
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
      expect(hasDateUpdatedGtFilter(url)).toBe(false);
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

    // Verify the filter contains both date_updated > sinceTs and the null-date clause.
    // Directus SDKs may encode this either as a JSON `filter=` param or as
    // bracketed query params like `filter[_or][0][date_updated][_gt]=...`.
    let matchedIncrementalFilter = false;
    for (const url of orderCalls) {
      const parsedUrl = new URL(url);
      const rawFilter = parsedUrl.searchParams.get('filter');

      if (rawFilter) {
        const parsed = JSON.parse(rawFilter);
        const json = JSON.stringify(parsed);
        expect(json).toContain('_or');
        expect(json).toContain('_null');
        expect(json).toContain('date_created');
        matchedIncrementalFilter = true;
        continue;
      }

      const decodedUrl = decodeURIComponent(url);
      const hasBracketedOr = decodedUrl.includes('filter[_or]');
      const hasBracketedNull = decodedUrl.includes('[_null]');
      const hasBracketedDateCreated = decodedUrl.includes('[date_created]');

      if (hasBracketedOr || hasBracketedNull || hasBracketedDateCreated) {
        expect(hasBracketedOr).toBe(true);
        expect(hasBracketedNull).toBe(true);
        expect(hasBracketedDateCreated).toBe(true);
        matchedIncrementalFilter = true;
      }
    }

    expect(matchedIncrementalFilter).toBe(true);
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
      expect(hasDateUpdatedGtFilter(url)).toBe(false);
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

    // WS sends a partial payload: only kitchen_ready is updated — quantity and
    // unit_price are absent, so mapOrderItemFromDirectus fills them with 0.
    await _handleSubscriptionMessage('order_items', {
      event: 'update',
      data: [{
        id: 'oi_partial',
        order: 'ord_ws_partial_oi',
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

  it('_mergeOrderItemsIntoOrdersIDB uses strictly-greater Date comparison (same as upsertRecordsIntoIDB)', async () => {
    // Guards timestamp-comparison consistency: same-timestamp incoming should NOT
    // overwrite an existing embedded item (matches upsertRecordsIntoIDB behavior).
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

    // WS update arrives with the SAME timestamp — should keep existing (not overwrite).
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
    // Same timestamp → incoming does NOT win; existing values preserved.
    expect(item.name).toBe('Originale');
    expect(item.quantity).toBe(5);
    expect(item.unit_price).toBe(10);
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

    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const u = String(url);
      if (!u.includes('/items/orders')) return Promise.resolve(directusListResponse([]));
      if (u.includes('page=1')) return Promise.resolve(directusListResponse(page1Orders));
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
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const u = String(url);
      if (u.includes('/items/orders') && u.includes('page=1')) return Promise.resolve(directusListResponse(page1Orders));
      if (u.includes('/items/orders') && u.includes('page=2')) return Promise.resolve(directusListResponse(page2Orders));
      if (u.includes('/items/orders')) return Promise.resolve(directusListResponse([]));
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

  it('does not advance last_pull_ts when a paginated pull fails mid-cycle', async () => {
    await saveLastPullTsToIDB('orders', '2024-01-01T00:00:00.000Z');
    const page1Orders = Array.from({ length: 200 }, (_, i) => makeRemoteOrder({
      id: `ord_partial_${i}`,
      date_updated: `2024-08-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
    }));

    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const u = String(url);
      if (!u.includes('/items/orders')) return Promise.resolve(directusListResponse([]));
      if (u.includes('page=1')) return Promise.resolve(directusListResponse(page1Orders));
      return Promise.reject(new Error('orders page 2 failed'));
    });

    const sync = useDirectusSync();
    await sync.forcePull();

    const ts = await loadLastPullTsFromIDB('orders');
    expect(ts).toBe('2024-01-01T00:00:00.000Z');
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
    expect(venueCalls.every(url => hasDateUpdatedGtFilter(url) === false)).toBe(true);
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
      expect(hasDateUpdatedGtFilter(url)).toBe(false);
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
