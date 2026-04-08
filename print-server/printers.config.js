'use strict';

/**
 * @file printers.config.js
 * @description Registro delle stampanti fisiche del locale.
 *
 * Ogni voce definisce una stampante con i suoi parametri di connessione.
 * L'`id` deve corrispondere al campo `printerId` dei job inviati dall'app-cassa
 * (configurato in `src/utils/index.js → appConfig.printers[].id`).
 *
 * Proprietà di ogni stampante:
 *   id       {string}  – identificatore univoco (deve corrispondere a appConfig.printers[].id)
 *   name     {string}  – nome descrittivo (solo per i log)
 *   type     {string}  – 'tcp' (rete) | 'file' (dispositivo USB/parallelo)
 *
 *   Per type='tcp':
 *     host    {string}  – indirizzo IP o hostname della stampante
 *     port    {number}  – porta TCP (di solito 9100)
 *     timeout {number}  – timeout connessione in ms (default: 5000)
 *
 *   Per type='file':
 *     device  {string}  – percorso del file di dispositivo (es. '/dev/usb/lp0')
 *
 * Esempio configurazione multi-stampante (cucina + bar + cassa):
 *
 *   printers: [
 *     { id: 'cucina', name: 'Cucina',  type: 'tcp',  host: '192.168.1.100', port: 9100 },
 *     { id: 'bar',    name: 'Bar',     type: 'tcp',  host: '192.168.1.101', port: 9100 },
 *     { id: 'cassa',  name: 'Cassa',   type: 'file', device: '/dev/usb/lp0' },
 *   ],
 *
 * Se il `printerId` del job non corrisponde a nessuna voce, viene usata la prima
 * stampante della lista come fallback.
 */

module.exports = {
  printers: [
    {
      id:   'demo',
      name: 'Stampante Demo',
      type: 'tcp',
      host: process.env.PRINTER_HOST || '127.0.0.1',
      port: parseInt(process.env.PRINTER_PORT || '9100', 10),
      timeout: parseInt(process.env.PRINTER_TCP_TIMEOUT_MS || '5000', 10),
    },

    // ── Aggiungere qui le stampanti del locale ────────────────────────────
    //
    // { id: 'cucina', name: 'Cucina',  type: 'tcp',  host: '192.168.1.100', port: 9100 },
    // { id: 'bar',    name: 'Bar',     type: 'tcp',  host: '192.168.1.101', port: 9100 },
    // { id: 'cassa',  name: 'Cassa',   type: 'file', device: '/dev/usb/lp0' },
    // ─────────────────────────────────────────────────────────────────────
  ],
};
