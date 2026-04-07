/**
 * @file composables/usePrintQueue.js
 * @description Print queue composable for ESC/POS order printing.
 *
 * When an order is accepted (status transitions to 'accepted'), call
 * enqueuePrintJobs(order) to dispatch HTTP POST print jobs to the
 * configured printer endpoints. The actual ESC/POS communication is
 * handled by an external Node print-service that consumes the job.
 *
 * Printer configuration lives in appConfig.printers (src/utils/index.js).
 *
 * Each printer can be scoped to specific menu categories: only items whose
 * dishId is found under one of the listed categories will be included in
 * that printer's job. An empty or absent categories list means "catch-all"
 * (all non-voided items are sent to that printer).
 *
 * Print-job payload sent to each printer endpoint:
 *   {
 *     jobId:      string  – unique job identifier (job_<uuid>)
 *     printerId:  string  – printer id from config
 *     orderId:    string  – order.id
 *     table:      string  – table identifier
 *     time:       string  – order creation time (HH:MM)
 *     globalNote: string  – order-level note
 *     items: Array<{
 *       name:      string
 *       quantity:  number   – active (non-voided) quantity
 *       unitPrice: number
 *       notes:     string[]
 *       course:    string   – 'prima' | 'insieme' | 'dopo'
 *       modifiers: Array<{ name: string, price: number }>
 *     }>
 *   }
 */

import { appConfig } from '../utils/index.js';
import { newUUID } from '../store/storeUtils.js';

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
 * Creates and dispatches print jobs for the given order.
 *
 * For each configured printer:
 *   - If the printer has no categories (catch-all), all non-voided items
 *     are included in the job.
 *   - Otherwise, only items whose dishId belongs to one of the printer's
 *     categories (case-insensitive match) are included.
 *
 * Direct-entry orders (covers, manual entries) are skipped because they
 * bypass the kitchen workflow and do not need a kitchen/bar print slip.
 *
 * This function is a no-op when appConfig.printers is empty or absent.
 *
 * @param {object} order - The order object (status should be 'accepted').
 */
export function enqueuePrintJobs(order) {
  const printers = appConfig.printers;
  if (!Array.isArray(printers) || printers.length === 0) return;
  if (order?.isDirectEntry) return;

  const dishCategoryMap = buildDishCategoryMap();

  for (const printer of printers) {
    if (!printer?.url) continue;

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

    const job = {
      jobId: newUUID('job'),
      printerId: printer.id ?? printer.name ?? 'unknown',
      orderId: order.id,
      table: order.table,
      time: order.time,
      globalNote: order.globalNote ?? '',
      items,
    };

    sendPrintJob(job, printer.url);
  }
}
