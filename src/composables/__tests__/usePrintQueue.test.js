import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { enqueuePrintJobs, enqueueTableMoveJob, enqueuePreBillJob, reprintJob } from '../usePrintQueue.js';
import { appConfig } from '../../utils/index.js';
import { useAppStore } from '../../store/index.js';
import { _resetIDBSingleton } from '../useIDB.js';
import { getPendingEntries } from '../useSyncQueue.js';

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
  { id: 'cucina', name: 'Cucina', url: 'http://localhost:3001/print', printTypes: ['order'], categories: ['Antipasti'] },
  { id: 'bar',    name: 'Bar',    url: 'http://localhost:3002/print', printTypes: ['order'], categories: ['Bevande'] },
];

/** Printer config with a catch-all (no categories, no printTypes). */
const CATCHALL_PRINTER = [
  { id: 'all', name: 'All', url: 'http://localhost:3000/print' },
];

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let fetchMock;
let originalPrinters;
let originalMenu;
const _originalFetch = global.fetch;

beforeEach(async () => {
  // Reset IDB so sync-queue entries from a previous test do not bleed through.
  await _resetIDBSingleton();

  // Mock fetch BEFORE activating Pinia so that loadMenu() uses the mock.
  // Use { ok: false } so loadMenu() fails fast without needing a json() method.
  fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
  global.fetch = fetchMock;

  // Activate a fresh Pinia instance and eagerly instantiate the store.
  // This triggers loadMenu() immediately, consuming the first fetch call.
  setActivePinia(createPinia());
  const store = useAppStore(); // instantiate → loadMenu() runs here

  // Wait deterministically for loadMenu() to finish, then clear its fetch call(s)
  // so test assertions only count print-related fetches.
  await vi.waitFor(() => expect(store.menuLoading).toBe(false));
  fetchMock.mockClear();
  fetchMock.mockResolvedValue({ ok: true }); // restore for print-job tests

  // Store originals
  originalPrinters = appConfig.printers;
  originalMenu     = appConfig.menu;

  // Inject a minimal menu so dishId → category resolution works
  appConfig.menu = {
    Antipasti: [{ id: 'ant_1', name: 'Bruschetta', price: 3 }],
    Bevande:   [{ id: 'bev_1', name: 'Acqua',      price: 1 }],
  };
});

