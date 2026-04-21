/**
 * Shared PIN policy and hashing helpers used by auth/login and synchronization pipelines.
 */

export const PIN_LENGTH = 4;

/**
 * Returns a SHA-256 hex digest of the given PIN string.
 * @param {string} pin
 * @returns {Promise<string>}
 */
export async function hashPin(pin) {
  const raw = String(pin ?? '');
  if (raw === '') return '';
  const data = new TextEncoder().encode(raw);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
