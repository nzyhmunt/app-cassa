# 🚀 Miglioramenti Funzionali Proposti — Terminale Cassa & Sala

Analisi del repository `nzyhmunt/demo-apps` — app POS single-file (`cassa-v1.html`) per l'**Osteria del Grillo**, costruita con **Vue 3 + Tailwind CSS**.

---

## 📋 Panoramica dell'app

Gestisce:
- 🗂️ **Ordini** (pending → cucina → completato)
- 🗺️ **Mappa sala** con 12 tavoli
- 💳 **Cassa & pagamenti** (unico, alla romana, per comanda)
- 📋 **Menu** con categorie e carrello temporaneo
- 🗒️ **Note cucina** per variazioni piatto
- 📤 **Export JSON** ricevuta/preconto

> Il `menu.json` contiene il menù completo (allergeni, ingredienti, immagini, prezzi) ma l'app carica solo un subset hardcoded di pochi piatti — **il menu ricco non è ancora utilizzato appieno**.

---

## 🍽️ 1. Caricamento dinamico del `menu.json` completo

**Problema attuale:** il menu nell'app è hardcoded con soli ~10 piatti (Antipasti ridotti, niente Pinse, Contorni, Dolci).

**Miglioramento:** fare un `fetch('/menu.json')` all'avvio e popolare `config.menu` dinamicamente con tutte le categorie (Pinse, Contorni, Dolci, ecc.).

---

## 🌿 2. Visualizzazione allergeni e ingredienti nel menu

**Problema attuale:** il menu mostra solo nome e prezzo.

**Miglioramento:** nel modale "Aggiunta Piatti" mostrare:
- Badge colorati per allergeni (`glutine`, `lattosio`, `uova`, ecc.)
- Tooltip/espansione con ingredienti
- Icona foglia 🌿 per piatti vegani/vegetariani

---

## 🔍 3. Ricerca/filtro piatti nel menu

**Problema attuale:** per trovare un piatto bisogna navigare manualmente per categoria.

**Miglioramento:** aggiungere una barra di ricerca testuale nel modale menu che filtra i piatti in tempo reale su tutte le categorie.

---

## 🖼️ 4. Immagini dei piatti nel menu

**Problema attuale:** il `menu.json` ha già `immagine_url` per molti piatti, ma non vengono mai mostrate.

**Miglioramento:** mostrare le immagini nelle card del menu (con fallback se assente), rendendo l'UI più appetitosa per il personale.

---

## ⏱️ 5. Timestamp e tempo di attesa degli ordini

**Problema attuale:** l'orario mostrato è solo testo statico (es. "19:30").

**Miglioramento:** calcolare e mostrare il **tempo trascorso** dall'arrivo dell'ordine (es. "🕐 12 min fa") con colore che cambia a rosso dopo soglia configurabile (es. 15 min).

---

## 🔔 6. Pannello notifiche/storico audio

**Problema attuale:** il "ding" suona, ma non c'è traccia visiva degli ordini arrivati mentre si era su un'altra schermata.

**Miglioramento:** un badge o mini-log degli ultimi ordini arrivati con orario, accessibile dall'header.

---

## 💰 7. Calcolo resto (per pagamento in contanti)

**Problema attuale:** il cassiere incassa e basta, nessun supporto al calcolo del resto.

**Miglioramento:** quando si seleziona "Contanti", mostrare un campo "Importo ricevuto" con calcolo automatico del resto da dare.

---

## 📊 8. Riepilogo turno / statistiche cassa

**Problema attuale:** non esiste una visione aggregata del turno.

**Miglioramento:** una sezione (o modal) nelle impostazioni che mostra:
- Totale incassato nel turno (contanti vs carta)
- Numero tavoli serviti
- Scontrino medio

---

## 🖨️ 9. Stampa comanda/scontrino reale (window.print)

**Problema attuale:** il bottone "Accetta & Stampa" non stampa nulla realmente.

**Miglioramento:** implementare un layout CSS `@media print` per stampare la comanda cucina o lo scontrino cliente in modo leggibile.

---

## 🗑️ 10. Conferma prima di eliminare un ordine

**Problema attuale:** il bottone "Elimina" su un ordine pending lo rifiuta immediatamente senza conferma.

**Miglioramento:** mostrare un dialog di conferma prima di passare a `status: 'rejected'`, per evitare errori accidentali.

---

## 📱 11. Gestione "coperti" con contatore dinamico

**Problema attuale:** i coperti sono configurati staticamente per ogni tavolo, ma non aggiornabili runtime.

**Miglioramento:** nel modale cassa, permettere di modificare il numero coperti attivi (utile per calcolare l'eventuale coperto/servizio da aggiungere).

---

## 💾 12. Persistenza dati con `localStorage`

**Problema attuale:** ricaricando la pagina tutti gli ordini e transazioni si perdono.

**Miglioramento:** serializzare `orders` e `transactions` in `localStorage` e ripristinarli all'avvio, con opzione di reset manuale a fine turno.

---

*Generato il 2026-03-06 tramite analisi automatica del codice sorgente.*