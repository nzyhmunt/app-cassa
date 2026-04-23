# Analisi sincronizzazione con Directus remoto

Data: 2026-04-23  
Repository: `nzyhmunt/app-cassa`

## 1) Come funziona oggi (sintesi)

La sincronizzazione è implementata in `src/composables/useDirectusSync.js` con modello offline-first:

- **Push**: coda locale `sync_queue` svuotata con `drainQueue()` (`useSyncQueue.js`) ogni 30s e all'evento enqueue.
- **Pull operativo**: polling REST per app (`orders`, `bill_sessions`, `tables`, ecc.) ogni 30s, oppure WebSocket se `wsEnabled=true`.
- **Pull configurazione globale**: deep fetch venue ogni 5 minuti (`_runGlobalPull`) con fan-out su store IDB.
- **Persistenza locale**: IndexedDB (`src/store/idbPersistence.js`) come source of truth runtime.

---

## 2) Problematiche rilevate e proposte

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

## P3 — Global pull configurazione usa upsert (tranne table_merge_sessions) e può lasciare residui

**Evidenza**

- `_fanOutVenueTreeToIDB()` fa upsert per quasi tutti gli store.
- Solo `table_merge_sessions` viene full-replace con `replaceTableMergesInIDB()`.

**Impatto**

- Se una relazione/configurazione viene rimossa lato Directus (es. link menu_modifiers), il residuo locale può rimanere finché non avviene una pulizia esplicita.

**Proposta**

- Per dataset configurativi derivati dal deep fetch (`menu_*`, `payment_methods`, `printers`, `venue_users`, `rooms`, `tables`) usare modalità **replace atomico** per venue.
- Conservare upsert solo per flussi realmente incrementali.

---

## P4 — Entry in coda abbandonate dopo `MAX_ATTEMPTS` (potenziale perdita operativa)

**Evidenza**

- In `drainQueue()` dopo `MAX_ATTEMPTS` l'entry viene rimossa (`abandoned`) e rimane solo lo storico in `sync_failed_calls`.

**Impatto**

- In caso di errori sistematici (schema mismatch, permessi token, payload invalido) mutazioni business possono non arrivare mai al remoto.

**Proposta**

- Introdurre stato **dead-letter retryable** (non rimuovere automaticamente dal backlog operativo).
- Aggiungere azioni UI: retry selettivo, correzione payload, export errori, alert esplicito su dashboard.
- Rendere configurabile la policy per collection critiche (`orders`, `bill_sessions`, `transactions`).

---

## P5 — Assenza di metriche/telemetria strutturata della sync

**Evidenza**

- Sono presenti log console e modal diagnostico, ma non KPI persistenti (tempo medio flush, error rate per collection, queue age).

**Impatto**

- Difficile individuare degradazioni progressive in ambienti reali multi-device.

**Proposta**

- Registrare metriche locali e/o remote:
  - queue depth/age,
  - failure ratio per collection/operation,
  - tempo di convergenza push→pull.
- Esportare health summary nel pannello impostazioni.

---

## 3) Priorità consigliata

1. **Alta**: P1 + P2 (consistenza dati incrementale e delete handling).
2. **Alta**: P4 (riduzione perdita operativa su errori persistenti).
3. **Media**: P3 (coerenza cache configurazione).
4. **Media**: P5 (osservabilità e manutenzione).

---

## 4) Piano di hardening incrementale

- **Fase A (sicurezza dati)**: cursor robusto + delete reconciliation in polling.
- **Fase B (affidabilità)**: dead-letter queue con retry guidato e policy per collection.
- **Fase C (coerenza config)**: replace atomico dataset configurativi per venue.
- **Fase D (operatività)**: metriche sync e alerting UI.

