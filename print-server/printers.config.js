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
 *   type     {string}  – 'tcp' (rete) | 'file' (USB/parallelo) | 'fpmate' (fiscale RT)
 *
 *   Per type='tcp':
 *     host    {string}  – indirizzo IP o hostname della stampante
 *     port    {number}  – porta TCP (di solito 9100)
 *     timeout {number}  – timeout connessione in ms (default: 5000)
 *
 *   Per type='file':
 *     device  {string}  – percorso del file di dispositivo (es. '/dev/usb/lp0')
 *
 *   Per type='fpmate' (stampante fiscale Epson RT via fpmate.cgi):
 *     host     {string}         – IP/hostname della stampante fiscale
 *     port     {number|null}    – porta HTTP (default: null → 80/443)
 *     timeout  {number}         – timeout fpmate in ms (default: 30000)
 *     https    {boolean}        – usa HTTPS (default: false)
 *     username {string}         – credenziali web (opzionale)
 *     password {string}         – credenziali web (opzionale)
 *
 * Esempio configurazione multi-stampante (cucina + bar + cassa):
 *
 *   printers: [
 *     { id: 'cucina', name: 'Cucina',  type: 'tcp',  host: '192.168.1.100', port: 9100 },
 *     { id: 'bar',    name: 'Bar',     type: 'tcp',  host: '192.168.1.101', port: 9100 },
 *     { id: 'cassa',  name: 'Cassa',   type: 'file', device: '/dev/usb/lp0' },
 *   ],
 *
 * Esempio stampante fiscale Epson RT (fpmate):
 *
 *   printers: [
 *     { id: 'fiscale', name: 'Stampante Fiscale', type: 'fpmate', host: '192.168.1.200' },
 *   ],
 *
 * Se il `printerId` del job non corrisponde a nessuna voce, viene usata la prima
 * stampante della lista come fallback.
 */

module.exports = {
  printers: [
    // ── Configure venue printers here ────────────────────────────────────
    // Uncomment and adapt entries below. The id must match the id configured
    // in src/utils/index.js → appConfig.printers[].id.
    //
    // { id: 'cucina', name: 'Cucina', type: 'tcp',  host: '192.168.1.100', port: 9100 },
    // { id: 'bar',    name: 'Bar',    type: 'tcp',  host: '192.168.1.101', port: 9100 },
    // { id: 'cassa',  name: 'Cassa',  type: 'tcp',  host: '192.168.1.102', port: 9100 },
    // { id: 'usb',    name: 'USB',    type: 'file', device: '/dev/usb/lp0' },
    // ─────────────────────────────────────────────────────────────────────
  ],
};
