/**
 * @file store/storeUtils.js
 * @description Small shared utilities used across store modules.
 *
 * ID generation strategy:
 *  - newUUIDv7()   → bare 36-char UUID v7; use for ALL primary keys sent to Directus
 *                    (bill_sessions.id, orders.id, transactions.id, cash_movements.id, …).
 *  - newShortId()  → short prefixed string ≤ 20 chars; use for LOCAL-ONLY identifiers
 *                    that are NOT Directus PKs (order_items.uid, print log entries, etc.).
 *  - newUUID()     → @deprecated kept only for legacy call-sites that have not been
 *                    migrated yet.  Do NOT use in new code.
 */

/**
 * @deprecated Use newUUIDv7() for Directus PKs or newShortId() for local UIDs.
 * Generates a unique identifier using crypto.randomUUID when available,
 * falling back to a random base-36 string for environments without it (e.g. jsdom).
 * The prefix is always prepended so callers get consistent ID formats (e.g. "ord_<uuid>").
 * @param {string} [prefix='id'] – Short prefix for the ID.
 * @returns {string}
 */
export function newUUID(prefix = 'id') {
  const base = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  return `${prefix}_${base}`;
}

/**
 * Generates a short, prefixed identifier suitable for local-only fields that are
 * NOT primary keys in Directus (e.g. order_items.uid, logId, jobId).
 *
 * Result is at most 20 characters:
 *   prefix (≤ 4 chars) + '_' + timestamp in base-36 (~9 chars) + '_' + 4 random chars ≤ 19
 *
 * Example: "cop_lrzmr4kh_a3f2"
 *
 * @param {string} [prefix='id'] – Short prefix (keep ≤ 4 chars to stay within 20-char column limits)
 * @returns {string}
 */
export function newShortId(prefix = 'id') {
  const ts = Date.now().toString(36);
  let rnd;
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const arr = new Uint16Array(1);
    crypto.getRandomValues(arr);
    rnd = arr[0].toString(36).padStart(4, '0');
  } else {
    // Fallback for environments without crypto (e.g. legacy jsdom in tests)
    rnd = Math.floor(Math.random() * 0x10000).toString(36).padStart(4, '0');
  }
  return `${prefix}_${ts}_${rnd}`;
}

/**
 * Generates a UUID v7 (time-ordered) prefixed ID.
 * UUID v7 encodes a millisecond-precision Unix timestamp in the first 48 bits,
 * followed by version/variant bits and cryptographically random bytes.
 * This ensures chronological sortability while remaining globally unique.
 *
 * When multiple UUIDs are generated within the same millisecond the 12-bit
 * `rand_a` field (bits 12–23 of byte group 3, i.e. bytes 6–7 after the version
 * nibble) is used as a monotonic counter.  This guarantees that IDs created in
 * rapid succession within a single execution context sort in creation order even
 * when their `date_created` timestamps are identical.
 *
 * Falls back to a timestamp + Math.random composite in environments where
 * crypto.getRandomValues is not available (e.g., legacy jsdom).
 *
 * @param {string} [prefix=''] – Optional prefix. When omitted (default) a bare 36-char UUID is returned.
 *                              Pass a string to get "prefix_UUID" format (e.g. for logging or local debug labels).
 * @returns {string}  e.g. "0192fa3c-b41a-7e8d-a312-0c2e9f4a87b5" or "fis_0192fa3c-b41a-7e8d-a312-0c2e9f4a87b5"
 */

/** @type {number} Last millisecond timestamp seen by newUUIDv7. */
let _v7LastMs = -1;
/**
 * Monotonic 12-bit counter incremented within the same ms.
 * Module-level state is intentional: JavaScript is single-threaded and Web Workers
 * each get their own module instance, so no cross-context race conditions exist.
 */
let _v7Seq = 0;

export function newUUIDv7(prefix = '') {
  const now = Date.now();
  const buf = new Uint8Array(16);

  // Maintain per-ms monotonic counter to guarantee lexicographic ordering when
  // two UUIDs are generated within the same millisecond (rand_a, 12 bits).
  if (now === _v7LastMs) {
    _v7Seq = (_v7Seq + 1) & 0xfff; // wrap at 4096 to stay within 12 bits
  } else {
    _v7LastMs = now;
    _v7Seq = 0;
  }

  // Timestamp: 48 bits (bytes 0-5) — milliseconds since Unix epoch, big-endian
  buf[0] = Math.floor(now / 0x10000000000) & 0xff;
  buf[1] = Math.floor(now / 0x100000000) & 0xff;
  buf[2] = Math.floor(now / 0x1000000) & 0xff;
  buf[3] = Math.floor(now / 0x10000) & 0xff;
  buf[4] = Math.floor(now / 0x100) & 0xff;
  buf[5] = now & 0xff;

  // Random bytes for positions 8-15 (rand_b, 62 bits after variant)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(buf.subarray(8));
  } else {
    for (let i = 8; i < 16; i++) buf[i] = Math.floor(Math.random() * 256) & 0xff;
  }

  // Byte 6: version nibble (0x7) in high 4 bits + top 4 bits of 12-bit seq counter
  buf[6] = 0x70 | ((_v7Seq >> 8) & 0x0f);
  // Byte 7: low 8 bits of seq counter
  buf[7] = _v7Seq & 0xff;
  // Set RFC 4122 variant 10xx (bits 64-65 → high 2 bits of byte 8)
  buf[8] = (buf[8] & 0x3f) | 0x80;

  const hex = Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return prefix ? `${prefix}_${uuid}` : uuid;
}
