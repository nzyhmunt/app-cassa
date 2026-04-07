import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enqueuePrintJobs } from '../usePrintQueue.js';
import { appConfig } from '../../utils/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a minimal order object for testing. */
function makeOrder(overrides = {}) {
  return {
    id: 'ord_test',
    table: '05',
    time: '12:30',
    globalNote: '',
    isDirectEntry: false,
    orderItems: [
      { uid: 'r_1', dishId: 'ant_1', name: 'Bruschetta', unitPrice: 3, quantity: 2, voidedQuantity: 0, notes: ['Senza aglio'], course: 'prima', modifiers: [] },
      { uid: 'r_2', dishId: 'bev_1', name: 'Acqua',      unitPrice: 1, quantity: 1, voidedQuantity: 0, notes: [],              course: 'insieme', modifiers: [] },
    ],
    ...overrides,
  };
}

/** Printers config with two printers scoped by category. */
const TWO_PRINTERS = [
  { id: 'cucina', name: 'Cucina', url: 'http://localhost:3001/print', categories: ['Antipasti'] },
  { id: 'bar',    name: 'Bar',    url: 'http://localhost:3002/print', categories: ['Bevande'] },
];

/** Printer config with a catch-all (no categories). */
const CATCHALL_PRINTER = [
  { id: 'all', name: 'All', url: 'http://localhost:3000/print' },
];

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let fetchMock;
let originalPrinters;
let originalMenu;

beforeEach(() => {
  // Store originals
  originalPrinters = appConfig.printers;
  originalMenu     = appConfig.menu;

  // Inject a minimal menu so dishId → category resolution works
  appConfig.menu = {
    Antipasti: [{ id: 'ant_1', name: 'Bruschetta', price: 3 }],
    Bevande:   [{ id: 'bev_1', name: 'Acqua',      price: 1 }],
  };

  // Mock fetch
  fetchMock = vi.fn().mockResolvedValue({ ok: true });
  global.fetch = fetchMock;
});

