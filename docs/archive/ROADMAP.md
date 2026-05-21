# 📋 Roadmap di Sviluppo: Sistema Gestionale per Ristorazione

Questo documento delinea le fasi evolutive del software, trasformandolo da un prototipo locale a una soluzione professionale, multi-dispositivo e conforme alle normative fiscali italiane.

---

## 🟢 FASE 1: Infrastruttura Core e Compliance (Priorità Massima)

> **Obiettivo:** Stabilità del dato, sincronizzazione in tempo reale e conformità legale.

### Migrazione Backend Directus (Server API/Websocket)

- Sostituzione della logica localStorage con un database centralizzato.
- Implementazione di Websocket per garantire che un ordine preso in Sala appaia istantaneamente in Cucina e in Cassa.

### Integrazione Fiscale API

- Connessione con sistemi come Effatta o A-Cube.
- Invio telematico dei corrispettivi all'Agenzia delle Entrate alla chiusura del conto.

### Gestione Stampa Distribuita (ESC/POS)

- Routing delle comande basato sulle categorie (es. Piatti → Cucina, Bibite → Bar, Pizze → Forno).
- Integrazione tramite Web Bluetooth o protocolli di rete.

### Logica Offline-First

- Ottimizzazione dello store Pinia per gestire micro-interruzioni del Wi-Fi.
- Sincronizzazione automatica con Directus al ripristino della connessione.

---

## 🟡 FASE 2: Ottimizzazione Flussi Operativi (UX)

> **Obiettivo:** Riduzione dell'errore umano e gestione del servizio sotto stress.

### Gestione Sedute (Seat-based Ordering)

- Assegnazione dei piatti ai singoli posti a sedere.
- Facilitazione della consegna al tavolo e divisione analitica del conto.

### Causali Obbligatorie per Storni e Sconti

- Forzatura della motivazione (es. "Errore cameriere", "Piatto rimandato") per modifiche post-invio.
- Salvataggio dei log su Directus per il controllo gestione.

### Kitchen "All-Day View"

- Pannello riassuntivo quantitativo (es. "In totale: 12 Carbonare") per ottimizzare le cotture simultanee.
- Integrazione con la vista Kanban per tavolo.

### Split Payments Avanzati

- Gestione pagamenti misti (Contanti + Satispay + POS) con ricalcolo dinamico del residuo.

---

## 🔵 FASE 3: Self-Service e Integrazione AI

> **Obiettivo:** Modernizzazione dell'esperienza cliente e differenziazione competitiva.

### Menu Digitale QR e Self-Order PWA

- Interfaccia cliente per l'ordinazione autonoma.
- Sincronizzazione diretta con la board della Cucina.

### Assistente Chef AI

- Modulo AI per il filtraggio intelligente degli allergeni.
- Suggerimenti di abbinamento cibo-vino e composizione menu personalizzata.

### Pagamenti Online Integrati

- Pagamento del conto direttamente dalla PWA tramite Stripe, PayPal, Apple Pay o Google Pay.

---

## ⚪ FASE 4: Rifinitura e Monitoraggio (I Dettagli)

> **Obiettivo:** User Experience premium e controllo granulare.

### Ticket Aging & Alert Cromatici

- Indicatori visivi per i tempi di attesa in cucina: 🟢 Verde → 🟡 Giallo → 🔴 Rosso.

### Notifiche "Ready for Pickup"

- Feedback visivo o notifiche push per la Sala quando un piatto è pronto.

### Audio Micro-Interactions

- Suoni differenziati: "Ding" leggero per nuovi ordini, alert urgente per richieste conto o ritardi.

### Workflow Chiusura Cassa (Report Z)

- Procedura guidata per il conteggio del fondo cassa fisico e segnalazione discrepanze.

---

## 🚀 Roadmap Temporale Suggerita

| Periodo        | Focus Principale       | Traguardo                              |
| -------------- | ---------------------- | -------------------------------------- |
| Settimana 1-2  | Directus & Websocket   | Sincronizzazione real-time attiva      |
| Settimana 3    | Fiscalità AdE          | Requisito legale soddisfatto           |
| Settimana 4    | Stampa & Flusso BOH    | Stabilità operativa Back-of-House      |
| Settimana 5+   | AI & Self-Ordering     | Lancio commerciale e innovazione       |
