# Terminale Cassa, Sala & Cucina - Osteria del Grillo

Questo progetto è un'applicazione web POS (Point of Sale) progettata per ristoranti e attività di ristorazione. Realizzato con **Vue 3**, offre una gestione completa di sala, comande, cassa, cucina e reportistica, con supporto PWA per l'utilizzo come app nativa su dispositivi mobili e desktop.

## Architettura — Tre Entry Point, un Codebase

Il progetto contiene tre applicazioni operative più una pagina di selezione, tutte condivise su un unico store Pinia e le stesse utilità:

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
│   │   ├── PeopleModal.vue            ← Modale conteggio coperti + anteprima coperto
│   │   ├── PwaInstallBanner.vue       ← Banner installazione PWA (Android + iOS)
│   │   └── SettingsModal.vue          ← Modale impostazioni condivisa (Cassa e Sala)
│   ├── CassaNavbar.vue                ← Navigazione (Cassa)
│   ├── CassaTableManager.vue          ← Mappa sala + cassa + checkout (Cassa only)
│   ├── CassaOrderManager.vue          ← Gestione ordini + accettazione (Cassa only)
│   ├── CassaDashboard.vue             ← Fondo cassa, movimenti, report X/Z (Cassa only)
│   ├── CassaBillCard.vue              ← Card riepilogo conto chiuso (Cassa only)
│   ├── CassaClosedBillsList.vue       ← Lista conti chiusi sessione (Cassa only)
│   ├── CassaSettingsModal.vue         ← Impostazioni Cassa (usa shared/SettingsModal)
│   ├── LockScreen.vue                 ← Overlay blocco schermo con tastierino PIN
│   ├── UserManagementModal.vue        ← Gestione utenti e configurazione blocco automatico
│   ├── NumericKeyboard.vue            ← Tastiera numerica a scomparsa (overlay bottom-sheet, Cassa only)
│   ├── NumericInput.vue               ← Wrapper input numerico (nativo o tastiera custom, Cassa only)
│   ├── SalaNavbar.vue                 ← Navigazione (Sala)
│   ├── SalaTableManager.vue           ← Mappa sala semplificata (Sala only)
│   ├── SalaOrderManager.vue           ← Creazione/invio comande (Sala only)
│   ├── SalaSettingsModal.vue          ← Impostazioni Sala (usa shared/SettingsModal)
│   └── CucinaSettingsModal.vue        ← Impostazioni Cucina (audio + wake lock + utenti)
├── composables/
│   ├── useAuth.js                     ← Autenticazione utenti, PIN hashing, auto-lock timer
│   ├── useBeep.js                     ← Notifiche audio (Web Audio API)
│   ├── useNumericKeyboard.js          ← Singleton state per la tastiera numerica custom (Cassa only)
│   ├── usePwaInstall.js               ← Rilevamento installazione PWA
│   ├── useSettings.js                 ← Lettura/scrittura impostazioni localStorage
│   └── useWakeLock.js                 ← Prevenzione blocco schermo (Screen Wake Lock API)
├── store/
│   ├── index.js                       ← Pinia store condiviso (unica sorgente di verità)
│   └── persistence.js                 ← Chiavi localStorage, schema versioning, clearState
├── utils/
│   ├── index.js                       ← Configurazione app + funzioni di calcolo condivise
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
- Visualizzazione in tempo reale dei tavoli con 4 stati distinti:
  - **Libero** — tavolo disponibile
  - **Ordini in Attesa** — comande inviate, in attesa di accettazione (badge ambra)
  - **Occupato** — ordini accettati / in preparazione / pronti
  - **Conto Richiesto** — cliente ha richiesto il conto (badge blu)
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
- **Tre modalità di pagamento**:
  - **Unico**: saldo completo del tavolo in un'unica transazione
  - **Alla Romana**: divisione equa tra N persone con pagamento parziale o multiplo di quote
  - **Per Ordine**: selezione manuale degli ordini da saldare
