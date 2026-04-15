# ESC/POS Print Server

Servizio Node.js che converte job di stampa in comandi ESC/POS e li invia alle stampanti termiche
(rete TCP o USB). Supporta tre modalità operative che possono coesistere.

> **Formatter ESC/POS condivisi:** la logica di formattazione risiede in `formatters/*.js` (CJS)
> ed è la **fonte unica di verità** usata sia da questo servizio (CJS `require`) che
> dall'estensione Directus `print-dispatcher` (bundled da Rollup). Per modificare il layout
> di una ricevuta basta aggiornare il file in `formatters/`; l'estensione va poi ricompilata.

---

## Modalità operative

Il print-server supporta tre modalità di integrazione con app-cassa e Directus.
Tutte e tre possono essere attive contemporaneamente; per l'uso quotidiano si
consiglia di sceglierne una principale.

### Modalità 1 — HTTP Push (classica, sempre attiva)

Il **frontend** invia ogni job direttamente al print-server tramite `POST /print`.
Non richiede Directus; funziona anche offline rispetto a Directus.

```
frontend ──POST /print──► print-server ──TCP/USB──► stampante
```

**Quando usarla:** installazioni senza Directus, oppure come canale principale con
le modalità Directus come fallback.

**Configurazione:** nessuna variabile aggiuntiva. Configura `appConfig.printers[].url`
nel frontend per puntare a `http://<print-server>:3001/print`.

---

### Modalità 2 — Directus Pull (con SDK + WebSocket)

Il **print-server si connette a Directus** e legge autonomamente i job dalla
collezione `print_jobs`, senza che il browser faccia da intermediario.

```
Directus print_jobs ──WebSocket (real-time)──► print-server ──TCP/USB──► stampante
                    ──REST polling (fallback)──►
```

**Due sotto-meccanismi complementari:**

| Meccanismo | Descrizione | Latenza tipica |
|---|---|---|
| WebSocket subscription | Riceve ogni `create` su `print_jobs` in tempo reale via `@directus/sdk` `realtime()`. Usa il WebSocket nativo di Node.js 22+. | < 100ms |
| REST polling (fallback) | Query periodica per tutti i job `pending` — recupera job persi durante disconnessioni o riavvii | max `DIRECTUS_POLL_SEC` sec |

Il polling è **sempre attivo** come rete di sicurezza, anche quando il WebSocket
funziona correttamente.

**Ciclo di vita di un job:**

```
pending ──► printing ──► done
                     ╰──► error (con error_message)
```

**Atomicità (singola istanza):** l'API REST di Directus non supporta `UPDATE WHERE status='pending'`
come operazione atomica. Il client legge il job, verifica che sia ancora `pending`, poi lo aggiorna
a `printing`. Per deployment a istanza singola (tipico per un print-server locale) questo è
affidabile. Per deployment multi-istanza, usare la **Modalità 3** (hook Directus con accesso
diretto al database).

**Attivazione:** imposta `DIRECTUS_URL` e `DIRECTUS_TOKEN` in `.env`.

**Variabili d'ambiente Directus Pull:**

| Variabile | Default | Descrizione |
|---|---|---|
| `DIRECTUS_URL` | *(vuoto — disabilitato)* | URL base di Directus (es. `http://localhost:8055`) |
| `DIRECTUS_TOKEN` | *(vuoto)* | Static token con permessi `read/write` su `print_jobs`, `read` su `printers` |
| `DIRECTUS_VENUE_ID` | *(vuoto — tutti)* | Filtra job per venue ID (intero) |
| `DIRECTUS_POLL_SEC` | `60` | Intervallo polling REST in secondi (minimo: 5) |
| `DIRECTUS_WS_RETRIES` | `100` | Tentativi di riconnessione WebSocket |
| `DIRECTUS_WS_RETRY_DELAY` | `3000` | Attesa tra riconnessioni WS in ms |
| `DIRECTUS_RETRY_MAX` | `3` | Tentativi per job in caso di errore transitorio |
| `DIRECTUS_RETRY_DELAY_MS` | `2000` | Attesa tra tentativi per job in ms |
| `DIRECTUS_PRINTERS_REFRESH_SEC` | `300` | Intervallo refresh lista stampanti da Directus (sec) |

