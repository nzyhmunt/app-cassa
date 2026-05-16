# Terminale Cassa, Sala & Cucina - Ristorante

Questo progetto è un'applicazione web POS (Point of Sale) progettata per ristoranti e attività di ristorazione. Realizzato con **Vue 3**, offre una gestione completa di sala, comande, cassa, cucina e reportistica, con supporto PWA per l'utilizzo come app nativa su dispositivi mobili e desktop.

## Documentazione tecnica aggiuntiva

- [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) — schema dati e relazioni Directus
- [docs/GUIDA_UTENTE.md](./docs/GUIDA_UTENTE.md) — guida operativa per Cassa/Sala/Cucina
- [docs/SCENARI_CONFLITTI_OFFLINE.md](./docs/SCENARI_CONFLITTI_OFFLINE.md) — simulazioni rete instabile e strategie di risoluzione conflitti

## Architettura — Tre Entry Point, un Codebase

Il progetto contiene tre applicazioni operative più una pagina di selezione, con architettura dati a layer:
- `DEFAULT_SETTINGS` statici immutabili (fallback)
- IndexedDB come source of truth locale
- Due store Pinia separati (`useConfigStore`, `useOrderStore`) con facade `useAppStore`
- Sync Directus asincrona su IndexedDB

| App | Entry | URL locale | Pubblico |
|-----|-------|-----------|---------|
| Launcher | `index.html` | `/` | Selezione modalità (Cassa / Sala / Cucina) |
| **Cassa** | `cassa.html` → `src/cassa-main.js` | `/cassa.html` | Cassiere / gestione |
| **Sala** | `sala.html` → `src/sala-main.js` | `/sala.html` | Personale di sala |
| **Cucina** | `cucina.html` → `src/cucina-main.js` | `/cucina.html` | Display cucina |

