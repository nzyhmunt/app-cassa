# Analisi della Coda di Pull — Directus Sync

**Data analisi originale:** 2026-04-30  
**Data aggiornamento:** 2026-04-30 (post-implementazione S1–S7)  
**Repository:** `nzyhmunt/app-cassa`  
**File analizzati:**
- `src/composables/useDirectusSync.js`
- `src/composables/useSyncQueue.js`
- `src/store/persistence/operations.js`
- `src/store/persistence/config.js`
- `src/composables/useIDB.js`

---

## 1. Architettura generale della sincronizzazione

L'app usa un'architettura **offline-first** con due canali di sincronizzazione bidirezionale verso Directus:

```
┌──────────────┐    PUSH (sync_queue)     ┌───────────┐
│   App (IDB)  │ ──────────────────────► │  Directus │
│              │                          │           │
│              │ ◄── PULL (REST/WebSocket)│           │
└──────────────┘                          └───────────┘
```

Il composable `useDirectusSync` è un **singleton a livello di modulo** che gestisce:

| Loop | Meccanismo | Intervallo |
|---|---|---|
| Push loop | `drainQueue()` via REST SDK | ogni 30 s + evento `sync-queue:enqueue` |
| Pull loop | REST polling o WebSocket subscriptions | ogni 30 s (polling) / real-time (WS) |
| Global pull | Deep fetch venue + config | ogni 5 minuti |

**Post S1:** Un solo tab browser per volta è _leader_ e gestisce tutti i loop (Web Locks API). Gli altri tab restano in ascolto passivo.

---

## 2. Flusso della Pull Queue — passo per passo (stato attuale)

### 2.1 Entry point: `startSync()`

```
startSync({ appType, store })
  ├─ [S1] _acquireLeaderLock()               ← leader election via Web Locks API
  │         └─ se non leader → exit (altro tab gestisce i loop)
  ├─ _hydrateConfigFromLocalCache()           ← IDB-first: applica cache locale
  ├─ _runPush()                               ← push immediato coda pendente
  ├─ _runGlobalPull()                         ← deep fetch venue/config da Directus
  ├─ setInterval(_runPush, 30_000)
  ├─ setInterval(_runGlobalPull, 300_000)
  └─ se wsEnabled:
       ├─ _startSubscriptions(collections)
       │    ├─ [S5] _resetWsHeartbeat()       ← avvia watchdog 30s
       │    └─ fallback → _runPull() + setInterval(_runPull, 30_000)
       └─ _runPull() immediato (catch-up)
     altrimenti:
       └─ _runPull() + setInterval(_runPull, 30_000)
```

### 2.2 `_runPull()` — Pull periodico operativo

**[S3]** `_runPull()` ora usa un semaforo `_pullInFlight`: se un pull è già in corso, restituisce la stessa promise invece di avviarne uno nuovo. `forcePull()` azzera il semaforo per garantire che i pull manuali bypassino quelli in background.

Itera sulle **collezioni operative** configurate per tipo di app:

| App | Collezioni |
|---|---|
| cassa | `orders`, `order_items`, `bill_sessions`, `tables` |
| sala | `orders`, `order_items`, `bill_sessions`, `tables`, `menu_items` |
| cucina | `orders`, `order_items` |

### 2.3 `_pullCollection()` — Logica incrementale con cursore

```
_pullCollection(collection, { forceFull, lastPullTimestampOverride })
  ├─ Legge last_pull_ts da IDB (per questa collezione)
  ├─ [S6] Guard clock skew: se cursore > now + 24h → forceFull immediato
  ├─ Loop paginato (page size = 200):
  │    ├─ _fetchUpdatedViaSDK(collection, sinceTs, page)
  │    ├─ _mapRecord() → formato locale
  │    ├─ Se 'order_items':
  │    │    └─ [S7] _atomicOrderItemsUpsertAndMerge()  ← tx atomica ['order_items','orders']
  │    │         ├─ LWW upsert in order_items store
  │    │         └─ merge in orders.orderItems embedded array
  │    ├─ Altrimenti:
  │    │    ├─ _preparePullRecordsForIDB()
  │    │    └─ upsertRecordsIntoIDB()         ← last-write-wins su date_updated
  │    └─ [S2] saveLastPullTsToIDB()          ← checkpoint cursore PER PAGINA (se ok)
  └─ _refreshStoreFromIDB(collection)         ← aggiorna memoria da IDB
```

