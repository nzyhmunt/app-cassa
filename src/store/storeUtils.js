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
