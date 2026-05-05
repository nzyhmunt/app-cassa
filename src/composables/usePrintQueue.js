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
 * Printer configuration lives in the reactive runtime config (store.config.printers).
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
 * Print-job log entry common fields (stored in store.printLog):
 *   id         string  – UUID v7 (Directus PK; standard UUID, no prefix)
 *   logId      string  – unique log entry identifier (plog_<uuid>; IDB keyPath)
 *   jobId      string  – unique job identifier sent to the printer (job_<uuid>)
 *   printType  string  – 'order' | 'table_move' | 'pre_bill' | (any future type)
 *   printerId  string  – printer id from config
 *   printerName string – human-readable printer name
 *   printerUrl string  – URL the job was sent to
 *   table      string  – table label (or 'from → to' for table_move)
 *   timestamp  string  – ISO 8601 dispatch time
 *   status     string  – 'pending' | 'printing' | 'done' | 'error' | 'queued'
 *                         'queued' is set for TCP/file (Directus-managed) printers once the
 *                         job has been placed in the sync queue for the print-server to claim.
 *   errorMessage? string – populated when status === 'error'
 *   isReprint? boolean – true for reprinted jobs
 *   originalJobId? string – jobId of the original job (only for reprints)
 *   payload    object  – full payload sent to the printer service
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

import { newUUIDv7 } from '../store/storeUtils.js';
import { useAppStore } from '../store/index.js';
import { appConfig } from '../utils/index.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Builds a reverse look-up map: dishId → category name.
 * Uses the current runtime menu config. Called lazily because the menu may be
 * loaded asynchronously after the app boots.
 * @param {object|null} [store] - Optional store instance; when omitted/null, resolves from active Pinia.
 * @returns {Map<string, string>}
 */
