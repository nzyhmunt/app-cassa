/**
 * @file store/persistence/audit.js
 * @description Persistence helpers for fiscal receipts and invoice requests.
 */

import { getDB } from '../../composables/useIDB.js';
import { pruneToNewest } from './_shared.js';

const FISCAL_INVOICE_RETENTION = 200;

/**
 * Persists a single fiscal receipt record to the `fiscal_receipts` ObjectStore.
 * @param {object} record - Must include `id` as keyPath.
 */
export async function saveFiscalReceiptToIDB(record) {
  try {
    const db = await getDB();
    await db.put('fiscal_receipts', JSON.parse(JSON.stringify(record)));
  } catch (e) {
    console.warn('[IDBPersistence] Failed to save fiscal receipt:', e);
  }
}

/**
 * Loads the newest retained fiscal receipt records from IDB, sorted newest-first
 * by timestamp.
 * @returns {Promise<Array>}
 */
export async function loadFiscalReceiptsFromIDB() {
  try {
    const db = await getDB();
    const tx = db.transaction('fiscal_receipts');
    const index = tx.store.index('timestamp');
    const receipts = [];
    let cursor = await index.openCursor(null, 'prev');

    while (cursor && receipts.length < FISCAL_INVOICE_RETENTION) {
      receipts.push(cursor.value);
      cursor = await cursor.continue();
    }

    await tx.done;
    return receipts;
  } catch (e) {
    console.warn('[IDBPersistence] Failed to load fiscal receipts:', e);
    return [];
  }
}

/**
 * Prunes the `fiscal_receipts` store to keep only the newest `keepCount` entries.
 * @param {number} [keepCount=200]
 */
export async function pruneFiscalReceiptsInIDB(keepCount = FISCAL_INVOICE_RETENTION) {
  try {
    const db = await getDB();
    await pruneToNewest(db, 'fiscal_receipts', keepCount);
  } catch (e) {
    console.warn('[IDBPersistence] Failed to prune fiscal receipts:', e);
  }
}

/**
 * Persists a single invoice request record to the `invoice_requests` ObjectStore.
 * @param {object} record - Must include `id` as keyPath.
 */
export async function saveInvoiceRequestToIDB(record) {
  try {
    const db = await getDB();
    await db.put('invoice_requests', JSON.parse(JSON.stringify(record)));
  } catch (e) {
    console.warn('[IDBPersistence] Failed to save invoice request:', e);
  }
}

/**
 * Loads the newest invoice request records from IDB, sorted newest-first by timestamp.
 * @returns {Promise<Array>}
 */
export async function loadInvoiceRequestsFromIDB() {
  try {
    const db = await getDB();
    const tx = db.transaction('invoice_requests', 'readonly');
    const index = tx.store.index('timestamp');
    const records = [];

    let cursor = await index.openCursor(null, 'prev');
    while (cursor && records.length < FISCAL_INVOICE_RETENTION) {
      records.push(cursor.value);
      cursor = await cursor.continue();
    }

    await tx.done;
    return records;
  } catch (e) {
    console.warn('[IDBPersistence] Failed to load invoice requests:', e);
    return [];
  }
}

/**
 * Prunes the `invoice_requests` store to keep only the newest `keepCount` entries.
 * @param {number} [keepCount=200]
 */
export async function pruneInvoiceRequestsInIDB(keepCount = FISCAL_INVOICE_RETENTION) {
  try {
    const db = await getDB();
    await pruneToNewest(db, 'invoice_requests', keepCount);
  } catch (e) {
    console.warn('[IDBPersistence] Failed to prune invoice requests:', e);
  }
}

