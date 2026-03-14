# 🚀 Miglioramenti Funzionali Proposti — Terminale Cassa, Sala & Cucina

Analisi del repository `nzyhmunt/app-cassa` — sistema POS multi-app per l'**Osteria del Grillo**, costruito con **Vue 3 + Pinia + Tailwind CSS 4**, con tre entry point indipendenti (Cassa, Sala, Cucina) e persistenza su `localStorage`.

> ✅ Le funzionalità già realizzate (menu dinamico, allergeni, immagini, timestamp ordini, calcolo resto, riepilogo turno, coperti dinamici, persistenza) sono state rimosse da questo documento.

---

## 🔍 1. Ricerca/filtro piatti nel menu

**Problema attuale:** per trovare un piatto bisogna navigare manualmente per categoria. Con menu ricchi (Pinse, Contorni, Dolci, ecc.) questo rallenta l'inserimento dell'ordine.

**Miglioramento:** aggiungere una barra di ricerca testuale nel modale menu (Sala e Cassa) che filtra i piatti in tempo reale su **tutte le categorie** contemporaneamente, mostrando risultati raggruppati per categoria.

**Impatto:** Sala e Cassa — `SalaOrderManager.vue`, `CassaOrderManager.vue`

---

## 🔔 2. Pannello notifiche/storico audio

**Problema attuale:** il "ding" suona, ma non c'è traccia visiva degli ordini arrivati mentre si era su un'altra schermata o un'altra app. Il personale di cassa non sa quanti ordini sono stati ricevuti in sua assenza.

**Miglioramento:** aggiungere un badge con contatore nell'header della Cassa e un mini-log a comparsa che mostri gli ultimi ordini arrivati con orario e numero tavolo. Il contatore si azzera al clic (come una inbox).

**Impatto:** Cassa — `CassaNavbar.vue`, `CassaApp.vue`

---

## 🖨️ 3. Stampa comanda/scontrino reale

**Problema attuale:** il pulsante "Accetta & Stampa" cambia solo lo stato dell'ordine; non produce nessuna stampa fisica né PDF. Non esiste nemmeno un CSS `@media print` che renda leggibile la pagina se stampata manualmente.

**Miglioramento:**
- Aggiungere un layout CSS `@media print` dedicato (comanda cucina e pre-conto cliente).
- Chiamare `window.print()` al clic su "Accetta & Stampa" e al momento del pagamento finale.
- Il layout di stampa deve omettere la navigazione e mostrare: tavolo, coperti, lista piatti con quantità, totale e metodo di pagamento.

**Impatto:** Cassa — `CassaOrderManager.vue`, `CassaTableManager.vue`

---

## 🗑️ 4. Conferma prima di rifiutare un ordine

**Problema attuale:** il pulsante "Rifiuta" su un ordine pending lo porta immediatamente allo stato `rejected` senza alcuna conferma. È facile colpirlo per errore su dispositivi touch.

**Miglioramento:** mostrare un breve dialog/modal di conferma (es. "Sei sicuro di voler rifiutare questo ordine?") prima di eseguire `changeOrderStatus(order, 'rejected')`. Il dialog può essere la stessa struttura dei modali già presenti nel progetto.

**Impatto:** Cassa — `CassaOrderManager.vue`

---

## 🖼️ 5. Immagini dei piatti nella griglia menu

**Problema attuale:** le immagini (`immagine_url`) sono già mostrate nel modale di dettaglio piatto (bottone ℹ️), ma **non** nella griglia principale del menu. Le card mostrano solo nome e prezzo, rendendo la selezione meno intuitiva su dispositivi touch.

