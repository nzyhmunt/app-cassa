/**
 * @file idbPersistence.test.js
 * Unit tests for the IndexedDB persistence helpers in `store/idbPersistence.js`.
 *
 * Covers:
 *  - loadStateFromIDB / saveStateToIDB: round-trip, printLog payload stripping,
 *    billRequestedTables Set↔Array conversion, tableMergedInto ↔ table_merge_sessions
 *  - loadStateFromIDB — bill_sessions hydration: IDB records win over app_meta blob,
 *    records without table are ignored, multi-table merge
 *  - clearAllStateFromIDB: clears every ObjectStore except local_settings
 *  - v2 → v3 migration: app_meta.tableMergedInto → table_merge_sessions
 *  - saveSettingsToIDB / loadSettingsFromIDB: round-trip
 *  - saveUsersToIDB / loadUsersFromIDB: only manual_user records
 *  - saveAuthSessionToIDB / loadAuthSessionFromIDB: persists/clears userId
 *  - saveAuthSettingsToIDB / loadAuthSettingsFromIDB: round-trip
 *  - saveCustomItemsToIDB / loadCustomItemsFromIDB: round-trip
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { _resetIDBSingleton } from '../../composables/useIDB.js';
import { getInstanceName } from '../persistence.js';
import {
  loadStateFromIDB,
  saveStateToIDB,
  clearAllStateFromIDB,
  upsertBillSessionInIDB,
  closeBillSessionInIDB,
  loadSettingsFromIDB,
  saveSettingsToIDB,
  loadUsersFromIDB,
  saveUsersToIDB,
  loadAuthSessionFromIDB,
  saveAuthSessionToIDB,
  loadAuthSettingsFromIDB,
  saveAuthSettingsToIDB,
  loadCustomItemsFromIDB,
  saveCustomItemsToIDB,
  saveFiscalReceiptToIDB,
  loadFiscalReceiptsFromIDB,
  pruneFiscalReceiptsInIDB,
  saveInvoiceRequestToIDB,
  loadInvoiceRequestsFromIDB,
  pruneInvoiceRequestsInIDB,
  clearLocalConfigCacheFromIDB,
  loadConfigFromIDB,
  upsertRecordsIntoIDB,
} from '../idbPersistence.js';

beforeEach(async () => {
  await _resetIDBSingleton();
});

async function sha256(str) {
  const data = new TextEncoder().encode(String(str));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── loadStateFromIDB / saveStateToIDB ─────────────────────────────────────────

describe('loadStateFromIDB()', () => {
  it('returns default empty state when IDB is empty', async () => {
    const state = await loadStateFromIDB();
    expect(state).not.toBeNull();
    expect(state.orders).toEqual([]);
    expect(state.transactions).toEqual([]);
    expect(state.cashBalance).toBe(0);
    expect(state.cashMovements).toEqual([]);
    expect(state.dailyClosures).toEqual([]);
    expect(state.printLog).toEqual([]);
    expect(state.tableCurrentBillSession).toEqual({});
    expect(state.tableMergedInto).toEqual({});
    expect(state.tableOccupiedAt).toEqual({});
    expect(state.billRequestedTables).toBeInstanceOf(Set);
    expect(state.billRequestedTables.size).toBe(0);
  });
});

describe('saveStateToIDB() + loadStateFromIDB()', () => {
  it('round-trips orders and transactions', async () => {
    const sessionObj = { billSessionId: 'bill_1', table: 'T1', status: 'open', adults: 2, children: 0, opened_at: '2024-01-01T12:00:00.000Z' };
    const testState = {
      orders: [{ id: 'ord_1', table: 'T1', status: 'open' }],
      transactions: [{ id: 'tx_1', amount: 10 }],
      cashBalance: 42.5,
      cashMovements: [],
      dailyClosures: [],
      printLog: [],
      tableCurrentBillSession: { T1: sessionObj },
      tableMergedInto: {},
      tableOccupiedAt: { T1: '2024-01-01T12:00:00.000Z' },
      billRequestedTables: new Set(),
    };

    await saveStateToIDB(testState);
    const loaded = await loadStateFromIDB();

    expect(loaded.orders).toEqual([{ id: 'ord_1', table: 'T1', status: 'open' }]);
    expect(loaded.transactions).toEqual([{ id: 'tx_1', amount: 10 }]);
    expect(loaded.cashBalance).toBe(42.5);
    expect(loaded.tableCurrentBillSession).toEqual({ T1: sessionObj });
    expect(loaded.tableOccupiedAt).toEqual({ T1: '2024-01-01T12:00:00.000Z' });
  });

  it('strips the payload field from printLog entries', async () => {
    const testState = {
      orders: [],
      transactions: [],
      cashBalance: 0,
      cashMovements: [],
      dailyClosures: [],
      printLog: [
        { logId: 'pj_1', status: 'done', payload: { items: ['secret'] }, printerId: 'p1' },
        { logId: 'pj_2', status: 'error', payload: null, printerId: 'p2' },
      ],
      tableCurrentBillSession: {},
      tableMergedInto: {},
      tableOccupiedAt: {},
      billRequestedTables: new Set(),
    };

    await saveStateToIDB(testState);
    const loaded = await loadStateFromIDB();

    expect(loaded.printLog).toHaveLength(2);
    expect(loaded.printLog[0]).not.toHaveProperty('payload');
    expect(loaded.printLog[0]).toEqual({ logId: 'pj_1', status: 'done', printerId: 'p1' });
    expect(loaded.printLog[1]).not.toHaveProperty('payload');
  });

  it('round-trips billRequestedTables as a Set', async () => {
    const testState = {
      orders: [],
      transactions: [],
      cashBalance: 0,
      cashMovements: [],
      dailyClosures: [],
      printLog: [],
      tableCurrentBillSession: {},
      tableMergedInto: {},
      tableOccupiedAt: {},
      billRequestedTables: new Set(['T1', 'T3']),
    };

    await saveStateToIDB(testState);
    const loaded = await loadStateFromIDB();

    expect(loaded.billRequestedTables).toBeInstanceOf(Set);
    expect(loaded.billRequestedTables.has('T1')).toBe(true);
    expect(loaded.billRequestedTables.has('T3')).toBe(true);
    expect(loaded.billRequestedTables.size).toBe(2);
  });

  it('handles billRequestedTables provided as a plain Array', async () => {
    const testState = {
      orders: [],
      transactions: [],
      cashBalance: 0,
      cashMovements: [],
      dailyClosures: [],
      printLog: [],
      tableCurrentBillSession: {},
      tableMergedInto: {},
      tableOccupiedAt: {},
      billRequestedTables: ['T2'],
    };

    await saveStateToIDB(testState);
    const loaded = await loadStateFromIDB();

    expect(loaded.billRequestedTables).toBeInstanceOf(Set);
    expect(loaded.billRequestedTables.has('T2')).toBe(true);
  });

  it('truncates printLog to 200 entries on save', async () => {
    const printLog = Array.from({ length: 250 }, (_, i) => ({ logId: `pj_${i}`, status: 'done' }));
    await saveStateToIDB({
      orders: [], transactions: [], cashBalance: 0, cashMovements: [],
      dailyClosures: [], printLog,
      tableCurrentBillSession: {}, tableMergedInto: {}, tableOccupiedAt: {},
      billRequestedTables: new Set(),
    });
    const loaded = await loadStateFromIDB();
    expect(loaded.printLog).toHaveLength(200);
  });

  it('overwrites previous state on a second save', async () => {
    await saveStateToIDB({
      orders: [{ id: 'ord_old' }],
      transactions: [], cashBalance: 5, cashMovements: [],
      dailyClosures: [], printLog: [],
      tableCurrentBillSession: {}, tableMergedInto: {}, tableOccupiedAt: {},
      billRequestedTables: new Set(),
    });
    await saveStateToIDB({
      orders: [{ id: 'ord_new' }],
      transactions: [], cashBalance: 99, cashMovements: [],
      dailyClosures: [], printLog: [],
      tableCurrentBillSession: {}, tableMergedInto: {}, tableOccupiedAt: {},
      billRequestedTables: new Set(),
    });
    const loaded = await loadStateFromIDB();
    expect(loaded.orders).toEqual([{ id: 'ord_new' }]);
    expect(loaded.cashBalance).toBe(99);
  });

  it('partial save: only touches the specified stores, leaves others intact', async () => {
    const sessionObj = { billSessionId: 'bill_1', table: 'T1', status: 'open', adults: 0, children: 0, opened_at: null };
    // Seed full state
    await saveStateToIDB({
      orders: [{ id: 'ord_1' }],
      transactions: [{ id: 'tx_1', amount: 5 }],
      cashBalance: 10,
      cashMovements: [{ id: 'cm_1' }],
      dailyClosures: [],
      printLog: [],
      tableCurrentBillSession: { T1: sessionObj },
      tableMergedInto: {},
      tableOccupiedAt: { T1: '2024-01-01T12:00:00.000Z' },
      billRequestedTables: new Set(['T1']),
    });

    // Partial save: only update orders — must NOT wipe transactions/cashBalance/etc.
    await saveStateToIDB({ orders: [{ id: 'ord_2' }] });
    const loaded = await loadStateFromIDB();

    expect(loaded.orders).toEqual([{ id: 'ord_2' }]);
    // All other stores must be unchanged
    expect(loaded.transactions).toEqual([{ id: 'tx_1', amount: 5 }]);
    expect(loaded.cashBalance).toBe(10);
    expect(loaded.cashMovements).toEqual([{ id: 'cm_1' }]);
    expect(loaded.tableCurrentBillSession).toEqual({ T1: sessionObj });
    expect(loaded.tableOccupiedAt).toEqual({ T1: '2024-01-01T12:00:00.000Z' });
    expect(loaded.billRequestedTables.has('T1')).toBe(true);
  });

  it('partial save: updating tableOccupiedAt does not clobber tableCurrentBillSession', async () => {
    const sessionObj = { billSessionId: 'bill_abc', table: 'T1', status: 'open', adults: 0, children: 0, opened_at: null };
    // Seed full table-state
    await saveStateToIDB({
      orders: [], transactions: [], cashBalance: 0, cashMovements: [],
      dailyClosures: [], printLog: [],
      tableCurrentBillSession: { T1: sessionObj },
      tableMergedInto: { T2: 'T1' },
      tableOccupiedAt: {},
      billRequestedTables: new Set(),
    });

    // Simulate watcher firing only for tableOccupiedAt
    await saveStateToIDB({ tableOccupiedAt: { T1: '2024-06-01T09:00:00.000Z' } });
    const loaded = await loadStateFromIDB();

    expect(loaded.tableOccupiedAt).toEqual({ T1: '2024-06-01T09:00:00.000Z' });
    // The other table-state fields must survive untouched
    expect(loaded.tableCurrentBillSession).toEqual({ T1: sessionObj });
    expect(loaded.tableMergedInto).toEqual({ T2: 'T1' });
  });

  it('stores tableMergedInto in table_merge_sessions (not app_meta)', async () => {
    await saveStateToIDB({
      orders: [], transactions: [], cashBalance: 0, cashMovements: [],
      dailyClosures: [], printLog: [],
      tableCurrentBillSession: {},
      tableMergedInto: { T2: 'T1', T3: 'T1' },
      tableOccupiedAt: {},
      billRequestedTables: new Set(),
    });

    const { getDB } = await import('../../composables/useIDB.js');
    const db = await getDB();

    // Must be stored in dedicated store
    const records = await db.getAll('table_merge_sessions');
    expect(records).toHaveLength(2);
    const bySlave = Object.fromEntries(records.map(r => [r.slave_table, r.master_table]));
    expect(bySlave).toEqual({ T2: 'T1', T3: 'T1' });

    // Must NOT be stored in app_meta
    const legacyRecord = await db.get('app_meta', 'tableMergedInto');
    expect(legacyRecord).toBeUndefined();
  });

  it('removes stale legacy app_meta.tableMergedInto when saving tableMergedInto', async () => {
    const { getDB } = await import('../../composables/useIDB.js');
    const db = await getDB();
    await db.put('app_meta', { id: 'tableMergedInto', value: { OLD: 'T1' } });

    await saveStateToIDB({
      orders: [], transactions: [], cashBalance: 0, cashMovements: [],
      dailyClosures: [], printLog: [],
      tableCurrentBillSession: {},
      tableMergedInto: { T2: 'T1' },
      tableOccupiedAt: {},
      billRequestedTables: new Set(),
    });

    const legacyRecord = await db.get('app_meta', 'tableMergedInto');
    expect(legacyRecord).toBeUndefined();
  });
});

// ── bill_sessions hydration (loadStateFromIDB H1) ─────────────────────────────

describe('loadStateFromIDB() — bill_sessions hydration', () => {
  it('hydrates tableCurrentBillSession from open bill_sessions in IDB', async () => {
    // Directly insert an open bill_session record into IDB (simulating a Directus pull)
    const { getDB } = await import('../../composables/useIDB.js');
    const db = await getDB();
    await db.put('bill_sessions', {
      id: 'sess_abc',
      table: 'T1',
      status: 'open',
      adults: 3,
      children: 1,
      opened_at: '2024-06-01T20:00:00.000Z',
    });

    const loaded = await loadStateFromIDB();

    expect(loaded.tableCurrentBillSession).toHaveProperty('T1');
    expect(loaded.tableCurrentBillSession.T1).toMatchObject({
      billSessionId: 'sess_abc',
      table: 'T1',
      status: 'open',
      adults: 3,
      children: 1,
      opened_at: '2024-06-01T20:00:00.000Z',
    });
  });

  it('IDB bill_sessions records take precedence over the app_meta blob', async () => {
    // Save an app_meta blob for T1 with stale data
    await saveStateToIDB({
      orders: [], transactions: [], cashBalance: 0, cashMovements: [],
      dailyClosures: [], printLog: [],
      tableCurrentBillSession: { T1: { billSessionId: 'stale_sess', table: 'T1', status: 'open', adults: 1, children: 0, opened_at: null } },
      tableMergedInto: {}, tableOccupiedAt: {},
      billRequestedTables: new Set(),
    });

    // Insert a fresher open session directly into the bill_sessions store
    const { getDB } = await import('../../composables/useIDB.js');
    const db = await getDB();
    await db.put('bill_sessions', {
      id: 'fresh_sess',
      table: 'T1',
      status: 'open',
      adults: 4,
      children: 0,
      opened_at: '2024-06-02T19:00:00.000Z',
    });

    const loaded = await loadStateFromIDB();

    // IDB record must win
    expect(loaded.tableCurrentBillSession.T1.billSessionId).toBe('fresh_sess');
    expect(loaded.tableCurrentBillSession.T1.adults).toBe(4);
  });

  it('ignores bill_sessions records that have no table field', async () => {
    const { getDB } = await import('../../composables/useIDB.js');
    const db = await getDB();
    // Record without a table field — should be silently skipped
    await db.put('bill_sessions', {
      id: 'orphan_sess',
      table: null,
      status: 'open',
      adults: 2,
      children: 0,
      opened_at: '2024-06-01T18:00:00.000Z',
    });

    const loaded = await loadStateFromIDB();
    // null/missing table keys must not appear in the result
    expect(Object.keys(loaded.tableCurrentBillSession)).not.toContain('null');
    expect(Object.keys(loaded.tableCurrentBillSession)).not.toContain(null);
    expect(Object.values(loaded.tableCurrentBillSession)).not.toContainEqual(
      expect.objectContaining({ billSessionId: 'orphan_sess' }),
    );
  });

  it('falls back to app_meta blob when bill_sessions store is empty', async () => {
    await saveStateToIDB({
      orders: [], transactions: [], cashBalance: 0, cashMovements: [],
      dailyClosures: [], printLog: [],
      tableCurrentBillSession: { T3: { billSessionId: 'legacy_sess', table: 'T3', status: 'open', adults: 2, children: 0, opened_at: null } },
      tableMergedInto: {}, tableOccupiedAt: {},
      billRequestedTables: new Set(),
    });

    const loaded = await loadStateFromIDB();
    expect(loaded.tableCurrentBillSession).toHaveProperty('T3');
    expect(loaded.tableCurrentBillSession.T3.billSessionId).toBe('legacy_sess');
  });

  it('normalizes legacy app_meta string values into session objects', async () => {
    await saveStateToIDB({
      orders: [], transactions: [], cashBalance: 0, cashMovements: [],
      dailyClosures: [], printLog: [],
      tableCurrentBillSession: { T9: 'legacy_session_id' },
      tableMergedInto: {}, tableOccupiedAt: {},
      billRequestedTables: new Set(),
    });

    const loaded = await loadStateFromIDB();
    expect(loaded.tableCurrentBillSession.T9).toEqual({
      billSessionId: 'legacy_session_id',
      table: 'T9',
      status: 'open',
      adults: 0,
      children: 0,
      opened_at: null,
    });
  });

  it('merges multiple open sessions for different tables', async () => {
    const { getDB } = await import('../../composables/useIDB.js');
    const db = await getDB();
    await db.put('bill_sessions', { id: 'sess_t1', table: 'T1', status: 'open', adults: 2, children: 0, opened_at: '2024-06-01T18:00:00.000Z' });
    await db.put('bill_sessions', { id: 'sess_t2', table: 'T2', status: 'open', adults: 4, children: 1, opened_at: '2024-06-01T19:00:00.000Z' });

    const loaded = await loadStateFromIDB();
    expect(loaded.tableCurrentBillSession).toHaveProperty('T1');
    expect(loaded.tableCurrentBillSession).toHaveProperty('T2');
    expect(loaded.tableCurrentBillSession.T1.billSessionId).toBe('sess_t1');
    expect(loaded.tableCurrentBillSession.T2.billSessionId).toBe('sess_t2');
  });
});

// ── upsertBillSessionInIDB / closeBillSessionInIDB ────────────────────────────

describe('upsertBillSessionInIDB()', () => {
  it('writes a new session to bill_sessions so loadStateFromIDB hydrates it', async () => {
    await upsertBillSessionInIDB({
      billSessionId: 'open_sess',
      table: 'T1',
      adults: 2,
      children: 0,
      status: 'open',
      opened_at: '2024-06-01T20:00:00.000Z',
    });

    const loaded = await loadStateFromIDB();
    expect(loaded.tableCurrentBillSession).toHaveProperty('T1');
    expect(loaded.tableCurrentBillSession.T1).toMatchObject({
      billSessionId: 'open_sess',
      table: 'T1',
      status: 'open',
      adults: 2,
    });
  });
});

describe('closeBillSessionInIDB()', () => {
  it('marks an existing open session as closed so it is not re-hydrated on reload', async () => {
    // Seed an open session directly in bill_sessions
    const { getDB } = await import('../../composables/useIDB.js');
    const db = await getDB();
    await db.put('bill_sessions', {
      id: 'close_sess',
      table: 'T2',
      status: 'open',
      adults: 3,
      children: 1,
      opened_at: '2024-06-01T18:00:00.000Z',
    });

    // Confirm it's visible before closing
    const before = await loadStateFromIDB();
    expect(before.tableCurrentBillSession).toHaveProperty('T2');

    await closeBillSessionInIDB('close_sess');

    // After closing, loadStateFromIDB must NOT resurrect the session
    const after = await loadStateFromIDB();
    expect(after.tableCurrentBillSession).not.toHaveProperty('T2');
  });

  it('is a no-op when the session does not exist in IDB', async () => {
    // Should not throw even when the record is absent
    await expect(closeBillSessionInIDB('nonexistent')).resolves.toBeUndefined();
    const loaded = await loadStateFromIDB();
    expect(loaded.tableCurrentBillSession).toEqual({});
  });
});

// ── clearAllStateFromIDB ──────────────────────────────────────────────────────

describe('clearAllStateFromIDB()', () => {
  it('removes all operative data', async () => {
    await saveStateToIDB({
      orders: [{ id: 'ord_1' }],
      transactions: [{ id: 'tx_1', amount: 5 }],
      cashBalance: 50,
      cashMovements: [{ id: 'cm_1' }],
      dailyClosures: [{ id: 'dc_1' }],
      printLog: [{ logId: 'pj_1', status: 'done' }],
      tableCurrentBillSession: { T1: 'b1' },
      tableMergedInto: { T2: 'T1' },
      tableOccupiedAt: {},
      billRequestedTables: new Set(),
    });

    await clearAllStateFromIDB();
    const loaded = await loadStateFromIDB();

    expect(loaded.orders).toEqual([]);
    expect(loaded.transactions).toEqual([]);
    expect(loaded.cashBalance).toBe(0);
    expect(loaded.cashMovements).toEqual([]);
    expect(loaded.dailyClosures).toEqual([]);
    expect(loaded.printLog).toEqual([]);
    expect(loaded.tableCurrentBillSession).toEqual({});
    expect(loaded.tableMergedInto).toEqual({});
  });

  it('removes manual_user records from venue_users', async () => {
    await saveUsersToIDB([
      { id: 'u1', name: 'Alice', pin: '1111' },
      { id: 'u2', name: 'Bob', pin: '2222' },
    ]);

    await clearAllStateFromIDB();
    const usersAfter = await loadUsersFromIDB();
    expect(usersAfter).toEqual([]);
  });

  it('clears venue_users completely', async () => {
    // Directly insert a simulated Directus venue-user
    const { getDB } = await import('../../composables/useIDB.js');
    const db = await getDB();
    await db.put('venue_users', { id: 'vu_directus_1', name: 'Staff', _type: 'venue_user' });

    // Also add a manual user.
    await saveUsersToIDB([{ id: 'u_manual', name: 'Manuel', pin: '0000' }]);

    await clearAllStateFromIDB();
    expect(await db.getAll('venue_users')).toEqual([]);
  });

  it('preserves local_settings', async () => {
    await saveSettingsToIDB({ menuUrl: 'https://example.com', sounds: true });
    await clearAllStateFromIDB();
    const settings = await loadSettingsFromIDB();
    expect(settings).toMatchObject({ menuUrl: 'https://example.com', sounds: true });
  });

  it('clears full DB (except local_settings), including refs and audit stores', async () => {
    const { getDB } = await import('../../composables/useIDB.js');
    const db = await getDB();

    await Promise.all([
      db.put('transaction_order_refs', { id: 'tor_1', transaction: 'tx_1', order: 'ord_1' }),
      db.put('transaction_voce_refs', { id: 'tvr_1', transaction: 'tx_1', voce_key: 'v1', qty: 1 }),
      db.put('daily_closure_by_method', { id: 'dcbm_1', daily_closure: 'dc_1', payment_method: 'cash', amount: 10 }),
      db.put('bill_sessions', { id: 'bs_1', table: 'T1', status: 'open' }),
      db.put('sync_queue', { id: 'sq_1', collection: 'orders', operation: 'create', record_id: 'o1', payload: {}, date_created: '2024-01-01T00:00:00.000Z', attempts: 0 }),
      db.put('sync_failed_calls', { id: 'sfc_1', failed_at: '2024-01-01T00:00:00.000Z' }),
      db.put('venues', { id: 1, name: 'Venue 1' }),
    ]);
    await saveSettingsToIDB({ menuUrl: 'https://example.com', sounds: true });

    await clearAllStateFromIDB();

    expect(await db.getAll('transaction_order_refs')).toEqual([]);
    expect(await db.getAll('transaction_voce_refs')).toEqual([]);
    expect(await db.getAll('daily_closure_by_method')).toEqual([]);
    expect(await db.getAll('bill_sessions')).toEqual([]);
    expect(await db.getAll('sync_queue')).toEqual([]);
    expect(await db.getAll('sync_failed_calls')).toEqual([]);
    expect(await db.getAll('venues')).toEqual([]);
    expect(await loadSettingsFromIDB()).toMatchObject({ menuUrl: 'https://example.com', sounds: true });
  });
});

describe('clearLocalConfigCacheFromIDB()', () => {
  it('clears all local Directus config caches and global pull cursors', async () => {
    const { getDB } = await import('../../composables/useIDB.js');
    const db = await getDB();

    await Promise.all([
      db.put('venues', { id: 1, name: 'Venue' }),
      db.put('rooms', { id: 'room_1', venue: 1 }),
      db.put('tables', { id: 'T1', venue: 1, room: 'room_1' }),
      db.put('payment_methods', { id: 'cash', label: 'Contanti' }),
      db.put('menu_categories', { id: 'cat_1', venue: 1, name: 'Primi' }),
      db.put('menu_items', { id: 'item_1', category: 'cat_1', name: 'Pasta' }),
      db.put('printers', { id: 'prn_1', name: 'Stampante' }),
      db.put('venue_users', { id: 'vu_1', _type: 'venue_user' }),
      db.put('table_merge_sessions', { id: 'tm_1', slave_table: 'T2', master_table: 'T1' }),
      db.put('app_meta', { id: 'last_pull_ts:venues', value: '2025-01-01T00:00:00.000Z' }),
      db.put('app_meta', { id: 'auth:userId', value: 'u1' }),
    ]);

    await clearLocalConfigCacheFromIDB();

    expect(await db.getAll('venues')).toEqual([]);
    expect(await db.getAll('rooms')).toEqual([]);
    expect(await db.getAll('tables')).toEqual([]);
    expect(await db.getAll('payment_methods')).toEqual([]);
    expect(db.objectStoreNames.contains('app_settings')).toBe(false);
    expect(await db.getAll('menu_categories')).toEqual([]);
    expect(await db.getAll('menu_items')).toEqual([]);
    expect(db.objectStoreNames.contains('menu_item_modifiers')).toBe(false);
    expect(await db.getAll('printers')).toEqual([]);
    expect(await db.getAll('venue_users')).toEqual([]);
    expect(await db.getAll('table_merge_sessions')).toEqual([]);
    expect(await db.get('app_meta', 'last_pull_ts:venues')).toBeUndefined();
    // Unrelated app_meta keys must be preserved.
    expect(await db.get('app_meta', 'auth:userId')).toEqual({ id: 'auth:userId', value: 'u1' });
  });
});

describe('loadConfigFromIDB()', () => {
  it('accepts relation objects for venue/room while filtering config records', async () => {
    const { getDB } = await import('../../composables/useIDB.js');
    const db = await getDB();

    await Promise.all([
      db.put('venues', { id: 1, name: 'Venue 1' }),
      db.put('rooms', { id: 'room_1', venue: { id: 1 }, label: 'Sala 1', status: 'published' }),
      db.put('tables', { id: 'T1', room: { id: 'room_1' }, label: 'T1', status: 'published' }),
    ]);

    const cfg = await loadConfigFromIDB(1);

    expect(cfg).not.toBeNull();
    expect(cfg.rooms).toHaveLength(1);
    expect(cfg.rooms[0].id).toBe('room_1');
    expect(cfg.tables).toHaveLength(1);
    expect(cfg.tables[0].id).toBe('T1');
  });
});

// ── Settings ──────────────────────────────────────────────────────────────────

describe('saveSettingsToIDB() + loadSettingsFromIDB()', () => {
  it('round-trips settings correctly', async () => {
    const settings = {
      menuUrl: 'https://menu.example.com',
      sounds: false,
      preventScreenLock: true,
      customKeyboard: 'right',
      preBillPrinterId: 'printer_1',
    };
    await saveSettingsToIDB(settings);
    const loaded = await loadSettingsFromIDB();
    expect(loaded).toMatchObject(settings);
  });

  it('returns null when no settings are stored', async () => {
    const loaded = await loadSettingsFromIDB();
    expect(loaded).toBeNull();
  });

  it('overwrites previous settings', async () => {
    await saveSettingsToIDB({ menuUrl: 'https://old.example.com' });
    await saveSettingsToIDB({ menuUrl: 'https://new.example.com' });
    const loaded = await loadSettingsFromIDB();
    expect(loaded.menuUrl).toBe('https://new.example.com');
  });
});

// ── Auth users ────────────────────────────────────────────────────────────────

describe('saveUsersToIDB() + loadUsersFromIDB()', () => {
  it('round-trips users correctly', async () => {
    const users = [
      { id: 'u1', name: 'Alice', pin: '1234', apps: ['cassa'] },
      { id: 'u2', name: 'Bob', pin: '5678', apps: ['sala'] },
    ];
    await saveUsersToIDB(users);
    const loaded = await loadUsersFromIDB();
    expect(loaded).toHaveLength(2);
    expect(loaded.find(u => u.id === 'u1').name).toBe('Alice');
    expect(loaded.find(u => u.id === 'u2').name).toBe('Bob');
  });

  it('returns an empty array when no users are stored', async () => {
    const loaded = await loadUsersFromIDB();
    expect(loaded).toEqual([]);
  });

  it('replaces existing manual users on re-save', async () => {
    await saveUsersToIDB([{ id: 'u1', name: 'Alice', pin: '1234' }]);
    await saveUsersToIDB([{ id: 'u2', name: 'Bob', pin: '5678' }]);
    const loaded = await loadUsersFromIDB();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('Bob');
  });

  it('does not affect non-manual_user records in venue_users', async () => {
    const { getDB } = await import('../../composables/useIDB.js');
    const db = await getDB();
    await db.put('venue_users', { id: 'vu_ext', name: 'External', _type: 'venue_user' });

    await saveUsersToIDB([{ id: 'u1', name: 'Alice', pin: '1234' }]);
    await saveUsersToIDB([]);

    const external = await db.get('venue_users', 'vu_ext');
    expect(external).toBeDefined();
    expect(external._type).toBe('venue_user');
  });

  it('strips Vue reactive proxies via JSON round-trip (no DataCloneError)', async () => {
    // Simulates what happens when a reactive user object is passed
    const user = { id: 'u1', name: 'Reactive', pin: '0000' };
    // The function should not throw even when data contains nested objects
    await expect(saveUsersToIDB([user])).resolves.not.toThrow();
  });
});

describe('upsertRecordsIntoIDB() venue_users PIN normalization', () => {
  it('hashes plaintext pin from Directus and keeps compatibility fields normalized', async () => {
    const { getDB } = await import('../../composables/useIDB.js');
    const db = await getDB();
    const written = await upsertRecordsIntoIDB('venue_users', [
      {
        id: 'vu_sync_1',
        venue: 1,
        display_name: 'Mario',
        apps: ['cassa'],
        pin: '1234',
        status: 'active',
        date_updated: '2026-01-01T00:00:00.000Z',
      },
    ]);

    expect(written).toBe(1);
    const stored = await db.get('venue_users', 'vu_sync_1');
    expect(stored).toBeDefined();
    expect(stored.pin).toBe(await sha256('1234'));
    expect(stored.pin).not.toBe('1234');
    expect(stored.name).toBe('Mario');
    expect(stored.display_name).toBe('Mario');
    expect(stored.apps).toEqual(['cassa']);
  });

  it('uses the first 4 numeric characters from trimmed pin before hashing', async () => {
    const { getDB } = await import('../../composables/useIDB.js');
    const db = await getDB();

    const written = await upsertRecordsIntoIDB('venue_users', [
      {
        id: 'vu_sync_2',
        venue: 1,
        display_name: 'Luigi',
        apps: ['sala'],
        pin: ' 12a3-4xyz99 ',
        status: 'active',
        date_updated: '2026-01-02T00:00:00.000Z',
      },
    ]);

    expect(written).toBe(1);
    const normalizedPin = await db.get('venue_users', 'vu_sync_2');

    expect(normalizedPin.pin).toBe(await sha256('1234'));
  });

  it('normalizes numeric venue_users pin values before hashing', async () => {
    const { getDB } = await import('../../composables/useIDB.js');
    const db = await getDB();
    const written = await upsertRecordsIntoIDB('venue_users', [
      {
        id: 'vu_sync_numeric_pin',
        venue: 1,
        display_name: 'Numeric',
        apps: ['cassa'],
        pin: 1234,
        status: 'active',
        date_updated: '2026-01-02T12:00:00.000Z',
      },
    ]);

    expect(written).toBe(1);
    const stored = await db.get('venue_users', 'vu_sync_numeric_pin');
    expect(stored.pin).toBe(await sha256('1234'));
    expect(stored.pin).not.toBe(1234);
  });

  it('normalizes whitespace-only venue_users pin to empty string', async () => {
    const { getDB } = await import('../../composables/useIDB.js');
    const db = await getDB();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const written = await upsertRecordsIntoIDB('venue_users', [
        {
          id: 'vu_sync_ws',
          venue: 1,
          display_name: 'Toad',
          apps: ['sala'],
          pin: '   ',
          status: 'active',
          date_updated: '2026-01-03T00:00:00.000Z',
        },
      ]);

      expect(written).toBe(1);
      const stored = await db.get('venue_users', 'vu_sync_ws');
      expect(stored.pin).toBe('');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid venue_users PIN during sync - could not extract 4 numeric digits. User ID:'),
        'vu_sync_ws',
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not hash or warn for stale venue_users records skipped by date_updated pre-scan', async () => {
    const { getDB } = await import('../../composables/useIDB.js');
    const db = await getDB();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await db.put('venue_users', {
        id: 'vu_sync_stale',
        venue: 1,
        display_name: 'Peach',
        apps: ['cassa'],
        pin: await sha256('9999'),
        status: 'active',
        date_updated: '2026-01-10T00:00:00.000Z',
      });

      const written = await upsertRecordsIntoIDB('venue_users', [
        {
          id: 'vu_sync_stale',
          venue: 1,
          display_name: 'Peach',
          apps: ['cassa'],
          pin: 'invalid-pin',
          status: 'active',
          date_updated: '2026-01-01T00:00:00.000Z',
        },
      ]);

      expect(written).toBe(0);
      const hasInvalidPinWarning = warnSpy.mock.calls.some(([message, userId]) =>
        typeof message === 'string'
          && message.includes('Invalid venue_users PIN during sync')
          && userId === 'vu_sync_stale',
      );
      expect(hasInvalidPinWarning).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('skips non-object records in pre-scan without failing valid venue_users upsert', async () => {
    const { getDB } = await import('../../composables/useIDB.js');
    const db = await getDB();
    const written = await upsertRecordsIntoIDB('venue_users', [
      null,
      'invalid',
      {
        id: 'vu_sync_valid_after_invalid',
        venue: 1,
        display_name: 'Daisy',
        apps: ['cassa'],
        pin: '5678',
        status: 'active',
        date_updated: '2026-01-11T00:00:00.000Z',
      },
    ]);

    expect(written).toBe(1);
    const stored = await db.get('venue_users', 'vu_sync_valid_after_invalid');
    expect(stored.pin).toBe(await sha256('5678'));
  });

  it('normalizes venue_users.apps to lowercase unique entries', async () => {
    const { getDB } = await import('../../composables/useIDB.js');
    const db = await getDB();
    await upsertRecordsIntoIDB('venue_users', [
      {
        id: 'vu_sync_apps',
        venue: 1,
        display_name: 'Apps',
        apps: ['ADMIN', 'cassa', 'cassa'],
        pin: '1111',
        status: 'active',
        date_updated: '2026-01-12T00:00:00.000Z',
      },
    ]);

    const normalized = await db.get('venue_users', 'vu_sync_apps');
    expect(normalized.apps).toEqual(['admin', 'cassa']);
    expect(normalized.role).toBeUndefined();
  });
});

// ── Auth session ──────────────────────────────────────────────────────────────

describe('saveAuthSessionToIDB() + loadAuthSessionFromIDB()', () => {
  it('persists and retrieves a userId', async () => {
    await saveAuthSessionToIDB('u1');
    const loaded = await loadAuthSessionFromIDB();
    expect(loaded).toBe('u1');
  });

  it('returns null when no session is stored', async () => {
    const loaded = await loadAuthSessionFromIDB();
    expect(loaded).toBeNull();
  });

  it('clears the session when passed null', async () => {
    await saveAuthSessionToIDB('u1');
    await saveAuthSessionToIDB(null);
    const loaded = await loadAuthSessionFromIDB();
    expect(loaded).toBeNull();
  });
});

// ── Auth settings ─────────────────────────────────────────────────────────────

describe('saveAuthSettingsToIDB() + loadAuthSettingsFromIDB()', () => {
  it('round-trips auth settings', async () => {
    await saveAuthSettingsToIDB({ lockTimeoutMinutes: 15 });
    const loaded = await loadAuthSettingsFromIDB();
    expect(loaded.lockTimeoutMinutes).toBe(15);
  });

  it('returns default {lockTimeoutMinutes: 5} when nothing is stored', async () => {
    const loaded = await loadAuthSettingsFromIDB();
    expect(loaded).toEqual({ lockTimeoutMinutes: 5 });
  });
});

// ── Custom items ──────────────────────────────────────────────────────────────

describe('saveCustomItemsToIDB() + loadCustomItemsFromIDB()', () => {
  it('round-trips custom items correctly', async () => {
    const items = [
      { id: 'ci_1', name: 'Item A', price: 5.5 },
      { id: 'ci_2', name: 'Item B', price: 12 },
    ];
    await saveCustomItemsToIDB(items);
    const loaded = await loadCustomItemsFromIDB();
    expect(loaded).toEqual(items);
  });

  it('returns an empty array when nothing is stored', async () => {
    const loaded = await loadCustomItemsFromIDB();
    expect(loaded).toEqual([]);
  });

  it('overwrites previous custom items', async () => {
    await saveCustomItemsToIDB([{ id: 'ci_1', name: 'Old', price: 1 }]);
    await saveCustomItemsToIDB([{ id: 'ci_2', name: 'New', price: 2 }]);
    const loaded = await loadCustomItemsFromIDB();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('New');
  });
});

// ── Fiscal receipts ───────────────────────────────────────────────────────────

describe('saveFiscalReceiptToIDB() + loadFiscalReceiptsFromIDB()', () => {
  it('returns an empty array when nothing is stored', async () => {
    const loaded = await loadFiscalReceiptsFromIDB();
    expect(loaded).toEqual([]);
  });

  it('round-trips a fiscal receipt record', async () => {
    const record = {
      id: 'fis_001',
      tableId: 'T1',
      billSessionId: 'bill_abc',
      tableLabel: 'Tavolo 1',
      totalAmount: 24.00,
      totalPaid: 24.00,
      paymentMethods: ['CONTANTI'],
      xmlRequest: '<printerFiscalReceipt />',
      xmlResponse: null,
      status: 'pending',
      timestamp: '2024-06-01T12:00:00.000Z',
    };
    await saveFiscalReceiptToIDB(record);
    const loaded = await loadFiscalReceiptsFromIDB();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({ id: 'fis_001', tableId: 'T1', totalAmount: 24 });
  });

  it('accumulates multiple records (put semantics)', async () => {
    await saveFiscalReceiptToIDB({ id: 'fis_001', timestamp: '2024-06-01T10:00:00.000Z', status: 'done' });
    await saveFiscalReceiptToIDB({ id: 'fis_002', timestamp: '2024-06-01T11:00:00.000Z', status: 'pending' });
    const loaded = await loadFiscalReceiptsFromIDB();
    expect(loaded).toHaveLength(2);
  });

  it('returns records sorted newest-first by timestamp', async () => {
    await saveFiscalReceiptToIDB({ id: 'fis_old', timestamp: '2024-01-01T08:00:00.000Z', status: 'done' });
    await saveFiscalReceiptToIDB({ id: 'fis_new', timestamp: '2024-12-31T23:00:00.000Z', status: 'done' });
    await saveFiscalReceiptToIDB({ id: 'fis_mid', timestamp: '2024-06-15T12:00:00.000Z', status: 'done' });
    const loaded = await loadFiscalReceiptsFromIDB();
    expect(loaded[0].id).toBe('fis_new');
    expect(loaded[1].id).toBe('fis_mid');
    expect(loaded[2].id).toBe('fis_old');
  });

  it('updates an existing record on re-save with the same id', async () => {
    await saveFiscalReceiptToIDB({ id: 'fis_001', timestamp: '2024-06-01T12:00:00.000Z', status: 'pending' });
    await saveFiscalReceiptToIDB({ id: 'fis_001', timestamp: '2024-06-01T12:00:00.000Z', status: 'done' });
    const loaded = await loadFiscalReceiptsFromIDB();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].status).toBe('done');
  });
});

describe('pruneFiscalReceiptsInIDB()', () => {
  it('deletes oldest entries beyond the keep limit', async () => {
    // Insert 5 records with known timestamps
    for (let i = 1; i <= 5; i++) {
      const ts = new Date(2024, 0, i).toISOString();
      await saveFiscalReceiptToIDB({ id: `fis_00${i}`, timestamp: ts, status: 'done' });
    }
    await pruneFiscalReceiptsInIDB(3);
    const loaded = await loadFiscalReceiptsFromIDB();
    expect(loaded).toHaveLength(3);
    // The 3 newest should survive (Jan 3, 4, 5)
    const ids = loaded.map(r => r.id);
    expect(ids).toContain('fis_003');
    expect(ids).toContain('fis_004');
    expect(ids).toContain('fis_005');
    expect(ids).not.toContain('fis_001');
    expect(ids).not.toContain('fis_002');
  });

  it('does nothing when record count is within the limit', async () => {
    await saveFiscalReceiptToIDB({ id: 'fis_001', timestamp: '2024-01-01T00:00:00.000Z', status: 'done' });
    await pruneFiscalReceiptsInIDB(200);
    const loaded = await loadFiscalReceiptsFromIDB();
    expect(loaded).toHaveLength(1);
  });
});

// ── Invoice requests ──────────────────────────────────────────────────────────

describe('saveInvoiceRequestToIDB() + loadInvoiceRequestsFromIDB()', () => {
  it('returns an empty array when nothing is stored', async () => {
    const loaded = await loadInvoiceRequestsFromIDB();
    expect(loaded).toEqual([]);
  });

  it('round-trips an invoice request record', async () => {
    const record = {
      id: 'inv_001',
      tableId: 'T2',
      billSessionId: 'bill_xyz',
      tableLabel: 'Tavolo 2',
      totalAmount: 50.00,
      totalPaid: 50.00,
      billingData: {
        denominazione: 'Acme SRL',
        codiceFiscale: '',
        piva: '12345678901',
        indirizzo: 'Via Roma 1',
        cap: '00100',
        comune: 'Roma',
        provincia: 'RM',
        paese: 'IT',
        codiceDestinatario: 'ABCDEFG',
        pec: '',
      },
      status: 'pending',
      timestamp: '2024-07-01T09:00:00.000Z',
    };
    await saveInvoiceRequestToIDB(record);
    const loaded = await loadInvoiceRequestsFromIDB();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({ id: 'inv_001', tableId: 'T2' });
    expect(loaded[0].billingData.denominazione).toBe('Acme SRL');
  });

  it('returns records sorted newest-first by timestamp', async () => {
    await saveInvoiceRequestToIDB({ id: 'inv_old', timestamp: '2024-03-01T08:00:00.000Z', status: 'done' });
    await saveInvoiceRequestToIDB({ id: 'inv_new', timestamp: '2024-11-15T20:00:00.000Z', status: 'done' });
    const loaded = await loadInvoiceRequestsFromIDB();
    expect(loaded[0].id).toBe('inv_new');
    expect(loaded[1].id).toBe('inv_old');
  });
});

describe('pruneInvoiceRequestsInIDB()', () => {
  it('deletes oldest entries beyond the keep limit', async () => {
    for (let i = 1; i <= 5; i++) {
      const ts = new Date(2024, 2, i).toISOString();
      await saveInvoiceRequestToIDB({ id: `inv_00${i}`, timestamp: ts, status: 'done' });
    }
    await pruneInvoiceRequestsInIDB(2);
    const loaded = await loadInvoiceRequestsFromIDB();
    expect(loaded).toHaveLength(2);
    const ids = loaded.map(r => r.id);
    expect(ids).toContain('inv_004');
    expect(ids).toContain('inv_005');
    expect(ids).not.toContain('inv_001');
  });

  it('does nothing when record count is within the limit', async () => {
    await saveInvoiceRequestToIDB({ id: 'inv_001', timestamp: '2024-01-01T00:00:00.000Z', status: 'pending' });
    await pruneInvoiceRequestsInIDB(200);
    const loaded = await loadInvoiceRequestsFromIDB();
    expect(loaded).toHaveLength(1);
  });
});

// ── v2 → v3 migration ────────────────────────────────────────────────────────

function _getTestDBName() {
  const instanceName = String(getInstanceName()).trim();
  return instanceName ? `app-cassa-${instanceName}` : 'app-cassa';
}

/**
 * Seeds a v2 IndexedDB with the legacy app_meta.tableMergedInto blob so the
 * upgrade handler can be exercised without needing to downgrade a real DB.
 */
