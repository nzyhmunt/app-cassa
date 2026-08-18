/**
 * Self-Order Authentication & Session Management
 *
 * Authentication flow:
 * 1. QR code contains: selforder.html#/session/{bill_session_uuid}?access_token={jwt}
 * 2. UUID (+ optional token) validated against Directus
 * 3. Session data is loaded and cached in memory only
 * 4. All subsequent requests include the same UUID + token
 *
 * Security:
 * - UUID v7 embeds a timestamp plus random bits — still hard to guess in a
 *   brute-force attack, but it is time-ordered, not 128 bits of pure randomness
 * - Session status='open' must be verified on every access
 * - Optional JWT token from URL for Directus authentication
 * - Session invalidation happens when status changes to 'closed'
 */

import { ref } from 'vue';
import { useConfigStore } from '../store/index.js';
import { useSelfOrderCart } from './useSelfOrderCart.js';

const SESSION_CACHE_KEY = 'selforder_session_id';
// Exported so other components (e.g. ShareSession) can read the cached token
// without instantiating the full auth composable or hardcoding the key.
export const TOKEN_CACHE_KEY = 'selforder_access_token';

/**
 * Get Directus URL from config store
 * @returns {string|null}
 */
function getDirectusUrl() {
  return useConfigStore().config?.directus?.url ?? null;
}

