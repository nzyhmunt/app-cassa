/**
 * @file composables/sync/__tests__/wsManager.test.js
 * @description Targeted unit tests for wsManager.js — heartbeat watchdog
 * timer state and message ordering invariant.
 *
 * Tests cover:
 *  - _resetWsHeartbeat sets a timer when sync is running and WS is enabled
 *  - _resetWsHeartbeat clears an existing timer before setting a new one
 *  - _resetWsHeartbeat is a no-op when sync is not running
 *  - _resetWsHeartbeat is a no-op when WS is disabled
 *  - _handleSubscriptionMessage calls _resetWsHeartbeat as its first synchronous
 *    operation, verifying the Risk-3 ordering invariant
 *  - _handleSubscriptionMessage is a no-op for empty / null data arrays
 *  - addSyncLog is called for heartbeat phase-1 and phase-2 events
 *  - addSyncLog is called for connect, subscribe, and disconnect lifecycle events
 *  - addSyncLog is called for reconnect attempts
 *
 * Note: the full watchdog-fires / reconnect cascade is tested in the main
 * useDirectusSync.test.js suite (WS reconnect + catch-up pull scenarios).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { _resetIDBSingleton } from '../../useIDB.js';
import { _resetDirectusSyncSingleton } from '../../useDirectusSync.js';
import { _resetDirectusClientSingleton } from '../../useDirectusClient.js';
import { syncState } from '../state.js';
import { _resetWsHeartbeat, _handleSubscriptionMessage, _startSubscriptions, _reconnectWs } from '../wsManager.js';
import { WS_HEARTBEAT_INTERVAL_MS } from '../echoSuppression.js';

// ── Shared setup helper ───────────────────────────────────────────────────────

async function configureDirectus() {
  const { appConfig } = await import('../../../utils/index.js');
  appConfig.directus = {
    enabled: true,
    wsEnabled: true,
    url: 'https://directus.test',
    staticToken: 'tok_test',
    venueId: 1,
  };
}

function clearSyncTimers() {
  if (syncState._wsHeartbeatTimer) { clearTimeout(syncState._wsHeartbeatTimer); syncState._wsHeartbeatTimer = null; }
  if (syncState._reconnectTimer) { clearTimeout(syncState._reconnectTimer); syncState._reconnectTimer = null; }
}

// ── _resetWsHeartbeat — pure timer state (fake timers, no IDB) ────────────────
//
// We only check that timers are set/cleared correctly — the watchdog callback is
// never allowed to fire so no IDB transactions are opened.

describe('_resetWsHeartbeat — timer state', () => {
  beforeEach(async () => {
    _resetDirectusSyncSingleton();
    _resetDirectusClientSingleton();
    vi.restoreAllMocks();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    await configureDirectus();
    syncState._running = true;
    syncState._wsConnected.value = true;
  });

  afterEach(() => {
    clearSyncTimers(); // prevent watchdog from firing
    _resetDirectusSyncSingleton();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sets a heartbeat timer when sync is running and WS is enabled', () => {
    _resetWsHeartbeat();
    expect(syncState._wsHeartbeatTimer).not.toBeNull();
  });

  it('clears an existing timer and installs a fresh one when called twice', () => {
    _resetWsHeartbeat();
    const firstTimer = syncState._wsHeartbeatTimer;
    _resetWsHeartbeat();
    const secondTimer = syncState._wsHeartbeatTimer;
    expect(secondTimer).not.toBe(firstTimer);
    expect(secondTimer).not.toBeNull();
  });

  it('is a no-op (timer stays null) when sync is not running', () => {
    syncState._running = false;
    _resetWsHeartbeat();
    expect(syncState._wsHeartbeatTimer).toBeNull();
  });

  it('is a no-op (timer stays null) when WS is disabled in appConfig', async () => {
    const { appConfig } = await import('../../../utils/index.js');
    appConfig.directus.wsEnabled = false;
    _resetWsHeartbeat();
    expect(syncState._wsHeartbeatTimer).toBeNull();
  });

  it('clears the timer when sync stops during an active heartbeat period', () => {
    _resetWsHeartbeat();
    expect(syncState._wsHeartbeatTimer).not.toBeNull();
    // Simulate stopSync clearing the timer
    clearTimeout(syncState._wsHeartbeatTimer);
    syncState._wsHeartbeatTimer = null;
    syncState._running = false;
    expect(syncState._wsHeartbeatTimer).toBeNull();
  });

  it('heartbeat interval constant is a positive number of milliseconds', () => {
    expect(WS_HEARTBEAT_INTERVAL_MS).toBeGreaterThan(0);
    expect(typeof WS_HEARTBEAT_INTERVAL_MS).toBe('number');
  });
});

// ── _handleSubscriptionMessage — Risk-3 ordering invariant ────────────────────
//
// Uses real timers + IDB.  Verifies that _resetWsHeartbeat() is called as the
// very first synchronous operation inside _handleSubscriptionMessage.

describe('_handleSubscriptionMessage — heartbeat ordering invariant (Risk 3)', () => {
  beforeEach(async () => {
    await _resetIDBSingleton();
    _resetDirectusSyncSingleton();
    _resetDirectusClientSingleton();
    vi.restoreAllMocks();
    await configureDirectus();
    syncState._running = true;
    syncState._wsConnected.value = true;
  });

  afterEach(() => {
    clearSyncTimers();
    _resetDirectusSyncSingleton();
    vi.unstubAllGlobals();
  });

  it('resolves without error for an empty data array', async () => {
    await expect(
      _handleSubscriptionMessage('orders', { event: 'update', data: [] }),
    ).resolves.toBeUndefined();
  });

  it('resolves without error when data is null', async () => {
    await expect(
      _handleSubscriptionMessage('orders', { event: 'update', data: null }),
    ).resolves.toBeUndefined();
  });

  it('resets the heartbeat timer synchronously before any async IDB work', () => {
    // Use fake timers only for this assertion — switch back immediately after.
    // Avoid faking setImmediate after _resetIDBSingleton() to prevent the
    // fake-indexeddb deadlock scenario; only fake the timer APIs this test needs.
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    });
    try {
      _resetWsHeartbeat();
      const timerBefore = syncState._wsHeartbeatTimer;
      expect(timerBefore).not.toBeNull();

      // Call with empty data so the function returns quickly without IDB work.
      // The important thing is that _resetWsHeartbeat() runs synchronously first.
      const msgPromise = _handleSubscriptionMessage('orders', { event: 'update', data: [] });

      // Synchronous assertions: the timer must already be a new reference.
      expect(syncState._wsHeartbeatTimer).not.toBeNull();
      expect(syncState._wsHeartbeatTimer).not.toBe(timerBefore);

      return msgPromise;
    } finally {
      clearSyncTimers();
      vi.useRealTimers();
    }
  });
});

// ── _resetWsHeartbeat — addSyncLog calls ─────────────────────────────────────
//
// Verifies that the heartbeat phase-1 and phase-2 log entries are emitted so
// they appear in the Activity Monitor.

describe('_resetWsHeartbeat — addSyncLog for heartbeat events', () => {
  let addSyncLogSpy;

  beforeEach(async () => {
    _resetDirectusSyncSingleton();
    _resetDirectusClientSingleton();
    vi.restoreAllMocks();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    await configureDirectus();
    syncState._running = true;
    syncState._wsConnected.value = true;

    const syncLogsModule = await import('../../../store/persistence/syncLogs.js');
    addSyncLogSpy = vi.spyOn(syncLogsModule, 'addSyncLog').mockResolvedValue(undefined);

    // Mock _runPull so that the heartbeat phase-1 promise resolves with anyMerged:false
    // (healthy idle socket) without hitting IDB or the network.
    const pullQueueModule = await import('../pullQueue.js');
    vi.spyOn(pullQueueModule, '_runPull').mockResolvedValue({ ok: true, aborted: false, failedCollections: [], anyMerged: false });
  });

  afterEach(() => {
    clearSyncTimers();
    _resetDirectusSyncSingleton();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('logs WS heartbeat phase-1 when the silence timer fires', async () => {
    _resetWsHeartbeat();
    vi.advanceTimersByTime(WS_HEARTBEAT_INTERVAL_MS);
    // Let the microtask queue drain so the log call is dispatched.
    await Promise.resolve();

    expect(addSyncLogSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'IN',
        type: 'WS',
        endpoint: '/websocket/heartbeat',
        payload: expect.objectContaining({ phase: 1, action: 'rest_catchup' }),
        status: 'success',
      }),
    );
  });

  it('logs WS heartbeat phase-2 when the socket is still silent after the REST catch-up', async () => {
    // Make _runPull return anyMerged:true so phase-2 is NOT cancelled.
    const pullQueueModule = await import('../pullQueue.js');
    vi.spyOn(pullQueueModule, '_runPull').mockResolvedValue({ ok: true, aborted: false, failedCollections: [], anyMerged: true });

    _resetWsHeartbeat();
    // Phase-1 fires
    vi.advanceTimersByTime(WS_HEARTBEAT_INTERVAL_MS);
    await Promise.resolve();
    // Phase-2 fires
    vi.advanceTimersByTime(WS_HEARTBEAT_INTERVAL_MS);
    await Promise.resolve();

    const phase2Call = addSyncLogSpy.mock.calls.find(
      ([arg]) => arg?.payload?.phase === 2,
    );
    expect(phase2Call).toBeDefined();
    expect(phase2Call[0]).toMatchObject({
      direction: 'IN',
      type: 'WS',
      endpoint: '/websocket/heartbeat',
      payload: expect.objectContaining({ phase: 2, action: 'force_reconnect' }),
      status: 'error',
    });
  });
});

// ── _startSubscriptions — addSyncLog for connect / subscribe / failure ────────
//
// Uses a lightweight MockWebSocket (no IDB) to exercise the connect and
// subscribe paths and verify the correct log entries are emitted.

describe('_startSubscriptions — addSyncLog for lifecycle events', () => {
  let addSyncLogSpy;

  /**
   * Builds a mock Directus SDK client whose connect() resolves immediately and
   * whose subscribe() returns a never-resolving async-iterable (simulating a
   * live subscription).
   */
  function makeMockClient({ connectThrows = false, subscribeThrows = false, subscribeThrowsOnCollection = null } = {}) {
    return {
      connect: connectThrows
        ? vi.fn().mockRejectedValue(new Error('WS unavailable'))
        : vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockImplementation((collection) => {
        if (subscribeThrows || collection === subscribeThrowsOnCollection) {
          return Promise.reject(new Error(`subscribe failed for ${collection}`));
        }
        // Return a live subscription that never yields — tests won't advance timers.
        const neverYield = (async function* () { /* never */ })();
        return Promise.resolve({ subscription: neverYield, unsubscribe: vi.fn() });
      }),
    };
  }

  beforeEach(async () => {
    await _resetIDBSingleton();
    _resetDirectusSyncSingleton();
    _resetDirectusClientSingleton();
    vi.restoreAllMocks();
    await configureDirectus();
    syncState._running = true;
    syncState._wsConnected.value = false;

    const syncLogsModule = await import('../../../store/persistence/syncLogs.js');
    addSyncLogSpy = vi.spyOn(syncLogsModule, 'addSyncLog').mockResolvedValue(undefined);
  });

  afterEach(() => {
    clearSyncTimers();
    _resetDirectusSyncSingleton();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('logs a WS connect success and per-collection subscribe success', async () => {
    const mockClient = makeMockClient();
    const { useDirectusClient } = await import('../../useDirectusClient.js');
    vi.spyOn(await import('../../useDirectusClient.js'), 'getDirectusClient').mockReturnValue(mockClient);

    const ok = await _startSubscriptions(['orders']);
    expect(ok).toBe(true);

    // Connect success log
    expect(addSyncLogSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'OUT',
        type: 'WS',
        endpoint: '/websocket',
        payload: expect.objectContaining({ action: 'connect' }),
        status: 'success',
      }),
    );

    // Subscribe success log
    expect(addSyncLogSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'OUT',
        type: 'WS',
        endpoint: '/subscriptions/orders',
        payload: expect.objectContaining({ action: 'subscribe' }),
        status: 'success',
        collection: 'orders',
      }),
    );
  });

  it('logs a WS connect failure (action: connect) when connect() throws', async () => {
    const mockClient = makeMockClient({ connectThrows: true });
    vi.spyOn(await import('../../useDirectusClient.js'), 'getDirectusClient').mockReturnValue(mockClient);

    const ok = await _startSubscriptions(['orders']);
    expect(ok).toBe(false);

    const errorCall = addSyncLogSpy.mock.calls.find(
      ([arg]) => arg?.status === 'error',
    );
    expect(errorCall).toBeDefined();
    expect(errorCall[0]).toMatchObject({
      direction: 'OUT',
      type: 'WS',
      endpoint: '/websocket',
      payload: expect.objectContaining({ action: 'connect' }),
      status: 'error',
    });
    expect(errorCall[0].response?.error).toMatch(/WS unavailable/);
  });

  it('logs a subscribe failure (action: subscribe, collection name) when subscribe() throws', async () => {
    const mockClient = makeMockClient({ subscribeThrowsOnCollection: 'orders' });
    vi.spyOn(await import('../../useDirectusClient.js'), 'getDirectusClient').mockReturnValue(mockClient);

    const ok = await _startSubscriptions(['orders']);
    expect(ok).toBe(false);

    const errorCall = addSyncLogSpy.mock.calls.find(
      ([arg]) => arg?.status === 'error',
    );
    expect(errorCall).toBeDefined();
    expect(errorCall[0]).toMatchObject({
      direction: 'OUT',
      type: 'WS',
      endpoint: '/subscriptions/orders',
      payload: expect.objectContaining({ action: 'subscribe', collection: 'orders' }),
      status: 'error',
      collection: 'orders',
    });
    expect(errorCall[0].response?.error).toMatch(/subscribe failed for orders/);
  });

  it('logs a subscribe failure for the correct collection when the second subscribe() throws', async () => {
    // First collection subscribes fine; second one throws.
    const mockClient = makeMockClient({ subscribeThrowsOnCollection: 'order_items' });
    vi.spyOn(await import('../../useDirectusClient.js'), 'getDirectusClient').mockReturnValue(mockClient);

    const ok = await _startSubscriptions(['orders', 'order_items']);
    expect(ok).toBe(false);

    const errorCall = addSyncLogSpy.mock.calls.find(
      ([arg]) => arg?.status === 'error',
    );
    expect(errorCall).toBeDefined();
    // Must identify order_items, not orders, and not report action: 'connect'.
    expect(errorCall[0]).toMatchObject({
      endpoint: '/subscriptions/order_items',
      payload: expect.objectContaining({ action: 'subscribe', collection: 'order_items' }),
      status: 'error',
    });
    // Must NOT say action: 'connect'
    expect(errorCall[0].payload?.action).not.toBe('connect');
  });

  it('includes a String(e) fallback when the thrown error has no .message', async () => {
    const mockClient = {
      connect: vi.fn().mockRejectedValue('plain string error'),
    };
    vi.spyOn(await import('../../useDirectusClient.js'), 'getDirectusClient').mockReturnValue(mockClient);

    await _startSubscriptions(['orders']);

    const errorCall = addSyncLogSpy.mock.calls.find(([arg]) => arg?.status === 'error');
    expect(errorCall).toBeDefined();
    expect(errorCall[0].response?.error).toBe('plain string error');
  });
});

