/**
 * @file store/storeUtils.js
 * @description Small shared utilities used across store modules.
 */

/**
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
 * Generates a UUID v7 (time-ordered) prefixed ID.
 * UUID v7 encodes a millisecond-precision Unix timestamp in the first 48 bits,
 * followed by version/variant bits and cryptographically random bytes.
 * This ensures chronological sortability while remaining globally unique.
 *
 * Falls back to a timestamp + Math.random composite in environments where
 * crypto.getRandomValues is not available (e.g., legacy jsdom).
 *
 * @param {string} [prefix='id'] – Short prefix for the ID.
 * @returns {string}  e.g. "fis_0192fa3c-b41a-7e8d-a312-0c2e9f4a87b5"
 */
export function newUUIDv7(prefix = 'id') {
  const now = Date.now();
  const buf = new Uint8Array(16);

  // Timestamp: 48 bits (bytes 0-5) — milliseconds since Unix epoch, big-endian
  buf[0] = Math.floor(now / 0x10000000000) & 0xff;
  buf[1] = Math.floor(now / 0x100000000) & 0xff;
  buf[2] = Math.floor(now / 0x1000000) & 0xff;
  buf[3] = Math.floor(now / 0x10000) & 0xff;
  buf[4] = Math.floor(now / 0x100) & 0xff;
  buf[5] = now & 0xff;

  // Random bytes for positions 6-15
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(buf.subarray(6));
  } else {
    for (let i = 6; i < 16; i++) buf[i] = Math.floor(Math.random() * 256) & 0xff;
  }

  // Set version 7 (bits 48-51 → high nibble of byte 6)
  buf[6] = (buf[6] & 0x0f) | 0x70;
  // Set RFC 4122 variant 10xx (bits 64-65 → high 2 bits of byte 8)
  buf[8] = (buf[8] & 0x3f) | 0x80;

  const hex = Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return prefix ? `${prefix}_${uuid}` : uuid;
}
