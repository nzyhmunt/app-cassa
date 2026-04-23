import { describe, it, expect } from 'vitest';
import { appConfig, DEFAULT_SETTINGS, createRuntimeConfig, applyDirectusConfigToAppConfig } from '../index.js';
import {
  mapVenueConfigFromDirectus,
  mapOrderFromDirectus,
  mapOrderToDirectus,
  mapOrderItemToDirectus,
} from '../mappers.js';

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

  describe('mapVenueConfigFromDirectus', () => {
    it('maps rooms and tables when table relations are scalar ids', () => {
      const runtime = mapVenueConfigFromDirectus({
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
      }, DEFAULT_SETTINGS);

      expect(runtime.rooms).toEqual([
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
      expect(runtime.tables).toEqual(runtime.rooms.flatMap((room) => room.tables));
    });

    it('uses room.tables expanded objects when tables collection is empty', () => {
      const runtime = mapVenueConfigFromDirectus({
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
      }, DEFAULT_SETTINGS);

      expect(runtime.rooms).toEqual([
        {
          id: 'room_terrazza',
          label: 'Terrazza',
          tables: [
            { id: 'tbl_T1', label: 'T1', covers: 4 },
            { id: 'tbl_T2', label: 'T2', covers: 4 },
          ],
        },
      ]);
      expect(runtime.tables).toEqual([
        { id: 'tbl_T1', label: 'T1', covers: 4 },
        { id: 'tbl_T2', label: 'T2', covers: 4 },
      ]);
    });

    it('applies UI fallbacks safely when venue scalar fields are missing/null', () => {
      const runtime = mapVenueConfigFromDirectus({
        venueRecord: {
          id: 1,
          name: 'Venue Test',
          primary_color: '',
          primary_color_dark: null,
          currency_symbol: null,
        },
      }, DEFAULT_SETTINGS);

      expect(runtime.ui.name).toBe('Venue Test');
      expect(runtime.ui.primaryColor).toBe('#00846c');
      expect(runtime.ui.primaryColorDark).toBe('#0c7262');
      expect(runtime.ui.currency).toBe('€');
    });

    it('applies UI fallbacks safely when venue scalar fields are undefined', () => {
      const runtime = mapVenueConfigFromDirectus({
        venueRecord: {
          id: 1,
          name: 'Venue Undefined',
        },
      }, DEFAULT_SETTINGS);

      expect(runtime.ui.name).toBe('Venue Undefined');
      expect(runtime.ui.primaryColor).toBe('#00846c');
      expect(runtime.ui.primaryColorDark).toBe('#0c7262');
      expect(runtime.ui.currency).toBe('€');
      expect(runtime.billing.autoCloseOnFullPayment).toBe(false);
    });

    it('maps billing_auto_close_on_full_payment to billing.autoCloseOnFullPayment', () => {
      const runtime = mapVenueConfigFromDirectus({
        venueRecord: {
          id: 1,
          billing_auto_close_on_full_payment: false,
        },
      }, DEFAULT_SETTINGS);

      expect(runtime.billing.autoCloseOnFullPayment).toBe(false);
    });
  });

  describe('mapOrderFromDirectus', () => {
    it('normalizes nested order_items values to avoid NaN in UI after reload', () => {
      const mapped = mapOrderFromDirectus({
        id: 'ord_1',
        table: '01',
        total_amount: '19.50',
        item_count: '2',
        order_items: [
          {
            id: 'item_1',
            name: 'Pizza',
            unit_price: '9.75',
            quantity: '2',
            voided_quantity: '0',
            modifiers: [{ name: 'Extra', price: '1.50', voided_quantity: '0' }],
          },
        ],
      });

      expect(mapped.totalAmount).toBe(19.5);
      expect(mapped.itemCount).toBe(2);
      expect(mapped.total_amount).toBe(19.5);
      expect(mapped.item_count).toBe(2);
      expect(mapped.orderItems).toHaveLength(1);
      expect(mapped.orderItems[0].unitPrice).toBe(9.75);
      expect(mapped.orderItems[0].unit_price).toBe(9.75);
      expect(mapped.orderItems[0].quantity).toBe(2);
      expect(mapped.orderItems[0].voidedQuantity).toBe(0);
      expect(mapped.orderItems[0].voided_quantity).toBe(0);
      expect(mapped.orderItems[0].modifiers[0].price).toBe(1.5);
      expect(mapped.orderItems[0].modifiers[0].voidedQuantity).toBe(0);
      expect(mapped.orderItems[0].modifiers[0].voided_quantity).toBe(0);
    });

    it('normalizes invalid numeric fields to default fallbacks', () => {
      const mapped = mapOrderFromDirectus({
        id: 'ord_2',
        total_amount: 'invalid',
        item_count: null,
        order_items: [
          { id: 'item_2', unit_price: 'x', quantity: 'y', voided_quantity: undefined },
        ],
      });

      expect(mapped.totalAmount).toBe(0);
      expect(mapped.itemCount).toBe(0);
      expect(mapped.total_amount).toBe(0);
      expect(mapped.item_count).toBe(0);
      expect(mapped.orderItems[0].unitPrice).toBe(0);
      expect(mapped.orderItems[0].unit_price).toBe(0);
      expect(mapped.orderItems[0].quantity).toBe(0);
      expect(mapped.orderItems[0].voidedQuantity).toBe(0);
      expect(mapped.orderItems[0].voided_quantity).toBe(0);
    });

    it('keeps push payload numeric when source snake_case values are invalid', () => {
      const mapped = mapOrderFromDirectus({
        id: 'ord_3',
        total_amount: 'invalid',
        item_count: 'invalid',
        order_items: [{ id: 'item_3', unit_price: 'bad', voided_quantity: 'bad', quantity: 'bad' }],
      });

      const orderPayload = mapOrderToDirectus(mapped);
      const itemPayload = mapOrderItemToDirectus(mapped.orderItems[0]);

      expect(orderPayload.total_amount).toBe(0);
      expect(orderPayload.item_count).toBe(0);
      expect(itemPayload.unit_price).toBe(0);
      expect(itemPayload.voided_quantity).toBe(0);
    });
  });

  describe('createRuntimeConfig', () => {
    it('returns a fresh runtime copy with derived tables', () => {
      const runtime = createRuntimeConfig();
      expect(runtime).not.toBe(DEFAULT_SETTINGS);
      expect(runtime.tables).toEqual(runtime.rooms.flatMap((room) => room.tables ?? []));
    });
  });

  describe('applyDirectusConfigToAppConfig', () => {
    it('normalizes values and updates appConfig.directus', () => {
      const previous = { ...appConfig.directus };
      try {
        const next = applyDirectusConfigToAppConfig({
          enabled: true,
          url: 'https://directus.example.com',
          staticToken: 'tok_test',
          venueId: 12,
          wsEnabled: true,
        });
        expect(next).toEqual({
          enabled: true,
          url: 'https://directus.example.com',
          staticToken: 'tok_test',
          venueId: 12,
          wsEnabled: true,
        });
        expect(appConfig.directus).toEqual(next);
      } finally {
        appConfig.directus = previous;
      }
    });

    it('falls back to defaults for invalid payload values', () => {
      const previous = { ...appConfig.directus };
      try {
        const next = applyDirectusConfigToAppConfig({
          enabled: 'yes',
          url: null,
          staticToken: 123,
          venueId: undefined,
          wsEnabled: 'no',
        });
        expect(next).toEqual({
          enabled: false,
          url: '',
          staticToken: '',
          venueId: null,
          wsEnabled: false,
        });
      } finally {
        appConfig.directus = previous;
      }
    });
  });
});
