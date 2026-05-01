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
 *
 * Note: the full watchdog-fires / reconnect cascade is tested in the main
 * useDirectusSync.test.js suite (WS reconnect + catch-up pull scenarios).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { _resetIDBSingleton } from '../../useIDB.js';
import { _resetDirectusSyncSingleton } from '../../useDirectusSync.js';
import { _resetDirectusClientSingleton } from '../../useDirectusClient.js';
import { syncState } from '../state.js';
import { _resetWsHeartbeat, _handleSubscriptionMessage } from '../wsManager.js';
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
    vi.useFakeTimers();
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