**Permessi Directus necessari per il token:**

| Collezione | Permessi |
|---|---|
| `print_jobs` | `read`, `update` |
| `printers` | `read` |

**Configurazione stampanti da Directus (Modalità 2):**

Quando Directus è disponibile, la collezione `printers` diventa la fonte unica di verità per la
configurazione delle stampanti fisiche. Il print-server legge i campi di connessione diretta
(`connection_type`, `tcp_host`, `tcp_port`, `tcp_timeout`, `file_device`) e li usa per
comunicare direttamente con le stampanti, ignorando `printers.config.js` e le variabili
`PRINTER_<N>_*`.

**Campi aggiuntivi richiesti nella collezione `printers` per la Modalità 2:**

| Campo Directus | Tipo | Valori | Descrizione |
|---|---|---|---|
| `connection_type` | `string` | `'tcp'` \| `'file'` \| `'http'` | Tipo di connessione diretta. `http` = non gestita in pull mode |
| `tcp_host` | `string` | es. `192.168.1.100` | *(tcp)* IP/hostname della stampante |
| `tcp_port` | `integer` | default `9100` | *(tcp)* Porta TCP ESC/POS |
| `tcp_timeout` | `integer` | default `5000` | *(tcp)* Timeout connessione in ms |
| `file_device` | `string` | default `/dev/usb/lp0` | *(file)* Percorso device USB/parallela |

Solo le stampanti con `connection_type = 'tcp'` o `'file'` vengono usate in pull mode.
Se nessuna stampante ha questi valori (o la collezione non ha i campi), si usa la configurazione
locale (`printers.config.js` o `PRINTER_<N>_*`).

La lista stampanti viene aggiornata ogni `DIRECTUS_PRINTERS_REFRESH_SEC` secondi (default: 5 min).

---

### Modalità 3 — Directus Hook (stampa diretta, no print-server)

> **Questa modalità non usa questo print-server.** È fornita come alternativa
> autonoma per installazioni in cui Directus è sulla stessa rete locale delle stampanti.

L'**estensione hook Directus** (`directus-extensions/hooks/print-dispatcher`)
gira all'interno del processo Directus e stampa **direttamente** sulle stampanti
fisiche via TCP o file di dispositivo, senza bisogno di questo servizio Node.js.

```
Frontend → print_jobs (status: pending)
                 │
          [hook Directus] ←── accesso diretto al DB
                 │
         printers collection
                 │
         buildEscPosBuffer
                 │
    TCP socket / file device ──► stampante fisica
                 │
        status: done / error
```

**Caratteristiche:**
- Gira **nel processo Directus** — nessun servizio aggiuntivo da deployare
- **Atomic claim** via `UPDATE WHERE status='pending'` sul DB — sicuro per multi-istanza
- Legge la config stampante dalla collezione `printers` (`connection_type`, `tcp_host`, …)
- **Tipi supportati:** `tcp` (porta 9100 default) e `file` (device USB/seriale)
- Scheduler di fallback ogni 60 s per recuperare job persi al riavvio di Directus

Vedi `directus-extensions/hooks/print-dispatcher/README.md` per installazione e configurazione.

---

### Confronto modalità

| | Modalità 1 (HTTP Push) | Modalità 2 (Directus Pull) | Modalità 3 (Hook Direct) |
|---|---|---|---|
| **Richiede Directus** | ✗ | ✓ | ✓ |
| **Richiede print-server** | ✓ | ✓ | ✗ |
| **Real-time** | ✓ | ✓ (WebSocket) | ✓ |
| **Atomic claim** | N/A | Ottimistico (single-instance) | ✓ (DB diretto) |
| **Multi-istanza print-server** | ✓ | ✗ (race condition) | ✓ |
| **Nessun intermediario browser** | ✗ | ✓ | ✓ |
| **Offline-first compatible** | ✓ (sync frontend) | ✓ | ✓ |
| **Printer config da Directus** | ✗ | ✓ | ✓ |

