/**
 * @file store/persistence.js
 * @description Configurazione e utilità per la persistenza locale dell'app.
 *
 * La persistenza è gestita da `pinia-plugin-persistedstate`, configurato
 * direttamente nello store (`src/store/index.js`) tramite l'opzione `persist`.
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
 * Configurazione centralizzata della persistenza.
 *
 * Per aggiornare lo schema a una nuova versione incompatibile:
 *   1. Incrementare `version`.
 *   2. La chiave localStorage risultante cambierà automaticamente (es. `demo_app_state_v2`),
 *      lasciando i dati della versione precedente orfani finché non vengono rimossi dal browser.
 */
export const PERSISTENCE_CONFIG = {
  /** Nome base della chiave; la versione viene aggiunta come suffisso automaticamente. */
  keyName: 'demo_app_state',
  /** Versione corrente dello schema. Incrementare in caso di breaking changes. */
  version: 1,
};

/** Chiave localStorage derivata dalla configurazione. Non modificare direttamente. */
export const STORAGE_KEY = `${PERSISTENCE_CONFIG.keyName}_v${PERSISTENCE_CONFIG.version}`;

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
