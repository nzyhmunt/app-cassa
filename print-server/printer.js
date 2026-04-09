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
 */

const net = require('net');
const fs  = require('fs');
const { printers } = require('./printers.config.js');

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
 * Restituisce la configurazione della stampante corrispondente a `printerId`.
 * Se non trovata, restituisce la prima stampante come fallback.
 * @param {string|undefined} printerId
 * @returns {object|null}
 */
function getPrinterConfig(printerId) {
  return findPrinterConfig(printers, printerId);
}

/**
 * Restituisce l'elenco delle stampanti configurate.
 * @returns {object[]}
 */
function getPrintersList() {
  return Array.isArray(printers) ? printers : [];
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
  const type = (config.type || 'tcp').toLowerCase();
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

    function done(err) {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve();
    }

    socket.setTimeout(timeoutMs);

    socket.on('timeout', () => done(new Error(
      `TCP timeout after ${timeoutMs}ms connecting to ${host}:${port}`,
    )));

    socket.on('error', done);

    socket.connect(port, host, () => {
      socket.write(buf, (writeErr) => {
        if (writeErr) {
          done(writeErr);
        } else {
          // Some drivers close the connection automatically; others do not.
          // We close it in a controlled manner after the write.
          socket.end();
        }
      });
    });

    socket.on('close', () => done(null));
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

module.exports = { printBuffer, getPrintersList, getPrinterConfig, findPrinterConfig };

