/**
 * @file composables/printDispatch.js
 * @description Transport and Directus-queue helpers for print jobs.
 */

import {
  isDirectusManagedPrinter,
  PRINT_JOBS_COLLECTION,
  PRINT_JOBS_ENDPOINT,
  PRINT_LOG_STATUSES,
} from '../utils/index.js';
import { addSyncLog } from '../store/persistence/syncLogs.js';

function addPrintActivityLog({
  endpoint,
  payload,
  status,
  statusCode = null,
  durationMs = 0,
  method = null,
  operation = null,
}) {
  addSyncLog({
    direction: 'OUT',
    type: 'PRINT',
    endpoint,
    payload,
    response: null,
    status,
    statusCode,
    durationMs,
    collection: PRINT_JOBS_COLLECTION,
    operation,
    method,
  });
}

/**
 * Marks a Directus-managed print job as queued in the local UI and appends an
 * activity-log entry without mutating the Directus record status.
 *
 * @param {{ store?: object|null, logId: string, job: object }} options
 */
export function queueDirectusPrintJob(options) {
  const { store = null, logId, job } = options;
  store?.updatePrintLogEntryLocal(logId, { status: PRINT_LOG_STATUSES.QUEUED });
  addPrintActivityLog({
    endpoint: PRINT_JOBS_ENDPOINT,
    payload: job,
    status: PRINT_LOG_STATUSES.QUEUED,
    operation: 'create',
  });
}

/**
 * Sends a single print job to a printer service URL and updates the matching log entry.
 *
 * @param {{ job: object, url: string, logId: string, store?: object|null }} options
 */
export async function sendHttpPrintJob(options) {
  const { job, url, logId, store = null } = options;
  store?.updatePrintLogEntry(logId, { status: PRINT_LOG_STATUSES.PRINTING });
  const t0 = Date.now();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job),
    });
    const durationMs = Date.now() - t0;

    if (response.ok) {
      store?.updatePrintLogEntry(logId, { status: PRINT_LOG_STATUSES.DONE });
      addPrintActivityLog({
        endpoint: url,
        payload: job,
        status: 'success',
        statusCode: response.status,
        durationMs,
        method: 'POST',
      });
      return;
    }

    const message = `HTTP ${response.status}`;
    console.warn(`[PrintQueue] Printer "${job.printerId}" returned ${message}`);
    store?.updatePrintLogEntry(logId, { status: PRINT_LOG_STATUSES.ERROR, errorMessage: message });
    addPrintActivityLog({
      endpoint: url,
      payload: job,
      status: 'error',
      statusCode: response.status,
      durationMs,
      method: 'POST',
    });
  } catch (err) {
    const durationMs = Date.now() - t0;
    const message = err?.message ?? String(err);
    console.warn(`[PrintQueue] Could not reach printer "${job.printerId}" at ${url}:`, message);
    store?.updatePrintLogEntry(logId, { status: PRINT_LOG_STATUSES.ERROR, errorMessage: message });
    addPrintActivityLog({
      endpoint: url,
      payload: job,
      status: 'error',
      durationMs,
      method: 'POST',
    });
  }
}

/**
 * Dispatches a job either directly over HTTP or via the Directus-managed
 * printer queue, depending on the resolved printer connection type.
 *
 * @param {{
 *   job: object,
 *   printer?: object|null,
 *   logId: string,
 *   store?: object|null,
 *   url?: string|null,
 * }} options
 */
export function dispatchPrintJob(options) {
  const {
    job,
    printer = null,
    logId,
    store = null,
    url = printer?.url ?? null,
  } = options;

  if (!isDirectusManagedPrinter(printer) && url) {
    sendHttpPrintJob({ job, url, logId, store });
    return;
  }

  queueDirectusPrintJob({ store, logId, job });
}
