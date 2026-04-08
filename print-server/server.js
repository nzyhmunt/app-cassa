'use strict';

/**
 * @file server.js
 * @description Servizio Node.js ESC/POS per la stampa di comande da app-cassa.
 *
 * Espone un endpoint HTTP:
 *   POST /print  – riceve un job JSON, lo converte in ESC/POS e lo invia alla stampante.
 *   GET  /health – ritorna { status: 'ok' } per il controllo di salute del servizio.
 *
 * Le stampanti fisiche sono configurate in `printers.config.js`.
 * Il campo `printerId` del job viene usato per instradare il job alla stampante corretta.
 *
 * Configurazione tramite variabili d'ambiente:
 *   PORT              – porta HTTP del server (default: 3001)
 *   PRINT_SERVER_NAME – nome del server nei log (default: 'ESC/POS Print Server')
 *
 * Avvio:
 *   node server.js
 */

const http    = require('http');
const express = require('express');

const { printBuffer, getPrintersList } = require('./printer.js');
const { formatOrder }     = require('./formatters/order.js');
const { formatTableMove } = require('./formatters/table_move.js');
const { formatPreBill }   = require('./formatters/pre_bill.js');

// ── Configurazione ────────────────────────────────────────────────────────────

const PORT        = parseInt(process.env.PORT || '3001', 10);
const SERVER_NAME = process.env.PRINT_SERVER_NAME || 'ESC/POS Print Server';

// ── App Express ───────────────────────────────────────────────────────────────

const app = express();

// Limita il body a 256 KB per prevenire payload eccessivamente grandi
app.use(express.json({ limit: '256kb' }));

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Sanitizza un valore proveniente dall'input utente per l'uso sicuro nei log.
 * Rimuove caratteri di controllo (newline, CR, ecc.) che potrebbero essere usati
 * per log injection, e tronca il valore a 64 caratteri.
 * @param {*} v
 * @returns {string}
 */
function sanitizeForLog(v) {
  return String(v).replace(/[\r\n\t\x00-\x1f\x7f]/g, ' ').slice(0, 64);
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /health
 * Verifica che il servizio sia attivo.
 */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: SERVER_NAME });
});

/**
 * POST /print
 * Riceve un job di stampa JSON, lo converte in ESC/POS e lo invia alla stampante.
 *
 * Body atteso: { printType: 'order' | 'table_move' | 'pre_bill', printerId: string, ... }
 *
 * Il campo `printerId` viene usato per selezionare la stampante in printers.config.js.
 * Se assente o non trovato, viene usata la prima stampante come fallback.
 *
 * Risposta di successo:   200 { ok: true,  jobId }
 * Risposta di errore:     400 { ok: false, error } — payload non valido
 *                         500 { ok: false, error } — errore comunicazione stampante
 */
app.post('/print', async (req, res) => {
  const job = req.body;

  // Validazione di base
  if (!job || typeof job !== 'object') {
    return res.status(400).json({ ok: false, error: 'Body JSON mancante o non valido.' });
  }

  const { printType, jobId, printerId } = job;

  if (!printType) {
    return res.status(400).json({ ok: false, error: 'Campo printType mancante.' });
  }

  // Sanitizza i valori dall'input utente prima di usarli nei log per prevenire log injection
  const safeJobId     = sanitizeForLog(jobId     ?? '?');
  const safePrintType = sanitizeForLog(printType ?? '?');
  const safePrinterId = sanitizeForLog(printerId ?? 'default');

  // Conversione payload → Buffer ESC/POS
  let buf;
  try {
    buf = buildEscPosBuffer(job);
  } catch (err) {
    console.error('[print-server] Errore formattazione job', safeJobId, '(' + safePrintType + '):', err.message);
    return res.status(400).json({ ok: false, error: `Errore formattazione: ${err.message}` });
  }

  if (!buf || buf.length === 0) {
    return res.status(400).json({ ok: false, error: `Tipo di stampa non supportato: ${printType}` });
  }

  // Invio alla stampante identificata da printerId
  try {
    await printBuffer(buf, printerId);
    console.log('[print-server] Job stampato:', safeJobId, '(' + safePrintType + ') → stampante:', safePrinterId);
    return res.json({ ok: true, jobId: jobId ?? null });
  } catch (err) {
    console.error('[print-server] Errore stampante per job', safeJobId + ':', err.message);
    return res.status(500).json({ ok: false, error: `Errore stampante: ${err.message}` });
  }
});

// ── Formattazione ESC/POS ─────────────────────────────────────────────────────

/**
 * Seleziona il formatter appropriato in base a job.printType e restituisce il Buffer.
 * @param {object} job
 * @returns {Buffer|null}
 */
function buildEscPosBuffer(job) {
  switch (job.printType) {
    case 'order':
      return formatOrder(job);
    case 'table_move':
      return formatTableMove(job);
    case 'pre_bill':
      return formatPreBill(job);
    default:
      return null;
  }
}

// ── Avvio server ──────────────────────────────────────────────────────────────

const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`[print-server] ${SERVER_NAME} in ascolto su http://localhost:${PORT}`);
  console.log(`[print-server] Endpoint: POST http://localhost:${PORT}/print`);

  const printers = getPrintersList();
  if (printers.length === 0) {
    console.warn('[print-server] ATTENZIONE: nessuna stampante configurata in printers.config.js');
  } else {
    console.log(`[print-server] Stampanti configurate (${printers.length}):`);
    for (const p of printers) {
      const conn = p.type === 'file'
        ? `file → ${p.device}`
        : `TCP  → ${p.host}:${p.port}`;
      console.log(`[print-server]   [${p.id}] ${p.name}  (${conn})`);
    }
  }
});

server.on('error', (err) => {
  console.error(`[print-server] Errore avvio server sulla porta ${PORT}:`, err.message);
  process.exit(1);
});
