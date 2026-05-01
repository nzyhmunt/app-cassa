# Analisi della Coda di Pull — Directus Sync

**Data analisi originale:** 2026-04-30  
**Data ultimo aggiornamento:** 2026-05-01 (post-implementazione NS1–NS8 + fix architetturali + refactoring modulare)  
**Repository:** `nzyhmunt/app-cassa`  
**File analizzati (dopo refactoring modulare `sync/`):**
- `src/composables/sync/config.js` — costanti, liste collezioni, quirks
- `src/composables/sync/state.js` — stato singleton condiviso
- `src/composables/sync/mapper.js` — mapping record Directus → IDB
- `src/composables/sync/echoSuppression.js` — TTL echo-suppression
- `src/composables/sync/idbOperations.js` — helper IDB atomici
- `src/composables/sync/pullQueue.js` — loop pull REST incrementale
- `src/composables/sync/pushQueue.js` — drain coda push REST
- `src/composables/sync/wsManager.js` — gestione WebSocket
- `src/composables/sync/globalPull.js` — deep fetch config venue
- `src/composables/sync/storebridge.js` — bridge store ↔ IDB
- `src/composables/sync/leaderElection.js` — leader election + composable pubblico
- `src/store/orderStore.js` — reactive store ordini (con refresh mirato)
- `src/store/persistence/operations.js` — `upsertRecordsIntoIDB`, `deleteRecordsFromIDB`
- `src/store/persistence/config.js` — config persistence helpers
- `src/composables/useSyncQueue.js` — `drainQueue()` push BFS

---

## 1. Architettura generale della sincronizzazione

L'app usa un'architettura **offline-first** con due canali di sincronizzazione bidirezionale verso Directus:

```
┌──────────────┐    PUSH (sync_queue)         ┌───────────┐
│   App (IDB)  │ ────────────────────────────► │  Directus │
│              │                               │           │
│              │ ◄── PULL (REST / WebSocket)── │           │
└──────────────┘                               └───────────┘
       ▲  │ NS6 BroadcastChannel
       │  │ (leader → follower tabs)
       ▼  ▼
  [Altri tab browser]
```

Il codice è stato **refactorizzato** da un singolo `useDirectusSync.js` (~2600 righe) in 11 moduli nella directory `src/composables/sync/`. Il composable pubblico `useDirectusSync()` è esportato da `leaderElection.js` tramite `src/composables/sync/index.js`.

| Loop | File | Meccanismo | Intervallo |
|---|---|---|---|
| Push loop | `pushQueue.js` | `drainQueue()` via REST SDK | ogni 30 s + evento `sync-queue:enqueue` |
| Pull loop | `pullQueue.js` | REST polling o WebSocket | ogni 30 s (polling) / real-time (WS) |
| Global pull | `globalPull.js` | Deep fetch venue + config | ogni 5 minuti |
| Leader election | `leaderElection.js` | Web Locks API | una tantum per tab |

**Post NS1–NS8:** Un solo tab browser per volta è _leader_ e gestisce tutti i loop (Web Locks API). I tab follower si auto-promuovono a leader quando il leader chiude (standby lock queue). I follower ricevono notifiche cross-tab via `BroadcastChannel('directus-sync-idb-changes')` e aggiornano il loro store in-memory senza fare richieste di rete.

---

## 2. Flusso della Pull Queue — passo per passo (stato attuale)

### 2.1 Entry point: `startSync()` → `leaderElection.js`

```
startSync({ appType, store })
  ├─ [NS6] Apre BroadcastChannel('directus-sync-idb-changes')
  ├─ [S1+NS2] _acquireLeaderLock()               ← leader election via Web Locks API
  │    ├─ ifAvailable → se immediato: isLeader = true
  │    └─ se non disponibile → _isLeader = false + standby in coda (NS2 auto-promozione)
  │         └─ [NS6] registra onmessage per aggiornare store da notifiche IDB leader
  ├─ _hydrateConfigFromLocalCache()              ← IDB-first: applica cache locale prima di rete
  ├─ _runPush()                                  ← push immediato coda pendente
  ├─ _runGlobalPull()                            ← deep fetch venue/config da Directus
  ├─ setInterval(_runPush, 30_000)
  ├─ setInterval(_runGlobalPull, 300_000)
  └─ se wsEnabled:
       ├─ _startSubscriptions(collections)
       │    ├─ [S5] _resetWsHeartbeat()          ← avvia watchdog 30s
       │    └─ fallback → _runPull() + setInterval(_runPull, 30_000)
       └─ _runPull() immediato (catch-up iniziale)
     altrimenti:
       └─ _runPull() + setInterval(_runPull, 30_000)
```

