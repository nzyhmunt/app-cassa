'use strict';

/**
 * @file formatters/order.js
 * @description Formatta un job di stampa di tipo 'order' (comanda cucina/bar) in ESC/POS.
 *
 * Struttura attesa del payload (job):
 * {
 *   jobId:      string,
 *   printType:  'order',
 *   printerId:  string,
 *   orderId:    string,
 *   table:      string,        // etichetta tavolo
 *   time:       string,        // HH:MM
 *   globalNote: string,
 *   timestamp:  string,        // ISO 8601
 *   items: [
 *     {
 *       name:      string,
 *       quantity:  number,
 *       notes:     string[],
 *       course:    string,
 *       modifiers: [{ name: string, price: number }],
 *     }
 *   ]
 * }
 */

const { EscPosBuilder } = require('../escpos.js');

/**
 * Converte un job 'order' in un Buffer ESC/POS.
 * @param {object} job
 * @returns {Buffer}
 */
function formatOrder(job) {
  const b = new EscPosBuilder();

  b.init();

  // ── Intestazione ─────────────────────────────────────────────────────────

  b.align('center')
   .bold(true)
   .size('double')
   .textLine(`TAVOLO ${job.table ?? '?'}`)
   .size('normal')
   .bold(false);

  b.align('center').textLine(job.time ?? '');

  if (job.printerId) {
    b.align('center').bold(true).textLine(job.printerId.toUpperCase()).bold(false);
  }

  b.separator();

  // ── Voci ─────────────────────────────────────────────────────────────────

  const items = Array.isArray(job.items) ? job.items : [];

  for (const item of items) {
    const qty  = item.quantity ?? 1;
    const name = item.name ?? '';

    b.align('left')
     .bold(true)
     .twoColumns(`${qty}x ${name}`, '')
     .bold(false);

    // Note specifiche della voce
    const notes = Array.isArray(item.notes) ? item.notes : [];
    for (const note of notes) {
      if (note) b.align('left').textLine(`  >> ${note}`);
    }

    // Modificatori
    const mods = Array.isArray(item.modifiers) ? item.modifiers : [];
    for (const m of mods) {
      if (m?.name) b.align('left').textLine(`  + ${m.name}`);
    }

    // Portata (se non 'insieme')
    if (item.course && item.course !== 'insieme') {
      b.align('left').textLine(`  [${item.course}]`);
    }
  }

  // ── Nota globale ─────────────────────────────────────────────────────────

  if (job.globalNote) {
    b.separator()
     .align('left')
     .bold(true).text('NOTA: ').bold(false)
     .textLine(job.globalNote);
  }

  // ── Chiusura ─────────────────────────────────────────────────────────────

  b.feed(3).cut();

  return b.build();
}

module.exports = { formatOrder };
