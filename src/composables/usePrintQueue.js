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
 *   jobId      string  – unique job identifier sent to the printer (plain UUID v7, no prefix)
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
import {
  appConfig,
  DEFAULT_HTTP_PRE_BILL_PRINTER_ID,
  getPrintersForPrintType,
  PRINT_JOB_TYPES,
  getNormalizedPrinterCategories,
  isDirectusManagedPrinter,
  resolveConfiguredPrinter,
} from '../utils/index.js';
import {
  buildOrderJobItems,
  buildOrderPrintJob,
  buildPreBillPrintJob,
  buildReprintPrintJob,
  buildTableMovePrintJob,
  createPrintLogEntry,
} from './printJobBuilders.js';
import { dispatchPrintJob, queueDirectusPrintJob, sendHttpPrintJob } from './printDispatch.js';

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
  return getPrintersForPrintType(getRuntimeConfig(store).printers, printType);
}

/**
 * Appends a print log entry to the store's print log.
 * @param {object} store - Pinia store reference (may be null)
 * @param {object} entry - Log entry object
 */
function logJob(store, entry) {
  store?.addPrintLogEntry(entry);
}

/**
 * Returns the runtime printer list from the active config, normalized to an array.
 *
 * @param {object|null} [store]
 * @returns {object[]}
 */
function getRuntimePrinters(store = null) {
  const printers = getRuntimeConfig(store).printers;
  return Array.isArray(printers) ? printers : [];
}

/**
 * Resolves the runtime printer and dispatch metadata for a pre-bill request.
 *
 * @param {object[]} printers
 * @param {string|null} [printerId]
 * @param {string|null} [printerUrl]
 * @returns {{printer: object|null, resolvedUrl: string|null, usesDirectus: boolean, printerId: string|null}}
 */
function resolvePreBillPrinter(printers, printerId = null, printerUrl = null) {
  const printer = resolveConfiguredPrinter(printers, {
    printerId,
    printerUrl,
  });
  const resolvedUrl = printerUrl ?? printer?.url ?? null;
  const usesDirectus = Boolean(printer && isDirectusManagedPrinter(printer));
  const resolvedPrinterId = usesDirectus
    ? (printerId ?? printer?.id ?? null)
    : (printerId ?? printer?.id ?? (resolvedUrl ? DEFAULT_HTTP_PRE_BILL_PRINTER_ID : null));
  return { printer, resolvedUrl, usesDirectus, printerId: resolvedPrinterId };
}

/**
 * Resolves the runtime printer and dispatch metadata for a reprint action.
 *
 * @param {object[]} printers
 * @param {{ printerId?: string|null, printerName?: string|null, printerUrl?: string|null }} logEntry
 * @param {string|null} [overrideUrl]
 * @returns {{printer: object|null, resolvedUrl: string|null, usesDirectus: boolean, printerId: string|null, printerName: string|null|undefined}}
 */