**[S2] Checkpoint per pagina:** il cursore avanza dopo ogni pagina completata con successo. Un errore su pagina N+1 non annulla il progresso delle pagine 1…N.

**[S6] Guard clock skew:** se `last_pull_ts` è nel futuro oltre `GLOBAL_TIMESTAMP_SKEW_TOLERANCE_MS` (24h), viene forzato un full pull per evitare che un cursore invalido filtri tutti i record recenti.

**[S7] Transazione atomica:** per `order_items`, la scrittura nello store `order_items` e il merge nell'array embedded `orders.orderItems` avvengono in un'unica transazione IDB multi-store. Se la transazione aborts, né lo store né il cursore vengono modificati.

### 2.4 `_fetchUpdatedViaSDK()` — Costruzione query REST

La query usa il **filtro `_gte`** (maggiore o uguale) sul timestamp:

```javascript
filter: {
  _or: [
    { date_updated: { _gte: sinceTs } },
    { _and: [{ date_updated: { _null: true } }, { date_created: { _gte: sinceTs } }] }
  ]
}
```

**Motivazione `_gte` invece di `_gt`:** più PATCH rapide sullo stesso record possono condividere lo stesso timestamp server. Con `_gt` il record di confine verrebbe saltato definitivamente. Con `_gte` viene sempre ri-fetchato (idempotente grazie a LWW in `upsertRecordsIntoIDB`).

**Paginazione:** offset-based (`page=N`), dimensione pagina 200 record. Instabile sotto inserimenti concorrenti (vedi P17).

### 2.5 `upsertRecordsIntoIDB()` — Last-Write-Wins

Strategia di risoluzione conflitti:

```
incoming.ts < existing.ts  → SKIP (record più vecchio)
incoming.ts > existing.ts  → WRITE
incoming.ts = existing.ts  → WRITE se payload diverso, SKIP se identico
existing.ts null           → WRITE sempre
incoming.ts null, existing non null → SKIP
```

Eccezione: `venue_users` — equal-timestamp viene sempre scritto (hash PIN può cambiare senza che il timestamp avanzi).

### 2.6 `_runGlobalPull()` — Deep fetch configurazione venue

Ogni 5 minuti, esegue un **deep fetch** della venue con tutti i nested:

```
readItem('venues', venueId, { fields: ['*', 'rooms.*', 'rooms.tables.*', ...] })
  └─ _fanOutVenueTreeToIDB()
       ├─ Promise.all([
       │    upsertRecordsIntoIDB('venues', ..., { forceWrite: true }),
       │    upsertRecordsIntoIDB('rooms', ...),
       │    upsertRecordsIntoIDB('tables', ...),
       │    upsertRecordsIntoIDB('menu_categories', ...),
       │    upsertRecordsIntoIDB('menu_items', ...),
       │    upsertRecordsIntoIDB('menu_modifiers', ...),
       │    ...
       │  ])                                ← N transazioni IDB parallele (non atomiche!)
       ├─ replaceVenueUsersInIDB()          ← full replace (transazione separata)
       └─ replaceTableMergesInIDB()         ← full replace (transazione separata)
```

**Protezione da race condition:** usa contatori di generazione (`_globalPullGeneration`, `_lastAppliedGlobalPullGeneration`) per ignorare pull più vecchi superati da uno più recente. **Non esiste un semaforo** per prevenire chiamate concorrenti alla funzione stessa (vedi P15).

### 2.7 WebSocket Pull (modalità real-time)

**[S4]** Echo suppression con TTL adattivo: `max(5s, RTT × 3)` cappato a 30s. Connessioni lente ricevono una finestra più ampia.

**[S5]** Watchdog heartbeat: se nessun messaggio WS arriva entro 30s, viene triggerato un REST pull immediato e schedulato un reconnect. Ogni messaggio WS in arrivo resetta il watchdog.