afterEach(() => {
  appConfig.printers = originalPrinters;
  appConfig.menu     = originalMenu;
  vi.restoreAllMocks();
  delete global.fetch;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('enqueuePrintJobs()', () => {
  describe('no-op conditions', () => {
    it('does nothing when printers array is empty', () => {
      appConfig.printers = [];
      enqueuePrintJobs(makeOrder());
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does nothing when printers is absent (undefined)', () => {
      appConfig.printers = undefined;
      enqueuePrintJobs(makeOrder());
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does nothing for direct-entry orders', () => {
      appConfig.printers = CATCHALL_PRINTER;
      enqueuePrintJobs(makeOrder({ isDirectEntry: true }));
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does nothing when all items are fully voided', () => {
      appConfig.printers = CATCHALL_PRINTER;
      const order = makeOrder({
        orderItems: [
          { uid: 'r_1', dishId: 'ant_1', name: 'Bruschetta', unitPrice: 3, quantity: 2, voidedQuantity: 2, notes: [], course: 'insieme', modifiers: [] },
        ],
      });
      enqueuePrintJobs(order);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('skips a printer whose url is falsy', () => {
      appConfig.printers = [{ id: 'x', name: 'X', url: '', categories: [] }];
      enqueuePrintJobs(makeOrder());
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('category-based routing', () => {
    it('sends one job per matched printer', async () => {
      appConfig.printers = TWO_PRINTERS;
      enqueuePrintJobs(makeOrder());
      // Wait for fire-and-forget promises to settle
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    });

    it('sends Antipasti item only to cucina printer', async () => {
      appConfig.printers = TWO_PRINTERS;
      enqueuePrintJobs(makeOrder());
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

      const cucinaCall = fetchMock.mock.calls.find(([url]) => url === 'http://localhost:3001/print');
      expect(cucinaCall).toBeDefined();
      const body = JSON.parse(cucinaCall[1].body);
      expect(body.printerId).toBe('cucina');
      expect(body.items).toHaveLength(1);
      expect(body.items[0].name).toBe('Bruschetta');
    });

    it('sends Bevande item only to bar printer', async () => {
      appConfig.printers = TWO_PRINTERS;
      enqueuePrintJobs(makeOrder());
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

      const barCall = fetchMock.mock.calls.find(([url]) => url === 'http://localhost:3002/print');
      expect(barCall).toBeDefined();
      const body = JSON.parse(barCall[1].body);
      expect(body.printerId).toBe('bar');
      expect(body.items).toHaveLength(1);
      expect(body.items[0].name).toBe('Acqua');
    });

    it('does not send a job to a printer when no items match its categories', async () => {
      appConfig.printers = [
        { id: 'cucina', name: 'Cucina', url: 'http://localhost:3001/print', categories: ['Antipasti'] },
      ];
      // Order has only a bevanda, which doesn't match Antipasti
      enqueuePrintJobs(makeOrder({
        orderItems: [
          { uid: 'r_2', dishId: 'bev_1', name: 'Acqua', unitPrice: 1, quantity: 1, voidedQuantity: 0, notes: [], course: 'insieme', modifiers: [] },
        ],
      }));
      // Give promises time to settle
      await new Promise(r => setTimeout(r, 0));
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('matches categories case-insensitively', async () => {
      appConfig.printers = [
        { id: 'cucina', name: 'Cucina', url: 'http://localhost:3001/print', categories: ['antipasti'] },
      ];
      enqueuePrintJobs(makeOrder({
        orderItems: [
          { uid: 'r_1', dishId: 'ant_1', name: 'Bruschetta', unitPrice: 3, quantity: 1, voidedQuantity: 0, notes: [], course: 'insieme', modifiers: [] },
        ],
      }));
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    });
  });

  describe('catch-all printer (empty categories)', () => {
    it('sends all items to a catch-all printer', async () => {
      appConfig.printers = CATCHALL_PRINTER;
      enqueuePrintJobs(makeOrder());
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.items).toHaveLength(2);
    });

    it('treats absent categories as catch-all', async () => {
      appConfig.printers = [{ id: 'all', name: 'All', url: 'http://localhost:3000/print' }];
      enqueuePrintJobs(makeOrder());
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    });
  });

  describe('job payload', () => {
    it('includes jobId, orderId, table, time and globalNote', async () => {
      appConfig.printers = CATCHALL_PRINTER;
      const order = makeOrder({ id: 'ord_abc', table: '07', time: '20:15', globalNote: 'Senza fretta' });
      enqueuePrintJobs(order);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.jobId).toMatch(/^job_/);
      expect(body.orderId).toBe('ord_abc');
      expect(body.table).toBe('07');
      expect(body.time).toBe('20:15');
      expect(body.globalNote).toBe('Senza fretta');
    });

    it('uses POST with Content-Type application/json', async () => {
      appConfig.printers = CATCHALL_PRINTER;
      enqueuePrintJobs(makeOrder());
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      const [, options] = fetchMock.mock.calls[0];
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
    });

    it('reports only active (non-voided) quantity in item', async () => {
      appConfig.printers = CATCHALL_PRINTER;
      const order = makeOrder({
        orderItems: [
          { uid: 'r_1', dishId: 'ant_1', name: 'Bruschetta', unitPrice: 3, quantity: 3, voidedQuantity: 1, notes: [], course: 'insieme', modifiers: [] },
        ],
      });
      enqueuePrintJobs(order);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.items[0].quantity).toBe(2); // 3 - 1
    });

    it('includes item notes, course and active modifiers', async () => {
      appConfig.printers = CATCHALL_PRINTER;
      const order = makeOrder({
        orderItems: [
          {
            uid: 'r_1', dishId: 'ant_1', name: 'Bruschetta', unitPrice: 3,
            quantity: 2, voidedQuantity: 0,
            notes: ['Senza aglio'],
            course: 'prima',
            modifiers: [
              { name: 'Extra cheese', price: 1, voidedQuantity: 0 },
            ],
          },
        ],
      });
      enqueuePrintJobs(order);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const item = body.items[0];
      expect(item.notes).toEqual(['Senza aglio']);
      expect(item.course).toBe('prima');
      expect(item.modifiers).toHaveLength(1);
      expect(item.modifiers[0].name).toBe('Extra cheese');
    });

    it('excludes fully-voided modifiers from the job', async () => {
      appConfig.printers = CATCHALL_PRINTER;
      const order = makeOrder({
        orderItems: [
          {
            uid: 'r_1', dishId: 'ant_1', name: 'Bruschetta', unitPrice: 3,
            quantity: 2, voidedQuantity: 0,
            notes: [],
            course: 'insieme',
            modifiers: [
              { name: 'Extra cheese', price: 1, voidedQuantity: 2 }, // fully voided
            ],
          },
        ],
      });
      enqueuePrintJobs(order);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.items[0].modifiers).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    it('does not throw when fetch rejects (network error)', async () => {
      appConfig.printers = CATCHALL_PRINTER;
      fetchMock.mockRejectedValue(new Error('Network error'));

      expect(() => enqueuePrintJobs(makeOrder())).not.toThrow();
      // Allow the rejected promise to settle without uncaught-rejection warnings
      await new Promise(r => setTimeout(r, 10));
    });

    it('does not throw when fetch returns a non-OK status', async () => {
      appConfig.printers = CATCHALL_PRINTER;
      fetchMock.mockResolvedValue({ ok: false, status: 500 });

      expect(() => enqueuePrintJobs(makeOrder())).not.toThrow();
      await new Promise(r => setTimeout(r, 10));
    });
  });
});