### 2.2 `_runPull()` — Pull periodico operativo → `pullQueue.js`

**[S3]** `_runPull()` usa un semaforo `syncState._pullInFlight`: se un pull è già in corso restituisce la stessa promise invece di avviarne uno nuovo. `forcePull()` azzera il semaforo e incrementa `_pullGeneration` per garantire che i pull manuali bypassino quelli in background.

**[NS8]** Un `AbortController` (`syncState._pullAbortController`) è mintato all'avvio di ogni pull. `forcePull()` e `stopSync()` lo abortano prima di resettare il semaforo. Il loop di pagine controlla `signal.aborted` prima di ogni fetch, così un pull in corso su pagina N termina immediatamente al confine della pagina.

Itera sulle **collezioni operative** per tipo app:

| App | Collezioni |
|---|---|
| cassa | `orders`, `order_items`, `bill_sessions`, `tables` |
| sala | `orders`, `order_items`, `bill_sessions`, `tables`, `menu_items` |
| cucina | `orders`, `order_items` |

### 2.3 `_pullCollection()` — Logica incrementale con cursore → `pullQueue.js`

```
_pullCollection(collection, { forceFull, signal })
  ├─ Legge last_pull_ts da IDB (loadLastPullTsFromIDB)
  ├─ [S6] Guard clock skew: se cursore > now + 24h → clamp a now + save → pull incrementale
  ├─ Loop paginato (page size = 200):
  │    ├─ [NS8] check signal.aborted → exit se abortito
  │    ├─ _fetchUpdatedViaSDK(collection, sinceTs, page, pageKeyCursor)
  │    ├─ _mapRecord() → formato IDB locale
  │    ├─ Se 'order_items':
  │    │    └─ [S7] _atomicOrderItemsUpsertAndMerge(mapped, data)
  │    │         ├─ Phase 1: LWW upsert in 'order_items' ObjectStore
  │    │         │    └─ skipInPhase2 set: items IDB già più recenti
  │    │         └─ Phase 2: merge in 'orders.orderItems' embedded array
  │    │              └─ esclude items in skipInPhase2
  │    │         → Ritorna { orderItemsWritten, ordersWritten, affectedOrderIds }
  │    ├─ Altrimenti:
  │    │    ├─ _preparePullRecordsForIDB()   ← preserva orderItems se assenti nel payload
  │    │    └─ upsertRecordsIntoIDB()        ← last-write-wins su date_updated
  │    └─ [S2] saveLastPullTsToIDB()         ← checkpoint cursore PER PAGINA (se ok)
  └─ _refreshStoreFromIDB(collection, affectedOrderIds?)
       └─ per 'order_items': refresh mirato solo sugli ordini modificati (no full re-render)
```

**[S2] Checkpoint per pagina:** il cursore avanza dopo ogni pagina completata con successo. Un errore su pagina N+1 non annulla il progresso delle pagine 1…N.

**[S6] Guard clock skew:** se `last_pull_ts` è nel futuro oltre `GLOBAL_TIMESTAMP_SKEW_TOLERANCE_MS` (24h), il cursore viene troncato a `Date.now()` e persistito in IDB — il pull incrementale prosegue normalmente. Un orologio di sistema permanentemente disallineato provoca al massimo un reset del cursore per ciclo invece di un full pull continuo (comportamento pre-S6).

**[S7] Transazione atomica:** per `order_items`, la scrittura nello store `order_items` e il merge nell'array embedded `orders.orderItems` avvengono in un'unica transazione IDB multi-store `['order_items','orders']`. Se la transazione aborts, né lo store né il cursore vengono modificati.

### 2.4 `_fetchUpdatedViaSDK()` — Costruzione query REST → `pullQueue.js`

La query usa il **filtro `_gte`** (maggiore o uguale) sul timestamp:

