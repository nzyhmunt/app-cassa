/**
 * @file composables/printJobBuilders.js
 * @description Pure-ish helpers for constructing print payloads and print-log entries.
 */

import { newUUIDv7 } from '../store/storeUtils.js';
import { normalizePrinterRoutingToken, PRINT_JOB_TYPES } from '../utils/index.js';

/**
 * Builds the order items payload for a single printer based on its normalized categories.
 *
 * @param {{
 *   orderItems?: object[],
 *   printerCategories?: string[],
 *   dishCategoryMap?: Map<string, string>,
 * }} [options]
 * @returns {object[]}
 */
export function buildOrderJobItems(options = {}) {
  const {
    orderItems = [],
    printerCategories = [],
    dishCategoryMap = new Map(),
  } = options;
  const isCatchAll = printerCategories.length === 0;

  return orderItems.reduce((acc, item) => {
    const activeQty = item.quantity - (item.voidedQuantity ?? 0);
    if (activeQty <= 0) return acc;

    if (!isCatchAll) {
      const itemCategory = normalizePrinterRoutingToken(dishCategoryMap.get(item.dishId));
      if (!printerCategories.includes(itemCategory)) return acc;
    }

    acc.push({
      name: item.name,
      quantity: activeQty,
      unitPrice: item.unitPrice ?? 0,
      notes: item.notes ?? [],
      course: item.course ?? 'insieme',
      modifiers: (item.modifiers ?? [])
        .filter(modifier => (modifier.voidedQuantity ?? 0) < activeQty)
        .map(modifier => ({ name: modifier.name, price: modifier.price ?? 0 })),
    });
    return acc;
  }, []);
}

/**
 * Builds an `order` print job payload.
 *
 * @param {{ order: object, printerId: string|null, items: object[], timestamp?: string }} options
 * @returns {object}
 */
export function buildOrderPrintJob(options) {
  const {
    order,
    printerId,
    items,
    timestamp = new Date().toISOString(),
  } = options;

  return {
    jobId: newUUIDv7(),
    printType: PRINT_JOB_TYPES.ORDER,
    printerId,
    orderId: order.id,
    table: order.table,
    time: order.time,
    globalNote: order.globalNote ?? '',
    timestamp,
    items,
  };
}

/**
 * Builds a `table_move` print job payload.
 *
 * @param {{
 *   printerId: string|null,
 *   fromTableId: string,
 *   fromTableLabel: string,
 *   toTableId: string,
 *   toTableLabel: string,
 *   timestamp?: string,
 * }} options
 * @returns {object}
 */
export function buildTableMovePrintJob(options) {
  const {
    printerId,
    fromTableId,
    fromTableLabel,
    toTableId,
    toTableLabel,
    timestamp = new Date().toISOString(),
  } = options;

  return {
    jobId: newUUIDv7(),
    printType: PRINT_JOB_TYPES.TABLE_MOVE,
    printerId,
    fromTableId,
    fromTableLabel,
    toTableId,
    toTableLabel,
    table: `${fromTableLabel} → ${toTableLabel}`,
    timestamp,
  };
}

/**
 * Builds a `pre_bill` print job payload.
 *
 * @param {{ payload: object, printerId: string|null, timestamp?: string }} options
 * @returns {object}
 */
export function buildPreBillPrintJob(options) {
  const {
    payload,
    printerId,
    timestamp = new Date().toISOString(),
  } = options;

  return {
    jobId: newUUIDv7(),
    printType: PRINT_JOB_TYPES.PRE_BILL,
    printerId,
    timestamp,
    ...payload,
  };
}

/**
 * Builds a reprint job payload from a previously logged payload.
 *
 * @param {{
 *   payload: object,
 *   printerId: string|null,
 *   printerName?: string|null,
 *   printerUrl?: string|null,
 *   timestamp?: string,
 * }} options
 * @returns {object}
 */
export function buildReprintPrintJob(options) {
  const {
    payload,
    printerId,
    printerName,
    printerUrl = null,
    timestamp = new Date().toISOString(),
  } = options;

  return {
    ...payload,
    jobId: newUUIDv7(),
    reprinted: true,
    timestamp,
    printerId,
    printerName,
    ...(printerUrl ? { printerUrl } : {}),
  };
}

/**
 * Builds the print-log entry stored in the local print history.
 *
 * @param {{
 *   job: object,
 *   printer?: object|null,
 *   logId: string,
 *   fieldOverrides?: {
 *     printerName?: string,
 *     printerUrl?: string|null,
 *     printType?: string,
 *     table?: string,
 *     timestamp?: string,
 *   },
 *   extraFields?: Record<string, any>,
 * }} options
 * @returns {object}
 */
export function createPrintLogEntry(options) {
  const {
    job,
    printer = null,
    logId,
    fieldOverrides = {},
    extraFields = {},
  } = options;

  return {
    logId,
    id: newUUIDv7(),
    jobId: job.jobId,
    printerId: job.printerId ?? null,
    printerName: fieldOverrides.printerName !== undefined
      ? fieldOverrides.printerName
      : (printer?.name ?? printer?.id ?? 'Stampante'),
    printerUrl: fieldOverrides.printerUrl !== undefined
      ? fieldOverrides.printerUrl
      : (printer?.url ?? null),
    printType: fieldOverrides.printType !== undefined
      ? fieldOverrides.printType
      : job.printType,
    table: fieldOverrides.table !== undefined
      ? fieldOverrides.table
      : (job.table ?? ''),
    timestamp: fieldOverrides.timestamp !== undefined
      ? fieldOverrides.timestamp
      : job.timestamp,
    payload: job,
    ...extraFields,
  };
}
