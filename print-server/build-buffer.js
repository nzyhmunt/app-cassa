'use strict';

/**
 * @file build-buffer.js
 * @description Shared helper: selects the correct ESC/POS formatter for a print job.
 *
 * Used by both server.js (HTTP push mode) and directus-client.js (Directus pull mode)
 * to avoid duplicating the formatter dispatch logic.
 */

const { formatOrder }     = require('./formatters/order.js');
const { formatTableMove } = require('./formatters/table_move.js');
const { formatPreBill }   = require('./formatters/pre_bill.js');

/**
 * Converts a print job payload into an ESC/POS byte Buffer.
 * @param {object} job — full job payload (must contain a `printType` field)
 * @returns {Buffer}
 * @throws {Error} if `job.printType` is not a supported value
 */
function buildEscPosBuffer(job) {
  switch (job.printType) {
    case 'order':      return formatOrder(job);
    case 'table_move': return formatTableMove(job);
    case 'pre_bill':   return formatPreBill(job);
    default:
      throw new Error(`Tipo di stampa non supportato: ${job.printType}`);
  }
}

module.exports = { buildEscPosBuffer };
