# Checklist Migrazione — Layered Architecture (IDB-First)

> **Obiettivo**: completare il passaggio all'architettura a strati dove
> IndexedDB è l'**unica Fonte di Verità**.  
> Flusso target: `Mapper → IDB → Pinia (read-only hydration) → Sync Queue → Directus`.
>
> Legenda priorità: **P0** = critico / blocca correttezza dati · **P1** = necessario / debito
> tecnico rilevante · **P2** = miglioramento / pulizia.

---

## P0 — Critici (correttezza dati, rischio perdita / corruzione)

### P0-1 · Invertire il flusso write in `useOrderStore`

**File**: `src/store/index.js`

- [x] Ogni azione che produce una mutazione persistente deve seguire l'ordine
  1. **Scrivi su IDB** (`saveOrdersToIDB`, `upsertRecordsIntoIDB`, ecc.)
  2. **Aggiorna lo stato Pinia** (reactivity)
  3. **Enqueue** per sync remoto
- [x] Azioni da correggere in ordine di rischio:
  - `addOrder` / `addDirectOrder` — mutano `orders.value` prima di `saveOrdersToIDB`
  - `changeOrderStatus` — aggiorna campo inline poi salva
  - `addTransaction` — costruisce `txn`, lo pusha in `transactions.value` e **poi** chiama `enqueue`
  - `openTableSession` — muta `tableCurrentBillSession.value` prima di `enqueue('bill_sessions', …)`
  - `recordCashMovement` — stessa sequenza inversa
- [x] Aggiungere test di regressione per ogni azione corretta che verifichino
  l'ordine effettivo delle chiamate IDB vs stato reattivo.

---

### P0-2 · Completare il push di `transaction_order_refs` e `transaction_voce_refs`

**File**: `src/store/index.js`, `src/composables/useSyncQueue.js`

- [x] In `addTransaction` (path `analitica`), dopo aver creato la transazione, fare
  `enqueue('transaction_order_refs', 'create', ref.id, ref)` per ogni entry di `orderRefs`.
- [x] Stesso per `transaction_voce_refs`: iterare `vociRefs` e fare enqueue di ogni record.
- [x] Aggiungere IDB pre-save (`upsertRecordsIntoIDB`) delle stesse righe prima di enqueue.
- [x] Aggiungere test di integrazione che simulino un pagamento analitico e
  verifichino che le junction rows arrivino in sync queue.

---

### P0-3 · Rimuovere mutazioni dirette di `appConfig` da componenti e composables

**File**: `src/composables/useSettings.js`, `src/composables/useDirectusClient.js`,
         `src/components/shared/DirectusSyncSettings.vue`

- [x] Censire tutti i punti che scrivono direttamente su `appConfig.*` al di fuori
  di `useDirectusSync.js` / `applyDirectusConfigToAppConfig`.
- [x] Per le impostazioni UI (sounds, menuUrl, ecc.) convogliare la persistenza
  attraverso `useConfigStore.saveLocalSettings(…)` → IDB → `local_settings`.
- [x] Per le impostazioni Directus (`directus.*`) convogliare tramite
  `useConfigStore.saveDirectusSettings(…)` → IDB → `app_settings`.
- [x] Rimuovere gli `Object.assign(appConfig, …)` sparsi; l'unico punto legittimo
  di aggiornamento runtime di `appConfig` deve essere `applyDirectusConfigToAppConfig`.

---

### P0-4 · Rendere `useDirectusSync` IDB-only (eliminare mutazioni dirette Pinia)

**File**: `src/composables/useDirectusSync.js`

- [x] Rimuovere `_mergeIntoStore`, `_deleteFromStore`, `_syncStoreConfigSnapshot`
  come chiamate che scrivono direttamente su `_store.*`.
- [x] Sostituire con:
  1. `upsertRecordsIntoIDB(collection, records)` — salva in IDB
  2. Emetti evento / chiama `store.hydrateFromIDB()` — lo store legge da IDB e
     aggiorna il reattivo
- [x] La funzione `_syncPreBillPrinterSelection` (che scrive `_store.preBillPrinterId`)
  è un'eccezione legittima di UI state; documentarla esplicitamente o spostarla
  nel composable `useSettings`.

---

## P1 — Necessari (debito tecnico, inconsistenze nominali, sicurezza integrità)

### P1-1 · Unificare la strategia dei mapper per il push (Sync Queue)

**File**: `src/utils/mappers.js`, `src/composables/useSyncQueue.js`

- [x] In `useSyncQueue._toDirectusPayload` sostituire la logica di conversione
  inline con le funzioni `map<Entity>ToDirectus` già definite in `mappers.js`.
- [x] Verificare che `mapBillSessionToDirectus` usi `adults`/`children`
  invece dei campi legacy `adults_count`/`children_count`.
- [x] Rimuovere i duplicati inline in `useSyncQueue` una volta che i mapper sono
  usati sistematicamente.

---

### P1-2 · `performDailyClose` — aggiungere persistenza IDB e sync

**File**: `src/store/reportOps.js`

- [x] `performDailyClose` svuota `transactions.value` e `cashMovements.value` solo
  in memoria senza salvare il closure in IDB né enqueue verso Directus.
- [x] Aggiungere:
  1. `upsertRecordsIntoIDB('daily_closures', [closure])` prima di azzerare le array
  2. `enqueue('daily_closures', 'create', closure.id, closure)`
  3. Eventualmente `enqueue('daily_closure_by_method', 'create', …)` per i dettagli per metodo

---

### P1-3 · Eliminare il pull menu da Directus quando `menuSource === 'json'`

**File**: `src/composables/useDirectusSync.js` → `_runGlobalPull`

- [ ] Quando `menuSource === 'json'`, saltare completamente il deep-fetch dei campi
  menu nel payload di `readItem('venues', venueId, { fields: … })`.
