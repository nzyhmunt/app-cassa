# ESC/POS Print Server

Servizio Node.js che converte job di stampa in comandi ESC/POS e li invia alle stampanti termiche
(rete TCP o USB). Supporta tre modalità operative che possono coesistere.

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
| WebSocket subscription | Riceve ogni `create` su `print_jobs` in tempo reale via `@directus/sdk` `realtime()` | < 100ms |
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
| `DIRECTUS_TOKEN` | *(vuoto)* | Static token con permessi `read/write` su `print_jobs` |
| `DIRECTUS_VENUE_ID` | *(vuoto — tutti)* | Filtra job per venue ID (intero) |
| `DIRECTUS_POLL_SEC` | `60` | Intervallo polling REST in secondi (minimo: 5) |
| `DIRECTUS_WS_RETRIES` | `100` | Tentativi di riconnessione WebSocket |
| `DIRECTUS_WS_RETRY_DELAY` | `3000` | Attesa tra riconnessioni WS in ms |
| `DIRECTUS_RETRY_MAX` | `3` | Tentativi per job in caso di errore transitorio |
| `DIRECTUS_RETRY_DELAY_MS` | `2000` | Attesa tra tentativi per job in ms |

**Permessi Directus necessari per il token:**

| Collezione | Permessi |
|---|---|
| `print_jobs` | `read`, `update` |

**WebSocket e Node.js:** il modulo `ws` (incluso nelle dipendenze) viene usato come
implementazione WebSocket esplicita per stabilità su Node.js 18-20. Su Node.js 22+
è disponibile il WebSocket nativo; `ws` rimane preferito per configurabilità.

---

### Modalità 3 — Directus Hook Push (estensione Directus)

Un'**estensione hook Directus** (`directus-extensions/hooks/print-dispatcher`)
riceve gli eventi `items.create` su `print_jobs` direttamente nel processo
Directus e fa un `POST /print` al print-server per ogni job pending.

```
Directus hook ──POST /print──► print-server ──TCP/USB──► stampante
```

**Differenze rispetto alla Modalità 2:**
- L'hook gira **nel processo Directus** (non nel print-server)
- Ha accesso diretto al database → atomic claim via `UPDATE WHERE status='pending'`
- Richiede la copia dell'estensione nella cartella `extensions/hooks/` di Directus
- Ideale per deployment multi-istanza del print-server

Vedi `directus-extensions/hooks/print-dispatcher/README.md` per dettagli.

---

### Confronto modalità

| | Modalità 1 (HTTP Push) | Modalità 2 (Directus Pull) | Modalità 3 (Hook Push) |
|---|---|---|---|
| **Richiede Directus** | ✗ | ✓ | ✓ |
| **Real-time** | ✓ | ✓ (WebSocket) | ✓ |
| **Atomic claim** | N/A | Ottimistico (single-instance) | ✓ (DB diretto) |
| **Multi-istanza** | ✓ | ✗ (race condition) | ✓ |
| **Nessun intermediario browser** | ✗ | ✓ | ✓ |
| **Offline-first compatible** | ✓ (sync frontend) | ✓ | ✓ |

---

## Requisiti

- **Node.js ≥ 20.19**
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

### Opzione A — `printers.config.js`

```js
module.exports = {
  printers: [
    { id: 'cucina', name: 'Cucina', type: 'tcp',  host: '192.168.1.100', port: 9100 },
    { id: 'bar',    name: 'Bar',    type: 'tcp',  host: '192.168.1.101', port: 9100 },
    { id: 'cassa',  name: 'Cassa',  type: 'file', device: '/dev/usb/lp0' },
  ],
};
```

### Opzione B — variabili d'ambiente `PRINTER_<N>_*` (consigliata con Docker)

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
├── build-buffer.js        # Shared: seleziona il formatter ESC/POS corretto
├── directus-client.js     # Modalità 2: Directus Pull (SDK + WebSocket + polling)
├── printers.config.js     # ← Configurare qui le stampanti del locale
├── formatters/
│   ├── order.js           # Comanda cucina/bar
│   ├── table_move.js      # Spostamento tavolo
│   └── pre_bill.js        # Preconto
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

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

