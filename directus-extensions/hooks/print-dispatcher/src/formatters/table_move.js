/**
 * @file src/formatters/table_move.js
 * @description Formatta un job di tipo 'table_move' (spostamento tavolo) in ESC/POS.
 *
 * Struttura attesa del payload:
 * {
 *   jobId:          string,
 *   printType:      'table_move',
 *   printerId:      string,
 *   fromTableId:    string,
 *   fromTableLabel: string,
 *   toTableId:      string,
 *   toTableLabel:   string,
 *   timestamp:      string,
 * }
 */

import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';

/**
 * Converte un job 'table_move' in un Buffer ESC/POS.
 * @param {object} job
 * @returns {Buffer}
 */
export function formatTableMove(job) {
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
