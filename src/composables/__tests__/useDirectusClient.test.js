import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { getDB, _resetIDBSingleton } from '../useIDB.js';
import {
  getDirectusClient,
  loadDirectusConfigFromStorage,
  saveDirectusConfigToStorage,
  directusEnabledRef,
  _resetDirectusClientSingleton,
} from '../useDirectusClient.js';
import { useConfigStore } from '../../store/index.js';
import { appConfig } from '../../utils/index.js';

const DIRECTUS_CONFIG_RECORD_ID = 'directus_config';

describe('useDirectusClient.loadDirectusConfigFromStorage()', () => {
  let previousDirectusConfig;

  beforeEach(async () => {
    previousDirectusConfig = structuredClone(appConfig.directus);
    await _resetIDBSingleton();
    _resetDirectusClientSingleton();
    setActivePinia(createPinia());
    directusEnabledRef.value = false;
  });

  afterEach(() => {
    appConfig.directus = previousDirectusConfig;
    _resetDirectusClientSingleton();
  });

  it('synchronizes ConfigStore directus snapshot after loading from IDB', async () => {
    const configStore = useConfigStore();
    const db = await getDB();
    await db.put('app_meta', {
      id: DIRECTUS_CONFIG_RECORD_ID,
      value: {
        enabled: true,
        url: 'https://directus.sync.example.com',
        staticToken: 'tok_sync',
        venueId: 42,
        wsEnabled: true,
      },
    });

    await loadDirectusConfigFromStorage();

    expect(directusEnabledRef.value).toBe(true);
    expect(appConfig.directus).toEqual({
      enabled: true,
      url: 'https://directus.sync.example.com',
      staticToken: 'tok_sync',
      venueId: 42,
      wsEnabled: true,
    });
    expect(configStore.config.directus).toEqual(expect.objectContaining({
      enabled: true,
      url: 'https://directus.sync.example.com',
      staticToken: 'tok_sync',
      venueId: 42,
      wsEnabled: true,
    }));
  });
});

describe('useDirectusClient.saveDirectusConfigToStorage()', () => {
  let previousDirectusConfig;

  beforeEach(async () => {
    previousDirectusConfig = structuredClone(appConfig.directus);
    appConfig.directus = {
      enabled: true,
      url: 'https://directus.save.example.com',
      staticToken: 'tok_save',
      venueId: 7,
      wsEnabled: false,
    };
    await _resetIDBSingleton();
    _resetDirectusClientSingleton();
  });

  afterEach(() => {
    appConfig.directus = previousDirectusConfig;
    _resetDirectusClientSingleton();
  });

  it('dispatches directus-config-updated when called without options', async () => {
    const handler = vi.fn();
    window.addEventListener('directus-config-updated', handler);
    try {
      await saveDirectusConfigToStorage();
    } finally {
      window.removeEventListener('directus-config-updated', handler);
    }
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('suppresses directus-config-updated when called with { silent: true }', async () => {
    const handler = vi.fn();
    window.addEventListener('directus-config-updated', handler);
    try {
      await saveDirectusConfigToStorage({ silent: true });
    } finally {
      window.removeEventListener('directus-config-updated', handler);
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('suppresses directus-config-updated when called with { silent: true, skipClientReset: true }', async () => {
    const handler = vi.fn();
    window.addEventListener('directus-config-updated', handler);
    try {
      await saveDirectusConfigToStorage({ silent: true, skipClientReset: true });
    } finally {
      window.removeEventListener('directus-config-updated', handler);
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('persists the current appConfig.directus to IDB', async () => {
    await saveDirectusConfigToStorage({ silent: true });
    const db = await getDB();
    const record = await db.get('app_meta', DIRECTUS_CONFIG_RECORD_ID);
    expect(record?.value).toMatchObject({
      enabled: true,
      url: 'https://directus.save.example.com',
      staticToken: 'tok_save',
      venueId: 7,
    });
  });

  it('preserves the cached SDK client when { skipClientReset: true }; resets it by default', async () => {
    // Establish a cached client instance (requires valid enabled config).
    const clientA = getDirectusClient();
    expect(clientA).not.toBeNull();

    // skipClientReset: true — client must NOT be reset.
    await saveDirectusConfigToStorage({ silent: true, skipClientReset: true });
    expect(getDirectusClient()).toBe(clientA);

    // Default (skipClientReset: false) — client IS reset; next call rebuilds it.
    await saveDirectusConfigToStorage({ silent: true });
    const clientB = getDirectusClient();
    expect(clientB).not.toBe(clientA);
  });
});
