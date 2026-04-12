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

   Modifica i valori secondo necessità (porta, API key, origini CORS).

2. Configura le stampanti in **`printers.config.js`** (vedi [sezione sotto](#configurazione-stampanti)).

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

> **Nota:** `printers.config.js` viene montato come volume in sola lettura;
> qualsiasi modifica al file è immediatamente visibile al container al riavvio,
> senza dover ricostruire l'immagine.

---

## Configurazione stampanti

Le stampanti fisiche sono definite in **`printers.config.js`**. Ogni voce mappa
un `id` (usato dal frontend in `appConfig.printers[].id`) a una connessione fisica.

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

### Tipi di connessione

| `type` | Parametri richiesti | Uso tipico |
|---|---|---|
| `tcp` | `host`, `port` (def. 9100), `timeout` (def. 5000ms) | Stampante di rete |
| `file` | `device` (es. `/dev/usb/lp0`) | Stampante USB Linux |

### Routing per printerId

Quando arriva un job con `printerId: 'cucina'`, il server cerca la voce con `id: 'cucina'`
in `printers.config.js` e la usa. Se non trovata, viene usata la **prima stampante** come fallback.

Questo rispecchia esattamente il comportamento del frontend: `appConfig.printers[].id` nel
frontend deve corrispondere all'`id` nella voce di `printers.config.js`.

---

## Variabili d'ambiente

| Variabile | Default | Descrizione |
|---|---|---|
| `PORT` | `3001` | Porta HTTP del server |
| `PRINT_SERVER_NAME` | `ESC/POS Print Server` | Nome nei log |
| `PRINT_SERVER_API_KEY` | *(vuoto)* | Se impostata, ogni `POST /print` deve includere `x-api-key: <valore>` |
| `CORS_ALLOWED_ORIGINS` | *(vuoto — tutte le origini)* | Origini CORS consentite (virgola separata). Se vuota, tutte le origini sono accettate. |

> I parametri di connessione alle stampanti (host, porta, dispositivo) si configurano direttamente in `printers.config.js`.

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
