# Piano di Lavoro — Strategia di Pulizia IndexedDB (IDB Purge)

> Contesto: Questo documento descrive il piano per implementare la strategia di pulizia
> automatica dell'IndexedDB locale, necessaria per mantenere le dimensioni del database
> contenute quando la sincronizzazione Directus è attiva.
>
> Analisi di contesto: vedi `DATABASE_SCHEMA.md §5.8` e la conversazione di riferimento.

---

## Obiettivo

Dopo la **chiusura Z** e, in modo continuativo, tramite un purge periodico, rimuovere
dall'IndexedDB i dati operativi già sincronizzati su Directus (stato `_sync_status='synced'`)
e non più necessari per il funzionamento operativo locale.

**Vincolo fondamentale**: non eliminare mai dati con `_sync_status='pending'` o `'error'`
(non ancora su Directus) e non eliminare mai prima che la sync_queue sia svuotata per
i record interessati.

---

## Stato attuale

| Cosa esiste | Dove |
|---|---|
| Spec `useIDBPurge` documentata | `DATABASE_SCHEMA.md §5.8` |
| `_sync_status` **NON** è scritto su IDB dai path di creazione/aggiornamento locali | `store/index.js`, `store/reportOps.js` |
| `upsertRecordsIntoIDB` **strippa** `_sync_status` al momento dell'upsert da pull Directus | `store/idbPersistence.js:1001` |
| Dopo chiusura Z: `transactions` e `cash_movements` vengono svuotati | `store/reportOps.js:176` |
| `bill_sessions` (closed), `orders` (completed/rejected), `order_items`, `order_item_modifiers`, `transaction_order_refs`, `transaction_voce_refs` **non** vengono puliti | — |
| `useIDBPurge.js` composable: **non esiste** | — |

---

## Problema con `_sync_status`

La spec in `DATABASE_SCHEMA.md §5.8` usa `_sync_status === 'synced'` come guard per il purge.
Tuttavia, analizzando il codice:

1. I record creati localmente **non** ricevono `_sync_status='pending'` all'inserimento in IDB
   (vengono accodati in `sync_queue` separatamente).
2. `upsertRecordsIntoIDB` (usato dal pull Directus) **strippa** `_sync_status` prima di
   salvare — quindi i record pulled da Directus **non** hanno `_sync_status` in IDB.
3. Il mark `'synced'` al momento del successo push non è implementato.

**Soluzione**: usare la presenza del record nella `sync_queue` come proxy invece di
`_sync_status`. Un record è "safe to purge" se:
- **NON** ha una entry in `sync_queue` con lo stesso `(collection, id)` ancora pendente, **e**
- `date_updated` è antecedente alla soglia di retention.

Alternativa più semplice (primo step): il purge opera solo per records con `date_updated`
antecedente alla soglia, **dopo** aver verificato che la `sync_queue` per quella collection
è vuota (approccio collection-level anziché record-level).

---

## Piano di Lavoro

### Fase 1 — Prerequisiti: mark `_sync_status` in IDB

**Obiettivo**: Dare a ogni record in IDB un'informazione affidabile su se è già su Directus.

#### Task 1.1 — Marcare `_sync_status='pending'` alla creazione locale

Al momento della creazione/aggiornamento di un record locale in IDB (fuori dal path di pull
Directus), scrivere `_sync_status: 'pending'`.

File coinvolti:
- `src/store/idbPersistence.js` — `upsertBillSessionInIDB`, `saveStateToIDB`
- `src/store/index.js` — path che chiama `saveStateToIDB` e `upsertRecordsIntoIDB`
  per records locali (transactions, orders, cash_movements, ecc.)

> **Nota**: `upsertRecordsIntoIDB` è usato sia per il pull Directus (dove va strippato)
> sia per alcuni path locali. Occorre distinguere i due casi — es. aggiungere un flag
> `{ origin: 'local' | 'directus' }` in opzione, oppure creare una funzione separata
> `upsertLocalRecordIntoIDB` che setta `_sync_status: 'pending'`.

#### Task 1.2 — Marcare `_sync_status='synced'` dopo push confermato

In `useSyncQueue.js`, al termine del drain di un item con successo (HTTP 200/201),
aggiornare il record in IDB con `_sync_status: 'synced'`.

