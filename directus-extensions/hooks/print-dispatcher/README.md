# Print Dispatcher — Directus Hook Extension (stampa diretta)

Estensione Directus di tipo **hook** che legge le collezioni `printers` e `print_jobs`
e invia automaticamente i lavori di stampa **direttamente alla stampante fisica** via TCP o
dispositivo file. Non richiede servizi Node.js / Docker aggiuntivi.

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

### 1. Installa le dipendenze npm

```bash
cd directus-extensions/hooks/print-dispatcher
npm install
```

### 2. Copia nella directory extensions di Directus

```bash
# Opzione A — copia diretta (con node_modules)
cp -r directus-extensions/hooks/print-dispatcher \
      /path/to/directus/extensions/hooks/

# Opzione B — symlink (solo sviluppo; node_modules deve essere già installato)
ln -s $(pwd)/directus-extensions/hooks/print-dispatcher \
      /path/to/directus/extensions/hooks/print-dispatcher
```

Poi riavvia Directus.

### Con Docker Compose

```yaml
services:
  directus:
    volumes:
      - ./directus-extensions/hooks/print-dispatcher:/directus/extensions/hooks/print-dispatcher:ro
    # L'estensione ha una sua dipendenza npm (@point-of-sale/receipt-printer-encoder).
    # Esegui "npm install" nella cartella prima di montarla, oppure usa una build image custom.
```

> **Nota Docker**: se la cartella viene montata come volume, esegui
> `npm install --prefix ./directus-extensions/hooks/print-dispatcher`
> prima di avviare il container per installare `@point-of-sale/receipt-printer-encoder`.

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
│   ├── index.js              # Hook extension (ESM, no build step richiesto)
│   └── formatters/
│       ├── order.js          # ESC/POS per comande cucina/bar
│       ├── table_move.js     # ESC/POS per spostamenti tavolo
│       └── pre_bill.js       # ESC/POS per preconti
├── package.json              # Dipendenze: @point-of-sale/receipt-printer-encoder
├── .env.example              # Variabili d'ambiente disponibili
└── README.md
```

---

## Log di esempio

```
[print-dispatcher] Estensione caricata (stampa diretta) — polling ogni 60s, max retry 3
[print-dispatcher] ✓ Job job_abc123 (order) → stampante "cucina"
[print-dispatcher] ✗ Job job_def456 errore permanente: Tipo di stampa non supportato: unknown
[print-dispatcher] ✗ Job job_ghi789 fallito dopo 4 tentativi: TCP timeout (5000ms) connettendo a 192.168.1.100:9100
[print-dispatcher] Polling: trovati 2 job(s) pending
```
