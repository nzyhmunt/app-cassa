# Audit Tecnico — `app-cassa`

> **Ruolo**: Lead QA Engineer / Software Architect  
> **Data**: 2026-05-15  
> **Scope**: analisi statica dei file core (`src/utils/`, `src/store/`, `src/composables/`)

---

## 1. `relationId` duplicata in due moduli distinti

### Problema
La funzione `relationId(value)` è definita sia in `src/utils/mappers.js` (riga 32) sia in `src/store/persistence/_shared.js` (riga 22). Le due differiscono nel trattamento del fallback `.slug` per i record `venue_users` legacy:

| File | Fallback su `.slug` | Comportamento su `null` |
|---|---|---|
| `mappers.js` | ✗ | restituisce `null` |
| `_shared.js` | ✓ | restituisce `null` |

Alcuni moduli importano da `mappers.js` (es. `idbOperations.js`), altri da `_shared.js` (es. `operations.js`). La discrepanza può causare bug silenziosi su record venue-user che usano ancora il formato slug.

### File coinvolti
- `src/utils/mappers.js:32`
- `src/store/persistence/_shared.js:22`
- `src/store/persistence/operations.js:17`
- `src/composables/sync/idbOperations.js:17`

### Single Source of Truth consigliata
Unificare in `mappers.js` con il fallback `.slug` documentato, e ri-esportare da `_shared.js`:

```js
// src/utils/mappers.js — versione canonica
export function relationId(value) {
  if (value == null) return null;
  // .slug: fallback per venue_user legacy dove id può essere uno slug stringa
  if (typeof value === 'object') return value.id ?? value.slug ?? null;
  return value;
}

// src/store/persistence/_shared.js — ri-esportazione, zero duplicazione
export { relationId } from '../../utils/mappers.js';
```

---

## 2. Doppio campo camelCase + snake_case nei record ordini

### Problema
Ogni record ordine trasportato in IDB porta entrambe le forme di ogni campo rilevante (`totalAmount`/`total_amount`, `itemCount`/`item_count`, `billSessionId`/`bill_session`, ecc.). La sincronizzazione delle coppie è ripetuta in **tre punti distinti**, indipendentemente:

1. `mappers.js:mapOrderFromDirectus` — produce entrambe le forme al momento del mapping.
2. `mappers.js:mergeOrderFromWSPayload` — ri-sincronizza la coppia su ogni aggiornamento WS.
3. `orderStore.js:_mapIDBOrder` — ri-sincronizza ancora per il caricamento da IDB.

Ogni nuovo campo bidirezionale richiede **3+ aggiornamenti** separati, con rischio di deriva.

### File coinvolti
- `src/utils/mappers.js:81-120` (`mapOrderFromDirectus`)
- `src/utils/mappers.js:451-555` (`mergeOrderFromWSPayload`)
- `src/store/orderStore.js:394-408` (`_mapIDBOrder`)

### Single Source of Truth consigliata
Introdurre un helper interno riutilizzabile nei tre siti:

```js
// src/utils/mappers.js — helper interno
function syncDual(target, camelKey, snakeKey, value) {
  target[camelKey] = value;
  target[snakeKey] = value;
}

// Uso uniforme in tutti e tre i siti:
syncDual(merged, 'totalAmount', 'total_amount', incoming.totalAmount);
syncDual(merged, 'itemCount',   'item_count',   incoming.itemCount);
// … ecc.
```

---

## 3. Pattern "lock → clone → IDB → enqueue" ripetuto ×7

### Problema
Sette funzioni in `orderStore.js` seguono uno schema identico di 8 passi:

1. Estrarre `ordId`
2. `_withOrderLock`
3. Trovare l'ordine corrente
4. Verificare precondizioni → return se non soddisfatte
5. `_clone(toRaw(current))`
6. Mutare `projected`
7. `saveStateToIDB` in `try/catch`
8. `_enqueueOrderItemsPatch`

### File coinvolti
- `src/store/orderStore.js:748-897`  
  (`updateQtyGlobal`, `removeRowGlobal`, `voidOrderItems`, `restoreOrderItems`, `voidModifier`, `restoreModifier`, `setItemKitchenReady`)

### Single Source of Truth consigliata
Estrarre `_mutateOrderItems(ord, mutatorFn)`:

