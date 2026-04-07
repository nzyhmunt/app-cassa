/**
 * @file composables/usePrintQueue.js
 * @description Print queue composable for ESC/POS order printing.
 *
 * Exported functions:
 *   enqueuePrintJobs(order)                          – Kitchen/bar order accepted
 *   enqueueTableMoveJob(fromId, fromLabel, toId, toLabel) – Table moved/renamed
 *   enqueuePreBillJob(payload, printerUrl, printerName)   – Pre-conto sent to printer
 *   reprintJob(logEntry, overrideUrl?)               – Re-send a logged job
 *
 * Printer configuration lives in appConfig.printers (src/utils/index.js).
 *
 * Each printer can be scoped to specific job types via `printTypes[]`:
 *   'order'      – new accepted kitchen/bar order
 *   'table_move' – table moved from X to Y
 *   'pre_bill'   – pre-conto sent to printer
 *   If printTypes is absent or empty, the printer receives ALL types (catch-all).
 *
 * Each printer can also be scoped to specific menu categories via `categories[]`:
 *   Only relevant for the 'order' type. If absent/empty, all items are included.
 *
 * All dispatches are fire-and-forget: errors are logged but never propagate.
 * Every dispatched job is appended to store.printLog for the print-history view.
 *
 * Print-job payload common fields:
 *   jobId      string  – unique job identifier (job_<uuid>)
 *   printType  string  – 'order' | 'table_move' | 'pre_bill'
 *   printerId  string  – printer id from config
 *   table      string  – table label (or 'from → to' for table_move)
 *   timestamp  string  – ISO 8601 dispatch time
 *
 * Additional fields for 'order' jobs:
 *   orderId    string
 *   time       string  – HH:MM from the order
 *   globalNote string
 *   items[]    – non-voided order items with name/quantity/notes/course/modifiers
 *
 * Additional fields for 'pre_bill' jobs:
 *   tableId    string
 *   grossAmount, paymentsRecorded, amountDue numbers
 *   items[]    – { name, quantity, unitPrice, subtotal }
 *
 * Additional fields for 'table_move' jobs:
 *   fromTableId, fromTableLabel, toTableId, toTableLabel strings
 */

import { appConfig } from '../utils/index.js';
import { newUUID } from '../store/storeUtils.js';
import { useAppStore } from '../store/index.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Builds a reverse look-up map: dishId → category name.
 * Uses the current appConfig.menu. Called lazily because the menu may be
 * loaded asynchronously after the app boots.
 * @returns {Map<string, string>}
 */
function buildDishCategoryMap() {
  const map = new Map();
  const menu = appConfig.menu ?? {};
  for (const [category, items] of Object.entries(menu)) {
    if (Array.isArray(items)) {
      for (const item of items) {
        if (item?.id) map.set(item.id, category);
      }
    }
  }
  return map;
}

/**
 * Sends a single print job to the printer service URL.
 * Fire-and-forget: errors are logged but do not propagate to the caller.
 * @param {object} job  - The print job payload.
 * @param {string} url  - The printer service endpoint URL.
 */
async function sendPrintJob(job, url) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job),
    });
    if (!response.ok) {
      console.warn(`[PrintQueue] Printer "${job.printerId}" returned HTTP ${response.status}`);
    }
  } catch (err) {
    console.warn(
      `[PrintQueue] Could not reach printer "${job.printerId}" at ${url}:`,
      err?.message ?? err,
    );
  }
}

/**
 * Returns a safe reference to the app store (null if Pinia is not yet active).
 */
function getStore() {
  try {
    return useAppStore();
  } catch {
    return null;
  }
}

/**
 * Returns all configured printers that accept the given printType.
 * A printer with no printTypes (or an empty array) acts as catch-all.
 * @param {string} printType
 * @returns {object[]}
 */
function getPrintersForType(printType) {
  const printers = appConfig.printers;
  if (!Array.isArray(printers)) return [];
  return printers.filter(p => {
    if (!p?.url) return false;
    if (!Array.isArray(p.printTypes) || p.printTypes.length === 0) return true;
    return p.printTypes.includes(printType);
  });
}

/**
 * Appends a print log entry to the store's print log.
 * @param {object} store - Pinia store reference (may be null)
 * @param {object} entry - Log entry object
 */
function logJob(store, entry) {
  store?.addPrintLogEntry(entry);
}

// ── Exported functions ───────────────────────────────────────────────────────

/**
 * Creates and dispatches kitchen/bar print jobs for the given order.
 *
 * For each configured printer that accepts the 'order' type:
 *   - If the printer has no categories (catch-all), all non-voided items are included.
 *   - Otherwise, only items whose dishId belongs to one of the printer's categories
 *     (case-insensitive match) are included.
 *
 * Direct-entry orders (covers, manual entries) are skipped.
 *
 * @param {object} order - The order object (status should be 'accepted').
 */
