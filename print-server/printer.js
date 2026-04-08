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
 * Esporta:
 *   printBuffer(buf, printerId) → Promise<void>
 *     Invia il Buffer ESC/POS alla stampante identificata da `printerId`.
 *     Se `printerId` non corrisponde a nessuna voce configurata, usa la
 *     prima stampante come fallback.
 *
 *   getPrintersList() → object[]
 *     Restituisce l'elenco delle stampanti configurate (per i log di avvio).
 */

const net = require('net');
const fs  = require('fs');
const { printers } = require('./printers.config.js');

// ── Lookup stampante ─────────────────────────────────────────────────────────

/**
 * Restituisce la configurazione della stampante corrispondente a `printerId`.
 * Se non trovata, restituisce la prima stampante come fallback.
 * @param {string|undefined} printerId
 * @returns {object|null}
 */
function getPrinterConfig(printerId) {
  if (!Array.isArray(printers) || printers.length === 0) return null;
  if (printerId) {
    const found = printers.find(p => p.id === printerId);
    if (found) return found;
  }
  // Fallback alla prima stampante configurata
  return printers[0];
}

/**
 * Restituisce l'elenco delle stampanti configurate.
 * @returns {object[]}
 */
function getPrintersList() {
  return Array.isArray(printers) ? printers : [];
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

/**
 * Invia un Buffer ESC/POS alla stampante identificata da `printerId`.
 * @param {Buffer} buf       – byte ESC/POS pronti per la stampante
 * @param {string} printerId – id della stampante (come in printers.config.js)
 * @returns {Promise<void>}
 */
function printBuffer(buf, printerId) {
  const config = getPrinterConfig(printerId);
  if (!config) {
    return Promise.reject(new Error('Nessuna stampante configurata in printers.config.js.'));
  }
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
          // Alcuni driver chiudono la connessione automaticamente; altri no.
          // Chiudiamo noi la connessione in modo controllato dopo la scrittura.
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
    fs.open(device, 'w', (openErr, fd) => {
      if (openErr) return reject(openErr);
      fs.write(fd, buf, (writeErr) => {
        fs.close(fd, () => {
          if (writeErr) reject(writeErr);
          else resolve();
        });
      });
    });
  });
}

module.exports = { printBuffer, getPrintersList };
