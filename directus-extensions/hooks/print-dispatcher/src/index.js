/**
 * @file directus-extensions/hooks/print-dispatcher/src/index.js
 * @description Directus hook extension — Print Dispatcher
 *
 * Legge le collezioni `print_jobs` e `printers` e invia automaticamente
 * ogni lavoro di stampa con stato `pending` al relativo servizio ESC/POS.
 *
 * Comportamento:
 *  - Hook `items.create` su `print_jobs`: dispatch immediato appena il job
 *    viene creato (tipicamente via sync offline-first dal frontend).
 *  - Schedule (ogni minuto, configurabile): recupero di tutti i job rimasti
 *    in stato `pending` non ancora processati (fallback/backfill).
 *  - Blocco ottimistico: l'UPDATE atomico `WHERE status='pending'` garantisce
 *    che due processi concorrenti non spediscano lo stesso job due volte.
 *
 * Variabili d'ambiente:
 *  PRINT_SERVER_API_KEY       — Header `x-api-key` inviato al print-server
 *                               (opzionale; usare solo se il server richiede auth).
 *  PRINT_DISPATCHER_POLL_SEC  — Intervallo di polling in secondi (default: 60).
 *  PRINT_DISPATCHER_TIMEOUT_MS — Timeout HTTP per ogni job in ms (default: 30000).
 *  PRINT_DISPATCHER_RETRY_MAX  — Numero massimo di tentativi per job (default: 3).
 *  PRINT_DISPATCHER_RETRY_DELAY_MS — Attesa tra i tentativi in ms (default: 2000).
 */

