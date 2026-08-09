import { describe, expect, it } from 'vitest';
import { normalizeCollectionScope } from '../collectionScope.js';

describe('normalizeCollectionScope()', () => {
  it('normalizes, filters empty values, and deduplicates in order', () => {
    const result = normalizeCollectionScope([
      ' orders ',
      '',
      'order_items',
      'orders',
      null,
      '  ',
      'tables',
    ]);

    expect(result).toEqual(['orders', 'order_items', 'tables']);
  });

  it('filters by allowed collections', () => {
    const result = normalizeCollectionScope(
      ['orders', 'order_items', 'tables', 'menu_items'],
      { allowedCollections: ['orders', 'tables'] },
    );

    expect(result).toEqual(['orders', 'tables']);
  });

  it('excludes menu_items only in json mode when requested', () => {
    const source = ['orders', 'menu_items', 'tables'];

    const jsonMode = normalizeCollectionScope(source, {
      menuSource: 'json',
      excludeMenuItemsInJsonMode: true,
    });
    const directusMode = normalizeCollectionScope(source, {
      menuSource: 'directus',
      excludeMenuItemsInJsonMode: true,
    });

    expect(jsonMode).toEqual(['orders', 'tables']);
    expect(directusMode).toEqual(['orders', 'menu_items', 'tables']);
  });
});
