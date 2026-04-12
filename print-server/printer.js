'use strict';

/**
 * @file printer.js
 * @description Gestione connessione alle stampanti fisiche.
 *
 * Legge il registro delle stampanti da `printers.config.js`.
 * Ogni stampante può essere raggiunta tramite:
 *   - TCP  (type: 'tcp')  → connessione socket sulla porta 9100 (o custom)
 *   - File (type: 'file') → scrittura su file di dispositivo (/dev/usb/lp0)
 *
 * Jobs to the same physical printer are serialized via a per-printer promise queue
 * to prevent interleaved output when concurrent requests arrive.
 *
 * Esporta:
 *   printBuffer(buf, printerId) → Promise<void>
 *     Invia il Buffer ESC/POS alla stampante identificata da `printerId`.
 *     Se `printerId` non corrisponde a nessuna voce configurata, usa la
 *     prima stampante come fallback.
 *
 *   getPrintersList() → object[]
 *     Restituisce l'elenco delle stampanti configurate (per i log di avvio).
 *
 *   getPrinterConfig(printerId) → object|null
 *     Restituisce la configurazione della stampante (esportata per test).
 *
 *   loadPrintersFromEnv() → object[]
 *     Restituisce le stampanti lette dalle variabili d'ambiente PRINTER_<N>_*.
 *     Array vuoto se nessuna variabile è impostata.
 */

const net = require('net');
const fs  = require('fs');

// ── Lookup stampante ─────────────────────────────────────────────────────────

/**
 * Pure routing helper: finds the matching printer in a given list.
 * Falls back to the first printer if no match is found.
 * Exported for unit tests.
 * @param {object[]} printersList
 * @param {string|undefined} printerId
 * @returns {object|null}
 */
function findPrinterConfig(printersList, printerId) {
  if (!Array.isArray(printersList) || printersList.length === 0) return null;
  if (printerId) {
    const found = printersList.find(p => p.id === printerId);
    if (found) return found;
  }
  // Fallback to first configured printer
  return printersList[0];
}

/**
 * Parses printer configurations from environment variables.
 *
 * Convention: indexed entries starting from 0.
 *   PRINTER_0_ID      – (required) unique printer id
 *   PRINTER_0_NAME    – display name (default: same as ID)
 *   PRINTER_0_TYPE    – 'tcp' | 'file' (default: 'tcp')
 *   For type='tcp':
 *     PRINTER_0_HOST    – IP or hostname (default: '127.0.0.1')
 *     PRINTER_0_PORT    – TCP port (default: 9100)
 *     PRINTER_0_TIMEOUT – connection timeout in ms (default: 5000)
 *   For type='file':
 *     PRINTER_0_DEVICE  – device path (default: '/dev/usb/lp0')
 *
 * Iteration stops at the first missing PRINTER_<N>_ID.
 * Returns an empty array when no printer env vars are set.
 *
 * @returns {object[]}
 */
function loadPrintersFromEnv() {
  const printers = [];
  let n = 0;
  while (true) {
    const id = process.env[`PRINTER_${n}_ID`];
    if (!id) break;
    const type = process.env[`PRINTER_${n}_TYPE`]?.toLowerCase() || 'tcp';
    const name = process.env[`PRINTER_${n}_NAME`] || id;
    const entry = { id, name, type };
    if (type === 'file') {
      entry.device = process.env[`PRINTER_${n}_DEVICE`] || '/dev/usb/lp0';
    } else {
      entry.host = process.env[`PRINTER_${n}_HOST`] || '127.0.0.1';
      const rawPort    = process.env[`PRINTER_${n}_PORT`];
      const rawTimeout = process.env[`PRINTER_${n}_TIMEOUT`];
      const parsedPort    = parseInt(rawPort, 10);
      const parsedTimeout = parseInt(rawTimeout, 10);
      entry.port    = rawPort    && !isNaN(parsedPort)    ? parsedPort    : 9100;
      entry.timeout = rawTimeout && !isNaN(parsedTimeout) ? parsedTimeout : 5000;
    }
    printers.push(entry);
    n++;
  }
  return printers;
}

/** @type {object[]|null} Cache delle stampanti — null = non ancora caricata. */
let _cachedPrinters = null;

/**
 * Carica la lista di stampanti (con cache per il ciclo di vita del processo).
 * Priorità: variabili d'ambiente PRINTER_<N>_* → printers.config.js (fallback).
 * Il risultato viene memoizzato: le variabili d'ambiente vengono lette una sola
 * volta per evitare overhead durante la stampa ad alto volume. Per invalidare
 * la cache (es. nei test) usare _resetPrinterCache().
 * Il caricamento lazy garantisce che vi.mock('../printers.config.js') nei test
 * venga sempre rispettato senza richiedere trucchi sulla module cache.
 * @returns {object[]}
 */