File coinvolti:
- `src/composables/useSyncQueue.js` — callback di successo del drain

#### Task 1.3 — Non alterare il pull path

`upsertRecordsIntoIDB` già strippa `_sync_status` per i record Directus (riga 1001).
I record pulled da Directus sono implicitamente `'synced'` — basta non scrivere il campo
e il purge può considerarli sicuri se non hanno entry in `sync_queue`.

---

### Fase 2 — Implementare `useIDBPurge.js`

**File da creare**: `src/composables/useIDBPurge.js`

Seguire la spec in `DATABASE_SCHEMA.md §5.8.3` con le seguenti precisazioni:

#### 2.1 — Logica di base `purgeCollection`

```js
async function purgeCollection(storeName, retentionDays, options = {}) {
  // options: { statusFilter, dateField='date_updated', requireMissingParent=null }
  const cutoff = Date.now() - retentionDays * 86_400_000;
  const db = await getDB();
  // Full scan: IDB range query su dateField se l'indice esiste, altrimenti getAll()
  // Condizioni di purge:
  //   1. record[dateField] < cutoff
  //   2. statusFilter == null || statusFilter.includes(record.status)
  //   3. requireMissingParent == null || parent non esiste in IDB
  //   4. _sync_status !== 'pending' && _sync_status !== 'error'
  //      (oppure: nessuna entry pendente in sync_queue per questo record)
}
```

#### 2.2 — Guard sync_queue

Prima di purgare una collection, verificare che non ci siano entry pendenti in
`sync_queue` per quella collection (approccio collection-level come primo step):

```js
async function _hasPendingSyncEntries(collectionName) {
  const db = await getDB();
  const idx = db.transaction('sync_queue').store.index('collection');
  const count = await idx.count(IDBKeyRange.only(collectionName));
  return count > 0;
}
```

Se ci sono entry pendenti, saltare il purge per quella collection in questo ciclo.

#### 2.3 — Purge dead-letter sync_queue

```js
async function purgeSyncQueueDeadLetter(retentionDays) {
  // Rimuove entries con attempts >= 5 e date_created < cutoff
}
```

#### 2.4 — Funzione principale `runIDBPurge`

Implementare rispettando l'ordine di dipendenza in `DATABASE_SCHEMA.md §5.8.4`:

1. `order_item_modifiers` orfani (parent `order_item` mancante)
2. `order_items` orfani (parent `order` mancante)
3. `orders` (status completed/rejected, 7 giorni)
4. `bill_sessions` (status closed, 7 giorni)
5. `transactions` (30 giorni)
6. `cash_movements` (30 giorni)
7. `daily_closures` (90 giorni)
8. `print_jobs` (status done/error, 7 giorni, dateField=job_timestamp)
9. `order_items` orfani post-purge
10. `order_item_modifiers` orfani post-purge
11. `transaction_order_refs` (30 giorni, dateField=date_created)
12. `transaction_voce_refs` (30 giorni, dateField=date_created)
13. `daily_closure_by_method` (90 giorni)
14. `sync_queue` dead-letter (7 giorni, attempts>=5)

#### 2.5 — Export

```js
export function useIDBPurge() {
  return { runIDBPurge };
}
```

---

### Fase 3 — Integrare il purge nell'avvio app

**Trigger**: all'avvio app (`onMounted` di `CassaApp.vue`, `SalaApp.vue`, `CucinaApp.vue`)
e ogni 24 ore via `setInterval`.

**Condizione**: eseguire solo se Directus sync è attivo (la pulizia ha senso solo se i
dati sono anche su Directus).

File coinvolti:
- `src/CassaApp.vue` — importare e chiamare `runIDBPurge()` in `onMounted`
- `src/SalaApp.vue` — idem
- `src/CucinaApp.vue` — idem (purge ridotto: solo le collection che Cucina usa)

Schema di integrazione in `CassaApp.vue`:

```js
import { useIDBPurge } from './composables/useIDBPurge.js';
const { runIDBPurge } = useIDBPurge();

onMounted(async () => {
  // ... esistente ...
  // Avvia purge in background: non blocca il rendering.
  // Esegue solo se sync è configurato (i dati sono su Directus).
  runIDBPurge().catch(e => console.warn('[CassaApp] IDB purge failed:', e));
});
```

