import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import DirectusSyncSettings from '../shared/DirectusSyncSettings.vue';
import { appConfig } from '../../utils/index.js';
import { clearEntireIDB } from '../../store/persistence/operations.js';

const { syncMock, directusEnabledRefMock, loadDirectusConfigFromStorageMock, saveDirectusConfigToStorageMock } = vi.hoisted(() => ({
  syncMock: {
    syncStatus: { value: 'idle' },
    lastPushAt: { value: null },
    lastPullAt: { value: null },
    wsConnected: { value: false },
    reconfigureAndApply: vi.fn(),
    forcePull: vi.fn(),
  },
  directusEnabledRefMock: { value: true },
  loadDirectusConfigFromStorageMock: vi.fn().mockResolvedValue(undefined),
  saveDirectusConfigToStorageMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../composables/useDirectusSync.js', () => ({
  useDirectusSync: () => syncMock,
}));

vi.mock('../../composables/useDirectusClient.js', () => ({
  directusEnabledRef: directusEnabledRefMock,
  loadDirectusConfigFromStorage: loadDirectusConfigFromStorageMock,
  saveDirectusConfigToStorage: saveDirectusConfigToStorageMock,
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
    clearEntireIDB: vi.fn().mockResolvedValue(undefined),
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

    const openButton = wrapper.findAll('button').find((btn) => btn.text().includes('Ripristina dati locali + Sync completa'));
    expect(openButton).toBeTruthy();
    await openButton.trigger('click');
    await flushPromises();

    const runButton = wrapper.findAll('button').find((btn) => btn.text().includes('Conferma e ripristina'));
    expect(runButton).toBeTruthy();
    await runButton.trigger('click');
    await flushPromises();

    expect(clearEntireIDB).toHaveBeenCalledTimes(1);
    expect(saveDirectusConfigToStorageMock).toHaveBeenCalledWith({ silent: true });

    // Directus config must be re-saved BEFORE reconfigureAndApply so that a
    // page reload after the operation boots with Directus enabled.
    const clearOrder = vi.mocked(clearEntireIDB).mock.invocationCallOrder[0];
    const saveOrder = saveDirectusConfigToStorageMock.mock.invocationCallOrder[0];
    const reconfigOrder = syncMock.reconfigureAndApply.mock.invocationCallOrder[0];
    expect(saveOrder).toBeGreaterThan(clearOrder);
    expect(reconfigOrder).toBeGreaterThan(saveOrder);

    expect(syncMock.reconfigureAndApply).toHaveBeenCalledWith(expect.objectContaining({
      clearLocalConfig: true,
      onProgress: expect.any(Function),
    }));
    expect(syncMock.forcePull).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it('aborts and shows an error log when saveDirectusConfigToStorage fails after IDB clear', async () => {
    saveDirectusConfigToStorageMock.mockRejectedValueOnce(new Error('IDB write failed'));

    const wrapper = mount(DirectusSyncSettings, {
      global: {
        stubs: {
          SyncMonitor: { template: '<div />' },
        },
      },
    });

    await flushPromises();

    const openButton = wrapper.findAll('button').find((btn) => btn.text().includes('Ripristina dati locali + Sync completa'));
    await openButton.trigger('click');
    await flushPromises();

    const runButton = wrapper.findAll('button').find((btn) => btn.text().includes('Conferma e ripristina'));
    await runButton.trigger('click');
    await flushPromises();

    expect(clearEntireIDB).toHaveBeenCalledTimes(1);
    expect(saveDirectusConfigToStorageMock).toHaveBeenCalledTimes(1);
    // reconfigureAndApply must NOT be called when credentials cannot be saved
    expect(syncMock.reconfigureAndApply).not.toHaveBeenCalled();
    // An error message should be visible in the log
    expect(wrapper.html()).toContain('Impossibile salvare le credenziali Directus');

    wrapper.unmount();
  });
});
