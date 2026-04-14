/**
 * @file idbPersistence.test.js
 * Unit tests for the IndexedDB persistence helpers in `store/idbPersistence.js`.
 *
 * Covers:
 *  - loadStateFromIDB / saveStateToIDB: round-trip, printLog payload stripping,
 *    billRequestedTables Set↔Array conversion, tableMergedInto ↔ table_merge_sessions
 *  - clearAllStateFromIDB: clears operative stores (incl. table_merge_sessions), preserves non-manual venue_users
 *  - v2 → v3 migration: app_meta.tableMergedInto → table_merge_sessions
 *  - loadStateFromIDB backward-compat fallback: reads app_meta.tableMergedInto when store is empty
 *  - saveSettingsToIDB / loadSettingsFromIDB: round-trip
 *  - saveUsersToIDB / loadUsersFromIDB: only manual_user records
 *  - saveAuthSessionToIDB / loadAuthSessionFromIDB: persists/clears userId
 *  - saveAuthSettingsToIDB / loadAuthSettingsFromIDB: round-trip
 *  - saveCustomItemsToIDB / loadCustomItemsFromIDB: round-trip
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { _resetIDBSingleton } from '../../composables/useIDB.js';
import { getInstanceName } from '../persistence.js';
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
  saveFiscalReceiptToIDB,
  loadFiscalReceiptsFromIDB,
  pruneFiscalReceiptsInIDB,
  saveInvoiceRequestToIDB,
  loadInvoiceRequestsFromIDB,
  pruneInvoiceRequestsInIDB,
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

// ── loadStateFromIDB backward-compat fallback ─────────────────────────────────

describe('loadStateFromIDB() — backward-compat fallback for tableMergedInto', () => {
  it('reads app_meta.tableMergedInto when table_merge_sessions is empty', async () => {
    // Simulate a failed migration: legacy blob still in app_meta, dedicated store empty
    const { getDB } = await import('../../composables/useIDB.js');
    const db = await getDB();
    await db.put('app_meta', { id: 'tableMergedInto', value: { T4: 'T3' } });

    const loaded = await loadStateFromIDB();
    expect(loaded.tableMergedInto).toEqual({ T4: 'T3' });
  });

  it('prefers table_merge_sessions over app_meta.tableMergedInto when both exist', async () => {
    // Seed dedicated store
    await saveStateToIDB({
      orders: [], transactions: [], cashBalance: 0, cashMovements: [],
      dailyClosures: [], printLog: [],
      tableCurrentBillSession: {},
      tableMergedInto: { T2: 'T1' },
      tableOccupiedAt: {},
      billRequestedTables: new Set(),
    });

    // Also plant a stale legacy record (should be ignored)
    const { getDB } = await import('../../composables/useIDB.js');
    const db = await getDB();
    await db.put('app_meta', { id: 'tableMergedInto', value: { STALE: 'DATA' } });

    const loaded = await loadStateFromIDB();
    expect(loaded.tableMergedInto).toEqual({ T2: 'T1' });
  });

  it('saving tableMergedInto removes the stale app_meta.tableMergedInto legacy key', async () => {
    // Plant stale legacy blob first
    const { getDB } = await import('../../composables/useIDB.js');
    const db = await getDB();
    await db.put('app_meta', { id: 'tableMergedInto', value: { T5: 'T4' } });

    // Save overwrites table_merge_sessions AND must delete the legacy key
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

  it('saving empty tableMergedInto also removes the stale legacy key (no ghost resurrection)', async () => {
    // Plant stale legacy blob
    const { getDB } = await import('../../composables/useIDB.js');
    const db = await getDB();
    await db.put('app_meta', { id: 'tableMergedInto', value: { GHOST: 'DATA' } });

    // Clear all merges — table_merge_sessions becomes empty, legacy key must also be deleted
    await saveStateToIDB({
      orders: [], transactions: [], cashBalance: 0, cashMovements: [],
      dailyClosures: [], printLog: [],
      tableCurrentBillSession: {},
      tableMergedInto: {},
      tableOccupiedAt: {},
      billRequestedTables: new Set(),
    });

    const loaded = await loadStateFromIDB();
    expect(loaded.tableMergedInto).toEqual({});

    const legacyRecord = await db.get('app_meta', 'tableMergedInto');
    expect(legacyRecord).toBeUndefined();
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