---

### Fase 4 — Esposizione delle soglie di retention come configurazione

Le soglie sono attualmente hardcoded nella spec. Renderle configurabili tramite
`local_settings` in IDB o tramite le impostazioni Directus sync già in
`useSettings.js` / `DirectusSyncSettings.vue`.

```js
const IDB_PURGE_RETENTION_DAYS = {
  orders:                  config?.idbPurge?.orders         ?? 7,
  bill_sessions:           config?.idbPurge?.billSessions   ?? 7,
  transactions:            config?.idbPurge?.transactions   ?? 30,
  cash_movements:          config?.idbPurge?.cashMovements  ?? 30,
  daily_closures:          config?.idbPurge?.dailyClosures  ?? 90,
  print_jobs:              config?.idbPurge?.printJobs      ?? 7,
  // junction tables seguono il padre
  transaction_order_refs:  config?.idbPurge?.transactions   ?? 30,
  transaction_voce_refs:   config?.idbPurge?.transactions   ?? 30,
  daily_closure_by_method: config?.idbPurge?.dailyClosures  ?? 90,
};
```

---

### Fase 5 — Test unitari

Creare `src/composables/__tests__/useIDBPurge.test.js` con:

- Purge collection vuota → nessun errore
- Record con `date_updated` recente → NON purgato
- Record con `date_updated` oltre soglia, `_sync_status='synced'` → purgato
- Record con `_sync_status='pending'` → NON purgato (anche se scaduto)
- Record con `_sync_status='pending'` in `sync_queue` → NON purgato
- Purge orfani: `order_items` purgati se `order` padre mancante e scaduti
- Purge dead-letter `sync_queue`: entry con `attempts>=5` e data vecchia → rimossa
- Ordine di dipendenza: `transaction_order_refs` purgate dopo `transactions`

---

## Dipendenze tra le Fasi

```
Fase 1 (mark _sync_status) ──> Fase 2 (useIDBPurge) ──> Fase 3 (integrazione app)
                                                     └──> Fase 5 (test)
Fase 4 (configurazione) — indipendente, può essere fatta in parallelo alla Fase 3
```

La **Fase 1** è la più delicata perché cambia il contratto di `saveStateToIDB` e
`upsertRecordsIntoIDB`. Richiede un'analisi dettagliata di tutti i chiamanti per
non marcare erroneamente come `pending` record che arrivano da Directus.

Se si vuole partire con un approccio più conservativo (no Fase 1), si può fare
**Fase 2 + Fase 3** usando solo la guard della `sync_queue` a livello collection
come condizione sufficiente per il purge (più semplice ma meno granulare).

---

## Approccio Alternativo Semplificato (Short-path)

Invece di marcare `_sync_status` per ogni record, il purge può operare con questa
logica semplificata:

> **Purga un record se e solo se**:
> 1. `date_updated` (o `date_created` per junction) < cutoff, **e**
> 2. Nessuna entry nella `sync_queue` ha `collection === storeName` (zero entry pendenti
>    per quella collection), **e**
> 3. Le condizioni di status/parent sono soddisfatte.

Questo è sicuro perché:
- Se la sync_queue per quella collection è vuota, tutti i record di quella collection
  sono già stati pushati con successo a Directus.
- La retention window (7/30/90 giorni) garantisce che Directus abbia avuto il tempo
  di ricevere il dato anche con sync offline intermittente.

**Pro**: non richiede la Fase 1 (no modifica del contratto di persistenza).
**Contro**: conservativo — se la sync_queue ha anche solo un record pendente per
`transactions`, NESSUNA transaction viene purgata in quel ciclo.

---

## Riferimenti

- `DATABASE_SCHEMA.md §5.8` — Spec completa strategia purge
- `src/store/idbPersistence.js` — `upsertRecordsIntoIDB`, `saveStateToIDB`, `clearAllStateFromIDB`
- `src/composables/useIDB.js` — schema IDB, versione corrente: v11
- `src/store/reportOps.js` — `performDailyClose` (punto di pulizia post-chiusura Z)
- `src/composables/useSyncQueue.js` — drain della sync_queue, callback di successo
- `src/CassaApp.vue`, `src/SalaApp.vue`, `src/CucinaApp.vue` — entry point per trigger purge
