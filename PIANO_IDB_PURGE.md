# Piano di Lavoro — Strategia di Pulizia IndexedDB (IDB Purge)

> Contesto: Questo documento descrive il piano per implementare la strategia di pulizia
> automatica dell'IndexedDB locale, necessaria per mantenere le dimensioni del database
> contenute quando la sincronizzazione Directus è attiva.
>
> Analisi di contesto: vedi `DATABASE_SCHEMA.md §5.8` e la conversazione di riferimento.
>
> **Ultimo aggiornamento**: Aggiornato dopo analisi completa di tutti i commit/merge recenti
> (IDB v11, store split, nuovi ObjectStore, rimozione leaderElection).

---

## Obiettivo

In modo continuativo, tramite un purge periodico, rimuovere dall'IndexedDB i dati
operativi già sincronizzati su Directus e non più necessari per il funzionamento
operativo locale.

**Vincolo fondamentale**: non eliminare mai dati che potrebbero non essere ancora su
Directus (entry ancora presenti nella `sync_queue`).

---

## Stato attuale del codebase

| Cosa esiste | Dove |
|---|---|
| Spec `useIDBPurge` documentata | `DATABASE_SCHEMA.md §5.8` |
| `_sync_status` **NON** è scritto su IDB dai path locali | `store/index.js`, `store/reportOps.js` |
| `upsertRecordsIntoIDB` **strippa** `_sync_status` al momento dell'upsert da pull Directus | `store/idbPersistence.js:1001` |
| Dopo chiusura Z: `transactions` e `cash_movements` vengono già svuotati da IDB | `store/reportOps.js:176` (`saveStateToIDB`) |
| `bill_sessions` (closed), `orders` (completed/rejected), `order_items`, `order_item_modifiers` **non** vengono puliti | — |
| `sync_failed_calls` cresce indefinitamente (nessun purge) | `composables/useSyncQueue.js` |
| `useIDBPurge.js` composable: **non esiste** | — |
| IDB versione corrente: **v11** (v10→v11: `venue_users` migrata a indice `apps`) | `composables/useIDB.js` |
| Store Pinia: split in `useOrderStore` + `useConfigStore` + facade `useAppStore` | `store/index.js` |
| Persistence: `store/idbPersistence.js` + re-export facade in `store/persistence/` | `store/persistence/operations.js` |
| `fiscal_receipts` e `invoice_requests`: già hanno pruning count-based (max 200 record) | `store/index.js:355-358` |
| `transaction_order_refs`, `transaction_voce_refs`: ObjectStore presenti in schema IDB ma **nessun codice li scrive in produzione** ancora | `composables/useIDB.js:178-188` |
| **Nessun `leaderElection.js`**: il sync gira direttamente in `useDirectusSync.js` senza elezione leader tra tab | `composables/useDirectusSync.js` |

---

## Problema con `_sync_status`

La spec in `DATABASE_SCHEMA.md §5.8` usa `_sync_status === 'synced'` come guard per il purge.
Tuttavia, analizzando il codice:

1. I record creati localmente **non** ricevono `_sync_status='pending'` all'inserimento in IDB
   (vengono accodati in `sync_queue` separatamente).
2. `upsertRecordsIntoIDB` (usato dal pull Directus) **strippa** `_sync_status` prima di
   salvare — i record pulled da Directus **non** hanno `_sync_status` in IDB.
3. Il mark `'synced'` al momento del successo push non è implementato.

**Soluzione adottata (approccio collection-level)**: invece di tracciare `_sync_status`
per ogni singolo record, il purge verifica che la `sync_queue` per quella collection sia
completamente vuota prima di purgare qualsiasi record di quella collection.

> **Questo è l'approccio consigliato per l'implementazione**: sicuro, senza modificare
> il contratto di persistenza esistente, e sufficiente per la retention window in uso.

Un approccio alternativo a granularità record (mark `_sync_status='pending'/'synced'`)
è descritto nella Fase 1-optional più avanti per riferimento.

---

## Dettagli tecnici critici per l'implementazione

### `print_jobs` — keyPath `logId` (non `id`)

L'ObjectStore `print_jobs` usa `keyPath: 'logId'` (non `id` come tutti gli altri store).
`upsertRecordsIntoIDB` hardcoda `keyPath = 'id'` e ha una nota esplicita che esclude
`print_jobs` dalla upsert sincrona Directus (store LOCAL-ONLY).

