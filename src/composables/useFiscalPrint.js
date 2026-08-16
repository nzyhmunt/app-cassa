/**
 * @file composables/useFiscalPrint.js
 * @description Dispatch di job fiscali (scontrino, Z/X report, stato) verso la
 * stampante fiscale Epson RT tramite il print-server.
 *
 * Il print-server costruisce l'XML Fiscal ePOS-Print e lo invia a fpmate.cgi;
 * il browser invia solo i dati strutturati del job (printType, orders, payments).
 *
 * Funzioni esportate:
 *   dispatchFiscalReceipt({ base, printerId? })        – emette uno scontrino fiscale
 *   dispatchFiscalRefund({ base, receiptRef?, printerId? }) – reso merce (REFUND)
 *   dispatchFiscalVoid({ receiptRef, printerId? })     – annullo scontrino (VOID)
 *   dispatchFiscalZReport({ printerId? })              – chiusura giornaliera (Z)
 *   dispatchFiscalXReport({ printerId? })              – report finanziario (X)
 *   dispatchFiscalStatus({ printerId?, statusType? })  – query stato stampante
 *   dispatchFiscalDuplicate({ printerId? })            – ristampa ultimo scontrino
 *   dispatchFiscalOpenDrawer({ printerId? })           – apertura cassetto
 *   dispatchFiscalCash({ direction, amount, form?, printerId? }) – cash in/out
 *   resolveFiscalPrinter()                             – restituisce la stampante fiscale configurata
 *
 * Ogni dispatch aggiorna la entry corrispondente in store (fiscalReceipts per gli
 * scontrini) con la risposta della stampante (fiscalReceiptNumber, amount, …).
 */

import { newUUIDv7 } from '../store/storeUtils.js';
import { useConfigStore, useOrderStore } from '../store/index.js';
import {
  appConfig,
  PRINT_JOB_TYPES,
  PRINT_LOG_STATUSES,
  getFiscalPrinter,
} from '../utils/index.js';
import { addSyncLog } from '../store/persistence/syncLogs.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

// Use the explicit layered stores instead of the legacy useAppStore() merged
// proxy (see src/store/index.js): dependencies stay explicit and mocking is
// simpler. Outside a component/setup context (e.g. unit tests without an active
// Pinia) these throw and we degrade gracefully to null.
function getConfigStore() {
  try { return useConfigStore(); } catch { return null; }
}

function getOrderStore() {
  try { return useOrderStore(); } catch { return null; }
}

function getRuntimeConfig(configStore = null) {
  const resolved = configStore ?? getConfigStore();
  const storeConfig = resolved?.config ?? {};
  const storeHydrated = resolved?.configHydrated === true;
  return storeHydrated
    ? { ...appConfig, ...storeConfig }
    : { ...storeConfig, ...appConfig };
}

/**
 * Resolves the configured fiscal printer (first fpmate printer with id+url).
 * @param {object|null} [configStore] - config store (or merged proxy); when
 *   omitted, resolves the active config store at call time.
 * @returns {object|null}
 */