export function enqueuePrintJobs(order) {
  const printers = getPrintersForType('order');
  if (printers.length === 0) return;
  if (order?.isDirectEntry) return;

  const store = getStore();
  const dishCategoryMap = buildDishCategoryMap();

  for (const printer of printers) {
    const isCatchAll = !Array.isArray(printer.categories) || printer.categories.length === 0;

    const items = (order.orderItems ?? []).reduce((acc, item) => {
      const activeQty = item.quantity - (item.voidedQuantity ?? 0);
      if (activeQty <= 0) return acc;
      if (!isCatchAll) {
        const itemCategory = dishCategoryMap.get(item.dishId) ?? '';
        if (!printer.categories.some(c => c.toLowerCase() === itemCategory.toLowerCase())) {
          return acc;
        }
      }
      acc.push({
        name: item.name,
        quantity: activeQty,
        unitPrice: item.unitPrice ?? 0,
        notes: item.notes ?? [],
        course: item.course ?? 'insieme',
        modifiers: (item.modifiers ?? [])
          .filter(m => (m.voidedQuantity ?? 0) < activeQty)
          .map(m => ({ name: m.name, price: m.price ?? 0 })),
      });
      return acc;
    }, []);

    if (items.length === 0) continue;

    const printerId = printer.id ?? printer.name ?? 'unknown';
    const job = {
      jobId: newUUID('job'),
      printType: 'order',
      printerId,
      orderId: order.id,
      table: order.table,
      time: order.time,
      globalNote: order.globalNote ?? '',
      timestamp: new Date().toISOString(),
      items,
    };

    logJob(store, {
      logId: newUUID('plog'),
      jobId: job.jobId,
      printerId,
      printerName: printer.name ?? printer.id ?? 'Stampante',
      printerUrl: printer.url,
      printType: 'order',
      table: order.table,
      timestamp: job.timestamp,
      payload: job,
    });

    sendPrintJob(job, printer.url);
  }
}

/**
 * Dispatches a table-move notification to all printers configured for the
 * 'table_move' print type.
 *
 * @param {string} fromTableId    – source table id
 * @param {string} fromTableLabel – source table label (human-readable)
 * @param {string} toTableId      – destination table id
 * @param {string} toTableLabel   – destination table label
 */
export function enqueueTableMoveJob(fromTableId, fromTableLabel, toTableId, toTableLabel) {
  const printers = getPrintersForType('table_move');
  if (printers.length === 0) return;

  const store = getStore();
  const timestamp = new Date().toISOString();

  for (const printer of printers) {
    const printerId = printer.id ?? printer.name ?? 'unknown';
    const job = {
      jobId: newUUID('job'),
      printType: 'table_move',
      printerId,
      fromTableId,
      fromTableLabel,
      toTableId,
      toTableLabel,
      table: `${fromTableLabel} → ${toTableLabel}`,
      timestamp,
    };

    logJob(store, {
      logId: newUUID('plog'),
      jobId: job.jobId,
      printerId,
      printerName: printer.name ?? printer.id ?? 'Stampante',
      printerUrl: printer.url,
      printType: 'table_move',
      table: job.table,
      timestamp,
      payload: job,
    });

    sendPrintJob(job, printer.url);
  }
}

/**
 * Dispatches a pre-conto job to the specified printer.
 * The printer is chosen by the cashier in the settings (default pre-bill printer).
 *
 * @param {object} payload      – Pre-bill data (tableId, tableLabel, items, amounts …)
 * @param {string} printerUrl   – URL of the target printer service
 * @param {string} printerName  – Human-readable name for the log entry
 */
export function enqueuePreBillJob(payload, printerUrl, printerName) {
  if (!printerUrl) return;

  const store = getStore();
  const timestamp = new Date().toISOString();
  const printer = appConfig.printers?.find(p => p.url === printerUrl);
  const printerId = printer?.id ?? 'pre_bill';

  const job = {
    jobId: newUUID('job'),
    printType: 'pre_bill',
    printerId,
    timestamp,
    ...payload,
  };

  logJob(store, {
    logId: newUUID('plog'),
    jobId: job.jobId,
    printerId,
    printerName: printerName ?? printer?.name ?? 'Stampante',
    printerUrl,
    printType: 'pre_bill',
    table: payload.table ?? payload.tableId ?? '',
    timestamp,
    payload: job,
  });

  sendPrintJob(job, printerUrl);
}

/**
 * Re-sends a previously logged print job, optionally to a different printer.
 * A new logId and jobId are generated; the original jobId is preserved as
 * `originalJobId` for traceability.
 *
 * @param {object} logEntry     – Entry from store.printLog
 * @param {string} [overrideUrl] – Alternative printer URL (uses original if omitted)
 */
export function reprintJob(logEntry, overrideUrl = null) {
  const url = overrideUrl ?? logEntry.printerUrl;
  if (!url) return;

  const store = getStore();
  const timestamp = new Date().toISOString();
  const job = { ...logEntry.payload, jobId: newUUID('job'), reprinted: true, timestamp };

  const printer = overrideUrl
    ? appConfig.printers?.find(p => p.url === overrideUrl)
    : null;

  logJob(store, {
    logId: newUUID('plog'),
    jobId: job.jobId,
    printerId: printer?.id ?? logEntry.printerId,
    printerName: printer?.name ?? logEntry.printerName,
    printerUrl: url,
    printType: logEntry.printType,
    table: logEntry.table,
    timestamp,
    payload: job,
    isReprint: true,
    originalJobId: logEntry.jobId,
  });

  sendPrintJob(job, url);
}
