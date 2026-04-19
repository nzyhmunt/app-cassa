# Scenari di Conflitto Offline/Online — Simulazioni e Strategie

Data: 2026-04-19  
Repository: `nzyhmunt/app-cassa`

## 1) Contesto attuale (baseline)

L’app è **offline-first** con:
- stato locale su IndexedDB;
- coda `sync_queue` per push verso Directus;
- retry con backoff;
- replay cronologico della coda.

Questa base è robusta contro micro-disconnessioni, ma in conflitti multi-dispositivo non garantisce da sola una risoluzione semantica (es. due device offline che modificano lo stesso tavolo).

---

## 2) Simulazioni dei principali scenari di conflitto

> Nota: “tutti i possibili scenari” viene trattato per **classi complete di conflitto** (creazione concorrente, update concorrente, transizioni di stato, pagamenti, merge/split tavoli, eliminazioni, retry duplicati, ordine eventi fuori sequenza).

### S1 — Stesso tavolo aperto da due device entrambi offline

**Simulazione**
1. Device A offline apre tavolo `T12` → `bill_session A`.
2. Device B offline apre tavolo `T12` → `bill_session B`.
3. Entrambi aggiungono ordini.
4. Tornano online e pushano.

**Rischio**
- Due sessioni aperte sullo stesso tavolo.
- Ordini e coperti divergenti.

**Soluzione proposta**
- Vincolo logico server: max 1 `bill_session` open per tavolo.
- Se arriva la seconda apertura: segnare conflitto `table_conflict`.
- UI Cassa: modal obbligatoria “Risolvi conflitto tavolo” con opzioni:
  - unisci sessioni (default consigliato);
  - annulla sessione secondaria;
  - sposta sessione secondaria su altro tavolo.
- Audit trail obbligatorio della decisione operatore.

---

### S2 — Ordine modificato su due device offline (stesse righe)

**Simulazione**
1. A e B hanno lo stesso ordine locale.
2. A cambia quantità item X; B voida item X.
3. Reconnect di A e B in ordine variabile.

**Rischio**
- “Last write wins” cieco perde una delle due modifiche.

**Soluzione proposta**
- Passare da update “snapshot” a operazioni **commutative**:
  - `add_quantity(+n)`, `void_quantity(+n)` (mai set assoluto quando offline).
- Risoluzione server per campi quantitativi: merge additivo con limiti di dominio.
- Per campi non commutativi (note testuali), usare:
  - LWW con `updated_at` + `device_id`;
  - storico revisioni consultabile.

---

### S3 — Transizioni di stato ordine concorrenti e fuori sequenza

**Simulazione**
1. A manda `accepted → preparing`.
2. B (in ritardo) manda `accepted → rejected` oppure `pending → accepted`.
3. Arrivano fuori ordine.

**Rischio**
- Regressione di stato non valida.

**Soluzione proposta**
- Definire grafo transizioni consentite lato server.
- Ogni mutazione include `expected_previous_status`.
- Se mismatch: reject con `409 STATUS_CONFLICT`.
- Client: refetch ordine + prompt “Risolvi stato”.
- Regola suggerita: stati terminali (`completed`, `rejected`) non retrocedono senza azione amministrativa esplicita.

---

### S4 — Pagamenti concorrenti sullo stesso conto

**Simulazione**
1. A registra pagamento parziale offline.
2. B registra saldo totale offline sullo stesso `bill_session`.
3. Reconnect.

**Rischio**
- Overpayment, doppio incasso, chiusura anticipata.

**Soluzione proposta**
- Trattare i pagamenti come ledger append-only (mai update in-place).
- Vincolo server: `sum(transactions) <= total_due + tolleranza`.
- Se superato: transazione in stato `conflict_hold`.
- UI Cassa mostra “eccedenza da riconciliare” prima di chiudere tavolo.

---

### S5 — Chiusura tavolo su device A, nuovo ordine offline su device B

**Simulazione**
1. A chiude conto e tavolo.
2. B, rimasto offline con stato vecchio, aggiunge ordine.
3. B torna online.

**Rischio**
- Ordine agganciato a sessione già chiusa.

**Soluzione proposta**
- Server rifiuta insert ordine su `bill_session.status != open`.
- Client, su 409, propone:
  - riapri sessione (permesso admin);
  - crea nuova sessione tavolo;
  - sposta ordine su altro tavolo.

---

### S6 — Merge/Split tavoli concorrente

**Simulazione**
1. A fa merge `T10 -> T11` offline.
2. B apre/usa T10 offline.
3. Reconnect.

**Rischio**
- Tavolo sorgente usato dopo merge; mapping incoerente.