**Impatto su purge**: la funzione `purgeCollection` quando elimina un record di
`print_jobs` deve usare `record.logId` come chiave per `db.delete('print_jobs', key)`,
non `record.id`. Il parametro `pkField` dell'implementazione deve essere `'logId'`
per questo store.

### `sync_failed_calls` — store non purgato

Lo store `sync_failed_calls` (aggiunto in IDB v7) cresce indefinitamente:
ogni errore di push scrive una riga tramite `addFailedSyncCall()` in
`composables/useSyncQueue.js`. Lo store ha l'indice `failed_at`.

Questo store NON è in `sync_queue` (è un audit log locale), quindi non ha una guard
collection-level — il purge può essere date-based puro (es. 30 giorni).

### Multi-tab senza leaderElection

Non esiste un meccanismo di elezione leader: tutte le tab aperte avviano
`useDirectusSync.js` in autonomia. Di conseguenza, se si usa un `setInterval` per il
purge periodico, più tab lo eseguirebbero contemporaneamente.

**Mitigazione consigliata**:
- Eseguire il purge **solo in `onMounted`** (non in `setInterval`), oppure
- Coordinare tramite `app_meta` in IDB: salvare `last_purge_ts` e saltare il ciclo
  se il purge è stato eseguito in un'altra tab nell'ultima ora.

### `fiscal_receipts` e `invoice_requests` — già gestiti

Questi due store hanno già un meccanismo di pruning count-based: ogni volta che si
aggiunge un record, viene chiamato `pruneFiscalReceiptsInIDB(200)` /
`pruneInvoiceRequestsInIDB(200)` che mantiene al massimo 200 record. Non è necessario
un purge date-based aggiuntivo per questi store.

### Guard Directus enabled

Prima di eseguire il purge, verificare che Directus sia configurato e attivo:

```js
import { appConfig } from '../utils/index.js';

function _isDirectusSyncActive() {
  const d = appConfig.directus;
  return Boolean(d?.enabled && d?.url && d?.staticToken);
}
```

Questo è il pattern già usato da `_getCfg()` in `useDirectusSync.js` (riga 622).

---

## Piano di Lavoro

### Fase 2 — Implementare `useIDBPurge.js` ✅ IMPLEMENTATA

**File da creare**: `src/composables/useIDBPurge.js`

Seguire la spec in `DATABASE_SCHEMA.md §5.8.3` con le precisazioni di cui sopra.

#### 2.1 — Logica di base `purgeCollection`

```js
/**
 * @param {string} storeName
 * @param {number} retentionDays
 * @param {{
 *   statusFilter?: string[],
 *   dateField?: string,
 *   pkField?: string,
 *   requireMissingParent?: { storeName: string, foreignKey: string } | null,
 * }} options
 */
async function purgeCollection(storeName, retentionDays, options = {}) {
  const {
    statusFilter = null,
    dateField = 'date_updated',
    pkField = 'id',           // IMPORTANTE: 'logId' per print_jobs
    requireMissingParent = null,
  } = options;

  const cutoff = Date.now() - retentionDays * 86_400_000;

  // Guard collection-level: se sync_queue ha entry pendenti per questa collection,
  // salta il purge in questo ciclo (i dati potrebbero non essere ancora su Directus).
  if (await _hasPendingSyncEntries(storeName)) return;

  const db = await getDB();
  const records = await db.getAll(storeName);
  const toDelete = [];

  for (const record of records) {
    if (!record) continue;

    // Condizione 1: data antecedente alla soglia
    const dateValue = record[dateField];
    if (!dateValue) continue;
    if (new Date(dateValue).getTime() >= cutoff) continue;

    // Condizione 2: filtro status (se specificato)
    if (statusFilter != null && !statusFilter.includes(record.status)) continue;

    // Condizione 3: parent già purgato (se richiesto)
    if (requireMissingParent != null) {
      const parentId = record[requireMissingParent.foreignKey];
      if (!parentId) continue;
      const parentExists = await db.get(requireMissingParent.storeName, parentId);
      if (parentExists) continue; // parent ancora presente → non purgare il figlio
    }

    toDelete.push(record[pkField]);
  }

  if (toDelete.length === 0) return;

  const tx = db.transaction(storeName, 'readwrite');
  for (const key of toDelete) {
    if (key != null) await tx.store.delete(key);
  }
  await tx.done;
}
```

