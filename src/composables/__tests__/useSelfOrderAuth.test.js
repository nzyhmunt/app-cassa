/**
 * @file useSelfOrderAuth.test.js
 * Unit tests for the self-order auth & session composable.
 *
 * State is instance-level (fresh refs per useSelfOrderAuth() call), so no
 * singleton reset is needed. Directus is exercised via mocked fetch and the
 * config store's directus.url; an empty url selects demo/offline mode.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSelfOrderAuth } from '../useSelfOrderAuth.js';
import { useConfigStore } from '../../store/index.js';

beforeEach(() => {
  setActivePinia(createPinia());
  sessionStorage.clear();
  localStorage.clear();
  // Default to demo mode (no Directus URL configured).
  useConfigStore().config.directus.url = '';
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function jsonResponse(body, init = {}) {
  return { ok: init.ok ?? true, status: init.status ?? 200, json: async () => body };
}

/**
 * Build a fetch mock that routes by URL so a single mock can serve a session
 * GET, an orders GET and an orders/bill_sessions PATCH in the same test.
 */
function routeFetch(routes) {
  return vi.fn(async (url, opts = {}) => {
    for (const { match, response } of routes) {
      if (match(url, opts)) {
        return typeof response === 'function' ? response(url, opts) : response;
      }
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

const OPEN_SESSION = () => jsonResponse({ data: { id: 's1', status: 'open', table: '5' } });

describe('useSelfOrderAuth — parseSessionUrl', () => {
  it('parses a selforder:// deep link', () => {
    const { parseSessionUrl } = useSelfOrderAuth();
    const { sessionId, token } = parseSessionUrl('selforder://session/abc-123');
    expect(sessionId).toBe('abc-123');
    expect(token).toBeNull();
  });

  it('parses a /session/ URL and extracts the access_token', () => {
    const { parseSessionUrl } = useSelfOrderAuth();
    const { sessionId, token } = parseSessionUrl(
      'https://host/selforder#/session/xyz?access_token=jwt.value'
    );
    expect(sessionId).toBe('xyz');
    expect(token).toBe('jwt.value');
  });

  it('treats a bare string as the session id', () => {
    const { parseSessionUrl } = useSelfOrderAuth();
    const { sessionId, token } = parseSessionUrl('  raw-uuid  ');
    expect(sessionId).toBe('raw-uuid');
    expect(token).toBeNull();
  });

  it('decodes a URL-encoded access_token', () => {
    const { parseSessionUrl } = useSelfOrderAuth();
    const { token } = parseSessionUrl('selforder://session/s1?access_token=a%2Eb%2Ec');
    expect(token).toBe('a.b.c');
  });
});

describe('useSelfOrderAuth — validateAndLoadSession (demo mode)', () => {
  it('loads a demo session and marks the user authenticated', async () => {
    const auth = useSelfOrderAuth();
    const session = await auth.validateAndLoadSession('demo-uuid', 'tok');
    expect(session.status).toBe('open');
    expect(auth.isAuthenticated.value).toBe(true);
    expect(auth.billSessionId.value).toBe('demo-uuid');
    expect(auth.accessToken.value).toBe('tok');
    expect(sessionStorage.getItem('selforder_session_id')).toBe('demo-uuid');
  });

  it('throws on an empty session id', async () => {
    const auth = useSelfOrderAuth();
    await expect(auth.validateAndLoadSession('')).rejects.toThrow();
    expect(auth.isAuthenticated.value).toBe(false);
  });
});

describe('useSelfOrderAuth — validateAndLoadSession (Directus)', () => {
  it('throws when the session is closed', async () => {
    useConfigStore().config.directus.url = 'https://directus.test';
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({ data: { id: 's1', status: 'closed' } })
    ));
    const auth = useSelfOrderAuth();
    await expect(auth.validateAndLoadSession('s1', 'tok')).rejects.toThrow();
    expect(auth.isAuthenticated.value).toBe(false);
  });

  it('throws "Accesso non autorizzato" on 401/403', async () => {
    useConfigStore().config.directus.url = 'https://directus.test';
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { ok: false, status: 403 })));
    const auth = useSelfOrderAuth();
    await expect(auth.validateAndLoadSession('s1', 'tok')).rejects.toThrow('Accesso non autorizzato');
  });

  it('throws "Sessione non trovata" on 404', async () => {
    useConfigStore().config.directus.url = 'https://directus.test';
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { ok: false, status: 404 })));
    const auth = useSelfOrderAuth();
    await expect(auth.validateAndLoadSession('s1', 'tok')).rejects.toThrow('Sessione non trovata');
  });

  it('loads an open session and stores it', async () => {
    useConfigStore().config.directus.url = 'https://directus.test';
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({ data: { id: 's1', status: 'open', table: '5' } })
    ));
    const auth = useSelfOrderAuth();
    const session = await auth.validateAndLoadSession('s1', 'tok');
    expect(session.status).toBe('open');
    expect(auth.billSession.value.table).toBe('5');
    expect(auth.accessToken.value).toBe('tok');
  });
});

