/**
 * @file composables/__tests__/useIDBPurge.test.js
 * @description Unit tests for useIDBPurge.js.
 *
 * Covers:
 *  - purgeCollection on an empty store → no error, no deletions
 *  - Records newer than retention window are kept
 *  - Records older than retention window, sync_queue empty → purged
 *  - Records older than retention window, sync_queue has pending entries → NOT purged
 *  - statusFilter: records with non-matching status are kept
 *  - print_jobs: correct use of pkField='logId' and dateField='timestamp'
 *  - requireMissingParent: orphan records (parent gone) are purged
 *  - requireMissingParent: records with present parent are kept
 *  - retentionDays=null: orphan-only purge skips date filter
 *  - purgeSyncQueueDeadLetter: abandoned entries (attempts>=MAX_ATTEMPTS) and old → removed
 *  - purgeSyncQueueDeadLetter: recent entries kept even when attempts>=MAX_ATTEMPTS
 *  - purgeSyncQueueDeadLetter: live entries (attempts<MAX_ATTEMPTS) kept
 *  - purgeSyncFailedCalls: entries older than retention window are removed
 *  - purgeSyncFailedCalls: recent entries are kept
 *  - runIDBPurge: full integration — respects child-before-parent ordering
 *  - skipSyncGuard: purge proceeds even when sync_queue has pending entries
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getDB, _resetIDBSingleton } from '../useIDB.js';
import {
  purgeCollection,
  purgeSyncQueueDeadLetter,
  purgeSyncFailedCalls,
  runIDBPurge,
  _isDirectusSyncActive,
} from '../useIDBPurge.js';
import { MAX_ATTEMPTS } from '../useSyncQueue.js';
import { appConfig } from '../../utils/index.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

/**
 * Returns an ISO timestamp that is `daysAgo` days in the past.
 * @param {number} daysAgo
 * @returns {string}
 */
function daysBack(daysAgo) {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString();
}

/**
 * Inserts a single record into an IDB ObjectStore via getDB().
 * @param {string} storeName
 * @param {object} record
 */
async function put(storeName, record) {
  const db = await getDB();
  await db.put(storeName, record);
}

/**
 * Returns all records in an ObjectStore.
 * @param {string} storeName
 * @returns {Promise<object[]>}
 */
async function getAll(storeName) {
  const db = await getDB();
  return db.getAll(storeName);
}

/**
 * Enqueues a raw sync_queue entry (bypasses useSyncQueue to keep tests self-contained).
 * @param {string} id
 * @param {string} collection
 */
async function enqueueDirect(id, collection) {
  await put('sync_queue', {
    id,
    collection,
    operation: 'create',
    record_id: id,
    payload: {},
    date_created: new Date().toISOString(),
    attempts: 0,
  });
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  await _resetIDBSingleton();
});

// ── _isDirectusSyncActive ─────────────────────────────────────────────────────

describe('_isDirectusSyncActive()', () => {
  it('returns false when directus config is absent', () => {
    const original = appConfig.directus;
    appConfig.directus = null;
    expect(_isDirectusSyncActive()).toBe(false);
    appConfig.directus = original;
  });

  it('returns false when enabled=false', () => {
    const original = appConfig.directus;
    appConfig.directus = { enabled: false, url: 'https://x.example.com', staticToken: 'tok' };
    expect(_isDirectusSyncActive()).toBe(false);
    appConfig.directus = original;
  });

  it('returns true when all required fields are present and enabled', () => {
    const original = appConfig.directus;
    appConfig.directus = { enabled: true, url: 'https://x.example.com', staticToken: 'tok' };
    expect(_isDirectusSyncActive()).toBe(true);
    appConfig.directus = original;
  });
});

// ── purgeCollection ───────────────────────────────────────────────────────────

describe('purgeCollection() — empty store', () => {
  it('does not throw on an empty store', async () => {
    await expect(purgeCollection('orders', 7, { statusFilter: ['completed'] })).resolves.toBeUndefined();
    expect(await getAll('orders')).toEqual([]);
  });
});

