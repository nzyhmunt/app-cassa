/**
 * @file directus-extensions/hooks/print-dispatcher/src/index.js
 * @description Directus hook extension — Print Dispatcher (stampa diretta ESC/POS)
 *
 * Legge le collezioni `print_jobs` e `printers` e invia automaticamente
 * ogni lavoro di stampa con stato `pending` direttamente alla stampante fisica
 * via TCP o dispositivo file. Non richiede servizi Node.js / Docker esterni.
 *
 * Comportamento:
 *  - Hook `items.create` su `print_jobs`: dispatch immediato appena il job
 *    viene creato (tipicamente via sync offline-first dal frontend).
 *  - Schedule (ogni minuto, configurabile): recupero di tutti i job rimasti
 *    in stato `pending` non ancora processati (fallback/backfill).
 *  - Blocco ottimistico: l'UPDATE atomico `WHERE status='pending'` garantisce
 *    che due processi concorrenti non spediscano lo stesso job due volte.
 *
 * Tipi di connessione supportati (campo `connection_type` nella collezione `printers`):
 *  - `tcp`  — connessione TCP diretta sulla porta ESC/POS (default 9100)
 *  - `file` — scrittura su dispositivo USB/seriale (es. /dev/usb/lp0)
 *  - `http` — NON supportato in modalità diretta (richiede print-server esterno)
 *
 * Variabili d'ambiente:
 *  PRINT_DISPATCHER_POLL_SEC        — Intervallo di polling in secondi (default: 60).
 *  PRINT_DISPATCHER_RETRY_MAX       — Numero massimo di tentativi per job (default: 3).
 *  PRINT_DISPATCHER_RETRY_DELAY_MS  — Attesa tra i tentativi in ms (default: 2000).
 */

import net from 'net';
import fs  from 'fs';

// ── Shared formatters ─────────────────────────────────────────────────────────
// Il codice canonico dei formatter si trova in print-server/formatters/*.js (CJS).
// Le modifiche vanno fatte lì; poi rieseguire `npm run build` in questa cartella.
// Rollup (@rollup/plugin-commonjs) risolve e include il codice CJS nel bundle.
import { formatOrder }     from '../../../../print-server/formatters/order.js';
import { formatTableMove } from '../../../../print-server/formatters/table_move.js';
import { formatPreBill }   from '../../../../print-server/formatters/pre_bill.js';