```javascript
// modalità incrementale (page 1)
filter: {
  _or: [
    { date_updated: { _gte: sinceTs } },
    { _and: [{ date_updated: { _null: true } }, { date_created: { _gte: sinceTs } }] }
  ]
}
```

**Motivazione `_gte` invece di `_gt`:** più PATCH rapide sullo stesso record nello stesso millisecondo condividono il medesimo timestamp. Con `_gt` il record di confine verrebbe saltato definitivamente. Con `_gte` viene sempre ri-fetchato (idempotente grazie a LWW in `upsertRecordsIntoIDB`).

**[NS7] Keyset pagination:** dalla pagina 2 in poi si attiva la paginazione keyset con cursore compound `{ id, ts }`:

```javascript
// isKeysetMode = true (page 2+)
filter: {
  _or: [
    { date_updated: { _gt: cursor.ts } },
    { _and: [{ date_updated: { _eq: cursor.ts } }, { id: { _gt: cursor.id } }] },
    { _and: [{ date_updated: { _null: true } }, { date_created: { _gte: sinceTs } }, { id: { _gt: cursor.id } }] }
  ]
}
// + page: 1  (nessun offset quando il cursore è attivo)
```

Questo evita il "double-skipping" (offset + keyset filter sullo stesso set già filtrato) e impedisce loop infiniti su batch di record senza `date_updated`.

### 2.5 `upsertRecordsIntoIDB()` — Last-Write-Wins → `persistence/operations.js`

```
incoming.ts < existing.ts  → SKIP (record più vecchio)
incoming.ts > existing.ts  → WRITE
incoming.ts = existing.ts  → WRITE se payload diverso, SKIP se identico
existing.ts null           → WRITE sempre (nessun precedente)
incoming.ts null, existing non null → SKIP
```

Eccezione: `venue_users` — equal-timestamp viene sempre scritto (hash PIN può cambiare senza che il timestamp avanzi).

### 2.6 `_runGlobalPull()` — Deep fetch configurazione venue → `globalPull.js`

Ogni 5 minuti, esegue un **deep fetch** della venue con tutti i nested:

```
_runGlobalPull({ onProgress })
  ├─ [NS5] _globalPullInFlight semaforo → dedup pull concorrenti
  ├─ [_globalPullGeneration] counter → ignora pull stale superati da uno più recente
  └─ _runGlobalPullInner()
       ├─ readItem('venues', venueId, { fields: ['*', nested...] })
       ├─ [NS3] _fanOutVenueTreeToIDB() → unica tx IDB multi-store (12 store)
       │    ├─ normalizeVenueUsersForIDB() → pre-hash PIN fuori transazione
       │    └─ db.transaction([...12 CONFIG_STORES...], 'readwrite')
       │         └─ tutte le scritture nella stessa tx atomica
       └─ _applyDirectusRuntimeConfigToAppConfig()
```

**[NS5]** Semaforo `_globalPullInFlight`: se un global pull è già in corso, la chiamata successiva del timer (o di `reconfigureAndApply`) si aggancia alla stessa promise invece di avviare richieste HTTP ridondanti.

**[NS3]** `_fanOutVenueTreeToIDB` scrive tutti e 12 gli store di config venue in un'unica transazione IDB multi-store. Se un write intermedio fallisce, nessuno store viene modificato (atomicità garantita dall'IDB).

### 2.7 WebSocket Pull (modalità real-time) → `wsManager.js`

**[S4]** Echo suppression con TTL adattivo: `max(5s, RTT × 3)` cappato a 30s.

**[S5]** Watchdog heartbeat: se nessun messaggio WS arriva entro 30s, viene triggerato un REST pull immediato e schedulato un reconnect. Ogni messaggio WS in arrivo resetta il watchdog.

**[Issue 3 fix]** LWW echo suppression: per i record nella finestra TTL, viene confrontato `r.date_updated` con il valore IDB locale. Se il payload incoming è più recente (aggiornato da un altro device dopo il push di questo device), il record viene lasciato passare invece di essere soppresso come echo.