export function useSelfOrderAuth() {
  const billSessionId = ref(null);
  const accessToken = ref(null);
  const billSession = ref(null);
  const isAuthenticated = ref(false);

  // Restore any token persisted from a previous run so that Directus requests
  // stay authenticated across PWA reloads (the in-memory ref is otherwise lost).
  const cachedToken = sessionStorage.getItem(TOKEN_CACHE_KEY);
  if (cachedToken) {
    accessToken.value = cachedToken;
  }

  // Directus PKs are UUIDs (v4: 8-4-4-4-12 hex). Validate the captured id so a
  // scanned random string (or an injected payload) is rejected before it ever
  // reaches the Directus item endpoint — defence in depth alongside the server
  // ACL, since a malformed id would otherwise produce noisy 400s and could be
  // used to probe endpoint behaviour.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function parseSessionUrl(urlOrCode) {
    let sessionId = null;
    let token = null;

    const tokenMatch = urlOrCode.match(/[?&]access_token=([^&]+)/);
    if (tokenMatch) {
      token = decodeURIComponent(tokenMatch[1]);
    }

    if (urlOrCode.startsWith('selforder://')) {
      const match = urlOrCode.match(/selforder:\/\/session\/([^?]+)/);
      if (match) {
        sessionId = match[1];
      }
    } else if (urlOrCode.includes('/session/')) {
      const match = urlOrCode.match(/\/session\/([^?]+)/);
      if (match) {
        sessionId = match[1];
      }
    } else {
      sessionId = urlOrCode.trim();
    }

    // Reject anything that does not look like a Directus session UUID. The token
    // is still returned (harmless) but a null sessionId signals "not a session".
    if (sessionId && !UUID_RE.test(sessionId)) {
      sessionId = null;
    }

    return { sessionId, token };
  }

  async function validateAndLoadSession(sessionId, token = null) {
    try {
      if (!sessionId) {
        throw new Error('Sessione non valida');
      }

      if (token) {
        accessToken.value = token;
      } else {
        // Hash-router URLs put the access_token inside the hash fragment
        // (#/session/...?access_token=...), where URLSearchParams on
        // window.location.search won't find it. Check both locations, then
        // fall back to a previously persisted token so reloads stay authed.
        const fromHash = window.location.hash.match(/[?&]access_token=([^&]+)/);
        const tokenFromUrl = fromHash
          ? decodeURIComponent(fromHash[1])
          : new URLSearchParams(window.location.search).get('access_token');
        if (tokenFromUrl) {
          accessToken.value = tokenFromUrl;
        }
      }

      if (accessToken.value) {
        sessionStorage.setItem(TOKEN_CACHE_KEY, accessToken.value);
      }

      const session = await fetchBillSession(sessionId);

      if (!session) {
        throw new Error('Sessione non trovata o scaduta');
      }

      if (session.status !== 'open') {
        throw new Error('Questa sessione \u00e8 stata chiusa');
      }

      // If the customer is scanning into a different table than the one they
      // were previously on (or re-scanning after a closeSession), the persisted
      // cart belongs to the old session — clear it so items aren't carried into
      // the new table's order. Same-session re-validation (a PWA reload) keeps
      // the cart intact.
      if (billSessionId.value && billSessionId.value !== sessionId) {
        const { resetCartForNewSession } = useSelfOrderCart();
        resetCartForNewSession();
      }

      billSessionId.value = sessionId;
      billSession.value = session;
      isAuthenticated.value = true;

      sessionStorage.setItem(SESSION_CACHE_KEY, sessionId);

      return session;
    } catch (e) {
      throw e;
    }
  }

  async function fetchBillSession(sessionId) {
    const directusUrl = getDirectusUrl();

    if (!directusUrl) {
      return getDemoSession(sessionId);
    }

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (accessToken.value) {
        headers['Authorization'] = `Bearer ${accessToken.value}`;
      }

      const response = await fetch(`${directusUrl}/items/bill_sessions/${sessionId}`, { headers });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('Accesso non autorizzato');
        }
        if (response.status === 404) {
          throw new Error('Sessione non trovata');
        }
        throw new Error('Errore di connessione');
      }

      const data = await response.json();
      return data.data;
    } catch (e) {
      console.error('[SelfOrderAuth] Session fetch failed:', e);
      throw e;
    }
  }

  async function createOrder(orderData) {
    if (!isAuthenticated.value) {
      throw new Error('Non autenticato');
    }

    const directusUrl = getDirectusUrl();

    if (!directusUrl) {
      // Demo/offline mode (no Directus configured): pretend the order was accepted.
      return { id: `demo_${Date.now()}`, status: 'pending' };
    }

    try {
      // Re-verify the session is still open server-side right before creating
      // the order. The session was validated at scan time, but the cassa may
      // have closed it (or the table merged/closed) while the customer browsed.
      // Without this check an order can be POSTed to a closed session. The
      // cached billSession is stale, so re-fetch the authoritative status.
      if (billSessionId.value) {
        const fresh = await fetchBillSession(billSessionId.value);
        if (!fresh || fresh.status !== 'open') {
          // Surface a session-ended state so the app can route back to scan.
          clearSession();
          const err = new Error('Questa sessione \u00e8 stata chiusa');
          err.code = 'SESSION_CLOSED';
          throw err;
        }
        billSession.value = fresh;
      }

      const headers = { 'Content-Type': 'application/json' };
      if (accessToken.value) {
        headers['Authorization'] = `Bearer ${accessToken.value}`;
      }

      const response = await fetch(`${directusUrl}/items/orders`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...orderData,
          bill_session: billSessionId.value,
          status: 'pending',
        }),
      });

      if (!response.ok) {
        throw new Error('Errore nell\'invio dell\'ordine');
      }

      const data = await response.json();
      return data.data;
    } catch (e) {
      console.error('[SelfOrderAuth] Order creation failed:', e);
      throw e;
    }
  }

  async function closeSession() {
    if (!isAuthenticated.value || !billSessionId.value) return;

    const directusUrl = getDirectusUrl();

    if (directusUrl) {
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (accessToken.value) {
          headers['Authorization'] = `Bearer ${accessToken.value}`;
        }

        await fetch(`${directusUrl}/items/bill_sessions/${billSessionId.value}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            status: 'closed',
            closed_at: new Date().toISOString(),
          }),
        });
      } catch (e) {
        console.warn('[SelfOrderAuth] Session close failed:', e);
      }
    }

    clearSession();
  }

  /**
   * Lightweight server-side session liveness check for polling. Re-fetches the
   * authoritative bill_session status WITHOUT the side-effects of
   * `validateAndLoadSession` (which clears the cart and re-routes). Used by the
   * order-status polling loop to detect a session closed remotely (by cassa)
   * while the customer is still on the status screen.
   *
   * @returns {Promise<{open: boolean, status: string|null}>}
   *   `open` is true only when the session still exists and is 'open'. A missing
   *   Directus URL (demo/offline mode) is treated as open.
   */
  async function checkSessionOpen() {
    if (!billSessionId.value) return { open: false, status: null };
    const directusUrl = getDirectusUrl();
    if (!directusUrl) return { open: true, status: 'demo' };
    try {
      const fresh = await fetchBillSession(billSessionId.value);
      const status = fresh?.status ?? null;
      return { open: status === 'open', status };
    } catch (e) {
      // A 404/401 means the session is gone or access was revoked → not open.
      if (e?.message && /non trovata|non autorizzato/i.test(e.message)) {
        return { open: false, status: 'gone' };
      }
      // Network blip: don't falsely report the session as closed.
      return { open: true, status: 'unknown' };
    }
  }

  async function fetchSessionOrders() {
    if (!billSessionId.value) return [];

    const directusUrl = getDirectusUrl();

    if (!directusUrl) {
      return getLocalOrderHistory();
    }

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (accessToken.value) {
        headers['Authorization'] = `Bearer ${accessToken.value}`;
      }

      const response = await fetch(
        `${directusUrl}/items/orders?${encodeURIComponent('filter[bill_session][_eq]')}=${encodeURIComponent(billSessionId.value)}&sort=-date_created&fields=id,status,order_time,total_amount,item_count,date_created,bill_session,venue,table,order_items.id,order_items.uid,order_items.dish,order_items.name,order_items.unit_price,order_items.quantity,order_items.notes`,
        { headers }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch orders');
      }

      const data = await response.json();
      return data.data || [];
    } catch (e) {
      console.error('[SelfOrderAuth] Fetch orders failed:', e);
      return getLocalOrderHistory();
    }
  }

  function getLocalOrderHistory() {
    const saved = sessionStorage.getItem(`selforder_orders_${billSessionId.value}`);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return [];
      }
    }
    return [];
  }

  function saveLocalOrder(orderData) {
    const history = getLocalOrderHistory();
    history.push({
      ...orderData,
      localTime: new Date().toISOString(),
    });
    sessionStorage.setItem(
      `selforder_orders_${billSessionId.value}`,
      JSON.stringify(history)
    );
  }

  function clearSession() {
    // Capture the session id before nulling the ref so the per-session order
    // history (a sessionStorage fallback cache keyed by it) can be cleared
    // too — otherwise it leaks across session end/re-scan.
    const sessionId = billSessionId.value;
    billSessionId.value = null;
    billSession.value = null;
    isAuthenticated.value = false;
    accessToken.value = null;
    sessionStorage.removeItem(SESSION_CACHE_KEY);
    sessionStorage.removeItem(TOKEN_CACHE_KEY);
    if (sessionId) {
      sessionStorage.removeItem(`selforder_orders_${sessionId}`);
    }
  }

  function getDemoSession(sessionId) {
    return {
      id: sessionId || 'demo_session',
      status: 'open',
      table: '1',
      table_name: 'Tavolo 1',
      venue: 1,
      opened_at: new Date().toISOString(),
    };
  }

  return {
    billSessionId,
    accessToken,
    billSession,
    isAuthenticated,
    parseSessionUrl,
    validateAndLoadSession,
    createOrder,
    closeSession,
    checkSessionOpen,
    fetchSessionOrders,
    saveLocalOrder,
  };
}
