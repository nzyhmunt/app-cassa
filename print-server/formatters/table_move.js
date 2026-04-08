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

const { EscPosBuilder } = require('../escpos.js');

/**
 * Converte un job 'table_move' in un Buffer ESC/POS.
 * @param {object} job
 * @returns {Buffer}
 */
function formatTableMove(job) {
  const b = new EscPosBuilder();

  b.init();

  b.align('center')
   .bold(true)
   .size('double')
   .textLine('SPOSTAMENTO TAVOLO')
   .size('normal')
   .bold(false);

  b.separator();

  b.align('center')
   .bold(true).textLine(`DA: TAVOLO ${job.fromTableLabel ?? job.fromTableId ?? '?'}`)
   .bold(false);

  b.align('center')
   .bold(true).textLine(`A:  TAVOLO ${job.toTableLabel   ?? job.toTableId   ?? '?'}`)
   .bold(false);

  b.feed(3).cut();

  return b.build();
}

module.exports = { formatTableMove };
