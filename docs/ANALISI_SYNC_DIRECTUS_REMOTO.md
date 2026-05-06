# Analisi sincronizzazione con Directus remoto

Data: 2026-05-01 (aggiornata alle ultime modifiche disponibili su branch collegato e merge su `dev`)  
Repository: `nzyhmunt/app-cassa`
Baseline analizzata: `origin/dev` (`9fd4fb6`) + `origin/copilot/document-pull-queue-functionality` (`2fa3e0f`) (stacked branch collegato)

## 1) Come funziona oggi (sintesi)

La sincronizzazione è implementata con modello offline-first nel layer `src/composables/sync/*` (entrypoint pubblico `useDirectusSync`):

- **Push**: coda locale `sync_queue` svuotata con `drainQueue()` (`sync/pushQueue.js` + `useSyncQueue.js`) ogni 30s e all'evento enqueue.
- **Pull operativo**: polling REST/keyset per app (`orders`, `bill_sessions`, `tables`, ecc.) ogni 30s, oppure WebSocket se `wsEnabled=true`.
- **Pull configurazione globale**: deep fetch venue ogni 5 minuti (`sync/globalPull.js`) con fan-out su store IDB.
- **Persistenza locale**: IndexedDB (`src/store/idbPersistence.js`) come source of truth runtime.

---

## 2) Aggiornamenti introdotti nel branch collegato (`copilot/document-pull-queue-functionality`) e merge successivi

Rispetto alla fotografia iniziale, nel branch collegato sono entrati hardening rilevanti:

- **Refactoring architetturale sync**:
  - estrazione di `useDirectusSync.js` in moduli dedicati (`sync/pullQueue.js`, `sync/globalPull.js`, `sync/wsManager.js`, `sync/leaderElection.js`, ecc.);
  - maggiore separazione tra loop push/pull/global pull, stato condiviso e bridge store.
- **Push queue più robusta** (`sync/pushQueue.js` + `useSyncQueue.js`):
  - ordinamento BFS per gruppo `collection:record_id` (migliore fairness tra record);
  - blocco intra-record e gestione dipendenze FK parent→child;
  - stop immediato su network error senza consumare tentativi (`offline: true`);
  - cascade-abandon dei figli quando un parent CREATE è definitivamente abbandonato;
  - supporto PWA background sync (`sync-orders`) quando la rete torna disponibile.
- **Pull incrementale più solida** (`sync/pullQueue.js`):
  - passaggio da `_gt` a `_gte` sul cursore temporale;
  - keyset pagination con cursore composto (`timestamp + id`) per ridurre missing/duplicazioni ai boundary.
- **Global pull più sicura** (`sync/globalPull.js`):
  - guardia di generazione (`_globalPullGeneration` / `_lastAppliedGlobalPullGeneration`) per evitare apply stale in caso di pull concorrenti;
  - fan-out IDB in transazione multi-store atomica;
  - refresh utenti auth (`reloadUsersFromIDB`) dopo fan-out `venue_users`.
- **Multi-tab e osservabilità migliorate**:
  - leader election con Web Locks + BroadcastChannel per aggiornare i follower;
  - `SyncMonitor` con telemetria base (`wsDropCount`, `queueDepth`, `lastSuccessfulPull`) e badge nuovi dati.

Queste modifiche chiudono parte delle criticità iniziali (in particolare la robustezza del cursor pull) ma restano alcuni gap strutturali.

Ulteriori hardening entrati dopo il precedente aggiornamento dell'analisi:

- **Cursor pull e keyset ulteriormente consolidati** (`pullQueue.js`):
  - allineamento sort keyset e fix su guard LWW in presenza di `date_updated` nullo;
  - riduzione write amplification: evitato `saveLastPullTsToIDB` ridondante quando il timestamp non avanza.
- **Global pull più coerente a runtime** (`globalPull.js`):
  - `put()` attesi esplicitamente nel fan-out per conteggi scritture affidabili;
  - migliorata la consistenza del refresh follower con payload `ids` mirati su BroadcastChannel.
- **Multi-tab più stabile** (`leaderElection.js`, `storebridge.js`, `state.js`):
  - guardia anti self-loop su BroadcastChannel via `sourceId`;
  - cleanup `onmessage` in promozione leader per evitare loop/handler stale.
- **Merge order items e refresh store più robusti** (`idbOperations.js`, `orderStore.js`, `wsManager.js`):
  - tracking `affectedOrderIds` anche nel percorso fallback di delete;
  - normalizzazione PK a `String` e inserimento ordini mancanti nel refresh mirato.
- **Difese su input edge-case**:
  - guardie difensive per input null/invalid in normalizzazione IDB (`idbOperations.js`, `persistence/config.js`).
- **Osservabilità estesa**:
  - telemetria runtime ampliata (inclusi eventi delete `order_items`) e monitor attività con badge nuovi dati;
  - gestione più sicura del background sync in Service Worker (`.catch` esplicito su `sync-orders`).

---

## 3) Problematiche ancora aperte e proposte (post branch collegato)

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

## P2 — Cursor incrementale (stato: mitigato nel branch collegato)

**Evidenza**

- Nel branch collegato il filtro è passato a `_gte` con keyset pagination e tie-breaker su `id`.
- Rimane comunque una strategia timestamp-based (non event-log/tombstone), quindi la correttezza dipende da qualità timestamp e ordinamento lato API.

**Impatto**

- Il rischio di missing update al boundary è fortemente ridotto rispetto alla versione precedente.

**Proposta**

- Mantenere test di regressione sul boundary `(timestamp,id)` e introdurre monitoraggio dedicato su duplicati/missing nei cicli lunghi.

---

## P3 — Cache configurazione: upsert prevalente (tranne table_merge_sessions) e possibili residui

**Evidenza**

- `_fanOutVenueTreeToIDB()` fa upsert per quasi tutti gli store.
- `table_merge_sessions` e `venue_users` sono in full-replace, mentre gli altri store restano in modalità upsert.
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

## P5 — Osservabilità ancora parziale: migliorata lato runtime, KPI storici ancora assenti

**Evidenza**

- Nel branch collegato sono stati aggiunti KPI runtime (`wsDropCount`, `queueDepth`, `lastSuccessfulPull`) e monitor UI.
- Gli ultimi merge hanno ampliato la telemetria/eventistica e il tracciamento attività/badge nuovi dati.
- Mancano ancora KPI storici/persistenti e aggregazioni diagnostiche complete (tempo medio flush, error rate per collection, queue age, convergenza push→pull su orizzonte esteso).

**Impatto**

- Difficile individuare degradazioni progressive in ambienti reali multi-device.

**Proposta**

- Registrare metriche locali e/o remote:
  - queue depth/age,
  - failure ratio per collection/operation,
  - tempo di convergenza push→pull.
- Esportare health summary nel pannello impostazioni.

---

## 4) Priorità consigliata (post aggiornamento)

1. **Alta**: P1 (delete reconciliation in polling).
2. **Alta**: P4 (riduzione perdita operativa su errori persistenti).
3. **Media**: P3 (coerenza cache configurazione e prune residui).
4. **Media**: P5 (telemetria persistente e KPI operativi avanzati).

---

## 5) Piano di hardening incrementale (revisionato)

- **Fase A (sicurezza dati)**: delete reconciliation in polling (cursor robusto già migliorato nel branch collegato).
- **Fase B (affidabilità)**: dead-letter queue con retry guidato e policy per collection.
- **Fase C (coerenza config)**: replace atomico dataset configurativi per venue.
- **Fase D (operatività)**: metriche sync e alerting UI.
