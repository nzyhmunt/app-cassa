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

function expectNoCarriageReturns(buf) {
  expect(buf.includes(0x0d)).toBe(false);
}

function expectHexBuffer(buf, expectedHex) {
  expect(buf.toString('hex')).toBe(expectedHex);
}

// ── formatOrder ───────────────────────────────────────────────────────────────

describe('formatOrder', () => {
  it('returns a non-empty Buffer for a minimal job', () => {
    const buf = formatOrder({ table: '05', time: '20:15', items: [] });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
    expectNoCarriageReturns(buf);
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
    expectHexBuffer(
      buf,
      '2020202020202020202020201b401c2e1b4d001b45011d21111b74005441564f4c4f2030331b45001d21000a2020202020202020202020202020202020201b45011d21001b450031393a33300a2020202020202020202020202020202020201b4501435543494e411b45000a1b45011b4500c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c40a1b4501327820427275736368657474611b45000a1b45011b45003e3e2053656e7a612061676c696f0a2b204578747261206d6f7a7a6172656c6c610a5b7072696d615d0ac4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c40a1b45014e4f54413a201b4500416c6c6572676961206c6174746963696e690a0a0a0a1d56000a',
    );
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
    expectNoCarriageReturns(buf);
    expectHexBuffer(
      buf,
      '2020201b401c2e1b4d001b45011d21111b740053504f5354414d454e544f205441564f4c4f1b45001d21000a1b45011d21001b4500c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c40a20202020202020202020202020201b450144413a205441564f4c4f2030311b45000a20202020202020202020202020201b45011b45001b4501413a20205441564f4c4f2030321b45000a1b45011b45000a0a0a1d56000a',
    );
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
    expectNoCarriageReturns(buf);
    expectHexBuffer(
      buf,
      '202020202020202020202020201b401c2e1b4d001b45011d21111b7400505245434f4e544f1b45001d21000a202020202020202020202020202020201b45011d21001b45005461766f6c6f2030350a2020202020202020202020202030382f30342f323032362032303a30300ac4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c40a4445534352495a494f4e4520202020202020202020202020202020202020202020202020544f54414c450ac4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c40a327820427275736368657474612020202020202020202020202020202020202020202020362c3030203f0a4020332c3030203f206361642e20202020202020202020202020202020202020202020202020202020200ac4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c40a544f54414c45202020202020202020202020202020202020202020202020202020202020362c3030203f0ac4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c40a202020202020202020204772617a69652065206172726976656465726369210a0a0a0a1d56000a',
    );
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
