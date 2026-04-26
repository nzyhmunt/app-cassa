# Analisi sincronizzazione con Directus remoto

Data: 2026-04-26  
Repository: `nzyhmunt/app-cassa`
Baseline analizzata: `origin/dev` (aggiornata agli ultimi merge in dev)

## 1) Come funziona oggi (sintesi)

La sincronizzazione è implementata in `src/composables/useDirectusSync.js` con modello offline-first:

- **Push**: coda locale `sync_queue` svuotata con `drainQueue()` (`useSyncQueue.js`) ogni 30s e all'evento enqueue.
- **Pull operativo**: polling REST per app (`orders`, `bill_sessions`, `tables`, ecc.) ogni 30s, oppure WebSocket se `wsEnabled=true`.
- **Pull configurazione globale**: deep fetch venue ogni 5 minuti (`_runGlobalPull`) con fan-out su store IDB.
- **Persistenza locale**: IndexedDB (`src/store/idbPersistence.js`) come source of truth runtime.

---

## 2) Aggiornamenti introdotti dagli ultimi merge su dev

Rispetto alla fotografia iniziale, nel ramo `dev` sono entrati miglioramenti importanti:

- **Push queue più robusta** (`useSyncQueue.js`):
  - ordinamento BFS per gruppo `collection:record_id` (migliore fairness tra record);
  - blocco intra-record e gestione dipendenze FK parent→child;
  - stop immediato su network error senza consumare tentativi (`offline: true`);
  - cascade-abandon dei figli quando un parent CREATE è definitivamente abbandonato;
  - log persistente dettagliato su `sync_failed_calls`.
- **Global pull più sicura** (`useDirectusSync.js`):
  - guardia di generazione (`_globalPullGeneration` / `_lastAppliedGlobalPullGeneration`) per evitare apply stale in caso di pull concorrenti;
  - fallback deep-fetch più compatibile;
  - refresh utenti auth (`reloadUsersFromIDB`) dopo fan-out `venue_users`.
- **Osservabilità UI migliorata**:
  - modale log coda sync e fallimenti storici già disponibile in impostazioni.

Questi merge riducono diversi rischi operativi, ma restano alcuni gap strutturali.

---

## 3) Problematiche ancora aperte e proposte

## P1 — Polling REST non rimuove i record cancellati sul remoto

**Evidenza**

- In `_runPull()`/`_pullCollection()` il ciclo polling fa solo upsert (`upsertRecordsIntoIDB`) e non gestisce delete remoti.
- La delete è gestita solo via `_handleSubscriptionMessage(... event === 'delete')`, quindi dipende dal WebSocket.
- `wsEnabled` è `false` di default (`src/utils/index.js`).

**Impatto**

- Con polling-only, i record hard-deleted su Directus possono restare localmente (stale data).
- Rischio incoerenza su menu/link/junction e su alcune viste operative.

**Proposta**

- Aggiungere una strategia di **reconciliation periodica** anche in polling:
  - snapshot IDs remoti + prune locale per collezioni critiche, oppure
  - endpoint/server flow che espone tombstone/delete-log incrementale.
- Mantenere WebSocket come acceleratore, non come unico canale delete.

---

## P2 — Cursor incrementale solo su `date_updated > sinceTs` (rischio missing update)

**Evidenza**

- `_fetchUpdatedViaSDK()` usa filtro `_gt` su `date_updated` e salva solo `latestTs`.

**Impatto**

- Record con stesso timestamp del cursor possono essere persi in finestre di concorrenza (precisione timestamp non sempre sufficiente).

**Proposta**

- Passare a cursor composto:
  - `(date_updated, id)` con ordinamento stabile e tie-breaker su `id`, oppure
  - overlap window (ri-lettura ultimi N secondi + dedup locale per id/versione).

---

## P3 — Cache configurazione: upsert prevalente (tranne table_merge_sessions) e possibili residui

**Evidenza**

- `_fanOutVenueTreeToIDB()` fa upsert per quasi tutti gli store.
- Solo `table_merge_sessions` viene full-replace con `replaceTableMergesInIDB()`.
- I nuovi merge hanno risolto race di apply, ma non il tema “remove-orphan records” su tutte le collection configurative.

**Impatto**

- Se una relazione/configurazione viene rimossa lato Directus (es. link menu_modifiers), il residuo locale può rimanere finché non avviene una pulizia esplicita.

**Proposta**

- Per dataset configurativi derivati dal deep fetch (`menu_*`, `payment_methods`, `printers`, `venue_users`, `rooms`, `tables`) usare modalità **replace atomico** per venue.
- Conservare upsert solo per flussi realmente incrementali.

---

## P4 — Entry in coda ancora rimosse dopo `MAX_ATTEMPTS` (rischio perdita business)

**Evidenza**

- In `drainQueue()` dopo `MAX_ATTEMPTS` l'entry viene rimossa (`abandoned`) e rimane lo storico in `sync_failed_calls`.
- È presente hardening (FK gating, offline short-circuit, cascade-abandon), ma il modello finale resta “drop after max attempts”.

**Impatto**

- In caso di errori sistematici (schema mismatch, permessi token, payload invalido) mutazioni business possono non arrivare mai al remoto.

**Proposta**

- Introdurre stato **dead-letter retryable** (non rimuovere automaticamente dal backlog operativo per collection critiche).
- Aggiungere azioni UI: retry selettivo, correzione payload, export errori, alert esplicito su dashboard.
- Rendere configurabile la policy per collection critiche (`orders`, `bill_sessions`, `transactions`).

---

## P5 — Osservabilità parziale: log presenti, KPI strutturati ancora assenti

**Evidenza**

- Sono presenti log console e modal diagnostico, ma non KPI persistenti/aggregati (tempo medio flush, error rate per collection, queue age, convergenza push→pull).

**Impatto**

- Difficile individuare degradazioni progressive in ambienti reali multi-device.

**Proposta**

- Registrare metriche locali e/o remote:
  - queue depth/age,
  - failure ratio per collection/operation,
  - tempo di convergenza push→pull.
- Esportare health summary nel pannello impostazioni.

---

## 4) Priorità consigliata

1. **Alta**: P1 + P2 (consistenza dati incrementale e delete handling).
2. **Alta**: P4 (riduzione perdita operativa su errori persistenti).
3. **Media**: P3 (coerenza cache configurazione).
4. **Media**: P5 (osservabilità e manutenzione).

---

## 5) Piano di hardening incrementale

- **Fase A (sicurezza dati)**: cursor robusto + delete reconciliation in polling.
- **Fase B (affidabilità)**: dead-letter queue con retry guidato e policy per collection.
- **Fase C (coerenza config)**: replace atomico dataset configurativi per venue.
- **Fase D (operatività)**: metriche sync e alerting UI.