```
client.subscribe(collection, { query: { fields: ['*'], filter: { venue: { _eq: venueId } } } })
  └─ for await (message) → _handleSubscriptionMessage(collection, message)
       ├─ [S5] _resetWsHeartbeat()                ← reset watchdog 30s
       ├─ event = 'create'/'update':
       │    ├─ self-echo suppression [S4] (TTL adattivo)
       │    ├─ orders: mergeOrderFromWSPayload()   ← merge selettivo (preserva campi IDB)
       │    ├─ order_items: mergeOrderItemFromWSPayload()
       │    ├─ upsertRecordsIntoIDB()              ← ⚠️ non atomico (vedi P11)
       │    └─ order_items: _mergeOrderItemsIntoOrdersIDB()  ← ⚠️ tx separata (P11)
       └─ event = 'delete':
            ├─ order_items: _removeOrderItemsFromOrdersIDB() + deleteRecordsFromIDB()
            └─ table_merge_sessions: _pullCollection(forceFull) ← ⚠️ bypassa semaforo S3 (P14)
```

**In caso di disconnessione WS:** [S5] watchdog triggera REST pull + reconnect schedulato. Se il reconnect fallisce, ricade in polling.

---

## 3. Stato dei miglioramenti S1–S7

| ID | Problema risolto | Stato | Note |
|----|-----------------|-------|------|
| **S1** | P1 — Multi-tab leader election | ✅ Implementato | `_acquireLeaderLock()` con Web Locks API; fallback se non supportato |
| **S2** | P2 — Cursore avanza per pagina | ✅ Implementato | `saveLastPullTsToIDB` chiamata dopo ogni pagina con successo |
| **S3** | P9 — Semaforo `_pullInFlight` | ✅ Implementato | `forcePull()` azzera il semaforo per bypassare il background pull |
| **S4** | P6 — Echo TTL adattivo | ✅ Implementato | `max(5s, RTT×3)` cappato a 30s |
| **S5** | P7 — WS heartbeat watchdog | ✅ Implementato | 30s di silenzio → REST pull + reconnect schedulato |
| **S6** | P8 — Guard clock skew | ✅ Implementato | Cursore nel futuro >24h → full pull forzato |
| **S7** | P5 — Merge `orderItems` atomico | ✅ Parziale | Risolto solo per percorso REST pull; il percorso WS rimane non atomico (P11) |

**P1–P10 — riepilogo post-implementazione:**

| # | Problema | Stato |
|---|---|---|
| P1 | Multi-tab pull/push concorrenti | ✅ Risolto da S1 (con limitazione P12) |
| P2 | Cursore non avanza su errore parziale | ✅ Risolto da S2 |
| P3 | Record `date_updated=null` pre-sinceTs | ⚠️ Noto, non risolto (edge case bassa frequenza) |
| P4 | Race condition WS+REST su `orders` | ⚠️ Mitigato da `mergeOrderFromWSPayload`, non eliminato |
| P5 | Merge `orderItems` non atomico | ✅ Parziale (REST ok; WS ancora non atomico, vedi P11) |
| P6 | Echo TTL fisso 5s | ✅ Risolto da S4 |
| P7 | WS silent disconnect ~25s blind window | ✅ Risolto da S5 (watchdog 30s) |
| P8 | Clock skew cursore nel futuro | ✅ Risolto da S6 |
| P9 | Pull concorrenti senza semaforo | ✅ Risolto da S3 |
| P10 | `forceFull` `table_merge_sessions` non coordinato | ⚠️ Ancora presente (vedi P14) |

---

## 4. Nuovi problemi identificati (P11–P18)

### P11 — **WS `order_items` ancora non atomica (S7 residuale)**

**Severità:** Media

**Descrizione:** S7 ha reso atomica la scrittura REST (`_pullCollection` → `_atomicOrderItemsUpsertAndMerge`). Tuttavia, il percorso **WebSocket** per eventi `create`/`update` su `order_items` usa ancora la sequenza non atomica in due passi:

```javascript
// _handleSubscriptionMessage() — percorso WS order_items create/update
await upsertRecordsIntoIDB(collection, prepared);        // ← TX 1: scrive order_items
// ...
await _mergeOrderItemsIntoOrdersIDB(prepared, nonEcho);  // ← TX 2: separa (orders only)
await _refreshStoreFromIDB('orders');
```

