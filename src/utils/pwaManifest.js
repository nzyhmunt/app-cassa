/**
 * @file pwaManifest.js
 * @description Helper utilities for PWA web-app manifest generation.
 *
 * This module is intentionally free of any browser or Vite-specific APIs so
 * that it can be imported both by the Vite build configuration (Node.js) and
 * by unit-test suites.
 */

/**
 * Icon sizes that should be generated in the PWA manifest for the custom logo.
 * Both entries are required by the PWA specification for full install support.
 */
export const PWA_LOGO_SIZES = ['192x192', '512x512'];

/**
 * Returns the MIME type that corresponds to the image file extension in `url`.
 * Strips query-string and hash fragments before inspecting the extension.
 * Defaults to `image/png` for unknown or missing extensions.
 *
 * Supported formats: png, jpg/jpeg, svg, webp, gif, ico.
 *
 * @param {string} url - Absolute or relative image URL.
 * @returns {string} MIME type string.
 */
export function getMimeType(url) {
  if (typeof url !== 'string') return 'image/png';
  const cleanUrl = url.split('?')[0].split('#')[0];
  const ext = cleanUrl.split('.').pop().toLowerCase();
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'ico') return 'image/x-icon';
  return 'image/png';
}

/**
 * Returns a copy of the `icons` array with `logoUrl` appended as maskable
 * icon entries for every size listed in `PWA_LOGO_SIZES`.
 *
 * Idempotent per (src, sizes) pair — already-present entries are not
 * duplicated.  The original array is never mutated.
 *
 * @param {object[]|*} icons   Existing icons array from the web-app manifest.
 *                            If not an array, the value is returned unchanged.
 * @param {string}     logoUrl Absolute URL of the custom logo image.
 * @returns {object[]|*} Updated icons array, or the original `icons` value
 *                       unchanged when it is not an array.
 */
export function injectLogoIcon(icons, logoUrl) {
  if (!Array.isArray(icons)) return icons;
  const mimeType = getMimeType(logoUrl);
  const result = [...icons];
  for (const sizes of PWA_LOGO_SIZES) {
    if (!result.some((i) => i.src === logoUrl && i.sizes === sizes)) {
      result.push({ src: logoUrl, sizes, type: mimeType, purpose: 'any maskable' });
    }
  }
  return result;
}
