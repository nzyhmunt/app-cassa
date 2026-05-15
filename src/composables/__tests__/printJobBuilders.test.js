import { describe, it, expect } from 'vitest';
import {
  buildOrderJobItems,
  buildOrderPrintJob,
  buildPreBillPrintJob,
  buildReprintPrintJob,
  buildTableMovePrintJob,
  createPrintLogEntry,
} from '../printJobBuilders.js';

describe('buildOrderJobItems()', () => {
  it('filters by normalized category and excludes fully voided rows', () => {
    const items = buildOrderJobItems({
      orderItems: [
        {
          dishId: 'ant_1',
          name: 'Bruschetta',
          quantity: 2,
          voidedQuantity: 0,
          unitPrice: 3,
          notes: ['Senza aglio'],
          course: 'prima',
          modifiers: [{ name: 'Extra', price: 1, voidedQuantity: 0 }],
        },
        {
          dishId: 'bev_1',
          name: 'Acqua',
          quantity: 1,
          voidedQuantity: 0,
          unitPrice: 1,
          modifiers: [],
        },
        {
          dishId: 'ant_2',
          name: 'Focaccia',
          quantity: 1,
          voidedQuantity: 1,
          unitPrice: 2,
        },
      ],
      printerCategories: ['antipasti'],
      dishCategoryMap: new Map([
        ['ant_1', 'Antipasti'],
        ['bev_1', 'Bevande'],
        ['ant_2', 'Antipasti'],
      ]),
    });

    expect(items).toEqual([
      {
        name: 'Bruschetta',
        quantity: 2,
        unitPrice: 3,
        notes: ['Senza aglio'],
        course: 'prima',
        modifiers: [{ name: 'Extra', price: 1 }],
      },
    ]);
  });

  it('treats empty printer categories as catch-all', () => {
    const items = buildOrderJobItems({
      orderItems: [{ dishId: 'bev_1', name: 'Acqua', quantity: 1, voidedQuantity: 0 }],
      printerCategories: [],
      dishCategoryMap: new Map([['bev_1', 'Bevande']]),
    });

    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Acqua');
  });
});

describe('print job builders', () => {
  it('buildOrderPrintJob creates the shared order payload contract', () => {
    const job = buildOrderPrintJob({
      order: { id: 'ord_1', table: 'T1', time: '12:30', globalNote: 'Subito' },
      printerId: 'cucina',
      items: [{ name: 'Bruschetta', quantity: 1 }],
      timestamp: '2026-05-15T12:00:00.000Z',
    });

    expect(job).toMatchObject({
      printType: 'order',
      printerId: 'cucina',
      orderId: 'ord_1',
      table: 'T1',
      time: '12:30',
      globalNote: 'Subito',
      timestamp: '2026-05-15T12:00:00.000Z',
      items: [{ name: 'Bruschetta', quantity: 1 }],
    });
    expect(job.jobId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('buildTableMovePrintJob creates the shared table_move payload contract', () => {
    const job = buildTableMovePrintJob({
      printerId: 'cassa',
      fromTableId: 'T1',
      fromTableLabel: '01',
      toTableId: 'T2',
      toTableLabel: '02',
      timestamp: '2026-05-15T12:01:00.000Z',
    });

    expect(job).toMatchObject({
      printType: 'table_move',
      printerId: 'cassa',
      fromTableId: 'T1',
      fromTableLabel: '01',
      toTableId: 'T2',
      toTableLabel: '02',
      table: '01 → 02',
      timestamp: '2026-05-15T12:01:00.000Z',
    });
  });

  it('buildPreBillPrintJob creates the shared pre_bill payload contract', () => {
    const job = buildPreBillPrintJob({
      payload: { table: '05', grossAmount: 42 },
      printerId: 'prebill_http',
      timestamp: '2026-05-15T12:02:00.000Z',
    });

    expect(job).toMatchObject({
      printType: 'pre_bill',
      printerId: 'prebill_http',
      table: '05',
      grossAmount: 42,
      timestamp: '2026-05-15T12:02:00.000Z',
    });
  });

  it('buildReprintPrintJob keeps the original payload and stamps reprint metadata', () => {
    const job = buildReprintPrintJob({
      payload: { printType: 'order', table: '05', items: [] },
      printerId: 'cucina',
      printerName: 'Cucina',
      printerUrl: 'http://localhost:3001/print',
      timestamp: '2026-05-15T12:03:00.000Z',
    });

    expect(job).toMatchObject({
      printType: 'order',
      table: '05',
      printerId: 'cucina',
      printerName: 'Cucina',
      printerUrl: 'http://localhost:3001/print',
      reprinted: true,
      timestamp: '2026-05-15T12:03:00.000Z',
    });
    expect(job.jobId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('createPrintLogEntry()', () => {
  it('applies field overrides and extra fields without mutating the payload contract', () => {
    const entry = createPrintLogEntry({
      job: {
        jobId: 'job_1',
        printType: 'pre_bill',
        printerId: 'p1',
        table: '05',
        timestamp: '2026-05-15T12:04:00.000Z',
      },
      printer: { id: 'p1', name: 'Cassa', url: 'http://localhost:3003/print' },
      logId: 'plog_1',
      fieldOverrides: {
        printerName: 'Cassa override',
        printerUrl: null,
        table: 'Cinque',
      },
      extraFields: {
        isReprint: true,
        originalJobId: 'job_orig',
      },
    });

    expect(entry).toMatchObject({
      logId: 'plog_1',
      jobId: 'job_1',
      printerId: 'p1',
      printerName: 'Cassa override',
      printerUrl: null,
      printType: 'pre_bill',
      table: 'Cinque',
      timestamp: '2026-05-15T12:04:00.000Z',
      isReprint: true,
      originalJobId: 'job_orig',
    });
    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(entry.payload).toMatchObject({
      jobId: 'job_1',
      printType: 'pre_bill',
      printerId: 'p1',
    });
  });
});