Se `_mergeOrderItemsIntoOrdersIDB` fallisce dopo che `upsertRecordsIntoIDB` ha già scritto, il negozio `order_items` sarà aggiornato ma l'array embedded `orders.orderItems` rimarrà stale. La prossima pull REST (atomica via S7) risolverebbe l'inconsistenza, ma nel frattempo (fino a 30s) la cucina o la cassa potrebbero vedere dati incoerenti.

**Soluzione proposta (NS1):** Usare `_atomicOrderItemsUpsertAndMerge` anche nel percorso WS, passando `prepared` come `mappedItems` e `nonEcho` come `rawItems`.

---

### P12 — **Tab non-leader stranded se il leader viene chiuso**

**Severità:** Alta

**Descrizione:** S1 usa `ifAvailable: true` nell'acquisizione del lock. I tab non-leader ricevono `lock = null` immediatamente e terminano `startSync()` senza creare nessuna richiesta in coda. Se il tab leader viene chiuso (o crasha), il browser rilascia automaticamente il lock, ma i tab non-leader non vengono notificati e non hanno alcun meccanismo di retry automatico.

**Scenario concreto:**
1. Tab A (leader) gestisce push/pull
2. Tab A viene chiuso dall'utente
3. Tab B e C (sala, cucina) rimangono aperte — `_running = false`, nessun loop attivo
4. I tab B e C mostrano dati stale e non sincronizzano più fino al reload

**Soluzione proposta (NS2):** Usare `navigator.locks.request('directus-sync-leader', { mode: 'exclusive' })` **senza** `ifAvailable: true` per i tab non-leader. In questo modo i tab seguono una coda: quando il leader lascia il lock, il prossimo tab in coda diventa automaticamente leader. In alternativa, usare un `BroadcastChannel` per che il tab leader annunci periodicamente la sua attività, e i follower rilevino il silenzio e tentino il lock.

```javascript
// Tab non-leader: richiesta con coda invece di ifAvailable
navigator.locks.request('directus-sync-leader', { mode: 'exclusive' }, async (lock) => {
  // questo tab ora è leader — avvia i loop
  await _startSyncLoops();
  // mantiene il lock fino a stopSync()
  await holdPromise;
});
```

---

### P13 — **`_fanOutVenueTreeToIDB` non atomica: config venue parzialmente aggiornata**

**Severità:** Media

**Descrizione:** La scrittura della config venue usa transazioni IDB **separate** per ogni store:

```javascript
// _fanOutVenueTreeToIDB() — non atomico
await Promise.all([
  upsertRecordsIntoIDB('venues', ...),       // TX 1
  upsertRecordsIntoIDB('rooms', ...),        // TX 2
  upsertRecordsIntoIDB('tables', ...),       // TX 3
  // ... altre 6 transazioni parallele
]);
await replaceVenueUsersInIDB(...);           // TX N+1
await replaceTableMergesInIDB(...);          // TX N+2
```

Se una transazione intermedia fallisce (es. `replaceVenueUsersInIDB` dopo che tables è già scritto), IDB rimarrà con una versione parziale della config: menu aggiornato, utenti NON aggiornati. Una cassa con utenti stale potrebbe:
- Accettare PIN revocati
- Non vedere nuovi operatori
- Mostrare tabelle inesistenti con metodi di pagamento aggiornati

**Soluzione proposta (NS3):** Wrappare tutti gli store di config (esclusi `orders`, `order_items`) in un'unica transazione IDB multi-store. IDB supporta transazioni su store multipli purché specificati al momento della creazione. Alternativa: scrivere prima in un "config staging store" e poi committare atomicamente via versioning.

---

### P14 — **WS `table_merge_sessions` delete bypassa il semaforo S3**

**Severità:** Bassa

**Descrizione:** In `_handleSubscriptionMessage`, un evento `delete` su `table_merge_sessions` chiama direttamente `_pullCollection('table_merge_sessions', { forceFull: true })`, bypassando il semaforo `_pullInFlight` che protegge `_runPull()`:

```javascript
if (collection === 'table_merge_sessions') {
  await _pullCollection('table_merge_sessions', { forceFull: true }); // bypassa S3
  return;
}
```

