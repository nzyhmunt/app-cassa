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
 *  DIRECTUS_JOB_MAX_AGE_HOURS      — finestra temporale per il polling: ignora job più vecchi di N ore (default: 24)
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
 * Finestra temporale per il polling REST.
 * Il polling considera solo i job creati nelle ultime N ore per evitare di
 * riprocessare job rimasti in stato 'pending' da molto tempo (es. job bloccati
 * prima di un aggiornamento del server). Default: 24 ore.
 */
const JOB_MAX_AGE_HOURS     = Math.max(1,   envInt('DIRECTUS_JOB_MAX_AGE_HOURS',   24));

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
 * Usato dalla sottoscrizione WebSocket (nessuna finestra temporale —
 * gli eventi WS sono sempre real-time).
 * @returns {object}
 */
function buildJobFilter() {
  const statusFilter = { status: { _eq: 'pending' } };
  if (!DIRECTUS_VENUE) return statusFilter;
  const parsedVenue = parseInt(DIRECTUS_VENUE, 10);
  const venueValue  = isNaN(parsedVenue) ? DIRECTUS_VENUE : parsedVenue;
  return { _and: [statusFilter, { venue: { _eq: venueValue } }] };
}

/**
 * Costruisce il filtro Directus per il polling REST.
 * Include una finestra temporale (`date_created >= cutoff`) per evitare di
 * riprocessare job bloccati in stato 'pending' da più di JOB_MAX_AGE_HOURS ore.
 * @returns {object}
 */
function buildPollFilter() {
  const cutoff = new Date(Date.now() - JOB_MAX_AGE_HOURS * 3_600_000).toISOString();
  const conditions = [
    { status: { _eq: 'pending' } },
    { date_created: { _gte: cutoff } },
  ];
  if (DIRECTUS_VENUE) {
    const parsedVenue = parseInt(DIRECTUS_VENUE, 10);
    conditions.push({ venue: { _eq: isNaN(parsedVenue) ? DIRECTUS_VENUE : parsedVenue } });
  }
  return { _and: conditions };
}

/** Campi da richiedere per ogni job. */
const JOB_FIELDS = ['id', 'printer', 'print_type', 'payload', 'status', 'venue'];

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
 * Mappa un array di record Directus `printers` al formato atteso da printer.js.
 * Filtra le stampanti con `connection_type` = 'tcp' o 'file' (connessione diretta);
 * le stampanti con `connection_type` = 'http' vengono ignorate (usate da hook push/frontend).
 *
 * Funzione pura — nessun I/O, esportata per i test.
 *
 * @param {Array<object>} rawPrinters  Record Directus dalla collezione `printers`
 * @returns {Array<object>}            Lista nel formato accettato da `setPrinters()`
 */
function _mapDirectusPrinters(rawPrinters) {
  if (!Array.isArray(rawPrinters)) return [];
  return rawPrinters
    .map(p => ({
      ...p,
      connection_type: String(p && p.connection_type || '').toLowerCase().trim(),
    }))
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
}

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
  const printersFilter = { status: { _eq: 'published' } };
  if (DIRECTUS_VENUE) {
    // Normalize to integer if possible, like in buildJobFilter(), for compatibility
    // with integer-type venue fields in Directus.
    const parsedVenue = parseInt(DIRECTUS_VENUE, 10);
    printersFilter.venue = { _eq: isNaN(parsedVenue) ? DIRECTUS_VENUE : parsedVenue };
  }

  let rawPrinters;
  try {
    rawPrinters = await restClient.request(
      readItems('printers', {
        filter: printersFilter,
        fields: PRINTER_FIELDS,
      }),
    );
  } catch (err) {
    log.warn(
      `[directus-client] Impossibile leggere la collezione printers: ${safeLog(err instanceof Error ? err.message : String(err))}`,
    );
    return false;
  }

  if (!Array.isArray(rawPrinters)) return false;

  const connectable = _mapDirectusPrinters(rawPrinters);

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
 * Il primo refresh è ritardato di PRINTERS_INITIAL_DELAY_MS (5–15 s) per non
 * sovraccaricare il bootstrap iniziale (connessione WS + primo polling). I
 * refresh successivi avvengono ogni DIRECTUS_PRINTERS_REFRESH_SEC secondi.
 *
 * @param {object} restClient
 * @param {object} log
 */
