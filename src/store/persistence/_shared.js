/**
 * @file store/persistence/_shared.js
 * @description Internal shared helpers used across persistence sub-modules.
 * Not part of the public API — consumers should import from the individual
 * module files (operations.js, config.js, settings.js, auth.js, audit.js, reset.js).
 */

import { hashPin, PIN_LENGTH } from '../../utils/pinAuth.js';
import { relationId as _relationIdFromMappers } from '../../utils/mappers.js';

export { parseJsonArray } from '../../utils/mappers.js';

// ── FK helpers ────────────────────────────────────────────────────────────────

/**
 * Extracts the scalar FK value from a Directus relation object or scalar.
 * Also falls back to `.slug` for legacy venue-user records where the id field
 * may be stored as a slug string.
 *
 * @param {*} value
 * @returns {*}
 */
export function relationId(value) {
  if (value == null) return value;
  if (typeof value === 'object') return value.id ?? value.slug ?? null;
  return value;
}

/**
 * Extracts and normalises a FK to a guaranteed `String` value for type-safe
 * comparisons. Returns `null` when the value is absent.
 *
 * @param {*} value
 * @returns {string|null}
 */
export function relationIdStr(value) {
  const id = _relationIdFromMappers(value);
  return id != null ? String(id) : null;
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

export async function hashPinForLocalAuth(pin) {
  const raw = String(pin ?? '');
  if (!raw) return '';
  return hashPin(raw);
}

export function extractPinDigits(value) {
  const source = String(value ?? '');
  let digits = '';
  for (let i = 0; i < source.length && digits.length < PIN_LENGTH; i += 1) {
    const char = source[i];
    if (char >= '0' && char <= '9') digits += char;
  }
  return digits;
}

// ── IDB helpers ───────────────────────────────────────────────────────────────

/**
 * Replaces all records in an ObjectStore with the provided array.
 * Uses a readwrite transaction for atomicity.
 * JSON round-trip strips Vue reactive proxies before structuredClone.
 *
 * @param {import('idb').IDBPDatabase} db
 * @param {string} storeName
 * @param {Array} records
 */
export async function replaceAll(db, storeName, records) {
  const tx = db.transaction(storeName, 'readwrite');
  await tx.store.clear();
  await Promise.all(records.map(r => tx.store.put(JSON.parse(JSON.stringify(r)))));
  await tx.done;
}

/**
 * Normalises the `tableCurrentBillSession` map stored in app_meta.
 * Handles both the legacy scalar string format and the current object format.
 *
 * @param {*} rawSessions
 * @returns {Record<string, object>}
 */
export function normalizeTableCurrentBillSession(rawSessions) {
  if (!rawSessions || typeof rawSessions !== 'object' || Array.isArray(rawSessions)) return {};

  const normalized = {};
  for (const [table, rawSession] of Object.entries(rawSessions)) {
    if (!table) continue;

    if (typeof rawSession === 'string' && rawSession.trim() !== '') {
      normalized[table] = {
        billSessionId: rawSession,
        table,
        status: 'open',
        adults: 0,
        children: 0,
        opened_at: null,
      };
      continue;
    }

    if (!rawSession || typeof rawSession !== 'object') continue;
    const billSessionId = typeof rawSession.billSessionId === 'string' && rawSession.billSessionId.trim() !== ''
      ? rawSession.billSessionId
      : null;
    if (!billSessionId) continue;

    normalized[table] = {
      ...rawSession,
      billSessionId,
      table: typeof rawSession.table === 'string' && rawSession.table.trim() !== '' ? rawSession.table : table,
      status: typeof rawSession.status === 'string' ? rawSession.status : 'open',
      adults: Number.isFinite(rawSession.adults) ? rawSession.adults : 0,
      children: Number.isFinite(rawSession.children) ? rawSession.children : 0,
      opened_at: rawSession.opened_at ?? null,
    };
  }

  return normalized;
}

/**
 * Deletes the oldest entries in `storeName` beyond `keepCount`, using the
 * `timestamp` index cursor to avoid loading all records into memory.
 * Only stores with a `timestamp` index are supported (fiscal_receipts, invoice_requests).
 *
 * @param {import('idb').IDBPDatabase} db
 * @param {string} storeName
 * @param {number} keepCount
 */
export async function pruneToNewest(db, storeName, keepCount) {
  const total = await db.count(storeName);
  if (total <= keepCount) return;
  const deleteCount = total - keepCount;
  const tx = db.transaction(storeName, 'readwrite');
  const index = tx.store.index('timestamp');
  let cursor = await index.openCursor(null, 'next');
  let deleted = 0;
  while (cursor && deleted < deleteCount) {
    await cursor.delete();
    deleted++;
    cursor = await cursor.continue();
  }
  await tx.done;
}
