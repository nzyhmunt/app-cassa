import { describe, expect, it } from 'vitest';
import { resolveOnlineOnlyRoutePullCollections } from '../onlineOnlyViewPull.js';

describe('resolveOnlineOnlyRoutePullCollections()', () => {
  it('returns cassa route-scoped collections for /ordini', () => {
    expect(resolveOnlineOnlyRoutePullCollections('cassa', '/ordini')).toEqual(
      ['orders', 'order_items', 'tables'],
    );
  });

  it('returns cassa history route-scoped collections for /storico-conti', () => {
    expect(resolveOnlineOnlyRoutePullCollections('cassa', '/storico-conti')).toEqual(
      ['orders', 'bill_sessions', 'transactions', 'fiscal_receipts', 'invoice_requests'],
    );
  });

  it('normalizes route query/hash before resolving', () => {
    expect(resolveOnlineOnlyRoutePullCollections('sala', '/comande?tab=accepted#section')).toEqual(
      ['orders', 'order_items', 'tables', 'menu_items'],
    );
  });

  it('falls back to app pull config when route is unknown', () => {
    expect(resolveOnlineOnlyRoutePullCollections('cucina', '/unknown')).toEqual(
      ['orders', 'order_items'],
    );
  });

  it('falls back to cassa pull config when appType is unknown', () => {
    expect(resolveOnlineOnlyRoutePullCollections('unknown-app', '/any')).toEqual(
      ['orders', 'order_items', 'bill_sessions', 'tables', 'transactions', 'fiscal_receipts', 'invoice_requests'],
    );
  });
});