describe('useSelfOrderAuth — access token persistence', () => {
  it('persists the access token so it survives a PWA reload', async () => {
    useConfigStore().config.directus.url = 'https://directus.test';
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({ data: { id: 's1', status: 'open', table: '5' } })
    ));
    const auth = useSelfOrderAuth();
    await auth.validateAndLoadSession('s1', 'tok');
    expect(sessionStorage.getItem('selforder_access_token')).toBe('tok');

    // Simulate a reload: a fresh composable instance must restore the token.
    const reloaded = useSelfOrderAuth();
    expect(reloaded.accessToken.value).toBe('tok');
  });

  it('restores a previously cached token when none is passed explicitly', async () => {
    sessionStorage.setItem('selforder_access_token', 'cached-tok');
    useConfigStore().config.directus.url = 'https://directus.test';
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: { id: 's1', status: 'open', table: '5' } })
    );
    vi.stubGlobal('fetch', fetchMock);
    const auth = useSelfOrderAuth();
    // No token argument — the cached one should be reused for the request.
    await auth.validateAndLoadSession('s1');
    expect(auth.accessToken.value).toBe('cached-tok');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer cached-tok');
  });

  it('reads the access_token from the hash fragment (hash router)', async () => {
    useConfigStore().config.directus.url = 'https://directus.test';
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({ data: { id: 's1', status: 'open', table: '5' } })
    ));
    // Hash-router URL: #/session/s1?access_token=hash.tok
    Object.defineProperty(window, 'location', {
      value: { hash: '#/session/s1?access_token=hash.tok', search: '' },
      writable: true,
      configurable: true,
    });
    const auth = useSelfOrderAuth();
    await auth.validateAndLoadSession('s1');
    expect(auth.accessToken.value).toBe('hash.tok');
  });

  it('clears the cached token on closeSession', async () => {
    useConfigStore().config.directus.url = 'https://directus.test';
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({ data: { id: 's1', status: 'open', table: '5' } })
    ));
    const auth = useSelfOrderAuth();
    await auth.validateAndLoadSession('s1', 'tok');
    expect(sessionStorage.getItem('selforder_access_token')).toBe('tok');

    await auth.closeSession();
    expect(auth.accessToken.value).toBeNull();
    expect(sessionStorage.getItem('selforder_access_token')).toBeNull();
  });
});

describe('useSelfOrderAuth — createOrder', () => {
  it('returns a demo order in offline mode', async () => {
    const auth = useSelfOrderAuth();
    await auth.validateAndLoadSession('demo-uuid', 'tok');
    const order = await auth.createOrder({ order_items: [] });
    expect(order.status).toBe('pending');
    expect(order.id).toMatch(/^demo_/);
  });

  it('posts the order to Directus with the session id and pending status', async () => {
    useConfigStore().config.directus.url = 'https://directus.test';
    const fetchMock = routeFetch([
      { match: (u) => u.includes('/items/bill_sessions/'), response: OPEN_SESSION() },
      { match: (u, o) => u.includes('/items/orders') && o.method === 'POST', response: jsonResponse({ data: { id: 'ord_1', status: 'pending' } }) },
    ]);
    vi.stubGlobal('fetch', fetchMock);
    const auth = useSelfOrderAuth();
    await auth.validateAndLoadSession('s1', 'tok');

    const order = await auth.createOrder({ order_items: [{ dish: 'ant_1' }] });
    expect(order.id).toBe('ord_1');
    const createCall = fetchMock.mock.calls.find(
      ([u, o]) => u.includes('/items/orders') && o.method === 'POST'
    );
    expect(createCall[0]).toBe('https://directus.test/items/orders');
    expect(createCall[1].method).toBe('POST');
    expect(createCall[1].headers.Authorization).toBe('Bearer tok');
    const body = JSON.parse(createCall[1].body);
    expect(body).toMatchObject({
      bill_session: 's1',
      status: 'pending',
      order_items: [{ dish: 'ant_1' }],
    });
  });

  it('rejects when not authenticated', async () => {
    const auth = useSelfOrderAuth();
    await expect(auth.createOrder({})).rejects.toThrow();
  });
});

