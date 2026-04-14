'use strict';

/**
 * @file directus-client.js
 * @description Directus Pull Mode — ESC/POS Print Server
 *
 * Quando le variabili d'ambiente DIRECTUS_URL e DIRECTUS_TOKEN sono impostate,
 * questo modulo connette il print-server direttamente a Directus e legge
 * autonomamente i lavori di stampa dalla collezione `print_jobs`, invocando
 * le stampanti fisiche locali senza che il browser faccia da intermediario.
 *
 * ── Modalità operative ────────────────────────────────────────────────────────
 *
 *  1. WebSocket subscription (real-time, primaria)
 *     Si sottoscrive agli eventi `create` sulla collezione `print_jobs` filtrati
 *     per status='pending'. Ogni nuovo job viene processato istantaneamente,
 *     tipicamente entro centesimi di secondo dalla sua creazione su Directus.
 *     Utilizza la funzione `realtime()` dell'SDK Directus con riconnessione
 *     automatica configurabile.
 *     Richiede Node.js ≥ 22 (WebSocket nativo in globalThis, usato dall'SDK).
 *
 *  2. REST polling (fallback continuo)
 *     Ogni DIRECTUS_POLL_SEC secondi esegue una query REST per tutti i job
 *     pending non ancora processati. Gestisce i casi in cui:
 *       - Il WebSocket era disconnesso durante la creazione del job
 *       - Il server è ripartito dopo un crash
 *       - La sottoscrizione WS ha saltato eventi per un glitch di rete
 *     Il polling è sempre attivo, anche quando il WebSocket funziona correttamente.
 *
 * ── Configurazione stampanti da Directus ─────────────────────────────────────
 *
 *  Quando Directus è disponibile, la lista delle stampanti viene letta dalla
 *  collezione `printers`. Questa diventa la fonte unica di verità, sostituendo
 *  printers.config.js e le variabili d'ambiente PRINTER_<N>_*.
 *
 *  La collezione `printers` deve avere i campi di connessione:
 *    connection_type  — 'tcp' | 'file' | 'http'
 *    tcp_host         — IP/hostname (per type='tcp')
 *    tcp_port         — porta TCP (default 9100)
 *    tcp_timeout      — timeout ms (default 5000)
 *    file_device      — percorso device (per type='file', default /dev/usb/lp0)
 *
 *  Se nessuna stampante ha connection_type='tcp' o 'file', il sistema ricade
 *  sulla configurazione locale (printers.config.js o PRINTER_<N>_*).
 *
 *  La lista stampanti viene aggiornata ogni DIRECTUS_PRINTERS_REFRESH_SEC sec.
 *
 * ── Ciclo di vita di un job ───────────────────────────────────────────────────
 *
 *  pending → printing → done
 *                    ↘ error (con error_message)
 *
 * ── Variabili d'ambiente ──────────────────────────────────────────────────────
 *
 *  DIRECTUS_URL                    — URL base di Directus (es. http://directus:8055)
 *  DIRECTUS_TOKEN                  — Static token con permessi su print_jobs e printers
 *  DIRECTUS_VENUE_ID               — (opzionale) filtra i job per venue (integer ID)
 *  DIRECTUS_POLL_SEC               — intervallo polling REST in secondi (default: 60)
 *  DIRECTUS_WS_RETRIES             — tentativi di riconnessione WS (default: 100)
 *  DIRECTUS_WS_RETRY_DELAY         — attesa tra riconnessioni WS in ms (default: 3000)
 *  DIRECTUS_RETRY_MAX              — tentativi per job in caso di errore transitorio (default: 3)
 *  DIRECTUS_RETRY_DELAY_MS         — attesa tra tentativi per job in ms (default: 2000)
 *  DIRECTUS_PRINTERS_REFRESH_SEC   — intervallo di refresh della lista stampanti (default: 300)
 */

const {
  createDirectus,
  staticToken,
  rest,
  realtime,
  readItem,
  readItems,
  updateItem,
} = require('@directus/sdk');