**Soluzione proposta**
- Introdurre `table_topology_version`.
- Ogni op (open order/payment) porta la versione vista dal client.
- Se versione obsoleta: reject con richiesta di rebase locale (refetch + remap guidato).

---

### S7 — Duplicati da retry dopo timeout (operazione già applicata)

**Simulazione**
1. Client invia create, timeout rete.
2. Ritenta; la prima era andata a buon fine.

**Rischio**
- Doppio inserimento.

**Soluzione proposta**
- Idempotency key per ogni mutazione (`mutation_id` UUIDv7).
- Unique index server su `mutation_id`.
- Retry restituisce stesso risultato senza duplicare record.

---

### S8 — Delete/archiviazione concorrente con update

**Simulazione**
1. A archivia record.
2. B modifica stesso record offline.
3. Reconnect.

**Rischio**
- “Zombie update” su record archiviato.

**Soluzione proposta**
- Tombstone/version check server:
  - se record archiviato, update respinto con 409;
  - client mostra scelta: ripristina record o scarta modifica locale.

---

### S9 — Conflitto impostazioni dispositivo (`app_settings`)

**Simulazione**
1. Due device cambiano impostazioni condivise venue quasi simultaneamente.

**Rischio**
- Sovrascrittura silenziosa.

**Soluzione proposta**
- Separare chiaramente:
  - setting globali venue;
  - setting locali device.
- Per globali: optimistic concurrency con `version` incrementale.
- Per locali: namespace per `device_key` (nessun conflitto cross-device).

---

### S10 — Print job duplicati/ordine errato dopo reconnessione

**Simulazione**
1. Più eventi stampa accodati offline.
2. Retry multipli al ritorno online.

**Rischio**
- Doppie stampe o sequenza non corretta.

**Soluzione proposta**
- Print job idempotente con chiave business (`order_id + print_type + progressive`).
- Stato job atomico (`pending -> printing -> done/error`) con lock server-side.
- Ristampa solo tramite endpoint esplicito, non via retry cieco.

---

### S11 — Drift temporale tra device (clock skew)

**Simulazione**
1. Device A è avanti di 4 minuti.
2. LWW basato solo su timestamp locale.

**Rischio**
- Vittoria sistematica del device con orologio errato.

**Soluzione proposta**
- Ordinamento conflitti con:
  1) `server_received_at` (fonte autorevole),
  2) `logical_counter` per device,
  3) fallback `device_id`.

---

### S12 — Partizione lunga + molte mutazioni correlate

**Simulazione**
1. Device resta offline ore.
2. Esegue workflow completo (apertura, ordini, pagamenti, chiusura).
3. Reconnect quando il tavolo è già stato gestito altrove.

**Rischio**
- Raffica di conflitti a cascata.

**Soluzione proposta**
- Sync in due fasi:
  - **Phase A**: dry-run validazione mutazioni (senza commit) con report conflitti.
  - **Phase B**: commit solo mutazioni compatibili; conflitti in coda “manual review”.
- UI operatore con wizard di riconciliazione per batch.

---

## 3) Politica di risoluzione consigliata (ordine di priorità)

1. **Idempotenza sempre** (no duplicati).
2. **Invarianti di dominio lato server** (un tavolo non può avere due sessioni open).
3. **Merge automatico solo per dati commutativi** (quantità, ledger append-only).
4. **Conflitti semantici in coda manuale** (chiusure, merge tavoli, stato finale).
5. **Audit trail** completo (chi ha deciso, quando, perché).

---

## 4) Proposta implementativa incrementale

### Step 1 (quick win)
- `mutation_id` su tutte le mutazioni pushate.
- Errori 409 standardizzati (`STATUS_CONFLICT`, `VERSION_CONFLICT`, `TABLE_CONFLICT`).
- UI banner “Conflitti da risolvere”.

### Step 2
- `version` per record critici (`bill_sessions`, `orders`, `tables` topology).
- `expected_previous_status` nelle transizioni stato ordine.
- Reject deterministico dei salti di stato.

### Step 3
- Endpoint/server action di riconciliazione guidata (merge sessioni tavolo).
- Wizard Cassa per risolvere conflitti batch.

### Step 4
- Telemetria: tasso conflitti, tempo medio risoluzione, classi più frequenti.
- Hardening UX con playbook operativo per il personale.

---

## 5) Caso richiesto esplicitamente: “stesso tavolo aperto da due device offline”

**Esito raccomandato al rientro online**
- Il sistema non deve scegliere silenziosamente un vincitore.
- Deve bloccare la chiusura del tavolo e chiedere riconciliazione guidata.
- Default operativo: **unione sessioni** con audit, mantenendo tutte le comande valide e segnalando eventuali duplicati/pagamenti eccedenti.