describe('purgeCollection() — date filter', () => {
  it('keeps records newer than the retention window', async () => {
    await put('orders', { id: 'ord_new', table: 'T1', status: 'completed', date_updated: daysBack(3) });
    await purgeCollection('orders', 7, { statusFilter: ['completed'] });
    expect(await getAll('orders')).toHaveLength(1);
  });

  it('purges records older than the retention window when sync_queue is empty', async () => {
    await put('orders', { id: 'ord_old', table: 'T1', status: 'completed', date_updated: daysBack(10) });
    await purgeCollection('orders', 7, { statusFilter: ['completed'] });
    expect(await getAll('orders')).toHaveLength(0);
  });

  it('skips records missing the date field', async () => {
    await put('orders', { id: 'ord_nodate', table: 'T1', status: 'completed' });
    await purgeCollection('orders', 7, { statusFilter: ['completed'] });
    expect(await getAll('orders')).toHaveLength(1);
  });
});

describe('purgeCollection() — sync_queue guard', () => {
  it('does NOT purge when sync_queue has pending entries for that collection', async () => {
    await put('orders', { id: 'ord_old', table: 'T1', status: 'completed', date_updated: daysBack(10) });
    await enqueueDirect('q1', 'orders');
    await purgeCollection('orders', 7, { statusFilter: ['completed'] });
    // Record must still be present because sync is pending.
    expect(await getAll('orders')).toHaveLength(1);
  });

  it('purges normally after the pending entry is removed', async () => {
    await put('orders', { id: 'ord_old', table: 'T1', status: 'completed', date_updated: daysBack(10) });
    // No pending sync_queue entry → should purge.
    await purgeCollection('orders', 7, { statusFilter: ['completed'] });
    expect(await getAll('orders')).toHaveLength(0);
  });

  it('skipSyncGuard: purges even when sync_queue has entries', async () => {
    await put('print_jobs', { logId: 'pj1', status: 'done', timestamp: daysBack(10) });
    await enqueueDirect('q2', 'print_jobs');
    await purgeCollection('print_jobs', 7, {
      statusFilter: ['done', 'error'],
      dateField: 'timestamp',
      pkField: 'logId',
      skipSyncGuard: true,
    });
    expect(await getAll('print_jobs')).toHaveLength(0);
  });
});

describe('purgeCollection() — statusFilter', () => {
  it('keeps records whose status is not in statusFilter', async () => {
    await put('orders', { id: 'ord_active', table: 'T1', status: 'active', date_updated: daysBack(10) });
    await purgeCollection('orders', 7, { statusFilter: ['completed', 'rejected'] });
    expect(await getAll('orders')).toHaveLength(1);
  });

  it('purges records whose status is in statusFilter', async () => {
    await put('orders', { id: 'ord_done', table: 'T1', status: 'rejected', date_updated: daysBack(10) });
    await purgeCollection('orders', 7, { statusFilter: ['completed', 'rejected'] });
    expect(await getAll('orders')).toHaveLength(0);
  });

  it('purges all old records when statusFilter is null', async () => {
    await put('transactions', { id: 'tx1', date_updated: daysBack(40) });
    await purgeCollection('transactions', 30);
    expect(await getAll('transactions')).toHaveLength(0);
  });
});

