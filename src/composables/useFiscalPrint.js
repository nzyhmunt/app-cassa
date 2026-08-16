/**
 * @file composables/useFiscalPrint.js
 * @description Dispatch di job fiscali (scontrino, Z/X report, stato) verso la
 * stampante fiscale Epson RT tramite il print-server.
 *
 * Il print-server costruisce l'XML Fiscal ePOS-Print e lo invia a fpmate.cgi;
 * il browser invia solo i dati strutturati del job (printType, orders, payments).
 *
 * Funzioni esportate:
 *   dispatchFiscalReceipt({ base, printerId? })   – emette uno scontrino fiscale
 *   dispatchFiscalZReport({ printerId? })         – chiusura giornaliera (Z)
 *   dispatchFiscalXReport({ printerId? })         – report finanziario (X)
 *   dispatchFiscalStatus({ printerId?, statusType? }) – query stato stampante
 *   resolveFiscalPrinter()                        – restituisce la stampante fiscale configurata
 *
 * Ogni dispatch aggiorna la entry corrispondente in store (fiscalReceipts per gli
 * scontrini) con la risposta della stampante (fiscalReceiptNumber, amount, …).
 */

import { newUUIDv7 } from '../store/storeUtils.js';
import { useAppStore } from '../store/index.js';
import {
  appConfig,
  PRINT_JOB_TYPES,
  PRINT_LOG_STATUSES,
  getFiscalPrinter,
} from '../utils/index.js';
import { addSyncLog } from '../store/persistence/syncLogs.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function getStore() {
  try {
    return useAppStore();
  } catch {
    return null;
  }
}

function getRuntimeConfig(store = null) {
  const resolvedStore = store ?? getStore();
  const storeConfig = resolvedStore?.config ?? {};
  const storeHydrated = resolvedStore?.configHydrated === true;
  return storeHydrated
    ? { ...appConfig, ...storeConfig }
    : { ...storeConfig, ...appConfig };
}

/**
 * Resolves the configured fiscal printer (first fpmate printer with id+url).
 * @param {object|null} [store]
 * @returns {object|null}
 */
export function resolveFiscalPrinter(store = null) {
  return getFiscalPrinter(getRuntimeConfig(store).printers);
}

/**
 * Sends a fiscal job to the print-server and returns the parsed fiscal response.
 *
 * @param {{ job: object, printer: object }} options
 * @returns {Promise<{ ok: boolean, fiscal?: object, error?: string }>}
 */
async function sendFiscalJob({ job, printer }) {
  const url = printer.url;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job),
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }

    if (response.ok && data.ok === true) {
      return { ok: true, fiscal: data.fiscal ?? null };
    }
    const message = data?.error || `HTTP ${response.status}`;
    return { ok: false, error: message };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

function logFiscalActivity({ endpoint, payload, status, statusCode = null }) {
  addSyncLog({
    direction: 'OUT',
    type: 'FISCAL',
    endpoint,
    payload,
    response: null,
    status,
    statusCode,
    durationMs: 0,
    collection: 'fiscal_receipts',
    operation: payload?.printType ?? null,
    method: 'POST',
  });
}

// ── Fiscal receipt ──────────────────────────────────────────────────────────

/**
 * Emits a fiscal receipt (commercial document) for the given bill summary.
 *
 * @param {{
 *   base: object,
 *   printerId?: string|null,
 *   entry?: object,        // existing fiscalReceipt entry to update (id, timestamp)
 * }} options
 *   `base` is the bill summary produced by _buildBillSummaryBase():
 *     { orders: [{ items: [{ name, quantity, unitPrice }] }], paymentMethods: string[], totalAmount }
 * @returns {Promise<{ ok: boolean, entry?: object, error?: string }>}
 */
