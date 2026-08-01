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

const SESSION_CACHE_KEY = 'selforder_session_cache';

export function useSelfOrderAuth() {
  const billSessionId = ref(null);
  const accessToken = ref(null); // JWT token from URL for Directus auth
  const billSession = ref(null);
  const isAuthenticated = ref(false);
  const loading = ref(false);
  const error = ref(null);

  /**
   * Parse QR code / URL and extract session UUID and token
   */
  function parseSessionUrl(urlOrCode) {
    let sessionId = null;
    let token = null;

    // Extract token from URL if present
    const tokenMatch = urlOrCode.match(/[?&]access_token=([^&]+)/);
    if (tokenMatch) {
      token = decodeURIComponent(tokenMatch[1]);
    }

    // Format: selforder://session/{bill_session_uuid}
    if (urlOrCode.startsWith('selforder://')) {
      const match = urlOrCode.match(/selforder:\/\/session\/([^?]+)/);
      if (match) {
        sessionId = match[1];
      }
    }
    // Format: /session/{uuid} (from URL hash)
    else if (urlOrCode.includes('/session/')) {
      const match = urlOrCode.match(/\/session\/([^?]+)/);
      if (match) {
        sessionId = match[1];
      }
    }
    // Format: Just UUID (for manual entry)
    else {
      sessionId = urlOrCode.trim();
    }

    return { sessionId, token };
  }

  /**
   * Validate session UUID and load session from Directus
   */
  async function validateAndLoadSession(sessionId) {
    loading.value = true;
    error.value = null;

    try {
      if (!sessionId) {
        throw new Error('Sessione non valida');
      }

      // Extract token from URL if present
      const tokenFromUrl = new URLSearchParams(window.location.search).get('access_token');
      if (tokenFromUrl) {
        accessToken.value = tokenFromUrl;
      }

      // Validate against Directus
      const session = await fetchBillSession(sessionId);
      
      if (!session) {
        throw new Error('Sessione non trovata o scaduta');
      }

      if (session.status !== 'open') {
        throw new Error('Questa sessione è stata chiusa');
      }

      // Cache session (temporary only)
      billSessionId.value = sessionId;
      billSession.value = session;
      isAuthenticated.value = true;

      // Store for potential re-visits (but only for this browser session)
      sessionStorage.setItem('selforder_session_id', sessionId);

      return session;
    } catch (e) {
      error.value = e.message;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Fetch bill session from Directus API
   */
  async function fetchBillSession(sessionId) {
    const configStore = useConfigStore();
    const directusUrl = configStore.directusUrl;

    if (!directusUrl) {
      // For demo mode without Directus
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

  /**
   * Create an order for this session
   */
  async function createOrder(orderData) {
    if (!isAuthenticated.value) {
      throw new Error('Non autenticato');
    }

    const configStore = useConfigStore();
    const directusUrl = configStore.directusUrl;

    if (!directusUrl) {
      // Demo mode - just log
      console.log('[SelfOrderAuth] Demo order:', orderData);
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

  /**
   * Close the session (called when customer ends or order complete)
   * Note: Only cassa/sala should close sessions, not the self-order app
   */
  async function closeSession() {
    if (!isAuthenticated.value || !billSessionId.value) return;

    const configStore = useConfigStore();
    const directusUrl = configStore.directusUrl;

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

    // Clear all session data
    clearSession();
  }

  /**
   * Fetch all orders for this bill session
   * Returns orders from all customers who ordered at this table
   */
  async function fetchSessionOrders() {
    if (!billSessionId.value) return [];

    const configStore = useConfigStore();
    const directusUrl = configStore.directusUrl;

    if (!directusUrl) {
      // Demo mode - return local history
      return getLocalOrderHistory();
    }

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (accessToken.value) {
        headers['Authorization'] = `Bearer ${accessToken.value}`;
      }

      const response = await fetch(
        `${directusUrl}/items/orders?filter[bill_session][_eq]=${billSessionId.value}&sort=-date_created`,
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

  /**
   * Get local order history from sessionStorage (fallback/demo)
   */
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

  /**
   * Save order to local history (for demo/offline)
   */
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

  /**
   * Clear session from memory and sessionStorage
   */
  function clearSession() {
    billSessionId.value = null;
    billSession.value = null;
    isAuthenticated.value = false;
    sessionStorage.removeItem('selforder_session_id');
  }

  /**
   * Get demo session for testing (remove in production)
   */
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

  /**
   * Check if there's a cached session on page load
   */
  function restoreSession() {
    const cachedSessionId = sessionStorage.getItem('selforder_session_id');

    if (cachedSessionId) {
      billSessionId.value = cachedSessionId;
      isAuthenticated.value = true;
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

// Need to import useConfigStore here to avoid circular deps
import { useConfigStore } from '../store/index.js';
import { ref } from 'vue';