export default ({ action, schedule }, { services, database, getSchema, logger, env }) => {
  const { ItemsService } = services;

  // ── Configurazione ────────────────────────────────────────────────────────

  /**
   * Legge una variabile d'ambiente numerica intera.
   * Restituisce `fallback` se la variabile non è impostata, è vuota o non è un intero valido.
   * @param {string} name      Nome variabile d'ambiente
   * @param {number} fallback  Valore di default
   * @returns {number}
   */
  function envInt(name, fallback) {
    const raw = env[name];
    if (raw == null || raw === '') return fallback;
    const parsed = parseInt(raw, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  }

  const POLL_SEC       = Math.max(1, envInt('PRINT_DISPATCHER_POLL_SEC',        60));
  const RETRY_MAX      = Math.max(0, envInt('PRINT_DISPATCHER_RETRY_MAX',         3));
  const RETRY_DELAY_MS = Math.max(0, envInt('PRINT_DISPATCHER_RETRY_DELAY_MS', 2000));

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Sanitizza un valore per uso sicuro nei log (rimuove control chars, tronca).
   * @param {unknown} v
   * @returns {string}
   */
  function safeLog(v) {
    return String(v ?? '').replace(/[\r\n\t\x00-\x1f\x7f]/g, ' ').slice(0, 256);
  }

  /**
   * Attende `ms` millisecondi.
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ── Formatters ESC/POS ────────────────────────────────────────────────────

  /**
   * Converte il payload di un job in un Buffer ESC/POS.
   * @param {object} job  Payload con `printType` e campi specifici del tipo
   * @returns {Buffer}
   * @throws {Error} Se `printType` non è supportato
   */
  function buildEscPosBuffer(job) {
    switch (job.printType) {
      case 'order':      return formatOrder(job);
      case 'table_move': return formatTableMove(job);
      case 'pre_bill':   return formatPreBill(job);
      default: {
        const err = new Error(`Tipo di stampa non supportato: ${job.printType}`);
        err.permanent = true;
        throw err;
      }
    }
  }

  // ── Stampa diretta ────────────────────────────────────────────────────────

  /**
   * Invia un Buffer ESC/POS alla stampante via TCP.
   * @param {Buffer} buf
   * @param {string} host
   * @param {number} port
   * @param {number} timeoutMs
   * @returns {Promise<void>}
   */
  function printViaTcp(buf, host, port, timeoutMs) {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      let settled        = false;
      let endInitiated   = false;

      function done(err) {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (err) reject(err);
        else resolve();
      }

      socket.setTimeout(timeoutMs);
      socket.on('timeout', () => done(new Error(
        `TCP timeout (${timeoutMs}ms) connettendo a ${host}:${port}`,
      )));
      socket.on('error', done);

      socket.connect(port, host, () => {
        socket.write(buf, (writeErr) => {
          if (writeErr) {
            done(writeErr);
          } else {
            endInitiated = true;
            socket.end(() => done(null));
          }
        });
      });

      socket.on('close', () => {
        if (endInitiated) done(null);
      });
    });
  }

  /**
   * Scrive un Buffer ESC/POS su un dispositivo file (USB/seriale).
   * @param {Buffer} buf
   * @param {string} device  Percorso del dispositivo (es. /dev/usb/lp0)
   * @returns {Promise<void>}
   */
  function printToFile(buf, device) {
    return new Promise((resolve, reject) => {
      fs.writeFile(device, buf, { flag: 'w' }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Invia il Buffer ESC/POS alla stampante in base alla configurazione.
   * @param {Buffer} buf
   * @param {object} printer  Configurazione stampante da Directus
   * @returns {Promise<void>}
   * @throws {Error} Se `connection_type` non è supportato per la stampa diretta
   */
  function dispatchBuffer(buf, printer) {
    const type = (printer.connection_type ?? 'http').toLowerCase();

    if (type === 'tcp') {
      const host    = printer.tcp_host    || '127.0.0.1';
      const port    = printer.tcp_port    || 9100;
      const timeout = printer.tcp_timeout || 5000;
      return printViaTcp(buf, host, port, timeout);
    }

    if (type === 'file') {
      const device = printer.file_device || '/dev/usb/lp0';
      return printToFile(buf, device);
    }

    // http e altri: non supportati in modalità diretta
    const err = new Error(
      `Stampante "${safeLog(printer.id)}" usa connection_type="${type}" che non è supportato in modalità diretta. ` +
      `Usare tcp o file per la stampa senza print-server esterno.`,
    );
    err.permanent = true;
    return Promise.reject(err);
  }

  // ── Core dispatch ─────────────────────────────────────────────────────────

  /**
   * Prova ad acquisire il job `logId` impostando lo stato a `printing`
   * solo se lo stato corrente è `pending` (compare-and-swap atomico).
   *
   * @param {string} logId
   * @returns {Promise<boolean>} `true` se il lock è stato acquisito
   */
  async function tryClaimJob(logId) {
    const count = await database('print_jobs')
      .where({ log_id: logId, status: 'pending' })
      .update({ status: 'printing' });
    return count > 0;
  }

  /**
   * Legge la configurazione della stampante dalla collezione `printers`.
   * @param {string} printerId
   * @param {object} schema
   * @returns {Promise<object>}
   * @throws {Error} Se la stampante non esiste
   */
  async function getPrinterConfig(printerId, schema) {
    const svc = new ItemsService('printers', { database, schema });
    const printer = await svc.readOne(printerId, {
      fields: ['id', 'name', 'connection_type', 'tcp_host', 'tcp_port', 'tcp_timeout', 'file_device'],
    });
    if (!printer) {
      throw new Error(`Stampante "${safeLog(printerId)}" non trovata`);
    }
    return printer;
  }

  /**
   * Processa un singolo job di stampa:
   *   1. Acquisisce il lock (status pending → printing)
   *   2. Legge la configurazione della stampante da `printers`
   *   3. Costruisce il Buffer ESC/POS
   *   4. Invia direttamente alla stampante fisica (TCP / file)
   *   5. Aggiorna lo stato a `done` o `error`
   *
   * @param {string} logId  Chiave primaria del job (print_jobs.log_id)
   */
  async function processJob(logId) {
    // ── 1. Acquisizione lock ──────────────────────────────────────────────
    const claimed = await tryClaimJob(logId);
    if (!claimed) return; // già acquisito da un altro processo

    const schema  = await getSchema();
    const jobsSvc = new ItemsService('print_jobs', { database, schema });

    // ── 2. Lettura record completo ────────────────────────────────────────
    let job;
    try {
      job = await jobsSvc.readOne(logId, {
        fields: ['log_id', 'printer', 'payload', 'print_type', 'job_id'],
      });
    } catch (err) {
      logger.warn(`[print-dispatcher] Job ${safeLog(logId)} non trovato: ${safeLog(err.message)}`);
      return;
    }

    // ── 3. Invio diretto alla stampante ───────────────────────────────────
    let lastErr;
    for (let attempt = 0; attempt <= RETRY_MAX; attempt++) {
      if (attempt > 0) await sleep(RETRY_DELAY_MS);
      try {
        // Legge config stampante (inclusi campi connessione diretta)
        const printer = await getPrinterConfig(job.printer, schema);

        // Costruisce payload canonico (print_type dal record Directus ha precedenza)
        const basePayload =
          job.payload && typeof job.payload === 'object' && !Array.isArray(job.payload)
            ? job.payload
            : {};
        const printPayload = {
          ...basePayload,
          printType: job.print_type,  // sempre dal record Directus
          printerId: job.printer,
          jobId:     job.job_id,
        };

        // Genera buffer ESC/POS e invia direttamente
        const buf = buildEscPosBuffer(printPayload);
        await dispatchBuffer(buf, printer);

        await jobsSvc.updateOne(logId, { status: 'done', error_message: null });
        logger.info(
          `[print-dispatcher] ✓ Job ${safeLog(job.job_id)} (${safeLog(job.print_type)}) → stampante "${safeLog(job.printer)}"`,
        );
        return; // successo

      } catch (err) {
        // Errori permanenti (tipo non supportato, printType non valido): non ritentare
        if (err.permanent) {
          const msg = safeLog(err.message ?? err);
          await jobsSvc.updateOne(logId, { status: 'error', error_message: msg }).catch(() => {});
          logger.error(`[print-dispatcher] ✗ Job ${safeLog(job.job_id ?? logId)} errore permanente: ${msg}`);
          return;
        }
        lastErr = err;
      }
    }

    // Esauriti i tentativi: segna errore
    const msg = safeLog(lastErr?.message ?? lastErr ?? 'Errore sconosciuto');
    await jobsSvc.updateOne(logId, { status: 'error', error_message: msg }).catch(() => {});
    logger.error(`[print-dispatcher] ✗ Job ${safeLog(job.job_id ?? logId)} fallito dopo ${RETRY_MAX + 1} tentativi: ${msg}`);
  }

  // ── Hook: dispatch immediato alla creazione ───────────────────────────────

  action('items.create', async ({ collection, key }) => {
    if (collection !== 'print_jobs') return;
    try {
      await processJob(String(key));
    } catch (err) {
      logger.error(`[print-dispatcher] Errore critico job ${safeLog(key)}: ${safeLog(err.message)}`);
    }
  });

  // ── Schedule: recupero job pending rimasti indietro ───────────────────────

  // Converte POLL_SEC in cron expression.
  //  ≤ 59 s  → "*/N * * * * *"  (6 campi incl. secondi — node-cron)
  //  ≥ 60 s  → "*/M * * * *"    (5 campi, minuti — arrotondato; min 1)
  const cronMinutes = Math.max(1, Math.round(POLL_SEC / 60));
  const cronExpr    = POLL_SEC < 60
    ? `*/${POLL_SEC} * * * * *`
    : `*/${cronMinutes} * * * *`;

  schedule(cronExpr, async () => {
    let pendingJobs;
    try {
      const schema  = await getSchema();
      const jobsSvc = new ItemsService('print_jobs', { database, schema });
      pendingJobs   = await jobsSvc.readByQuery({
        filter: { status: { _eq: 'pending' } },
        fields: ['log_id'],
        sort:   ['job_timestamp'],
        limit:  100,
      });
    } catch (err) {
      logger.error(`[print-dispatcher] Errore polling pending jobs: ${safeLog(err.message)}`);
      return;
    }

    if (pendingJobs.length === 0) return;

    logger.info(`[print-dispatcher] Polling: trovati ${pendingJobs.length} job(s) pending`);

    for (const { log_id } of pendingJobs) {
      try {
        await processJob(log_id);
      } catch (err) {
        logger.error(`[print-dispatcher] Errore nel polling per job ${safeLog(log_id)}: ${safeLog(err.message)}`);
      }
    }
  });

  logger.info(
    `[print-dispatcher] Estensione caricata (stampa diretta) — polling ogni ${POLL_SEC}s, max retry ${RETRY_MAX}`,
  );
};