function _loadPrinters() {
  if (_cachedPrinters !== null) return _cachedPrinters;
  const fromEnv = loadPrintersFromEnv();
  if (fromEnv.length > 0) {
    _cachedPrinters = fromEnv;
    return _cachedPrinters;
  }
  // eslint-disable-next-line global-require
  const cfg = require('./printers.config.js');
  _cachedPrinters = Array.isArray(cfg.printers) ? cfg.printers : [];
  return _cachedPrinters;
}

/**
 * Azzera la cache delle stampanti, forzando il ricaricamento al prossimo accesso.
 * Da usare esclusivamente nei test per simulare ambienti diversi tra un test e l'altro.
 */
function _resetPrinterCache() {
  _cachedPrinters = null;
}

/**
 * Restituisce la configurazione della stampante corrispondente a `printerId`.
 * Se non trovata, restituisce la prima stampante come fallback.
 * @param {string|undefined} printerId
 * @returns {object|null}
 */
function getPrinterConfig(printerId) {
  return findPrinterConfig(_loadPrinters(), printerId);
}

/**
 * Restituisce l'elenco delle stampanti configurate.
 * @returns {object[]}
 */
function getPrintersList() {
  return _loadPrinters();
}

// ── Per-printer queue ─────────────────────────────────────────────────────────

/**
 * Map from printer id → tail of its job promise chain.
 * Ensures jobs for the same physical printer are executed serially.
 * @type {Map<string, Promise<void>>}
 */
const _queues = new Map();

/**
 * Enqueues `fn` after the last job for the given printer id.
 * The returned promise resolves/rejects with fn's result.
 * Errors do NOT block the queue for subsequent jobs.
 * @param {string} id
 * @param {() => Promise<void>} fn
 * @returns {Promise<void>}
 */
function _enqueue(id, fn) {
  const prev = _queues.get(id) || Promise.resolve();
  const tail = prev.then(fn);
  // Store a version that swallows errors so the next job always runs
  _queues.set(id, tail.catch(() => {}));
  return tail;
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

/**
 * Invia un Buffer ESC/POS alla stampante identificata da `printerId`.
 * Il job viene accodato per la stampante scelta (serializzazione per printer).
 * @param {Buffer} buf       – byte ESC/POS pronti per la stampante
 * @param {string} printerId – id della stampante (come in printers.config.js)
 * @returns {Promise<void>}
 */
function printBuffer(buf, printerId) {
  const config = getPrinterConfig(printerId);
  if (!config) {
    return Promise.reject(new Error('No printers configured in printers.config.js.'));
  }
  return _enqueue(config.id, () => _dispatch(buf, config));
}

/**
 * Low-level dispatch: sends buf to the physical printer described by config.
 * @param {Buffer} buf
 * @param {object} config
 * @returns {Promise<void>}
 */
function _dispatch(buf, config) {
  const rawType = config.type == null ? 'tcp' : config.type;
  if (typeof rawType !== 'string') {
    throw new Error(
      `Invalid printer type for printer "${config.id}": expected "tcp" or "file", got ${typeof rawType}.`
    );
  }

  const type = rawType.toLowerCase();
  if (type !== 'tcp' && type !== 'file') {
    throw new Error(
      `Invalid printer type for printer "${config.id}": expected "tcp" or "file", got "${rawType}".`
    );
  }
  if (type === 'file') {
    return printToFile(buf, config.device || '/dev/usb/lp0');
  }
  return printViaTcp(
    buf,
    config.host    || '127.0.0.1',
    config.port    || 9100,
    config.timeout || 5000,
  );
}

// ── TCP ──────────────────────────────────────────────────────────────────────

function printViaTcp(buf, host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    let endInitiated = false;

    function done(err) {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve();
    }

    socket.setTimeout(timeoutMs);

    socket.on('timeout', () => done(new Error(
      `TCP timeout (${timeoutMs}ms) communicating with ${host}:${port}`,
    )));

    socket.on('error', done);

    socket.connect(port, host, () => {
      socket.write(buf, (writeErr) => {
        if (writeErr) {
          done(writeErr);
        } else {
          // Primary resolution: resolve in the end() flush callback (deterministic).
          endInitiated = true;
          socket.end(() => done(null));
        }
      });
    });

    // Backstop: only resolve from close if end has already been initiated.
    // If close fires before endInitiated (peer hung up before our write/end sequence
    // completed) we do nothing here — the write/error/timeout path will handle it.
    socket.on('close', () => {
      if (endInitiated) done(null);
    });
  });
}

// ── File di dispositivo ──────────────────────────────────────────────────────

function printToFile(buf, device) {
  return new Promise((resolve, reject) => {
    fs.writeFile(device, buf, { flag: 'w' }, (writeErr) => {
      if (writeErr) reject(writeErr);
      else resolve();
    });
  });
}

module.exports = { printBuffer, getPrintersList, getPrinterConfig, findPrinterConfig, loadPrintersFromEnv, _enqueue, _dispatch, _resetPrinterCache };