const { printBuffer, setPrinters }  = require('./printer.js');
const { buildEscPosBuffer }          = require('./build-buffer.js');

// ── Configurazione ────────────────────────────────────────────────────────────

/**
 * Legge una variabile d'ambiente come intero.
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? fallback : n;
}

const DIRECTUS_URL     = process.env.DIRECTUS_URL     || '';
const DIRECTUS_TOKEN   = process.env.DIRECTUS_TOKEN   || '';
/** Filtra i job per venue (opzionale — null = tutti i venue). */
const DIRECTUS_VENUE   = process.env.DIRECTUS_VENUE_ID || null;

const POLL_SEC              = Math.max(5,   envInt('DIRECTUS_POLL_SEC',             60));
const WS_RETRIES            = Math.max(1,   envInt('DIRECTUS_WS_RETRIES',          100));
const WS_RETRY_DELAY        = Math.max(500, envInt('DIRECTUS_WS_RETRY_DELAY',      3000));
const RETRY_MAX             = Math.max(0,   envInt('DIRECTUS_RETRY_MAX',              3));
const RETRY_DELAY_MS        = Math.max(0,   envInt('DIRECTUS_RETRY_DELAY_MS',       2000));
const PRINTERS_REFRESH_SEC  = Math.max(30,  envInt('DIRECTUS_PRINTERS_REFRESH_SEC', 300));

/**
 * Ritardo iniziale (ms) prima del primo refresh stampanti.
 * Lascia tempo al server per completare il bootstrap (connessione WS, primo polling)
 * prima di effettuare una chiamata REST aggiuntiva.
 */
const PRINTERS_INITIAL_DELAY_MS = PRINTERS_REFRESH_SEC >= 60 ? 15_000 : 5_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Filtro base per print_jobs ────────────────────────────────────────────────

/**
 * Costruisce il filtro Directus per i job pending.
 * Se DIRECTUS_VENUE_ID è impostato, aggiunge il filtro venue.
 * @returns {object}
 */
function buildJobFilter() {
  const statusFilter = { status: { _eq: 'pending' } };
  if (!DIRECTUS_VENUE) return statusFilter;
  const parsedVenue = parseInt(DIRECTUS_VENUE, 10);
  const venueValue  = isNaN(parsedVenue) ? DIRECTUS_VENUE : parsedVenue;
  return { _and: [statusFilter, { venue: { _eq: venueValue } }] };
}

/** Campi da richiedere per ogni job. */
const JOB_FIELDS = ['log_id', 'job_id', 'printer', 'print_type', 'payload', 'status', 'venue'];

// ── Stampanti da Directus ─────────────────────────────────────────────────────

/**
 * Campi della collezione `printers` necessari per la connessione fisica.
 * La collection deve includere i campi di connessione diretta (aggiunti rispetto
 * allo schema base che aveva solo `id`, `name`, `url`).
 */
const PRINTER_FIELDS = [
  'id', 'name', 'status',
  'connection_type',  // 'tcp' | 'file' | 'http'
  'tcp_host',         // IP/hostname per connessioni TCP
  'tcp_port',         // porta TCP (default 9100)
  'tcp_timeout',      // timeout ms (default 5000)
  'file_device',      // percorso device per connessioni file (default /dev/usb/lp0)
];

/**
 * Legge le stampanti dalla collezione `printers` di Directus e applica la
 * configurazione al print-server tramite `setPrinters()`.
 *
 * Vengono incluse solo le stampanti con `connection_type` = 'tcp' o 'file'
 * (quelle con connessione diretta gestita dal print-server). Le stampanti
 * con `connection_type` = 'http' vengono usate dall'hook push e dal frontend.
 *
 * Se nessuna stampante con connessione diretta è configurata in Directus,
 * la configurazione locale (printers.config.js o PRINTER_<N>_*) viene mantenuta.
 *
 * @param {object} restClient
 * @param {object} log
 * @returns {Promise<boolean>} true se la configurazione è stata aggiornata
 */