afterEach(() => {
  appConfig.printers = originalPrinters;
  appConfig.menu     = originalMenu;
  vi.restoreAllMocks();
  global.fetch = _originalFetch;
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

    it('does nothing when printer printTypes excludes "order"', () => {
      appConfig.printers = [
        { id: 'cassa', name: 'Cassa', url: 'http://localhost:3003/print', printTypes: ['pre_bill'] },
      ];
      enqueuePrintJobs(makeOrder());
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('printTypes filter', () => {
    it('sends to printer with printTypes including "order"', async () => {
      appConfig.printers = [
        { id: 'cucina', name: 'Cucina', url: 'http://localhost:3001/print', printTypes: ['order'] },
      ];
      enqueuePrintJobs(makeOrder());
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    });

    it('sends to catch-all printer with empty printTypes', async () => {
      appConfig.printers = [
        { id: 'all', name: 'All', url: 'http://localhost:3000/print', printTypes: [] },
      ];
      enqueuePrintJobs(makeOrder());
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
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
    it('includes jobId, printType, orderId, table, time and globalNote', async () => {
      appConfig.printers = CATCHALL_PRINTER;
      const order = makeOrder({ id: 'ord_abc', table: '07', time: '20:15', globalNote: 'Senza fretta' });
      enqueuePrintJobs(order);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.jobId).toMatch(/^job_/);
      expect(body.printType).toBe('order');
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

    it('logs the job to the store print log', async () => {
      appConfig.printers = CATCHALL_PRINTER;
      const store = useAppStore();
      enqueuePrintJobs(makeOrder());
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(store.printLog).toHaveLength(1);
      expect(store.printLog[0].printType).toBe('order');
    });

    it('job status is "pending" immediately, then "done" on success', async () => {
      appConfig.printers = CATCHALL_PRINTER;
      const store = useAppStore();
      // Intercept fetch to check the status while the job is in-flight
      let resolveJob;
      fetchMock.mockImplementationOnce(() => new Promise(res => { resolveJob = () => res({ ok: true }); }));
      enqueuePrintJobs(makeOrder());
      // Right after enqueueing, the log entry should be 'pending' or 'printing'
      expect(['pending', 'printing']).toContain(store.printLog[0].status);
      // Resolve the fetch and wait for status to update
      resolveJob();
      await vi.waitFor(() => expect(store.printLog[0].status).toBe('done'));
    });

    it('job status becomes "error" on network failure', async () => {
      appConfig.printers = CATCHALL_PRINTER;
      const store = useAppStore();
      fetchMock.mockRejectedValue(new Error('Network error'));
      enqueuePrintJobs(makeOrder());
      await vi.waitFor(() => expect(store.printLog[0].status).toBe('error'));
      expect(store.printLog[0].errorMessage).toBeDefined();
    });

    it('job status becomes "error" on HTTP error', async () => {
      appConfig.printers = CATCHALL_PRINTER;
      const store = useAppStore();
      fetchMock.mockResolvedValue({ ok: false, status: 503 });
      enqueuePrintJobs(makeOrder());
      await vi.waitFor(() => expect(store.printLog[0].status).toBe('error'));
      expect(store.printLog[0].errorMessage).toMatch('503');
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

// ---------------------------------------------------------------------------
// enqueueTableMoveJob()
// ---------------------------------------------------------------------------

describe('enqueueTableMoveJob()', () => {
  it('does nothing when no printers are configured', () => {
    appConfig.printers = [];
    enqueueTableMoveJob('T1', '01', 'T2', '02');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing when printer printTypes excludes "table_move"', () => {
    appConfig.printers = [
      { id: 'cucina', name: 'Cucina', url: 'http://localhost:3001/print', printTypes: ['order'] },
    ];
    enqueueTableMoveJob('T1', '01', 'T2', '02');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends to printer with printType "table_move"', async () => {
    appConfig.printers = [
      { id: 'cassa', name: 'Cassa', url: 'http://localhost:3003/print', printTypes: ['table_move'] },
    ];
    enqueueTableMoveJob('T1', '01', 'T2', '02');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.printType).toBe('table_move');
    expect(body.fromTableId).toBe('T1');
    expect(body.toTableId).toBe('T2');
  });

  it('sends to catch-all printer (no printTypes)', async () => {
    appConfig.printers = CATCHALL_PRINTER;
    enqueueTableMoveJob('T1', '01', 'T2', '02');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it('logs the table_move job to the store', async () => {
    appConfig.printers = CATCHALL_PRINTER;
    const store = useAppStore();
    enqueueTableMoveJob('T1', 'Uno', 'T2', 'Due');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(store.printLog[0].printType).toBe('table_move');
    expect(store.printLog[0].table).toBe('Uno → Due');
  });
});

// ---------------------------------------------------------------------------
// enqueuePreBillJob()
// ---------------------------------------------------------------------------

describe('enqueuePreBillJob()', () => {
  it('does nothing when printerUrl is empty', () => {
    enqueuePreBillJob({ table: '01' }, '', 'Cassa');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends pre-bill job to the specified url', async () => {
    enqueuePreBillJob({ table: '05', tableLabel: 'Cinque' }, 'http://localhost:3003/print', 'Cassa');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.printType).toBe('pre_bill');
    expect(body.table).toBe('05');
  });

  it('uses explicit printerId when provided', async () => {
    appConfig.printers = [
      { id: 'p1', name: 'Shared A', url: 'http://localhost:3003/print', printTypes: ['pre_bill'] },
      { id: 'p2', name: 'Shared B', url: 'http://localhost:3003/print', printTypes: ['pre_bill'] },
    ];
    enqueuePreBillJob({ table: '05' }, 'http://localhost:3003/print', 'Shared B', 'p2');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.printerId).toBe('p2');
  });

  it('logs the pre_bill job to the store', async () => {
    const store = useAppStore();
    enqueuePreBillJob({ table: '05' }, 'http://localhost:3003/print', 'Cassa');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(store.printLog[0].printType).toBe('pre_bill');
  });
});

// ---------------------------------------------------------------------------
// reprintJob()
// ---------------------------------------------------------------------------

describe('reprintJob()', () => {
  it('re-sends the original job payload to the same url', async () => {
    const entry = {
      logId: 'plog_1',
      jobId: 'job_orig',
      printerId: 'cucina',
      printerName: 'Cucina',
      printerUrl: 'http://localhost:3001/print',
      printType: 'order',
      table: '05',
      timestamp: new Date().toISOString(),
      payload: { jobId: 'job_orig', printType: 'order', table: '05', items: [] },
    };
    reprintJob(entry);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3001/print');
    const body = JSON.parse(opts.body);
    expect(body.reprinted).toBe(true);
    expect(body.jobId).toMatch(/^job_/);
    expect(body.jobId).not.toBe('job_orig'); // new jobId
  });

  it('sends to override url when provided', async () => {
    const entry = {
      logId: 'plog_2',
      jobId: 'job_orig',
      printerId: 'cucina',
      printerName: 'Cucina',
      printerUrl: 'http://localhost:3001/print',
      printType: 'order',
      table: '05',
      timestamp: new Date().toISOString(),
      payload: { jobId: 'job_orig', printType: 'order', table: '05', items: [] },
    };
    reprintJob(entry, 'http://localhost:3002/print');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3002/print');
  });

  it('does nothing when both printerUrl and overrideUrl are absent', () => {
    reprintJob({ logId: 'x', printerUrl: null, payload: {} });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs the reprint with isReprint=true and originalJobId', async () => {
    const store = useAppStore();
    const entry = {
      logId: 'plog_3',
      jobId: 'job_orig',
      printerId: 'cucina',
      printerName: 'Cucina',
      printerUrl: 'http://localhost:3001/print',
      printType: 'order',
      table: '05',
      timestamp: new Date().toISOString(),
      payload: { jobId: 'job_orig', printType: 'order', table: '05', items: [] },
    };
    reprintJob(entry);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(store.printLog[0].isReprint).toBe(true);
    expect(store.printLog[0].originalJobId).toBe('job_orig');
  });
});

// ---------------------------------------------------------------------------
// TCP/file printer routing
// Printers with connectionType='tcp' or 'file' have no browser-accessible URL.
// enqueuePrintJobs and enqueueTableMoveJob must still enqueue a print_jobs
// CREATE entry (Directus route) without making any HTTP fetch call.
// ---------------------------------------------------------------------------

/** Printer config for a TCP-only printer (no URL — print-server handles printing). */
const TCP_PRINTER = [
  { id: 'cucina_tcp', name: 'Cucina TCP', connectionType: 'tcp', printTypes: ['order'] },
];

/** Printer config for a file-device printer. */
const FILE_PRINTER = [
  { id: 'cucina_file', name: 'Cucina File', connectionType: 'file' },
];

describe('TCP/file printer routing (Directus print-server path)', () => {
  it('enqueuePrintJobs enqueues a print_jobs CREATE for a TCP printer without sending HTTP', async () => {
    appConfig.printers = TCP_PRINTER;
    enqueuePrintJobs(makeOrder({ id: 'ord_tcp_1', table: 'T1' }));

    // No HTTP call should have been made
    expect(fetchMock).not.toHaveBeenCalled();

    // But a sync-queue CREATE entry must exist
    let createEntry;
    await vi.waitFor(async () => {
      const entries = await getPendingEntries();
      createEntry = entries.find(
        e => e.collection === 'print_jobs' && e.operation === 'create' && e.payload.table === 'T1',
      );
      expect(createEntry).toBeDefined();
    });

    expect(createEntry.payload.printType).toBe('order');
    expect(createEntry.payload.printerId).toBe('cucina_tcp');
    expect(createEntry.payload.payload?.orderId).toBe('ord_tcp_1');

    // Log entry status must transition from 'pending' to 'queued'
    const store = useAppStore();
    await vi.waitFor(() => {
      const entry = store.printLog.find(e => e.table === 'T1');
      expect(entry?.status).toBe('queued');
    });
  });

  it('enqueuePrintJobs enqueues a print_jobs CREATE for a file printer without sending HTTP', async () => {
    appConfig.printers = FILE_PRINTER;
    enqueuePrintJobs(makeOrder({ id: 'ord_file_1', table: 'F1' }));

    expect(fetchMock).not.toHaveBeenCalled();

    await vi.waitFor(async () => {
      const entries = await getPendingEntries();
      const entry = entries.find(
        e => e.collection === 'print_jobs' && e.operation === 'create' && e.payload.table === 'F1',
      );
      expect(entry).toBeDefined();
    });

    const store = useAppStore();
    await vi.waitFor(() => {
      const entry = store.printLog.find(e => e.table === 'F1');
      expect(entry?.status).toBe('queued');
    });
  });

  it('enqueuePrintJobs does nothing when a printer has neither url nor connectionType', () => {
    appConfig.printers = [{ id: 'ghost', name: 'Ghost' }]; // no url, no connectionType
    enqueuePrintJobs(makeOrder());
    expect(fetchMock).not.toHaveBeenCalled();
    // No sync-queue entry should be created synchronously
    const store = useAppStore();
    expect(store.printLog).toHaveLength(0);
  });

  it('connectionType is normalized: uppercase TCP is accepted and sets queued status', async () => {
    // Simulate Directus returning 'TCP' (uppercase) — mapper normalizes to 'tcp'
    appConfig.printers = [
      { id: 'cucina_tcp_upper', name: 'Cucina TCP', connectionType: 'TCP', printTypes: ['order'] },
    ];
    enqueuePrintJobs(makeOrder({ id: 'ord_norm_1', table: 'N1' }));

    expect(fetchMock).not.toHaveBeenCalled();

    const store = useAppStore();
    await vi.waitFor(() => {
      const entry = store.printLog.find(e => e.table === 'N1');
      expect(entry?.status).toBe('queued');
    });
  });

  it('enqueueTableMoveJob enqueues a print_jobs CREATE for a TCP printer without HTTP', async () => {
    appConfig.printers = [
      { id: 'cassa_tcp', name: 'Cassa TCP', connectionType: 'tcp', printTypes: ['table_move'] },
    ];
    enqueueTableMoveJob('T1', 'Uno', 'T2', 'Due');

    expect(fetchMock).not.toHaveBeenCalled();

    await vi.waitFor(async () => {
      const entries = await getPendingEntries();
      const entry = entries.find(
        e => e.collection === 'print_jobs' && e.operation === 'create' && e.payload.printType === 'table_move',
      );
      expect(entry).toBeDefined();
    });

    const store = useAppStore();
    await vi.waitFor(() => {
      const entry = store.printLog.find(e => e.printType === 'table_move');
      expect(entry?.status).toBe('queued');
    });
  });

  it('mixed config: TCP printer enqueues to Directus; HTTP printer also sends HTTP', async () => {
    appConfig.printers = [
      { id: 'cucina_tcp', name: 'Cucina TCP', connectionType: 'tcp', printTypes: ['order'] },
      { id: 'bar_http', name: 'Bar HTTP', url: 'http://localhost:3002/print', printTypes: ['order'] },
    ];
    enqueuePrintJobs(makeOrder({ id: 'ord_mixed_1', table: 'M1' }));

    // Only the HTTP printer triggers a fetch
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3002/print');

    // Both printers must have created sync-queue entries
    await vi.waitFor(async () => {
      const entries = await getPendingEntries();
      const creates = entries.filter(e => e.collection === 'print_jobs' && e.operation === 'create');
      expect(creates).toHaveLength(2);
    });

    // TCP entry must be 'queued'; HTTP entry must eventually be 'done'
    const store = useAppStore();
    await vi.waitFor(() => {
      const tcpEntry = store.printLog.find(e => e.printerId === 'cucina_tcp');
      expect(tcpEntry?.status).toBe('queued');
    });
  });
});

// ---------------------------------------------------------------------------
// Sync queue integration
// Verify that print-queue operations enqueue the correct print_jobs entries
// in the IDB sync queue (addPrintLogEntry → CREATE, updatePrintLogEntry → UPDATE).
// ---------------------------------------------------------------------------

describe('sync queue integration', () => {
  it('enqueuePrintJobs adds a print_jobs CREATE entry with the correct payload', async () => {
    appConfig.printers = CATCHALL_PRINTER;
    enqueuePrintJobs(makeOrder({ id: 'ord_sq_1', table: '09' }));

    let createEntry;
    await vi.waitFor(async () => {
      const entries = await getPendingEntries();
      // payload.table is the top-level table field on the log entry; payload.payload.orderId
      // is nested inside the print-job payload — filter on both to uniquely identify the entry
      createEntry = entries.find(
        e => e.collection === 'print_jobs' && e.operation === 'create' && e.payload.table === '09',
      );
      expect(createEntry).toBeDefined();
    });

    expect(createEntry.payload.printType).toBe('order');
    expect(createEntry.payload.table).toBe('09');
    expect(createEntry.payload.payload?.orderId).toBe('ord_sq_1');
  });

  it('enqueuePrintJobs adds one CREATE entry per matched printer', async () => {
    appConfig.printers = TWO_PRINTERS;
    enqueuePrintJobs(makeOrder({ id: 'ord_sq_2' }));

    await vi.waitFor(async () => {
      const entries = await getPendingEntries();
      const creates = entries.filter(e => e.collection === 'print_jobs' && e.operation === 'create');
      expect(creates).toHaveLength(2);
    });
  });

  it('status updates (printing → done) add print_jobs UPDATE entries', async () => {
    appConfig.printers = CATCHALL_PRINTER;
    const store = useAppStore();
    enqueuePrintJobs(makeOrder({ id: 'ord_sq_3' }));

    // Wait for the job to reach 'done' so all updatePrintLogEntry calls have fired
    await vi.waitFor(() => expect(store.printLog[0]?.status).toBe('done'));

    await vi.waitFor(async () => {
      const entries = await getPendingEntries();
      const updates = entries.filter(e => e.collection === 'print_jobs' && e.operation === 'update');
      // At minimum: printing + done = 2 UPDATE entries for the single job
      expect(updates.length).toBeGreaterThanOrEqual(2);
    });

    const entries = await getPendingEntries();
    const updates = entries.filter(e => e.collection === 'print_jobs' && e.operation === 'update');
    const statuses = updates.map(e => e.payload.status);
    expect(statuses).toContain('printing');
    expect(statuses).toContain('done');
  });

  it('enqueueTableMoveJob adds a print_jobs CREATE entry with printType=table_move', async () => {
    appConfig.printers = [
      { id: 'cassa', name: 'Cassa', url: 'http://localhost:3003/print', printTypes: ['table_move'] },
    ];
    enqueueTableMoveJob('T1', 'Uno', 'T2', 'Due');

    let createEntry;
    await vi.waitFor(async () => {
      const entries = await getPendingEntries();
      createEntry = entries.find(e => e.collection === 'print_jobs' && e.operation === 'create');
      expect(createEntry).toBeDefined();
    });

    expect(createEntry.payload.printType).toBe('table_move');
  });

  it('enqueuePreBillJob adds a print_jobs CREATE entry with printType=pre_bill', async () => {
    enqueuePreBillJob({ table: '05' }, 'http://localhost:3003/print', 'Cassa');

    let createEntry;
    await vi.waitFor(async () => {
      const entries = await getPendingEntries();
      createEntry = entries.find(e => e.collection === 'print_jobs' && e.operation === 'create');
      expect(createEntry).toBeDefined();
    });

    expect(createEntry.payload.printType).toBe('pre_bill');
  });

  it('reprintJob adds a print_jobs CREATE entry with isReprint=true and originalJobId', async () => {
    const entry = {
      logId: 'plog_sq_1',
      jobId: 'job_sq_orig',
      id: 'uuid-sq-orig',
      printerId: 'cucina',
      printerName: 'Cucina',
      printerUrl: 'http://localhost:3001/print',
      printType: 'order',
      table: '05',
      timestamp: new Date().toISOString(),
      payload: { jobId: 'job_sq_orig', printType: 'order', table: '05', items: [] },
    };
    reprintJob(entry);

    let createEntry;
    await vi.waitFor(async () => {
      const entries = await getPendingEntries();
      createEntry = entries.find(
        e => e.collection === 'print_jobs' && e.operation === 'create' && e.payload.isReprint === true,
      );
      expect(createEntry).toBeDefined();
    });

    expect(createEntry.payload.isReprint).toBe(true);
    expect(createEntry.payload.originalJobId).toBe('job_sq_orig');
  });
});
