import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetIDBSingleton } from '../useIDB.js';
import { getSyncLogs } from '../../store/persistence/syncLogs.js';
import {
  dispatchPrintJob,
  queueDirectusPrintJob,
  sendHttpPrintJob,
} from '../printDispatch.js';

function createStoreStub() {
  return {
    updatePrintLogEntry: vi.fn(),
    updatePrintLogEntryLocal: vi.fn(),
  };
}

const ORIGINAL_FETCH = global.fetch;

beforeEach(async () => {
  await _resetIDBSingleton();
  vi.restoreAllMocks();
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  global.fetch = ORIGINAL_FETCH;
});

describe('queueDirectusPrintJob()', () => {
  it('marks the local entry as queued without writing an activity log', async () => {
    const store = createStoreStub();

    queueDirectusPrintJob({ store, logId: 'plog_1' });

    expect(store.updatePrintLogEntryLocal).toHaveBeenCalledWith('plog_1', { status: 'queued' });

    // Drain any pending async IDB writes before asserting absence.
    await new Promise(resolve => setTimeout(resolve, 0));

    // No sync log should be written here — the sync queue (_logPushResult)
    // produces the PRINT-type log when the job is actually POSTed to Directus.
    const logs = await getSyncLogs();
    expect(logs.find(log => log.endpoint === '/items/print_jobs')).toBeUndefined();
  });
});

describe('sendHttpPrintJob()', () => {
  it('updates printing → done and logs a successful HTTP print exchange', async () => {
    const store = createStoreStub();
    const job = { jobId: 'job_2', printerId: 'http_1', printType: 'order' };
    global.fetch.mockResolvedValue({ ok: true, status: 204 });

    await sendHttpPrintJob({
      job,
      url: 'http://localhost:3001/print',
      logId: 'plog_2',
      store,
    });

    expect(global.fetch).toHaveBeenCalledWith('http://localhost:3001/print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job),
    });
    expect(store.updatePrintLogEntry).toHaveBeenNthCalledWith(1, 'plog_2', { status: 'printing' });
    expect(store.updatePrintLogEntry).toHaveBeenNthCalledWith(2, 'plog_2', { status: 'done' });

    let logEntry;
    await vi.waitFor(async () => {
      const logs = await getSyncLogs();
      logEntry = logs.find(log => log.endpoint === 'http://localhost:3001/print');
      expect(logEntry).toBeDefined();
    });

    expect(logEntry).toMatchObject({
      endpoint: 'http://localhost:3001/print',
      collection: 'print_jobs',
      method: 'POST',
      status: 'success',
      statusCode: 204,
      payload: job,
    });
  });

  it('updates printing → error on HTTP failures and records the HTTP status message', async () => {
    const store = createStoreStub();
    const job = { jobId: 'job_3', printerId: 'http_2', printType: 'table_move' };
    global.fetch.mockResolvedValue({ ok: false, status: 503 });

    await sendHttpPrintJob({
      job,
      url: 'http://localhost:3002/print',
      logId: 'plog_3',
      store,
    });

    expect(store.updatePrintLogEntry).toHaveBeenNthCalledWith(1, 'plog_3', { status: 'printing' });
    expect(store.updatePrintLogEntry).toHaveBeenNthCalledWith(2, 'plog_3', {
      status: 'error',
      errorMessage: 'HTTP 503',
    });

    let logEntry;
    await vi.waitFor(async () => {
      const logs = await getSyncLogs();
      logEntry = logs.find(log => log.endpoint === 'http://localhost:3002/print');
      expect(logEntry).toBeDefined();
    });

    expect(logEntry).toMatchObject({
      endpoint: 'http://localhost:3002/print',
      method: 'POST',
      status: 'error',
      statusCode: 503,
      payload: job,
    });
  });

  it('updates printing → error on network failures and records the thrown message', async () => {
    const store = createStoreStub();
    const job = { jobId: 'job_4', printerId: 'http_3', printType: 'pre_bill' };
    global.fetch.mockRejectedValue(new Error('Network error'));

    await sendHttpPrintJob({
      job,
      url: 'http://localhost:3003/print',
      logId: 'plog_4',
      store,
    });

    expect(store.updatePrintLogEntry).toHaveBeenNthCalledWith(1, 'plog_4', { status: 'printing' });
    expect(store.updatePrintLogEntry).toHaveBeenNthCalledWith(2, 'plog_4', {
      status: 'error',
      errorMessage: 'Network error',
    });

    let logEntry;
    await vi.waitFor(async () => {
      const logs = await getSyncLogs();
      logEntry = logs.find(log => log.endpoint === 'http://localhost:3003/print');
      expect(logEntry).toBeDefined();
    });

    expect(logEntry).toMatchObject({
      endpoint: 'http://localhost:3003/print',
      method: 'POST',
      status: 'error',
      statusCode: null,
      payload: job,
    });
  });
});

describe('dispatchPrintJob()', () => {
  it('uses the explicit URL override for browser-routable printers', async () => {
    const store = createStoreStub();
    const job = { jobId: 'job_5', printerId: 'http_4', printType: 'order' };
    global.fetch.mockResolvedValue({ ok: true, status: 200 });

    dispatchPrintJob({
      job,
      printer: { id: 'http_4', url: 'http://localhost:9999/stale', connectionType: 'http' },
      url: 'http://localhost:3004/print',
      logId: 'plog_5',
      store,
    });

    let logEntry;
    await vi.waitFor(async () => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(store.updatePrintLogEntry).toHaveBeenNthCalledWith(2, 'plog_5', { status: 'done' });
      const logs = await getSyncLogs();
      logEntry = logs.find(log => log.endpoint === 'http://localhost:3004/print');
      expect(logEntry).toBeDefined();
    });

    expect(global.fetch).toHaveBeenCalledWith('http://localhost:3004/print', expect.any(Object));
    expect(logEntry).toMatchObject({
      endpoint: 'http://localhost:3004/print',
      status: 'success',
      method: 'POST',
      payload: job,
    });
  });

  it('queues directus-managed printers even when a stale URL is present', async () => {
    const store = createStoreStub();
    const job = { jobId: 'job_6', printerId: 'tcp_2', printType: 'order' };

    dispatchPrintJob({
      job,
      printer: { id: 'tcp_2', url: 'http://localhost:3999/stale', connectionType: 'tcp' },
      logId: 'plog_6',
      store,
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(store.updatePrintLogEntryLocal).toHaveBeenCalledWith('plog_6', { status: 'queued' });

    // Drain any pending async IDB writes before asserting absence.
    await new Promise(resolve => setTimeout(resolve, 0));

    // No sync log written here — the sync queue handles PRINT logging.
    const logs = await getSyncLogs();
    expect(logs.find(log => log.payload?.jobId === 'job_6')).toBeUndefined();
  });
});
