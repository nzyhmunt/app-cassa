/**
 * Self-Order Authentication & Session Management
 * 
 * Authentication flow:
 * 1. QR code contains: selforder://session/{bill_session_id}?token={auth_token}
 * 2. Token is validated against Directus (or a lightweight validation endpoint)
 * 3. Session data is loaded and cached in memory only
 * 4. All subsequent requests include the token
 * 
 * Security:
 * - Token has limited scope (read session + create orders only)
 * - Token expires when session closes or after configurable timeout
 * - No sensitive data persisted to localStorage
 */

const AUTH_TOKEN_KEY = 'selforder_token';
const SESSION_CACHE_KEY = 'selforder_session_cache'; // Temporary cache only

export function useSelfOrderAuth() {
  const token = ref(null);
  const billSessionId = ref(null);
  const billSession = ref(null);
  const isAuthenticated = ref(false);
  const loading = ref(false);
  const error = ref(null);

  /**
   * Parse QR code / URL and extract session ID and token
   */
  function parseSessionUrl(urlOrCode) {
    let sessionId = null;
    let authToken = null;

    // Format: selforder://session/{bill_session_id}?token={token}
    if (urlOrCode.startsWith('selforder://')) {
      const match = urlOrCode.match(/selforder:\/\/session\/([^?]+)\?token=(.+)/);
      if (match) {
        sessionId = match[1];
        authToken = decodeURIComponent(match[2]);
      }
    }
    // Format: Just session ID (for manual entry)
    else {
      sessionId = urlOrCode.trim();
    }

    return { sessionId, authToken };
  }

  /**
   * Validate token and load session from Directus
   * Uses a lightweight API endpoint or Directus items endpoint with token auth
   */
  async function validateAndLoadSession(sessionId, providedToken = null) {
    loading.value = true;
    error.value = null;

    try {
      // Get token from URL param, localStorage (if re-visiting), or use static demo token
      const authToken = providedToken || 
        new URLSearchParams(window.location.search).get('token') ||
        getDemoToken(); // For demo purposes

      if (!authToken && !sessionId) {
        throw new Error('Token o sessione non validi');
      }

      // Validate against Directus
      const session = await fetchBillSession(sessionId, authToken);
      
      if (!session) {
        throw new Error('Sessione non trovata o scaduta');
      }

      if (session.status !== 'open') {
        throw new Error('Questa sessione è stata chiusa');
      }

      // Cache token and session (temporary only)
      token.value = authToken;
      billSessionId.value = sessionId;
      billSession.value = session;
      isAuthenticated.value = true;

      // Store for potential re-visits (but only for this browser session)
      sessionStorage.setItem(AUTH_TOKEN_KEY, authToken);
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
   * Requires Directus endpoint configured in appConfig
   */
  async function fetchBillSession(sessionId, authToken) {
    const configStore = useConfigStore();
    const directusUrl = configStore.directusUrl;

    if (!directusUrl) {
      // For demo mode without Directus
      return getDemoSession(sessionId);
    }

    try {
      const response = await fetch(`${directusUrl}/items/bill_sessions/${sessionId}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Token non valido o scaduto');
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
      const response = await fetch(`${directusUrl}/items/orders`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token.value}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...orderData,
          bill_session: billSessionId.value,
          status: 'pending',
          source: 'self_order',
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
   */
  async function closeSession() {
    if (!isAuthenticated.value || !billSessionId.value) return;

    const configStore = useConfigStore();
    const directusUrl = configStore.directusUrl;

    if (directusUrl && token.value) {
      try {
        await fetch(`${directusUrl}/items/bill_sessions/${billSessionId.value}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token.value}`,
            'Content-Type': 'application/json',
          },
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
      const response = await fetch(
        `${directusUrl}/items/orders?filter[bill_session][_eq]=${billSessionId.value}&sort=-date_created`,
        {
          headers: {
            'Authorization': `Bearer ${token.value}`,
            'Content-Type': 'application/json',
          },
        }
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
    token.value = null;
    billSessionId.value = null;
    billSession.value = null;
    isAuthenticated.value = false;
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
    sessionStorage.removeItem('selforder_session_id');
  }

  /**
   * Get demo token for testing (remove in production)
   */
  function getDemoToken() {
    // Check if demo mode is enabled
    const configStore = useConfigStore();
    if (configStore.config?.demoMode) {
      return 'demo_token_for_testing';
    }
    return null;
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
    const cachedToken = sessionStorage.getItem(AUTH_TOKEN_KEY);
    const cachedSessionId = sessionStorage.getItem('selforder_session_id');

    if (cachedToken && cachedSessionId) {
      token.value = cachedToken;
      billSessionId.value = cachedSessionId;
      isAuthenticated.value = true;
      return { sessionId: cachedSessionId, token: cachedToken };
    }
    return null;
  }

  return {
    token,
    billSessionId,
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
