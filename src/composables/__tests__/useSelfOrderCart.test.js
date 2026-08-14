/**
 * @file useSelfOrderCart.test.js
 * Unit tests for the self-order cart composable.
 *
 * The composable holds cart state in a module-level singleton ref, so each
 * test clears the cart and localStorage in beforeEach to start clean.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSelfOrderCart } from '../useSelfOrderCart.js';

const ITEM = (overrides = {}) => ({
  id: 'ant_1',
  name: 'Bruschetta',
  price: 3,
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
  const { clearCart } = useSelfOrderCart();
  clearCart();
});

describe('useSelfOrderCart — addItem', () => {
  it('adds a new item to the cart', () => {
    const { items, addItem } = useSelfOrderCart();
    addItem(ITEM(), 2);
    expect(items.value).toHaveLength(1);
    expect(items.value[0]).toMatchObject({
      menuItemId: 'ant_1',
      name: 'Bruschetta',
      price: 3,
      quantity: 2,
      modifiers: [],
      notes: '',
    });
    expect(items.value[0].id).toMatch(/^sci_/);
  });

  it('merges quantity when the same item + modifiers + notes is added again', () => {
    const { items, addItem } = useSelfOrderCart();
    addItem(ITEM(), 1, [{ name: 'Extra', price: 1 }], 'no garlic');
    addItem(ITEM(), 2, [{ name: 'Extra', price: 1 }], 'no garlic');
    expect(items.value).toHaveLength(1);
    expect(items.value[0].quantity).toBe(3);
  });

  it('keeps separate rows when modifiers or notes differ', () => {
    const { items, addItem } = useSelfOrderCart();
    addItem(ITEM(), 1, [], 'note A');
    addItem(ITEM(), 1, [], 'note B');
    addItem(ITEM(), 1, [{ name: 'Extra', price: 1 }], 'note A');
    expect(items.value).toHaveLength(3);
  });

  it('defaults price to 0 when the menu item has no price', () => {
    const { items, addItem } = useSelfOrderCart();
    addItem(ITEM({ price: undefined }), 1);
    expect(items.value[0].price).toBe(0);
  });
});

describe('useSelfOrderCart — removeItem / updateQuantity', () => {
  it('decrements quantity when more than 1', () => {
    const { items, addItem, removeItem } = useSelfOrderCart();
    addItem(ITEM(), 3);
    removeItem(items.value[0].id);
    expect(items.value[0].quantity).toBe(2);
    expect(items.value).toHaveLength(1);
  });

  it('removes the row when quantity reaches 1 and removeItem is called', () => {
    const { items, addItem, removeItem } = useSelfOrderCart();
    addItem(ITEM(), 1);
    removeItem(items.value[0].id);
    expect(items.value).toHaveLength(0);
  });

  it('updateQuantity sets an absolute quantity', () => {
    const { items, addItem, updateQuantity } = useSelfOrderCart();
    addItem(ITEM(), 1);
    updateQuantity(items.value[0].id, 5);
    expect(items.value[0].quantity).toBe(5);
  });

  it('updateQuantity with a value <= 0 removes the item', () => {
    const { items, addItem, updateQuantity } = useSelfOrderCart();
    addItem(ITEM(), 2);
    updateQuantity(items.value[0].id, 0);
    expect(items.value).toHaveLength(0);
  });

  it('removeItem is a no-op for an unknown id', () => {
    const { items, addItem, removeItem } = useSelfOrderCart();
    addItem(ITEM(), 1);
    removeItem('sci_unknown');
    expect(items.value).toHaveLength(1);
  });
});

describe('useSelfOrderCart — clearCart', () => {
  it('empties the cart', () => {
    const { items, addItem, clearCart } = useSelfOrderCart();
    addItem(ITEM(), 1);
    addItem(ITEM({ id: 'ant_2' }), 1);
    clearCart();
    expect(items.value).toHaveLength(0);
  });
});

describe('useSelfOrderCart — totalPrice', () => {
  it('sums price * quantity', () => {
    const { totalPrice, addItem } = useSelfOrderCart();
    addItem(ITEM({ id: 'a', price: 3 }), 2);   // 6
    addItem(ITEM({ id: 'b', price: 5 }), 1);   // 5
    expect(totalPrice.value).toBe(11);
  });

  it('adds modifier prices multiplied by quantity', () => {
    const { totalPrice, addItem } = useSelfOrderCart();
    // base 4 * 2 = 8 ; modifier 1.5 * 2 = 3  → 11
    addItem(ITEM({ id: 'a', price: 4 }), 2, [
      { name: 'Extra', price: 1.5 },
      { name: 'Sauce', price: 0 },
    ]);
    expect(totalPrice.value).toBe(11);
  });
});

describe('useSelfOrderCart — persistence', () => {
  it('persists the cart to localStorage on every mutation', () => {
    const { addItem } = useSelfOrderCart();
    addItem(ITEM(), 1);
    const saved = JSON.parse(localStorage.getItem('selforder_cart'));
    expect(saved).toHaveLength(1);
    expect(saved[0].menuItemId).toBe('ant_1');
  });

  it('restores the cart from localStorage on module load', async () => {
    localStorage.setItem('selforder_cart', JSON.stringify([
      { id: 'sci_x', menuItemId: 'ant_1', name: 'Bruschetta', price: 3, quantity: 2, modifiers: [], notes: '' },
    ]));
    // Re-import the module fresh so the module-level restoreCart() runs again.
    vi.resetModules();
    const { useSelfOrderCart: freshUseSelfOrderCart } = await import('../useSelfOrderCart.js');
    const { items } = freshUseSelfOrderCart();
    expect(items.value).toHaveLength(1);
    expect(items.value[0].quantity).toBe(2);
  });

  it('drops a corrupted cart from localStorage on load', async () => {
    localStorage.setItem('selforder_cart', '{not valid json');
    vi.resetModules();
    const { useSelfOrderCart: freshUseSelfOrderCart } = await import('../useSelfOrderCart.js');
    const { items } = freshUseSelfOrderCart();
    expect(items.value).toHaveLength(0);
    expect(localStorage.getItem('selforder_cart')).toBeNull();
  });
});

describe('useSelfOrderCart — buildOrderPayload', () => {
  it('builds a Directus-shaped payload with order_items and 1-based uids', () => {
    const { addItem, buildOrderPayload } = useSelfOrderCart();
    addItem(ITEM({ id: 'ant_1', price: 3 }), 2, [], 'no garlic');
    addItem(ITEM({ id: 'pri_1', name: 'Pasta', price: 10 }), 1, [{ name: 'Extra', price: 1 }]);

    const payload = buildOrderPayload('session-uuid');

    expect(payload).toMatchObject({
      bill_session: 'session-uuid',
      status: 'pending',
    });
    expect(payload.order_items).toHaveLength(2);
    expect(payload.order_items[0]).toMatchObject({
      uid: 'r_1',
      dish: 'ant_1',
      name: 'Bruschetta',
      unit_price: 3,
      quantity: 2,
      notes: ['no garlic'],
      order_item_modifiers: [],
    });
    expect(payload.order_items[1]).toMatchObject({
      uid: 'r_2',
      dish: 'pri_1',
      unit_price: 10,
      quantity: 1,
      notes: [],
      order_item_modifiers: [{
        name: 'Extra',
        price: 1,
        item_uid: 'r_2',
      }],
    });
  });

  it('wraps notes into an array and omits them when empty', () => {
    const { addItem, buildOrderPayload } = useSelfOrderCart();
    addItem(ITEM(), 1, [], '');
    const payload = buildOrderPayload('s');
    expect(payload.order_items[0].notes).toEqual([]);
  });
});
