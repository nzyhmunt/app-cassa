'use strict';

/**
 * @file server.js
 * @description Servizio Node.js ESC/POS per la stampa di comande da app-cassa.
 *
 * Espone endpoint HTTP:
 *   POST /print    – riceve un job JSON, lo converte in ESC/POS (o XML fiscale)
 *                    e lo invia alla stampante.
 *   GET  /health   – ritorna { status: 'ok' } per il controllo di salute del servizio.
 *   GET  /printers – ritorna l'elenco delle stampanti configurate.
 *
 * Tipi di stampa supportati (campo `printType` del job):
 *   ESC/POS (stampanti termiche tcp/file): 'order', 'table_move', 'pre_bill'
 *   Fiscali (stampante Epson RT tipo fpmate):
 *     'fiscal_receipt'  – scontrino fiscale (documento commerciale)
 *     'fiscal_refund'   – documento di reso commerciale (RESO MERCE)
 *     'fiscal_void'     – documento di annullo commerciale (VOID)
 *     'fiscal_z_report' – chiusura giornaliera (Z report)
 *     'fiscal_x_report' – report finanziario (X report)
 *     'fiscal_status'   – query stato stampante
 *     'fiscal_duplicate'– ristampa ultimo scontrino (documento di gestione)
 *     'fiscal_drawer'   – apertura cassetto contanti
 *     'fiscal_cash'     – versamento/prelievo cassa fiscale (cash in/out)
 *
 * Le stampanti fisiche sono configurate in `printers.config.js` (Opzione A) oppure
 * tramite variabili d'ambiente `PRINTER_<N>_*` (Opzione B — le env vars hanno la precedenza).
 *
 * Configurazione tramite variabili d'ambiente:
 *   PORT                  – porta HTTP del server (default: 3001)
 *   PRINT_SERVER_NAME     – nome del server nei log (default: 'ESC/POS Print Server')
 *   PRINT_SERVER_API_KEY  – se impostato, richiede header x-api-key su POST /print
 *   CORS_ALLOWED_ORIGINS  – lista di origini CORS consentite (virgola separata).
 *                           Se vuota, tutte le origini sono accettate.
 *   PRINTER_<N>_ID        – id stampante. La numerazione parte da N=0 e deve essere
 *                           consecutiva (0,1,2,…). Se PRINTER_0_ID è impostato,
 *                           le stampanti vengono lette da queste variabili al posto
 *                           di printers.config.js.
 *   PRINTER_<N>_NAME      – nome descrittivo (default: uguale a ID)
 *   PRINTER_<N>_TYPE      – 'tcp' | 'file' (default: 'tcp')
 *   Per type='tcp':
 *     PRINTER_<N>_HOST    – IP/hostname (default: '127.0.0.1')
 *     PRINTER_<N>_PORT    – porta TCP (default: 9100)
 *     PRINTER_<N>_TIMEOUT – timeout connessione in ms (default: 5000)
 *   Per type='file':
 *     PRINTER_<N>_DEVICE  – percorso dispositivo (default: '/dev/usb/lp0')
 *
 * Avvio:
 *   node server.js
 */

const http    = require('http');
const cors    = require('cors');
const express = require('express');

const { printBuffer, printFiscal, getPrintersList, getPrinterConfig } = require('./printer.js');
const { buildEscPosBuffer } = require('./build-buffer.js');
const { buildFiscalXml } = require('./formatters/fiscal_receipt.js');
const directusClient = require('./directus-client.js');

// ── Configurazione ────────────────────────────────────────────────────────────

/**
 * Converte e valida la porta HTTP del server.
 * Accetta solo interi nel range 1-65535.
 * In caso di configurazione non valida, termina il processo con un errore chiaro.
 * @param {string|undefined} rawPort
 * @returns {number}
 */
function parsePortOrExit(rawPort) {
  const value = rawPort == null || rawPort === '' ? '3001' : rawPort;
  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(
      `Configurazione non valida: PORT deve essere un intero tra 1 e 65535. Valore ricevuto: ${JSON.stringify(rawPort)}`
    );
    process.exit(1);
  }

  return port;
}

const PORT        = parsePortOrExit(process.env.PORT);
const SERVER_NAME = process.env.PRINT_SERVER_NAME || 'ESC/POS Print Server';
const API_KEY     = process.env.PRINT_SERVER_API_KEY || '';

// Allowed CORS origins — when non-empty, only listed origins are accepted.
// Requests without an Origin header (e.g. curl, server-to-server) always pass.
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

// Supported printType values
const VALID_PRINT_TYPES = new Set(['order', 'table_move', 'pre_bill', 'fiscal_receipt', 'fiscal_refund', 'fiscal_void', 'fiscal_z_report', 'fiscal_x_report', 'fiscal_status', 'fiscal_duplicate', 'fiscal_drawer', 'fiscal_cash']);

