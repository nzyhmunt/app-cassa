/**
 * @file pwaManifest.js
 * @description Helper utilities for PWA web-app manifest generation.
 *
 * This module is intentionally free of any browser or Vite-specific APIs so
 * that it can be imported both by the Vite build configuration (Node.js) and
 * by unit-test suites.
 */

/**
 * Returns a copy of the `icons` array with `logoUrl` appended as a
 * 512×512 maskable icon entry.  If the URL is already present in the array,
 * the original array is returned unchanged (idempotent).
 *
 * @param {object[]} icons   Existing icons array from the web-app manifest.
 * @param {string}   logoUrl Absolute URL of the custom logo image.
 * @returns {object[]} Updated icons array.
 */
export function injectLogoIcon(icons, logoUrl) {
  if (!Array.isArray(icons)) return icons;
  if (icons.some((i) => i.src === logoUrl)) return icons;
  return [
    ...icons,
    { src: logoUrl, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
  ];
}