```js
async function _mutateOrderItems(ord, mutator) {
  const ordId = ord?.id;
  if (!ordId) return;
  return _withOrderLock(ordId, async () => {
    const current = orders.value.find(o => String(o.id) === String(ordId));
    const projected = mutator(current); // null = precondizione non soddisfatta
    if (!projected) return;
    updateOrderTotals(projected);
    const projectedOrders = _replaceOrderById(ordId, projected);
    try {
      await saveStateToIDB({ orders: projectedOrders });
    } catch (e) {
      console.warn('[Store] order mutation IDB save failed:', e);
      return false;
    }
    _enqueueOrderItemsPatch(ordId, projected);
    return true;
  });
}

// Esempio refactor voidOrderItems:
async function voidOrderItems(ord, idx, qtyToVoid) {
  if (!Number.isInteger(qtyToVoid) || qtyToVoid <= 0) return;
  return _mutateOrderItems(ord, (current) => {
    if (!current || !KITCHEN_ACTIVE_STATUSES.includes(current.status)) return null;
    const item = current.orderItems[idx];
    if (!item || (item.voidedQuantity || 0) + qtyToVoid > item.quantity) return null;
    const projected = _clone(toRaw(current));
    projected.orderItems[idx].voidedQuantity =
      (projected.orderItems[idx].voidedQuantity || 0) + qtyToVoid;
    return projected;
  });
}
```

---

## 4. Gestione errori eterogenea

### Problema
Nel solo `orderStore.js` coesistono tre pattern distinti per operazioni IDB fire-and-forget:

| Riga | Pattern | Livello log |
|---|---|---|
| 94-96 | `Promise.resolve(op()).then(() => op2()).catch(e => ...)` | `console.error` |
| 125-126 | `Promise.all([...]).catch(e => ...)` | `console.warn` |
| 308-313 | `op().catch(e => { scheduleSave(); console.warn(...) })` | `console.warn` |

Il Pattern A usa `Promise.resolve()` in modo superfluo attorno a una funzione già async; il mix `error`/`warn` rende difficile distinguere errori critici da degraded-gracefully.

### File coinvolti
- `src/store/orderStore.js:94-96`, `:125-126`, `:308-313`

### Single Source of Truth consigliata
Standardizzare su async IIFE + `try/catch` con `console.warn` per IDB-failure non critiche:

```js
// Prima (Pattern A):
Promise.resolve(saveFiscalReceiptToIDB(entry))
  .then(() => pruneFiscalReceiptsInIDB())
  .catch((error) => console.error('Failed to persist/prune...', error));

// Dopo:
(async () => {
  try {
    await saveFiscalReceiptToIDB(entry);
    await pruneFiscalReceiptsInIDB();
  } catch (error) {
    console.warn('[Store] Failed to persist/prune fiscal receipts in IDB:', error);
  }
})();
```

---

## 5. Doppia sorgente per la configurazione delle stampanti

### Problema
`usePrintQueue.js` legge le stampanti tramite `getRuntimeConfig(store)` (merge dinamico `appConfig` + `store.config` dipendente dall'idratazione). Gli altri consumer (`storebridge.js:75`, `SettingsModal.vue:251`) leggono `appConfig.printers` direttamente. Prima dell'idratazione di Pinia le due sorgenti possono divergere.

### File coinvolti
- `src/composables/usePrintQueue.js:118-127`
- `src/composables/sync/storebridge.js:75`
- `src/components/shared/SettingsModal.vue:251-257`

### Single Source of Truth consigliata
Esporre un computed `printers` nel `configStore` che post-idratazione rispecchi `appConfig.printers`, ed eliminare i riferimenti diretti a `appConfig.printers` nei componenti:

```js
// configStore.js
const printers = computed(() =>
  Array.isArray(config.value?.printers) ? config.value.printers : []
);
```

---

## 6. Variabile `shouldHydrateDirectus` inutilizzata

### Problema
In `src/store/configStore.js` riga 150:

```js
const shouldHydrateDirectus = options.skipHydrate === true ? false : true;
```

La variabile viene dichiarata ma mai usata nel corpo della funzione; il codice controlla direttamente `options.skipHydrate` nei punti rilevanti.

### File coinvolti
- `src/store/configStore.js:150`

### Fix consigliato
Rimuovere la variabile e usare `!options.skipHydrate` direttamente dove serve.

---

## Riepilogo priorità

| # | Tipo | Impatto | Rischio attuale |
|---|---|---|---|
| 2 | Doppio camelCase/snake_case | Alto | Ogni nuovo campo richiede 3+ siti di modifica |
| 1 | `relationId` duplicata | Medio | Bug silenzioso su record venue-user con `.slug` |
| 3 | Pattern IDB ripetuto ×7 | Medio | Deriva alla manutenzione, 8 siti da aggiornare |
| 5 | Doppia sorgente stampanti | Medio | Race condition pre-idratazione |
| 4 | Gestione errori eterogenea | Basso | Triage log difficoltoso |
| 6 | Variabile inutilizzata | Basso | Documentazione fuorviante |