```
_handleSubscriptionMessage(collection, message)
  ├─ [S5] _resetWsHeartbeat()                    ← reset watchdog
  ├─ event = 'delete':
  │    ├─ self-echo filter (TTL sincrono)
  │    ├─ order_items: _removeOrderItemsFromOrdersIDB(nonEchoIds)  ← tx atomica
  │    │    └─ → ritorna affectedOrderIds (NP1 fix)
  │    │    └─ _refreshStoreFromIDB('orders', affectedOrderIds)    ← refresh mirato
  │    └─ table_merge_sessions: [NS4] _tableMergePullInFlight semaforo
  │         └─ _pullCollection('table_merge_sessions', forceFull)
  └─ event = 'create'/'update':
       ├─ [Issue 3] LWW echo guard (IDB get + confronto timestamp)
       ├─ orders update: mergeOrderFromWSPayload()  ← merge selettivo
       ├─ order_items update: mergeOrderItemFromWSPayload()
       ├─ [NS1] order_items: _atomicOrderItemsUpsertAndMerge(prepared, nonEcho)
       │    └─ → ritorna affectedOrderIds
       │    └─ _refreshStoreFromIDB('orders', affectedOrderIds)   ← refresh mirato
       └─ altri: upsertRecordsIntoIDB() + _refreshStoreFromIDB()
```

**In caso di disconnessione WS:** [S5] watchdog triggera REST pull + reconnect schedulato. Se il reconnect fallisce, ricade in polling.

### 2.8 Refresh reattivo mirato → `storebridge.js` + `orderStore.js`

```
_refreshStoreFromIDB(collection, affectedIds?)
  ├─ Se leader: _idbChangeBroadcast.postMessage({ type: 'idb-change', collection })
  └─ refreshOperationalStateFromIDB(collection, ids?)
       ├─ Se collection = 'orders' E ids è Set non vuoto:
       │    └─ [Issue 4 fix] refresh mirato: carica solo gli ordini in `ids` da IDB
       │         └─ splice in-place: solo gli slot modificati vengono rimpiazzati
       └─ Altrimenti: full refresh (carica tutto lo store dal IDB)
```

L'`orderStore.js` implementa il refresh mirato con `splice` in-place invece di `orders.value = orders.value.map(...)`, evitando il rimpiazzo dell'intero array reattivo e il re-render completo della lista ordini.

---

## 3. Stato dei miglioramenti S1–S7 e NS1–NS8

### S1–S7 (problemi originali P1–P10)

| ID | Problema risolto | Stato | File |
|----|-----------------|-------|------|
| **S1** | P1 — Multi-tab leader election | ✅ | `leaderElection.js` |
| **S2** | P2 — Cursore avanza per pagina | ✅ | `pullQueue.js` |
| **S3** | P9 — Semaforo `_pullInFlight` | ✅ | `pullQueue.js` + `state.js` |
| **S4** | P6 — Echo TTL adattivo | ✅ | `echoSuppression.js` |
| **S5** | P7 — WS heartbeat watchdog 30s | ✅ | `wsManager.js` |
| **S6** | P8 — Guard clock skew | ✅ | `pullQueue.js` (clamp + incrementale, no full pull) |
| **S7** | P5 — Merge `orderItems` atomico | ✅ | `idbOperations.js` (`_atomicOrderItemsUpsertAndMerge`) |

### NS1–NS8 (nuovi problemi P11–P18)

| ID | Problema risolto | Stato | File |
|----|-----------------|-------|------|
| **NS1** | P11 — WS `order_items` non atomica | ✅ | `wsManager.js` |
| **NS2** | P12 — Tab follower stranded | ✅ | `leaderElection.js` (standby lock queue) |
| **NS3** | P13 — Config venue non atomica | ✅ | `globalPull.js` (tx 12-store) |
| **NS4** | P14 — WS `table_merge_sessions` bypassa semaforo | ✅ | `wsManager.js` (`_tableMergePullInFlight`) |
| **NS5** | P15 — `_runGlobalPull` senza semaforo | ✅ | `globalPull.js` (`_globalPullInFlight`) |
| **NS6** | P16 — Tab follower UI stale | ✅ | `leaderElection.js` + `storebridge.js` (BroadcastChannel) |
| **NS7** | P17 — Paginazione offset instabile | ✅ | `pullQueue.js` (keyset cursor `{id, ts}`) |
| **NS8** | P18 — `forcePull` non interrompe pull in volo | ✅ | `pullQueue.js` + `leaderElection.js` (AbortController) |

