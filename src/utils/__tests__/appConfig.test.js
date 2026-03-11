import { describe, it, expect } from 'vitest';
import { appConfig } from '../index.js';
import { injectLogoIcon } from '../pwaManifest.js';

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
// injectLogoIcon — unit tests for the manifest-icon injection helper
// ---------------------------------------------------------------------------

describe('injectLogoIcon()', () => {
  const LOGO_URL = 'https://example.com/logo.png';

  const baseIcons = [
    { src: './icons/app-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
    { src: './icons/app-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
  ];

  it('appends the logo icon to an existing icons array', () => {
    const result = injectLogoIcon(baseIcons, LOGO_URL);
    expect(result).toHaveLength(baseIcons.length + 1);
    expect(result[result.length - 1].src).toBe(LOGO_URL);
  });

  it('sets the correct metadata on the injected icon', () => {
    const result = injectLogoIcon(baseIcons, LOGO_URL);
    const injected = result[result.length - 1];
    expect(injected).toEqual({
      src: LOGO_URL,
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any maskable',
    });
  });

  it('does not modify the original icons array (immutable)', () => {
    const original = [...baseIcons];
    injectLogoIcon(baseIcons, LOGO_URL);
    expect(baseIcons).toEqual(original);
  });

  it('does not add a duplicate when the logo is already present', () => {
    const iconsWithLogo = [...baseIcons, { src: LOGO_URL, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }];
    const result = injectLogoIcon(iconsWithLogo, LOGO_URL);
    expect(result).toHaveLength(iconsWithLogo.length);
  });

  it('returns the value unchanged when icons is not an array', () => {
    expect(injectLogoIcon(null, LOGO_URL)).toBeNull();
    expect(injectLogoIcon(undefined, LOGO_URL)).toBeUndefined();
    expect(injectLogoIcon('bad', LOGO_URL)).toBe('bad');
  });

  it('works on an empty icons array', () => {
    const result = injectLogoIcon([], LOGO_URL);
    expect(result).toHaveLength(1);
    expect(result[0].src).toBe(LOGO_URL);
  });
});
