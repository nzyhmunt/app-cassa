import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import DirectusSyncSettings from '../shared/DirectusSyncSettings.vue';
import { appConfig } from '../../utils/index.js';
import { clearAllStateFromIDB } from '../../store/persistence/operations.js';

const syncMock = {
  syncStatus: { value: 'idle' },
  lastPushAt: { value: null },
  lastPullAt: { value: null },
  wsConnected: { value: false },
  reconfigureAndApply: vi.fn(),
  forcePull: vi.fn(),
};

const directusEnabledRefMock = { value: true };
const loadDirectusConfigFromStorageMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../composables/useDirectusSync.js', () => ({
  useDirectusSync: () => syncMock,
}));

vi.mock('../../composables/useDirectusClient.js', () => ({
  directusEnabledRef: directusEnabledRefMock,
  loadDirectusConfigFromStorage: loadDirectusConfigFromStorageMock,
}));

vi.mock('../../store/index.js', () => ({
  useConfigStore: () => ({
    saveDirectusSettings: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../store/persistence/operations.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    clearAllStateFromIDB: vi.fn().mockResolvedValue(undefined),
  };
});

describe('DirectusSyncSettings clean IDB resync action', () => {
  let originalDirectusConfig;

  beforeEach(() => {
    originalDirectusConfig = JSON.parse(JSON.stringify(appConfig.directus ?? {}));
    appConfig.directus = {
      ...appConfig.directus,
      enabled: true,
      url: 'https://directus.example.com',
      staticToken: 'test-token',
      venueId: 1,
      wsEnabled: false,
    };
    directusEnabledRefMock.value = true;
    syncMock.reconfigureAndApply.mockResolvedValue({ ok: true, failedCollections: [] });
    syncMock.forcePull.mockResolvedValue({ ok: true, failedCollections: [] });
  });

  afterEach(() => {
    appConfig.directus = originalDirectusConfig;
    vi.clearAllMocks();
  });

  it('shows and executes "Ripristina IDB + Sync completa"', async () => {
    const wrapper = mount(DirectusSyncSettings, {
      global: {
        stubs: {
          SyncMonitor: { template: '<div />' },
        },
      },
    });

    await flushPromises();

    const openButton = wrapper.findAll('button').find((btn) => btn.text().includes('Ripristina IDB + Sync completa'));
    expect(openButton).toBeTruthy();
    await openButton.trigger('click');
    await flushPromises();

    const runButton = wrapper.findAll('button').find((btn) => btn.text().includes('Conferma e ripristina'));
    expect(runButton).toBeTruthy();
    await runButton.trigger('click');
    await flushPromises();

    expect(clearAllStateFromIDB).toHaveBeenCalledTimes(1);
    expect(syncMock.reconfigureAndApply).toHaveBeenCalledWith(expect.objectContaining({
      clearLocalConfig: true,
      onProgress: expect.any(Function),
    }));
    expect(syncMock.forcePull).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });
});
