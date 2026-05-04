/**
 * @file utils/__tests__/mappers.test.js
 * @description Unit tests for pull-side mapper functions in utils/mappers.js.
 */
import { describe, it, expect } from 'vitest';
import { mapTransactionFromDirectus } from '../mappers.js';

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
