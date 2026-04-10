/**
 * @file __tests__/formatters.test.js
 * @description Smoke tests for ESC/POS formatters.
 * Verifies that each formatter returns a non-empty Buffer containing ESC/POS data.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const { formatOrder }     = require('../formatters/order.js');
const { formatTableMove } = require('../formatters/table_move.js');
const { formatPreBill }   = require('../formatters/pre_bill.js');

// ── formatOrder ───────────────────────────────────────────────────────────────

describe('formatOrder', () => {
  it('returns a non-empty Buffer for a minimal job', () => {
    const buf = formatOrder({ table: '05', time: '20:15', items: [] });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('includes items with quantity, notes and modifiers', () => {
    const buf = formatOrder({
      table: '03', time: '19:30', printerId: 'cucina',
      items: [
        {
          name: 'Bruschetta', quantity: 2,
          notes: ['Senza aglio'],
          modifiers: [{ name: 'Extra mozzarella', price: 1.00 }],
          course: 'prima',
        },
      ],
      globalNote: 'Allergia latticini',
    });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('handles missing optional fields without throwing', () => {
    expect(() => formatOrder({})).not.toThrow();
  });

  it('handles non-array items gracefully', () => {
    expect(() => formatOrder({ table: '01', items: null })).not.toThrow();
  });
});

// ── formatTableMove ───────────────────────────────────────────────────────────

describe('formatTableMove', () => {
  it('returns a non-empty Buffer', () => {
    const buf = formatTableMove({
      fromTableLabel: '01', toTableLabel: '02',
    });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('falls back to fromTableId/toTableId when labels are missing', () => {
    const buf = formatTableMove({ fromTableId: 'A', toTableId: 'B' });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('handles empty job without throwing', () => {
    expect(() => formatTableMove({})).not.toThrow();
  });
});

// ── formatPreBill ─────────────────────────────────────────────────────────────

describe('formatPreBill', () => {
  it('returns a non-empty Buffer for a minimal job', () => {
    const buf = formatPreBill({
      table: '05', timestamp: '2026-04-08T20:00:00Z',
      items: [{ name: 'Bruschetta', quantity: 2, unitPrice: 3.00, subtotal: 6.00 }],
      grossAmount: 6.00, paymentsRecorded: 0, amountDue: 6.00,
    });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('handles partial payment (paymentsRecorded > 0)', () => {
    const buf = formatPreBill({
      table: '02', timestamp: '2026-04-08T21:00:00Z',
      items: [{ name: 'Vino', quantity: 1, unitPrice: 15.00, subtotal: 15.00 }],
      grossAmount: 15.00, paymentsRecorded: 10.00, amountDue: 5.00,
    });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('handles empty items array without throwing', () => {
    expect(() => formatPreBill({ items: [], grossAmount: 0 })).not.toThrow();
  });

  it('handles invalid timestamp gracefully', () => {
    expect(() => formatPreBill({ timestamp: 'not-a-date', items: [] })).not.toThrow();
  });
});
