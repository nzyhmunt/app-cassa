import { describe, it, expect } from 'vitest';
import { appConfig } from '../index.js';
import { injectLogoIcon, getMimeType, PWA_LOGO_SIZES } from '../pwaManifest.js';

// ---------------------------------------------------------------------------
// appConfig — structural and default-value assertions
// ---------------------------------------------------------------------------

describe('appConfig', () => {
  describe('pwaLogo', () => {
    it('exposes a pwaLogo field', () => {
      expect(Object.prototype.hasOwnProperty.call(appConfig, 'pwaLogo')).toBe(true);
    });

    it('has the expected default logo URL', () => {
      expect(appConfig.pwaLogo).toBe(
        'https://odg.nanawork.it/media/com_directus/assets/manifest/hr/icon512_maskable.png',
      );
    });

    it('is a non-empty string', () => {
      expect(typeof appConfig.pwaLogo).toBe('string');
      expect(appConfig.pwaLogo.length).toBeGreaterThan(0);
    });

    it('starts with https://', () => {
      expect(appConfig.pwaLogo.startsWith('https://')).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// getMimeType() — MIME type detection from URL extension
// ---------------------------------------------------------------------------

describe('getMimeType()', () => {
  it('returns image/png for .png URLs', () => {
    expect(getMimeType('https://example.com/logo.png')).toBe('image/png');
  });

  it('returns image/svg+xml for .svg URLs', () => {
    expect(getMimeType('https://example.com/logo.svg')).toBe('image/svg+xml');
  });

  it('returns image/jpeg for .jpg URLs', () => {
    expect(getMimeType('https://example.com/logo.jpg')).toBe('image/jpeg');
  });

  it('returns image/jpeg for .jpeg URLs', () => {
    expect(getMimeType('https://example.com/logo.jpeg')).toBe('image/jpeg');
  });

  it('returns image/webp for .webp URLs', () => {
    expect(getMimeType('https://example.com/logo.webp')).toBe('image/webp');
  });

  it('returns image/gif for .gif URLs', () => {
    expect(getMimeType('https://example.com/logo.gif')).toBe('image/gif');
  });

  it('returns image/x-icon for .ico URLs', () => {
    expect(getMimeType('https://example.com/favicon.ico')).toBe('image/x-icon');
  });

  it('returns image/png for URLs with no recognisable extension', () => {
    expect(getMimeType('https://example.com/logo')).toBe('image/png');
  });

  it('strips query strings before checking the extension', () => {
    expect(getMimeType('https://example.com/logo.svg?v=2')).toBe('image/svg+xml');
  });

  it('strips hash fragments before checking the extension', () => {
    expect(getMimeType('https://example.com/logo.jpeg#section')).toBe('image/jpeg');
  });

  it('returns image/png for non-string input', () => {
    expect(getMimeType(null)).toBe('image/png');
    expect(getMimeType(undefined)).toBe('image/png');
    expect(getMimeType(42)).toBe('image/png');
  });
});

// ---------------------------------------------------------------------------
// injectLogoIcon — unit tests for the manifest-icon injection helper
// ---------------------------------------------------------------------------

describe('injectLogoIcon()', () => {
  const LOGO_URL = 'https://example.com/logo.png';

  const baseIcons = [
    { src: './icons/app-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
    { src: './icons/app-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
  ];

  it('appends one entry per PWA_LOGO_SIZES to an existing icons array', () => {
    const result = injectLogoIcon(baseIcons, LOGO_URL);
    expect(result).toHaveLength(baseIcons.length + PWA_LOGO_SIZES.length);
  });

  it('adds entries for every required PWA size', () => {
    const result = injectLogoIcon(baseIcons, LOGO_URL);
    for (const sizes of PWA_LOGO_SIZES) {
      expect(result.some((i) => i.src === LOGO_URL && i.sizes === sizes)).toBe(true);
    }
  });

  it('sets the correct metadata (MIME type, purpose) on each injected entry', () => {
    const result = injectLogoIcon(baseIcons, LOGO_URL);
    const injected = result.filter((i) => i.src === LOGO_URL);
    for (const entry of injected) {
      expect(entry.type).toBe('image/png');
      expect(entry.purpose).toBe('any maskable');
    }
  });

  it('infers the correct MIME type for SVG logos', () => {
    const svgUrl = 'https://example.com/logo.svg';
    const result = injectLogoIcon([], svgUrl);
    for (const entry of result) {
      expect(entry.type).toBe('image/svg+xml');
    }
  });

  it('does not modify the original icons array (immutable)', () => {
    const original = [...baseIcons];
    injectLogoIcon(baseIcons, LOGO_URL);
    expect(baseIcons).toEqual(original);
  });

  it('does not add duplicates when all logo sizes are already present', () => {
    const iconsWithLogo = [
      ...baseIcons,
      ...PWA_LOGO_SIZES.map((sizes) => ({
        src: LOGO_URL,
        sizes,
        type: 'image/png',
        purpose: 'any maskable',
      })),
    ];
    const result = injectLogoIcon(iconsWithLogo, LOGO_URL);
    expect(result).toHaveLength(iconsWithLogo.length);
  });

  it('adds only the missing size when one logo size is already present', () => {
    const iconsWithPartial = [
      ...baseIcons,
      { src: LOGO_URL, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ];
    const result = injectLogoIcon(iconsWithPartial, LOGO_URL);
    // Should add exactly one more entry for the missing size
    expect(result).toHaveLength(iconsWithPartial.length + 1);
    expect(result.filter((i) => i.src === LOGO_URL)).toHaveLength(PWA_LOGO_SIZES.length);
  });

  it('returns the value unchanged when icons is not an array', () => {
    expect(injectLogoIcon(null, LOGO_URL)).toBeNull();
    expect(injectLogoIcon(undefined, LOGO_URL)).toBeUndefined();
    expect(injectLogoIcon('bad', LOGO_URL)).toBe('bad');
  });

  it('works on an empty icons array and adds one entry per required size', () => {
    const result = injectLogoIcon([], LOGO_URL);
    expect(result).toHaveLength(PWA_LOGO_SIZES.length);
    for (const sizes of PWA_LOGO_SIZES) {
      expect(result.some((i) => i.src === LOGO_URL && i.sizes === sizes)).toBe(true);
    }
  });
});
