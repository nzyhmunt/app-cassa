# Print Dispatcher — Directus Hook Extension

Estensione Directus di tipo **hook** che legge le collezioni `printers` e `print_jobs`
e invia automaticamente i lavori di stampa al relativo servizio ESC/POS (`print-server`).

---

## Come funziona

```
Frontend → sync → print_jobs (status: pending)
                        │
                 [hook items.create]
                        │
              legge printers.url
                        │
               POST printer.url
               (payload JSON)
                        │
          status: done / error
```

1. L'app frontend crea un record in `print_jobs` con `status: 'pending'` (via sync offline-first).
2. L'estensione intercetta l'evento `items.create` su `print_jobs` e avvia immediatamente il dispatch.
3. Legge l'URL del print-server dalla collezione `printers` (campo `url`).
4. Invia il `payload` JSON via HTTP POST all'URL della stampante.
5. Aggiorna `status` a `done` (successo) o `error` (con `error_message`).
6. Uno scheduler di fallback (ogni minuto, configurabile) recupera eventuali job rimasti in stato
   `pending` (es. Directus era in restart quando il job è arrivato).

### Blocco ottimistico

Il passaggio `pending → printing` viene eseguito con un `UPDATE WHERE status='pending'` atomico,
garantendo che job concorrenti non vengano inviati due volte anche in caso di race condition.

---

## Prerequisiti

- **Directus** ≥ 10.0.0
- **Node.js** ≥ 18 (richiesto per `fetch` e `AbortSignal.timeout` nativi)
- Il servizio **print-server** in esecuzione e raggiungibile dall'istanza Directus
- Le collezioni `printers` e `print_jobs` create su Directus (vedi `DATABASE_SCHEMA.md`)

---

## Installazione

Copia (o linka) la cartella `print-dispatcher` nella directory `extensions/hooks/`
della tua istanza Directus:

```bash
# Opzione A — copia diretta
cp -r directus-extensions/hooks/print-dispatcher \
      /path/to/directus/extensions/hooks/

# Opzione B — symlink (sconsigliato in produzione)
ln -s $(pwd)/directus-extensions/hooks/print-dispatcher \
      /path/to/directus/extensions/hooks/print-dispatcher
```

Poi riavvia Directus.

### Con Docker Compose

Se Directus è avviato tramite Docker Compose, monta la cartella come volume:

```yaml
services:
  directus:
    volumes:
      - ./directus-extensions/hooks/print-dispatcher:/directus/extensions/hooks/print-dispatcher:ro
```

---

## Configurazione

Tutte le impostazioni passano tramite **variabili d'ambiente** di Directus
(le stesse lette da `process.env` o dal file `.env` di Directus):

| Variabile | Default | Descrizione |
|---|---|---|
| `PRINT_SERVER_API_KEY` | *(vuoto)* | Header `x-api-key` aggiunto ad ogni POST. Deve corrispondere a `PRINT_SERVER_API_KEY` del print-server. |
| `PRINT_DISPATCHER_POLL_SEC` | `60` | Intervallo di polling per job pending rimasti indietro (secondi). |
| `PRINT_DISPATCHER_TIMEOUT_MS` | `30000` | Timeout HTTP per richiesta al print-server (ms). |
| `PRINT_DISPATCHER_RETRY_MAX` | `3` | Numero massimo di tentativi per errori transitori (5xx/rete). |
| `PRINT_DISPATCHER_RETRY_DELAY_MS` | `2000` | Attesa tra un tentativo e il successivo (ms). |

Copia `.env.example` e aggiungilo al file `.env` di Directus.

---

## Schema Directus richiesto

### `printers`

| Campo | Tipo | Note |
|---|---|---|
| `id` | `varchar(40)` | Chiave primaria |
| `url` | `text` | **URL del print-server** (es. `http://print-server:3001/print`) |
| `name` | `varchar(80)` | Nome visualizzato |

### `print_jobs`

| Campo | Tipo | Note |
|---|---|---|
| `log_id` | `varchar(40)` | Chiave primaria |
| `printer` | `varchar(40)` | FK → `printers.id` |
| `status` | `varchar` | `pending` \| `printing` \| `done` \| `error` |
| `error_message` | `text` | Messaggio di errore (solo se `status='error'`) |
| `payload` | `jsonb` | Corpo JSON inviato al print-server |

---

## Struttura file

```
print-dispatcher/
├── src/
│   └── index.js       # Hook extension (ESM, no build step richiesto)
├── package.json       # Metadati estensione Directus
├── .env.example       # Variabili d'ambiente disponibili
└── README.md
```

---

## Log di esempio

```
[print-dispatcher] Estensione caricata — polling ogni 60s, timeout HTTP 30000ms, max retry 3
[print-dispatcher] ✓ Job job_abc123 (order) → stampante "cucina"
[print-dispatcher] ✗ Job job_def456 errore: HTTP 500 — Errore stampante: TCP timeout
[print-dispatcher] Polling: trovati 2 job(s) pending
```