### Fix architetturali post-review

| ID | Problema risolto | Stato | File |
|----|-----------------|-------|------|
| **Issue 1** | WS delete `order_items` non atomica | ✅ | `idbOperations.js` (`_removeOrderItemsFromOrdersIDB` tx) |
| **Issue 2** | Loop infinito keyset null-date | ✅ | `pullQueue.js` (`id._gt` nel ramo null-date) |
| **Issue 3** | Echo suppression LWW cross-device | ✅ | `wsManager.js` (IDB get + confronto ts) |
| **Issue 4** | Store churn full `orders.value.map()` | ✅ | `orderStore.js` (splice in-place) |
| **Fix 1** | `_isLeader = false` per follower | ✅ | `leaderElection.js` |
| **Fix 2** | `skipInPhase2` stale incoming in Phase 2 | ✅ | `idbOperations.js` |
| **Fix 3** | JSDoc `_atomicOrderItemsUpsertAndMerge` | ✅ | `idbOperations.js` |
| **Fix 4** | `_pullGeneration` evita clear semaforo stale | ✅ | `pullQueue.js` |
| **Fix 5** | `_globalPullInFlight` reset in `reconfigureAndApply` | ✅ | `leaderElection.js` |
| **NP1** | WS delete `order_items` refresh non mirato | ✅ | `idbOperations.js` + `wsManager.js` |

**P1–P10 — stato finale:**

| # | Problema | Stato |
|---|---|---|
| P1 | Multi-tab pull/push concorrenti | ✅ Risolto (S1 + NS2) |
| P2 | Cursore non avanza su errore parziale | ✅ Risolto (S2) |
| P3 | Record `date_updated=null` pre-sinceTs | ⚠️ Edge case noto, bassa frequenza |
| P4 | Race condition WS+REST su `orders` | ⚠️ Mitigato da `mergeOrderFromWSPayload` |
| P5 | Merge `orderItems` non atomico (REST) | ✅ Risolto (S7) |
| P5-WS | Merge `orderItems` non atomico (WS) | ✅ Risolto (NS1 + Issue 1) |
| P6 | Echo TTL fisso 5s | ✅ Risolto (S4) |
| P7 | WS silent disconnect blind window | ✅ Risolto (S5) |
| P8 | Clock skew cursore nel futuro | ✅ Risolto (S6) |
| P9 | Pull concorrenti senza semaforo | ✅ Risolto (S3) |
| P10 | `table_merge_sessions` forceFull non coordinato | ✅ Risolto (NS4) |

---

## 4. Analisi post-NS: nuovi problemi individuati (NP1–NP6)

### NP1 — **WS delete `order_items` refresh non mirato** ✅ RISOLTO

**Severità:** Media (performance)  
**File:** `idbOperations.js`, `wsManager.js`

**Descrizione (pre-fix):** `_removeOrderItemsFromOrdersIDB` calcolava `affectedOrderIds` internamente ma restituiva `void`. Il chiamante in `wsManager.js` eseguiva sempre `_refreshStoreFromIDB('orders')` senza IDs → rimpiazzo dell'intero array `orders.value` → re-render completo della lista ordini per ogni WS delete di un singolo item.

**Fix applicato (commit corrente):**
- `_removeOrderItemsFromOrdersIDB` ora restituisce `Promise<Set<string>>` degli order ID effettivamente modificati.
- `wsManager.js` usa il `Set` per un refresh mirato via `_refreshStoreFromIDB('orders', affectedOrderIds)`.

```javascript
// idbOperations.js — dopo tx.done:
return affectedOrderIds;  // invece di void

// wsManager.js — nel path WS delete order_items:
const affectedOrderIds = await _removeOrderItemsFromOrdersIDB(nonEchoIds);
await _refreshStoreFromIDB('orders', affectedOrderIds.size > 0 ? affectedOrderIds : undefined);
```

**Impatto:** Elimina il re-render completo della lista ordini su ogni WS delete di un order_item. Su una cassa con 100+ ordini attivi, riduce il costo dell'operazione da O(n) a O(k) dove k è il numero di ordini effettivamente modificati (tipicamente 1).