Questo può creare pull concorrenti tra il forceFull e un `_runPull()` che include `table_merge_sessions`. Le due pull possono leggere lo stesso `last_pull_ts`, scrivere dati sovrapposti, e chiamare `replaceTableMergesInIDB()` in parallelo.

**Soluzione proposta (NS4):** Schedulare il forceFull attraverso `_runPull({ collections: ['table_merge_sessions'], forceFull: true })` o usare un semaforo separato per `table_merge_sessions`.

---

### P15 — **`_runGlobalPull()` senza semaforo: chiamate concorrenti possibili**

**Severità:** Bassa

**Descrizione:** Il timer globale (`setInterval` ogni 5 minuti) può scatenare chiamate concorrenti a `_runGlobalPull()` se il deep fetch richiede più di 5 minuti (connessioni molto lente o venue con molti record). Anche `reconfigureAndApply()` può chiamare `_runGlobalPull()` mentre il timer è già in corso. Il sistema di generazione counter (`_lastAppliedGlobalPullGeneration`) previene l'applicazione di config stale, ma **non previene le richieste HTTP ridondanti** verso Directus.

**Soluzione proposta (NS5):** Aggiungere un semaforo `_globalPullInFlight` analogo a `_pullInFlight` di S3.

---

### P16 — **Tab non-leader non ricevono aggiornamenti IDB in tempo reale**

**Severità:** Media

**Descrizione:** Con S1, solo il tab leader aggiorna IDB via pull/push. I tab non-leader hanno `_running = false` e mostrano i dati caricati all'avvio. Non c'è alcun meccanismo di notifica cross-tab delle modifiche IDB:
- La sala aperta come tab follower non vedrà gli ordini aggiornati dalla cassa (tab leader)
- La cucina follower non vedrà i nuovi `order_items` pullati dal leader
- Un reload manuale è necessario per vedere i dati aggiornati

**Soluzione proposta (NS6):** Implementare un `BroadcastChannel('directus-sync-idb-changed')` nel tab leader che notifica i follower quando IDB viene modificato. I follower chiamano `loadStateFromIDB()` in risposta, aggiornando il loro reactive store senza fare richieste di rete.

```javascript
// Leader (dopo ogni _refreshStoreFromIDB):
const bc = new BroadcastChannel('directus-sync-idb-changed');
bc.postMessage({ collection, type: 'updated', ts: Date.now() });

// Follower (in startSync quando non è leader):
const bc = new BroadcastChannel('directus-sync-idb-changed');
bc.onmessage = async ({ data }) => {
  await _refreshStoreFromIDB(data.collection);
};
```

---

### P17 — **Paginazione offset instabile sotto inserimenti concorrenti**

**Severità:** Bassa

**Descrizione:** `_fetchUpdatedViaSDK` usa paginazione basata su offset (`page=N`, 200 record/pagina). Se durante il fetch di pagina 1 vengono inseriti nuovi record con timestamp in range `[sinceTs, now]`, le pagine successive vengono "spostate" di N posizioni. Risultato: alcuni record possono essere saltati tra una pagina e l'altra e non recuperati fino al successivo ciclo di pull.

```
Pagina 1 (record 1-200 ordinati per date_updated ASC)
← inserimento record X con date_updated nel range
Pagina 2 (record 202-401) ← record 201 saltato!
```

L'idempotenza LWW garantisce che i duplicati non causino corruzione, ma i record _saltati_ non saranno recuperati fino al prossimo ciclo completo (30s polling) o fino al prossimo WS evento.

**Soluzione proposta (NS7):** Sostituire la paginazione offset con keyset pagination usando un cursore compound `(date_updated, id)`:

```javascript
// Keyset pagination invece di page=N
filter: { _and: [
  { date_updated: { _gte: sinceTs } },
  { _or: [
    { date_updated: { _gt: lastSeenTs } },
    { _and: [{ date_updated: { _eq: lastSeenTs } }, { id: { _gt: lastSeenId } }] }
  ]}
]}
```

---

### P18 — **`forcePull()` non interrompe il pull in volo**

**Severità:** Bassa

