/**
 * @file idbPersistence.test.js
 * Unit tests for the IndexedDB persistence helpers in `store/idbPersistence.js`.
 *
 * Covers:
 *  - loadStateFromIDB / saveStateToIDB: round-trip, printLog payload stripping,
 *    billRequestedTables Set↔Array conversion
 *  - clearAllStateFromIDB: clears operative stores, preserves non-manual venue_users
 *  - saveSettingsToIDB / loadSettingsFromIDB: round-trip
 *  - saveUsersToIDB / loadUsersFromIDB: only manual_user records
 *  - saveAuthSessionToIDB / loadAuthSessionFromIDB: persists/clears userId
 *  - saveAuthSettingsToIDB / loadAuthSettingsFromIDB: round-trip
 *  - saveCustomItemsToIDB / loadCustomItemsFromIDB: round-trip
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { _resetIDBSingleton } from '../../composables/useIDB.js';
import {
  loadStateFromIDB,
  saveStateToIDB,
  clearAllStateFromIDB,
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
} from '../idbPersistence.js';

beforeEach(async () => {
  await _resetIDBSingleton();
});

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
    const testState = {
      orders: [{ id: 'ord_1', table: 'T1', status: 'open' }],
      transactions: [{ transactionId: 'tx_1', amount: 10 }],
      cashBalance: 42.5,
      cashMovements: [],
      dailyClosures: [],
      printLog: [],
      tableCurrentBillSession: { T1: 'bill_1' },
      tableMergedInto: {},
      tableOccupiedAt: { T1: '2024-01-01T12:00:00.000Z' },
      billRequestedTables: new Set(),
    };

    await saveStateToIDB(testState);
    const loaded = await loadStateFromIDB();

    expect(loaded.orders).toEqual([{ id: 'ord_1', table: 'T1', status: 'open' }]);
    expect(loaded.transactions).toEqual([{ transactionId: 'tx_1', amount: 10 }]);
    expect(loaded.cashBalance).toBe(42.5);
    expect(loaded.tableCurrentBillSession).toEqual({ T1: 'bill_1' });
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
    // Seed full state
    await saveStateToIDB({
      orders: [{ id: 'ord_1' }],
      transactions: [{ transactionId: 'tx_1', amount: 5 }],
      cashBalance: 10,
      cashMovements: [{ id: 'cm_1' }],
      dailyClosures: [],
      printLog: [],
      tableCurrentBillSession: { T1: 'bill_1' },
      tableMergedInto: {},
      tableOccupiedAt: { T1: '2024-01-01T12:00:00.000Z' },
      billRequestedTables: new Set(['T1']),
    });

    // Partial save: only update orders — must NOT wipe transactions/cashBalance/etc.
    await saveStateToIDB({ orders: [{ id: 'ord_2' }] });
    const loaded = await loadStateFromIDB();

    expect(loaded.orders).toEqual([{ id: 'ord_2' }]);
    // All other stores must be unchanged
    expect(loaded.transactions).toEqual([{ transactionId: 'tx_1', amount: 5 }]);
    expect(loaded.cashBalance).toBe(10);
    expect(loaded.cashMovements).toEqual([{ id: 'cm_1' }]);
    expect(loaded.tableCurrentBillSession).toEqual({ T1: 'bill_1' });
    expect(loaded.tableOccupiedAt).toEqual({ T1: '2024-01-01T12:00:00.000Z' });
    expect(loaded.billRequestedTables.has('T1')).toBe(true);
  });

  it('partial save: updating tableOccupiedAt does not clobber tableCurrentBillSession', async () => {
    // Seed full table-state
    await saveStateToIDB({
      orders: [], transactions: [], cashBalance: 0, cashMovements: [],
      dailyClosures: [], printLog: [],
      tableCurrentBillSession: { T1: 'bill_abc' },
      tableMergedInto: { T2: 'T1' },
      tableOccupiedAt: {},
      billRequestedTables: new Set(),
    });

    // Simulate watcher firing only for tableOccupiedAt
    await saveStateToIDB({ tableOccupiedAt: { T1: '2024-06-01T09:00:00.000Z' } });
    const loaded = await loadStateFromIDB();

    expect(loaded.tableOccupiedAt).toEqual({ T1: '2024-06-01T09:00:00.000Z' });
    // The other table-state fields must survive untouched
    expect(loaded.tableCurrentBillSession).toEqual({ T1: 'bill_abc' });
    expect(loaded.tableMergedInto).toEqual({ T2: 'T1' });
  });
});

// ── clearAllStateFromIDB ──────────────────────────────────────────────────────

describe('clearAllStateFromIDB()', () => {
  it('removes all operative data', async () => {
    await saveStateToIDB({
      orders: [{ id: 'ord_1' }],
      transactions: [{ transactionId: 'tx_1', amount: 5 }],
      cashBalance: 50,
      cashMovements: [{ id: 'cm_1' }],
      dailyClosures: [{ id: 'dc_1' }],
      printLog: [{ logId: 'pj_1', status: 'done' }],
      tableCurrentBillSession: { T1: 'b1' },
      tableMergedInto: {},
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

  it('preserves non-manual_user records in venue_users', async () => {
    // Directly insert a simulated Directus venue-user (no _type: 'manual_user')
    const { getDB } = await import('../../composables/useIDB.js');
    const db = await getDB();
    await db.put('venue_users', { id: 'vu_directus_1', name: 'Staff', _type: 'venue_user' });

    // Also add a manual user
    await saveUsersToIDB([{ id: 'u_manual', name: 'Manuel', pin: '0000' }]);

    await clearAllStateFromIDB();

    const manualAfter = await loadUsersFromIDB();
    expect(manualAfter).toEqual([]);

    // The non-manual record must survive
    const directusRecord = await db.get('venue_users', 'vu_directus_1');
    expect(directusRecord).toBeDefined();
    expect(directusRecord._type).toBe('venue_user');
  });

  it('clears app_settings', async () => {
    await saveSettingsToIDB({ menuUrl: 'https://example.com', sounds: true });
    await clearAllStateFromIDB();
    const settings = await loadSettingsFromIDB();
    expect(settings).toBeNull();
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
