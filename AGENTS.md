# AGENTS.md — app-cassa

Knowledge accrued while working on PR #308 (self-order app). Add concise, reusable facts here.

## Architecture quick facts
- Stores: `src/store/orderStore.js` (Pinia `useOrderStore`) holds orders/transactions/print-log. `useAppStore` is a merged proxy of `useConfigStore` + `useOrderStore`.
- IDB: `src/composables/useIDB.js` (`getDB()`). Operative collections include `orders`, `order_items`, `bill_sessions`, `menu_items`, `menu_modifiers`. Menu config collections also in IDB. Tests reset via `_resetIDBSingleton()` and `fake-indexeddb/auto` (global setup).
- Directus sync: `src/composables/sync/*` + `src/composables/useSyncQueue.js` (`enqueue(collection, op, id, payload)`). Order updates enqueue `'orders', 'update'`; order-item patches go through `_enqueueOrderItemsPatch(ordId, projectedOrder)` inside orderStore (it embeds `orderItems`/`totalAmount`/`itemCount` into the orders update payload).
- Price-trust boundary for self-order: client prices are NOT trusted. `orderStore.acceptOrderWithReprice(order)` recomputes unit_price + modifier prices from the menu of record (IDB `menu_items`/`menu_modifiers` first, then public `menu.json` at `selfOrder.menuUrl`) and persists authoritative prices to IDB + Directus before flipping status to `accepted`. Cassa `acceptAndPrint` and Sala `confirmSubmitOrder` both call it; unknown dishes block acceptance.
- Self-order auth: `src/composables/useSelfOrderAuth.js`. Session id is a Directus UUID; `parseSessionUrl` validates UUID shape and returns `{sessionId, token}` with `sessionId: null` for malformed input. `checkSessionOpen()` is a side-effect-free liveness probe used by the order-status polling loop.

## Testing patterns
- Store tests: `src/store/__tests__/*.test.js`. Seed IDB via `getDB()` + `db.put('menu_items', {...})`. Stub `fetch` to `{ ok: false }` to force offline/demo paths. Use `initStoreFromIDB()` after seeding.
- Auth tests: `src/composables/__tests__/useSelfOrderAuth.test.js`. Set `useConfigStore().config.directus.url` to switch demo vs Directus mode; stub global `fetch` per route with `routeFetch(routes)`. Re-stub `fetch` between the initial `validateAndLoadSession` and the action under test.
- Full suite: `npx vitest run` (1335 tests, ~23s). Build: `npm run build`.

## Gotchas
- `changeOrderStatus(order, 'accepted')` enqueues ONLY the status update — it does NOT persist orderItem price changes. To persist repriced prices, call `_enqueueOrderItemsPatch` (or `acceptOrderWithReprice`) which embeds `orderItems` in the orders update payload.
- When the venue runs a local `menu.json` (menuSource='json'), `menu_items` may be excluded from WebSocket pull (`sync/leaderElection.js`) and IDB can be empty — `acceptOrderWithReprice` falls back to fetching the public `menu.json` in that case.
- `enqueuePrintJobs` (usePrintQueue) is synchronous (returns void) — don't await it.