---

### NP2 — **SDK client re-istanziato per ogni pagina fetch** ⚠️ PERFORMANCE

**Severità:** Bassa (overhead minore)  
**File:** `pullQueue.js` — `_fetchUpdatedViaSDK()`  
**Priorità:** 🟢 Bassa

**Descrizione:** Un nuovo `createDirectus()` client viene creato ad ogni chiamata a `_fetchUpdatedViaSDK()`. Per una collezione paginata su N pagine si creano N istanze SDK separate.

```javascript
// pullQueue.js — per ogni pagina:
export async function _fetchUpdatedViaSDK(collection, sinceTs, page = 1, cursor = null) {
  const cfg = _getCfg();
  const client = _buildRestClient(cfg); // ← nuova istanza per ogni pagina!
  // ...
}
```

**Impatto:** Minimo. Le connessioni HTTP sono riutilizzate dal browser tramite connection pooling. L'overhead è limited al JavaScript object allocation (~1 KB/istanza) e alla configurazione dell'SDK. Non è un problema di correttezza.

**Soluzione proposta:** Creare il client una volta in `_pullCollection` e passarlo a `_fetchUpdatedViaSDK` come parametro opzionale. In alternativa, cache del client per hash di configurazione a livello di modulo.

---

### NP3 — **Clock skew guard non rileva cursore corrotto al passato**

**Severità:** Molto bassa (edge case estremo)  
**File:** `pullQueue.js` — `_pullCollection()`  
**Priorità:** 🟢 Bassa

**Descrizione:** Il guard S6 rileva solo skew nel futuro (`skewMs > GLOBAL_TIMESTAMP_SKEW_TOLERANCE_MS`). Non controlla se `last_pull_ts` è corrotto verso un valore nel passato estremo (es. epoch `1970-01-01T00:00:00.000Z`). In quel caso ogni ciclo di sync ri-fetcha l'intera storia del database.

```javascript
// pullQueue.js — guard attuale:
if (skewMs > GLOBAL_TIMESTAMP_SKEW_TOLERANCE_MS) {
  // gestito: cursore nel futuro
}
// ← manca check: cursore nel passato estremo (es. < 2020-01-01)
```

**Scenario:** IDB corrotto o migrazione anomala imposta `last_pull_ts = '1970-01-01'`. Ogni ciclo esegue un full pull senza che il sistema lo rilevi come anomalo.

**Soluzione proposta:** Aggiungere un limite inferiore al guard:
```javascript
const CURSOR_FLOOR_MS = new Date('2020-01-01').getTime();
const tooFarPast = storedSinceTsMs < CURSOR_FLOOR_MS;
if (tooFarPast) {
  console.warn(`[DirectusSync] Cursor on ${collection} predates floor (${storedSinceTs}). Resetting to floor.`);
  storedSinceTs = new Date(CURSOR_FLOOR_MS).toISOString();
  await saveLastPullTsToIDB(collection, storedSinceTs);
}
```

---

### NP4 — **`_globalPullInFlight` + `reconfigureAndApply`: finestra di race minima**

**Severità:** Molto bassa (probabilità quasi nulla)  
**File:** `leaderElection.js` — `reconfigureAndApply()`  
**Priorità:** 🟢 Bassa

**Descrizione:** `reconfigureAndApply()` esegue `syncState._globalPullInFlight = null` prima di chiamare `_runGlobalPull({ onProgress })`. Se il timer globale (`setInterval` ogni 300 s) scatta nel microsecondo tra il null reset e la `_runGlobalPull` call, il timer avvia un nuovo pull senza `onProgress`. La chiamata di `reconfigureAndApply` si aggancerà a questo pull (il semaforo NS5 è già impostato dal timer), perdendo silenziosamente il callback `onProgress`.

**Impatto:** Nessuna perdita di dati. Il config viene applicato correttamente. L'utente potrebbe non vedere la barra di avanzamento in `reconfigureAndApply`. La probabilità è praticamente nulla (finestra di ~1 μs nell'arco di 300 s).

**Soluzione:** Non urgente. Potrebbe essere mitigato passando `onProgress` come parametro aggiuntivo del semaforo, ma la complessità non giustifica l'intervento.

---