#### 2.2 — Guard sync_queue (collection-level)

```js
async function _hasPendingSyncEntries(collectionName) {
  try {
    const db = await getDB();
    const tx = db.transaction('sync_queue', 'readonly');
    const idx = tx.store.index('collection');
    const count = await idx.count(IDBKeyRange.only(collectionName));
    await tx.done;
    return count > 0;
  } catch {
    return true; // se non si riesce a leggere, essere conservativi
  }
}
```

#### 2.3 — Purge dead-letter sync_queue

```js
async function purgeSyncQueueDeadLetter(retentionDays) {
  const cutoff = Date.now() - retentionDays * 86_400_000;
  const db = await getDB();
  const all = await db.getAll('sync_queue');
  const toDelete = all
    .filter(e => e && (e.attempts ?? 0) >= MAX_ATTEMPTS /* = 5 */ &&
                 e.date_created && new Date(e.date_created).getTime() < cutoff)
    .map(e => e.id)
    .filter(Boolean);
  if (toDelete.length === 0) return;
  const tx = db.transaction('sync_queue', 'readwrite');
  for (const id of toDelete) await tx.store.delete(id);
  await tx.done;
}
```

#### 2.4 — Purge `sync_failed_calls` (audit log)

```js
async function purgeSyncFailedCalls(retentionDays) {
  // Nessuna guard sync_queue: è un audit log locale, non va su Directus.
  const cutoff = Date.now() - retentionDays * 86_400_000;
  const db = await getDB();
  const all = await db.getAllFromIndex('sync_failed_calls', 'failed_at');
  const toDelete = all
    .filter(e => e?.failed_at && new Date(e.failed_at).getTime() < cutoff)
    .map(e => e.id)
    .filter(Boolean);
  if (toDelete.length === 0) return;
  const tx = db.transaction('sync_failed_calls', 'readwrite');
  for (const id of toDelete) await tx.store.delete(id);
  await tx.done;
}
```

#### 2.5 — Funzione principale `runIDBPurge`

Implementare rispettando l'ordine di dipendenza in `DATABASE_SCHEMA.md §5.8.4`.
**Nota**: `transaction_order_refs` e `transaction_voce_refs` sono presenti nello schema
IDB ma nessun path di produzione scrive su di loro ancora — includere il purge per
forward-compatibility ma nessun dato verrà effettivamente eliminato.

```js
import { MAX_ATTEMPTS } from './useSyncQueue.js';

export async function runIDBPurge() {
  // 1) Pre-cleanup child-first: orfani da purge precedenti
  await purgeCollection('order_item_modifiers', 7, {
    requireMissingParent: { storeName: 'order_items', foreignKey: 'order_item' },
  });
  await purgeCollection('order_items', 7, {
    requireMissingParent: { storeName: 'orders', foreignKey: 'order' },
  });

  // 2) Purge padri/root
  await purgeCollection('orders',          7,  { statusFilter: ['completed', 'rejected'] });
  await purgeCollection('bill_sessions',   7,  { statusFilter: ['closed'] });
  await purgeCollection('transactions',    30);
  await purgeCollection('cash_movements',  30);
  await purgeCollection('daily_closures',  90);
  // ATTENZIONE: print_jobs usa keyPath 'logId', non 'id'
  await purgeCollection('print_jobs',      7,  {
    statusFilter: ['done', 'error'],
    dateField: 'timestamp',    // campo 'timestamp' in IDB (corrisponde al DB SQL: job_timestamp)
    pkField: 'logId',          // keyPath dello store è 'logId', non 'id'
  });

  // 3) Post-cleanup orfani diventati tali in questo run
  await purgeCollection('order_items', 7, {
    requireMissingParent: { storeName: 'orders', foreignKey: 'order' },
  });
  await purgeCollection('order_item_modifiers', 7, {
    requireMissingParent: { storeName: 'order_items', foreignKey: 'order_item' },
  });

  // 4) Junction e child tables
  await purgeCollection('transaction_order_refs', 30, { dateField: 'date_created' });
  await purgeCollection('transaction_voce_refs',  30, { dateField: 'date_created' });
  await purgeCollection('daily_closure_by_method', 90);

  // 5) Audit / meta stores (nessuna guard sync_queue)
  await purgeSyncQueueDeadLetter(7);           // dead-letter sync_queue
  await purgeSyncFailedCalls(30);              // audit log errori push
}
```

