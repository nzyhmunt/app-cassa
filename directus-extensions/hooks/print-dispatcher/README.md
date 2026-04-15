# Print Dispatcher — Directus Hook Extension (stampa diretta)

Estensione Directus di tipo **hook** che legge le collezioni `printers` e `print_jobs`
e invia automaticamente i lavori di stampa **direttamente alla stampante fisica** via TCP o
dispositivo file. Non richiede servizi Node.js / Docker aggiuntivi.

> **Formatter condivisi:** la logica ESC/POS (formattazione comande, preconti, spostamenti
> tavolo) risiede in `print-server/formatters/*.js` — fonte unica di verità usata sia da
> questa estensione (bundle Rollup) che dal print-server Node.js. Per modificare un
> formatter aggiorna il file in `print-server/formatters/` e riesegui `npm run build` qui.

---

## Come funziona

```
Frontend → sync → print_jobs (status: pending)
                         │
                  [hook items.create]
                  [schedule polling]
                         │
             legge printers (connection_type,
                   tcp_host, tcp_port, ...)
                         │
             buildEscPosBuffer (ESC/POS)
              ← logica da print-server/formatters/
                         │
          TCP socket / file device  ←── stampante fisica
                         │
           status: done / error
```

1. L'app frontend crea un record in `print_jobs` con `status: 'pending'` (via sync offline-first).
2. L'estensione intercetta l'evento `items.create` su `print_jobs` e avvia immediatamente il dispatch.
3. Legge la configurazione di connessione dalla collezione `printers`
   (`connection_type`, `tcp_host`, `tcp_port`, `tcp_timeout`, `file_device`).
4. Genera il buffer ESC/POS appropriato (comanda, preconto, spostamento tavolo).
5. Invia il buffer **direttamente** alla stampante fisica via TCP o file di dispositivo.
6. Aggiorna `status` a `done` (successo) o `error` (con `error_message`).
7. Uno scheduler di fallback (ogni minuto, configurabile) recupera eventuali job rimasti in stato
   `pending` (es. Directus era in restart quando il job è arrivato).

### Tipi di connessione supportati

| `connection_type` | Descrizione | Campi richiesti |
|---|---|---|
| `tcp` | Connessione TCP diretta (porta ESC/POS) | `tcp_host`, `tcp_port`, `tcp_timeout` |
| `file` | Scrittura su dispositivo USB/seriale | `file_device` |
| `http` | ❌ Non supportato in modalità diretta | *(richiede print-server esterno)* |

### Blocco ottimistico

Il passaggio `pending → printing` viene eseguito con un `UPDATE WHERE status='pending'` atomico,
garantendo che job concorrenti non vengano inviati due volte anche in caso di race condition.

---

## Prerequisiti

