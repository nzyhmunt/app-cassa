import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import SyncMonitor from '../shared/SyncMonitor.vue';

const getSyncLogsMock = vi.fn();
const getPendingEntriesMock = vi.fn();
const getFailedSyncCallsMock = vi.fn();
const clearFailedSyncCallsMock = vi.fn();
const exportFailedSyncCallsMock = vi.fn();

vi.mock('../../composables/useDirectusSync.js', () => ({
  useDirectusSync: () => ({
    wsConnected: { value: true },
    wsDropCount: { value: 0 },
    queueDepth: { value: 0 },
    lastSuccessfulPull: { value: null },
    lastPushAt: { value: null },
    lastPullAt: { value: null },
    forcePush: vi.fn().mockResolvedValue({ failed: 0 }),
    forcePull: vi.fn().mockResolvedValue({ ok: true }),
    reconfigureAndApply: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../store/persistence/syncLogs.js', () => ({
  getSyncLogs: (...args) => getSyncLogsMock(...args),
  clearSyncLogs: vi.fn().mockResolvedValue(undefined),
  exportSyncLogs: vi.fn().mockResolvedValue({}),
  _BC_CHANNEL: 'sync-logs',
  _TAB_ID: 'test-tab',
  SYNC_LOGS_MAX_SUCCESS: 100,
  SYNC_LOGS_MAX_ERRORS: 200,
}));

vi.mock('../../composables/useSyncQueue.js', () => ({
  getPendingEntries: (...args) => getPendingEntriesMock(...args),
  getFailedSyncCalls: (...args) => getFailedSyncCallsMock(...args),
  clearFailedSyncCalls: (...args) => clearFailedSyncCallsMock(...args),
  exportFailedSyncCalls: (...args) => exportFailedSyncCallsMock(...args),
}));

enableAutoUnmount(afterEach);

function mountSyncMonitor() {
  return mount(SyncMonitor, {
    props: { modelValue: true },
  });
}

function findLogRow(wrapper, text) {
  return wrapper
    .findAll('button.w-full.text-left')
    .find(btn => btn.text().includes(text));
}

describe('SyncMonitor watchdog vs network classification', () => {
  let origCreateObjectURL;
  let origRevokeObjectURL;

  beforeEach(() => {
    vi.useFakeTimers();
    getPendingEntriesMock.mockResolvedValue([]);
    getFailedSyncCallsMock.mockResolvedValue([]);
    clearFailedSyncCallsMock.mockResolvedValue(undefined);
    exportFailedSyncCallsMock.mockResolvedValue([]);
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: vi.fn() },
      });
    }
    try {
      vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    } catch {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
      });
    }
    origCreateObjectURL = URL.createObjectURL;
    origRevokeObjectURL = URL.revokeObjectURL;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => 'blob:sync-monitor-test'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    URL.createObjectURL = origCreateObjectURL;
    URL.revokeObjectURL = origRevokeObjectURL;
  });

  it('renders WS Watchdog vs Network Error labels and copies the correct status suffix', async () => {
    getSyncLogsMock.mockResolvedValue([
      {
        id: 1986,
        timestamp: '2026-05-07T21:16:33.510Z',
        direction: 'IN',
        type: 'WS',
        endpoint: '/websocket/heartbeat',
        payload: { phase: 2, silenceMs: 60000, action: 'force_reconnect' },
        response: null,
        status: 'error',
        statusCode: null,
        durationMs: null,
        collection: null,
        recordCount: null,
        operation: null,
        method: null,
      },
      {
        id: 1987,
        timestamp: '2026-05-07T21:17:00.000Z',
        direction: 'OUT',
        type: 'PUSH',
        endpoint: '/items/orders/ord_1',
        payload: { id: 'ord_1' },
        response: null,
        status: 'error',
        statusCode: null,
        durationMs: 1234,
        collection: 'orders',
        recordCount: 1,
        operation: 'update',
        method: 'PATCH',
      },
    ]);

    const wrapper = mountSyncMonitor();
    await flushPromises();

    const heartbeatRow = findLogRow(wrapper, '/websocket/heartbeat');
    const networkRow = findLogRow(wrapper, '/items/orders/ord_1');
    expect(heartbeatRow).toBeTruthy();
    expect(networkRow).toBeTruthy();
    expect(heartbeatRow.text()).toContain('WS Watchdog');
    expect(heartbeatRow.text()).not.toContain('Network Error');
    expect(networkRow.text()).toContain('Network Error');
    expect(networkRow.text()).not.toContain('WS Watchdog');
    expect(heartbeatRow.classes()).toContain('bg-orange-50');
    expect(heartbeatRow.classes()).toContain('border-orange-200');
    expect(networkRow.classes()).toContain('bg-red-50');
    expect(networkRow.classes()).toContain('border-red-200');

    await heartbeatRow.trigger('click');
    await flushPromises();
    await wrapper.find('button[title="Copia blocco tecnico completo"]').trigger('click');
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
      expect.stringContaining('Status:     error  (watchdog)'),
    );

    await networkRow.trigger('click');
    await flushPromises();
    await wrapper.find('button[title="Copia blocco tecnico completo"]').trigger('click');
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
      expect.stringContaining('Status:     error  (network)'),
    );
  });

  it('shows export/clear controls for failed calls and handles actions', async () => {
    getSyncLogsMock.mockResolvedValue([]);
    getFailedSyncCallsMock.mockResolvedValueOnce([
      {
        id: 'sqf_1',
        queue_entry_id: 'sq_1',
        collection: 'orders',
        operation: 'update',
        record_id: 'ord_1',
        attempts: 5,
        abandoned: true,
        error_message: 'Gateway timeout',
        failed_at: '2026-05-07T21:16:33.510Z',
        request: null,
        response: null,
        payload: { status: 'accepted' },
      },
    ]);
    exportFailedSyncCallsMock.mockResolvedValue([{ id: 'sqf_1' }]);

    const wrapper = mountSyncMonitor();
    await flushPromises();

    await wrapper.find('button[title="Esporta tutte le chiamate fallite come file JSON"]').trigger('click');
    expect(exportFailedSyncCallsMock).toHaveBeenCalledTimes(1);

    await wrapper.find('button[title="Cancella tutte le chiamate fallite"]').trigger('click');
    await flushPromises();
    expect(clearFailedSyncCallsMock).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('Nessuna chiamata fallita');
  });
});
