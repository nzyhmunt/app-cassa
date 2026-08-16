/**
 * @file composables/__tests__/useFiscalPrint.test.js
 * @description Unit test per il composable useFiscalPrint: dispatch di scontrino
 * fiscale, Z report e gestione errori, con store e fetch mockati.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetIDBSingleton } from '../useIDB.js';
import { getSyncLogs } from '../../store/persistence/syncLogs.js';

// Mock the store so useAppStore returns a stub with fiscalReceipts + mutators.
const storeStub = {
  configHydrated: true,
  config: {
    printers: [
      { id: 'demo', url: 'http://localhost:3001/print' },
      { id: 'fiscale', connectionType: 'fpmate', url: 'http://localhost:3001/print', printTypes: ['fiscal_receipt'] },
    ],
  },
  fiscalReceipts: { value: [] },
  addFiscalReceipt: vi.fn((entry) => { storeStub.fiscalReceipts.value.unshift(entry); }),
  updateFiscalReceipt: vi.fn((id, updates) => {
    const idx = storeStub.fiscalReceipts.value.findIndex((e) => e.id === id);
    if (idx !== -1) storeStub.fiscalReceipts.value[idx] = { ...storeStub.fiscalReceipts.value[idx], ...updates };
  }),
};

vi.mock('../../store/index.js', () => ({
  useAppStore: () => storeStub,
}));

const ORIGINAL_FETCH = global.fetch;

beforeEach(async () => {
  await _resetIDBSingleton();
  vi.restoreAllMocks();
  global.fetch = vi.fn();
  storeStub.fiscalReceipts.value = [];
  storeStub.addFiscalReceipt.mockClear();
  storeStub.updateFiscalReceipt.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  global.fetch = ORIGINAL_FETCH;
});

const baseBill = {
  orders: [{ items: [{ name: 'Panino', quantity: 2, unitPrice: 6.5 }] }],
  paymentMethods: ['Contanti'],
  totalAmount: 13,
};

describe('dispatchFiscalReceipt', () => {
  it('sends a fiscal_receipt job and stores the receipt number on success', async () => {
    const { dispatchFiscalReceipt } = await import('../useFiscalPrint.js');
    // Pre-populate the store with the pending entry, mirroring the real flow
    // where the component adds the pending entry before dispatching.
    storeStub.fiscalReceipts.value = [{ id: 'rec-1', status: 'pending', ...baseBill }];
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        ok: true,
        fiscal: {
          success: true, code: '', status: '2',
          raw: '<response/>',
          addInfo: { fiscalReceiptNumber: '5', fiscalReceiptAmount: '13,00', serialNumber: '99IEB004001' },
        },
      }),
    });

    const result = await dispatchFiscalReceipt({ base: baseBill, entry: { id: 'rec-1', timestamp: '2024-01-01T00:00:00Z' } });
    expect(result.ok).toBe(true);

    // The HTTP request body must carry the fiscal printType and printerId.
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, init] = global.fetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.printType).toBe('fiscal_receipt');
    expect(body.printerId).toBe('fiscale');
    expect(body.payments).toEqual([{ label: 'Contanti', amount: 13 }]);
    expect(body.orders).toEqual(baseBill.orders);

    // Existing pending entry (id rec-1) must be updated, not duplicated.
    expect(storeStub.updateFiscalReceipt).toHaveBeenCalledWith('rec-1', expect.objectContaining({
      fiscalReceiptNumber: '5',
      serialNumber: '99IEB004001',
      status: 'done',
    }));
    expect(storeStub.addFiscalReceipt).not.toHaveBeenCalled();
  });

  it('adds a new entry when no existing entry id matches', async () => {
    const { dispatchFiscalReceipt } = await import('../useFiscalPrint.js');
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        ok: true,
        fiscal: { success: true, code: '', status: '2', raw: '<r/>', addInfo: { fiscalReceiptNumber: '7' } },
      }),
    });

    const result = await dispatchFiscalReceipt({ base: baseBill });
    expect(result.ok).toBe(true);
    expect(storeStub.addFiscalReceipt).toHaveBeenCalledTimes(1);
    expect(storeStub.addFiscalReceipt.mock.calls[0][0]).toMatchObject({
      fiscalReceiptNumber: '7',
      status: 'done',
    });
  });

  it('returns an error when the print-server reports failure', async () => {
    const { dispatchFiscalReceipt } = await import('../useFiscalPrint.js');
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: false, error: 'Errore stampante fiscale: timeout' }),
    });

    const result = await dispatchFiscalReceipt({ base: baseBill });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('timeout');
    expect(storeStub.addFiscalReceipt).not.toHaveBeenCalled();
  });

  it('returns an error when no fiscal printer is configured', async () => {
    const { dispatchFiscalReceipt } = await import('../useFiscalPrint.js');
    const savedPrinters = storeStub.config.printers;
    storeStub.config.printers = [{ id: 'demo', url: 'http://localhost:3001/print' }];
    const result = await dispatchFiscalReceipt({ base: baseBill });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/nessuna stampante fiscale/i);
    storeStub.config.printers = savedPrinters;
  });

  it('writes a FISCAL activity log entry on dispatch', async () => {
    const { dispatchFiscalReceipt } = await import('../useFiscalPrint.js');
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, fiscal: { success: true, code: '', status: '2', raw: '', addInfo: {} } }),
    });
    await dispatchFiscalReceipt({ base: baseBill });
    await new Promise((r) => setTimeout(r, 0));
    const logs = await getSyncLogs();
    expect(logs.find((l) => l.type === 'FISCAL' && l.operation === 'fiscal_receipt')).toBeTruthy();
  });

  it('collapses multiple payment methods into a single payment to avoid overpaying', async () => {
    const { dispatchFiscalReceipt } = await import('../useFiscalPrint.js');
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, fiscal: { success: true, code: '', status: '2', raw: '', addInfo: {} } }),
    });
    const multiBill = { ...baseBill, paymentMethods: ['Contanti', 'Carta'], totalAmount: 20 };
    await dispatchFiscalReceipt({ base: multiBill });
    const [, init] = global.fetch.mock.calls[0];
    const body = JSON.parse(init.body);
    // One payment covering the whole total, not one-per-label summing to N×total.
    expect(body.payments).toEqual([{ label: 'Contanti + Carta', amount: 20 }]);
  });
});

describe('dispatchFiscalZReport / dispatchFiscalStatus', () => {
  it('sends a fiscal_z_report job', async () => {
    const { dispatchFiscalZReport } = await import('../useFiscalPrint.js');
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        ok: true,
        fiscal: { success: true, code: '', status: '2', raw: '', addInfo: { zRepNumber: '11', dailyAmount: '332,33' } },
      }),
    });
    const result = await dispatchFiscalZReport({});
    expect(result.ok).toBe(true);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.printType).toBe('fiscal_z_report');
    expect(body.printerId).toBe('fiscale');
  });

  it('sends a fiscal_status job with statusType', async () => {
    const { dispatchFiscalStatus } = await import('../useFiscalPrint.js');
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        ok: true,
        fiscal: { success: true, code: '', status: '2', raw: '', addInfo: { fpStatus: '20010' } },
      }),
    });
    const result = await dispatchFiscalStatus({ statusType: '1' });
    expect(result.ok).toBe(true);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.printType).toBe('fiscal_status');
    expect(body.statusType).toBe('1');
  });
});

// ── Void / Refund / Duplicate / Drawer / Cash ────────────────────────────────

describe('dispatchFiscalVoid', () => {
  it('sends a fiscal_void job carrying the receipt references', async () => {
    const { dispatchFiscalVoid } = await import('../useFiscalPrint.js');
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, fiscal: { success: true, code: '', status: '2', raw: '', addInfo: {} } }),
    });
    const receiptRef = { zRepNumber: '39', fiscalReceiptNumber: '5', date: '31/01/2024', serialNumber: '99IEB004001' };
    const result = await dispatchFiscalVoid({ receiptRef });
    expect(result.ok).toBe(true);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.printType).toBe('fiscal_void');
    expect(body.receiptRef).toEqual(receiptRef);
    expect(body.printerId).toBe('fiscale');
  });

  it('fails locally when receipt references are missing', async () => {
    const { dispatchFiscalVoid } = await import('../useFiscalPrint.js');
    const result = await dispatchFiscalVoid({ receiptRef: {} });
    expect(result.ok).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('dispatchFiscalRefund', () => {
  it('sends a fiscal_refund job with orders and payments', async () => {
    const { dispatchFiscalRefund } = await import('../useFiscalPrint.js');
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, fiscal: { success: true, code: '', status: '2', raw: '', addInfo: {} } }),
    });
    const result = await dispatchFiscalRefund({ base: baseBill });
    expect(result.ok).toBe(true);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.printType).toBe('fiscal_refund');
    expect(body.orders).toEqual(baseBill.orders);
    expect(body.payments[0].label).toBe('Contanti');
  });

  it('falls back to a single CONTANTI payment when paymentMethods is empty', async () => {
    const { dispatchFiscalRefund } = await import('../useFiscalPrint.js');
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, fiscal: { success: true, code: '', status: '2', raw: '', addInfo: {} } }),
    });
    await dispatchFiscalRefund({ base: { orders: baseBill.orders, totalAmount: 13 } });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.payments).toHaveLength(1);
    expect(body.payments[0].label).toBe('CONTANTI');
  });
});

describe('dispatchFiscalDuplicate / dispatchFiscalOpenDrawer', () => {
  it('sends a fiscal_duplicate job', async () => {
    const { dispatchFiscalDuplicate } = await import('../useFiscalPrint.js');
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, fiscal: { success: true, code: '', status: '2', raw: '', addInfo: {} } }),
    });
    const result = await dispatchFiscalDuplicate({});
    expect(result.ok).toBe(true);
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).printType).toBe('fiscal_duplicate');
  });

  it('sends a fiscal_drawer job', async () => {
    const { dispatchFiscalOpenDrawer } = await import('../useFiscalPrint.js');
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, fiscal: { success: true, code: '', status: '2', raw: '', addInfo: {} } }),
    });
    const result = await dispatchFiscalOpenDrawer({});
    expect(result.ok).toBe(true);
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).printType).toBe('fiscal_drawer');
  });
});

describe('dispatchFiscalCash', () => {
  it('sends a fiscal_cash job with direction and amount', async () => {
    const { dispatchFiscalCash } = await import('../useFiscalPrint.js');
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, fiscal: { success: true, code: '', status: '2', raw: '', addInfo: {} } }),
    });
    const result = await dispatchFiscalCash({ direction: 'out', amount: 50 });
    expect(result.ok).toBe(true);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.printType).toBe('fiscal_cash');
    expect(body.direction).toBe('out');
    expect(body.amount).toBe(50);
    expect(body.form).toBe('cash');
  });

  it('rejects an invalid direction locally', async () => {
    const { dispatchFiscalCash } = await import('../useFiscalPrint.js');
    const result = await dispatchFiscalCash({ direction: 'sideways', amount: 50 });
    expect(result.ok).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects a non-positive amount locally', async () => {
    const { dispatchFiscalCash } = await import('../useFiscalPrint.js');
    const result = await dispatchFiscalCash({ direction: 'in', amount: 0 });
    expect(result.ok).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