**Descrizione:** `forcePull()` azzera `_pullInFlight = null` e avvia un nuovo pull, ma non interrompe il pull già in esecuzione. Per un breve periodo esistono due pull concorrenti: quello "vecchio" (in background, non più referenziato da `_pullInFlight`) e quello "nuovo" (forzato dall'utente).

Conseguenze:
- Il cursore S2 potrebbe essere aggiornato dal pull vecchio dopo che quello nuovo ha già avanzato oltre
- `_refreshStoreFromIDB` viene chiamato due volte in rapida successione → re-render UI doppio
- Se il pull vecchio era in una pagina avanzata (es. pagina 5) e il nuovo ricomincia da pagina 1, ci sarà un breve periodo di dati "degradati"

A differenza del push (che usa `AbortController` per annullare il drain in volo), il pull non ha un meccanismo di abort.

**Soluzione proposta (NS8):** Aggiungere un `AbortController` al pull, con flag `_pullAbortController` analogo a `_pushAbortController`. `forcePull()` chiama `_pullAbortController?.abort()` prima di resettare il semaforo, e ogni `_fetchUpdatedViaSDK` passa il signal al client SDK.

---

## 5. Mappa del flusso con rischi evidenziati (stato attuale)

```
startSync()
  │
  ├─[S1] Leader election ─────────────────────────────────────────
  │         └─ [P12] Tab follower: nessun fallback automatico     │
  │                                                                │
  ├─[S3] _runPull() ──────────────────────────────────────────────►
  │         │                                                      │
  │         ├─ _pullCollection('orders')                          │
  │         │    ├─[S2] cursore per pagina ✅                     │
  │         │    ├─[S6] clock skew guard ✅                       │
  │         │    └─[P3] record pre-sinceTs null ⚠️ (edge case)   │
  │         │                                                      │
  │         └─ _pullCollection('order_items')                     │
  │              └─[S7] tx atomica ✅ (REST only)                  │
  │                                                                │
  ├─[P15] _runGlobalPull() senza semaforo ⚠️                      │
  │         └─[P13] _fanOutVenueTreeToIDB non atomica ⚠️         │
  │                                                                │
  ├─ setInterval(_runPull, 30s) [S3 protegge] ✅                   │
  │                                                                │
  └─ wsEnabled?                                                    │
       ├─[S4] echo TTL adattivo ✅                                 │
       ├─[S5] heartbeat watchdog 30s ✅                            │
       ├─[P4] WS+REST race su orders ⚠️ (mitigato, non eliminato) │
       ├─[P11] WS order_items non atomica ⚠️                      │
       └─[P14] WS table_merge_sessions bypassa semaforo ⚠️        │
                                                                   │
[P16] Tab follower: UI stale senza BroadcastChannel ⚠️ ──────────┘
```

---

## 6. Soluzioni proposte per i nuovi problemi

### NS1 — WS `order_items` path atomica (estensione S7)

Usare `_atomicOrderItemsUpsertAndMerge` anche in `_handleSubscriptionMessage`:

```javascript
// In _handleSubscriptionMessage() — sostituire il blocco order_items create/update
if (collection === 'order_items') {
  // Unifica in un'unica transazione atomica (come fa _pullCollection via S7)
  await _atomicOrderItemsUpsertAndMerge(prepared, nonEcho);
  await _refreshStoreFromIDB('orders');
} else {
  await upsertRecordsIntoIDB(collection, prepared);
  await _refreshStoreFromIDB(collection);
}
```

Impatto: risolve P11 completamente. Bassa complessità (riuso della funzione esistente).

---

### NS2 — Tab non-leader con coda automatica (miglioramento S1)

Separare l'acquisizione in due modalità:

```javascript
async function _acquireLeaderLock() {
  if (!navigator?.locks) return true; // fallback: tutti leader

  return new Promise((resolve) => {
    let resolved = false;

    // Tentativo immediato (ifAvailable)
    navigator.locks.request('directus-sync-leader',
      { mode: 'exclusive', ifAvailable: true },
      async (lock) => {
        if (lock) {
          if (!resolved) { resolved = true; resolve(true); }
          await holdPromise; // mantieni fino a stopSync()
        } else {
          // Non disponibile — registra per la coda
          navigator.locks.request('directus-sync-leader',
            { mode: 'exclusive' },
            async (queuedLock) => {
              if (queuedLock && _running) {
                // Diventa leader quando il precedente rilascia
                _isLeader = true;
                await _startSyncLoops();
                await holdPromise;
              }
            }
          );
          if (!resolved) { resolved = true; resolve(false); }
        }
      }
    );
  });
}
```

Impatto: risolve P12. Il follower diventa automaticamente leader quando il precedente chiude il tab.

---

### NS3 — Config venue atomica (IDB multi-store transaction)

```javascript
async function _fanOutVenueTreeToIDB_atomic(venueRecord, { menuSource }) {
  const db = await getDB();
  // Tutti gli store di config in un'unica transazione
  const CONFIG_STORES = [
    'venues', 'rooms', 'tables', 'payment_methods',
    'menu_categories', 'menu_items', 'menu_modifiers',
    'menu_categories_menu_modifiers', 'menu_items_menu_modifiers',
    'printers', 'venue_users', 'table_merge_sessions',
  ];
  const tx = db.transaction(CONFIG_STORES, 'readwrite');
  // ... scrive tutti gli store dentro la stessa tx ...
  await tx.done;
}
```

Impatto: risolve P13. Complessità media (richiede refactoring di `upsertRecordsIntoIDB` per accettare una tx esistente).

---

### NS4 — `table_merge_sessions` WS delete via semaforo S3

```javascript
// In _handleSubscriptionMessage — invece di chiamare direttamente _pullCollection:
if (collection === 'table_merge_sessions') {
  // Usa _runPull con override per rispettare il semaforo
  _pullInFlight = null; // forza bypass del semaforo (come forcePull)
  _runPull({ forceFullCollections: new Set(['table_merge_sessions']) }).catch(() => {});
  return;
}
```

Oppure: implementare un semaforo separato `_tableSessionPullInFlight`.

---

### NS5 — Semaforo per `_runGlobalPull()`

```javascript
let _globalPullInFlight = null;

async function _runGlobalPull({ onProgress = null } = {}) {
  if (_globalPullInFlight) return _globalPullInFlight;
  _globalPullInFlight = (async () => {
    try {
      // ... logica attuale ...
    } finally {
      _globalPullInFlight = null;
    }
  })();
  return _globalPullInFlight;
}
```

---

### NS6 — `BroadcastChannel` per notifiche cross-tab IDB

```javascript
// Leader: dopo ogni _refreshStoreFromIDB(collection)
const _idbChangeBroadcast = new BroadcastChannel('directus-idb-changed');
_idbChangeBroadcast.postMessage({ collection, ts: Date.now() });

// Follower: in startSync() quando non è leader
const _idbChangeBroadcast = new BroadcastChannel('directus-idb-changed');
_idbChangeBroadcast.onmessage = async ({ data }) => {
  if (!_store) return;
  await _refreshStoreFromIDB(data.collection);
};
```

Impatto: risolve P16. Tutti i tab vedono i dati aggiornati entro pochi ms dalla scrittura IDB del leader.

---

### NS7 — Keyset pagination per `_fetchUpdatedViaSDK`

Sostituire `page=N` con paginazione cursor-based usando `(date_updated ASC, id ASC)`:

```javascript
// Dopo ogni pagina: cattura il cursore per la prossima
let afterTs = storedSinceTs;
let afterId = null;
while (true) {
  const filter = buildKeysetFilter(afterTs, afterId, venueFilter);
  const data = await client.request(readItems(collection, {
    sort: ['date_updated', 'id'],
    limit: 200,
    filter,
  }));
  if (data.length === 0) break;
  // Aggiorna il cursore per la prossima pagina
  const last = data[data.length - 1];
  afterTs = last.date_updated;
  afterId = last.id;
  // ... process ...
  if (data.length < 200) break;
}
```

---

### NS8 — `AbortController` per il pull in volo

```javascript
let _pullAbortController = null;

async function _runPull() {
  if (_pullInFlight) return _pullInFlight;
  const ac = new AbortController();
  _pullAbortController = ac;
  _pullInFlight = (async () => {
    try {
      // Passa ac.signal a _fetchUpdatedViaSDK
      for (const collection of pullCfg.collections) {
        const { merged, ok } = await _pullCollection(collection, { signal: ac.signal });
        // ...
      }
    } finally {
      _pullInFlight = null;
      _pullAbortController = null;
    }
  })();
  return _pullInFlight;
}

// In forcePull():
_pullAbortController?.abort(); // annulla il pull in volo
_pullAbortController = null;
_pullInFlight = null;
```

---

## 7. Priorità degli interventi aggiornata

### Problemi originali P1–P10 (post S1–S7)

| # | Problema | Stato | Azione richiesta |
|---|---|---|---|
| P1 | Multi-tab | ✅ Risolto (S1 + limitazione P12) | Vedi NS2 |
| P2 | Cursore su errore parziale | ✅ Risolto (S2) | — |
| P3 | Record `date_updated=null` | ⚠️ Edge case | Nessuna (bassa frequenza) |
| P4 | Race WS+REST su orders | ⚠️ Mitigato | Monitorare |
| P5 | Merge non atomico REST | ✅ Risolto (S7) | — |
| P5-WS | Merge non atomico WS | ⚠️ Residuo | NS1 🔴 |
| P6 | Echo TTL fisso | ✅ Risolto (S4) | — |
| P7 | WS silent disconnect | ✅ Risolto (S5) | — |
| P8 | Clock skew | ✅ Risolto (S6) | — |
| P9 | Pull concorrenti | ✅ Risolto (S3) | — |
| P10 | `table_merge_sessions` forceFull | ⚠️ Residuo | NS4 🟡 |

### Nuovi problemi P11–P18

| # | Problema | Severità | Complessità fix | Priorità |
|---|---|---|---|---|
| P11 | WS `order_items` non atomica | Media | Bassa | 🔴 Alta |
| P12 | Tab follower stranded | Alta | Media | 🔴 Alta |
| P16 | Tab follower UI stale | Media | Bassa | 🔴 Alta |
| P13 | Config venue non atomica | Media | Alta | 🟡 Media |
| P14 | WS `table_merge_sessions` bypassa semaforo | Bassa | Bassa | 🟡 Media |
| P15 | `_runGlobalPull` senza semaforo | Bassa | Bassa | 🟡 Media |
| P18 | `forcePull` non interrompe pull in volo | Bassa | Media | 🟡 Media |
| P17 | Paginazione offset instabile | Bassa | Alta | 🟢 Bassa |

---

## 8. Riferimenti al codice (stato attuale)

| File | Riga indicativa | Descrizione |
|---|---|---|
| `useDirectusSync.js` | ~741 | `_pullCollection()` — logica cursore con S2, S6, S7 |
| `useDirectusSync.js` | ~280 | `_fetchUpdatedViaSDK()` — query REST con paginazione offset |
| `useDirectusSync.js` | ~390 | `_mergeOrderItemsIntoOrdersIDB()` — usata ancora dal percorso WS (P11) |
| `useDirectusSync.js` | ~550 | `_atomicOrderItemsUpsertAndMerge()` — usata solo da `_pullCollection` |
| `useDirectusSync.js` | ~879 | `_handleSubscriptionMessage()` — WS handler con P11 residuo |
| `useDirectusSync.js` | ~1042 | `_startSubscriptions()` con S5 heartbeat |
| `useDirectusSync.js` | ~1394 | `_resetWsHeartbeat()` — S5 |
| `useDirectusSync.js` | ~1430 | `_acquireLeaderLock()` — S1 (P12 residuo) |
| `useDirectusSync.js` | ~1463 | `_runPull()` con semaforo S3 (P18 residuo) |
| `useDirectusSync.js` | ~1309 | `_runPush()` con AbortController (modello per NS8) |
| `useDirectusSync.js` | ~1693 | `_fanOutVenueTreeToIDB()` — P13 (non atomica) |
| `useDirectusSync.js` | ~1910 | `_runGlobalPull()` — P15 (no semaforo) |
| `useDirectusSync.js` | ~2192 | `startSync()` — entry point con S1 |
| `useDirectusSync.js` | ~2271 | `stopSync()` — rilascia lock S1 |
| `useDirectusSync.js` | ~2328 | `forcePull()` — P18 residuo |
| `useSyncQueue.js` | ~731 | `drainQueue()` — drain BFS con AbortSignal |
| `persistence/operations.js` | ~420 | `upsertRecordsIntoIDB()` — LWW |
