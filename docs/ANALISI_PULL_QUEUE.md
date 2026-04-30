# Analisi della Coda di Pull — Directus Sync

**Data:** 2026-04-30  
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

---

## 2. Flusso della Pull Queue — passo per passo

### 2.1 Entry point: `startSync()`

```
startSync({ appType, store })
  ├─ _hydrateConfigFromLocalCache()        ← IDB-first: applica cache locale prima di fetch remoto
  ├─ _runPush()                             ← push immediato coda pendente
  ├─ _runGlobalPull()                       ← deep fetch venue/config da Directus
  ├─ setInterval(_runPush, 30_000)
  ├─ setInterval(_runGlobalPull, 300_000)
  └─ se wsEnabled:
       ├─ _startSubscriptions(collections)
       │    └─ fallback → _runPull() + setInterval(_runPull, 30_000)
       └─ _runPull() immediato (catch-up)
     altrimenti:
       └─ _runPull() + setInterval(_runPull, 30_000)
```

### 2.2 `_runPull()` — Pull periodico operativo

Eseguito ogni 30 secondi (o subito dopo `online`). Itera sulle **collezioni operative** configurate per tipo di app:

| App | Collezioni |
|---|---|
| cassa | `orders`, `order_items`, `bill_sessions`, `tables` |
| sala | `orders`, `order_items`, `bill_sessions`, `tables`, `menu_items` |
| cucina | `orders`, `order_items` |

Per ogni collezione chiama `_pullCollection(collection)`.

### 2.3 `_pullCollection()` — Logica incrementale con cursore

```
_pullCollection(collection, { forceFull, lastPullTimestampOverride })
  ├─ Legge last_pull_ts da IDB (per questa collezione)
  ├─ Loop paginato (page size = 200):
  │    ├─ _fetchUpdatedViaSDK(collection, sinceTs, page)
  │    │    └─ GET /items/{collection}?filter[date_updated][_gte]=sinceTs&...
  │    ├─ _mapRecord() → formato locale
  │    ├─ _preparePullRecordsForIDB()  ← gestione edge case orders/bill_sessions
  │    ├─ upsertRecordsIntoIDB()       ← last-write-wins su date_updated
  │    └─ aggiorna latestTs
  ├─ Se collection === 'order_items':
  │    └─ _mergeOrderItemsIntoOrdersIDB()  ← merge embedded in orders
  ├─ _refreshStoreFromIDB(collection)      ← aggiorna memoria da IDB
  └─ saveLastPullTsToIDB(collection, latestTs)  ← avanza cursore solo se ok
```

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

**Campi espansi per orders:**
```javascript
fields: ['*', 'order_items.*', 'order_items.order_item_modifiers.*']
```

**Filtro venue:** automatico tranne per `venues` (noVenueFilter) e `order_items` (venueFilter via join `order.venue`).

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
       ├─ upsertRecordsIntoIDB('venues', ..., { forceWrite: true })
       ├─ upsertRecordsIntoIDB('rooms', ...)
       ├─ upsertRecordsIntoIDB('tables', ...)
       ├─ upsertRecordsIntoIDB('menu_categories', ...)
       ├─ upsertRecordsIntoIDB('menu_items', ...)
       ├─ upsertRecordsIntoIDB('menu_modifiers', ...)
       ├─ replaceVenueUsersInIDB()   ← full replace (non upsert)
       └─ replaceTableMergesInIDB()  ← full replace (non upsert)
```

**Protezione da race condition:** usa contatori di generazione (`_globalPullGeneration`, `_lastAppliedGlobalPullGeneration`) per ignorare pull più vecchi superati da uno più recente.

### 2.7 WebSocket Pull (modalità real-time)

Quando `wsEnabled = true`, usa le **subscriptions** Directus SDK:

```
client.subscribe(collection, { query: { fields: ['*'], filter: { venue: { _eq: venueId } } } })
  └─ for await (message) → _handleSubscriptionMessage(collection, message)
       ├─ event = 'create'/'update' → upsertRecordsIntoIDB()
       ├─ event = 'delete' → deleteRecordsFromIDB()
       └─ self-echo suppression (ECHO_SUPPRESS_TTL_MS = 5s)
