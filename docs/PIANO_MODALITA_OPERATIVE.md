# Draft implementation plan — Operating modes (Offline / Offline-first / Online)

## Objective
Introduce an explicit app operating-mode selector with three distinct behaviors:

1. **Offline only (`offline_only`)** — local IndexedDB only (single device)
2. **Offline first (`offline_first`)** — local IndexedDB + Directus push/pull synchronization
3. **Online (`online_only`)** — real-time Directus only, with no operational persistence in IndexedDB

## Complexity assessment
**Complexity: HIGH**.

Reason: the current architecture is **IDB-first** (bootstrap, store hydration, cross-tab refresh, sync, config/menu cache, push queue, purge, monitoring). Online-only requires a coherent alternate execution path across all application layers (UI, store, composables, sync, bootstrap, and error fallback).

## Scope
- Runtime configuration and operating-mode settings persistence
- App bootstrap (Cassa/Sala/Cucina)
- Store layer (config + orders) and operational persistence
- Directus sync flows (pull/push/realtime)
- Settings UI and status indicators
- Fallback/recovery strategies when offline
- Unit/integration tests for all three modes
- Technical documentation and operational guide

## Work plan (draft)

### Phase 1 — Operating-mode model
- Define a single operating-mode field with values: `offline_only`, `offline_first`, `online_only`.
- Define the behavior matrix for each critical feature (order reads/writes, printing, table sessions, users, menu, config).
- Align defaults and backward-compatibility rules for existing installations.

### Phase 2 — Bootstrap and lifecycle orchestration
- Introduce mode-specific startup strategy in Cassa/Sala/Cucina.
- Clearly separate initialization paths: IDB, hybrid, and network-only.
- Define no-network behavior for `online_only` (explicit degraded state, blocked unsupported operations, user messages).

### Phase 3 — Store and data access
- Isolate operational data access behind a layer consistent with the active mode.
- Keep IDB-first only where required (`offline_only`, `offline_first`).
- For `online_only`, use live Directus operations without depending on local operational object stores.

### Phase 4 — Sync and realtime
- Keep the current engine for `offline_first`.
- Disable unnecessary local queue/operational persistence in `online_only`.
- Ensure reliable realtime updates (WS + controlled fallback) for `online_only`.

### Phase 5 — Settings UI/UX
- Extend settings with operating-mode selector.
- Clearly display status and limitations of the current mode.
- Handle mode transitions with safety controls (confirmations, optional local data migration/clear when needed).

### Phase 6 — Data safety and migration
- Define migration rules between modes (for example, offline-first to online-only).
- Prevent inconsistency between local cache and server state.
- Formalize local data retention/removal policy by mode.

### Phase 7 — Testing and validation
- Add dedicated tests for:
  - order create/update in each mode
  - offline/online behavior and reconnection
  - multi-app bootstrap with different modes
  - regressions on printing, payments, history, and sync monitor
- Run full repository suite and guided manual functional validation.

### Phase 8 — Documentation and rollout
- Update README with the mode matrix.
- Update user guide with recommended operational scenarios.
- Define gradual rollout: initial pilot activation, observability, rollback plan.

## Main risks
- Regressions on currently implicit IDB-first flows
- Inconsistencies during mode switch on active installations
- Higher sensitivity to network quality in `online_only`
- Increased maintenance complexity without clear layer boundaries

## Acceptance criteria (draft)
- The three modes are selectable and persisted correctly
- Each mode respects its functional contract
- No operational dependency on IDB in `online_only`
- No functional regressions in existing modes
- Green automated tests + updated documentation