- **Directus** ≥ 10.0.0 (processo Directus **sulla stessa rete** delle stampanti)
- **Node.js** ≥ 18 (già incluso nell'ambiente Directus)
- Le stampanti fisiche devono essere raggiungibili via **TCP** (porta 9100 di default) o
  come **dispositivo file** (`/dev/usb/lp0` o simile) dal server Directus
- Le collezioni `printers` e `print_jobs` create su Directus (vedi `DATABASE_SCHEMA.md`)

---

## Installazione

### 1. Build del bundle (prima di deployare)

Il bundle pre-compilato (`dist/index.js`) è già incluso nel repository.
Se hai modificato i formatter o il codice sorgente, ricompila:

```bash
cd directus-extensions/hooks/print-dispatcher
npm install
npm run build
```

> Il comando bundla `src/index.js` e la logica formatter da `print-server/formatters/`
> in un unico file `dist/index.js` autocontenuto (include `@point-of-sale/receipt-printer-encoder`).

### 2. Copia nella directory extensions di Directus

```bash
# Opzione A — copia dell'intera cartella
cp -r directus-extensions/hooks/print-dispatcher \
      /path/to/directus/extensions/hooks/

# Opzione B — solo i file essenziali (dist/ contiene tutto il codice necessario)
mkdir -p /path/to/directus/extensions/hooks/print-dispatcher
cp directus-extensions/hooks/print-dispatcher/dist/index.js \
   /path/to/directus/extensions/hooks/print-dispatcher/index.js
cp directus-extensions/hooks/print-dispatcher/package.json \
   /path/to/directus/extensions/hooks/print-dispatcher/
```

Poi riavvia Directus.

### Con Docker Compose

```yaml
services:
  directus:
    image: directus/directus:11
    volumes:
      # Monta il bundle pre-compilato (no node_modules richiesti a runtime)
      - ./directus-extensions/hooks/print-dispatcher:/directus/extensions/hooks/print-dispatcher:ro
    environment:
      PRINT_DISPATCHER_POLL_SEC: "60"
      PRINT_DISPATCHER_RETRY_MAX: "3"
```

> **Nota Docker**: il bundle `dist/index.js` è auto-contenuto — nessun `npm install`
> richiesto a runtime. Ricostruisci il bundle in locale (`npm run build`) e committalo
> prima di deployare il container.

---

## Configurazione

Tutte le impostazioni passano tramite **variabili d'ambiente** di Directus
(le stesse lette da `process.env` o dal file `.env` di Directus):

| Variabile | Default | Descrizione |
|---|---|---|
| `PRINT_DISPATCHER_POLL_SEC` | `60` | Intervallo di polling per job pending rimasti indietro (secondi). |
| `PRINT_DISPATCHER_RETRY_MAX` | `3` | Numero massimo di tentativi per errori transitori (TCP timeout, file I/O). |
| `PRINT_DISPATCHER_RETRY_DELAY_MS` | `2000` | Attesa tra un tentativo e il successivo (ms). |

Copia `.env.example` e aggiungilo al file `.env` di Directus.

### Configurazione stampanti in Directus

Le stampanti si configurano direttamente nella collezione **`printers`** di Directus:

| Campo | Tipo | Default | Descrizione |
|---|---|---|---|
| `id` | `varchar(40)` | — | Chiave primaria |
| `name` | `varchar(80)` | — | Nome visualizzato |
| `connection_type` | `string` | *(richiesto)* | Deve essere `tcp` o `file`; il valore `http` (default Directus) non è supportato in modalità diretta |
| `tcp_host` | `string` | `127.0.0.1` | *(tcp)* IP/hostname della stampante |
| `tcp_port` | `integer` | `9100` | *(tcp)* Porta ESC/POS |
| `tcp_timeout` | `integer` | `5000` | *(tcp)* Timeout connessione in ms |
| `file_device` | `string` | `/dev/usb/lp0` | *(file)* Percorso dispositivo USB |

---

## Schema Directus richiesto

### `print_jobs`

| Campo | Tipo | Note |
|---|---|---|
| `log_id` | `varchar(40)` | Chiave primaria |
| `printer` | `varchar(40)` | FK → `printers.id` |
| `print_type` | `varchar` | `order` \| `table_move` \| `pre_bill` |
| `status` | `varchar` | `pending` \| `printing` \| `done` \| `error` |
| `error_message` | `text` | Messaggio di errore (solo se `status='error'`) |
| `payload` | `jsonb` | Dati del job (voci, tavolo, ecc.) |

---

## Struttura file

```
print-dispatcher/
├── src/
│   └── index.js              # Hook extension (ESM; importa formatter da print-server/formatters/)
├── dist/
│   └── index.js              # Bundle pre-compilato (usato da Directus a runtime)
├── package.json              # Build script + devDep: @directus/extensions-sdk
├── .env.example              # Variabili d'ambiente disponibili
└── README.md
```

> **Nota:** `src/formatters/` non esiste più — la logica dei formatter è in
> `print-server/formatters/*.js` (fonte unica di verità) e viene inclusa nel bundle
> durante la build (`npm run build`).

---

## Aggiornare un formatter

1. Modifica il file in `print-server/formatters/` (es. `order.js`)
2. Riesegui la build dell'estensione:
   ```bash
   cd directus-extensions/hooks/print-dispatcher
   npm run build
   ```
3. Commit entrambi: il formatter modificato **e** il `dist/index.js` aggiornato
4. Riavvia Directus per caricare il nuovo bundle

---

## Log di esempio

```
[print-dispatcher] Estensione caricata (stampa diretta) — polling ogni 60s, max retry 3
[print-dispatcher] ✓ Job job_abc123 (order) → stampante "cucina"
[print-dispatcher] ✗ Job job_def456 errore permanente: Tipo di stampa non supportato: unknown
[print-dispatcher] ✗ Job job_ghi789 fallito dopo 4 tentativi: TCP timeout (5000ms) connettendo a 192.168.1.100:9100
[print-dispatcher] Polling: trovati 2 job(s) pending
```
