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
 * - UUID v7 is 128 bits of randomness (hard to guess)
 * - Session status='open' must be verified on every access
 * - Optional JWT token from URL for Directus authentication
 * - Session invalidation happens when status changes to 'closed'
 */

import { ref } from 'vue';
import { useConfigStore } from '../store/index.js';

const SESSION_CACHE_KEY = 'selforder_session_cache';

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
  const loading = ref(false);
  const error = ref(null);

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

    return { sessionId, token };
  }

  async function validateAndLoadSession(sessionId, token = null) {
    loading.value = true;
    error.value = null;

    try {
      if (!sessionId) {
        throw new Error('Sessione non valida');
      }

      if (token) {
        accessToken.value = token;
      } else {
        const tokenFromUrl = new URLSearchParams(window.location.search).get('access_token');
        if (tokenFromUrl) {
          accessToken.value = tokenFromUrl;
        }
      }

      const session = await fetchBillSession(sessionId);

      if (!session) {
        throw new Error('Sessione non trovata o scaduta');
      }

      if (session.status !== 'open') {
        throw new Error('Questa sessione \u00e8 stata chiusa');
      }

      billSessionId.value = sessionId;
      billSession.value = session;
      isAuthenticated.value = true;

      sessionStorage.setItem('selforder_session_id', sessionId);

      return session;
    } catch (e) {
      error.value = e.message;
      throw e;
    } finally {
      loading.value = false;
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
    billSessionId.value = null;
    billSession.value = null;
    isAuthenticated.value = false;
    sessionStorage.removeItem('selforder_session_id');
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

  function restoreSession() {
    // NOTE: this only returns a cached session id; it does NOT mark the app as
    // authenticated. Callers must run the id through validateAndLoadSession()
    // to re-verify status === 'open' before trusting it.
    const cachedSessionId = sessionStorage.getItem('selforder_session_id');
    if (cachedSessionId) {
      return { sessionId: cachedSessionId };
    }
    return null;
  }

  return {
    billSessionId,
    accessToken,
    billSession,
    isAuthenticated,
    loading,
    error,
    parseSessionUrl,
    validateAndLoadSession,
    createOrder,
    closeSession,
    clearSession,
    restoreSession,
    fetchSessionOrders,
    getLocalOrderHistory,
    saveLocalOrder,
  };
}