function buildDishCategoryMap(store = null) {
  const map = new Map();
  const menu = getRuntimeConfig(store).menu ?? {};
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
 * Sends a single print job to the printer service URL and updates the print
 * log entry's status as the job progresses.
 *
 * Status lifecycle:
 *   pending   (set when job is first logged, before fetch begins)
 *   → printing (fetch started)
 *   → done     (HTTP 2xx response)
 *   → error    (network error or non-2xx HTTP status)
 *
 * Errors are logged to the console but do not propagate to the caller.
 *
 * @param {object} job   - The print job payload.
 * @param {string} url   - The printer service endpoint URL.
 * @param {string} logId - logId of the corresponding printLog entry to update.
 * @param {object|null} store - Pinia store reference (may be null).
 */
async function sendPrintJob(job, url, logId, store) {
  store?.updatePrintLogEntry(logId, { status: 'printing' });
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job),
    });
    if (response.ok) {
      store?.updatePrintLogEntry(logId, { status: 'done' });
    } else {
      const msg = `HTTP ${response.status}`;
      console.warn(`[PrintQueue] Printer "${job.printerId}" returned ${msg}`);
      store?.updatePrintLogEntry(logId, { status: 'error', errorMessage: msg });
    }
  } catch (err) {
    const msg = err?.message ?? String(err);
    console.warn(
      `[PrintQueue] Could not reach printer "${job.printerId}" at ${url}:`,
      msg,
    );
    store?.updatePrintLogEntry(logId, { status: 'error', errorMessage: msg });
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
 * Returns the reactive runtime config from the active store.
 * Falls back to an empty object when Pinia/store is not available.
 * @param {object|null} [store]
 * @returns {Record<string, any>}
 */
function getRuntimeConfig(store = null) {
  const resolvedStore = store ?? getStore();
  const storeConfig = resolvedStore?.config ?? {};
  const storeHydrated = resolvedStore?.configHydrated === true;
  // Once config is hydrated from IDB/Directus, store config becomes authoritative.
  // Before hydration, keep appConfig as last-wins fallback for legacy startup/tests.
  return storeHydrated
    ? { ...appConfig, ...storeConfig }
    : { ...storeConfig, ...appConfig };
}

/**
 * Returns true for printers managed by the Directus print-server (TCP/file
 * connection type). These printers have no browser-accessible HTTP URL; their
 * jobs are delivered to the print-server via the Directus sync queue.
 * @param {object|null} printer
 * @returns {boolean}
 */
function isDirectusManagedPrinter(printer) {
  const ct = typeof printer?.connectionType === 'string'
    ? printer.connectionType.toLowerCase().trim()
    : '';
  return ct === 'tcp' || ct === 'file';
}

/**
 * Returns all configured printers that accept the given printType.
 * A printer with no printTypes (or an empty array) acts as catch-all.
 *
 * Printers with a direct HTTP `url` are dispatched immediately by the browser.
 * Printers with `connectionType` = 'tcp' or 'file' have no browser-accessible
 * URL; their print_jobs are delivered to Directus via the sync queue and picked
 * up by the print-server.
 *
 * @param {string} printType
 * @param {object|null} [store] - Optional store instance; when omitted/null, resolves from active Pinia.
 * @returns {object[]}
 */
function getPrintersForType(printType, store = null) {
  const printers = getRuntimeConfig(store).printers;
  if (!Array.isArray(printers)) return [];
  return printers.filter(p => {
    // Accept HTTP printers (have a direct URL) or Directus-managed printers
    // (TCP/file — print-server reads jobs from Directus sync queue).
    const hasUrl = Boolean(p?.url);
    if (!hasUrl && !isDirectusManagedPrinter(p)) return false;
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
  const store = getStore();
  const printers = getPrintersForType('order', store);
  if (printers.length === 0) return;
  if (order?.isDirectEntry) return;

  const dishCategoryMap = buildDishCategoryMap(store);

  for (const printer of printers) {
    const isCatchAll = !Array.isArray(printer.categories) || printer.categories.length === 0;

    const items = (order.orderItems ?? []).reduce((acc, item) => {
      const activeQty = item.quantity - (item.voidedQuantity ?? 0);
      if (activeQty <= 0) return acc;
      if (!isCatchAll) {
        const itemCategory = dishCategoryMap.get(item.dishId) ?? '';
        if (!printer.categories.some(c => typeof c === 'string' && c.toLowerCase() === itemCategory.toLowerCase())) {
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
      jobId: newUUIDv7('job'),
      printType: 'order',
      printerId,
      orderId: order.id,
      table: order.table,
      time: order.time,
      globalNote: order.globalNote ?? '',
      timestamp: new Date().toISOString(),
      items,
    };

    const logId = newUUIDv7('plog');
    logJob(store, {
      logId,
      id: newUUIDv7(),
      jobId: job.jobId,
      printerId,
      printerName: printer.name ?? printer.id ?? 'Stampante',
      printerUrl: printer.url,
      printType: 'order',
      table: order.table,
      timestamp: job.timestamp,
      payload: job,
    });

    // HTTP printers: send directly from the browser.
    // TCP/file printers: the job is in the Directus sync queue; the print-server
    // will claim it from there — no HTTP call needed from the browser.
    // Use updatePrintLogEntryLocal so 'queued' is a UI-only status that is NOT
    // pushed to Directus — the Directus record must stay 'pending' so the
    // print-server can claim it.
    if (printer.url) {
      sendPrintJob(job, printer.url, logId, store);
    } else {
      store?.updatePrintLogEntryLocal(logId, { status: 'queued' });
    }
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
  const store = getStore();
  const printers = getPrintersForType('table_move', store);
  if (printers.length === 0) return;

  const timestamp = new Date().toISOString();

  for (const printer of printers) {
    const printerId = printer.id ?? printer.name ?? 'unknown';
    const job = {
      jobId: newUUIDv7('job'),
      printType: 'table_move',
      printerId,
      fromTableId,
      fromTableLabel,
      toTableId,
      toTableLabel,
      table: `${fromTableLabel} → ${toTableLabel}`,
      timestamp,
    };

    const logId = newUUIDv7('plog');
    logJob(store, {
      logId,
      id: newUUIDv7(),
      jobId: job.jobId,
      printerId,
      printerName: printer.name ?? printer.id ?? 'Stampante',
      printerUrl: printer.url,
      printType: 'table_move',
      table: job.table,
      timestamp,
      payload: job,
    });

    // HTTP printers: send directly from the browser.
    // TCP/file printers: the job reaches the print-server via Directus.
    // Use updatePrintLogEntryLocal so the 'queued' status stays UI-only and
    // does not patch the Directus record (which must remain 'pending').
    if (printer.url) {
      sendPrintJob(job, printer.url, logId, store);
    } else {
      store?.updatePrintLogEntryLocal(logId, { status: 'queued' });
    }
  }
}

/**
 * Dispatches a pre-conto job to the specified printer.
 * The printer is chosen by the cashier in the settings (default pre-bill printer).
 *
 * @param {object} payload      – Pre-bill data (tableId, tableLabel, items, amounts …)
 * @param {string} printerUrl   – URL of the target printer service
 * @param {string} printerName  – Human-readable name for the log entry
 * @param {string|null} [printerIdOverride] – Explicit printer id (preferred when available)
 */
export function enqueuePreBillJob(payload, printerUrl, printerName, printerIdOverride = null) {
  if (!printerUrl) return;

  const store = getStore();
  const timestamp = new Date().toISOString();
  const printer = getRuntimeConfig(store).printers?.find(p => p.url === printerUrl);
  const printerId = printerIdOverride ?? printer?.id ?? 'pre_bill';

  const job = {
    jobId: newUUIDv7('job'),
    printType: 'pre_bill',
    printerId,
    timestamp,
    ...payload,
  };

  const logId = newUUIDv7('plog');
  logJob(store, {
    logId,
    id: newUUIDv7(),
    jobId: job.jobId,
    printerId,
    printerName: printerName ?? printer?.name ?? 'Stampante',
    printerUrl,
    printType: 'pre_bill',
    table: payload.table ?? payload.tableId ?? '',
    timestamp,
    payload: job,
  });

  sendPrintJob(job, printerUrl, logId, store);
}

/**
 * Re-sends a previously logged print job, optionally to a different printer.
 * A new logId and jobId are generated; the original jobId is preserved as
 * `originalJobId` in the new log entry for traceability.
 *
 * @param {object} logEntry     – Entry from store.printLog
 * @param {string} [overrideUrl] – Alternative printer URL (uses original if omitted)
 */
export function reprintJob(logEntry, overrideUrl = null) {
  const url = overrideUrl ?? logEntry.printerUrl;
  if (!url) return;

  const payload = logEntry?.payload;
  if (!payload || typeof payload !== 'object') {
    console.warn(
      '[printQueue] Cannot reprint job because the original payload is unavailable.',
      { logId: logEntry?.logId, jobId: logEntry?.jobId, printerUrl: url },
    );
    return;
  }

  const store = getStore();
  const timestamp = new Date().toISOString();

  const printer = overrideUrl
    ? getRuntimeConfig(store).printers?.find(p => p.url === overrideUrl)
    : null;

  const printerId = printer?.id ?? logEntry.printerId;
  const printerName = printer?.name ?? logEntry.printerName;
  const printerUrl = url;

  const job = {
    ...payload,
    jobId: newUUIDv7('job'),
    reprinted: true,
    timestamp,
    printerId,
    printerName,
    printerUrl,
  };

  const logId = newUUIDv7('plog');
  logJob(store, {
    logId,
    id: newUUIDv7(),
    jobId: job.jobId,
    printerId,
    printerName,
    printerUrl,
    printType: logEntry.printType,
    table: logEntry.table,
    timestamp,
    payload: job,
    isReprint: true,
    originalJobId: logEntry.jobId,
  });

  sendPrintJob(job, url, logId, store);
}