async function fetchAndApplyPrinters(restClient, log) {
  let rawPrinters;
  try {
    rawPrinters = await restClient.request(
      readItems('printers', {
        filter: { status: { _eq: 'published' } },
        fields: PRINTER_FIELDS,
      }),
    );
  } catch (err) {
    log.warn(`[directus-client] Impossibile leggere la collezione printers: ${safeLog(err.message)}`);
    return false;
  }

  if (!Array.isArray(rawPrinters)) return false;

  // Mappa i record Directus al formato atteso da printer.js
  const connectable = rawPrinters
    .filter(p => p.connection_type === 'tcp' || p.connection_type === 'file')
    .map(p => {
      const entry = { id: p.id, name: p.name || p.id, type: p.connection_type };
      if (p.connection_type === 'file') {
        entry.device = p.file_device || '/dev/usb/lp0';
      } else {
        // type === 'tcp'
        entry.host    = p.tcp_host    || '127.0.0.1';
        entry.port    = p.tcp_port    || 9100;
        entry.timeout = p.tcp_timeout || 5000;
      }
      return entry;
    });

  if (connectable.length === 0) {
    log.info(
      '[directus-client] Nessuna stampante con connessione diretta (tcp/file) trovata in Directus ' +
      '— uso configurazione locale (printers.config.js o PRINTER_<N>_*)',
    );
    return false;
  }

  setPrinters(connectable);
  log.info(
    `[directus-client] Stampanti caricate da Directus (${connectable.length}): ` +
    connectable.map(p => `[${p.id}] ${p.name} (${p.type})`).join(', '),
  );
  return true;
}

/**
 * Avvia il loop di refresh periodico della lista stampanti da Directus.
 * Il primo refresh avviene subito (al momento dello start, prima del polling).
 * I refresh successivi ogni DIRECTUS_PRINTERS_REFRESH_SEC secondi.
 *
 * @param {object} restClient
 * @param {object} log
 */
function startPrintersRefresh(restClient, log) {
  async function tick() {
    await fetchAndApplyPrinters(restClient, log).catch((err) => {
      log.warn(`[directus-client] Errore refresh stampanti: ${safeLog(err.message)}`);
    });
    setTimeout(tick, PRINTERS_REFRESH_SEC * 1000);
  }
  // Primo refresh: ritarda leggermente per non sovraccaricare il bootstrap iniziale
  setTimeout(tick, PRINTERS_INITIAL_DELAY_MS);
  log.info(`[directus-client] Refresh stampanti programmato ogni ${PRINTERS_REFRESH_SEC}s`);
}

// ── Client factory ────────────────────────────────────────────────────────────

/**
 * Crea il client REST Directus (senza WebSocket).
 * Usato per le operazioni di lettura/scrittura durante il processamento dei job.
 * @param {string} url
 * @param {string} token
 * @returns {DirectusClient}
 */
function createRestClient(url, token) {
  return createDirectus(url)
    .with(staticToken(token))
    .with(rest());
}

/**
 * Crea il client WebSocket Directus.
 *
 * Richiede Node.js ≥ 22, che espone `globalThis.WebSocket` nativamente.
 * L'SDK Directus (`realtime()`) utilizza automaticamente il WebSocket nativo
 * quando non viene passato un'implementazione personalizzata tramite `globals`.
 *
 * @param {string} url
 * @param {string} token
 * @returns {DirectusClient & WebSocketClient}
 */
function createWsClient(url, token) {
  return createDirectus(url)
    .with(staticToken(token))
    .with(rest())
    .with(realtime({
      reconnect: {
        retries: WS_RETRIES,
        delay:   WS_RETRY_DELAY,
      },
    }));
}

// ── Gestione job ──────────────────────────────────────────────────────────────

/**
 * Tenta di reclamare il job impostando status='printing'.
 *
 * Nota: tramite REST Directus non è possibile fare un UPDATE atomico con
 * condizione WHERE (come con SQL diretto). Questo approccio è sicuro per
 * deployment a istanza singola (tipico per print-server locali). Per ambienti
 * multi-istanza, usare l'estensione hook Directus che usa database direttamente.
 *
 * @param {object} restClient
 * @param {string} logId
 * @param {object} log
 * @returns {Promise<boolean>} true se il claim è andato a buon fine
 */
