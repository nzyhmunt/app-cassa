import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MENU_URL,
  billKey,
  getOrderItemRowTotal,
  updateOrderTotals,
} from '../index.js';

// ---------------------------------------------------------------------------
// DEFAULT_MENU_URL
// ---------------------------------------------------------------------------
describe('DEFAULT_MENU_URL', () => {
  it('is the expected fallback menu URL', () => {
    expect(DEFAULT_MENU_URL).toBe('https://nanawork.it/menu.json');
  });
});

// ---------------------------------------------------------------------------
// billKey()
// ---------------------------------------------------------------------------
describe('billKey()', () => {
  it('uses billSessionId when present', () => {
    expect(billKey({ tableId: 'T1', billSessionId: 'sess_abc' })).toBe('T1_sess_abc');
  });

  it('falls back to closedAt when billSessionId is undefined', () => {
    expect(billKey({ tableId: 'T1', closedAt: '2024-01-01T12:00:00Z' })).toBe(
      'T1_2024-01-01T12:00:00Z',
    );
  });

  it('falls back to empty string when neither billSessionId nor closedAt is present', () => {
    expect(billKey({ tableId: 'T1' })).toBe('T1_');
  });

  it('prefers billSessionId over closedAt when both are present', () => {
    expect(billKey({ tableId: 'T2', billSessionId: 'sess_xyz', closedAt: '2024-01-01' })).toBe(
      'T2_sess_xyz',
    );
  });
});

// ---------------------------------------------------------------------------
// getOrderItemRowTotal()
// ---------------------------------------------------------------------------
describe('getOrderItemRowTotal()', () => {
  it('calculates total for a simple item with no voided quantity', () => {
    expect(getOrderItemRowTotal({ unitPrice: 10, quantity: 2, voidedQuantity: 0 })).toBe(20);
  });

  it('subtracts voided quantity from the active count', () => {
    expect(getOrderItemRowTotal({ unitPrice: 10, quantity: 3, voidedQuantity: 1 })).toBe(20);
  });

  it('returns 0 when all items are voided', () => {
    expect(getOrderItemRowTotal({ unitPrice: 10, quantity: 2, voidedQuantity: 2 })).toBe(0);
  });

  it('handles missing voidedQuantity (treated as 0)', () => {
    expect(getOrderItemRowTotal({ unitPrice: 5, quantity: 3 })).toBe(15);
  });

  it('adds modifier prices to active items', () => {
    const item = {
      unitPrice: 10,
      quantity: 2,
      voidedQuantity: 0,
      modifiers: [{ price: 1.5, voidedQuantity: 0 }],
    };
    // 2 × 10 + 2 × 1.5 = 23
    expect(getOrderItemRowTotal(item)).toBe(23);
  });

  it('accounts for per-modifier voided quantity', () => {
    const item = {
      unitPrice: 10,
      quantity: 3,
      voidedQuantity: 1, // 2 active items
      modifiers: [{ price: 2, voidedQuantity: 1 }], // 2 active − 1 = 1 modifier-active
    };
    // 2 × 10 + 1 × 2 = 22
    expect(getOrderItemRowTotal(item)).toBe(22);
  });

  it('clamps per-modifier contribution to zero when modVoided >= active', () => {
    const item = {
      unitPrice: 10,
      quantity: 2,
      voidedQuantity: 0, // 2 active
      modifiers: [{ price: 5, voidedQuantity: 3 }], // Math.max(0, 2-3) = 0
    };
    // 2 × 10 + 0 × 5 = 20
    expect(getOrderItemRowTotal(item)).toBe(20);
  });

  it('handles items with no modifiers property', () => {
    expect(getOrderItemRowTotal({ unitPrice: 8, quantity: 4, voidedQuantity: 0 })).toBe(32);
  });

  it('handles items with an empty modifiers array', () => {
    expect(
      getOrderItemRowTotal({ unitPrice: 8, quantity: 2, voidedQuantity: 0, modifiers: [] }),
    ).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// updateOrderTotals()
// ---------------------------------------------------------------------------
describe('updateOrderTotals()', () => {
  it('updates itemCount and totalAmount for multiple items', () => {
    const ord = {
      orderItems: [
        { unitPrice: 10, quantity: 2, voidedQuantity: 0 },
        { unitPrice: 5, quantity: 1, voidedQuantity: 0 },
      ],
    };
    updateOrderTotals(ord);
    expect(ord.itemCount).toBe(3);
    expect(ord.totalAmount).toBe(25);
  });

  it('accounts for voided quantities in both itemCount and totalAmount', () => {
    const ord = {
      orderItems: [{ unitPrice: 10, quantity: 3, voidedQuantity: 1 }],
    };
    updateOrderTotals(ord);
    expect(ord.itemCount).toBe(2);
    expect(ord.totalAmount).toBe(20);
  });

  it('handles empty orderItems (zero totals)', () => {
    const ord = { orderItems: [] };
    updateOrderTotals(ord);
    expect(ord.itemCount).toBe(0);
    expect(ord.totalAmount).toBe(0);
  });

  it('is a no-op for null input', () => {
    expect(() => updateOrderTotals(null)).not.toThrow();
  });

  it('includes modifier prices in totalAmount', () => {
    const ord = {
      orderItems: [
        {
          unitPrice: 10,
          quantity: 2,
          voidedQuantity: 0,
          modifiers: [{ price: 1, voidedQuantity: 0 }],
        },
      ],
    };
    // active = 2, total = 2×10 + 2×1 = 22
    updateOrderTotals(ord);
    expect(ord.totalAmount).toBe(22);
  });
});
