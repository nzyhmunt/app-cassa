# Terminale Cassa & Sala - Osteria del Grillo

Questo progetto è un'applicazione web progettata per essere utilizzata come gestionale di cassa e sala per ristoranti e attività di ristorazione. Realizzato con **Vue.js**, l'app integra una gestione intuitiva della sala, degli ordini e delle impostazioni generali, offrendo un'interfaccia moderna e reattiva.

## Architettura — Due App, un Codebase

Il progetto contiene due applicazioni separate che condividono lo stesso store e le stesse utilità:

| App | Entry | URL locale | Pubblico |
|-----|-------|-----------|---------|
| **Cassa** | `index.html` → `src/main.js` | `/` | Cassiere / gestione |
| **Cameriere** | `waiter.html` → `src/waiter-main.js` | `/waiter.html` | Personale di sala |

```
src/
├── components/
│   ├── shared/                  ← Componenti riutilizzati da entrambe le app
│   │   └── PeopleModal.vue      ← Modale conteggio coperti (Cassa + Cameriere)
│   ├── TableManager.vue         ← Mappa sala + cassa (Cassa only)
│   ├── OrderManager.vue         ← Gestione ordini + accettazione (Cassa only)
│   ├── WaiterTableManager.vue   ← Mappa sala semplificata (Cameriere only)
│   ├── WaiterOrderManager.vue   ← Creazione/invio comande (Cameriere only)
│   ├── Navbar.vue               ← Navigazione (Cassa)
│   └── WaiterNavbar.vue         ← Navigazione (Cameriere)
├── store/index.js               ← Pinia store condiviso (unica sorgente di verità)
├── utils/index.js               ← Configurazione + funzioni di calcolo condivise
├── views/                       ← View Cassa
└── views/waiter/                ← View Cameriere
```

### Aggiungere un nuovo componente condiviso

1. Crea il file in `src/components/shared/`.
2. Importalo in entrambi i componenti con `import X from './shared/X.vue'`.
3. Le modifiche al componente si rifletteranno automaticamente su entrambe le app.

## Funzionalità Principali

### Interfaccia Sala
- Visualizzazione della mappa dei tavoli con stato aggiornato in tempo reale: `Libero`, `Ordini in Attesa`, e `Occupato/In Cassa`.
- Pulsanti attivi per ogni tavolo che permettono di accedere ai dettagli specifici, come gli ordini associati e il numero di coperti.
- Navigazione immediata alla gestione degli ordini.

### Interfaccia Ordini
- Gestione degli ordini suddivisa in tre stati:
  - **In Attesa**: Mostra gli ordini da accettare.
  - **In Cucina**: Visualizza gli ordini in preparazione.
  - **Chiusi**: Elenco degli ordini completati.
- Filtri efficienti delle categorie e possibilità di selezionare singoli ordini per ulteriori dettagli.

### Toolbar e Navigazione
- Pulsanti per cambiare rapidamente tra la vista della sala e degli ordini.
- Barra di navigazione per accedere alle impostazioni e testare rapidamente l'applicazione con ordini simulati.

### Modal Impostazioni
- Configurazione di opzioni come:
  - Stampa automatica delle comande accettate in cucina.
  - Abilitazione degli avvisi audio per nuovi ordini.
- Sincronizzazione manuale del database del menu.

## Tecnologia Utilizzata
- **Vue.js**: Framework principale per lo sviluppo client-side.
- **Pinia**: Gestione dello stato globale dell'applicazione.
- **TailwindCSS**: Framework CSS per uno stile moderno e reattivo.
- **Vite**: Strumento di build per lo sviluppo rapido.

## Come Avviare il Progetto
Per avviare l'applicazione in ambiente di sviluppo, segui questi passaggi:

```bash
# Clona il repository
git clone https://github.com/nzyhmunt/demo-apps.git

# Spostati nella directory del progetto
cd demo-apps

# Installa le dipendenze
npm install

# Avvia l'applicazione
npm run dev
```

L'app sarà disponibile su `http://localhost:3000`. Puoi iniziare a esplorare le funzionalità direttamente dal browser.