describe('purgeCollection() — print_jobs (pkField=logId, dateField=timestamp)', () => {
  it('purges old done print_jobs using logId as pk and timestamp as date', async () => {
    await put('print_jobs', { logId: 'pj_old', status: 'done', timestamp: daysBack(10) });
    await purgeCollection('print_jobs', 7, {
      statusFilter: ['done', 'error'],
      dateField: 'timestamp',
      pkField: 'logId',
      skipSyncGuard: true,
    });
    expect(await getAll('print_jobs')).toHaveLength(0);
  });

  it('keeps recent print_jobs', async () => {
    await put('print_jobs', { logId: 'pj_new', status: 'done', timestamp: daysBack(2) });
    await purgeCollection('print_jobs', 7, {
      statusFilter: ['done', 'error'],
      dateField: 'timestamp',
      pkField: 'logId',
      skipSyncGuard: true,
    });
    expect(await getAll('print_jobs')).toHaveLength(1);
  });

  it('keeps print_jobs with non-terminal status', async () => {
    await put('print_jobs', { logId: 'pj_pending', status: 'pending', timestamp: daysBack(10) });
    await purgeCollection('print_jobs', 7, {
      statusFilter: ['done', 'error'],
      dateField: 'timestamp',
      pkField: 'logId',
      skipSyncGuard: true,
    });
    expect(await getAll('print_jobs')).toHaveLength(1);
  });
});

describe('purgeCollection() — requireMissingParent (orphan purge)', () => {
  it('purges orphaned order_items when their order parent is gone', async () => {
    // No parent order exists.
    await put('order_items', {
      id: 'oi_orphan',
      order: 'ord_gone',
      status: 'sent',
      date_updated: daysBack(10),
    });
    await purgeCollection('order_items', 7, {
      requireMissingParent: { storeName: 'orders', foreignKey: 'order' },
    });
    expect(await getAll('order_items')).toHaveLength(0);
  });

  it('keeps order_items when the parent order is still present', async () => {
    await put('orders', { id: 'ord_active', table: 'T1', status: 'active', date_updated: daysBack(1) });
    await put('order_items', {
      id: 'oi_live',
      order: 'ord_active',
      status: 'sent',
      date_updated: daysBack(10),
    });
    await purgeCollection('order_items', 7, {
      requireMissingParent: { storeName: 'orders', foreignKey: 'order' },
    });
    expect(await getAll('order_items')).toHaveLength(1);
  });

  it('retentionDays=null — purges orphans regardless of date', async () => {
    // Add a transaction reference with missing parent (simulates junction table purge).
    await put('transaction_order_refs', { id: 'tor1', transaction: 'tx_gone', order: 'ord1' });
    await purgeCollection('transaction_order_refs', null, {
      requireMissingParent: { storeName: 'transactions', foreignKey: 'transaction' },
    });
    expect(await getAll('transaction_order_refs')).toHaveLength(0);
  });

  it('retentionDays=null — keeps junction record when parent exists', async () => {
    await put('transactions', { id: 'tx_live', date_updated: daysBack(1) });
    await put('transaction_order_refs', { id: 'tor2', transaction: 'tx_live', order: 'ord1' });
    await purgeCollection('transaction_order_refs', null, {
      requireMissingParent: { storeName: 'transactions', foreignKey: 'transaction' },
    });
    expect(await getAll('transaction_order_refs')).toHaveLength(1);
  });
});

// ── purgeSyncQueueDeadLetter ──────────────────────────────────────────────────

describe('purgeSyncQueueDeadLetter()', () => {
  it('removes dead-letter entries (attempts>=MAX_ATTEMPTS) older than retention', async () => {
    await put('sync_queue', {
      id: 'sq_dead',
      collection: 'orders',
      operation: 'create',
      record_id: 'ord1',
      payload: {},
      date_created: daysBack(10),
      attempts: MAX_ATTEMPTS,
    });
    await purgeSyncQueueDeadLetter(7);
    expect(await getAll('sync_queue')).toHaveLength(0);
  });

  it('keeps dead-letter entries that are recent', async () => {
    await put('sync_queue', {
      id: 'sq_dead_recent',
      collection: 'orders',
      operation: 'create',
      record_id: 'ord2',
      payload: {},
      date_created: daysBack(3),
      attempts: MAX_ATTEMPTS,
    });
    await purgeSyncQueueDeadLetter(7);
    expect(await getAll('sync_queue')).toHaveLength(1);
  });

  it('keeps live entries (attempts < MAX_ATTEMPTS) even if old', async () => {
    await put('sync_queue', {
      id: 'sq_live',
      collection: 'orders',
      operation: 'create',
      record_id: 'ord3',
      payload: {},
      date_created: daysBack(30),
      attempts: MAX_ATTEMPTS - 1,
    });
    await purgeSyncQueueDeadLetter(7);
    expect(await getAll('sync_queue')).toHaveLength(1);
  });
});

