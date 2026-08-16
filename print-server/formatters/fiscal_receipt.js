'use strict';

/**
 * @file formatters/fiscal_receipt.js
 * @description Costruisce i payload XML (Fiscal ePOS-Print) per la stampante
 * fiscale Epson RT, secondo l'"ePOS Fiscal Print Solution Development Guide".
 *
 * Il protocollo fpmate.cgi è SOAP/HTTP: l'XML qui prodotto va incapsulato in una
 * busta SOAP dal transport (fpmate-client.js) prima dell'invio.
 *
 * Output: stringa XML (senza envelope SOAP), pronta per `sendFiscalRequest()`.
 *
 * Job supportati:
 *   - fiscal_receipt   → documento commerciale (scontrino fiscale)
 *   - fiscal_z_report  → chiusura giornaliera (Z report)
 *   - fiscal_x_report  → report finanziario giornaliero (X report)
 *   - fiscal_status    → query stato stampante (base o RT)
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Escape dei caratteri speciali XML in un valore attributo.
 * @param {*} v
 * @returns {string}
 */
function escXml(v) {
  return String(v).replace(/[<>&"']/g, (c) => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]
  ));
}

/**
 * Formatta un importo numerico con due decimali usando la virgola come
 * separatore decimale (convenzione italiana richiesta dalla stampante).
 * Accetta anche stringhe già formattate, normalizzando il separatore.
 * @param {number|string} value
 * @returns {string}
 */
