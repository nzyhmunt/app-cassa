'use strict';

/**
 * @file formatters/table_move.js
 * @description Formatta un job di stampa di tipo 'table_move' (spostamento tavolo) in ESC/POS.
 *
 * Struttura attesa del payload (job):
 * {
 *   jobId:          string,
 *   printType:      'table_move',
 *   printerId:      string,
 *   fromTableId:    string,
 *   fromTableLabel: string,
 *   toTableId:      string,
 *   toTableLabel:   string,
 *   table:          string,  // "01 → 02"
 *   timestamp:      string,
 * }
 */

const ReceiptPrinterEncoder = require('@point-of-sale/receipt-printer-encoder');

/**
 * Converte un job 'table_move' in un Buffer ESC/POS.
 * @param {object} job
 * @returns {Buffer}
 */
function formatTableMove(job) {
  const enc = new ReceiptPrinterEncoder({ language: 'esc-pos', width: 42 });

  enc.initialize()
     .align('center').bold(true).size(2).line('SPOSTAMENTO TAVOLO').size(1).bold(false)
     .rule({ style: 'single' })
     .align('center').bold(true).line(`DA: TAVOLO ${job.fromTableLabel ?? job.fromTableId ?? '?'}`).bold(false)
     .align('center').bold(true).line(`A:  TAVOLO ${job.toTableLabel   ?? job.toTableId   ?? '?'}`).bold(false)
     .newline().newline().newline()
     .cut();

  return Buffer.from(enc.encode());
}

module.exports = { formatTableMove };