export function resolveFiscalPrinter(configStore = null) {
  return getFiscalPrinter(getRuntimeConfig(configStore).printers);
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
  const configStore = getConfigStore();
  const orderStore = getOrderStore();
  const printer = resolveFiscalPrinter(configStore);
  if (!printer) {
    return { ok: false, error: 'Nessuna stampante fiscale configurata.' };
  }
  const resolvedPrinterId = printerId ?? printer.id;

  // Build payments from the bill summary payment methods. The bill summary
  // exposes payment-method labels as a Set across transactions, but not the
  // amount paid per method. Mapping each label to the full total would make the
  // fiscal printer sum N×total and reject the receipt for inconsistent totals,
  // so collapse the labels into a single payment covering the whole amount.
  // The paymentType is derived server-side from the (possibly composite) label.
  const paymentMethods = Array.isArray(base.paymentMethods) ? base.paymentMethods : [];
  const payments = [{
    label: paymentMethods.length > 0 ? paymentMethods.join(' + ') : 'CONTANTI',
    amount: base.totalAmount,
  }];

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
  const existing = orderStore?.fiscalReceipts?.value?.find((e) => e?.id === job.jobId);
  if (existing) {
    orderStore?.updateFiscalReceipt(job.jobId, updatedFields);
  } else {
    orderStore?.addFiscalReceipt({
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
  const configStore = getConfigStore();
  const printer = resolveFiscalPrinter(configStore);
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
  const configStore = getConfigStore();
  const printer = resolveFiscalPrinter(configStore);
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
  const configStore = getConfigStore();
  const printer = resolveFiscalPrinter(configStore);
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

// ── Void / Refund / Duplicate / Drawer / Cash ────────────────────────────────

/**
 * Helper per i job fiscali semplici (void, refund, duplicate, drawer, cash) che non
 * richiedono aggiornamento di una entry fiscalReceipts specifica ma solo activity log.
 * @param {{ printType: string, buildJob: (printer, operator) => object, printerId?: string|null, operator?: string|number }} args
 * @returns {Promise<{ ok: boolean, fiscal?: object, error?: string }>}
 */
async function dispatchFiscalJob({ printType, buildJob, printerId = null, operator } = {}) {
  const configStore = getConfigStore();
  const printer = resolveFiscalPrinter(configStore);
  if (!printer) return { ok: false, error: 'Nessuna stampante fiscale configurata.' };

  const job = buildJob(printer, operator);
  const result = await sendFiscalJob({ job, printer });
  logFiscalActivity({
    endpoint: printer.url,
    payload: job,
    status: result.ok ? PRINT_LOG_STATUSES.DONE : PRINT_LOG_STATUSES.ERROR,
  });
  return result;
}

/**
 * Emette un documento di annullo commerciale (VOID) per uno scontrino già emesso.
 * I riferimenti (zRepNumber, fiscalReceiptNumber, date, serialNumber) sono recuperati
 * dalla entry fiscalReceipts dell'originale (campi popolati dalla risposta fpmate).
 *
 * @param {{ receiptRef: object, printerId?: string|null, operator?: string|number }} options
 *   receiptRef: { zRepNumber, fiscalReceiptNumber, date, serialNumber }
 * @returns {Promise<{ ok: boolean, fiscal?: object, error?: string }>}
 */
export function dispatchFiscalVoid({ receiptRef, printerId = null, operator } = {}) {
  if (!receiptRef || (!receiptRef.fiscalReceiptNumber && !receiptRef.zRepNumber)) {
    return Promise.resolve({ ok: false, error: 'Riferimenti scontrino mancanti per l\'annullo.' });
  }
  return dispatchFiscalJob({
    printType: PRINT_JOB_TYPES.FISCAL_VOID,
    printerId,
    operator,
    buildJob: (printer, op) => ({
      jobId: newUUIDv7(),
      printType: PRINT_JOB_TYPES.FISCAL_VOID,
      printerId: printerId ?? printer.id,
      receiptRef,
      timestamp: new Date().toISOString(),
      ...(op != null ? { operator: op } : {}),
    }),
  });
}

/**
 * Emette un documento di reso commerciale (REFUND / RESO MERCE). Le voci usano
 * printRecRefund; se fornito receiptRef, la stampante collega il reso all'originale.
 *
 * @param {{ base: object, receiptRef?: object, printerId?: string|null, operator?: string|number }} options
 *   base come in dispatchFiscalReceipt (orders, paymentMethods, totalAmount).
 * @returns {Promise<{ ok: boolean, fiscal?: object, error?: string }>}
 */
export function dispatchFiscalRefund({ base, receiptRef = null, printerId = null, operator } = {}) {
  return dispatchFiscalJob({
    printType: PRINT_JOB_TYPES.FISCAL_REFUND,
    printerId,
    operator,
    buildJob: (printer, op) => {
      // Same rationale as dispatchFiscalReceipt: paymentMethods is a label set
      // with no per-method amounts, so collapse into a single payment covering
      // the whole refund total (otherwise the printer sums N×totalAmount).
      const paymentMethods = Array.isArray(base?.paymentMethods) ? base.paymentMethods : [];
      const payments = [{
        label: paymentMethods.length > 0 ? paymentMethods.join(' + ') : 'CONTANTI',
        amount: base?.totalAmount ?? 0,
      }];
      return {
        jobId: newUUIDv7(),
        printType: PRINT_JOB_TYPES.FISCAL_REFUND,
        printerId: printerId ?? printer.id,
        orders: base?.orders ?? [],
        payments,
        totalAmount: base?.totalAmount ?? 0,
        ...(receiptRef ? { receiptRef } : {}),
        timestamp: new Date().toISOString(),
        ...(op != null ? { operator: op } : {}),
      };
    },
  });
}

/**
 * Ristampa l'ultimo scontrino commerciale emesso (duplicato, documento di gestione).
 * @param {{ printerId?: string|null, operator?: string|number }} options
 * @returns {Promise<{ ok: boolean, fiscal?: object, error?: string }>}
 */
export function dispatchFiscalDuplicate({ printerId = null, operator } = {}) {
  return dispatchFiscalJob({
    printType: PRINT_JOB_TYPES.FISCAL_DUPLICATE,
    printerId,
    operator,
    buildJob: (printer, op) => ({
      jobId: newUUIDv7(),
      printType: PRINT_JOB_TYPES.FISCAL_DUPLICATE,
      printerId: printerId ?? printer.id,
      timestamp: new Date().toISOString(),
      ...(op != null ? { operator: op } : {}),
    }),
  });
}

/**
 * Apre il cassetto contanti collegato alla stampante fiscale.
 * @param {{ printerId?: string|null, operator?: string|number }} options
 * @returns {Promise<{ ok: boolean, fiscal?: object, error?: string }>}
 */
export function dispatchFiscalOpenDrawer({ printerId = null, operator } = {}) {
  return dispatchFiscalJob({
    printType: PRINT_JOB_TYPES.FISCAL_DRAWER,
    printerId,
    operator,
    buildJob: (printer, op) => ({
      jobId: newUUIDv7(),
      printType: PRINT_JOB_TYPES.FISCAL_DRAWER,
      printerId: printerId ?? printer.id,
      timestamp: new Date().toISOString(),
      ...(op != null ? { operator: op } : {}),
    }),
  });
}

/**
 * Registra un movimento di cassa fiscale (versamento o prelievo) sulla stampante RT.
 * @param {{ direction: 'in'|'out', amount: number, form?: 'cash'|'cheque', printerId?: string|null, operator?: string|number }} options
 * @returns {Promise<{ ok: boolean, fiscal?: object, error?: string }>}
 */
export function dispatchFiscalCash({ direction, amount, form = 'cash', printerId = null, operator } = {}) {
  const numAmount = Number(amount);
  if (!['in', 'out'].includes(direction)) {
    return Promise.resolve({ ok: false, error: 'Direction non valido (usare "in" o "out").' });
  }
  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    return Promise.resolve({ ok: false, error: 'Importo non valido per il movimento di cassa.' });
  }
  return dispatchFiscalJob({
    printType: PRINT_JOB_TYPES.FISCAL_CASH,
    printerId,
    operator,
    buildJob: (printer, op) => ({
      jobId: newUUIDv7(),
      printType: PRINT_JOB_TYPES.FISCAL_CASH,
      printerId: printerId ?? printer.id,
      direction,
      amount: numAmount,
      form,
      timestamp: new Date().toISOString(),
      ...(op != null ? { operator: op } : {}),
    }),
  });
}