describe('useSelfOrderAuth — local order history', () => {
  it('saves and reads local orders keyed by session id', async () => {
    const auth = useSelfOrderAuth();
    await auth.validateAndLoadSession('demo-uuid', 'tok');
    auth.saveLocalOrder({ id: 'ord_1', status: 'pending' });
    auth.saveLocalOrder({ id: 'ord_2', status: 'accepted' });

    const orders = await auth.fetchSessionOrders();
    expect(orders).toHaveLength(2);
    expect(orders[0].id).toBe('ord_1');
    expect(orders[1].localTime).toBeTruthy();
  });

  it('returns an empty array when no history exists', async () => {
    const auth = useSelfOrderAuth();
    await auth.validateAndLoadSession('demo-uuid', 'tok');
    const orders = await auth.fetchSessionOrders();
    expect(orders).toEqual([]);
  });
});

describe('useSelfOrderAuth — fetchSessionOrders (Directus)', () => {
  it('fetches orders filtered by bill session', async () => {
    useConfigStore().config.directus.url = 'https://directus.test';
    const fetchMock = routeFetch([
      { match: (u) => u.includes('/items/bill_sessions/'), response: OPEN_SESSION() },
      { match: (u) => u.includes('/items/orders'), response: jsonResponse({ data: [{ id: 'ord_1', status: 'pending' }] }) },
    ]);
    vi.stubGlobal('fetch', fetchMock);
    const auth = useSelfOrderAuth();
    await auth.validateAndLoadSession('s1', 'tok');

    const orders = await auth.fetchSessionOrders();
    expect(orders).toHaveLength(1);
    const ordersCall = fetchMock.mock.calls.find(([u]) => u.includes('/items/orders') && u.includes('filter'));
    expect(ordersCall[0]).toContain('https://directus.test/items/orders');
    expect(ordersCall[0]).toContain(encodeURIComponent('filter[bill_session][_eq]'));
    expect(ordersCall[0]).toContain('s1');
  });

  it('falls back to local history when the Directus request fails', async () => {
    useConfigStore().config.directus.url = 'https://directus.test';
    const fetchMock = routeFetch([
      { match: (u) => u.includes('/items/bill_sessions/'), response: OPEN_SESSION() },
      { match: (u) => u.includes('/items/orders'), response: async () => { throw new Error('network down'); } },
    ]);
    vi.stubGlobal('fetch', fetchMock);
    const auth = useSelfOrderAuth();
    await auth.validateAndLoadSession('s1', 'tok');
    auth.saveLocalOrder({ id: 'local_1' });

    const orders = await auth.fetchSessionOrders();
    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe('local_1');
  });
});

describe('useSelfOrderAuth — closeSession', () => {
  it('clears local session state in demo mode without a network call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const auth = useSelfOrderAuth();
    await auth.validateAndLoadSession('demo-uuid', 'tok');

    await auth.closeSession();
    expect(auth.isAuthenticated.value).toBe(false);
    expect(auth.billSessionId.value).toBeNull();
    expect(sessionStorage.getItem('selforder_session_id')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('PATCHes the session closed in Directus mode', async () => {
    useConfigStore().config.directus.url = 'https://directus.test';
    const fetchMock = routeFetch([
      { match: (u) => u.includes('/items/bill_sessions/'), response: (url, opts) => opts.method === 'PATCH' ? jsonResponse({ data: {} }) : OPEN_SESSION() },
    ]);
    vi.stubGlobal('fetch', fetchMock);
    const auth = useSelfOrderAuth();
    await auth.validateAndLoadSession('s1', 'tok');

    await auth.closeSession();
    const closeCall = fetchMock.mock.calls.find(([, o]) => o.method === 'PATCH');
    expect(closeCall[0]).toBe('https://directus.test/items/bill_sessions/s1');
    expect(closeCall[1].method).toBe('PATCH');
    expect(JSON.parse(closeCall[1].body).status).toBe('closed');
    expect(auth.isAuthenticated.value).toBe(false);
  });
});