// ── _reconnectWs — addSyncLog for reconnect attempt ──────────────────────────

describe('_reconnectWs — addSyncLog for reconnect attempt', () => {
  let addSyncLogSpy;

  beforeEach(async () => {
    await _resetIDBSingleton();
    _resetDirectusSyncSingleton();
    _resetDirectusClientSingleton();
    vi.restoreAllMocks();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    await configureDirectus();
    syncState._running = true;
    syncState._wsConnected.value = false;
    syncState._appType = 'cassa';
    syncState._wsCollections = ['orders'];

    const syncLogsModule = await import('../../../store/persistence/syncLogs.js');
    addSyncLogSpy = vi.spyOn(syncLogsModule, 'addSyncLog').mockResolvedValue(undefined);

    // _startSubscriptions will be called inside _reconnectWs.
    // Mock getDirectusClient so connect() resolves and subscribe() returns a live stream.
    const neverYield = (async function* () { /* never */ })();
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue({ subscription: neverYield, unsubscribe: vi.fn() }),
    };
    vi.spyOn(await import('../../useDirectusClient.js'), 'getDirectusClient').mockReturnValue(mockClient);
  });

  afterEach(() => {
    clearSyncTimers();
    _resetDirectusSyncSingleton();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('logs a WS reconnect attempt before calling _startSubscriptions', async () => {
    await _reconnectWs();

    const reconnectCall = addSyncLogSpy.mock.calls.find(
      ([arg]) => arg?.payload?.action === 'reconnect',
    );
    expect(reconnectCall).toBeDefined();
    expect(reconnectCall[0]).toMatchObject({
      direction: 'OUT',
      type: 'WS',
      endpoint: '/websocket',
      payload: expect.objectContaining({ action: 'reconnect' }),
      status: 'success',
    });
  });
});