```
src/
├── components/
│   ├── shared/                        ← Componenti riutilizzati dalle app
│   │   ├── DishInfoModal.vue          ← Modale dettaglio piatto (foto, allergeni, HTML sanificato)
│   │   ├── GlobalOrderNoteModal.vue   ← Modale nota globale ordine con toggle visibilità per app
│   │   ├── InvoiceModal.vue           ← Modale dati fattura (form + validazione condivisa tra Cassa e Storico)
│   │   ├── OrderItemsList.vue         ← Pannello voci ordine (portate, quantità, note, modificatori)
│   │   ├── OrderSidebarCard.vue       ← Card ordine nella lista laterale (stato, importo, pezzi)
│   │   ├── OrderStatusBadge.vue       ← Pill stato ordine colorata (pending → rejected)
│   │   ├── PeopleModal.vue            ← Modale conteggio coperti + anteprima coperto
│   │   ├── PrintHistoryModal.vue      ← Cronologia e ristampa lavori di stampa
│   │   ├── PwaInstallBanner.vue       ← Banner installazione PWA (Android + iOS)
│   │   ├── SettingsModal.vue          ← Modale impostazioni condivisa (Cassa, Sala e Cucina)
│   │   ├── TableGrid.vue              ← Griglia pulsanti tavolo con timer trascorso e slot #status
│   │   └── TableStatsBar.vue          ← Pillole stato tavoli (Liberi / Occupati / In Attesa / Conto Rich. / Saldati) con filtro click
│   ├── CassaNavbar.vue                ← Navigazione (Cassa)
│   ├── CassaTableManager.vue          ← Mappa sala + cassa + checkout (Cassa only)
│   ├── CassaOrderManager.vue          ← Gestione ordini + accettazione (Cassa only)
│   ├── CassaDashboard.vue             ← Fondo cassa, movimenti, report X/Z (Cassa only)
│   ├── CassaBillCard.vue              ← Card riepilogo conto chiuso (Cassa only)
│   ├── CassaSettingsModal.vue         ← Impostazioni Cassa (thin wrapper su shared/SettingsModal)
│   ├── LockScreen.vue                 ← Overlay blocco schermo con tastierino PIN
│   ├── UserManagementModal.vue        ← Gestione utenti e configurazione blocco automatico
│   ├── NumericKeyboard.vue            ← Tastiera numerica a scomparsa (overlay bottom-sheet, Cassa only)
│   ├── NumericInput.vue               ← Wrapper input numerico (nativo o tastiera custom, Cassa only)
│   ├── SalaNavbar.vue                 ← Navigazione (Sala)
│   ├── SalaTableManager.vue           ← Mappa sala semplificata (Sala only)
│   ├── SalaOrderManager.vue           ← Creazione/invio comande (Sala only)
│   ├── SalaSettingsModal.vue          ← Impostazioni Sala (thin wrapper su shared/SettingsModal)
│   └── CucinaSettingsModal.vue        ← Impostazioni Cucina (thin wrapper su shared/SettingsModal)
├── composables/
│   ├── printDispatch.js               ← Trasporto job di stampa: HTTP diretto o passaggio a Directus (tcp/file)
│   ├── printJobBuilders.js            ← Costruzione payload ESC/POS per ogni tipo di job (ordini, pre-conto, ecc.)
│   ├── useAppClock.js                 ← Orologio reattivo HH:MM (it-IT), aggiornato ogni secondo
│   ├── useAppSwipeRefresh.js          ← Gestione pull-to-refresh su mobile
│   ├── useAuth.js                     ← Autenticazione utenti, PIN hashing, auto-lock timer
│   ├── useBeep.js                     ← Notifiche audio (Web Audio API)
│   ├── useDirectusClient.js           ← Client Directus configurato (SDK singleton)
│   ├── useDirectusSync.js             ← Orchestratore alto livello della sincronizzazione Directus
│   ├── useIDB.js                      ← Connessione IndexedDB singleton (apertura DB, tutti gli ObjectStore)
│   ├── useIDBPurge.js                 ← Pulizia periodica IndexedDB (vecchi ordini, dead-letter queue, print log)
│   ├── useNumericKeyboard.js          ← Singleton state per la tastiera numerica custom (Cassa only)
│   ├── usePrintQueue.js               ← Orchestrazione coda di stampa comande (usa printJobBuilders + printDispatch)
│   ├── usePwaInstall.js               ← Rilevamento installazione PWA
│   ├── useSettings.js                 ← Lettura/scrittura impostazioni (IndexedDB)
│   ├── useSyncQueue.js                ← Gestione coda sync offline verso Directus (ObjectStore sync_queue)
│   ├── useSyncStoreProxy.js           ← Proxy reattivo per esporre lo store Pinia ai moduli di sync
│   ├── useWakeLock.js                 ← Prevenzione blocco schermo (Screen Wake Lock API)
│   └── sync/                          ← Moduli interni della sincronizzazione Directus
│       ├── config.js                  ← Costanti e configurazioni (field sets, quirks, intervalli)
│       ├── echoSuppression.js         ← Soppressione echo per evitare ri-applicazione locale dei propri write
│       ├── globalPull.js              ← Pull completo venue (configurazione, menu, sale, tavoli)
│       ├── idbOperations.js           ← Operazioni IDB atomiche (upsert, merge, delete ordini e articoli)
│       ├── index.js                   ← Entry point del modulo sync (esporta hook pubblici)
│       ├── leaderElection.js          ← Elezione leader fra tab per il sync Directus (BroadcastChannel)
│       ├── mapper.js                  ← Mapping payload Directus → formato locale per il pull
│       ├── pullQueue.js               ← Worker pull incrementale (ordini, transazioni, sessioni)
│       ├── pushQueue.js               ← Drain della sync queue verso Directus (retry, conflict handling)
│       ├── state.js                   ← State reattivo condiviso del modulo sync
│       ├── storebridge.js             ← Bridge sync → store Pinia (hydrate, pre-bill printers, callbacks)
│       └── wsManager.js               ← WebSocket Directus Realtime (live updates e riconnessione)
├── store/
│   ├── idbPersistence.js              ← Implementazione completa della persistenza IDB
│   ├── persistence/
│   │   ├── config.js                  ← Barrel di re-export per persistenza configurazione venue/menu/sale/tavoli
│   │   ├── operations.js              ← Barrel di re-export per dati operativi (ordini/transazioni/sessioni)
│   │   └── audit.js                   ← Barrel di re-export per audit stampa/ricevute fiscali/fatture
│   ├── index.js                       ← Store facade + split store (`useConfigStore`, `useOrderStore`)
│   └── persistence.js                 ← Schema versioning, `clearState` (@deprecated)
├── utils/
│   ├── index.js                       ← Default statici + funzioni di calcolo condivise
│   ├── mappers.js                     ← Mapping centralizzato Directus (snake_case) ↔ locale (camelCase)
│   └── pwaManifest.js                 ← Iniezione logo custom nei manifest PWA
├── views/
│   ├── cassa/                         ← View Cassa
│   │   ├── CassaTableView.vue         ← Mappa sala (vista Cassa)
│   │   ├── OrdersView.vue             ← Gestione ordini (Cassa)
│   │   └── BillHistoryView.vue        ← Storico conti (Cassa)
│   ├── sala/                          ← View Sala
│   │   ├── SalaView.vue               ← Mappa sala (vista Sala)
│   │   └── SalaOrderView.vue          ← Creazione comande (Sala)
│   └── cucina/                        ← View Cucina
│       ├── CucinaView.vue             ← Kanban/Dettaglio/Cronologia tabs (Cucina)
│       └── KitchenOrderCard.vue       ← Card comanda cucina (riutilizzata da tutte le tab)
```

### Aggiungere un nuovo componente condiviso

1. Crea il file in `src/components/shared/`.
2. Importalo nei componenti che ne hanno bisogno con `import X from './shared/X.vue'`.
3. Le modifiche al componente si rifletteranno automaticamente su tutte le app.

---

## Funzionalità Principali

### 🗺️ Mappa Sala (Cassa & Sala)
- Visualizzazione in tempo reale dei tavoli con **5 stati distinti**:
  - **Libero** — tavolo disponibile
  - **Occupato** — ordini accettati / in preparazione / pronti
  - **In Attesa** — comande inviate, in attesa di accettazione (badge ambra)
  - **Conto Richiesto** — cliente ha richiesto il conto (badge blu, solo Cassa)
  - **Saldato** — importo totalmente pagato ma tavolo non ancora chiuso (badge viola)
- Supporto **multi-sala**: configurazione `rooms` raggruppa i tavoli per sala; tab *Tutti* + tab per sala; filtri stato funzionano su tutte le sale contemporaneamente
- Apertura del tavolo con selezione coperti (adulti + bambini) e anteprima del coperto
- Operazioni avanzate su tavoli (Cassa & Sala):
  - **Sposta tavolo**: trasferisce tutti gli ordini e le transazioni a un altro tavolo libero
  - **Unisci tavoli**: combina due tavoli occupati, somma coperti e sessioni di conto