async function tryClaimJob(restClient, logId, log) {
  try {
    // Re-legge il job per verificare che sia ancora pending (riduce race condition)
    const current = await restClient.request(
      readItem('print_jobs', logId, { fields: ['status'] }),
    );
    if (current?.status !== 'pending') {
      log.info(
        `[directus-client] Job ${safeLog(logId)} già in stato "${safeLog(current?.status)}" — skip`,
      );
      return false;
    }
    // Aggiorna a 'printing'
    await restClient.request(updateItem('print_jobs', logId, { status: 'printing' }));
    return true;
  } catch (err) {
    log.warn(`[directus-client] Impossibile reclamare job ${safeLog(logId)}: ${safeLog(err.message)}`);
    return false;
  }
}

/**
 * Processa un singolo job di stampa:
 *   1. Tenta di reclamare il job (pending → printing)
 *   2. Costruisce il buffer ESC/POS dal payload
 *   3. Invia alla stampante fisica locale
 *   4. Aggiorna lo stato su Directus (done | error)
 *
 * In caso di errore transitorio (rete, stampante), viene ritentato fino a
 * DIRECTUS_RETRY_MAX volte. Gli errori permanenti (payload non valido) non
 * vengono ritentati.
 *
 * @param {object} restClient   Client REST per aggiornare lo stato
 * @param {object} job          Record print_jobs letto da Directus
 * @param {object} log          Logger
 */
async function processJob(restClient, job, log) {
  const { log_id, job_id, printer: printerId, print_type, payload } = job;
  const safeId    = safeLog(log_id);
  const safeJobId = safeLog(job_id ?? '?');

  // ── 1. Reclama il job ─────────────────────────────────────────────────────
  const claimed = await tryClaimJob(restClient, log_id, log);
  if (!claimed) return;

  // ── 2. Dispatch con retry ─────────────────────────────────────────────────
  let lastErr;
  for (let attempt = 0; attempt <= RETRY_MAX; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS);
    try {
      // Costruisce il Buffer ESC/POS dal payload del job.
      // Unisce print_type (campo Directus snake_case) come printType (camelCase)
      // richiesto dal formatter, preservando tutti i campi del payload.
      const buf = buildEscPosBuffer({ printType: print_type, ...payload });

      // Risolve il printer ID: preferisce payload.printerId (campo inviato dal frontend),
      // usa job.printer (FK) come fallback.
      const resolvedPrinterId = (payload && payload.printerId) ? payload.printerId : printerId;

      // Invia alla stampante fisica tramite la coda per-printer
      await printBuffer(buf, resolvedPrinterId);

      // ── 3. Aggiorna stato a done ─────────────────────────────────────────
      await restClient.request(
        updateItem('print_jobs', log_id, { status: 'done', error_message: null }),
      );
      log.info(
        `[directus-client] ✓ Job ${safeJobId} (${safeLog(print_type)}) → stampante "${safeLog(resolvedPrinterId)}"`,
      );
      return; // successo
    } catch (err) {
      lastErr = err;
      // Errori di formato (payload non valido) sono permanenti — non ritentare
      if (err.message && err.message.includes('non supportato')) break;
    }
  }

  // ── 4. Aggiorna stato a error ─────────────────────────────────────────────
  const errMsg = safeLog(lastErr?.message ?? String(lastErr));
  try {
    await restClient.request(
      updateItem('print_jobs', log_id, { status: 'error', error_message: errMsg }),
    );
  } catch (updateErr) {
    log.warn(`[directus-client] Impossibile aggiornare stato error per job ${safeId}: ${safeLog(updateErr.message)}`);
  }
  log.error(`[directus-client] ✗ Job ${safeJobId} (${safeLog(print_type)}) errore: ${errMsg}`);
}

