# ESC/POS Print Server

Servizio Node.js che riceve i job di stampa da **app-cassa** tramite HTTP POST,
li converte in comandi ESC/POS e li invia alla stampante termica.

---

## Requisiti

- **Node.js ≥ 20**
- Una stampante termica compatibile ESC/POS (rete TCP o USB)

---

## Installazione

```bash
cd print-server
npm install
```

---

## Configurazione

Copia il file di esempio e adattalo al tuo ambiente:

```bash
cp .env.example .env
```

### Variabili d'ambiente

| Variabile | Default | Descrizione |
|---|---|---|
| `PORT` | `3001` | Porta HTTP del server |
| `PRINTER_TYPE` | `tcp` | Tipo connessione: `tcp` (rete) oppure `file` (USB/parallela) |
| `PRINTER_HOST` | `127.0.0.1` | IP/hostname della stampante (solo TCP) |
| `PRINTER_PORT` | `9100` | Porta TCP della stampante (solo TCP) |
| `PRINTER_TCP_TIMEOUT_MS` | `5000` | Timeout connessione TCP in ms |
| `PRINTER_DEVICE` | `/dev/usb/lp0` | Percorso dispositivo USB (solo `file`) |
| `PRINT_SERVER_NAME` | `ESC/POS Print Server` | Nome nei log |

### Esempio — stampante di rete

```bash
PRINTER_TYPE=tcp
PRINTER_HOST=192.168.1.100
PRINTER_PORT=9100
PORT=3001
```

### Esempio — stampante USB Linux

```bash
PRINTER_TYPE=file
PRINTER_DEVICE=/dev/usb/lp0
PORT=3001
```

---

## Avvio

```bash
# Con variabili nel file .env
npm start

# Oppure passando direttamente le variabili
PRINTER_HOST=192.168.1.100 npm start

# Modalità sviluppo (riavvio automatico)
npm run dev
```

Il server partirà e mostrerà in console:

```
[print-server] ESC/POS Print Server in ascolto su http://localhost:3001
[print-server] Stampante: TCP  → 192.168.1.100:9100
[print-server] Endpoint: POST http://localhost:3001/print
```

---

## API

### `GET /health`

Verifica che il servizio sia attivo.

**Risposta:**
```json
{ "status": "ok", "service": "ESC/POS Print Server" }
```

---

### `POST /print`

Riceve un job di stampa JSON, lo converte in ESC/POS e lo invia alla stampante.

**Corpo (JSON):** il payload del job generato da `usePrintQueue.js`.

**Risposta di successo (200):**
```json
{ "ok": true, "jobId": "job_<uuid>" }
```

**Risposta di errore (400 / 500):**
```json
{ "ok": false, "error": "messaggio di errore" }
```

---

## Tipi di stampa supportati

### `order` — Comanda cucina/bar

```json
{
  "jobId": "job_abc",
  "printType": "order",
  "printerId": "cucina",
  "table": "05",
  "time": "20:15",
  "globalNote": "Allergie: arachidi",
  "items": [
    {
      "name": "Bruschetta",
      "quantity": 2,
      "notes": ["Senza aglio"],
      "course": "prima",
      "modifiers": [{ "name": "Extra mozzarella", "price": 1.00 }]
    }
  ]
}
```

**Stampa risultante:**
```
        TAVOLO 05
          20:15
          CUCINA
------------------------------------------
2x Bruschetta
  >> Senza aglio
  + Extra mozzarella
  [prima]
------------------------------------------
```

---

### `table_move` — Spostamento tavolo

```json
{
  "jobId": "job_abc",
  "printType": "table_move",
  "fromTableLabel": "01",
  "toTableLabel": "02"
}
```

---

### `pre_bill` — Preconto

```json
{
  "jobId": "job_abc",
  "printType": "pre_bill",
  "table": "05",
  "items": [
    { "name": "Bruschetta", "quantity": 2, "unitPrice": 3.00, "subtotal": 6.00 }
  ],
  "grossAmount": 6.00,
  "paymentsRecorded": 0,
  "amountDue": 6.00
}
```

---

## Struttura file

```
print-server/
├── server.js              # Entry point: server HTTP Express
├── printer.js             # Connessione stampante (TCP / file)
├── escpos.js              # Generatore comandi ESC/POS (nessuna dipendenza esterna)
├── formatters/
│   ├── order.js           # Formatter comanda cucina/bar
│   ├── table_move.js      # Formatter spostamento tavolo
│   └── pre_bill.js        # Formatter preconto
├── package.json
├── .env.example
└── README.md
```

---

## Integrazione con app-cassa

In `src/utils/index.js`, la stampante demo è già configurata sulla porta `3001`:

```js
printers: [
  {
    id: 'demo',
    name: 'Stampante Demo',
    url: 'http://localhost:3001/print',
  },
],
```

Avviare questo server nella stessa macchina (o rete locale) dove gira l'app,
aggiornare `PRINTER_HOST` con l'IP della stampante fisica e il sistema è operativo.

---

## Nota sulla codifica caratteri

Il server codifica il testo in **Latin-1 (ISO-8859-1)**, la codifica più comune
per le stampanti termiche ESC/POS. I caratteri non rappresentabili vengono
sostituiti con `?`. Se la propria stampante usa una pagina di codice diversa
(es. CP437, CP850), è possibile personalizzare la funzione `encodeText` in `escpos.js`.