function resolveReprintPrinter(printers, logEntry, overrideUrl = null) {
  const printer = resolveConfiguredPrinter(printers, {
    printerId: overrideUrl ? null : logEntry?.printerId,
    printerUrl: overrideUrl,
  });
  const resolvedUrl = overrideUrl ?? logEntry?.printerUrl ?? null;
  const usesDirectus = printer ? isDirectusManagedPrinter(printer) : !resolvedUrl;
  return {
    printer,
    resolvedUrl,
    usesDirectus,
    printerId: printer?.id ?? logEntry?.printerId ?? null,
    printerName: printer?.name ?? logEntry?.printerName,
  };
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
  const printers = getPrintersForType(PRINT_JOB_TYPES.ORDER, store);
  if (printers.length === 0) return;
  if (order?.isDirectEntry) return;

  const dishCategoryMap = buildDishCategoryMap(store);

  for (const printer of printers) {
    const printerCategories = getNormalizedPrinterCategories(printer);
    const isCatchAll = printerCategories.length === 0;
    const items = buildOrderJobItems({
      orderItems: order.orderItems ?? [],
      printerCategories,
      dishCategoryMap,
    });

    if (items.length === 0) {
      if (isCatchAll) {
        console.warn('[printQueue] enqueuePrintJobs: no active items in order; skipping printer', {
          printerName: printer?.name ?? null,
          orderId: order?.id ?? null,
          orderItemsCount: order.orderItems?.length ?? 0,
        });
      }
      continue;
    }

    const printerId = printer.id ?? null;
    if (isDirectusManagedPrinter(printer) && !printerId) {
      console.warn(
        '[printQueue] Cannot enqueue Directus-managed order job: printerId is missing. Ensure the printer has a valid id.',
        { printerName: printer?.name ?? null, connectionType: printer?.connectionType ?? null },
      );
      continue;
    }
    const job = buildOrderPrintJob({ order, printerId, items });

    const logId = newUUIDv7('plog');
    logJob(store, createPrintLogEntry({ job, printer, logId }));

    // connectionType takes precedence over url:
    //   - HTTP printers (not TCP/file): send directly from the browser via URL.
    //   - TCP/file printers: the job is in the Directus sync queue; the
    //     print-server claims it from there — no HTTP call needed from the browser.
    //     A TCP/file printer that also has a (stale/mis-set) url must NOT send HTTP,
    //     otherwise both the print-server and the browser would process the same job.
    // Use updatePrintLogEntryLocal so 'queued' is a UI-only status that is NOT
    // pushed to Directus — the Directus record must stay 'pending' so the
    // print-server can claim it.
    dispatchPrintJob({ job, printer, logId, store });
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
  const printers = getPrintersForType(PRINT_JOB_TYPES.TABLE_MOVE, store);
  if (printers.length === 0) return;

  const timestamp = new Date().toISOString();

  for (const printer of printers) {
    const printerId = printer.id ?? null;
    if (isDirectusManagedPrinter(printer) && !printerId) {
      console.warn(
        '[printQueue] Cannot enqueue Directus-managed table_move job: printerId is missing. Ensure the printer has a valid id.',
        { printerName: printer?.name ?? null, connectionType: printer?.connectionType ?? null },
      );
      continue;
    }
    const job = buildTableMovePrintJob({
      printerId,
      fromTableId,
      fromTableLabel,
      toTableId,
      toTableLabel,
      timestamp,
    });

    const logId = newUUIDv7('plog');
    logJob(store, createPrintLogEntry({ job, printer, logId }));

    // connectionType takes precedence over url (same as enqueuePrintJobs):
    //   - HTTP printers (not TCP/file): send directly from the browser.
    //   - TCP/file printers: the job reaches the print-server via Directus.
    // Use updatePrintLogEntryLocal so the 'queued' status stays UI-only and
    // does not patch the Directus record (which must remain 'pending').
    dispatchPrintJob({ job, printer, logId, store });
  }
}

/**
 * Dispatches a pre-conto job to the specified printer.
 * The printer is chosen by the cashier in the settings (default pre-bill printer).
 *
 * @param {object} payload      – Pre-bill data (tableId, tableLabel, items, amounts …)
 * @param {string|null} printerUrl   – URL of the target printer service (nullable for Directus-managed printers)
 * @param {string} printerName  – Human-readable name for the log entry
 * @param {string|null} [printerId] – Explicit printer id (preferred when available)
 */
export function enqueuePreBillJob(payload, printerUrl, printerName, printerId = null) {
  const store = getStore();
  const timestamp = new Date().toISOString();
  const runtimePrinters = getRuntimePrinters(store);
  const {
    printer,
    resolvedUrl,
    usesDirectus,
    printerId: resolvedPrinterId,
  } = resolvePreBillPrinter(runtimePrinters, printerId, printerUrl);
  // Keep a stable fallback id for HTTP-only pre-bill printers configured only by URL:
  // this preserves historical payload compatibility (payload.printerId) when no
  // explicit printer id is available. Directus-managed routing never uses this
  // fallback because it requires a resolved runtime printer.

  if (usesDirectus && !resolvedPrinterId) {
    console.warn(
      '[printQueue] Cannot enqueue Directus-managed pre-bill job: printerId is missing. Ensure the selected printer has a valid id (or pass printerId).',
      { printerId, printerUrl, resolvedUrl },
    );
    return;
  }

  if (!usesDirectus && !resolvedUrl) return;

  const job = buildPreBillPrintJob({
    payload,
    printerId: resolvedPrinterId,
    timestamp,
  });

  const logId = newUUIDv7('plog');
  logJob(store, createPrintLogEntry({
    job,
    printer,
    logId,
    fieldOverrides: {
      printerName: printerName ?? printer?.name ?? 'Stampante',
      printerUrl: resolvedUrl,
      table: payload.table ?? payload.tableId ?? '',
      timestamp,
    },
  }));

  if (usesDirectus) {
    // Job delivered to Directus sync queue; update UI status to 'queued' without
    // patching Directus (the record must stay 'pending' for the print-dispatcher).
    queueDirectusPrintJob({ store, logId, job });
  } else {
    sendHttpPrintJob({ job, url: resolvedUrl, logId, store });
  }
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
  const payload = logEntry?.payload;
  if (!payload || typeof payload !== 'object') {
    console.warn(
      '[printQueue] Cannot reprint job because the original payload is unavailable.',
      { logId: logEntry?.logId, jobId: logEntry?.jobId },
    );
    return;
  }

  const store = getStore();
  const timestamp = new Date().toISOString();
  const {
    printer,
    resolvedUrl: url,
    usesDirectus,
    printerId,
    printerName,
  } = resolveReprintPrinter(getRuntimePrinters(store), logEntry, overrideUrl);

  // A job targets Directus (TCP/file) when:
  //  - The resolved printer has a TCP/file connection type, OR
  //  - No URL is available (the original job had no HTTP URL)
  // In both cases a valid printerId is required so the print-dispatcher can
  // resolve the printer. Without it the job would be orphaned in Directus.
  if (usesDirectus && !printerId) {
    console.warn(
      '[printQueue] Cannot reprint Directus-managed job: printerId is missing.',
      { logId: logEntry?.logId },
    );
    return;
  }

  if (!usesDirectus && !url) {
    console.warn(
      '[printQueue] Cannot reprint HTTP job: no printer URL available.',
      { logId: logEntry?.logId, printerId },
    );
    return;
  }

  const job = buildReprintPrintJob({
    payload,
    printerId,
    printerName,
    printerUrl: url,
    timestamp,
  });

  const logId = newUUIDv7('plog');
  logJob(store, createPrintLogEntry({
    job,
    printer,
    logId,
    fieldOverrides: {
      printerName,
      printerUrl: url ?? null,
      printType: logEntry.printType,
      table: logEntry.table,
      timestamp,
    },
    extraFields: {
      isReprint: true,
      originalJobId: logEntry.jobId,
    },
  }));

  if (usesDirectus) {
    // Job delivered to Directus sync queue; update UI status to 'queued' without
    // patching Directus (the record must stay 'pending' for the print-dispatcher).
    queueDirectusPrintJob({ store, logId, job });
  } else {
    sendHttpPrintJob({ job, url, logId, store });
  }
}
