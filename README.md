# Terminale Cassa & Sala - Osteria del Grillo

Questo progetto è un'applicazione web POS (Point of Sale) progettata per ristoranti e attività di ristorazione. Realizzato con **Vue 3**, offre una gestione completa di sala, comande, cassa e reportistica, con supporto PWA per l'utilizzo come app nativa su dispositivi mobili e desktop.

## Architettura — Tre Entry Point, un Codebase

Il progetto contiene due applicazioni operative più una pagina di selezione, tutte condivise su un unico store Pinia e le stesse utilità:

| App | Entry | URL locale | Pubblico |
|-----|-------|-----------|---------|
| Launcher | `index.html` | `/` | Selezione modalità (Cassa / Sala) |
| **Cassa** | `cassa.html` → `src/cassa-main.js` | `/cassa.html` | Cassiere / gestione |
| **Sala** | `sala.html` → `src/sala-main.js` | `/sala.html` | Personale di sala |

```
src/
├── components/
│   ├── shared/                        ← Componenti riutilizzati da entrambe le app
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
│   ├── SalaNavbar.vue                 ← Navigazione (Sala)
│   ├── SalaTableManager.vue           ← Mappa sala semplificata (Sala only)
│   ├── SalaOrderManager.vue           ← Creazione/invio comande (Sala only)
│   └── SalaSettingsModal.vue          ← Impostazioni Sala (usa shared/SettingsModal)
├── composables/
│   ├── useBeep.js                     ← Notifiche audio (Web Audio API)
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
│   └── sala/                          ← View Sala
│       ├── SalaView.vue               ← Mappa sala (vista Sala)
│       └── SalaOrderView.vue          ← Creazione comande (Sala)
```

### Aggiungere un nuovo componente condiviso

1. Crea il file in `src/components/shared/`.
2. Importalo in entrambi i componenti con `import X from './shared/X.vue'`.
3. Le modifiche al componente si rifletteranno automaticamente su entrambe le app.

---

## Funzionalità Principali

### 🗺️ Mappa Sala (Cassa & Sala)
- Visualizzazione in tempo reale dei tavoli con 4 stati distinti:
  - **Libero** — tavolo disponibile
  - **Ordini in Attesa** — comande inviate, in attesa di accettazione (badge ambra)
  - **Occupato** — ordini accettati / in preparazione
  - **Conto Richiesto** — cliente ha richiesto il conto (badge blu)
- Apertura del tavolo con selezione coperti (adulti + bambini) e anteprima del coperto
- Operazioni avanzate su tavoli (solo Cassa):
  - **Sposta tavolo**: trasferisce tutti gli ordini e le transazioni a un altro tavolo
  - **Unisci tavoli**: combina due tavoli, somma coperti e sessioni di conto

### 📋 Gestione Ordini (Cassa)
- Visualizzazione ordini suddivisa in tre tab: **In Attesa**, **In Cucina**, **Chiusi**
- Accettazione e rifiuto ordini in attesa
- Modifica quantità sugli ordini in attesa (aumento / riduzione per riga)
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

### ⚙️ Impostazioni (Cassa & Sala)
- Abilitazione/disabilitazione avvisi audio
- Abilitazione/disabilitazione blocco schermo (Wake Lock)
- Configurazione URL menu JSON remoto e sincronizzazione manuale
- Reset completo dei dati con conferma (fine turno)

### 🌐 Menu Dinamico
- Caricamento del menu da URL remoto (`menu.json`) all'avvio
- Categorie, prezzi, varianti/modificatori, allergeni, ingredienti
- Sincronizzazione manuale dalle impostazioni
- Fallback al menu di default in caso di errore

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

L'app sarà disponibile su `http://localhost:5173`. Le tre entry point sono accessibili a:
- `/` — Launcher (selezione Cassa / Sala)
- `/cassa.html` — Terminale Cassa
- `/sala.html` — Terminale Sala