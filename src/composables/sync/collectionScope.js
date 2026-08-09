/**
 * Normalizes and filters a collection scope list.
 *
 * Rules:
 * - accepts only non-empty strings (trimmed)
 * - optionally filters against an allow-list
 * - optionally excludes `menu_items` when menu source is JSON
 * - de-duplicates while preserving first-seen order
 *
 * @param {unknown} inputCollections
 * @param {{
 *   allowedCollections?: string[]|Set<string>|null,
 *   menuSource?: string|null,
 *   excludeMenuItemsInJsonMode?: boolean,
 * }} [options]
 * @returns {string[]}
 */
export function normalizeCollectionScope(
  inputCollections,
  {
    allowedCollections = null,
    menuSource = null,
    excludeMenuItemsInJsonMode = false,
  } = {},
) {
  const input = Array.isArray(inputCollections) ? inputCollections : [];
  const allowedSet = allowedCollections
    ? (allowedCollections instanceof Set ? allowedCollections : new Set(allowedCollections))
    : null;
  const output = [];
  const seen = new Set();

  for (const candidate of input) {
    if (typeof candidate !== 'string') continue;
    const collection = candidate.trim();
    if (!collection) continue;
    if (allowedSet && !allowedSet.has(collection)) continue;
    if (excludeMenuItemsInJsonMode && menuSource === 'json' && collection === 'menu_items') continue;
    if (seen.has(collection)) continue;
    seen.add(collection);
    output.push(collection);
  }

  return output;
}
