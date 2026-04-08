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

const ReceiptPrinterEncoder = require('@point-of-sale/receipt-printer-encoder');

/** Larghezza totale della riga (caratteri) */
const WIDTH = 42;
/** Larghezza colonna importo (destra) */
const AMOUNT_COL = 12;
/** Larghezza colonna descrizione (sinistra) */
const DESC_COL = WIDTH - AMOUNT_COL;

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
 * Formatta una stringa ISO 8601 in "DD/MM/YYYY HH:MM".
 * @param {string} iso
 * @returns {string}
 */
function formatDateTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return '';
  }
}

/**
 * Converte un job 'pre_bill' in un Buffer ESC/POS.
 * @param {object} job
 * @returns {Buffer}
 */
function formatPreBill(job) {
  const enc = new ReceiptPrinterEncoder({ language: 'esc-pos', width: WIDTH });

  // ── Intestazione ──────────────────────────────────────────────────────────

  enc.initialize()
     .align('center').bold(true).size(2).line('PRECONTO').size(1).bold(false)
     .align('center').line(`Tavolo ${job.table ?? job.tableId ?? '?'}`);

  const dateStr = formatDateTime(job.timestamp);
  if (dateStr) enc.align('center').line(dateStr);

  enc.rule({ style: 'single' });

  // ── Intestazione colonne ──────────────────────────────────────────────────

  enc.table(
    [{ width: DESC_COL, align: 'left' }, { width: AMOUNT_COL, align: 'right' }],
    [['DESCRIZIONE', 'TOTALE']],
  );

  enc.rule({ style: 'single' });

  // ── Voci ──────────────────────────────────────────────────────────────────

  const items = Array.isArray(job.items) ? job.items : [];
  const rows = [];

  for (const item of items) {
    const qty      = item.quantity  ?? 1;
    const name     = item.name      ?? '';
    const subtotal = item.subtotal  ?? 0;
    rows.push([`${qty}x ${name}`, fmt(subtotal)]);

    if (item.unitPrice != null && qty > 1) {
      rows.push([`   @ ${fmt(item.unitPrice)} cad.`, '']);
    }
  }

  if (rows.length > 0) {
    enc.table(
      [{ width: DESC_COL, align: 'left' }, { width: AMOUNT_COL, align: 'right' }],
      rows,
    );
  }

  enc.rule({ style: 'single' });

  // ── Totali ────────────────────────────────────────────────────────────────

  enc.table(
    [{ width: DESC_COL, align: 'left' }, { width: AMOUNT_COL, align: 'right' }],
    [['TOTALE', fmt(job.grossAmount)]],
  );

  if (job.paymentsRecorded > 0) {
    enc.table(
      [{ width: DESC_COL, align: 'left' }, { width: AMOUNT_COL, align: 'right' }],
      [
        ['Pagato', fmt(job.paymentsRecorded)],
        ['RESIDUO', fmt(job.amountDue)],
      ],
    );
  }

  // ── Chiusura ──────────────────────────────────────────────────────────────

  enc.rule({ style: 'single' })
     .align('center').line('Grazie e arrivederci!')
     .newline().newline().newline()
     .cut();

  return Buffer.from(enc.encode());
}

module.exports = { formatPreBill };