function formatAmount(value) {
  if (typeof value === 'string' && value.trim() !== '') {
    // Normalizza eventuali punti decimali in virgola (la stampante accetta entrambi,
    // ma usiamo la virgola per coerenza con le risposte).
    return value.replace(/\./g, ',');
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return '0,00';
  return n.toFixed(2).replace('.', ',');
}

/**
 * Formatta una quantità con tre decimali (range 0.001–9999.999).
 * @param {number|string} value
 * @returns {string}
 */
function formatQuantity(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '1,000';
  return n.toFixed(3).replace('.', ',');
}

/**
 * Determina il paymentType fpmate a partire dall'etichetta del metodo di pagamento.
 *   0 = Contanti
 *   2 = Elettronico (carta/bancomat/pos)
 * Gli altri tipi (1 assegno, 3 ticket, 5 non pagato) non sono usati dal flusso cassa.
 * @param {string} label
 * @returns {string}
 */
function paymentTypeFromLabel(label) {
  if (/cart|bancomat|pos|visa|master|carta|credit|electron|maestro/i.test(label)) {
    return '2';
  }
  return '0';
}

// ── Fiscal receipt (commercial document) ─────────────────────────────────────

/**
 * Costruisce l'XML per un documento commerciale (scontrino fiscale).
 *
 * Payload atteso (job):
 * {
 *   printType: 'fiscal_receipt',
 *   operator?: string|number,        // default '1' (range 1–12)
 *   cashier?: string,                // etichetta cassiere (opzionale, solo log)
 *   orders: [
 *     {
 *       items: [
 *         { name: string, quantity: number, unitPrice: number, department?: number }
 *       ]
 *     }
 *   ],
 *   payments: [
 *     { label: string, amount: number }   // più pagamenti parziali supportati
 *   ],
 *   totalAmount: number,             // totale lordo (per controllo)
 *   headerLines?: string[],          // righe intestazione aggiuntive (messageType 1)
 *   trailerLines?: string[],         // righe trailer (messageType 3)
 * }
 *
 * @param {object} job
 * @returns {string} XML string (printerFiscalReceipt root)
 */
function formatFiscalReceipt(job) {
  const operator = job.operator != null && job.operator !== '' ? String(job.operator) : '1';
  const orders = Array.isArray(job.orders) ? job.orders : [];
  const items = orders.flatMap((o) => Array.isArray(o?.items) ? o.items : []);
  const payments = Array.isArray(job.payments) ? job.payments.filter((p) => p && Number(p.amount) > 0) : [];

  if (items.length === 0) {
    throw new Error('fiscal_receipt: almeno una voce di vendita è obbligatoria');
  }
  if (payments.length === 0) {
    throw new Error('fiscal_receipt: almeno un pagamento è obbligatorio');
  }

  const lines = ['<printerFiscalReceipt>'];

  // Righe intestazione aggiuntive (devono precedere beginFiscalReceipt)
  const headerLines = Array.isArray(job.headerLines) ? job.headerLines : [];
  headerLines.forEach((line, i) => {
    lines.push(
      `<printRecMessage operator="${escXml(operator)}" messageType="1" index="${i + 1}" font="1" message="${escXml(line)}" />`
    );
  });

  lines.push(`<beginFiscalReceipt operator="${escXml(operator)}" />`);

  // Voci di vendita
  for (const item of items) {
    const name = item.name ?? '';
    const qty = formatQuantity(item.quantity ?? 1);
    const price = formatAmount(item.unitPrice ?? 0);
    const department = Number(item.department) > 0 ? Number(item.department) : 1;
    lines.push(
      `<printRecItem operator="${escXml(operator)}" description="${escXml(name)}" quantity="${qty}" unitPrice="${price}" department="${department}" justification="1" />`
    );
  }

  // Trailer aggiuntivi (messageType 3, dopo le voci)
  const trailerLines = Array.isArray(job.trailerLines) ? job.trailerLines : [];
  trailerLines.forEach((line, i) => {
    lines.push(
      `<printRecMessage operator="${escXml(operator)}" messageType="3" index="${i + 1}" font="1" message="${escXml(line)}" />`
    );
  });

  // Pagamenti (uno o più printRecTotal)
  for (const payment of payments) {
    const pType = paymentTypeFromLabel(payment.label ?? '');
    const amount = formatAmount(payment.amount);
    const description = escXml(payment.label ?? 'CONTANTI');
    lines.push(
      `<printRecTotal operator="${escXml(operator)}" description="${description}" payment="${amount}" paymentType="${pType}" justification="2" />`
    );
  }

  lines.push(`<endFiscalReceipt operator="${escXml(operator)}" />`);
  lines.push('</printerFiscalReceipt>');

  return lines.join('\n');
}

// ── Z / X reports ────────────────────────────────────────────────────────────

/**
 * Costruisce l'XML per la chiusura giornaliera (Z report).
 * La trasmissione dati all'Agenzia delle Entrate avviene automaticamente.
 * @param {object} job
 * @returns {string}
 */
function formatZReport(job) {
  const operator = job.operator != null && job.operator !== '' ? String(job.operator) : '1';
  const timeout = Number(job.timeout) > 0 ? Number(job.timeout) : 30000;
  return [
    '<printerFiscalReport>',
    `<printZReport operator="${escXml(operator)}" timeout="${timeout}" />`,
    '</printerFiscalReport>',
  ].join('\n');
}

/**
 * Costruisce l'XML per il report finanziario giornaliero (X report, non fiscale).
 * @param {object} job
 * @returns {string}
 */
function formatXReport(job) {
  const operator = job.operator != null && job.operator !== '' ? String(job.operator) : '1';
  return [
    '<printerFiscalReport>',
    `<printXReport operator="${escXml(operator)}" />`,
    '</printerFiscalReport>',
  ].join('\n');
}

// ── Printer status query ─────────────────────────────────────────────────────

/**
 * Costruisce l'XML per la query dello stato della stampante.
 * @param {object} job
 * @param {'0'|'1'} [job.statusType]  '0' = base, '1' = RT (default '0')
 * @returns {string}
 */
function formatStatusQuery(job) {
  const operator = job.operator != null && job.operator !== '' ? String(job.operator) : '1';
  const statusType = job.statusType === '1' ? '1' : '0';
  return [
    '<printerCommand>',
    `<queryPrinterStatus operator="${escXml(operator)}" statusType="${statusType}" />`,
    '</printerCommand>',
  ].join('\n');
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

/**
 * Seleziona il formatter XML corretto in base al printType del job.
 * @param {object} job
 * @returns {string} XML string
 * @throws {Error} se il printType non è supportato
 */
function buildFiscalXml(job) {
  switch (job.printType) {
    case 'fiscal_receipt':  return formatFiscalReceipt(job);
    case 'fiscal_z_report': return formatZReport(job);
    case 'fiscal_x_report': return formatXReport(job);
    case 'fiscal_status':   return formatStatusQuery(job);
    default: {
      const err = new Error(`Tipo fiscale non supportato: ${job.printType}`);
      err.permanent = true;
      throw err;
    }
  }
}

module.exports = {
  buildFiscalXml,
  formatFiscalReceipt,
  formatZReport,
  formatXReport,
  formatStatusQuery,
  escXml,
  formatAmount,
  formatQuantity,
  paymentTypeFromLabel,
};
