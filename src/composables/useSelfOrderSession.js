import { ref } from 'vue';
import { useConfigStore, useOrderStore } from '../store/index.js';

export function useSelfOrderSession() {
  const configStore = useConfigStore();
  const orderStore = useOrderStore();
  
  const session = ref(null);
  const loading = ref(false);
  const error = ref(null);

  async function initSession(sessionId) {
    loading.value = true;
    error.value = null;
    
    try {
      // Find the bill session from Directus or local storage
      const billSession = await findBillSession(sessionId);
      
      if (!billSession) {
        throw new Error('Sessione non trovata o scaduta');
      }
      
      if (billSession.status !== 'open') {
        throw new Error('Questa sessione è già stata chiusa');
      }
      
      session.value = {
        id: billSession.id,
        tableId: billSession.table,
        tableName: getTableName(billSession.table),
        venueId: billSession.venue,
        adults: billSession.adults,
        children: billSession.children,
        openedAt: billSession.opened_at,
        items: [],
      };
      
      // Store session in localStorage for persistence
      localStorage.setItem('selforder_session', JSON.stringify(session.value));
      
      return session.value;
    } catch (e) {
      error.value = e.message;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function findBillSession(sessionId) {
    // First check local store
    const localSession = await getLocalBillSession(sessionId);
    if (localSession) {
      return localSession;
    }
    
    // Then try Directus API
    try {
      const response = await fetch(
        `${configStore.directusUrl}/items/bill_sessions/${sessionId}`,
        {
          headers: {
            'Authorization': `Bearer ${configStore.directusToken}`,
          },
        }
      );
      
      if (response.ok) {
        const data = await response.json();
        return data.data;
      }
    } catch (e) {
      console.warn('[SelfOrderSession] Directus fetch failed:', e);
    }
    
    return null;
  }

  async function getLocalBillSession(sessionId) {
    // Try to get from IndexedDB orderStore
    const billSessions = await orderStore.getBillSessions?.();
    if (billSessions) {
      return billSessions.find(s => s.id === sessionId);
    }
    return null;
  }

  function getTableName(tableId) {
    const tables = configStore.tables || [];
    const table = tables.find(t => t.id === tableId);
    return table?.name || `Tavolo ${tableId}`;
  }

  async function endSession() {
    if (!session.value) return;
    
    loading.value = true;
    
    try {
      // Close the bill session in Directus
      await closeBillSession(session.value.id);
      
      // Clear local session
      session.value = null;
      localStorage.removeItem('selforder_session');
    } catch (e) {
      error.value = e.message;
      console.error('[SelfOrderSession] Failed to end session:', e);
    } finally {
      loading.value = false;
    }
  }

  async function closeBillSession(sessionId) {
    try {
      await fetch(
        `${configStore.directusUrl}/items/bill_sessions/${sessionId}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${configStore.directusToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            status: 'closed',
            closed_at: new Date().toISOString(),
          }),
        }
      );
    } catch (e) {
      console.warn('[SelfOrderSession] Failed to close session in Directus:', e);
    }
  }

  function restoreSession() {
    const saved = localStorage.getItem('selforder_session');
    if (saved) {
      try {
        session.value = JSON.parse(saved);
      } catch {
        localStorage.removeItem('selforder_session');
      }
    }
  }

  // Restore session on init
  restoreSession();

  return {
    session,
    loading,
    error,
    initSession,
    endSession,
  };
}
