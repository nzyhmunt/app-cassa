import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { getDB, _resetIDBSingleton } from '../useIDB.js';
import {
  loadDirectusConfigFromStorage,
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
