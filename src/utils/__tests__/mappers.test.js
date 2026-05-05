/**
 * @file utils/__tests__/mappers.test.js
 * @description Unit tests for pull-side mapper functions in utils/mappers.js.
 */
import { describe, it, expect } from 'vitest';
import { mapTransactionFromDirectus, mapPrintJobToDirectus, mapPayloadToDirectus } from '../mappers.js';
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