function startPrintersRefresh(restClient, log) {
  async function tick() {
    await fetchAndApplyPrinters(restClient, log).catch((err) => {
      log.warn(`[directus-client] Errore refresh stampanti: ${safeLog(err instanceof Error ? err.message : String(err))}`);
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

// ── Deduplicazione in-process ─────────────────────────────────────────────────

/**
 * Set degli `id` (PK UUID) attualmente in elaborazione in questo processo.
 *
 * Previene la doppia stampa quando WebSocket e REST polling ricevono lo stesso
 * job quasi contemporaneamente: il secondo chiamante trova l'id già
 * presente nel Set e ritorna senza inviare nulla alla stampante.
 *
 * Il Set è a livello di processo (singola istanza); per ambienti multi-processo
 * la deduplicazione definitiva resta il compare-and-swap su Directus.
 *
 * Esportato per i test.
 * @type {Set<string>}
 */
const _inFlightJobs = new Set();

/**
 * Tenta di reclamare il job impostando status='printing'.
 *
 * Nota: tramite REST Directus non è possibile fare un UPDATE atomico con
 * condizione WHERE (come con SQL diretto). Questo approccio è sicuro per
 * deployment a istanza singola (tipico per print-server locali). Per ambienti
 * multi-istanza, usare l'estensione hook Directus che usa database direttamente.
 *
 * @param {object} restClient
 * @param {string} id - PK UUID del job (print_jobs.id)
 * @param {object} log
 * @returns {Promise<boolean>} true se il claim è andato a buon fine
 */
async function tryClaimJob(restClient, id, log) {
  try {
    // Re-legge il job per verificare che sia ancora pending (riduce race condition)
    const current = await restClient.request(
      readItem('print_jobs', id, { fields: ['status'] }),
    );
    if (current?.status !== 'pending') {
      log.info(
        `[directus-client] Job ${safeLog(id)} già in stato "${safeLog(current?.status)}" — skip`,
      );
      return false;
    }
    // Aggiorna a 'printing'
    await restClient.request(updateItem('print_jobs', id, { status: 'printing' }));
    return true;
  } catch (err) {
    log.warn(`[directus-client] Impossibile reclamare job ${safeLog(id)}: ${safeLog(err instanceof Error ? err.message : String(err))}`);
    return false;
  }
}

/**
 * Processa un singolo job di stampa:
 *   1. Deduplicazione in-process (Set _inFlightJobs)
 *   2. Tenta di reclamare il job (pending → printing)
 *   3. Costruisce il buffer ESC/POS dal payload
 *   4. Invia alla stampante fisica locale
 *   5. Aggiorna lo stato su Directus (done | error)
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
  const { id, printer: printerId, print_type, payload } = job;
  const safeId = safeLog(id);

  // ── 1. Deduplicazione in-process ─────────────────────────────────────────
  // Evita che WS e polling elaborino lo stesso job in parallelo all'interno
  // dello stesso processo (es. job arriva via WS appena prima del ciclo di
  // polling che rileva lo stesso job ancora con status='pending' su Directus).
  if (_inFlightJobs.has(id)) {
    log.info(
      `[directus-client] Job ${safeId} già in elaborazione in-process — skip`,
    );
    return;
  }
  _inFlightJobs.add(id);

  try {
    // ── 2. Reclama il job ───────────────────────────────────────────────────
    const claimed = await tryClaimJob(restClient, id, log);
    if (!claimed) return;

    // ── 3. Dispatch con retry ───────────────────────────────────────────────
    let lastErr;
    for (let attempt = 0; attempt <= RETRY_MAX; attempt++) {
      if (attempt > 0) await sleep(RETRY_DELAY_MS);
      try {
        // Normalizza payload: deve essere un plain object (non array, non stringa).
        // Forza sempre printType dal campo Directus print_type per evitare inconsistenze.
        const safePayload =
          payload && typeof payload === 'object' && !Array.isArray(payload)
            ? payload
            : {};
        const buf = buildEscPosBuffer({ ...safePayload, printType: print_type });

        // Risolve il printer ID usando come fonte canonica job.printer (FK).
        // Usa payload.printerId solo come fallback se job.printer è mancante/null.
        const resolvedPrinterId = printerId ?? safePayload.printerId;

        // Invia alla stampante fisica tramite la coda per-printer
        await printBuffer(buf, resolvedPrinterId);

        // ── 4. Aggiorna stato a done ──────────────────────────────────────
        await restClient.request(
          updateItem('print_jobs', id, { status: 'done', error_message: null }),
        );
        log.info(
          `[directus-client] ✓ Job ${safeId} (${safeLog(print_type)}) → stampante "${safeLog(resolvedPrinterId)}"`,
        );
        return; // successo
      } catch (err) {
        lastErr = err;
        // Gli errori permanenti devono essere marcati esplicitamente da chi li genera/intercetta
        if (err && err.permanent === true) break;
      }
    }

    // ── 5. Aggiorna stato a error ─────────────────────────────────────────
    const errMsg = safeLog(lastErr?.message ?? String(lastErr));
    try {
      await restClient.request(
        updateItem('print_jobs', id, { status: 'error', error_message: errMsg }),
      );
    } catch (updateErr) {
      const updateErrMsg = safeLog(
        updateErr instanceof Error ? updateErr.message : String(updateErr),
      );
      log.warn(`[directus-client] Impossibile aggiornare stato error per job ${safeId}: ${updateErrMsg}`);
    }
    log.error(`[directus-client] ✗ Job ${safeId} (${safeLog(print_type)}) errore: ${errMsg}`);
  } finally {
    // Rimuove sempre il job dal Set al termine (successo o errore)
    _inFlightJobs.delete(id);
  }
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
        filter: buildPollFilter(),
        fields: JOB_FIELDS,
        sort:   ['job_timestamp'],
        limit:  100,
      }),
    );
  } catch (err) {
    log.error(`[directus-client] Errore polling REST: ${safeLog(err instanceof Error ? err.message : String(err))}`);
    return;
  }

  if (!Array.isArray(jobs) || jobs.length === 0) return;

  log.info(`[directus-client] Polling: trovati ${jobs.length} job(s) pending`);

  for (const job of jobs) {
    try {
      await processJob(restClient, job, log);
    } catch (err) {
      log.error(
        `[directus-client] Errore processamento job ${safeLog(job.id)}: ${safeLog(err instanceof Error ? err.message : String(err))}`,
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
    if (event.event === 'create') {
      // Directus realtime può restituire `event.data` come array (batch) o come
      // singolo oggetto (un solo item creato). Normalizziamo sempre ad array.
      const jobs = Array.isArray(event.data)
        ? event.data
        : event.data && typeof event.data === 'object'
          ? [event.data]
          : [];
      for (const job of jobs) {
        // Fire-and-forget: la coda per-printer serializza automaticamente
        processJob(restClient, job, log).catch((err) => {
          log.error(
            `[directus-client] Errore WS job ${safeLog(job.id)}: ${safeLog(err instanceof Error ? err.message : String(err))}`,
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
        `[directus-client] WebSocket interrotto: ${safeLog(err instanceof Error ? err.message : String(err))} — riavvio tra ${waitMs}ms (tentativo ${attempt})`,
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
      readItems('print_jobs', { fields: ['id'], limit: 1 }),
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
    log.warn(`[directus-client] Errore caricamento stampanti da Directus: ${safeLog(err instanceof Error ? err.message : String(err))}`);
  });

  // ── 3. Avvia polling REST (sempre attivo, non bloccante) ──────────────────
  startPolling(restClient, log);

  // ── 4. Avvia WebSocket subscription (non bloccante, si riavvia automaticamente)
  startWebSocketLoop(wsClient, restClient, log).catch((err) => {
    // Non dovrebbe mai arrivare qui (il loop è infinito), ma logga per sicurezza
    log.error(`[directus-client] Errore critico loop WebSocket: ${safeLog(err instanceof Error ? err.message : String(err))}`);
  });

  // ── 5. Refresh periodico della lista stampanti ────────────────────────────
  startPrintersRefresh(restClient, log);
}

module.exports = {
  start,
  // Esportati per i test
  _mapDirectusPrinters,
  _inFlightJobs,
};

