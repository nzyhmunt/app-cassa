'use strict';

/**
 * @file formatters/pre_bill.js
 * @description Formatta un job di stampa di tipo 'pre_bill' (preconto) in ESC/POS.
 *
 * Struttura attesa del payload (job):
 * {
 *   jobId:             string,
 *   printType:         'pre_bill',
 *   printerId:         string,
 *   tableId:           string,
 *   table:             string,        // etichetta tavolo
 *   timestamp:         string,
 *   items: [
 *     { name: string, quantity: number, unitPrice: number, subtotal: number }
 *   ],
 *   grossAmount:       number,
 *   paymentsRecorded:  number,
 *   amountDue:         number,
 * }
 */

const { EscPosBuilder, PRINTER_WIDTH } = require('../escpos.js');

/**
 * Formatta un numero come stringa valuta italiana (es. "12,50 €").
 * @param {number} n
 * @returns {string}
 */
function fmt(n) {
  const v = typeof n === 'number' && isFinite(n) ? n : 0;
  return v.toFixed(2).replace('.', ',') + ' \u20ac';
}

/**
 * Converte un job 'pre_bill' in un Buffer ESC/POS.
 * @param {object} job
 * @returns {Buffer}
 */
function formatPreBill(job) {
  const b = new EscPosBuilder();

  b.init();

  // ── Intestazione ─────────────────────────────────────────────────────────

  b.align('center')
   .bold(true)
   .size('double')
   .textLine('PRECONTO')
   .size('normal')
   .bold(false);

  b.align('center').textLine(`Tavolo ${job.table ?? job.tableId ?? '?'}`);

  // Data/ora dalla timestamp ISO
  const dateStr = formatDateTime(job.timestamp);
  if (dateStr) b.align('center').textLine(dateStr);

  b.separator();

  // ── Intestazione colonne ──────────────────────────────────────────────────

  b.align('left')
   .bold(true)
   .twoColumns('DESCRIZIONE', 'TOTALE')
   .bold(false);

  b.separator();

  // ── Voci ─────────────────────────────────────────────────────────────────

  const items = Array.isArray(job.items) ? job.items : [];

  for (const item of items) {
    const qty      = item.quantity  ?? 1;
    const name     = item.name      ?? '';
    const subtotal = item.subtotal  ?? 0;

    b.align('left').twoColumns(`${qty}x ${name}`, fmt(subtotal));

    if (item.unitPrice != null && qty > 1) {
      // Mostra il prezzo unitario in una riga indentata
      b.align('left').textLine(`   @ ${fmt(item.unitPrice)} cad.`);
    }
  }

  b.separator();

  // ── Totali ────────────────────────────────────────────────────────────────

  b.align('left')
   .bold(true)
   .twoColumns('TOTALE', fmt(job.grossAmount))
   .bold(false);

  if (job.paymentsRecorded > 0) {
    b.align('left').twoColumns('Pagato', fmt(job.paymentsRecorded));
    b.align('left')
     .bold(true)
     .twoColumns('RESIDUO', fmt(job.amountDue))
     .bold(false);
  }

  // ── Chiusura ─────────────────────────────────────────────────────────────

  b.separator()
   .align('center')
   .textLine('Grazie e arrivederci!')
   .feed(3)
   .cut();

  return b.build();
}

/**
 * Formatta una stringa ISO 8601 in "DD/MM/YYYY HH:MM".
 * @param {string} iso
 * @returns {string}
 */
function formatDateTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const dd   = String(d.getDate()).padStart(2, '0');
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh   = String(d.getHours()).padStart(2, '0');
    const min  = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
  } catch {
    return '';
  }
}

module.exports = { formatPreBill };