- [ ] Rimuovere dai `DEEP_FETCH_FIELDS` i campi
  `rooms.*`, `tables.*`, `menu_categories.*`, `menu_items.*`, `menu_modifiers.*`
  quando la fonte è `json` (richiedere solo `id`, `name`, `status` e i campi billing/cover_charge).

---

### P1-4 · Correggere `initStoreFromIDB` per essere strettamente IDB-only

**File**: `src/store/index.js` → `initStoreFromIDB`

- [ ] Spostare la chiamata a `configStore.loadMenu({ skipHydrate: true })` fuori
  dall'init IDB, in un passo separato del bootstrap (es. `App.vue` lifecycle).
- [ ] `initStoreFromIDB` deve leggere solo da IndexedDB e non fare fetch di rete.

---

### P1-5 · Aggiungere `table_merge_sessions` al flush reset

**File**: `src/store/idbPersistence.js` → `clearAllStateFromIDB`

- [x] Verificare che la funzione di reset svuoti anche `table_merge_sessions`,
  `transaction_order_refs`, `transaction_voce_refs`, `daily_closures`,
  `daily_closure_by_method`, `bill_sessions`, `fiscal_receipts`, `invoice_requests`.
- [x] Il reset deve azzerare il DB **intero** (eccetto `local_settings`), non solo
  gli store operativi.

---

### P1-6 · Allineamento schema — rimuovere legacy `adults_count`/`children_count`

**File**: `src/utils/mappers.js`, `DATABASE_SCHEMA.md`

- [ ] Rimuovere ogni riferimento a `adults_count`/`children_count` nel mapper
  `mapBillSessionToDirectus` e nei punti di hydration.
- [ ] Aggiornare `DATABASE_SCHEMA.md` section 2.8 per rispecchiare i campi correnti.
- [ ] Su Directus: rimuovere (o nascondere) i campi legacy se ancora presenti.

---

## P2 — Pulizia / miglioramenti (debito tecnico non bloccante)

### P2-1 · Completare dismissione `menu_item_modifiers`

**File**: `DATABASE_SCHEMA.md`, `src/composables/useIDB.js`

- [ ] Aggiornare il diagramma relazioni in `DATABASE_SCHEMA.md` (section 3) per
  rimuovere la freccia `menu_items ──< menu_item_modifiers` e sostituire con
  il modello M2M via `menu_modifiers` + junction.
- [ ] Valutare se mantenere l'ObjectStore `menu_item_modifiers` in IDB o rimuoverlo.
- [ ] Su Directus: deprecare / archiviare la collection `menu_item_modifiers`.

---

### P2-2 · Rimuovere mapper e funzioni legacy non usati

**File**: `src/utils/mappers.js`

- [ ] Verificare con `grep -n "map.*ToDirectus\|map.*FromDirectus"` quali funzioni
  non sono mai invocate al di fuori dei test e rimuoverle o marcarle `@deprecated`.
- [ ] Documentare chiaramente quali mapper sono "entry point ufficiali" del layer.

---

### P2-3 · Rinominare variabile `demo_app_state` in `persistence.js`

**File**: `src/store/persistence.js`

- [ ] Il prefisso `demo_app_state` nel `storageKey` è residuo legacy.
- [ ] Rinominare (con bump del valore SCHEMA_VERSION) in `app_state` o in qualcosa
  di semanticamente corretto.

---

### P2-4 · Documentare `clearState` come deprecata

**File**: `src/store/persistence.js`

- [ ] La funzione `clearState()` è un thin wrapper fire-and-forget su
  `clearAllStateFromIDB()`; documentare la deprecazione e invitare i caller
  a usare direttamente `clearAllStateFromIDB()`.

---

### P2-5 · Aggiornare `DATABASE_SCHEMA.md` section 2.17 (`app_settings`)

**File**: `DATABASE_SCHEMA.md`

- [ ] Indicare esplicitamente che `app_settings` **non è sincronizzata** nel
  runtime corrente (il sync attivo usa `local_settings` IDB-side).
- [ ] Se confermata la non-sincronizzazione, segnare il campo per deprecazione
  backend o pianificare l'implementazione del sync.

---

### P2-6 · Aggiungere mapping e uso di `venues.billing_auto_close_on_full_payment`

**File**: `src/utils/mappers.js`, `src/composables/useDirectusSync.js`

- [ ] Il campo è presente nello schema Directus ma non mappato in
  `applyVenueRecordToConfig`.
- [ ] Aggiungere mapping verso `appConfig.billing.autoCloseOnFullPayment` o
  rimuovere il campo da Directus se la funzionalità non è prevista.

---

## Riepilogo conteggio

| Priorità | Item | Stato |
|----------|------|-------|
| P0       | 4    | ✅ 4/4 completati |
| P1       | 6    | 🟨 3/6 completati (P1-1, P1-2, P1-5) |
| P2       | 6    | ⬜ tutti aperti |

---

## Ordine di esecuzione consigliato

```
P0-2 (transaction refs)     ← zero dipendenze, rischio dati immediato
P0-1 (write order IDB-first) ← richiede P0-2 completato per test ordinati
P0-4 (sync IDB-only)         ← dipende da un hydrateFromIDB stabile (P0-1)
P0-3 (appConfig mutations)   ← dipende da useConfigStore stabile
P1-2 (daily close IDB)       ← standalone
P1-5 (reset completo)        ← standalone
P1-1 (mapper unification)    ← dopo P0-1 stabile
P1-3 (skip menu pull)        ← dopo P1-1
P1-4 (init IDB-only)         ← dopo P0-1/P0-3
P1-6 (legacy fields)         ← coordinare con release Directus
P2-*                         ← in qualunque slot libero
```
