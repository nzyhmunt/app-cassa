/**
 * @file utils/__tests__/mappers.test.js
 * @description Unit tests for pull-side mapper functions in utils/mappers.js.
 */
import { describe, it, expect } from 'vitest';
import { mapTransactionFromDirectus, mapPrintJobToDirectus, mapPayloadToDirectus, mapFiscalReceiptFromDirectus, mapInvoiceRequestFromDirectus } from '../mappers.js';
import { resolveTransactionPaymentLabel } from '../paymentMethods.js';

// ─────────────────────────────────────────────────────────────────────────────
// mapTransactionFromDirectus
// ─────────────────────────────────────────────────────────────────────────────
describe('mapTransactionFromDirectus()', () => {
  it('maps snake_case Directus fields to camelCase aliases', () => {
    const raw = {
      id: 'txn-1',
      amount_paid: '12.50',
      tip_amount: '1.00',
      operation_type: 'unico',
      payment_method: 'pm-uuid-1',
      romana_split_count: '2',
      split_quota: '1',
      split_ways: '3',
      discount_type: 'percent',
      discount_value: '10',
      date_created: '2024-01-15T12:00:00Z',
    };

    const result = mapTransactionFromDirectus(raw);

    expect(result.amountPaid).toBe(12.5);
    expect(result.tipAmount).toBe(1);
    expect(result.operationType).toBe('unico');
    expect(result.paymentMethodId).toBe('pm-uuid-1');
    expect(result.romanaSplitCount).toBe(2);
    expect(result.splitQuota).toBe(1);
    expect(result.splitWays).toBe(3);
    expect(result.discountType).toBe('percent');
    expect(result.discountValue).toBe(10);
    expect(result.timestamp).toBe('2024-01-15T12:00:00Z');
  });

  it('coerces numeric fields from strings to numbers', () => {
    const raw = {
      amount_paid: '99.99',
      tip_amount: '5.00',
      split_quota: '3',
      split_ways: '4',
      romana_split_count: '2',
      discount_value: '15.5',
    };

    const result = mapTransactionFromDirectus(raw);

    expect(result.amountPaid).toBeCloseTo(99.99);
    expect(result.tipAmount).toBe(5);
    expect(result.splitQuota).toBe(3);
    expect(result.splitWays).toBe(4);
    expect(result.romanaSplitCount).toBe(2);
    expect(result.discountValue).toBeCloseTo(15.5);
  });

  it('handles already-camelCase fields (locally-created transactions round-tripping through IDB)', () => {
    const raw = {
      id: 'txn-2',
      amountPaid: 10,
      tipAmount: 0.5,
      operationType: 'romana',
      paymentMethodId: 'pm-abc',
      splitQuota: 2,
      splitWays: 3,
      romanaSplitCount: 1,
      timestamp: '2024-01-15T11:00:00Z',
    };

    const result = mapTransactionFromDirectus(raw);

    expect(result.amountPaid).toBe(10);
    expect(result.tipAmount).toBe(0.5);
    expect(result.operationType).toBe('romana');
    expect(result.paymentMethodId).toBe('pm-abc');
    expect(result.splitQuota).toBe(2);
    expect(result.splitWays).toBe(3);
    expect(result.romanaSplitCount).toBe(1);
    // Local timestamp should be preserved (not overwritten by date_created)
    expect(result.timestamp).toBe('2024-01-15T11:00:00Z');
  });

  it('normalises FK relation objects to scalar IDs (table, bill_session, payment_method)', () => {
    const raw = {
      id: 'txn-3',
      table: { id: 'table-uuid', label: 'Table 1' },
      bill_session: { id: 'session-uuid', status: 'open' },
      payment_method: { id: 'pm-uuid-2', name: 'Card' },
      amount_paid: '20.00',
    };

    const result = mapTransactionFromDirectus(raw);

    expect(result.table).toBe('table-uuid');
    expect(result.bill_session).toBe('session-uuid');
    expect(result.payment_method).toBe('pm-uuid-2');
    expect(result.paymentMethodId).toBe('pm-uuid-2');
  });

  it('keeps scalar FK values unchanged', () => {
    const raw = {
      table: 'table-uuid',
      bill_session: 'session-uuid',
      payment_method: 'pm-uuid',
      amount_paid: 5,
    };

    const result = mapTransactionFromDirectus(raw);

    expect(result.table).toBe('table-uuid');
    expect(result.bill_session).toBe('session-uuid');
    expect(result.payment_method).toBe('pm-uuid');
    expect(result.paymentMethodId).toBe('pm-uuid');
  });

  it('falls back to date_created for timestamp when timestamp is absent', () => {
    const raw = { amount_paid: 1, date_created: '2024-06-01T09:00:00Z' };
    const result = mapTransactionFromDirectus(raw);
    expect(result.timestamp).toBe('2024-06-01T09:00:00Z');
  });

  it('preserves existing timestamp when both timestamp and date_created are present', () => {
    const raw = {
      amount_paid: 1,
      timestamp: '2024-05-01T08:00:00Z',
      date_created: '2024-06-01T09:00:00Z',
    };
    const result = mapTransactionFromDirectus(raw);
    expect(result.timestamp).toBe('2024-05-01T08:00:00Z');
  });

  it('leaves optional numeric fields undefined when absent', () => {
    const raw = { id: 'txn-4', amount_paid: 5 };
    const result = mapTransactionFromDirectus(raw);
    expect(result.tipAmount).toBeUndefined();
    expect(result.romanaSplitCount).toBeUndefined();
    expect(result.splitQuota).toBeUndefined();
    expect(result.splitWays).toBeUndefined();
    expect(result.discountValue).toBeUndefined();
  });

  it('sets _sync_status to "synced"', () => {
    const result = mapTransactionFromDirectus({ amount_paid: 1 });
    expect(result._sync_status).toBe('synced');
  });

  it('handles null/undefined input without throwing', () => {
    expect(() => mapTransactionFromDirectus(null)).not.toThrow();
    expect(() => mapTransactionFromDirectus(undefined)).not.toThrow();
    const result = mapTransactionFromDirectus(null);
    expect(result.amountPaid).toBe(0);
    expect(result._sync_status).toBe('synced');
  });

  it('falls back to 0 for amountPaid when value is non-numeric', () => {
    const raw = { amount_paid: 'not-a-number' };
    const result = mapTransactionFromDirectus(raw);
    expect(result.amountPaid).toBe(0);
  });

  it('sets paymentMethodId but not paymentMethod label', () => {
    const raw = { id: 'txn-5', amount_paid: 10, payment_method: 'pm-uuid', operation_type: 'unico' };
    const result = mapTransactionFromDirectus(raw);
    // paymentMethodId is set so consumers can resolve the label at render time;
    // paymentMethod itself must NOT be set by the mapper (it was stripped on push).
    expect(result.paymentMethodId).toBe('pm-uuid');
    expect(result.paymentMethod).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveTransactionPaymentLabel
// ─────────────────────────────────────────────────────────────────────────────
describe('resolveTransactionPaymentLabel()', () => {
  const methods = [
    { id: 'cash-id', label: 'Contanti', icon: 'banknote' },
    { id: 'card-id', label: 'Carta', icon: 'credit-card' },
  ];

  it('returns txn.paymentMethod when already set (originating device)', () => {
    expect(resolveTransactionPaymentLabel(methods, { paymentMethod: 'Contanti' })).toBe('Contanti');
  });

  it('resolves label from methods array via paymentMethodId', () => {
    expect(resolveTransactionPaymentLabel(methods, { paymentMethodId: 'card-id' })).toBe('Carta');
  });

  it('falls back to paymentMethodId string when id not in methods', () => {
    expect(resolveTransactionPaymentLabel(methods, { paymentMethodId: 'unknown-id' })).toBe('unknown-id');
  });

  it('returns "Mancia" for tip transactions with no paymentMethodId', () => {
    expect(resolveTransactionPaymentLabel(methods, { operationType: 'tip' })).toBe('Mancia');
  });

  it('returns "Sconto" for discount transactions with no paymentMethodId', () => {
    expect(resolveTransactionPaymentLabel(methods, { operationType: 'discount' })).toBe('Sconto');
  });

  it('returns empty string for unknown operationType with no paymentMethodId', () => {
    expect(resolveTransactionPaymentLabel(methods, { operationType: 'unknown' })).toBe('');
  });

  it('handles null/undefined txn gracefully', () => {
    expect(resolveTransactionPaymentLabel(methods, null)).toBe('');
    expect(resolveTransactionPaymentLabel(methods, undefined)).toBe('');
  });

  it('handles null/undefined methods array gracefully', () => {
    expect(resolveTransactionPaymentLabel(null, { paymentMethodId: 'x' })).toBe('x');
    expect(resolveTransactionPaymentLabel(undefined, { paymentMethodId: 'x' })).toBe('x');
  });

  it('trims whitespace from paymentMethodId before lookup (consistent with resolvePaymentMethodMeta)', () => {
    expect(resolveTransactionPaymentLabel(methods, { paymentMethodId: '  card-id  ' })).toBe('Carta');
  });

  it('falls back to trimmed id string when id with whitespace is not in methods', () => {
    expect(resolveTransactionPaymentLabel(methods, { paymentMethodId: '  unknown-id  ' })).toBe('unknown-id');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mapPrintJobToDirectus
// ─────────────────────────────────────────────────────────────────────────────
describe('mapPrintJobToDirectus()', () => {
  it('maps a basic order job to Directus field names', () => {
    const record = {
      id: 'job-uuid-1',
      printType: 'order',
      printerId: 'cucina',
      table: '05',
      status: 'pending',
      payload: { jobId: 'job_abc', printType: 'order' },
    };
    const original = { ...record, timestamp: '2024-01-15T12:00:00.000Z' };

    const result = mapPrintJobToDirectus(record, original);

    expect(result.print_type).toBe('order');
    expect(result.printer).toBe('cucina');
    expect(result.table_label).toBe('05');
    expect(result.job_timestamp).toBe('2024-01-15T12:00:00.000Z');
    // camelCase originals must be removed
    expect(result.printType).toBeUndefined();
    expect(result.printerId).toBeUndefined();
    expect(result.table).toBeUndefined();
  });

  it('drops local-only fields: logId, jobId, printerName, printerUrl', () => {
    const record = {
      id: 'job-uuid-2',
      logId: 'plog_123',
      jobId: 'job_abc',
      printerName: 'Cucina',
      printerUrl: 'http://localhost:3001/print',
      printType: 'order',
      status: 'pending',
    };

    const result = mapPrintJobToDirectus(record, record);

    expect(result.logId).toBeUndefined();
    expect(result.jobId).toBeUndefined();
    expect(result.printerName).toBeUndefined();
    expect(result.printerUrl).toBeUndefined();
  });

  it('maps table_move job', () => {
    const record = {
      id: 'job-uuid-3',
      printType: 'table_move',
      printerId: 'cassa',
      table: 'T1 → T2',
      status: 'pending',
    };
    const original = { ...record, timestamp: '2024-01-15T12:00:00.000Z' };

    const result = mapPrintJobToDirectus(record, original);

    expect(result.print_type).toBe('table_move');
    expect(result.printer).toBe('cassa');
    expect(result.table_label).toBe('T1 → T2');
    expect(result.job_timestamp).toBe('2024-01-15T12:00:00.000Z');
  });

  it('maps pre_bill job', () => {
    const record = {
      id: 'job-uuid-4',
      printType: 'pre_bill',
      printerId: 'cassa',
      table: '03',
      status: 'pending',
    };
    const original = { ...record, timestamp: '2024-03-01T18:00:00.000Z' };

    const result = mapPrintJobToDirectus(record, original);

    expect(result.print_type).toBe('pre_bill');
    expect(result.table_label).toBe('03');
    expect(result.printer).toBe('cassa');
  });

  it('copies originalJobId into payload.originalJobId for reprints and drops the top-level field', () => {
    const record = {
      id: 'job-uuid-5',
      printType: 'order',
      originalJobId: 'job_orig_abc',
      payload: { jobId: 'job_new', printType: 'order' },
    };

    const result = mapPrintJobToDirectus(record, record);

    expect(result.originalJobId).toBeUndefined();
    expect(result.payload.originalJobId).toBe('job_orig_abc');
    expect(result.payload.jobId).toBe('job_new'); // existing payload fields preserved
  });

  it('does not overwrite payload.originalJobId when it is already set', () => {
    const record = {
      id: 'job-uuid-6',
      printType: 'order',
      originalJobId: 'job_orig_abc',
      payload: { jobId: 'job_new', originalJobId: 'already_set' },
    };

    const result = mapPrintJobToDirectus(record, record);

    expect(result.payload.originalJobId).toBe('already_set');
  });

  it('maps errorMessage to error_message and isReprint to is_reprint', () => {
    const record = {
      id: 'job-uuid-7',
      printType: 'order',
      errorMessage: 'Printer offline',
      isReprint: true,
      status: 'error',
    };

    const result = mapPrintJobToDirectus(record, record);

    expect(result.error_message).toBe('Printer offline');
    expect(result.is_reprint).toBe(true);
    expect(result.errorMessage).toBeUndefined();
    expect(result.isReprint).toBeUndefined();
  });

  it('recovers job_timestamp from originalRecord.timestamp when record has it stripped', () => {
    // Simulates the _PUSH_DROP_FIELDS stripping: timestamp is absent from record
    const record = { id: 'job-uuid-8', printType: 'order', status: 'pending' };
    const original = { ...record, timestamp: '2024-03-10T09:30:00.000Z' };

    const result = mapPrintJobToDirectus(record, original);

    expect(result.job_timestamp).toBe('2024-03-10T09:30:00.000Z');
  });

  it('omits job_timestamp when originalRecord carries no timestamp', () => {
    const record = { id: 'job-uuid-9', printType: 'order', status: 'pending' };

    const result = mapPrintJobToDirectus(record, {});

    expect(result.job_timestamp).toBeUndefined();
  });

  it('does not overwrite an explicit job_timestamp already present in record', () => {
    const record = { id: 'job-uuid-10', printType: 'order', job_timestamp: '2024-01-01T00:00:00.000Z' };
    const original = { ...record, timestamp: '2024-06-06T06:00:00.000Z' };

    const result = mapPrintJobToDirectus(record, original);

    expect(result.job_timestamp).toBe('2024-01-01T00:00:00.000Z');
  });

  it('handles null/undefined input without throwing', () => {
    expect(() => mapPrintJobToDirectus(null)).not.toThrow();
    expect(() => mapPrintJobToDirectus(undefined)).not.toThrow();
    const result = mapPrintJobToDirectus(null, null);
    expect(result).toBeTypeOf('object');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mapPayloadToDirectus — print_jobs round-trip
// ─────────────────────────────────────────────────────────────────────────────
describe('mapPayloadToDirectus() — print_jobs round-trip', () => {
  it('strips timestamp, maps camelCase fields and recovers job_timestamp', () => {
    const payload = {
      id: 'job-rt-1',
      printType: 'order',
      printerId: 'cucina',
      table: '07',
      status: 'pending',
      timestamp: '2024-05-01T10:00:00.000Z',
      payload: { jobId: 'job_xyz', printType: 'order' },
    };

    const result = mapPayloadToDirectus('print_jobs', payload);

    expect(result.print_type).toBe('order');
    expect(result.printer).toBe('cucina');
    expect(result.table_label).toBe('07');
    expect(result.job_timestamp).toBe('2024-05-01T10:00:00.000Z');
    // timestamp was stripped by _PUSH_DROP_FIELDS; must not appear in output
    expect(result.timestamp).toBeUndefined();
    // local camelCase originals must be removed
    expect(result.printType).toBeUndefined();
    expect(result.printerId).toBeUndefined();
    expect(result.table).toBeUndefined();
  });

  it('strips _sync_status from print_jobs CREATE payload', () => {
    const payload = {
      id: 'job-rt-2',
      printType: 'order',
      status: 'pending',
      _sync_status: 'pending',
    };

    const result = mapPayloadToDirectus('print_jobs', payload);

    expect(result._sync_status).toBeUndefined();
    expect(result.status).toBe('pending');
  });

  it('maps sparse status-update payload (logId dropped, status preserved)', () => {
    const payload = {
      logId: 'plog_abc',
      status: 'done',
    };

    const result = mapPayloadToDirectus('print_jobs', payload);

    expect(result.status).toBe('done');
    expect(result.logId).toBeUndefined();
  });

  it('maps reprint payload with originalJobId into payload.originalJobId', () => {
    const payload = {
      id: 'job-rt-3',
      printType: 'order',
      originalJobId: 'job_orig_xyz',
      isReprint: true,
      timestamp: '2024-05-01T10:00:00.000Z',
      payload: { jobId: 'job_new', printType: 'order' },
    };

    const result = mapPayloadToDirectus('print_jobs', payload);

    expect(result.is_reprint).toBe(true);
    expect(result.originalJobId).toBeUndefined();
    expect(result.payload.originalJobId).toBe('job_orig_xyz');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mapFiscalReceiptFromDirectus
// ─────────────────────────────────────────────────────────────────────────────
describe('mapFiscalReceiptFromDirectus()', () => {
  it('maps all snake_case Directus fields to camelCase local format', () => {
    const raw = {
      id: 'fr-uuid-1',
      table: 'tbl-1',
      table_label: 'Tavolo 1',
      bill_session: 'bs-uuid-1',
      closed_at: '2024-03-10T12:00:00Z',
      total_amount: '55.00',
      total_paid: '60.00',
      payment_methods: JSON.stringify(['Contanti', 'Carta']),
      orders: JSON.stringify([{ name: 'Pizza', qty: 1, unitPrice: 10 }]),
      xml_request: '<request/>',
      xml_response: '<response/>',
      status: 'ok',
      timestamp: '2024-03-10T12:01:00Z',
      date_created: '2024-03-10T12:00:00Z',
      date_updated: '2024-03-10T12:01:00Z',
    };

    const result = mapFiscalReceiptFromDirectus(raw);

    expect(result.id).toBe('fr-uuid-1');
    expect(result.tableId).toBe('tbl-1');
    expect(result.tableLabel).toBe('Tavolo 1');
    expect(result.billSessionId).toBe('bs-uuid-1');
    expect(result.closedAt).toBe('2024-03-10T12:00:00Z');
    expect(result.totalAmount).toBe(55);
    expect(result.totalPaid).toBe(60);
    expect(result.paymentMethods).toEqual(['Contanti', 'Carta']);
    expect(result.orders).toEqual([{ name: 'Pizza', qty: 1, unitPrice: 10 }]);
    expect(result.xmlRequest).toBe('<request/>');
    expect(result.xmlResponse).toBe('<response/>');
    expect(result.status).toBe('ok');
    expect(result.timestamp).toBe('2024-03-10T12:01:00Z');
    expect(result.date_created).toBe('2024-03-10T12:00:00Z');
    expect(result.date_updated).toBe('2024-03-10T12:01:00Z');
  });

  it('resolves FK table/bill_session from nested relation objects', () => {
    const raw = {
      id: 'fr-uuid-2',
      table: { id: 'tbl-nested' },
      bill_session: { id: 'bs-nested' },
    };

    const result = mapFiscalReceiptFromDirectus(raw);

    expect(result.tableId).toBe('tbl-nested');
    expect(result.billSessionId).toBe('bs-nested');
  });

  it('parses payment_methods JSON string into an array', () => {
    const raw = { id: 'fr-uuid-3', payment_methods: '["Contanti"]' };
    const result = mapFiscalReceiptFromDirectus(raw);
    expect(Array.isArray(result.paymentMethods)).toBe(true);
    expect(result.paymentMethods).toEqual(['Contanti']);
  });

  it('returns [] for payment_methods when JSON is not an array', () => {
    const raw = { id: 'fr-uuid-4', payment_methods: '"solo-stringa"' };
    const result = mapFiscalReceiptFromDirectus(raw);
    expect(result.paymentMethods).toEqual([]);
  });

  it('passes through payment_methods when already an array', () => {
    const raw = { id: 'fr-uuid-5', payment_methods: ['Contanti', 'Carta'] };
    const result = mapFiscalReceiptFromDirectus(raw);
    expect(result.paymentMethods).toEqual(['Contanti', 'Carta']);
  });

  it('returns [] for orders when JSON is not an array', () => {
    const raw = { id: 'fr-uuid-6', orders: 'null' };
    const result = mapFiscalReceiptFromDirectus(raw);
    expect(result.orders).toEqual([]);
  });

  it('handles null/missing optional fields gracefully', () => {
    const raw = { id: 'fr-uuid-7', status: 'pending' };
    const result = mapFiscalReceiptFromDirectus(raw);
    expect(result.tableId).toBeUndefined();
    expect(result.billSessionId).toBeUndefined();
    expect(result.closedAt).toBeUndefined();
    expect(result.totalAmount).toBeUndefined();
    expect(result.paymentMethods).toBeUndefined();
    expect(result.orders).toBeUndefined();
  });

  it('returns the input unchanged for non-object values', () => {
    expect(mapFiscalReceiptFromDirectus(null)).toBe(null);
    expect(mapFiscalReceiptFromDirectus(undefined)).toBe(undefined);
    expect(mapFiscalReceiptFromDirectus('string')).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mapInvoiceRequestFromDirectus
// ─────────────────────────────────────────────────────────────────────────────
describe('mapInvoiceRequestFromDirectus()', () => {
  it('maps all snake_case Directus fields to camelCase local format', () => {
    const raw = {
      id: 'ir-uuid-1',
      table: 'tbl-1',
      table_label: 'Tavolo 1',
      bill_session: 'bs-uuid-1',
      closed_at: '2024-03-10T12:00:00Z',
      total_amount: '80.00',
      total_paid: '80.00',
      payment_methods: JSON.stringify(['Carta']),
      orders: JSON.stringify([{ name: 'Bistecca', qty: 2, unitPrice: 30 }]),
      denominazione: 'ACME Srl',
      codice_fiscale: 'ACMESRL12345',
      piva: 'IT12345678901',
      indirizzo: 'Via Roma 1',
      cap: '00100',
      comune: 'Roma',
      provincia: 'RM',
      paese: 'IT',
      codice_destinatario: 'ABC1234',
      pec: 'acme@pec.it',
      status: 'pending',
      timestamp: '2024-03-10T12:01:00Z',
      date_created: '2024-03-10T12:00:00Z',
      date_updated: '2024-03-10T12:01:00Z',
    };

    const result = mapInvoiceRequestFromDirectus(raw);

    expect(result.id).toBe('ir-uuid-1');
    expect(result.tableId).toBe('tbl-1');
    expect(result.tableLabel).toBe('Tavolo 1');
    expect(result.billSessionId).toBe('bs-uuid-1');
    expect(result.closedAt).toBe('2024-03-10T12:00:00Z');
    expect(result.totalAmount).toBe(80);
    expect(result.totalPaid).toBe(80);
    expect(result.paymentMethods).toEqual(['Carta']);
    expect(result.orders).toEqual([{ name: 'Bistecca', qty: 2, unitPrice: 30 }]);
    expect(result.status).toBe('pending');
    expect(result.timestamp).toBe('2024-03-10T12:01:00Z');
    expect(result.date_created).toBe('2024-03-10T12:00:00Z');
    expect(result.date_updated).toBe('2024-03-10T12:01:00Z');
  });

  it('reassembles billing data columns into a nested billingData object', () => {
    const raw = {
      id: 'ir-uuid-2',
      denominazione: 'ACME Srl',
      codice_fiscale: 'ACMESRL12345',
      piva: 'IT12345678901',
      indirizzo: 'Via Roma 1',
      cap: '00100',
      comune: 'Roma',
      provincia: 'RM',
      paese: 'IT',
      codice_destinatario: 'ABC1234',
      pec: 'acme@pec.it',
    };

    const result = mapInvoiceRequestFromDirectus(raw);

    expect(result.billingData).toBeDefined();
    expect(result.billingData.denominazione).toBe('ACME Srl');
    expect(result.billingData.codiceFiscale).toBe('ACMESRL12345');
    expect(result.billingData.piva).toBe('IT12345678901');
    expect(result.billingData.indirizzo).toBe('Via Roma 1');
    expect(result.billingData.cap).toBe('00100');
    expect(result.billingData.comune).toBe('Roma');
    expect(result.billingData.provincia).toBe('RM');
    expect(result.billingData.paese).toBe('IT');
    expect(result.billingData.codiceDestinatario).toBe('ABC1234');
    expect(result.billingData.pec).toBe('acme@pec.it');
  });

  it('omits billingData when no billing columns are present', () => {
    const raw = { id: 'ir-uuid-3', status: 'pending' };
    const result = mapInvoiceRequestFromDirectus(raw);
    expect(result.billingData).toBeUndefined();
  });

  it('resolves FK table/bill_session from nested relation objects', () => {
    const raw = {
      id: 'ir-uuid-4',
      table: { id: 'tbl-nested' },
      bill_session: { id: 'bs-nested' },
    };

    const result = mapInvoiceRequestFromDirectus(raw);

    expect(result.tableId).toBe('tbl-nested');
    expect(result.billSessionId).toBe('bs-nested');
  });

  it('parses payment_methods JSON string into an array', () => {
    const raw = { id: 'ir-uuid-5', payment_methods: '["Contanti","Carta"]' };
    const result = mapInvoiceRequestFromDirectus(raw);
    expect(result.paymentMethods).toEqual(['Contanti', 'Carta']);
  });

  it('returns [] for payment_methods when JSON is not an array', () => {
    const raw = { id: 'ir-uuid-6', payment_methods: '{"key":"value"}' };
    const result = mapInvoiceRequestFromDirectus(raw);
    expect(result.paymentMethods).toEqual([]);
  });

  it('returns the input unchanged for non-object values', () => {
    expect(mapInvoiceRequestFromDirectus(null)).toBe(null);
    expect(mapInvoiceRequestFromDirectus(undefined)).toBe(undefined);
  });
});
