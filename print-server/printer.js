'use strict';

/**
 * @file printer.js
 * @description Gestione connessione alla stampante (TCP di rete o file di dispositivo USB).
 *
 * Modalità supportate (configurabili via variabili d'ambiente):
 *
 *   PRINTER_TYPE=tcp  (default)
 *     Connette alla stampante tramite socket TCP, solitamente su porta 9100.
 *     Variabili: PRINTER_HOST (default '127.0.0.1'), PRINTER_PORT (default 9100)
 *
 *   PRINTER_TYPE=file
 *     Scrive direttamente su un file di dispositivo (es. /dev/usb/lp0).
 *     Variabile: PRINTER_DEVICE (default '/dev/usb/lp0')
 *
 * Esporta:
 *   printBuffer(buf) → Promise<void>
 *     Invia il Buffer ESC/POS alla stampante.
 */

const net = require('net');
const fs  = require('fs');

const PRINTER_TYPE   = (process.env.PRINTER_TYPE   || 'tcp').toLowerCase();
const PRINTER_HOST   = process.env.PRINTER_HOST  || '127.0.0.1';
const PRINTER_PORT   = parseInt(process.env.PRINTER_PORT  || '9100', 10);
const PRINTER_DEVICE = process.env.PRINTER_DEVICE || '/dev/usb/lp0';

/** Timeout di connessione TCP in ms */
const TCP_TIMEOUT_MS = parseInt(process.env.PRINTER_TCP_TIMEOUT_MS || '5000', 10);

/**
 * Invia un Buffer ESC/POS alla stampante.
 * @param {Buffer} buf – byte ESC/POS pronti per la stampante
 * @returns {Promise<void>}
 */
function printBuffer(buf) {
  if (PRINTER_TYPE === 'file') {
    return printToFile(buf);
  }
  return printViaTcp(buf);
}

// ── TCP ──────────────────────────────────────────────────────────────────────

function printViaTcp(buf) {
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

    socket.setTimeout(TCP_TIMEOUT_MS);

    socket.on('timeout', () => done(new Error(
      `TCP timeout after ${TCP_TIMEOUT_MS}ms connecting to ${PRINTER_HOST}:${PRINTER_PORT}`,
    )));

    socket.on('error', done);

    socket.connect(PRINTER_PORT, PRINTER_HOST, () => {
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

function printToFile(buf) {
  return new Promise((resolve, reject) => {
    fs.open(PRINTER_DEVICE, 'w', (openErr, fd) => {
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

module.exports = { printBuffer, PRINTER_TYPE, PRINTER_HOST, PRINTER_PORT, PRINTER_DEVICE };