export async function dispatchFiscalReceipt({ base, printerId = null, entry = null }) {
  const store = getStore();
  const printer = resolveFiscalPrinter(store);
  if (!printer) {
    return { ok: false, error: 'Nessuna stampante fiscale configurata.' };
  }
  const resolvedPrinterId = printerId ?? printer.id;

  // Build payments from the bill summary payment methods.
  const paymentMethods = Array.isArray(base.paymentMethods) ? base.paymentMethods : [];
  const payments = paymentMethods.length > 0
    ? paymentMethods.map((label) => ({ label, amount: base.totalAmount }))
    : [{ label: 'CONTANTI', amount: base.totalAmount }];

  const job = {
    jobId: entry?.id ?? newUUIDv7(),
    printType: PRINT_JOB_TYPES.FISCAL_RECEIPT,
    printerId: resolvedPrinterId,
    orders: base.orders ?? [],
    payments,
    totalAmount: base.totalAmount ?? 0,
    timestamp: entry?.timestamp ?? new Date().toISOString(),
  };

  const { ok, fiscal, error } = await sendFiscalJob({ job, printer });
  logFiscalActivity({
    endpoint: printer.url,
    payload: job,
    status: ok ? PRINT_LOG_STATUSES.DONE : PRINT_LOG_STATUSES.ERROR,
  });

  if (!ok) {
    return { ok: false, error };
  }

  const addInfo = fiscal?.addInfo ?? {};
  const updatedFields = {
    xmlResponse: fiscal?.raw ?? null,
    fiscalReceiptNumber: addInfo.fiscalReceiptNumber ?? null,
    fiscalReceiptAmount: addInfo.fiscalReceiptAmount ?? null,
    fiscalReceiptDate: addInfo.fiscalReceiptDate ?? null,
    fiscalReceiptTime: addInfo.fiscalReceiptTime ?? null,
    receiptISODateTime: addInfo.receiptISODateTime ?? null,
    zRepNumber: addInfo.zRepNumber ?? null,
    serialNumber: addInfo.serialNumber ?? null,
    printerStatus: addInfo.printerStatus ?? null,
    status: PRINT_LOG_STATUSES.DONE,
  };
  // When updating an existing pending entry (id already in the store), use
  // updateFiscalReceipt to avoid creating a duplicate; otherwise add a new one.
  const existing = store?.fiscalReceipts?.value?.find((e) => e?.id === job.jobId);
  if (existing) {
    store?.updateFiscalReceipt(job.jobId, updatedFields);
  } else {
    store?.addFiscalReceipt({
      id: job.jobId,
      ...base,
      ...updatedFields,
      timestamp: job.timestamp,
    });
  }
  return { ok: true, entry: { ...(existing ?? {}), ...updatedFields, id: job.jobId } };
}

// ── Z / X reports ───────────────────────────────────────────────────────────

/**
 * Emits a daily closure (Z report). Data transmission to the tax authority
 * happens automatically inside the fiscal printer.
 * @param {{ printerId?: string|null, operator?: string|number }} options
 * @returns {Promise<{ ok: boolean, fiscal?: object, error?: string }>}
 */
export async function dispatchFiscalZReport({ printerId = null, operator } = {}) {
  const store = getStore();
  const printer = resolveFiscalPrinter(store);
  if (!printer) return { ok: false, error: 'Nessuna stampante fiscale configurata.' };

  const job = {
    jobId: newUUIDv7(),
    printType: PRINT_JOB_TYPES.FISCAL_Z_REPORT,
    printerId: printerId ?? printer.id,
    timestamp: new Date().toISOString(),
  };
  if (operator != null) job.operator = operator;

  const result = await sendFiscalJob({ job, printer });
  logFiscalActivity({
    endpoint: printer.url,
    payload: job,
    status: result.ok ? PRINT_LOG_STATUSES.DONE : PRINT_LOG_STATUSES.ERROR,
  });
  return result;
}

/**
 * Emits a daily financial report (X report — non fiscal).
 * @param {{ printerId?: string|null, operator?: string|number }} options
 * @returns {Promise<{ ok: boolean, fiscal?: object, error?: string }>}
 */
export async function dispatchFiscalXReport({ printerId = null, operator } = {}) {
  const store = getStore();
  const printer = resolveFiscalPrinter(store);
  if (!printer) return { ok: false, error: 'Nessuna stampante fiscale configurata.' };

  const job = {
    jobId: newUUIDv7(),
    printType: PRINT_JOB_TYPES.FISCAL_X_REPORT,
    printerId: printerId ?? printer.id,
    timestamp: new Date().toISOString(),
  };
  if (operator != null) job.operator = operator;

  const result = await sendFiscalJob({ job, printer });
  logFiscalActivity({
    endpoint: printer.url,
    payload: job,
    status: result.ok ? PRINT_LOG_STATUSES.DONE : PRINT_LOG_STATUSES.ERROR,
  });
  return result;
}

/**
 * Queries the fiscal printer status (basic or RT).
 * @param {{ printerId?: string|null, statusType?: '0'|'1' }} options
 * @returns {Promise<{ ok: boolean, fiscal?: object, error?: string }>}
 */
export async function dispatchFiscalStatus({ printerId = null, statusType = '0' } = {}) {
  const store = getStore();
  const printer = resolveFiscalPrinter(store);
  if (!printer) return { ok: false, error: 'Nessuna stampante fiscale configurata.' };

  const job = {
    jobId: newUUIDv7(),
    printType: PRINT_JOB_TYPES.FISCAL_STATUS,
    printerId: printerId ?? printer.id,
    statusType,
    timestamp: new Date().toISOString(),
  };

  const result = await sendFiscalJob({ job, printer });
  logFiscalActivity({
    endpoint: printer.url,
    payload: job,
    status: result.ok ? PRINT_LOG_STATUSES.DONE : PRINT_LOG_STATUSES.ERROR,
  });
  return result;
}
