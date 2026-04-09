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
 *   PORT                  – porta HTTP del server (default: 3001)
 *   PRINT_SERVER_NAME     – nome del server nei log (default: 'ESC/POS Print Server')
 *   PRINT_SERVER_API_KEY  – se impostato, richiede header x-api-key su POST /print
 *   CORS_ALLOWED_ORIGINS  – lista di origini CORS consentite (virgola separata).
 *                           Se vuota, tutte le origini sono accettate.
 *
 * Avvio:
 *   node server.js
 */

const http    = require('http');
const cors    = require('cors');
const express = require('express');

const { printBuffer, getPrintersList, getPrinterConfig } = require('./printer.js');
const { formatOrder }     = require('./formatters/order.js');
const { formatTableMove } = require('./formatters/table_move.js');
const { formatPreBill }   = require('./formatters/pre_bill.js');

// ── Configurazione ────────────────────────────────────────────────────────────

const PORT        = parseInt(process.env.PORT || '3001', 10);
const SERVER_NAME = process.env.PRINT_SERVER_NAME || 'ESC/POS Print Server';
const API_KEY     = process.env.PRINT_SERVER_API_KEY || '';

// Allowed CORS origins — when non-empty, only listed origins are accepted.
// Requests without an Origin header (e.g. curl, server-to-server) always pass.
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

// Supported printType values
const VALID_PRINT_TYPES = new Set(['order', 'table_move', 'pre_bill']);

// ── App Express ───────────────────────────────────────────────────────────────

const app = express();

// CORS — se è configurata una allowlist, solo le origini elencate sono accettate;
// altrimenti tutte le origini sono accettate (comportamento retrocompatibile).
// Le richieste senza header Origin (es. curl, server-to-server) passano sempre.
app.use(cors({
  origin(origin, cb) {
    // Nessun header Origin → richiesta non-browser, non soggetta a CORS
    if (!origin) return cb(null, true);
    // Con allowlist: accetta solo le origini esplicitamente elencate
    if (CORS_ALLOWED_ORIGINS.length > 0) {
      return CORS_ALLOWED_ORIGINS.includes(origin)
        ? cb(null, true)
        : cb(new Error('CORS: origine non consentita'));
    }
    // Nessuna allowlist configurata: accetta tutte le origini browser (default aperto)
    return cb(null, true);
  },
}));

// Limit body to 256 KB to prevent excessively large payloads
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

// ── Optional API key middleware ───────────────────────────────────────────────

/**
 * If PRINT_SERVER_API_KEY is configured, every POST /print request must include
 * the matching x-api-key header; all other requests (e.g. GET /health) pass through.
 */
function apiKeyGuard(req, res, next) {
  if (!API_KEY || req.method === 'OPTIONS') return next();
  const provided = req.headers['x-api-key'];
  if (provided === API_KEY) return next();
  return res.status(401).json({ ok: false, error: 'Invalid or missing API key.' });
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
app.post('/print', apiKeyGuard, async (req, res) => {
  const job = req.body;

  // Validazione di base
  if (!job || typeof job !== 'object') {
    return res.status(400).json({ ok: false, error: 'Body JSON mancante o non valido.' });
  }

  const { printType, jobId, printerId } = job;

  // Validate printType: must be a non-empty string and one of the known values
  if (typeof printType !== 'string' || !VALID_PRINT_TYPES.has(printType)) {
    const allowed = [...VALID_PRINT_TYPES].join(', ');
    return res.status(400).json({
      ok: false,
      error: `Invalid printType. Must be one of: ${allowed}.`,
    });
  }

  // Sanitizza i valori dall'input utente prima di usarli nei log per prevenire log injection
  const safeJobId     = sanitizeForLog(jobId     ?? '?');
  const safePrintType = sanitizeForLog(printType);

  // Resolve the printer config now so we can log the actual printer used
  // and surface a 500 early if no printers are configured.
  const printerConfig = getPrinterConfig(printerId);
  if (!printerConfig) {
    return res.status(500).json({ ok: false, error: 'No printers configured in printers.config.js.' });
  }
  const safeResolvedId = sanitizeForLog(printerConfig.id);

  // Conversione payload → Buffer ESC/POS
  let buf;
  try {
    buf = buildEscPosBuffer(job);
  } catch (err) {
    const safeMsg = sanitizeForLog(err.message);
    console.error('[print-server] Errore formattazione job', safeJobId, '(' + safePrintType + '):', safeMsg);
    return res.status(400).json({ ok: false, error: `Errore formattazione: ${safeMsg}` });
  }

  // Invio alla stampante
  try {
    await printBuffer(buf, printerId);
    console.log('[print-server] Job stampato:', safeJobId, '(' + safePrintType + ') → stampante:', safeResolvedId);
    return res.json({ ok: true, jobId: jobId ?? null });
  } catch (err) {
    const safeMsg = sanitizeForLog(err.message);
    console.error('[print-server] Errore stampante per job', safeJobId + ':', safeMsg);
    return res.status(500).json({ ok: false, error: `Errore stampante: ${safeMsg}` });
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

// ── JSON / body-size error handler ────────────────────────────────────────────

// Express error-handling middleware: catches SyntaxError (malformed JSON body)
// and PayloadTooLargeError (body > 256 KB) from express.json() and returns a
// consistent { ok: false, error } JSON response instead of the default HTML.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, error: 'Invalid JSON body.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: 'Payload too large (max 256 KB).' });
  }
  console.error('[print-server] Errore imprevisto:', sanitizeForLog(err.message));
  return res.status(500).json({ ok: false, error: 'Internal server error.' });
});

// ── Avvio server ──────────────────────────────────────────────────────────────

const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`[print-server] ${SERVER_NAME} in ascolto su http://localhost:${PORT}`);
  console.log(`[print-server] Endpoint: POST http://localhost:${PORT}/print`);
  if (API_KEY) {
    console.log('[print-server] Autenticazione API key abilitata (x-api-key)');
  }
  if (CORS_ALLOWED_ORIGINS.length > 0) {
    console.log('[print-server] CORS origini consentite:', CORS_ALLOWED_ORIGINS.join(', '));
  }

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