async function _seedV2DB(legacyValue) {
  await new Promise((resolve, reject) => {
    const req = indexedDB.open(_getTestDBName(), 2);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('app_meta')) {
        db.createObjectStore('app_meta', { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('app_meta', 'readwrite');
      tx.objectStore('app_meta').put({ id: 'tableMergedInto', value: legacyValue });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
    req.onerror = () => reject(req.error);
  });
}

describe('v2 → v3 migration: app_meta.tableMergedInto → table_merge_sessions', () => {
  it('migrates the legacy blob to table_merge_sessions on upgrade', async () => {
    // Seed v2 DB with legacy merge graph (beforeEach already deleted the previous DB)
    await _seedV2DB({ T2: 'T1', T3: 'T1' });

    // Open v3 — triggers the upgrade handler
    const { getDB } = await import('../../composables/useIDB.js');
    const db = await getDB();

    const records = await db.getAll('table_merge_sessions');
    expect(records).toHaveLength(2);
    const bySlave = Object.fromEntries(records.map(r => [r.slave_table, r.master_table]));
    expect(bySlave).toEqual({ T2: 'T1', T3: 'T1' });

    // Legacy app_meta entry must be removed after migration
    const legacyRecord = await db.get('app_meta', 'tableMergedInto');
    expect(legacyRecord).toBeUndefined();
  });

  it('leaves table_merge_sessions empty when no legacy record exists', async () => {
    const { getDB } = await import('../../composables/useIDB.js');
    const db = await getDB();
    const records = await db.getAll('table_merge_sessions');
    expect(records).toHaveLength(0);
  });
});

// ── clearAllStateFromIDB covers fiscal / invoice ──────────────────────────────

describe('clearAllStateFromIDB() — fiscal receipts and invoice requests', () => {
  it('clears fiscal_receipts', async () => {
    await saveFiscalReceiptToIDB({ id: 'fis_001', timestamp: '2024-01-01T00:00:00.000Z', status: 'done' });
    await clearAllStateFromIDB();
    const loaded = await loadFiscalReceiptsFromIDB();
    expect(loaded).toEqual([]);
  });

  it('clears invoice_requests', async () => {
    await saveInvoiceRequestToIDB({ id: 'inv_001', timestamp: '2024-01-01T00:00:00.000Z', status: 'pending' });
    await clearAllStateFromIDB();
    const loaded = await loadInvoiceRequestsFromIDB();
    expect(loaded).toEqual([]);
  });
});

// ── replaceVenueUsersInIDB ────────────────────────────────────────────────────

describe('replaceVenueUsersInIDB()', () => {
  it('replaces all Directus users and removes users not in the new snapshot', async () => {
    const { getDB } = await import('../../composables/useIDB.js');
    const { replaceVenueUsersInIDB } = await import('../idbPersistence.js');
    const db = await getDB();

    // Pre-populate IDB with two Directus users
    await db.put('venue_users', { id: 'vu_old', name: 'Old', apps: [], pin: '', status: 'active' });
    await db.put('venue_users', { id: 'vu_keep', name: 'Keep', apps: [], pin: '', status: 'active' });

    // Replace with only one Directus user (vu_old should be removed)
    await replaceVenueUsersInIDB([
      { id: 'vu_keep', name: 'Keep', apps: ['cassa'], pin: '1234', status: 'active' },
    ]);

    const all = await db.getAll('venue_users');
    const ids = all.map((r) => r.id);
    expect(ids).not.toContain('vu_old');
    expect(ids).toContain('vu_keep');
    expect(all).toHaveLength(1);
  });

  it('hashes plaintext PIN for incoming Directus users', async () => {
    const { getDB } = await import('../../composables/useIDB.js');
    const { replaceVenueUsersInIDB } = await import('../idbPersistence.js');
    const db = await getDB();

    await replaceVenueUsersInIDB([
      { id: 'vu_pin', name: 'Pin User', apps: ['cassa'], pin: '5678', status: 'active' },
    ]);

    const stored = await db.get('venue_users', 'vu_pin');
    expect(stored).toBeDefined();
    expect(stored.pin).toBe(await sha256('5678'));
    expect(stored.pin).not.toBe('5678');
  });

  it('clears an invalid PIN and warns', async () => {
    const { replaceVenueUsersInIDB } = await import('../idbPersistence.js');
    const { getDB } = await import('../../composables/useIDB.js');
    const db = await getDB();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await replaceVenueUsersInIDB([
        { id: 'vu_bad_pin', name: 'Bad Pin', apps: [], pin: 'nodigits', status: 'active' },
      ]);
      const stored = await db.get('venue_users', 'vu_bad_pin');
      expect(stored.pin).toBe('');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid venue_users PIN during normalizeVenueUsersForIDB'),
        'vu_bad_pin',
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('preserves manual_user records that are not in the Directus snapshot', async () => {
    const { getDB } = await import('../../composables/useIDB.js');
    const { replaceVenueUsersInIDB } = await import('../idbPersistence.js');
    const db = await getDB();

    // Pre-populate a manual user and a Directus user
    await db.put('venue_users', {
      id: 'manual_1',
      name: 'Manuel',
      apps: ['cassa'],
      pin: '',
      status: 'active',
      _type: 'manual_user',
    });
    await db.put('venue_users', { id: 'vu_dir_1', name: 'Directus User', apps: [], pin: '', status: 'active' });

    // Full replace with a different Directus user (vu_dir_1 removed, but manual_1 must survive)
    await replaceVenueUsersInIDB([
      { id: 'vu_dir_2', name: 'New Directus User', apps: ['cassa'], pin: '1234', status: 'active' },
    ]);

    const all = await db.getAll('venue_users');
    const ids = all.map((r) => r.id);
    expect(ids).toContain('manual_1');
    expect(ids).toContain('vu_dir_2');
    expect(ids).not.toContain('vu_dir_1');
  });

  it('normalizes name/display_name aliases for Directus users', async () => {
    const { getDB } = await import('../../composables/useIDB.js');
    const { replaceVenueUsersInIDB } = await import('../idbPersistence.js');
    const db = await getDB();

    await replaceVenueUsersInIDB([
      { id: 'vu_alias', display_name: 'Alias User', apps: ['sala'], pin: '1111', status: 'active' },
    ]);

    const stored = await db.get('venue_users', 'vu_alias');
    expect(stored.name).toBe('Alias User');
    expect(stored.display_name).toBe('Alias User');
  });

  it('normalizes apps to lowercase unique entries', async () => {
    const { getDB } = await import('../../composables/useIDB.js');
    const { replaceVenueUsersInIDB } = await import('../idbPersistence.js');
    const db = await getDB();

    await replaceVenueUsersInIDB([
      { id: 'vu_apps', name: 'Apps User', apps: ['ADMIN', 'cassa', 'cassa'], pin: '2222', status: 'active' },
    ]);

    const stored = await db.get('venue_users', 'vu_apps');
    expect(stored.apps).toEqual(['admin', 'cassa']);
  });

  it('skips records without an id', async () => {
    const { getDB } = await import('../../composables/useIDB.js');
    const { replaceVenueUsersInIDB } = await import('../idbPersistence.js');
    const db = await getDB();

    await replaceVenueUsersInIDB([
      null,
      { name: 'No ID user', apps: [], pin: '' },
      { id: 'vu_valid_noid_test', name: 'Valid', apps: ['cassa'], pin: '3333', status: 'active' },
    ]);

    const all = await db.getAll('venue_users');
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('vu_valid_noid_test');
  });
});
