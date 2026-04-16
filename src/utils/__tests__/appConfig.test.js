import { describe, it, expect } from 'vitest';
import { appConfig, applyDirectusConfigToAppConfig, resetAppConfigFromDefaults } from '../index.js';

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

  describe('applyDirectusConfigToAppConfig', () => {
    it('maps rooms and tables when table relations are scalar ids', () => {
      resetAppConfigFromDefaults();

      applyDirectusConfigToAppConfig({
        venueRecord: null,
        rooms: [
          { id: 'room_terrazza', label: 'Terrazza', tables: ['tbl_T1', 'tbl_T2', 'tbl_T3'] },
          { id: 'room_sala-interna', label: 'Sala Interna', tables: ['tbl_01', 'tbl_02', 'tbl_03', 'tbl_04'] },
        ],
        tables: [
          { id: 'tbl_01', room: 'room_sala-interna', label: '01', covers: 4 },
          { id: 'tbl_02', room: 'room_sala-interna', label: '02', covers: 4 },
          { id: 'tbl_03', room: 'room_sala-interna', label: '03', covers: 2 },
          { id: 'tbl_04', room: 'room_sala-interna', label: '04', covers: 6 },
          { id: 'tbl_T1', room: 'room_terrazza', label: 'T1', covers: 4 },
          { id: 'tbl_T2', room: 'room_terrazza', label: 'T2', covers: 4 },
          { id: 'tbl_T3', room: 'room_terrazza', label: 'T3', covers: 8 },
        ],
        paymentMethods: [],
        printers: [],
        categories: [],
        items: [],
      });

      expect(appConfig.rooms).toEqual([
        {
          id: 'room_terrazza',
          label: 'Terrazza',
          tables: [
            { id: 'tbl_T1', label: 'T1', covers: 4 },
            { id: 'tbl_T2', label: 'T2', covers: 4 },
            { id: 'tbl_T3', label: 'T3', covers: 8 },
          ],
        },
        {
          id: 'room_sala-interna',
          label: 'Sala Interna',
          tables: [
            { id: 'tbl_01', label: '01', covers: 4 },
            { id: 'tbl_02', label: '02', covers: 4 },
            { id: 'tbl_03', label: '03', covers: 2 },
            { id: 'tbl_04', label: '04', covers: 6 },
          ],
        },
      ]);
      expect(appConfig.tables).toEqual(appConfig.rooms.flatMap((room) => room.tables));
    });

    it('uses room.tables expanded objects when tables collection is empty', () => {
      resetAppConfigFromDefaults();

      applyDirectusConfigToAppConfig({
        venueRecord: null,
        rooms: [
          {
            id: 'room_terrazza',
            label: 'Terrazza',
            tables: [
              { id: 'tbl_T1', label: 'T1', covers: 4 },
              { id: 'tbl_T2', label: 'T2', covers: 4 },
            ],
          },
        ],
        tables: [],
        paymentMethods: [],
        printers: [],
        categories: [],
        items: [],
      });

      expect(appConfig.rooms).toEqual([
        {
          id: 'room_terrazza',
          label: 'Terrazza',
          tables: [
            { id: 'tbl_T1', label: 'T1', covers: 4 },
            { id: 'tbl_T2', label: 'T2', covers: 4 },
          ],
        },
      ]);
      expect(appConfig.tables).toEqual([
        { id: 'tbl_T1', label: 'T1', covers: 4 },
        { id: 'tbl_T2', label: 'T2', covers: 4 },
      ]);
    });

    it('applies UI fallbacks safely when venue scalar fields are missing/null', () => {
      resetAppConfigFromDefaults();
      appConfig.ui.primaryColor = '#123456';
      appConfig.ui.primaryColorDark = '#234567';
      appConfig.ui.currency = '$';

      applyDirectusConfigToAppConfig({
        venueRecord: {
          id: 1,
          name: 'Venue Test',
          primary_color: '',
          primary_color_dark: null,
          currency_symbol: null,
        },
      });

      expect(appConfig.ui.name).toBe('Venue Test');
      expect(appConfig.ui.primaryColor).toBe('#00846c');
      expect(appConfig.ui.primaryColorDark).toBe('#0c7262');
      expect(appConfig.ui.currency).toBe('€');
    });
  });
});