// ── REST polling ──────────────────────────────────────────────────────────────

/**
 * Esegue un ciclo di polling REST: legge tutti i job pending e li processa.
 * @param {object} restClient
 * @param {object} log
 */
async function pollPendingJobs(restClient, log) {
  let jobs;
  try {
    jobs = await restClient.request(
      readItems('print_jobs', {
        filter: buildJobFilter(),
        fields: JOB_FIELDS,
        sort:   ['job_timestamp'],
        limit:  100,
      }),
    );
  } catch (err) {
    log.error(`[directus-client] Errore polling REST: ${safeLog(err.message)}`);
    return;
  }

  if (!Array.isArray(jobs) || jobs.length === 0) return;

  log.info(`[directus-client] Polling: trovati ${jobs.length} job(s) pending`);

  for (const job of jobs) {
    try {
      await processJob(restClient, job, log);
    } catch (err) {
      log.error(
        `[directus-client] Errore processamento job ${safeLog(job.log_id)}: ${safeLog(err.message)}`,
      );
    }
  }
}

/**
 * Avvia il loop di polling REST (esegue ogni POLL_SEC secondi).
 * Il polling è sempre attivo, anche quando il WebSocket funziona correttamente.
 * Primo ciclo dopo 5 secondi (per dare tempo al WS di connettersi prima).
 * @param {object} restClient
 * @param {object} log
 */
function startPolling(restClient, log) {
  async function tick() {
    await pollPendingJobs(restClient, log);
    setTimeout(tick, POLL_SEC * 1000);
  }
  setTimeout(tick, 5000);
  log.info(`[directus-client] Polling REST avviato (ogni ${POLL_SEC}s)`);
}

// ── WebSocket subscription ────────────────────────────────────────────────────

/**
 * Avvia la sottoscrizione WebSocket e processa gli eventi in arrivo.
 * In caso di disconnessione, il loop esterno (startWebSocketLoop) si occupa
 * del riavvio. L'SDK gestisce la riconnessione interna; questo loop è un
 * ulteriore livello di resilienza in caso di errori fatali.
 *
 * Utilizza il WebSocket nativo di Node.js 22+ tramite l'SDK Directus
 * (`realtime()`). Non è necessario alcun pacchetto aggiuntivo.
 *
 * @param {object} wsClient    Client con realtime() abilitato
 * @param {object} restClient  Client REST per aggiornare lo stato dei job
 * @param {object} log
 */
async function runWebSocket(wsClient, restClient, log) {
  await wsClient.connect();
  log.info('[directus-client] WebSocket connesso a Directus');

  const { subscription } = await wsClient.subscribe('print_jobs', {
    event: 'create',
    query: {
      filter: buildJobFilter(),
      fields: JOB_FIELDS,
    },
  });

  log.info('[directus-client] Sottoscrizione WebSocket attiva su print_jobs (event: create)');

  for await (const event of subscription) {
    if (event.event === 'create' && Array.isArray(event.data)) {
      for (const job of event.data) {
        // Fire-and-forget: la coda per-printer serializza automaticamente
        processJob(restClient, job, log).catch((err) => {
          log.error(
            `[directus-client] Errore WS job ${safeLog(job.log_id)}: ${safeLog(err.message)}`,
          );
        });
      }
    } else if (event.event === 'error') {
      log.warn(
        `[directus-client] Errore sottoscrizione WS: ${safeLog(event.error?.message ?? JSON.stringify(event.error))}`,
      );
    }
  }
  // Il generatore asincrono si è esaurito (WebSocket chiuso)
  throw new Error('WebSocket subscription terminata');
}

/**
 * Avvia il loop WebSocket con riavvio automatico in caso di errore fatale.
 * Il backoff è lineare (min 2s, max 60s) per non sovraccaricare Directus.
 *
 * @param {object} wsClient
 * @param {object} restClient
 * @param {object} log
 */