export default ({ action, schedule }, { services, database, getSchema, logger, env }) => {
  const { ItemsService } = services;

  // ── Configurazione ────────────────────────────────────────────────────────

  const PRINT_API_KEY   = env['PRINT_SERVER_API_KEY'] ?? '';

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

  const POLL_SEC        = Math.max(1,    envInt('PRINT_DISPATCHER_POLL_SEC',        60));
  const TIMEOUT_MS      = Math.max(1000, envInt('PRINT_DISPATCHER_TIMEOUT_MS',   30000));
  const RETRY_MAX       = Math.max(0,    envInt('PRINT_DISPATCHER_RETRY_MAX',         3));
  const RETRY_DELAY_MS  = Math.max(0,    envInt('PRINT_DISPATCHER_RETRY_DELAY_MS', 2000));

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

  /**
   * Invia il payload al print-server con retry automatico in caso di errore
   * di rete o risposta HTTP 5xx.
   * @param {string} url          URL del print-server (es. http://localhost:3001/print)
   * @param {object} payload      Corpo JSON da inviare
   * @returns {Promise<void>}
   * @throws {Error} Dopo aver esaurito tutti i tentativi
   */
  async function postWithRetry(url, payload) {
    let lastErr;
    for (let attempt = 0; attempt <= RETRY_MAX; attempt++) {
      if (attempt > 0) await sleep(RETRY_DELAY_MS);
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (PRINT_API_KEY) headers['x-api-key'] = PRINT_API_KEY;

        const resp = await fetch(url, {
          method:  'POST',
          headers,
          body:    JSON.stringify(payload),
          signal:  AbortSignal.timeout(TIMEOUT_MS),
        });

        if (resp.ok) return; // successo

        // Errori 4xx sono definitivi (payload non valido) — non ritentare
        if (resp.status >= 400 && resp.status < 500) {
          const data = await resp.json().catch(() => ({}));
          throw new Error(data.error ?? `HTTP ${resp.status}`);
        }

        // Errori 5xx: ritenta
        const data = await resp.json().catch(() => ({}));
        lastErr = new Error(data.error ?? `HTTP ${resp.status}`);
      } catch (err) {
        // Distingue errori di rete (AbortError, ECONNREFUSED, …) dagli errori
        // 4xx definitivi (che rilanciano direttamente uscendo dal loop).
        if (err.message?.startsWith('HTTP 4')) throw err;
        lastErr = err;
      }
    }
    throw lastErr ?? new Error('Invio fallito dopo tutti i tentativi');
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
   * Legge l'URL della stampante dalla collezione `printers`.
   * @param {string}   printerId  ID della stampante (FK in print_jobs.printer)
   * @param {object}   schema     Schema Directus corrente
   * @returns {Promise<string>}   URL del print-server
   * @throws {Error}  Se la stampante non esiste o non ha un URL
   */
  async function getPrinterUrl(printerId, schema) {
    const svc = new ItemsService('printers', { database, schema });
    const printer = await svc.readOne(printerId, { fields: ['id', 'url'] });
    if (!printer?.url) {
      throw new Error(`Stampante "${safeLog(printerId)}" non trovata o URL non configurato`);
    }
    return printer.url;
  }

  /**
   * Processa un singolo job di stampa:
   *   1. Acquisisce il lock (status pending → printing)
   *   2. Legge URL stampante da `printers`
   *   3. Invia il payload via HTTP al print-server
   *   4. Aggiorna lo stato a `done` o `error`
   *
   * @param {string} logId  Chiave primaria del job (print_jobs.log_id)
   */
  async function processJob(logId) {
    // ── 1. Acquisizione lock ──────────────────────────────────────────────
    const claimed = await tryClaimJob(logId);
    if (!claimed) {
      // Un altro processo ha già acquisito o completato il job
      return;
    }

    const schema = await getSchema();
    const jobsSvc = new ItemsService('print_jobs', { database, schema });

    // ── 2. Lettura record completo ────────────────────────────────────────
    let job;
    try {
      job = await jobsSvc.readOne(logId, {
        fields: ['log_id', 'printer', 'payload', 'print_type', 'job_id'],
      });
    } catch (err) {
      // Il record non esiste più: non fare nulla (il lock non è stato acquisito)
      logger.warn(`[print-dispatcher] Job ${safeLog(logId)} non trovato: ${safeLog(err.message)}`);
      return;
    }

    // ── 3. Invio al print-server ─────────────────────────────────────────
    try {
      const printerUrl = await getPrinterUrl(job.printer, schema);
      await postWithRetry(printerUrl, job.payload);

      await jobsSvc.updateOne(logId, { status: 'done', error_message: null });
      logger.info(
        `[print-dispatcher] ✓ Job ${safeLog(job.job_id)} (${safeLog(job.print_type)}) → stampante "${safeLog(job.printer)}"`,
      );
    } catch (err) {
      const msg = safeLog(err.message ?? err);
      await jobsSvc.updateOne(logId, { status: 'error', error_message: msg }).catch(() => {});
      logger.error(
        `[print-dispatcher] ✗ Job ${safeLog(job.job_id ?? logId)} errore: ${msg}`,
      );
    }
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
  //  ≤ 59 s  → "*/N * * * * *"    (6 campi incl. secondi — node-cron)
  //  ≥ 60 s  → "*/M * * * *"      (5 campi, minuti — arrotondato al minuto più vicino; min 1)
  // Nota: per il fallback di polling, la granularità al minuto è sufficiente.
  const cronMinutes = Math.max(1, Math.round(POLL_SEC / 60));
  const cronExpr = POLL_SEC < 60
    ? `*/${POLL_SEC} * * * * *`
    : `*/${cronMinutes} * * * *`;

  schedule(cronExpr, async () => {
    let pendingJobs;
    try {
      const schema = await getSchema();
      const jobsSvc = new ItemsService('print_jobs', { database, schema });
      pendingJobs = await jobsSvc.readByQuery({
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
    `[print-dispatcher] Estensione caricata — polling ogni ${POLL_SEC}s, timeout HTTP ${TIMEOUT_MS}ms, max retry ${RETRY_MAX}`,
  );
};
