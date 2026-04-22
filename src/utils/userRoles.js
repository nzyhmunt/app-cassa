/**
 * Normalize role values from Directus into a unique, lower-cased array.
 *
 * Accepts:
 * - array: ["admin", "cameriere"]
 * - scalar string: "admin"
 * - JSON string: "[\"cameriere\",\"cuoco\"]"
 * - CSV string: "cameriere,cuoco"
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeRoleArray(value) {
  const normalized = [];
  const appendRole = (raw) => {
    if (typeof raw !== 'string') return;
    const role = raw.trim().toLowerCase();
    if (!role || normalized.includes(role)) return;
    normalized.push(role);
  };

  if (Array.isArray(value)) {
    value.forEach(appendRole);
    return normalized;
  }
  if (typeof value !== 'string') return normalized;

  const trimmed = value.trim();
  if (!trimmed) return normalized;

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      parsed.forEach(appendRole);
      return normalized;
    }
  } catch (_) {
    // fall through to scalar / CSV parsing
  }

  if (trimmed.includes(',')) {
    trimmed.split(',').forEach(appendRole);
    return normalized;
  }

  appendRole(trimmed);
  return normalized;
}