- **Metodi di pagamento** configurabili (default: Contanti e POS/Carta)
- **Calcolatore resto** per pagamenti in contanti (importo ricevuto → resto da dare)
- **Mancia** configurabile su ogni transazione
- **Sconti** applicabili per percentuale o importo fisso, con anteprima dell'importo
- Chiusura automatica del tavolo al saldo completo (configurabile)

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
- **Persistenza automatica** in `localStorage` via `pinia-plugin-persistedstate`:
  - Ordini, transazioni, sessioni tavoli, movimenti di cassa, chiusure giornaliere
  - Serializzazione Set↔Array per `billRequestedTables`
  - Dati demo al primo avvio
- **Schema versionato** (`SCHEMA_VERSION`): incremento automatico al cambio struttura
- **Recupero da corruzione**: fallback a stato vuoto se il JSON è invalido
- **Multi-istanza** — più terminali sullo stesso dispositivo/dominio con storage completamente isolato:
  - Configurazione a build time tramite `appConfig.instanceName`
  - Chiavi localStorage con suffisso `_<instanceName>`
- **Sincronizzazione cross-tab in tempo reale**: tutte e tre le app (`CassaApp`, `SalaApp`, `CucinaApp`) ascoltano l'evento `window.storage`. Qualsiasi modifica di stato in una tab (es. cambio stato ordine in Cucina) viene propagata istantaneamente alle altre tab aperte sullo stesso dispositivo tramite `store.$hydrate()`.

### ⌨️ Tastiera Numerica Personalizzata (Cassa only)
- Overlay a scomparsa dal basso (`NumericKeyboard.vue`) che sostituisce la tastiera del dispositivo per tutti i campi numerici della Cassa
- Singleton gestito da `useNumericKeyboard.js` — un solo overlay per app, condiviso da tutti i componenti
- Configurabile dalle Impostazioni Cassa: **Off · Centro · Sinistra · Destra** (larghezza massima `max-w-sm` su schermi grandi)
- `NumericInput.vue` — wrapper trasparente: in modalità `disabled` usa `<input type="number">` nativo; nelle altre modalità usa un campo readonly che apre l'overlay
- Il campo sconto supporta un toggle `%`/`€` integrato dentro la tastiera virtuale; il toggle rimane visibile nella riga del campo anche quando la tastiera personalizzata è disattivata
- Valore del setting: `'disabled' | 'center' | 'left' | 'right'` (costante `KEYBOARD_POSITIONS` da `utils/index.js`); qualsiasi valore non valido viene trattato come `'disabled'`

### ⚙️ Impostazioni (Cassa, Sala & Cucina)
- Abilitazione/disabilitazione avvisi audio ("Ding" alla ricezione di nuovi ordini)
- Abilitazione/disabilitazione blocco schermo (Wake Lock)
- Configurazione URL menu JSON remoto e sincronizzazione manuale (Cassa e Sala)
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
- Gli utenti configurati tramite `appConfig.auth.users` sono in sola lettura nell'UI; il loro PIN viene hashato in memoria e mai scritto in `localStorage`

**Accesso per-app:**
- Ogni utente ha un campo `apps: ['cassa', 'sala', 'cucina']` che indica le app a cui può accedere
- La lock screen mostra solo gli utenti abilitati per l'app corrente
- Un utente con accesso solo a `cucina` non compare nella lock screen di Cassa o Sala

**Reset dati:** la funzione "Ripristina dati di default" cancella anche tutti i dati di autenticazione (utenti, sessioni, impostazioni di blocco).

---

## Configurazione (`src/utils/index.js`)

```js
export const appConfig = {
  ui: { name: "Osteria del Grillo", primaryColor: "#00846c", currency: "€" },
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
    autoCloseOnFullPayment: true,              // Chiusura automatica a saldo
    enableCashChangeCalculator: true,          // Calcolatore resto contanti
    enableTips: true,                          // Mancia
    enableDiscounts: true,                     // Sconti
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
};
```

---

## Tecnologia Utilizzata

| Libreria | Versione | Utilizzo |
|----------|---------|---------|
| **Vue 3** | 3.5 | Framework UI, Composition API |
| **Pinia** | 3.0 | Gestione stato globale |
| **pinia-plugin-persistedstate** | 4.7 | Persistenza automatica localStorage |
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