#### 2.6 — Export del composable

```js
export function useIDBPurge() {
  return { runIDBPurge };
}
```

---

### Fase 3 — Integrare il purge nell'avvio app ✅ IMPLEMENTATA

**Trigger**: all'avvio app (`onMounted`) in `CassaApp.vue`, `SalaApp.vue`, `CucinaApp.vue`.

**Condizione**: eseguire solo se Directus sync è attivo (`appConfig.directus?.enabled`).
Non ha senso purgare dati se non c'è sincronizzazione remota attiva.

**Multi-tab**: non usare `setInterval` standalone (tutte le tab lo eseguirebbero in
parallelo senza leader election). Opzioni:
- (A) **Semplice**: eseguire solo in `onMounted` (una volta per sessione per tab).
- (B) **Coordinato**: salvare `last_purge_ts` in `app_meta` e controllare prima di avviare.

Per la prima implementazione, l'opzione A è sufficiente.

File coinvolti:
- `src/CassaApp.vue` — importare e chiamare `runIDBPurge()` in `onMounted`
- `src/SalaApp.vue` — idem
- `src/CucinaApp.vue` — idem (Cucina non usa `bill_sessions`, `transactions`, ecc.
  ma il purge è idempotente su store vuoti, quindi è sicuro lanciarlo ugualmente)

Schema di integrazione in `CassaApp.vue` (aggiungere **dopo** `restartSyncFromCurrentConfig`):

```js
import { useIDBPurge } from './composables/useIDBPurge.js';
import { appConfig } from './utils/index.js';

const { runIDBPurge } = useIDBPurge();

onMounted(async () => {
  window.addEventListener('storage', onStorageChange);
  window.addEventListener('directus-config-updated', restartSyncFromCurrentConfig);
  await restartSyncFromCurrentConfig();

  // Purge IDB in background: non blocca il rendering.
  // Esegue solo se sync Directus è configurato (i dati sono già su Directus).
  if (_isDirectusSyncActive()) {
    runIDBPurge().catch(e => console.warn('[CassaApp] IDB purge failed:', e));
  }
});
```

---

### Fase 4 — Esposizione delle soglie di retention come configurazione ✅ IMPLEMENTATA

Le soglie di retention sono configurabili tramite `local_settings` in IDB, seguendo il
pattern già usato per `sounds`, `menuUrl`, ecc.

#### File modificati

- **`src/utils/index.js`**:
  - Aggiunto campo `idbPurge` a `DEFAULT_SETTINGS` con i valori di default conservativi.
  - Aggiunta funzione `applyIDBPurgeConfigToAppConfig(next)` — unico punto di scrittura
    su `appConfig.idbPurge`, analoga a `applyDirectusConfigToAppConfig`.

- **`src/store/index.js`**:
  - Importata `applyIDBPurgeConfigToAppConfig`.
  - `_normalizeLocalSettingsPayload` ora include e valida `idbPurge` dal payload.
  - `applyLocalSettings` chiama `applyIDBPurgeConfigToAppConfig(normalized.idbPurge)` per
    aggiornare `appConfig.idbPurge` a runtime.
  - `saveLocalSettings` passa `appConfig.idbPurge` come `current` durante la normalizzazione.
  - `initStoreFromIDB`: se `settings.idbPurge` è un oggetto valido, chiama
    `applyIDBPurgeConfigToAppConfig` all'avvio per ripristinare le preferenze salvate.

- **`src/composables/useIDBPurge.js`** — `runIDBPurge()` legge i giorni di retention da
  `appConfig.idbPurge` con fallback ai default hard-coded.

- **`src/composables/__tests__/useIDBPurge.test.js`** — 5 test aggiuntivi per la
  configurabilità: retention estesa conserva i record, retention ridotta li rimuove,
  fallback ai default quando `appConfig.idbPurge` è null.

```js
// DEFAULT_SETTINGS.idbPurge (src/utils/index.js)
idbPurge: {
  orders:          7,
  billSessions:    7,
  transactions:    30,
  cashMovements:   30,
  dailyClosures:   90,
  printJobs:       7,
  syncFailedCalls: 30,
},
```

---

### Fase 5 — Test unitari ✅ IMPLEMENTATA

`src/composables/__tests__/useIDBPurge.test.js` — 38 test totali:

- `purgeCollection` su store vuota → nessun errore, nessuna eliminazione
- Record con `date_updated` recente → NON purgato (anche con sync_queue vuota)
- Record con `date_updated` oltre soglia, sync_queue vuota → purgato
- Record con `date_updated` oltre soglia, sync_queue con entry pendenti per quella
  collection → NON purgato
- Record `print_jobs` con `logId` corretto: usa `logId` come chiave di delete
- Purge orfani: `order_items` purgati se `order` padre mancante e scaduti
- Purge orfani: `order_items` NON purgati se `order` padre ancora presente
- `purgeSyncQueueDeadLetter`: entry con `attempts >= MAX_ATTEMPTS` e data vecchia → rimossa
- `purgeSyncQueueDeadLetter`: entry recente (anche con attempts >= 5) → NON rimossa
- `purgeSyncFailedCalls`: entry con `failed_at` vecchio → rimossa
- `purgeSyncFailedCalls`: entry recente → NON rimossa
- Ordine di dipendenza: `order_item_modifiers` purgati prima di `order_items`
- **Fase 4**: retention estesa → record dentro finestra → conservato
- **Fase 4**: retention ridotta → record fuori finestra → rimosso
- **Fase 4**: `appConfig.idbPurge = null` → fallback ai default, purge corretto

---

### Fase 1-optional — Mark `_sync_status` in IDB (granularità record)

> **Questa fase è opzionale**: la guard collection-level (Fase 2) è sufficiente per la
> retention window in uso. Implementare solo se si ha necessità di purge granulare
> record-by-record mentre la sync_queue non è completamente svuotata.

**Obiettivo**: dare a ogni record in IDB un campo `_sync_status` affidabile.

#### Task 1.1 — Marcare `_sync_status='pending'` alla creazione locale

Al momento della creazione/aggiornamento di un record locale in IDB (fuori dal path di
pull Directus), scrivere `_sync_status: 'pending'`.

File coinvolti:
- `src/store/idbPersistence.js` — `upsertBillSessionInIDB`, `saveStateToIDB`
- `src/store/index.js` — path che chiama `saveStateToIDB`

> **Nota**: `upsertRecordsIntoIDB` è usato sia per il pull Directus (dove `_sync_status`
> va strippato) sia per alcuni path locali. Occorre distinguere i due casi — es. aggiungere
> un flag `{ origin: 'local' | 'directus' }` in opzione, oppure creare una funzione
> separata `upsertLocalRecordIntoIDB` che setta `_sync_status: 'pending'`.

#### Task 1.2 — Marcare `_sync_status='synced'` dopo push confermato

In `useSyncQueue.js` (funzione `drainQueue`), al termine del push con successo di un
entry, aggiornare il record in IDB con `_sync_status: 'synced'`.

#### Task 1.3 — Non alterare il pull path

`upsertRecordsIntoIDB` già strippa `_sync_status` per i record Directus (riga 1001).
Questo comportamento è corretto e non va modificato.

---

## Dipendenze tra le Fasi

```
Fase 2 (useIDBPurge) ✅ ──> Fase 3 (integrazione app) ✅ ──> Fase 4 (config) ✅
                                                          ──> Fase 5 (test) ✅

Fase 1-optional (mark _sync_status) — opzionale, può seguire se necessario
```

**Stato finale**: Fase 2, 3, 4, 5 completate. Fase 1 saltata come da indicazioni.

---

## Riferimenti

- `DATABASE_SCHEMA.md §5.8` — Spec completa strategia purge
- `src/store/idbPersistence.js` — `upsertRecordsIntoIDB`, `saveStateToIDB`, `clearAllStateFromIDB`
- `src/store/persistence/operations.js` — re-export facade (usa internamente `idbPersistence.js`)
- `src/composables/useIDB.js` — schema IDB, versione corrente: **v11**
- `src/store/reportOps.js:176` — `performDailyClose` chiama già `saveStateToIDB({ transactions: [], cashMovements: [] })`
- `src/composables/useSyncQueue.js` — `drainQueue`, `addFailedSyncCall`, costante `MAX_ATTEMPTS`
- `src/CassaApp.vue`, `src/SalaApp.vue`, `src/CucinaApp.vue` — entry point per trigger purge
- `src/store/index.js` — `useOrderStore`, `useConfigStore`, `useAppStore` (facade)