```

In caso di disconnessione WS: retry dopo 5 s → se fallisce, ricade in polling.

### 2.8 Merge `order_items` nelle `orders` — `_mergeOrderItemsIntoOrdersIDB()`

Problema strutturale: `orders` in IDB contiene un array embedded `orderItems`. Quando `order_items` viene pullata come collezione separata (cucina), i record non entrano automaticamente nell'array embedded.

La funzione:
1. Raggruppa i pulled items per `orderId`
2. Per ogni ordine: carica record esistente da IDB
3. Applica LWW sui singoli items (data_updated)
4. Usa `mergeOrderItemFromWSPayload` per payload WS parziali (evita clobber di campi con default mapper)
5. Scrive l'ordine aggiornato con `deepEqual` come fast-path no-op

---

## 3. Problemi identificati nella Pull Queue

### P1 — **Singleton non resettato tra istanze multi-tab**

**Descrizione:** `useDirectusSync` è un singleton a livello di modulo (`_running`, `_pushTimer`, `_pollTimer`, ecc. sono variabili di modulo). In un browser multi-tab con la stessa app aperta su più tab, ogni tab importa il proprio modulo ES (isolati per via del bundler), quindi il singleton è per-tab. Tuttavia, tutti i tab accedono alla **stessa IndexedDB** e al **medesimo backend Directus**.

**Rischio concreto:**
- 3 tab aperte → 3 pull loop concorrenti verso Directus (ogni 30 s × 3 = pull ogni 10 s effettivi)
- 3 push loop concorrenti sulla stessa sync_queue IDB → potenziali race su `removeEntry()`
- La queue viene letta da `getPendingEntries()` in ogni tab: due tab possono vedere lo stesso entry e tentare di pusharlo entrambe
- Non esiste un lock o una coordinazione inter-tab (nessun `BroadcastChannel`, nessun `SharedWorker`)

**Evidenza nel codice:**
```javascript
// useSyncQueue.js - nessun lock inter-tab su drainQueue()
const entries = await getPendingEntries();
// ... processing ...
await removeEntry(entry.id);  // può essere chiamato da due tab contemporaneamente
```

---

### P2 — **Cursore `last_pull_ts` non avanza in caso di errore parziale**

**Descrizione:** In `_pullCollection()`, il cursore viene aggiornato (`saveLastPullTsToIDB`) solo quando **tutte le pagine** della pull completano senza errore (`!hadFetchError`). Se si verifica un errore a pagina 3 di 5, le pagine 1 e 2 sono già state scritte in IDB, ma il cursore rimane al valore precedente. Al prossimo ciclo verranno ri-fetchate le stesse pagine 1 e 2.

**Rischio concreto:** Su dataset grandi, un'interruzione di rete a metà pull provoca un ri-fetch completo delle pagine già elaborate. L'idempotenza di `upsertRecordsIntoIDB` garantisce che non ci siano duplicati, ma:
- Traffico di rete elevato e inutile
- Ritardo nella ricezione dei dati più recenti (pagine 4 e 5 non vengono mai raggiunte fino al prossimo ciclo riuscito)
- In condizioni di rete instabile, il cursore potrebbe non avanzare mai

**Evidenza nel codice:**
```javascript
// useDirectusSync.js - _pullCollection()
if (!hadFetchError && latestTs && latestTs !== storedSinceTs) {
  await saveLastPullTsToIDB(collection, latestTs);  // solo se tutto ok
}
```

---

### P3 — **Filtro `_gte` su `date_updated` non copre record con `date_updated = null` mai aggiornati dopo il primo full pull**

**Descrizione:** La query REST usa:
```javascript
{ _or: [
  { date_updated: { _gte: sinceTs } },
  { _and: [{ date_updated: { _null: true } }, { date_created: { _gte: sinceTs } }] }
]}
```
Questo copre record creati dopo `sinceTs` con `date_updated = null`. Tuttavia, se un record è stato **creato prima** del full pull iniziale, ha `date_updated = null` e non è mai stato modificato, non apparirà in nessun pull incrementale successivo. Questo è il comportamento atteso.

Il problema si manifesta quando:
1. Un dispositivo completa il full pull iniziale (salva `sinceTs = T0`)
2. Directus rimuove un record e lo ricrea con un nuovo ID prima di `T0` (improbabile ma possibile con migrazioni)
3. Il nuovo record ha `date_created < T0` → non appare in nessun pull incrementale

**Evidenza aggiuntiva:** `_fetchUpdatedViaSDK` non gestisce il caso `noDateUpdated` per tutte le collezioni (solo abilitato via `COLLECTION_QUIRKS`), ma questo edge case esiste per le collezioni con entrambi i timestamp.

---

### P4 — **Race condition tra WS e REST pull su `orders`**

**Descrizione:** Quando `wsEnabled = true`, i due canali sono attivi contemporaneamente:
- WS: riceve eventi real-time e chiama `_handleSubscriptionMessage` → `upsertRecordsIntoIDB`
- REST: ogni 30 s chiama `_pullCollection` → `upsertRecordsIntoIDB`

Entrambi usano LWW basato su `date_updated`, quindi in caso di stessa timestamp vince l'ultimo scritto in IDB, non necessariamente quello con dati più completi.

**Caso critico:** Il WS manda un payload parziale `{id, status, date_updated}` (update evento). Il mapper `mapOrderFromDirectus` riempie i campi assenti con default (`orderItems: []`, `totalAmount: 0`). Poi arriva il REST pull con il record completo con stessa `date_updated`. LWW salterà il REST pull perché `incomingMs === existingMs` e potrebbe trovare payload diverso (il WS ha scritto un record "vuoto" con timestamp uguale).

Nota: il codice gestisce parzialmente questo con `mergeOrderFromWSPayload` per gli update WS, ma rimane un rischio se la sequenza temporale del processing non è garantita.

---

### P5 — **`_mergeOrderItemsIntoOrdersIDB` potrebbe lasciare ordini inconsistenti**

**Descrizione:** La funzione risolve il problema dell'embedded `orderItems` array, ma ha un'edge case: se `_mergeOrderItemsIntoOrdersIDB` fallisce a metà transazione IDB, `hadFetchError` viene impostato a `true` e il cursore non avanza. Tuttavia, **parte degli ordini potrebbero essere già stati scritti** dalla chiamata `upsertRecordsIntoIDB(collection, prepared)` che precede il merge.

Questo significa che IDB può avere ordini aggiornati (dalla upsert) ma con `orderItems` ancora vecchi (il merge fallì), e il cursore non avanza impedendo al prossimo ciclo di risolvere.

**Evidenza nel codice:**
```javascript
// _pullCollection() — le due scritture non sono atomiche
const written = await upsertRecordsIntoIDB(collection, prepared);  // ← scrive ordini
// ...
try {
  ordersWritten = await _mergeOrderItemsIntoOrdersIDB(...);  // ← modifica orderItems embedded
} catch (e) {
  hadFetchError = true;  // cursore non avanza, ma ordini già scritti sopra
}
```

---

### P6 — **Self-echo suppression con TTL fisso di 5 secondi**

**Descrizione:** Quando un dispositivo pusha un record, questo viene aggiunto a `_recentlyPushed` con TTL di 5 s. Se il server è lento e rimanda l'echo WS dopo 5 s, il record viene applicato ugualmente (il TTL è scaduto), causando una sovrascrittura del record locale con una versione potenzialmente identica (no-op) o con un payload parziale WS che clobba dati locali.

Più critico: su connessioni lente, il round-trip push → WS echo può superare i 5 s, e il device riceve il suo stesso record come se fosse un aggiornamento esterno.

**Evidenza nel codice:**
```javascript
const ECHO_SUPPRESS_TTL_MS = 5_000; // fisso, non adattivo
```

---

### P7 — **Disconnessione silenziosa del WebSocket non rilevata immediatamente**

**Descrizione:** Il codice imposta `_wsConnected.value = false` nell'event listener `offline`, ma il listener del browser `offline` non scatta sempre in modo affidabile (specialmente su reti Wi-Fi che cambiano silenziosamente). Se il WebSocket si disconnette senza che il browser riporti `offline`, la subscription iterator lancia dopo il timeout interno Directus SDK (~20 s), e il reconnect viene schedulato 5 s dopo.

Durante questa finestra di ~25 s:
- Nessun aggiornamento arriva via WS
- Il polling REST non è attivo (è disabilitato quando WS è connected)
- L'indicatore UI può mostrare "connected" falsamente

**Evidenza nel codice:**
```javascript
// _onOffline() richiede l'evento browser 'offline' per scattare
// Se il Wi-Fi cambia AP senza segnalare offline, il codice non reagisce
window.addEventListener('offline', _onOffline);
```

---

### P8 — **Timestamp clock skew tra dispositivo e server**

**Descrizione:** Il cursore `last_pull_ts` è basato sui timestamp di risposta Directus. La tolleranza al clock skew è di 24 ore (`GLOBAL_TIMESTAMP_SKEW_TOLERANCE_MS`), ma non è attualmente implementata come guard attiva nella logica di pull — è solo documentata come costante. Non c'è validazione che `last_pull_ts > now - 24h` prima di usarlo come filtro.

Se il server ha il clock in avanti rispetto al dispositivo (scenario comune con tablet non sincronizzati via NTP), i timestamp salvati saranno "nel futuro" dal punto di vista del dispositivo. La prossima pull incrementale userà un `sinceTs` nel futuro e potrebbe non ricevere record aggiornati nel mentre.

---

### P9 — **`_runPull` non tiene traccia delle pull già in corso (no semaforo)**

**Descrizione:** A differenza del push loop (che usa `_pushInFlight` per prevenire drain concorrenti), `_runPull` non ha un guard equivalente:

```javascript
// useDirectusSync.js
async function _runPull() {
  // NESSUN check "if (_pullInFlight) return _pullInFlight"
  if (!navigator.onLine) return ...
  // ... continua immediatamente
}
```

Se `_pollTimer` scatta mentre è già in corso una pull (lenta, con dataset grande), si avviano due `_runPull()` concorrenti. Entrambi leggono lo stesso `last_pull_ts` all'inizio, pullano le stesse pagine, e scrivono le stesse entries in IDB. L'effetto finale è duplice chiamata a `_refreshStoreFromIDB`, cioè l'in-memory store viene refreshato due volte inutilmente.

Su dataset grandi con pull che durano >30 s, questo può causare:
- Cascata di pull sempre più sovrapposti
- Aumento del carico su Directus
- Refreshi di store frequenti che causano re-render UI inutili

---

### P10 — **`forceFull` su `table_merge_sessions` non sincronizzato con il pull normale**

**Descrizione:** Quando arriva un evento WS `delete` su `table_merge_sessions`, viene chiamato `_pullCollection('table_merge_sessions', { forceFull: true })` che esegue un full replace. Se questo avviene mentre è in corso il pull normale periodico di `tables` (che contiene merge sessions), i due aggiornamenti possono interferire.

---

## 4. Mappa del flusso con rischi evidenziati

```
startSync()
  │
  ├─[P9] _runPull() ──────────────────────────────────────────────►
  │         │                                                      │
  │         ├─ _pullCollection('orders')                          │
  │         │    ├─[P2] cursore non avanza se errore parziale    │
  │         │    ├─[P3] record pre-sinceTs con date_updated=null  │
  │         │    ├─[P5] merge orderItems non atomico              │
  │         │    └─[P8] clock skew → filtro inefficace           │
  │         │                                                      │
  │         └─ _pullCollection('order_items')                     │
  │              └─[P5] merge in orders non atomico               │
  │                                                                │
  ├─[P1] setInterval(_runPull, 30s) ← multi-tab: 3 loop          │
  │                                                                │
  └─ wsEnabled?                                                    │
       ├─[P4] WS + REST concurrent → race su orders              │
       ├─[P6] echo suppression TTL fisso                          │
       └─[P7] WS silent disconnect → 25s blind window            │
