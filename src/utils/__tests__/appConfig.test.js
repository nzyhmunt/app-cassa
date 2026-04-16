import { describe, it, expect } from 'vitest';
import { appConfig, resetAppConfigFromDefaults } from '../index.js';

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

  describe('demoOrders', () => {
    it('is an array (can be emptied to disable demo mode)', () => {
      expect(Array.isArray(appConfig.demoOrders)).toBe(true);
    });

    it('includes a coperto direct-entry order for each demo table', () => {
      const coverOrders = appConfig.demoOrders.filter(o => o.isCoverCharge && o.isDirectEntry);
      const demoTables = [...new Set(appConfig.demoOrders.map(o => o.table))];
      expect(coverOrders.length).toBeGreaterThanOrEqual(demoTables.length);
    });
  });

  describe('resetAppConfigFromDefaults', () => {
    it('restores config defaults while preserving directus settings by default', () => {
      const originalDirectus = { ...appConfig.directus, enabled: true, url: 'https://example.test' };
      appConfig.directus = originalDirectus;
      appConfig.ui.primaryColor = '#000000';

      resetAppConfigFromDefaults();

      expect(appConfig.ui.primaryColor).not.toBe('#000000');
      expect(appConfig.directus).toEqual(originalDirectus);
    });
  });
});