// ── purgeSyncFailedCalls ──────────────────────────────────────────────────────

describe('purgeSyncFailedCalls()', () => {
  it('removes entries older than the retention window', async () => {
    await put('sync_failed_calls', {
      id: 'sfc_old',
      collection: 'orders',
      failed_at: daysBack(40),
    });
    await purgeSyncFailedCalls(30);
    expect(await getAll('sync_failed_calls')).toHaveLength(0);
  });

  it('keeps recent entries', async () => {
    await put('sync_failed_calls', {
      id: 'sfc_new',
      collection: 'orders',
      failed_at: daysBack(5),
    });
    await purgeSyncFailedCalls(30);
    expect(await getAll('sync_failed_calls')).toHaveLength(1);
  });

  it('does not throw on an empty store', async () => {
    await expect(purgeSyncFailedCalls(30)).resolves.toBeUndefined();
  });
});

// ── runIDBPurge — integration ─────────────────────────────────────────────────

describe('runIDBPurge() — full cycle', () => {
  it('runs to completion on an empty database', async () => {
    await expect(runIDBPurge()).resolves.toBeUndefined();
  });

  it('purges stale completed orders and their orphaned children', async () => {
    // Parent order: completed, 10 days old.
    await put('orders', { id: 'ord_c', table: 'T1', status: 'completed', date_updated: daysBack(10) });
    // Child items (will become orphans once order is purged).
    await put('order_items', { id: 'oi_c', order: 'ord_c', status: 'sent', date_updated: daysBack(10) });
    await put('order_item_modifiers', { id: 'oim_c', order_item: 'oi_c', date_updated: daysBack(10) });

    await runIDBPurge();

    expect(await getAll('orders')).toHaveLength(0);
    expect(await getAll('order_items')).toHaveLength(0);
    expect(await getAll('order_item_modifiers')).toHaveLength(0);
  });

  it('keeps active orders and their children', async () => {
    await put('orders', { id: 'ord_a', table: 'T1', status: 'active', date_updated: daysBack(10) });
    await put('order_items', { id: 'oi_a', order: 'ord_a', status: 'sent', date_updated: daysBack(10) });

    await runIDBPurge();

    expect(await getAll('orders')).toHaveLength(1);
    expect(await getAll('order_items')).toHaveLength(1);
  });

  it('purges stale closed bill_sessions', async () => {
    await put('bill_sessions', { id: 'bs1', table: 'T1', status: 'closed', date_updated: daysBack(10) });

    await runIDBPurge();

    expect(await getAll('bill_sessions')).toHaveLength(0);
  });

  it('keeps open bill_sessions regardless of age', async () => {
    await put('bill_sessions', { id: 'bs_open', table: 'T1', status: 'open', date_updated: daysBack(10) });

    await runIDBPurge();

    expect(await getAll('bill_sessions')).toHaveLength(1);
  });

  it('purges old transactions but not recent ones', async () => {
    await put('transactions', { id: 'tx_old', date_updated: daysBack(40) });
    await put('transactions', { id: 'tx_new', date_updated: daysBack(10) });

    await runIDBPurge();

    const remaining = await getAll('transactions');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('tx_new');
  });

  it('does not purge when orders sync_queue has pending entries', async () => {
    await put('orders', { id: 'ord_p', table: 'T1', status: 'completed', date_updated: daysBack(10) });
    await enqueueDirect('sq_ord', 'orders');

    await runIDBPurge();

    expect(await getAll('orders')).toHaveLength(1);
  });
});
