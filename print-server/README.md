# ESC/POS Print Server

Servizio Node.js che riceve i job di stampa da **app-cassa** tramite HTTP POST,
li converte in comandi ESC/POS (usando la libreria [`@point-of-sale/receipt-printer-encoder`](https://github.com/NielsLeenheer/ReceiptPrinterEncoder))
e li invia alla stampante termica corretta in base al campo `printerId` del job.

---

## Requisiti

- **Node.js ≥ 20.19**
- Una o più stampanti termiche compatibili ESC/POS (rete TCP o USB)

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

1. Crea il file `.env` (opzionale) a partire dall'esempio:

   ```bash
   cp .env.example .env
   ```

   Modifica i valori secondo necessità. Tutte le [variabili d'ambiente](#variabili-dampiente)
   (`PORT`, `PRINT_SERVER_NAME`, `PRINT_SERVER_API_KEY`, `CORS_ALLOWED_ORIGINS`) vengono
   lette dal file `.env` **e** inoltrate automaticamente al container.
   In alternativa puoi impostarle come variabili di shell prima di avviare Compose:

   ```bash
   PORT=4000 PRINT_SERVER_API_KEY=segreto docker compose up -d
   ```

2. Configura le stampanti scegliendo uno dei metodi disponibili:
   - **`printers.config.js`** — modifica il file direttamente (adatto all'installazione locale).
   - **Variabili d'ambiente** `PRINTER_<N>_*` — aggiungile al file `.env` o alla sezione
     `environment` di `docker-compose.yml` (consigliato con Docker, non richiede rebuild
     quando cambia la configurazione delle stampanti).
   
   Vedi la [sezione Configurazione stampanti](#configurazione-stampanti) per i dettagli.

### Avvio

```bash
# Nella cartella print-server/
docker compose up -d
```

Il servizio partirà in background. Per vedere i log:

```bash
docker compose logs -f
```

Per fermare il servizio:

```bash
docker compose down
```

### Aggiornamento

Dopo aver modificato il codice sorgente, ricostruisci l'immagine:

```bash
docker compose up -d --build
```

### Stampanti USB (`type: 'file'`)

Le stampanti collegate via USB (es. `/dev/usb/lp0`) richiedono di passare il
dispositivo al container. Decommentare la sezione `devices` in
`docker-compose.yml` e adattare il percorso del dispositivo:

```yaml
devices:
  - /dev/usb/lp0:/dev/usb/lp0
```

> **Permessi dispositivo:** il container gira come utente non-root (`node`).
> I device file USB sono in genere di proprietà `root:lp` (modo 660), quindi
> una semplice mappatura del device può causare un errore `EACCES`.
> Per concedere l'accesso in scrittura scegli una delle opzioni seguenti
> e decommentala in `docker-compose.yml`:
>
> **Opzione A — aggiungere il container al gruppo del device (consigliata):**
> ```yaml
> group_add:
>   - lp
> ```
>
> **Opzione B — avviare il container come root (meno sicura):**
> ```yaml
> user: root
> ```

> **Nota:** `printers.config.js` viene montato come volume in sola lettura.
> Dopo aver modificato il file, riavvia il container con `docker compose restart`
> affinché il server carichi la nuova configurazione; non è necessario ricostruire l'immagine.

---

## Configurazione stampanti

Le stampanti fisiche possono essere configurate in due modi:

### Opzione A — `printers.config.js` (default)

Modifica direttamente il file `printers.config.js`:

```js
// printers.config.js
module.exports = {
  printers: [
    { id: 'cucina', name: 'Cucina', type: 'tcp',  host: '192.168.1.100', port: 9100 },
    { id: 'bar',    name: 'Bar',    type: 'tcp',  host: '192.168.1.101', port: 9100 },
    { id: 'cassa',  name: 'Cassa',  type: 'file', device: '/dev/usb/lp0' },
  ],
};
```

### Opzione B — variabili d'ambiente `PRINTER_<N>_*` (consigliata con Docker)

Se è impostata almeno una variabile `PRINTER_0_ID`, le stampanti vengono lette dalle
variabili d'ambiente **al posto** di `printers.config.js`. `N` inizia da 0 e deve essere
consecutivo (0, 1, 2 — senza salti).

| Variabile | Default | Descrizione |
|---|---|---|
| `PRINTER_<N>_ID` | — | **Obbligatoria.** Identificatore univoco della stampante |
| `PRINTER_<N>_NAME` | *(uguale a ID)* | Nome descrittivo (solo per i log) |
| `PRINTER_<N>_TYPE` | `tcp` | Tipo di connessione: `tcp` \| `file` |
| `PRINTER_<N>_HOST` | `127.0.0.1` | *(solo tcp)* Indirizzo IP o hostname |
| `PRINTER_<N>_PORT` | `9100` | *(solo tcp)* Porta TCP |
| `PRINTER_<N>_TIMEOUT` | `5000` | *(solo tcp)* Timeout connessione in ms |
| `PRINTER_<N>_DEVICE` | `/dev/usb/lp0` | *(solo file)* Percorso del file di dispositivo |

**Esempio** con due stampanti TCP via `.env`:

```env
PRINTER_0_ID=cucina
PRINTER_0_NAME=Cucina
PRINTER_0_TYPE=tcp
PRINTER_0_HOST=192.168.1.100
PRINTER_0_PORT=9100

PRINTER_1_ID=bar
PRINTER_1_NAME=Bar
PRINTER_1_TYPE=tcp
PRINTER_1_HOST=192.168.1.101
PRINTER_1_PORT=9100
```

**Esempio** con stampante USB via `.env`:

```env
PRINTER_0_ID=cassa
PRINTER_0_TYPE=file
PRINTER_0_DEVICE=/dev/usb/lp0
```

> **Nota Docker Compose:**
> - Se le variabili `PRINTER_<N>_*` sono nel file **`.env`**, vengono caricate automaticamente
>   dal blocco `env_file: .env` già presente nel compose — non è necessario decommentare nulla.
> - Se vuoi impostarle come **variabili di shell** (es. `PRINTER_0_ID=cucina docker compose up`),
>   aggiungi le corrispondenti righe nella sezione `environment` del compose
>   (vedi i commenti in `docker-compose.yml`).

### Tipi di connessione

| `type` | Parametri richiesti | Uso tipico |
|---|---|---|
| `tcp` | `host`, `port` (def. 9100), `timeout` (def. 5000ms) | Stampante di rete |
| `file` | `device` (es. `/dev/usb/lp0`) | Stampante USB Linux |

### Routing per printerId

Quando arriva un job con `printerId: 'cucina'`, il server cerca la voce con `id: 'cucina'`
e la usa. Se non trovata, viene usata la **prima stampante** come fallback.

Questo rispecchia esattamente il comportamento del frontend: `appConfig.printers[].id` nel
frontend deve corrispondere all'`id` della stampante configurata.

---

## Variabili d'ambiente

| Variabile | Default | Descrizione |
|---|---|---|
| `PORT` | `3001` | Porta HTTP del server |
| `PRINT_SERVER_NAME` | `ESC/POS Print Server` | Nome nei log |
| `PRINT_SERVER_API_KEY` | *(vuoto)* | Se impostata, ogni `POST /print` deve includere `x-api-key: <valore>` |
| `CORS_ALLOWED_ORIGINS` | *(vuoto — tutte le origini)* | Origini CORS consentite (virgola separata). Se vuota, tutte le origini sono accettate. |
| `PRINTER_<N>_ID` | — | Identificatore stampante N (abilita configurazione via env vars se impostato a partire da `PRINTER_0_ID`, indici consecutivi) |
| `PRINTER_<N>_NAME` | *(uguale a ID)* | Nome descrittivo (solo per i log) |
| `PRINTER_<N>_TYPE` | `tcp` | Tipo connessione: `tcp` \| `file` |
| `PRINTER_<N>_HOST` | `127.0.0.1` | *(solo tcp)* Indirizzo IP o hostname |
| `PRINTER_<N>_PORT` | `9100` | *(solo tcp)* Porta TCP |
| `PRINTER_<N>_TIMEOUT` | `5000` | *(solo tcp)* Timeout connessione in ms |
| `PRINTER_<N>_DEVICE` | `/dev/usb/lp0` | *(solo file)* Percorso dispositivo |

> Per la configurazione completa delle stampanti via env vars vedi la [sezione Configurazione stampanti](#configurazione-stampanti).

---

## Avvio

```bash
npm start      # Usa printers.config.js
npm run dev    # Con riavvio automatico (node --watch)
```

Output di avvio con più stampanti:

```
[print-server] ESC/POS Print Server in ascolto su http://localhost:3001
[print-server] Endpoint: POST http://localhost:3001/print
[print-server] Stampanti configurate (3):
[print-server]   [cucina] Cucina  (TCP  → 192.168.1.100:9100)
[print-server]   [bar]    Bar     (TCP  → 192.168.1.101:9100)
[print-server]   [cassa]  Cassa   (file → /dev/usb/lp0)
```

---

## API

### `GET /health`

```json
{ "status": "ok", "service": "ESC/POS Print Server" }
```

### `POST /print`

Riceve un job JSON, lo converte in ESC/POS e lo invia alla stampante identificata da `printerId`.

**Corpo:** il payload del job generato da `usePrintQueue.js`.

| Campo | Tipo | Descrizione |
|---|---|---|
| `printType` | `string` | **Obbligatorio.** `'order'` \| `'table_move'` \| `'pre_bill'` |
| `printerId` | `string` | ID stampante (corrisponde a `printers.config.js`). Se assente/non trovato → prima stampante |
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

## Tipi di stampa supportati

### `order` — Comanda cucina/bar

```json
{
  "jobId": "job_abc", "printType": "order", "printerId": "cucina",
  "table": "05", "time": "20:15", "globalNote": "",
  "items": [
    { "name": "Bruschetta", "quantity": 2, "notes": ["Senza aglio"],
      "course": "prima", "modifiers": [{ "name": "Extra mozzarella", "price": 1.00 }] }
  ]
}
```

### `table_move` — Spostamento tavolo

```json
{
  "jobId": "job_abc", "printType": "table_move", "printerId": "cassa",
  "fromTableLabel": "01", "toTableLabel": "02"
}
```

### `pre_bill` — Preconto

```json
{
  "jobId": "job_abc", "printType": "pre_bill", "printerId": "cassa",
  "table": "05", "timestamp": "2026-04-08T20:00:00Z",
  "items": [{ "name": "Bruschetta", "quantity": 2, "unitPrice": 3.00, "subtotal": 6.00 }],
  "grossAmount": 6.00, "paymentsRecorded": 0, "amountDue": 6.00
}
```

---

## Struttura file

```
print-server/
├── server.js              # Entry point: server HTTP Express
├── printer.js             # Multi-printer dispatch (TCP / file)
├── printers.config.js     # ← Configurare qui le stampanti del locale
├── formatters/
│   ├── order.js           # Formatter comanda cucina/bar
│   ├── table_move.js      # Formatter spostamento tavolo
│   └── pre_bill.js        # Formatter preconto
├── Dockerfile             # Immagine Docker del print-server
├── docker-compose.yml     # Configurazione Docker Compose
├── .dockerignore          # File esclusi dalla build Docker
├── package.json
├── .env.example
└── README.md
```

---

## Integrazione con app-cassa

Il frontend (`src/utils/index.js`) invia i job all'URL configurato in `appConfig.printers[].url`.
Con questo server ogni stampante del frontend può puntare allo stesso URL (es. `http://localhost:3001/print`):
il campo `printerId` del job instraderà automaticamente il lavoro alla stampante fisica corretta.

```js
// src/utils/index.js — appConfig
printers: [
  { id: 'cucina', name: 'Cucina', url: 'http://localhost:3001/print',
    printTypes: ['order'], categories: ['Antipasti', 'Primi', 'Secondi'] },
  { id: 'bar',  name: 'Bar',   url: 'http://localhost:3001/print',
    printTypes: ['order'], categories: ['Bevande', 'Digestivi'] },
  { id: 'cassa', name: 'Cassa', url: 'http://localhost:3001/print',
    printTypes: ['pre_bill', 'table_move'] },
],
```

```js
// printers.config.js — connessioni fisiche
printers: [
  { id: 'cucina', name: 'Cucina', type: 'tcp', host: '192.168.1.100', port: 9100 },
  { id: 'bar',    name: 'Bar',    type: 'tcp', host: '192.168.1.101', port: 9100 },
  { id: 'cassa',  name: 'Cassa',  type: 'tcp', host: '192.168.1.102', port: 9100 },
],
```