async function startWebSocketLoop(wsClient, restClient, log) {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      attempt = 0;
      await runWebSocket(wsClient, restClient, log);
    } catch (err) {
      attempt++;
      const waitMs = Math.min(60000, 2000 * attempt);
      log.warn(
        `[directus-client] WebSocket interrotto: ${safeLog(err.message)} — riavvio tra ${waitMs}ms (tentativo ${attempt})`,
      );
      await sleep(waitMs);
    }
  }
}

// ── Verifica connessione ──────────────────────────────────────────────────────

/**
 * Verifica che le credenziali Directus siano valide con una chiamata REST leggera.
 * @param {object} restClient
 * @returns {Promise<boolean>}
 */
async function verifyConnection(restClient) {
  try {
    // Legge un solo job per verificare accesso alla collezione
    await restClient.request(
      readItems('print_jobs', { fields: ['log_id'], limit: 1 }),
    );
    return true;
  } catch (_err) {
    return false;
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Avvia la modalità Directus Pull.
 * Chiamato da server.js in fase di startup se DIRECTUS_URL e DIRECTUS_TOKEN
 * sono impostati.
 *
 * Ordine di avvio:
 *   1. Verifica connessione REST
 *   2. Carica stampanti da Directus (sovrascrive printers.config.js / env vars
 *      se la collezione `printers` ha stampanti con connessione diretta tcp/file)
 *   3. Avvia loop REST polling (fallback, sempre attivo)
 *   4. Avvia loop WebSocket subscription (real-time)
 *   5. Avvia refresh periodico delle stampanti
 *
 * @param {object} log   Logger con metodi info, warn, error (es. console)
 * @returns {Promise<void>}
 */
async function start(log) {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
    log.info('[directus-client] DIRECTUS_URL o DIRECTUS_TOKEN non impostati — modalità pull disabilitata');
    return;
  }

  log.info(`[directus-client] Avvio modalità pull Directus → ${safeLog(DIRECTUS_URL)}`);
  if (DIRECTUS_VENUE) {
    log.info(`[directus-client] Filtro venue attivo: venue_id = ${safeLog(DIRECTUS_VENUE)}`);
  }
  log.info(
    `[directus-client] Config: polling ogni ${POLL_SEC}s, retry max ${RETRY_MAX}, retry delay ${RETRY_DELAY_MS}ms`,
  );

  const restClient = createRestClient(DIRECTUS_URL, DIRECTUS_TOKEN);
  const wsClient   = createWsClient(DIRECTUS_URL, DIRECTUS_TOKEN);

  // ── 1. Verifica connessione iniziale ──────────────────────────────────────
  const ok = await verifyConnection(restClient);
  if (!ok) {
    log.warn(
      '[directus-client] Verifica connessione Directus fallita — ' +
      'controlla DIRECTUS_URL, DIRECTUS_TOKEN e i permessi sulla collezione print_jobs. ' +
      'Il polling continuerà a tentare la connessione.',
    );
  } else {
    log.info('[directus-client] Connessione Directus verificata ✓');
  }

  // ── 2. Carica stampanti da Directus ───────────────────────────────────────
  // Quando disponibili, le stampanti da Directus hanno la precedenza su
  // printers.config.js e le variabili PRINTER_<N>_*. Questo rende Directus
  // la fonte unica di verità per tutta la configurazione.
  await fetchAndApplyPrinters(restClient, log).catch((err) => {
    log.warn(`[directus-client] Errore caricamento stampanti da Directus: ${safeLog(err.message)}`);
  });

  // ── 3. Avvia polling REST (sempre attivo, non bloccante) ──────────────────
  startPolling(restClient, log);

  // ── 4. Avvia WebSocket subscription (non bloccante, si riavvia automaticamente)
  startWebSocketLoop(wsClient, restClient, log).catch((err) => {
    // Non dovrebbe mai arrivare qui (il loop è infinito), ma logga per sicurezza
    log.error(`[directus-client] Errore critico loop WebSocket: ${safeLog(err.message)}`);
  });

  // ── 5. Refresh periodico della lista stampanti ────────────────────────────
  startPrintersRefresh(restClient, log);
}

module.exports = { start };