### 📋 Gestione Ordini (Cassa)
- Visualizzazione ordini suddivisa in tre tab: **In Attesa**, **In Cucina**, **Chiusi**
  - La tab *In Cucina* mostra gli stati attivi: `accepted`, `preparing` (In Cottura 🔥), `ready` (Pronta 🔔) con divisore **"Consegnate"** per ordini `delivered`
- Accettazione e rifiuto ordini in attesa
- Modifica quantità sugli ordini in attesa (aumento / riduzione per riga)
- **Override "Consegnata"** per ordini in `accepted`, `preparing`, `ready`: forza lo stato a `delivered` senza passare per la cucina
- **Storno articoli** sugli ordini accettati:
  - Storno parziale o totale per riga
  - Storno per modificatore singolo
  - Ripristino articoli stornati
- Creazione nuovi ordini dal pannello menu (solo Cassa)

### ⚡ Aggiunta Diretta al Conto (Cassa)

Permette di aggiungere voci al conto di un tavolo **senza passare per la cucina**, ideale per caffè al banco, coperto aggiuntivo, servizi o voci dimenticate.

- **Pulsante "⚡ Diretto"** nel pannello Riepilogo Voci, posizionato prima del pulsante "+ Comanda"
- **Modale con due tab**:
  - **Dal Menu** — griglia navigabile per categoria; tap su un articolo lo aggiunge al carrello (tap multipli incrementano la quantità)
  - **Personalizzata** — form compatto (nome + prezzo + "Aggiungi") per voci libere non collegate al menu
    - Le voci inserite vengono auto-salvate in `localStorage` per riutilizzo rapido con un tap
    - Icona ✕ (visibile all'hover) per eliminare singole voci salvate
    - Le voci salvate vengono cancellate al **Ripristina dati di default** nelle impostazioni
    - La tab "Personalizzata" può essere disabilitata con `appConfig.billing.allowCustomEntry: false`
- **Carrello condiviso** con controlli quantità (+/−), totale in tempo reale e pulsante "Aggiungi al Conto"
- L'ordine creato ha `isDirectEntry: true` e viene immediatamente impostato a `accepted`, risultando visibile nel conto senza approvazione cucina
- **Identificazione visiva**: badge `⚡ Diretta` (tema app) nelle viste Per Voce e Per Ordine

### 🍽️ Creazione Comande (Sala)
- Interfaccia dedicata per il personale di sala
- Navigazione per categorie menu con selezione piatti
- Aggiunta note per variazioni / richieste speciali
- Invio comanda al sistema (diventa ordine `pending` per la Cassa)
- Navigazione rapida alla lista comande attive per tavolo
- Tab *In Cucina* per il monitoraggio degli ordini attivi in cucina (`accepted`, `preparing`, `ready`) con divisore **"Consegnate"** per ordini `delivered`
- Pulsante **"Consegnata"** per ordini `accepted`, `preparing`, `ready` → imposta stato `delivered` (conto resta aperto)

### 👨‍🍳 App Cucina — Display Cucina

Applicazione dedicata al personale di cucina con un **kanban board a 3 colonne**, un flusso di preparazione a 5 fasi e una **vista tripla con tabs**:

```
pending → accepted → preparing → ready → delivered → completed
```

| Fase | Stato | Azione | Colonna Kanban |
|------|-------|--------|----------------|
| Comanda inviata | `pending` | — (visibile solo in Cassa) | — |
| Accettata da Cassa | `accepted` | Inizia preparazione | Da Preparare |
| In cottura | `preparing` | Segna pronta | In Cottura |
| Pronta | `ready` | ✓ Consegnata | Pronte |
| Consegnata | `delivered` | — (conto resta aperto) | Cronologia |
| Saldata | `completed` | — (solo pagamento) | — |

**Transizioni inverse supportate nel Kanban:**
- `preparing` → `accepted` (torna a Da Preparare)
- `ready` → `preparing` (torna in cottura)
- `accepted` → `pending` (rimanda in sala / annulla accettazione)

**Caratteristiche:**
- Header identico a Cassa e Sala (tema teal, contatori colorati, orologio, pulsante Config)
- Ogni card mostra: avatar tavolo, stato badge, ora ordine, tempo trascorso (verde/ambra/rosso)
- Piatti raggruppati per portata: **Esce Prima** (arancione) · **Insieme** (teal) · **Esce Dopo** (viola)
- **Strikethrough voci**: segna singoli piatti come pronti (sincronizzato tra Kanban e Dettaglio)
- **Avvisi audio** all'arrivo di nuovi ordini in cucina
- **Schermo sempre acceso** tramite Screen Wake Lock API
- **Reset dati** dalle impostazioni

#### Tab Kanban (default)
- 3 colonne: **Da Preparare** · **In Cottura** · **Pronte**
- Ogni card ha il pulsante avanzamento stato + pulsante ← (icona, stessa riga) per tornare allo stato precedente
- Colonna "Da Preparare": pulsante "Rimanda in sala" per restituire l'ordine alla Cassa

#### Tab Dettaglio
- Lista piatta di tutte le comande attive (accepted / preparing / ready)
- Colore bordo/header card riflette lo stato kanban (amber / arancione / teal)
- Voci raggruppate per portata con intestazioni colorate (stesso stile del Kanban)
- Toggle ✓ (checkbox a destra) per marcare singoli piatti come pronti
- Pulsante "Consegnata" per forzare lo stato a `delivered`

#### Tab Cronologia
- Lista read-only degli ordini `delivered`, piatti raggruppati per portata, ordinati dal più recente

### 💳 Cassa & Pagamenti
- **Quattro modalità di pagamento**:
  - **Unico**: saldo completo del tavolo in un'unica transazione
  - **Alla Romana**: divisione equa tra N persone con pagamento parziale o multiplo di quote
  - **Per Ordine**: selezione manuale degli ordini da saldare
  - **Analitica**: selezione voce-per-voce con stepper di quantità (es. 1 su 2 coperti); include variazioni a pagamento e voci dirette; registra `vociRefs` (chiave + quantità) nella transazione per tracciabilità precisa
- **Metodi di pagamento** configurabili (default: Contanti e POS/Carta)
- **Calcolatore resto** per pagamenti in contanti (importo ricevuto → resto da dare)
- **Mancia** configurabile su ogni transazione
- **Sconti** applicabili per percentuale o importo fisso, con anteprima dell'importo
- Chiusura automatica del tavolo al saldo completo (configurabile, default disattivata)
- **Chiusura conto**: tre pulsanti nella barra di chiusura dopo il saldo completo:
  - **Chiudi** — chiusura senza documento fiscale
  - **Fiscale** — emette scontrino fiscale XML (protocollo RT printer) e chiude il tavolo
  - **Fattura** — apre il modale dati fattura (`InvoiceModal`) per la fatturazione elettronica e chiude il tavolo

### 🧾 Scontrino Fiscale & Fattura

Funzionalità disponibile sia in **cassa live** (al momento della chiusura del conto) sia dallo **Storico Conti** (per conti già chiusi senza documento fiscale).

**Scontrino Fiscale:**
- Costruisce un payload XML nel protocollo RT printer (`<printerFiscalReceipt>`) con le voci del conto (quantità, prezzi unitari)
- Rileva automaticamente il tipo di pagamento (contanti = `0`, carta/POS = `2`)
- Registra la richiesta in `store.fiscalReceipts` (persistita su IDB e **sincronizzata su Directus** `fiscal_receipts` via sync queue) con stato `pending`

**Fattura elettronica:**
- Modale condiviso (`shared/InvoiceModal.vue`) con form dati intestatario:
  - Denominazione / Ragione Sociale, Codice Fiscale, P.IVA
  - Indirizzo, CAP, Comune, Provincia, Paese
  - Codice SDI (7 caratteri alfanumerici) e/o PEC
- Tutti i campi hanno `id` e `<label for>` corrispondenti per accessibilità screen-reader e click-to-focus
- Validazione integrata nel componente (obbligo CF o PIVA, CAP 5 cifre, SDI o PEC almeno uno)
- Registra la richiesta in `store.invoiceRequests` (persistita su IDB e **sincronizzata su Directus** `invoice_requests` via sync queue) con stato `pending`
- I dati validati vengono emessi dal modale via `@confirm(billingData)` al componente padre

### 💰 Gestione Cassa (CassaDashboard)
- Impostazione **fondo cassa** iniziale con preset rapidi (€50, €100, €150, €200)
- Registrazione **movimenti di cassa** (versamenti e prelievi) con causale e timestamp
- **Report X** (anteprima giornaliera senza reset): totale incassato, breakdown per metodo di pagamento, mance, sconti, numero conti, scontrino medio, coperti serviti
- **Chiusura di giornata (Report Z)**: archivia il riepilogo, azzera transazioni e movimenti, aggiorna il saldo cassa

### 🗒️ Storico Conti
- Vista dedicata con tutti i conti chiusi della sessione
- Riepilogo per sessione di conto: tavolo, coperti, orario chiusura, totale, mance, sconti
- Dettaglio espandibile di ogni transazione (metodo, importo, orario)
- Statistiche aggregate: conti chiusi, incasso totale, scontrino medio
- **Aggiunta mancia postuma**: possibile aggiungere una mancia a un conto già chiuso
- **Scontrino Fiscale / Fattura postumi**: se un conto è stato chiuso senza documento fiscale, dallo storico è possibile:
  - **Fiscale** — emettere lo scontrino fiscale XML (stessa logica della cassa live); doppio click protetto da guard sincrono
  - **Fattura** — aprire il modale `InvoiceModal` e creare la richiesta fattura; flag `_invoiceSubmitting` previene invii duplicati
  - I pulsanti sono visibili solo dopo il completamento dell'idratazione IDB (`store.fiscalInvoiceHydrated`), evitando duplicati nel breve intervallo post-reload in cui le collezioni sono ancora vuote
  - I pulsanti sono visibili solo se non è già stato emesso un documento per quel conto; altrimenti compare un badge "Fiscale emesso" / "Fattura emessa"

### 🔔 Notifiche Audio
- Suono "ding" (Web Audio API) alla ricezione di nuovi ordini
- Configurabile per Cassa e Sala indipendentemente
- Utilizza le impostazioni dell'istanza corretta in ambienti multi-istanza

### 📱 PWA — Progressive Web App
- **Banner di installazione** per Android (prompt nativo) e iOS (istruzioni "Aggiungi a Home")
- Nascosto automaticamente se l'app è già installata (modalità standalone)
- **Screen Wake Lock**: previene il blocco schermo nel terminale mentre l'app è in uso
  - Riacquisizione automatica al rientro dalla schermata di blocco
  - Configurabile dalle impostazioni
- Manifesti dedicati per Cassa e Sala con icone 192×192 e 512×512
- Logo personalizzato iniettabile nei manifesti tramite configurazione build (`appConfig.pwaLogo`)

### 💾 Persistenza & Multi-Istanza
- **Persistenza automatica** su **IndexedDB** (`useIDB.js` + `idbPersistence.js`):
  - Ordini, transazioni, sessioni tavoli, movimenti di cassa, chiusure giornaliere, log stampe, ricevute fiscali, richieste fattura
  - Coda sync (`sync_queue`) e storico diagnostico delle chiamate fallite (`sync_failed_calls`) con request/response copiabili da UI
  - Serializzazione Set↔Array per `billRequestedTables`
  - **Scritture IDB-first**: `addOrder`, `addItemsToOrder`, `addCashMovement`, `addDirectOrder`, `addCashTransaction` persistono su IndexedDB prima di aggiornare il reactive state — garantisce consistenza anche in caso di crash durante l'applicazione degli update
  - Ogni watcher aggiorna solo il proprio store senza toccare gli altri
  - Dati demo al primo avvio
- **Schema versionato** (`SCHEMA_VERSION`): incremento automatico al cambio struttura
- **Recupero da corruzione**: fallback a stato vuoto se i dati sono invalidi
- **Multi-istanza** — più terminali sullo stesso dispositivo/dominio con storage completamente isolato:
  - Configurazione a build time tramite `appConfig.instanceName`
  - Database IDB con suffisso `_<instanceName>`
- **Sincronizzazione cross-tab in tempo reale**: tutte e tre le app (`CassaApp`, `SalaApp`, `CucinaApp`) ascoltano l'evento `window.storage`. Qualsiasi modifica di stato in una tab (es. cambio stato ordine in Cucina) viene propagata alle altre tab aperte sullo stesso dispositivo ricaricando lo stato operativo (`useOrderStore`) e la configurazione/menu (`useConfigStore`) da IndexedDB.
- **Swipe-down refresh (mobile/tablet)**: su Cassa/Sala/Cucina il gesto verso il basso avvia un refresh manuale. Se Directus è abilitato esegue una riapplicazione completa (configurazione + pull dati), altrimenti aggiorna solo da IndexedDB. L'indicatore visivo rimane visibile per un breve hold (`REFRESH_DONE_HOLD_MS`) dopo il completamento, garantendo feedback percettibile anche su refresh rapidi; annulla correttamente il timer se il componente viene smontato durante il hold.

### ⌨️ Tastiera Numerica Personalizzata (Cassa only)
- Overlay a scomparsa dal basso (`NumericKeyboard.vue`) che sostituisce la tastiera del dispositivo per tutti i campi numerici della Cassa
- Singleton gestito da `useNumericKeyboard.js` — un solo overlay per app, condiviso da tutti i componenti
- Configurabile dalle Impostazioni Cassa: **Off · Centro · Sinistra · Destra** (larghezza massima `max-w-sm` su schermi grandi)
- `NumericInput.vue` — wrapper trasparente: in modalità `disabled` usa `<input type="number">` nativo; nelle altre modalità usa un campo readonly che apre l'overlay
- Il campo sconto supporta un toggle `%`/`€` integrato dentro la tastiera virtuale; il toggle rimane visibile nella riga del campo anche quando la tastiera personalizzata è disattivata
- Valore del setting: `'disabled' | 'center' | 'left' | 'right'` (costante `KEYBOARD_POSITIONS` da `utils/index.js`); qualsiasi valore non valido viene trattato come `'disabled'`

### ⚙️ Impostazioni (Cassa, Sala & Cucina)
- Abilitazione/disabilitazione avvisi audio ("Ding" alla ricezione di nuovi ordini)
- Abilitazione/disabilitazione blocco schermo (Wake Lock) — **attivo di default** al primo avvio
- Configurazione sorgente menu:
  - `json`: mostra URL configurato e pulsante di sincronizzazione manuale
  - `directus`: mostra stato sincronizzazione Directus (`Directus disabilitato` · `Sincronizzazione in corso` · `Errore sincronizzazione` · `Directus attivo`)
- **Gestione Utenti & Blocco Schermo**: accesso rapido alla configurazione del sistema di autenticazione
- Reset completo dei dati con conferma (fine turno) — cancella anche tutti i dati di autenticazione

### 🌐 Menu Dinamico
- Caricamento del menu da URL remoto (`menu.json`) all'avvio
- Categorie, prezzi, varianti/modificatori, allergeni, ingredienti
- Sincronizzazione manuale dalle impostazioni
- Fallback al menu di default in caso di errore

### 🔐 Autenticazione & Blocco Schermo

Sistema di autenticazione opzionale a PIN numerico disponibile su tutte e tre le app (Cassa, Sala, Cucina). Quando non ci sono utenti configurati, l'accesso è libero e il sistema è completamente trasparente.

**Comportamento:**
- Se non ci sono utenti → accesso libero; le impostazioni permettono di creare il primo utente
- Il **primo utente creato manualmente** diventa automaticamente **amministratore**
- L'amministratore può: aggiungere/modificare/eliminare utenti, configurare il blocco automatico e scegliere a quali app ogni utente può accedere
- Gli utenti non-admin vedono la gestione in sola lettura
- Il blocco si attiva automaticamente dopo un periodo di inattività configurabile (Mai / 1 / 2 / 5 / 10 / 15 / 30 min)
- Lo schermo si ri-blocca sempre ad ogni ricaricamento della pagina

**Sicurezza:**
- I PIN sono hashati con **SHA-256** (Web Crypto API) prima di essere salvati; il testo in chiaro non viene mai persistito
- Gli utenti configurati tramite `appConfig.auth.users` sono in sola lettura nell'UI; il loro PIN viene hashato in memoria e mai scritto in IndexedDB

**Accesso per-app:**
- In Directus, ogni utente `venue_users` ha il campo `apps` (array JSON) con valori tra `admin`, `cassa`, `sala`, `cucina`
- Se `apps` contiene `admin`, l'utente ottiene automaticamente accesso completo a `cassa`, `sala` e `cucina`
- La lock screen mostra solo gli utenti abilitati per l'app corrente
- Un utente con accesso solo a `cucina` non compare nella lock screen di Cassa o Sala

**Reset dati:** la funzione "Ripristina dati di default" cancella anche tutti i dati di autenticazione (utenti, sessioni, impostazioni di blocco).

---

## Configurazione (`src/utils/index.js`)

```js
export const appConfig = {
  ui: { name: "Ristorante", primaryColor: "#00846c", currency: "€" },
  menuUrl: 'https://nanawork.it/menu.json',    // URL menu remoto (configurabile)
  instanceName: '',                            // Multi-istanza (es. 'cassa1')
  pwaLogo: '',                                 // URL logo custom per PWA manifest

  paymentMethods: [                            // Metodi di pagamento configurabili
    { id: 'cash',  label: 'Contanti',  icon: 'banknote'     },
    { id: 'card',  label: 'Pos/Carta', icon: 'credit-card'  },
  ],

  tables: [ /* 12 tavoli con id, label, covers */ ],

  coverCharge: {                               // Coperto automatico
    enabled: true,
    autoAdd: true,
    priceAdult: 2.50,
    priceChild: 1.00,
  },

  billing: {
    enableCashChangeCalculator: true,          // Calcolatore resto contanti
    enableTips: true,                          // Mancia
    enableDiscounts: true,                     // Sconti
    allowCustomEntry: true,                    // false → nasconde tab "Personalizzata" nel modal Diretto
  },

  // Utenti statici opzionali (configurazione a build time, sola lettura nell'UI)
  // pin: 4 cifre numeriche (hashato in memoria, mai persistito)
  // apps: app abilitate; omettere per abilitare tutte e tre le app
  auth: {
    users: [
      // { id: 'mario', name: 'Mario', pin: '1234', apps: ['cassa', 'sala'] },
      // { id: 'chef',  name: 'Chef',  pin: '5678', apps: ['cucina'] },
    ],
  },

  // Coda di stampa comande — ciascuna stampante punta a un servizio Node ESC/POS.
  // Stampante di prova attiva per default (catch-all); sostituire con la configurazione
  // del locale prima del deployment in produzione. Impostare a [] per disabilitare la stampa.
  // categories: categorie del menu instradate su questa stampante (case-insensitive).
  // Se assente o vuoto, la stampante riceve tutte le voci (catch-all).
  printers: [
    { id: 'demo', name: 'Stampante Demo', url: 'http://localhost:3001/print' },
    // { id: 'cucina', name: 'Cucina', url: 'http://localhost:3001/print',
    //   printTypes: ['order'], categories: ['Antipasti', 'Primi', 'Secondi', 'Contorni'] },
    // { id: 'bar', name: 'Bar', url: 'http://localhost:3002/print',
    //   printTypes: ['order'], categories: ['Bevande', 'Digestivi'] },
    // { id: 'cassa', name: 'Cassa', url: 'http://localhost:3003/print',
    //   printTypes: ['pre_bill', 'table_move'] },
  ],
};
```

### Sincronizzazione Directus — applicazione completa post-salvataggio

Nel modale impostazioni (sezione **Sincronizzazione Directus**), dopo il pulsante **Salva** viene ora mostrata una conferma operativa che permette di:

- avviare una **riapplicazione completa** della configurazione da Directus;
- scegliere se **svuotare prima tutta la cache configurazione locale** (venues/rooms/tables/menu/printers/venue_users + cursori `last_pull_ts:*`);
- visualizzare nel modale un **log step-by-step** delle operazioni (pull collezioni, idratazione, applicazione) con dettaglio errori.

Questa procedura è pensata per i casi di riconfigurazione sostanziale (nuovo endpoint/token/venue) e forza un pull globale completo prima di applicare la nuova configurazione all'app.

### Sync queue — collezioni push-only

Le seguenti collezioni sono **push-only** (nessun pull da Directus): vengono create localmente con UUID v7 e inviate in background tramite `drainQueue()` della sync queue.

| Collezione | Evento locale | Note |
|------------|---------------|-------|
| `print_jobs` | Ogni job di stampa inviato | `id` UUID v7 standard (PK Directus); `logId` (`plog_<uuid>`) è l'identificatore locale / keyPath IndexedDB |
| `fiscal_receipts` | Chiusura conto con scontrino fiscale | FK `venue` diretto; dipende da `bill_sessions` |
| `invoice_requests` | Chiusura conto con fattura elettronica | FK `venue` diretto; dipende da `bill_sessions` |

I record di queste collezioni non vengono mai hard-delete da Directus — il ciclo di vita è gestito tramite il campo `status`.

---

## Stampa Comande (ESC/POS)

La coda di stampa automatica è gestita da tre moduli cooperanti:

- `src/composables/usePrintQueue.js` — orchestrazione: sceglie le stampanti e avvia i job
- `src/composables/printJobBuilders.js` — costruisce i payload ESC/POS per ogni tipo di job
- `src/composables/printDispatch.js` — trasporta il job (HTTP diretto o passaggio a Directus per stampanti `tcp`/`file`)

Quando un ordine viene accettato (dalla Cassa o dalla Sala), `enqueuePrintJobs(order)` invia
una HTTP POST a ciascun servizio stampante configurato. Il servizio Node
ricevente gestisce la comunicazione ESC/POS verso la stampante fisica.

Ogni lavoro di stampa viene registrato in `store.printLog` (persistito su IDB e **sincronizzato
su Directus** `print_jobs` via sync queue). I job HTTP seguono lo stato `pending → printing → done | error`;
i job gestiti da Directus (`connection_type = 'tcp' | 'file'`) restano `pending` su Directus ma vengono
marcati localmente come `queued` nell'interfaccia per indicare il passaggio di consegna al dispatcher.
Ogni entry ha un `id` (UUID v7, PK Directus) e un `logId` (`plog_<uuid>`, keyPath IDB).

**Sorgente unica per le stampanti:** tutti i consumer (componenti Vue, sync bridge) devono leggere
le stampanti tramite il computed `configStore.printers` (esposto da `useConfigStore`), mai leggendo
direttamente `appConfig.printers` o `configStore.config?.printers`. Questo garantisce reattività
Pinia e coerenza pre/post idratazione.

### Stampante demo (pronta per il test)

La configurazione predefinita include una **stampante demo catch-all** attiva sulla porta `3001`:

```js
// src/utils/index.js — appConfig
printers: [
  {
    id: 'demo',
    name: 'Stampante Demo',
    url: 'http://localhost:3001/print',
    // printTypes assente → catch-all (riceve order, table_move, pre_bill)
    // categories assente  → catch-all (riceve tutte le voci del menu)
  },
],
```

Per usarla in locale, avviare il servizio Node ESC/POS sulla porta `3001`:

```bash
cd print-server
npm install
# Configurare le stampanti in printers.config.js, poi:
npm start
```

Per la documentazione completa del server di stampa vedere [`print-server/README.md`](print-server/README.md).

### Estensione Directus — Print Dispatcher

È disponibile un'estensione Directus che legge direttamente le collezioni `printers` e `print_jobs`
e **stampa fisicamente sulla stampante di rete** (via TCP) o su device locale (via file/USB) **senza
alcun print-server esterno**. Ideale per deployment dove Directus si trova sulla stessa LAN delle
stampanti.

Funziona in due modalità complementari:

- **Hook `items.create`**: dispatch immediato ogni volta che un `print_job` con stato `pending`
  viene creato (tipicamente via sync offline-first del frontend).
- **Scheduler** (ogni minuto, configurabile): recupero dei job `pending` rimasti indietro
  (es. Directus era in restart al momento della creazione).

> **Prerequisito**: le stampanti devono avere `connection_type = 'tcp'` o `'file'` nella
> collezione `printers` di Directus. Le stampanti con `connection_type = 'http'` vengono
> ignorate dall'estensione (vengono gestite dal print-server HTTP).

Per installare l'estensione copia la cartella in `extensions/hooks/` di Directus:

```bash
cp -r directus-extensions/hooks/print-dispatcher /path/to/directus/extensions/hooks/
```

Oppure, con Docker Compose, monta il volume nel servizio Directus:

```yaml
volumes:
  - ./directus-extensions/hooks/print-dispatcher:/directus/extensions/hooks/print-dispatcher:ro
```

Per la documentazione completa vedere [`directus-extensions/hooks/print-dispatcher/README.md`](directus-extensions/hooks/print-dispatcher/README.md).

**Prima del deployment in produzione**, sostituire con la configurazione del locale.

### Configurazione multi-stampante

```js
printers: [
  { id: 'cucina', name: 'Cucina', url: 'http://localhost:3001/print',
    printTypes: ['order'],
    categories: ['Antipasti', 'Primi', 'Secondi', 'Contorni'] },
  { id: 'bar', name: 'Bar', url: 'http://localhost:3002/print',
    printTypes: ['order'],
    categories: ['Bevande', 'Digestivi'] },
  { id: 'cassa', name: 'Cassa', url: 'http://localhost:3003/print',
    printTypes: ['pre_bill', 'table_move'] },
],
```

Ogni stampante accetta:
- **`printTypes`**: tipi di lavoro ricevuti — `'order'`, `'table_move'`, `'pre_bill'`; assente/vuoto = catch-all
- **`categories`**: categorie menu (solo per tipo `'order'`); assente/vuoto = tutte le voci

### Tipi di stampa

| Tipo | Evento | Fonte |
|------|--------|-------|
| `order` | Comanda accettata | `CassaOrderManager` / `SalaOrderManager` |
| `table_move` | Tavolo spostato | `CassaTableManager` → Sposta Tavolo |
| `pre_bill` | Preconto inviato | `CassaTableManager` → Preconto |

### Cronologia stampe e ristampa (Cassa)

Il pulsante **"Stampe"** nella barra della Mappa Sala (visibile solo con stampanti configurate)
apre la cronologia di tutti i lavori inviati, con stato (`in coda`, `stampa…`, `inviato`, `errore`)
e possibilità di ristampare su qualsiasi stampante configurata.

### Stampante preconto predefinita

Nelle **Impostazioni Cassa** → sezione "Stampante Preconto" è possibile scegliere la stampante
su cui inviare automaticamente il preconto. La sezione è visibile se esiste almeno una
stampante idonea a ricevere job `pre_bill`: una stampante che ha `pre_bill` nei `printTypes`,
oppure una stampante "catch-all" con `printTypes` assente o vuoto. Sono incluse sia le stampanti
HTTP sia quelle gestite da Directus (`tcp` / `file`), purché abbiano un `id` stabile.

### Formato del job di stampa

Tutti i job contengono: `id`, `logId`, `jobId`, `printType`, `printerId`, `table`, `timestamp`.

- **`id`** — UUID v7 (nessun prefisso): chiave primaria Directus, generata insieme al `logId`
- **`logId`** — `plog_<uuid>`: keyPath dell'ObjectStore IDB, usato per lookup locali e cronologia

**`order`** (comanda):
```json
{
  "jobId": "job_<uuid>", "printType": "order", "printerId": "cucina",
  "orderId": "ord_<uuid>", "table": "05", "time": "20:15", "globalNote": "",
  "items": [
    { "name": "Bruschetta", "quantity": 2, "unitPrice": 3.00,
      "notes": ["Senza aglio"], "course": "prima",
      "modifiers": [{ "name": "Extra mozzarella", "price": 1.00 }] }
  ]
}
```

**`table_move`** (spostamento tavolo):
```json
{
  "jobId": "job_<uuid>", "printType": "table_move", "printerId": "cassa",
  "fromTableId": "T1", "fromTableLabel": "01", "toTableId": "T2", "toTableLabel": "02",
  "table": "01 → 02"
}
```

**`pre_bill`** (preconto): include il payload completo del conto (tavolo, importi, voci).

### Comportamento

- **Routing per categoria**: ogni stampante riceve solo le voci il cui `dishId` appartiene
  a una delle categorie elencate in `categories` (confronto case-insensitive).
- **Catch-all**: se `categories` è assente o vuoto, la stampante riceve tutte le voci.
- **Routing condiviso**: selezione stampanti, selezione stampante preconto e risoluzione `printerId`/`url`
  usano helper comuni, così HTTP e Directus seguono le stesse regole di matching.
- **Fire-and-forget**: gli errori di rete vengono loggati in console ma non bloccano l'UI.
- **Canale di dispatch**:
  - stampanti HTTP (`url` presente e non `tcp`/`file`) → POST diretto dal browser
  - stampanti Directus (`connectionType = 'tcp' | 'file'`) → enqueue su `print_jobs` con endpoint activity `/items/print_jobs`
- **Stato job**:
  - HTTP: `pending → printing → done | error`
  - Directus: `pending` su Directus + `queued` solo in UI locale
- **Voci stornate**: solo le quantità attive (non stornate) vengono incluse nel job.
- **Ordini diretti** (`isDirectEntry: true`): non vengono mai stampati (coperti, voci libere).

---

## Tecnologia Utilizzata

| Libreria | Versione | Utilizzo |
|----------|---------|---------|
| **Vue 3** | 3.5 | Framework UI, Composition API |
| **Pinia** | 3.0 | Gestione stato globale |
| **fake-indexeddb** | — | Polyfill IDB per i test Vitest |
| **Vue Router** | 4.6 | Navigazione multi-view |
| **TailwindCSS** | 4.2 | Styling utility-first |
| **Lucide Vue Next** | 0.577 | Icone SVG |
| **DOMPurify** | 3.3 | Sanitizzazione XSS contenuti menu |
| **Vite** | 7.3 | Build tool + dev server |

---

## Come Avviare il Progetto

```bash
# Clona il repository
git clone https://github.com/nzyhmunt/app-cassa.git

# Spostati nella directory del progetto
cd app-cassa

# Installa le dipendenze
npm install

# Avvia in modalità sviluppo
npm run dev

# Build produzione
npm run build

# Esegui i test
npm run test
```

L'app sarà disponibile su `http://localhost:5173`. Le quattro entry point sono accessibili a:
- `/` — Launcher (selezione Cassa / Sala / Cucina)
- `/cassa.html` — Terminale Cassa
- `/sala.html` — Terminale Sala
- `/cucina.html` — Display Cucina
## © Copyright

Copyright (c) 2026 nzyhmunt. **Tutti i diritti riservati.**

Qualsiasi utilizzo, copia, modifica o distribuzione di questo software è **espressamente vietata** senza autorizzazione scritta dell'autore. Vedere il file [LICENSE](./LICENSE) per i dettagli.