### NP5 — **WS echo suppression: `date_created` non usato nel LWW guard**

**Severità:** Nulla (comportamento corretto)  
**File:** `wsManager.js`

**Descrizione (analisi):** Il guard LWW per echo suppression usa solo `r.date_updated ?? null` e `local.date_updated ?? null`, ignorando `date_created`. Per i record mai patchati (date_updated = null) il confronto è `null vs null` → `isCrossDeviceUpdate = false` → il record è soppresso come echo.

**Verdetto:** Il comportamento è **corretto**. Un record con `date_updated = null` non può essere una "modifica cross-device" via PATCH perché Directus imposta `date_updated` su ogni PATCH. L'unico caso in cui `date_updated = null` arriva via WS è una CREATE, e le CREATE sono già fuori dalla finestra TTL echo (il TTL è specifico per il `(collection, id)` preso dal push, e una CREATE da un altro device avrà un ID non registrato nel TTL locale). Nessun fix necessario.

---

### NP6 — **`_handleSubscriptionMessage`: IDB `getDB()` chiamata due volte per `order_items` update**

**Severità:** Bassa (performance minore)  
**File:** `wsManager.js`  
**Priorità:** 🟢 Bassa

**Descrizione:** Per eventi `update`/`create` su `order_items`, il codice chiama `getDB()` in tre punti:
1. Nel loop LWW echo guard: `db = await getDB()`
2. Nel blocco order_items selective merge: `const db = await getDB()`
3. Implicitamente in `_atomicOrderItemsUpsertAndMerge`: `const db = await getDB()`

`getDB()` restituisce una promise cached (il DB è già aperto), quindi non apre connessioni multiple. L'overhead è solo il `await` di una micro-task di risoluzione per call aggiuntiva. In pratica trascurabile, ma potrebbe essere ottimizzato riutilizzando la stessa istanza `db` nella funzione.

---

## 5. Mappa del flusso aggiornata (stato finale post-NS)

```
startSync()
  │
  ├─[S1+NS2] Leader election ────────────────────────────────────────
  │    ├─ Vince: _isLeader=true, avvia tutti i loop                  │
  │    └─ Follower: _isLeader=false, standby auto-promozione (NS2) ✅│
  │                                                                   │
  ├─[S3+NS8] _runPull() ──────────────────────────────────────────────►
  │    ├─ Semaforo _pullInFlight (S3) ✅                              │
  │    ├─ AbortController _pullAbortController (NS8) ✅               │
  │    ├─ Generazione counter _pullGeneration ✅                      │
  │    │                                                              │
  │    ├─ _pullCollection('orders')                                   │
  │    │    ├─[S2] cursore per pagina ✅                              │
  │    │    ├─[S6] clock skew guard (clamp, no full pull) ✅          │
  │    │    ├─[NS7] keyset cursor da pagina 2 ✅                      │
  │    │    └─[NP3] manca check cursore nel passato ⚠️ (edge case)   │
  │    │                                                              │
  │    └─ _pullCollection('order_items')                              │
  │         ├─[S7] tx atomica ['order_items','orders'] ✅             │
  │         ├─[Fix2] skipInPhase2 evita merge stale ✅                │
  │         └─ refresh mirato affectedOrderIds (Fix4) ✅              │
  │                                                                   │
  ├─[NS5] _runGlobalPull() semaforo ✅                                 │
  │    └─[NS3] _fanOutVenueTreeToIDB tx 12-store atomica ✅           │
  │         └─[NP4] tiny race reconfigureAndApply (trascurabile) ⚠️  │
  │                                                                   │
  ├─ setInterval(_runPull, 30s) [S3 protegge] ✅                      │
  │                                                                   │
  └─ wsEnabled?                                                       │
       ├─[S4] echo TTL adattivo ✅                                    │
       ├─[S5] heartbeat watchdog 30s ✅                               │
       ├─[Issue3] LWW echo guard cross-device ✅                      │
       ├─[NS1] WS order_items create/update atomica ✅                │
       ├─[Issue1] WS order_items delete atomica ✅                    │
       ├─[NP1] WS order_items delete refresh mirato ✅ (NP1 fix)     │
       └─[NS4] _tableMergePullInFlight semaforo ✅                    │
                                                                      │
[NS6] BroadcastChannel leader→follower ──────────────────────────────┘
      ├─ postMessage dopo ogni _refreshStoreFromIDB ✅
      └─ follower onmessage → _refreshStoreFromIDB(col) ✅
```