**Scelta consigliata:**
- **Solo print-server, senza Directus** → Modalità 1
- **Print-server + Directus** → Modalità 2 (con Modalità 1 come fallback)
- **Solo Directus, stampanti sulla stessa rete** → Modalità 3

---

## Requisiti

- **Node.js ≥ 22** (WebSocket nativo richiesto per la modalità Directus Pull)
- Una o più stampanti termiche compatibili ESC/POS (rete TCP o USB)
- *(Modalità 2/3)* Directus ≥ 10.0.0 con le collezioni `print_jobs` e `printers`

---

## Installazione

```bash
cd print-server
npm install
```

---

## Installazione con Docker

### Prerequisiti

- [Docker](https://docs.docker.com/get-docker/) ≥ 24
- [Docker Compose](https://docs.docker.com/compose/) ≥ 2 (incluso in Docker Desktop)

### Configurazione iniziale

1. Crea il file `.env` a partire dall'esempio:

   ```bash
   cp .env.example .env
   ```

   Modifica i valori secondo necessità. Tutte le variabili d'ambiente vengono
   lette dal file `.env` **e** inoltrate automaticamente al container.

2. Configura le stampanti fisiche (vedi [Configurazione stampanti](#configurazione-stampanti)).

3. *(Opzionale — Modalità 2)* Aggiungi le variabili Directus al file `.env`:

   ```env
   DIRECTUS_URL=http://directus:8055
   DIRECTUS_TOKEN=il-tuo-static-token
   ```

### Avvio

```bash
# Nella cartella print-server/
docker compose up -d
```

Per vedere i log in tempo reale:

```bash
docker compose logs -f
```

Per fermare:

```bash
docker compose down
```

### Avvio insieme a Directus (esempio `docker-compose.yml` completo)

Se il print-server deve connettersi allo stesso stack Directus, puoi usare
un compose file unificato o i network Docker per permettere la comunicazione
tra container:

```yaml
# Esempio: estendi il docker-compose.yml di Directus aggiungendo il print-server
services:
  print-server:
    build: ./print-server
    restart: unless-stopped
    ports:
      - "3001:3001"
    environment:
      - DIRECTUS_URL=http://directus:8055
      - DIRECTUS_TOKEN=${DIRECTUS_PRINT_TOKEN}
      - PRINTER_0_ID=cucina
      - PRINTER_0_TYPE=tcp
      - PRINTER_0_HOST=192.168.1.100
      - PRINTER_0_PORT=9100
    networks:
      - directus_network  # stesso network del container Directus

networks:
  directus_network:
    external: true  # usa il network già creato da Directus
```

### Aggiornamento

```bash
docker compose up -d --build
```

### Stampanti USB (`type: 'file'`)

Decommentare la sezione `devices` in `docker-compose.yml`:

```yaml
devices:
  - /dev/usb/lp0:/dev/usb/lp0
```

> **Permessi dispositivo:** scegli una delle opzioni seguenti e decommentala in
> `docker-compose.yml`:
>
> **Opzione A — gruppo del device (consigliata):**
> ```yaml
> group_add:
>   - lp
> ```
>
> **Opzione B — container come root (meno sicura):**
> ```yaml
> user: root
> ```

> **Nota:** `printers.config.js` è montato in sola lettura. Dopo una modifica
> riavvia con `docker compose restart` (non serve rebuild).

---

## Configurazione stampanti

Le stampanti fisiche possono essere configurate in tre modi, con ordine di precedenza decrescente:

| Priorità | Metodo | Quando usarlo |
|---|---|---|
| **1 (massima)** | Collezione `printers` su Directus (`connection_type = tcp/file`) | Modalità 2 (Directus Pull): configurazione centralizzata |
| **2** | Variabili d'ambiente `PRINTER_<N>_*` | Docker Compose, deployment containerizzato |
| **3** | `printers.config.js` | Sviluppo locale, deployment standalone |

### Opzione 1 — Directus `printers` collection (Modalità 2)

Aggiungi i campi di connessione diretta alla collection `printers` in Directus (vedi `DATABASE_SCHEMA.md`
sezione 2.18) e imposta `connection_type = 'tcp'` o `'file'`. Il print-server leggerà questi dati
all'avvio e ogni `DIRECTUS_PRINTERS_REFRESH_SEC` secondi.

```
# Esempio: stampante TCP configurata in Directus
id: 'cucina'
name: 'Cucina'
connection_type: 'tcp'
tcp_host: '192.168.1.100'
tcp_port: 9100
url: 'http://localhost:3001/print'   ← ancora richiesto per hook push / frontend
```

### Opzione 2 — variabili d'ambiente `PRINTER_<N>_*` (consigliata con Docker)

Se è impostata almeno `PRINTER_0_ID`, le stampanti vengono lette dalle
variabili d'ambiente **al posto** di `printers.config.js`.

| Variabile | Default | Descrizione |
|---|---|---|
| `PRINTER_<N>_ID` | — | **Obbligatoria.** ID univoco stampante |
| `PRINTER_<N>_NAME` | *(= ID)* | Nome descrittivo |
| `PRINTER_<N>_TYPE` | `tcp` | `tcp` \| `file` |
| `PRINTER_<N>_HOST` | `127.0.0.1` | *(tcp)* Indirizzo IP |
| `PRINTER_<N>_PORT` | `9100` | *(tcp)* Porta TCP |
| `PRINTER_<N>_TIMEOUT` | `5000` | *(tcp)* Timeout ms |
| `PRINTER_<N>_DEVICE` | `/dev/usb/lp0` | *(file)* Percorso device |

> **Importante:** l'`id` della stampante configurata qui deve corrispondere
> al campo `printer` in `print_jobs` (Modalità 2/3) e al campo `id`/`printerId`
> inviato dal frontend (Modalità 1).

### Opzione 3 — `printers.config.js` (sviluppo locale)

```js
module.exports = {
  printers: [
    { id: 'cucina', name: 'Cucina', type: 'tcp',  host: '192.168.1.100', port: 9100 },
    { id: 'bar',    name: 'Bar',    type: 'tcp',  host: '192.168.1.101', port: 9100 },
    { id: 'cassa',  name: 'Cassa',  type: 'file', device: '/dev/usb/lp0' },
  ],
};
```

---

## Variabili d'ambiente — riepilogo completo

| Variabile | Default | Descrizione |
|---|---|---|
| `PORT` | `3001` | Porta HTTP |
| `PRINT_SERVER_NAME` | `ESC/POS Print Server` | Nome nei log |
| `PRINT_SERVER_API_KEY` | *(vuoto)* | Richiede `x-api-key` su `POST /print` |
| `CORS_ALLOWED_ORIGINS` | *(vuoto — tutte)* | Origini CORS consentite (virgola separata) |
| `PRINTER_<N>_*` | — | Configurazione stampante N (vedi sopra) |
| `DIRECTUS_URL` | *(vuoto — disabilitato)* | URL Directus per modalità pull |
| `DIRECTUS_TOKEN` | *(vuoto)* | Static token Directus |
| `DIRECTUS_VENUE_ID` | *(vuoto — tutti)* | Filtro venue ID |
| `DIRECTUS_POLL_SEC` | `60` | Intervallo polling REST (sec) |
| `DIRECTUS_WS_RETRIES` | `100` | Tentativi riconnessione WS |
| `DIRECTUS_WS_RETRY_DELAY` | `3000` | Attesa tra riconnessioni WS (ms) |
| `DIRECTUS_RETRY_MAX` | `3` | Tentativi per job (errore transitorio) |
| `DIRECTUS_RETRY_DELAY_MS` | `2000` | Attesa tra tentativi (ms) |
| `DIRECTUS_PRINTERS_REFRESH_SEC` | `300` | Refresh stampanti da Directus (sec) |

---

## Avvio

```bash
npm start      # Produzione
npm run dev    # Sviluppo (riavvio automatico con node --watch)
```

Output di avvio con Modalità 2 abilitata:

```
[print-server] ESC/POS Print Server in ascolto su http://localhost:3001
[print-server] Stampanti configurate (2):
[print-server]   [cucina] Cucina  (TCP  → 192.168.1.100:9100)
[print-server]   [cassa]  Cassa   (file → /dev/usb/lp0)
[directus-client] Avvio modalità pull Directus → http://directus:8055
[directus-client] Connessione Directus verificata ✓
[directus-client] Polling REST avviato (ogni 60s)
[directus-client] WebSocket connesso a Directus
[directus-client] Sottoscrizione WebSocket attiva su print_jobs (event: create)
```

---

## API

### `GET /health`

```json
{ "status": "ok", "service": "ESC/POS Print Server" }
```

### `POST /print`

Riceve un job JSON, lo converte in ESC/POS e lo invia alla stampante.

| Campo | Tipo | Descrizione |
|---|---|---|
| `printType` | `string` | **Obbligatorio.** `'order'` \| `'table_move'` \| `'pre_bill'` |
| `printerId` | `string` | ID stampante. Se assente/non trovato → prima stampante |
| `jobId` | `string` | Identificatore job (restituito in risposta) |

**Risposta di successo (200):**
```json
{ "ok": true, "jobId": "job_<uuid>" }
```

**Risposta di errore (400/500):**
```json
{ "ok": false, "error": "messaggio di errore" }
```

---

## Struttura file

```
print-server/
├── server.js              # Entry point: server HTTP Express
├── printer.js             # Multi-printer dispatch (TCP / file, coda serializzata)
├── build-buffer.js        # Seleziona il formatter ESC/POS corretto
├── directus-client.js     # Modalità 2: Directus Pull (SDK + WebSocket + polling)
├── printers.config.js     # ← Configurare qui le stampanti del locale
├── formatters/            # ← FONTE UNICA dei formatter ESC/POS (vedi sotto)
│   ├── order.js           # Comanda cucina/bar
│   ├── table_move.js      # Spostamento tavolo
│   └── pre_bill.js        # Preconto
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## Architettura formatter ESC/POS (fonte unica)

La directory `print-server/formatters/` è la **fonte unica di verità** per la logica
di formattazione ESC/POS. Sia il print-server che l'estensione Directus usano lo
stesso codice sorgente:

| Componente | Come usa i formatter |
|---|---|
| **Print server** (`build-buffer.js`) | `require('./formatters/order.js')` — CJS diretto |
| **Directus Extension** (`dist/index.js`) | Bundle Rollup: i file `formatters/*.js` sono inclusi nel bundle a compile-time |

**Per modificare un formatter** (es. layout della comanda):
1. Modifica `print-server/formatters/order.js`
2. Ricostruisci il bundle extension: `cd directus-extensions/hooks/print-dispatcher && npm run build`
3. Commit sia il file modificato che il `dist/index.js` aggiornato

Il print-server usa i file sorgente direttamente (senza rebuild). L'estensione usa il bundle pre-compilato.

---

## Integrazione con app-cassa

### Modalità 1 (HTTP Push)

`appConfig.printers[].url` punta al print-server; il campo `printerId` instraderà
il job alla stampante fisica corretta.

```js
// src/utils/index.js — appConfig (Modalità 1)
printers: [
  { id: 'cucina', name: 'Cucina', url: 'http://localhost:3001/print',
    printTypes: ['order'], categories: ['Antipasti', 'Primi'] },
  { id: 'cassa',  name: 'Cassa',  url: 'http://localhost:3001/print',
    printTypes: ['pre_bill', 'table_move'] },
],
```

### Modalità 2/3 (Directus Pull/Hook)

I job vengono scritti su Directus dal frontend (tramite sync offline-first).
Il print-server (o l'hook Directus) li legge e li stampa autonomamente.
`appConfig.printers[].id` deve corrispondere all'`id` in `printers.config.js`.

```js
// src/utils/index.js — appConfig (Modalità 2/3)
printers: [
  { id: 'cucina', name: 'Cucina', url: 'http://directus:8055/items/print_jobs',
    printTypes: ['order'], categories: ['Antipasti', 'Primi'] },
  { id: 'cassa',  name: 'Cassa',  url: 'http://directus:8055/items/print_jobs',
    printTypes: ['pre_bill', 'table_move'] },
],
```

---

## Test

```bash
npm test
```

