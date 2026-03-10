/**
 * @file store/persistence.js
 * @description Persistenza locale dello stato dell'app tramite localStorage.
 *
 * ── Note per la futura migrazione a PWA ──────────────────────────────────────
 * TODO (PWA - IndexedDB): Sostituire localStorage con IndexedDB per gestire
 *   dataset più grandi e operazioni asincrone senza bloccare il thread principale.
 *   Libreria consigliata: idb (https://github.com/jakearchibald/idb)
 *
 * TODO (PWA - Offline-first): Implementare il pattern offline-first:
 *   1. Salvare sempre i dati localmente (IndexedDB) ad ogni modifica.
 *   2. Quando la connessione è disponibile, sincronizzare con Directus API.
 *   3. Gestire i conflitti di sincronizzazione (es. last-write-wins o merge).
 *
 * TODO (PWA - Directus sync): Aggiungere integrazione con Directus:
 *   - Endpoint base: configurare in appConfig.apiUrl
 *   - Autenticazione: bearer token salvato in localStorage
 *   - Collezioni: orders, transactions, cash_movements, daily_closures
 *   - Trigger sync: navigator.onLine listener + Service Worker background sync
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Entrambe le app (Cassa e Sala) condividono la stessa chiave di storage
 * perché girano sulla stessa origine e devono condividere lo stesso stato operativo.
 */

/**
 * Chiave univoca per lo storage.
 * Incrementare la versione in caso di breaking changes allo schema dati.
 */
export const STORAGE_KEY = 'demo_app_state_v1';

/** Versione corrente dello schema di persistenza. */
const STORAGE_VERSION = 1;

/**
 * Serializza e salva lo stato dell'app in localStorage.
 *
 * @param {object} state - Oggetto con i valori correnti delle ref da persistere:
 *   orders, transactions, tableOccupiedAt, billRequestedTables,
 *   tableCurrentBillSession, cashBalance, cashMovements, dailyClosures.
 *
 * TODO (PWA): Sostituire con salvataggio asincrono su IndexedDB.
 *             Dopo il salvataggio locale, accodare una richiesta di sync verso Directus.
 */
export function saveState(state) {
  if (typeof localStorage === 'undefined') return;
  try {
    const serializable = {
      version: STORAGE_VERSION,
      savedAt: new Date().toISOString(),
      orders: state.orders,
      transactions: state.transactions,
      tableOccupiedAt: state.tableOccupiedAt,
      // Set non è direttamente serializzabile in JSON → convertito in Array
      billRequestedTables: Array.from(state.billRequestedTables),
      tableCurrentBillSession: state.tableCurrentBillSession,
      cashBalance: state.cashBalance,
      cashMovements: state.cashMovements,
      dailyClosures: state.dailyClosures,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  } catch (e) {
    // Errori comuni: QuotaExceededError, SecurityError in iframe sandboxed
    console.warn('[Persistence] Impossibile salvare lo stato:', e);
  }
}

/**
 * Cancella lo stato salvato da localStorage, ripristinando i dati di default
 * al successivo caricamento dell'app.
 *
 * Da chiamare prima di ricaricare la pagina (window.location.reload()).
 *
 * TODO (PWA): In aggiunta, notificare Directus (o invalidare il cache IndexedDB) per
 *             allineare il reset anche sui dati remoti, se necessario.
 */
export function clearState() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('[Persistence] Impossibile cancellare lo stato salvato:', e);
  }
}

/**
 * Legge e deserializza lo stato dell'app da localStorage.
 *
 * @returns {object|null} Stato ripristinato, oppure null se assente o non valido.
 *
 * TODO (PWA): Leggere da IndexedDB invece di localStorage.
 *             Se i dati locali risultano obsoleti, recuperare lo stato aggiornato da Directus.
 */
export function loadState() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || data.version !== STORAGE_VERSION) return null;
    return {
      orders: Array.isArray(data.orders) ? data.orders : [],
      transactions: Array.isArray(data.transactions) ? data.transactions : [],
      tableOccupiedAt:
        data.tableOccupiedAt && typeof data.tableOccupiedAt === 'object'
          ? data.tableOccupiedAt
          : {},
      // Riconvertire l'Array salvato in Set per il corretto funzionamento del store
      billRequestedTables: new Set(
        Array.isArray(data.billRequestedTables) ? data.billRequestedTables : [],
      ),
      tableCurrentBillSession:
        data.tableCurrentBillSession && typeof data.tableCurrentBillSession === 'object'
          ? data.tableCurrentBillSession
          : {},
      cashBalance: typeof data.cashBalance === 'number' ? data.cashBalance : 0,
      cashMovements: Array.isArray(data.cashMovements) ? data.cashMovements : [],
      dailyClosures: Array.isArray(data.dailyClosures) ? data.dailyClosures : [],
    };
  } catch (e) {
    console.warn('[Persistence] Impossibile caricare lo stato salvato:', e);
    return null;
  }
}