// Fiscal print types — dispatched via fpmate HTTP/SOAP instead of raw ESC/POS.
const FISCAL_PRINT_TYPES = new Set(['fiscal_receipt', 'fiscal_refund', 'fiscal_void', 'fiscal_z_report', 'fiscal_x_report', 'fiscal_status', 'fiscal_duplicate', 'fiscal_drawer', 'fiscal_cash']);

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
      if (CORS_ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      // Tag the error with a stable code so the error handler can detect it
      // without relying on a localised message string.
      const corsErr = new Error('Origine CORS non consentita.');
      corsErr.code = 'CORS_ORIGIN_DENIED';
      return cb(corsErr);
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
 * If PRINT_SERVER_API_KEY is configured, guarded routes (POST /print and
 * GET /printers) must include the matching x-api-key header; all other
 * requests (e.g. GET /health) pass through.
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
 * GET /printers
 * Restituisce l'elenco delle stampanti configurate (senza credenziali).
 * Protetto da apiKeyGuard quando PRINT_SERVER_API_KEY è configurato, per non
 * esporre i dettagli di rete interna (host/port) a origini CORS arbitrarie.
 */
app.get('/printers', apiKeyGuard, (_req, res) => {
  const printers = getPrintersList().map((p) => {
    const summary = { id: p.id, name: p.name, type: p.type };
    if (p.type === 'tcp') {
      summary.host = p.host;
      summary.port = p.port;
    } else if (p.type === 'file') {
      summary.device = p.device;
    } else if (p.type === 'fpmate') {
      summary.host = p.host;
      summary.port = p.port ?? null;
      summary.https = p.https === true;
    }
    return summary;
  });
  res.json({ ok: true, printers });
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

  // ── Fiscal jobs: build XML and dispatch via fpmate HTTP/SOAP ───────────────
  if (FISCAL_PRINT_TYPES.has(printType)) {
    if ((printerConfig.type || '').toLowerCase() !== 'fpmate') {
      return res.status(400).json({
        ok: false,
        error: `Il printType "${printType}" richiede una stampante di tipo fpmate (stampante "${printerConfig.id}" è type="${printerConfig.type}").`,
      });
    }

    let xml;
    try {
      xml = buildFiscalXml(job);
    } catch (err) {
      const safeMsg = sanitizeForLog(err.message);
      console.error('[print-server] Errore formattazione fiscale job', safeJobId, '(' + safePrintType + '):', safeMsg);
      return res.status(400).json({ ok: false, error: `Errore formattazione fiscale: ${safeMsg}` });
    }

    try {
      const fiscalResponse = await printFiscal(xml, printerId);
      console.log('[print-server] Job fiscale stampato:', safeJobId, '(' + safePrintType + ') → stampante:', safeResolvedId,
        'success:', fiscalResponse.success, 'receipt:', fiscalResponse.addInfo?.fiscalReceiptNumber ?? '–');
      return res.json({
        ok: fiscalResponse.success === true,
        jobId: jobId ?? null,
        fiscal: fiscalResponse,
      });
    } catch (err) {
      const safeMsg = sanitizeForLog(err.message);
      console.error('[print-server] Errore stampante fiscale per job', safeJobId + ':', safeMsg);
      return res.status(500).json({ ok: false, error: `Errore stampante fiscale: ${safeMsg}` });
    }
  }

  // ── ESC/POS jobs: build buffer and dispatch via TCP/file ───────────────────
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
// Delegato a build-buffer.js (condiviso con directus-client.js)

// ── JSON / body-size error handler ────────────────────────────────────────────

// Express error-handling middleware: catches SyntaxError (malformed JSON body),
// PayloadTooLargeError (body > 256 KB) and CORS origin rejections, returning a
// consistent { ok: false, error } JSON response instead of the default HTML.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, error: 'Invalid JSON body.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: 'Payload too large (max 256 KB).' });
  }
  // CORS origin callback tags the error with code 'CORS_ORIGIN_DENIED' — surface it as 403 (not 500)
  if (err.code === 'CORS_ORIGIN_DENIED') {
    return res.status(403).json({ ok: false, error: 'Origine CORS non consentita.' });
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
      let conn;
      if (p.type === 'file') {
        conn = `file → ${p.device}`;
      } else if (p.type === 'fpmate') {
        conn = `fpmate → ${p.https ? 'https' : 'http'}://${p.host}${p.port ? ':' + p.port : ''}`;
      } else {
        conn = `TCP  → ${p.host}:${p.port}`;
      }
      console.log(`[print-server]   [${p.id}] ${p.name}  (${conn})`);
    }
  }

  // Avvia modalità Directus Pull se DIRECTUS_URL e DIRECTUS_TOKEN sono impostati.
  // La funzione è non bloccante: polling e WebSocket girano in background.
  directusClient.start(console).catch((err) => {
    console.error('[print-server] Errore avvio Directus pull mode:', err instanceof Error ? err.message : String(err), err);
  });
});

server.on('error', (err) => {
  console.error(`[print-server] Errore avvio server sulla porta ${PORT}:`, err.message);
  process.exit(1);
});

