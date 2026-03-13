import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  SCHEMA_VERSION,
  getInstanceName,
  resolveStorageKeys,
  clearState,
} from '../persistence.js';
import { appConfig } from '../../utils/index.js';

// ---------------------------------------------------------------------------
// SCHEMA_VERSION
// ---------------------------------------------------------------------------
describe('SCHEMA_VERSION', () => {
  it('is 1', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getInstanceName()
// ---------------------------------------------------------------------------
describe('getInstanceName()', () => {
  let originalInstanceName;

  beforeEach(() => {
    originalInstanceName = appConfig.instanceName;
  });

  afterEach(() => {
    appConfig.instanceName = originalInstanceName;
  });

  it("returns '' when appConfig.instanceName is empty", () => {
    appConfig.instanceName = '';
    expect(getInstanceName()).toBe('');
  });

  it("returns '' when appConfig.instanceName is falsy (undefined)", () => {
    appConfig.instanceName = undefined;
    expect(getInstanceName()).toBe('');
  });

  it('returns the configured instance name when appConfig.instanceName is set', () => {
    appConfig.instanceName = 'cassa1';
    expect(getInstanceName()).toBe('cassa1');
  });
});

// ---------------------------------------------------------------------------
// resolveStorageKeys()
// ---------------------------------------------------------------------------
describe('resolveStorageKeys()', () => {
  it('returns default keys when called with an empty instance name', () => {
    const { storageKey, settingsKey } = resolveStorageKeys('');
    expect(storageKey).toBe('demo_app_state_v1');
    expect(settingsKey).toBe('app-settings');
  });

  it('returns namespaced keys when an instance name is provided', () => {
    const { storageKey, settingsKey } = resolveStorageKeys('cassa1');
    expect(storageKey).toBe('demo_app_state_cassa1_v1');
    expect(settingsKey).toBe('app-settings_cassa1');
  });

  it('falls back to getInstanceName() when no argument is given', () => {
    // Default build has instanceName === '' so keys match the default set
    const { storageKey, settingsKey } = resolveStorageKeys();
    expect(storageKey).toBe('demo_app_state_v1');
    expect(settingsKey).toBe('app-settings');
  });

  it('derives the correct key suffix for arbitrary instance names', () => {
    const { storageKey, settingsKey } = resolveStorageKeys('sala2');
    expect(storageKey).toBe('demo_app_state_sala2_v1');
    expect(settingsKey).toBe('app-settings_sala2');
  });
});

// ---------------------------------------------------------------------------
// clearState()
// ---------------------------------------------------------------------------
describe('clearState()', () => {
  beforeEach(() => localStorage.clear());

  it('removes the given key from localStorage', () => {
    localStorage.setItem('test_key', 'some_data');
    clearState('test_key');
    expect(localStorage.getItem('test_key')).toBeNull();
  });

  it('is a no-op when the key does not exist', () => {
    expect(() => clearState('nonexistent_key')).not.toThrow();
  });

  it('does not affect other localStorage keys', () => {
    localStorage.setItem('key_a', 'a');
    localStorage.setItem('key_b', 'b');
    clearState('key_a');
    expect(localStorage.getItem('key_b')).toBe('b');
  });
});
