/**
 * @file useSelfOrderMenu.test.js
 * Unit tests for the self-order menu composable.
 *
 * Covers item normalization (nanawork → app field names), flat/wrapped menu
 * formats, lookups, trusted cart-total calculation, caching TTL and the
 * fetch-failure demo fallback.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSelfOrderMenu } from '../useSelfOrderMenu.js';

const FLAT_MENU = {
  Antipasti: [
    {
      id: 'ant_1',
      name: 'Bruschetta',
      price: 3,
      descrizione: 'Pane e pomodoro',
      note: 'Vegano',
      ingredienti: ['Pane', 'Pomodoro'],
      allergeni: ['glutine'],
      immagine_url: 'https://img.test/ant_1.png',
      modifiers: [{ id: 'm1', name: 'Extra', price: 1 }],
    },
  ],
  'Primi Piatti': [
    {
      id: 'pri_1',
      name: 'Pasta',
      price: 10,
      // no descrizione/ingredienti/allergeni/immagine_url → defaults
      available: false,
    },
  ],
};

const WRAPPED_MENU = {
  categories: ['Drinks'],
  items: {
    Drinks: [
      { id: 'bev_1', name: 'Water', price: 2, allergeni: [] },
    ],
  },
};

beforeEach(() => {
  setActivePinia(createPinia());
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function loadWith(fetchImpl) {
  vi.stubGlobal('fetch', vi.fn(fetchImpl));
  const menu = useSelfOrderMenu();
  const data = await menu.loadMenu('https://menu.test/menu.json');
  return { menu, data };
}

describe('useSelfOrderMenu — normalizeItem (nanawork field mapping)', () => {
  it('maps descrizione/ingredienti/allergeni/immagine_url to app fields', async () => {
    const { menu } = await loadWith(async () => ({
      ok: true,
      json: async () => FLAT_MENU,
    }));

    const item = menu.getItemById('ant_1');
    expect(item).toMatchObject({
      id: 'ant_1',
      name: 'Bruschetta',
      price: 3,
      description: 'Pane e pomodoro',
      note: 'Vegano',
      ingredients: 'Pane, Pomodoro',
      allergens: ['glutine'],
      image: 'https://img.test/ant_1.png',
      available: true,
    });
    expect(item.modifiers).toEqual([{ id: 'm1', name: 'Extra', price: 1 }]);
  });

  it('applies safe defaults for missing optional fields and marks availability', async () => {
    const { menu } = await loadWith(async () => ({
      ok: true,
      json: async () => FLAT_MENU,
    }));

    const item = menu.getItemById('pri_1');
    expect(item.price).toBe(10);
    expect(item.description).toBe('');
    expect(item.ingredients).toBe('');
    expect(item.allergens).toEqual([]);
    expect(item.image).toBe('');
    expect(item.available).toBe(false);
  });

  it('normalizes modifiers with price defaulting to 0', async () => {
    const { menu } = await loadWith(async () => ({
      ok: true,
      json: async () => ({
        Antipasti: [{ id: 'x', name: 'X', price: 1, modifiers: [{ id: 'm', name: 'M' }] }],
      }),
    }));
    const item = menu.getItemById('x');
    expect(item.modifiers).toEqual([{ id: 'm', name: 'M', price: 0 }]);
  });
});

describe('useSelfOrderMenu — setMenu formats', () => {
  it('parses the flat nanawork format and exposes categories', async () => {
    const { menu } = await loadWith(async () => ({
      ok: true,
      json: async () => FLAT_MENU,
    }));
    expect(menu.categories.value).toEqual(['Antipasti', 'Primi Piatti']);
    expect(menu.menu.value['Antipasti']).toHaveLength(1);
  });

  it('parses the wrapped format (categories + items)', async () => {
    const { menu } = await loadWith(async () => ({
      ok: true,
      json: async () => WRAPPED_MENU,
    }));
    expect(menu.categories.value).toEqual(['Drinks']);
    expect(menu.getItemById('bev_1').name).toBe('Water');
  });
});

describe('useSelfOrderMenu — lookups', () => {
  it('getAllItems flattens the menu and tags each item with its category', async () => {
    const { menu } = await loadWith(async () => ({
      ok: true,
      json: async () => FLAT_MENU,
    }));
    const all = menu.getAllItems();
    expect(all).toHaveLength(2);
    expect(all.find(i => i.id === 'ant_1').category).toBe('Antipasti');
  });

  it('getItemById returns null for an unknown id', async () => {
    const { menu } = await loadWith(async () => ({
      ok: true,
      json: async () => FLAT_MENU,
    }));
    expect(menu.getItemById('nope')).toBeNull();
  });

  it('getItemPrice reads the trusted menu price', async () => {
    const { menu } = await loadWith(async () => ({
      ok: true,
      json: async () => FLAT_MENU,
    }));
    expect(menu.getItemPrice('ant_1')).toBe(3);
    expect(menu.getItemPrice('missing')).toBe(0);
  });

  it('getModifierPrice looks up a modifier across all items', async () => {
    const { menu } = await loadWith(async () => ({
      ok: true,
      json: async () => FLAT_MENU,
    }));
    expect(menu.getModifierPrice('m1')).toBe(1);
    expect(menu.getModifierPrice('nope')).toBe(0);
  });
});

describe('useSelfOrderMenu — calculateCartTotal (trusted)', () => {
  it('uses menu prices, not client-supplied cart prices', async () => {
    const { menu } = await loadWith(async () => ({
      ok: true,
      json: async () => FLAT_MENU,
    }));
    // Client tampers the unit price to 0 — calculation must ignore it.
    const cartItems = [
      { menuItemId: 'ant_1', quantity: 2, modifiers: [{ price: 1 }] }, // (3*2) + (1*2) = 8
      { menuItemId: 'pri_1', price: 0, quantity: 1, modifiers: [] },    // 10
    ];
    const { total, itemCount } = menu.calculateCartTotal(cartItems);
    expect(total).toBe(18);
    expect(itemCount).toBe(3);
  });

  it('counts modifiers multiplied by quantity', async () => {
    const { menu } = await loadWith(async () => ({
      ok: true,
      json: async () => FLAT_MENU,
    }));
    const { total } = menu.calculateCartTotal([
      { menuItemId: 'ant_1', quantity: 3, modifiers: [{ price: 1 }, { price: 0.5 }] },
    ]);
    // 3*3 + (1+0.5)*3 = 9 + 4.5 = 13.5
    expect(total).toBe(13.5);
  });

  it('returns 0 for an unknown item id', async () => {
    const { menu } = await loadWith(async () => ({
      ok: true,
      json: async () => FLAT_MENU,
    }));
    const { total, itemCount } = menu.calculateCartTotal([
      { menuItemId: 'missing', quantity: 5, modifiers: [] },
    ]);
    expect(total).toBe(0);
    expect(itemCount).toBe(5);
  });
});

describe('useSelfOrderMenu — caching', () => {
  it('serves a cached menu without re-fetching', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => FLAT_MENU,
    }));
    vi.stubGlobal('fetch', fetchMock);
    const menu = useSelfOrderMenu();

    await menu.loadMenu('https://menu.test/menu.json');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second load hits the cache, fetch must not be called again.
    await menu.loadMenu('https://menu.test/menu.json');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(menu.getItemById('ant_1')).not.toBeNull();
  });

  it('treats an expired cache as a miss and re-fetches', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => FLAT_MENU,
    }));
    vi.stubGlobal('fetch', fetchMock);
    const menu = useSelfOrderMenu();

    await menu.loadMenu('https://menu.test/menu.json');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // TTL is 5 minutes; advance past it.
    vi.advanceTimersByTime(6 * 60 * 1000);
    await menu.loadMenu('https://menu.test/menu.json');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe('useSelfOrderMenu — fetch failure fallback', () => {
  it('falls back to the demo menu when the network request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));
    const menu = useSelfOrderMenu();
    const data = await menu.loadMenu('https://menu.test/menu.json');
    expect(Object.keys(data)).toContain('Antipasti');
    expect(menu.getItemById('ant_1')).not.toBeNull();
  });

  it('falls back to the demo menu on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    const menu = useSelfOrderMenu();
    const data = await menu.loadMenu('https://menu.test/menu.json');
    expect(data['Bevande']).toBeDefined();
  });

  it('clears the loading flag after a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));
    const menu = useSelfOrderMenu();
    await menu.loadMenu('https://menu.test/menu.json');
    expect(menu.loading.value).toBe(false);
  });
});
