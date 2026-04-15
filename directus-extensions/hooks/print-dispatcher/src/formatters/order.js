/**
 * @file src/formatters/order.js
 * @description Formatta un job di tipo 'order' (comanda) in ESC/POS.
 *
 * Struttura attesa del payload:
 * {
 *   jobId:      string,
 *   printType:  'order',
 *   printerId:  string,
 *   orderId:    string,
 *   table:      string,
 *   time:       string,   // HH:MM
 *   globalNote: string,
 *   timestamp:  string,
 *   items: [
 *     { name: string, quantity: number, notes: string[], course: string,
 *       modifiers: [{ name: string, price: number }] }
 *   ]
 * }
 */

import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';

/**
 * Converte un job 'order' in un Buffer ESC/POS.
 * @param {object} job
 * @returns {Buffer}
 */
export function formatOrder(job) {
  const enc = new ReceiptPrinterEncoder({ language: 'esc-pos', width: 42 });

  enc.initialize()
     .align('center').bold(true).size(2).line(`TAVOLO ${job.table ?? '?'}`).size(1).bold(false)
     .align('center').line(job.time ?? '');

  if (job.printerId) {
    enc.align('center').bold(true).line(String(job.printerId).toUpperCase()).bold(false);
  }

  enc.rule({ style: 'single' });

  const items = Array.isArray(job.items) ? job.items : [];

  for (const item of items) {
    const qty  = item.quantity ?? 1;
    const name = item.name ?? '';

    enc.align('left').bold(true).line(`${qty}x ${name}`).bold(false);

    const notes = Array.isArray(item.notes) ? item.notes : [];
    for (const note of notes) {
      if (note) enc.align('left').line(`  >> ${note}`);
    }

    const mods = Array.isArray(item.modifiers) ? item.modifiers : [];
    for (const m of mods) {
      if (m?.name) enc.align('left').line(`  + ${m.name}`);
    }

    if (item.course && item.course !== 'insieme') {
      enc.align('left').line(`  [${item.course}]`);
    }
  }

  if (job.globalNote) {
    enc.rule({ style: 'single' })
       .align('left').bold(true).text('NOTA: ').bold(false).line(job.globalNote);
  }

  enc.newline().newline().newline().cut();

  return Buffer.from(enc.encode());
}