**Miglioramento:** mostrare un'anteprima dell'immagine nelle card della griglia (thumbnail quadrato in alto, con fallback a un'icona neutra se `immagine_url` è assente). L'ingombro aggiuntivo può essere contenuto ridimensionando le card.

**Impatto:** Sala e Cassa — `SalaOrderManager.vue`, `CassaOrderManager.vue`

---

## 📊 6. Vista "All-Day" in Cucina

**Problema attuale:** la Cucina mostra ogni comanda singolarmente (Kanban per tavolo). Non esiste una visione aggregata che indichi quante porzioni dello stesso piatto devono essere preparate in totale — fondamentale per ottimizzare le cotture.

**Miglioramento:** aggiungere una quarta tab "Totali" (o un pannello laterale) nella vista Cucina che mostri un riepilogo quantitativo: `Carbonara × 5`, `Bruschetta × 3`, ecc. filtrabile per stato (solo ordini attivi vs. tutti). Riusa `groupOrderItemsByCourse()` già esportato da `src/utils/index.js`.

**Impatto:** Cucina — `CucinaView.vue`

---

## 🔊 7. Suoni differenziati per evento

**Problema attuale:** `useBeep.js` produce un unico suono ("ding") per tutti gli eventi. Non è possibile distinguere a orecchio se è arrivato un nuovo ordine, se un cliente ha richiesto il conto, o se un piatto è pronto in cucina.

**Miglioramento:** arricchire `useBeep.js` con almeno tre varianti:
- **Tono breve** — nuovo ordine in arrivo (Cassa/Cucina)
- **Doppio ding** — richiesta conto da Sala
- **Tono lungo** — piatto pronto in cucina (notifica Sala)

Ogni suono è generato con la Web Audio API già in uso, variando frequenza e durata.

**Impatto:** `src/composables/useBeep.js`, Cassa, Sala, Cucina

---

## 💾 8. Migrazione da `localStorage` a `IndexedDB`

**Problema attuale:** la persistenza usa `localStorage` (limite ~5–10 MB). Un turno intenso con molti ordini, storni e transazioni può avvicinarsi al limite, causando perdita silenziosa di dati. Il `TODO` è già documentato in `src/store/persistence.js` e `src/store/index.js`.

**Miglioramento:** sostituire `localStorage` con `IndexedDB` tramite la libreria `idb-keyval` (leggera, già prevista nei TODO del codice), mantenendo la stessa API `persist` di Pinia. `IndexedDB` offre storage virtualmente illimitato e operazioni asincrone non-bloccanti.

**Impatto:** `src/store/persistence.js`, `src/store/index.js`

---

## 📤 9. Export Report X/Z in PDF / CSV

**Problema attuale:** il pannello "Lettura X" in `CassaDashboard.vue` mostra le statistiche del turno a schermo, ma non esiste un modo per esportarle o archiviarle. Chiudendo il turno (Report Z) i dati vengono cancellati.

**Miglioramento:**
- Aggiungere un pulsante "Esporta PDF" che stampi solo il riquadro del report via `window.print()` con CSS `@media print` dedicato.
- Aggiungere un pulsante "Esporta CSV" che generi un file scaricabile con i dati delle transazioni chiuse del turno.

**Impatto:** Cassa — `CassaDashboard.vue`

---

## 🔄 10. Pagamenti misti (contanti + carta)

**Problema attuale:** ogni conto supporta un solo metodo di pagamento (Unico, Alla Romana, Per Comanda). Non è possibile pagare parte in contanti e parte con carta elettronica nella stessa transazione.

**Miglioramento:** nel modale di pagamento, aggiungere una modalità "Pagamento Misto" che consenta di inserire l'importo in contanti e calcoli automaticamente il residuo da incassare con carta. Il riepilogo di cassa (Report X/Z) mostrerebbe entrambi i metodi separati.

**Impatto:** Cassa — `CassaTableManager.vue`, `CassaDashboard.vue`

---

## 🌙 11. Modalità scura (Dark Mode) per la Cucina

**Problema attuale:** l'interfaccia usa esclusivamente uno sfondo chiaro. Il display cucina (`CucinaView.vue`) è spesso usato in ambienti con luce ridotta (cucine professionali) e uno sfondo chiaro affatica la vista degli operatori durante i turni serali.

**Miglioramento:** aggiungere una preferenza "Modalità Scura" nelle impostazioni di Cucina (`CucinaSettingsModal.vue`) che applichi le classi `dark:` di Tailwind CSS già disponibili nel progetto. La preferenza è salvata in `localStorage` tramite `useSettings()`.

**Impatto:** Cucina — `CucinaView.vue`, `CucinaSettingsModal.vue`, `src/composables/useSettings.js`

---

## 🔁 12. Sync multi-dispositivo in tempo reale (WebSocket / Directus)

**Problema attuale:** ogni dispositivo (Cassa, Sala, Cucina) lavora su una copia locale dello store Pinia sincronizzata via `localStorage`. Se Sala e Cassa sono aperte su dispositivi diversi, le modifiche di uno non arrivano all'altro in tempo reale — il `TODO` è già registrato nel codice.

**Miglioramento:** integrare un backend Directus con WebSocket (o Supabase Realtime) come strato di sync. Ogni `watch` sullo store locale che oggi scrive su `localStorage` può triggerare anche un `PATCH` all'API; le notifiche WebSocket in ingresso aggiornano lo store locale. La logica offline-first (localStorage come fallback) rimane invariata.

**Impatto:** `src/store/index.js`, `src/store/persistence.js` — nuovo composable `useRealtimeSync.js`

---

*Aggiornato il 2026-03-14 — rimossi miglioramenti già realizzati, aggiunti nuovi scenari basati sull'analisi dell'intera repository.*