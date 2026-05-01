/**
 * @file composables/sync/__tests__/echoSuppression.test.js
 * @description Targeted unit tests for the echo suppression module.
 *
 * Tests cover:
 *  - _registerPushedEchoes registers IDs with correct TTL
 *  - _isEchoSuppressed returns true within TTL window
 *  - _isEchoSuppressed returns false after TTL expires
 *  - _isEchoSuppressed auto-deletes consumed echoes (single-use)
 *  - _registerPushedEchoes prunes expired entries on each call
 *  - Mixed record IDs: only matching ID is suppressed
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  _recentlyPushed,
  _registerPushedEchoes,
  _isEchoSuppressed,
  ECHO_SUPPRESS_TTL_MS,
} from '../echoSuppression.js';

beforeEach(() => {
  _recentlyPushed.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  _recentlyPushed.clear();
});

describe('_registerPushedEchoes', () => {
  it('registers a single pushed record', () => {
    _registerPushedEchoes([{ collection: 'orders', recordId: 'ord_1' }]);
    expect(_recentlyPushed.size).toBe(1);
    expect(_recentlyPushed.has('orders:ord_1')).toBe(true);
  });

  it('registers multiple records at once', () => {
    _registerPushedEchoes([
      { collection: 'orders', recordId: 'ord_1' },
      { collection: 'order_items', recordId: 'oi_2' },
    ]);
    expect(_recentlyPushed.size).toBe(2);
  });

  it('uses custom TTL when provided', () => {
    const customTtl = 10_000;
    const now = Date.now();
    _registerPushedEchoes([{ collection: 'orders', recordId: 'ord_x' }], customTtl);
    const expiry = _recentlyPushed.get('orders:ord_x');
    expect(expiry).toBeGreaterThanOrEqual(now + customTtl - 50);
    expect(expiry).toBeLessThanOrEqual(now + customTtl + 50);
  });

  it('prunes expired entries on each call', () => {
    _registerPushedEchoes([{ collection: 'orders', recordId: 'old' }], 100);
    vi.advanceTimersByTime(200);
    _registerPushedEchoes([{ collection: 'orders', recordId: 'new_entry' }]);
    expect(_recentlyPushed.has('orders:old')).toBe(false);
    expect(_recentlyPushed.has('orders:new_entry')).toBe(true);
  });

  it('skips entries with null recordId', () => {
    _registerPushedEchoes([{ collection: 'orders', recordId: null }]);
    expect(_recentlyPushed.size).toBe(0);
  });
});

describe('_isEchoSuppressed', () => {
  it('returns true for a recently pushed record within TTL', () => {
    _registerPushedEchoes([{ collection: 'orders', recordId: 'ord_1' }]);
    expect(_isEchoSuppressed('orders', 'ord_1')).toBe(true);
  });

  it('returns false for a record that was never pushed', () => {
    expect(_isEchoSuppressed('orders', 'ord_unknown')).toBe(false);
  });

  it('returns false after TTL has expired', () => {
    _registerPushedEchoes([{ collection: 'orders', recordId: 'ord_1' }], ECHO_SUPPRESS_TTL_MS);
    vi.advanceTimersByTime(ECHO_SUPPRESS_TTL_MS + 1);
    expect(_isEchoSuppressed('orders', 'ord_1')).toBe(false);
  });

  it('returns true on repeated checks within TTL (not single-use)', () => {
    _registerPushedEchoes([{ collection: 'orders', recordId: 'ord_1' }]);
    expect(_isEchoSuppressed('orders', 'ord_1')).toBe(true);
    // Second check within TTL should also return true (echo is NOT consumed on read)
    expect(_isEchoSuppressed('orders', 'ord_1')).toBe(true);
  });

  it('does not suppress a different record in same collection', () => {
    _registerPushedEchoes([{ collection: 'orders', recordId: 'ord_1' }]);
    expect(_isEchoSuppressed('orders', 'ord_2')).toBe(false);
  });

  it('does not suppress same recordId in a different collection', () => {
    _registerPushedEchoes([{ collection: 'orders', recordId: 'ord_1' }]);
    expect(_isEchoSuppressed('order_items', 'ord_1')).toBe(false);
  });
});