---

## 6. Priorità degli interventi rimanenti

### Problemi risolti (completo)

Tutti i problemi P1–P18 e i fix architetturali Issue 1–4, Fix 1–5, NP1 sono stati implementati e verificati con 927 test.

### Problemi residui (a bassa priorità)

| # | Problema | Severità | Priorità | Soluzione |
|---|---|---|---|---|
| NP2 | SDK client ri-creato per ogni pagina | Molto bassa | 🟢 Bassa | Cache client per hash-config |
| NP3 | Clock skew guard non rileva cursore epoch | Molto bassa | 🟢 Bassa | Aggiungere `CURSOR_FLOOR_MS` check |
| NP4 | Race `reconfigureAndApply` + timer 300s | Trascurabile | 🟢 Bassa | Propagare `onProgress` nel semaforo |
| P3 | Record `date_updated=null` pre-sinceTs | Molto bassa | 🟢 Bassa | Edge case, bassa frequenza pratica |
| P4 | Race WS+REST su `orders` | Mitigato | 🟢 Bassa | `mergeOrderFromWSPayload` minimizza impatto |
| NP6 | `getDB()` chiamata 3 volte per WS order_items | Trascurabile | 🟢 Bassa | Riutilizzare istanza `db` nel handler |

---

## 7. Riferimenti al codice (struttura modulare attuale)

| File | Funzione/Sezione | Descrizione |
|---|---|---|
| `sync/config.js` | `PULL_CONFIG`, `COLLECTION_QUIRKS` | Configurazione per tipo app e quirk di collezione |
| `sync/state.js` | `syncState`, `resetSyncState` | Stato singleton condiviso tra moduli |
| `sync/pullQueue.js` | `_fetchUpdatedViaSDK` | Query REST paginata con keyset cursor (NS7) |
| `sync/pullQueue.js` | `_pullCollection` | Loop incrementale con S2/S6/S7/NS7/NS8 |
| `sync/pullQueue.js` | `_runPull` | Orchestrazione con semaforo S3 e generazione counter |
| `sync/idbOperations.js` | `_atomicOrderItemsUpsertAndMerge` | TX multi-store `['order_items','orders']` (S7+NS1) |
| `sync/idbOperations.js` | `_removeOrderItemsFromOrdersIDB` | TX atomica delete + ritorna `affectedOrderIds` (Issue1+NP1) |
| `sync/idbOperations.js` | `_mergeOrderItemsIntoOrdersIDB` | Merge embedded array (usato da REST vecchio path) |
| `sync/wsManager.js` | `_handleSubscriptionMessage` | WS handler con LWW, NS1, Issue1, NP1, NS4 |
| `sync/wsManager.js` | `_startSubscriptions` | WS connect + S5 heartbeat |
| `sync/wsManager.js` | `_resetWsHeartbeat` | Watchdog 30s (S5) |
| `sync/globalPull.js` | `_runGlobalPull` | Semaforo NS5 + deep fetch |
| `sync/globalPull.js` | `_fanOutVenueTreeToIDB` | TX 12-store atomica (NS3) |
| `sync/echoSuppression.js` | `_isEchoSuppressed`, `_markRecentlyPushed` | TTL adattivo (S4) |
| `sync/storebridge.js` | `_refreshStoreFromIDB` | Bridge IDB→store con NS6 broadcast |
| `sync/leaderElection.js` | `_acquireLeaderLock` | Web Locks + standby queue (S1+NS2) |
| `sync/leaderElection.js` | `startSync`, `stopSync` | Entry point + cleanup |
| `sync/leaderElection.js` | `forcePull`, `forcePush` | Override manuali con abort (NS8) |
| `orderStore.js` | `refreshOperationalStateFromIDB` | Splice in-place mirato (Issue4) |
| `persistence/operations.js` | `upsertRecordsIntoIDB` | LWW con gestione date_updated/date_created |
| `useSyncQueue.js` | `drainQueue` | Push BFS con FK-ordering, cascade, AbortSignal |
