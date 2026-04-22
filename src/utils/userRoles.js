/**
 * Normalize Directus `venue_users.apps` into a unique lower-cased array.
 *
 * Accepted shape:
 * - array: ["admin"] or ["cassa", "sala"]
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeAppsArray(value) {
  if (!Array.isArray(value)) return [];
  const normalized = [];
  value.forEach((raw) => {
    if (typeof raw !== 'string') return;
    const app = raw.trim().toLowerCase();
    if (!app || normalized.includes(app)) return;
    normalized.push(app);
  });
  return normalized;
}