```

---

## 5. Soluzioni proposte

### S1 — Leader election inter-tab con Web Locks API

Utilizzare la [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) per eleggere un solo tab come "leader" per pull e push:

```javascript
// In startSync():
if ('locks' in navigator) {
  navigator.locks.request('directus-sync-leader', { mode: 'exclusive', ifAvailable: true }, async (lock) => {
    if (!lock) return; // un altro tab è il leader
    // avvia push e pull solo qui
    await _startSyncAsLeader();
  });
}
```

Impatto: risolve P1 completamente. Requisito: browser moderno (supporto ~97%).

---

### S2 — Cursore per pagina (checkpoint incrementale)

Salvare il cursore ogni pagina completata con successo invece di aspettare l'intera pull:

```javascript
// In _pullCollection() — dopo ogni pagina ok:
if (!pageError && maxTs && maxTs !== storedSinceTs) {
  await saveLastPullTsToIDB(collection, maxTs); // checkpoint per pagina
}
```

Impatto: risolve P2. Attenzione: il cursore per pagina deve essere il `maxTs` della pagina corrente, non il `latestTs` globale — questo richiede un refactor del loop interno.

---

### S3 — Semaforo per `_runPull` (mirror del pattern push)

```javascript
let _pullInFlight = null;

async function _runPull() {
  if (_pullInFlight) return _pullInFlight;
  _pullInFlight = (async () => {
    try {
      // ... logica attuale ...
    } finally {
      _pullInFlight = null;
    }
  })();
  return _pullInFlight;
}
```

Impatto: risolve P9 (pull concorrenti). Semplice da implementare, basso rischio.

---

### S4 — Timeout adattivo per echo suppression

Sostituire il TTL fisso con un TTL basato sul round-trip time misurato:

```javascript
// Dopo ogni push riuscito, misura il tempo:
const pushDuration = Date.now() - _pushStart;
const echoTTL = Math.max(5_000, pushDuration * 3); // almeno 3x il push RTT
_registerPushedEchoes(result.pushedIds, echoTTL);
```

Impatto: risolve P6 per connessioni lente. Alternativa: aumentare il TTL fisso a 15-20 s come trade-off conservativo.

---

### S5 — Heartbeat WebSocket attivo

Implementare un heartbeat periodico per rilevare disconnessioni silenziose prima del timeout SDK (~20 s):

```javascript
// In _startSubscriptions():
const wsHeartbeatTimer = setInterval(async () => {
  if (!_running || !_wsConnected.value) return;
  try {
    // ping leggero — readItem o subscription ping
    await client.ping?.();
  } catch {
    _wsConnected.value = false;
    _reconnectWs();
  }
}, 10_000); // ogni 10 s
```

Impatto: riduce la finestra cieca di P7 da ~25 s a ~15 s. Nota: verificare se Directus SDK espone un metodo `ping()`.

---

### S6 — Guard su clock skew prima dell'uso del cursore

Aggiungere validazione attiva prima di usare `last_pull_ts` come filtro:

```javascript
// In _pullCollection():
const storedSinceTs = forceFull ? null : await loadLastPullTsFromIDB(collection);
if (storedSinceTs) {
  const skewMs = new Date(storedSinceTs).getTime() - Date.now();
  if (skewMs > GLOBAL_TIMESTAMP_SKEW_TOLERANCE_MS) {
    console.warn(`[DirectusSync] Clock skew detected for ${collection}: cursor ${storedSinceTs} is ${skewMs}ms in the future. Forcing full pull.`);
    // Reset del cursore e full pull
    await saveLastPullTsToIDB(collection, null);
    return _pullCollection(collection, { forceFull: true });
  }
}
```

Impatto: risolve P8. Richiede aggiornamento di `saveLastPullTsToIDB` per supportare `null` come reset.

---

### S7 — Transazione atomica per upsert + merge orderItems

Wrappare `upsertRecordsIntoIDB(order_items)` e `_mergeOrderItemsIntoOrdersIDB()` in una singola transazione IDB multi-store:

```javascript
// Unica transazione su ['order_items', 'orders']
const tx = db.transaction(['order_items', 'orders'], 'readwrite');
// ... scrive order_items ...
// ... merge in orders ...
await tx.done;
// Solo dopo: salva cursore e refresh store
```

Impatto: risolve P5. Richiede refactor significativo di `upsertRecordsIntoIDB` per accettare una transazione esistente.

---

## 6. Priorità degli interventi

| # | Problema | Severità | Complessità fix | Priorità |
|---|---|---|---|---|
| S3 | Pull concorrenti (semaforo) | Media | Bassa | 🔴 Alta |
| S1 | Multi-tab leader election | Alta | Media | 🔴 Alta |
| S2 | Cursore per pagina | Media | Media | 🟡 Media |
| S6 | Clock skew guard | Media | Bassa | 🟡 Media |
| S4 | Echo TTL adattivo | Bassa | Bassa | 🟢 Bassa |
| S5 | WS heartbeat | Media | Media | 🟡 Media |
| S7 | Atomicità merge orderItems | Bassa | Alta | 🟢 Bassa |

---

## 7. Riferimenti al codice

| File | Riga indicativa | Descrizione |
|---|---|---|
| `useDirectusSync.js` | ~604 | `_pullCollection()` — logica cursore |
| `useDirectusSync.js` | ~304 | `_fetchUpdatedViaSDK()` — query REST |
| `useDirectusSync.js` | ~440 | `_mergeOrderItemsIntoOrdersIDB()` |
| `useDirectusSync.js` | ~718 | `_handleSubscriptionMessage()` — WS handler |
| `useDirectusSync.js` | ~878 | `_startSubscriptions()` |
| `useDirectusSync.js` | ~1085 | `_runPush()` con semaforo (modello da replicare per pull) |
| `useDirectusSync.js` | ~1152 | `_runPull()` — senza semaforo |
| `useDirectusSync.js` | ~1588 | `_runGlobalPull()` |
| `useSyncQueue.js` | ~731 | `drainQueue()` — drain con BFS |
| `persistence/operations.js` | ~420 | `upsertRecordsIntoIDB()` — LWW |
