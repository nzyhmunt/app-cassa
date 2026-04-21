# Guida Utente — Terminale Cassa, Sala & Cucina

> Sistema POS per ristorazione (Cassa, Sala, Cucina)  
> Versione documentata: Aprile 2026

---

## Indice

1. [Panoramica del sistema](#1-panoramica-del-sistema)
2. [Launcher — selezione modalità](#2-launcher--selezione-modalità)
3. [App Cassa — mappa sala e tavoli](#3-app-cassa--mappa-sala-e-tavoli)
4. [App Cassa — gestione tavolo e conto](#4-app-cassa--gestione-tavolo-e-conto)
5. [App Cassa — pagamenti e chiusura](#5-app-cassa--pagamenti-e-chiusura)
6. [App Cassa — ordini](#6-app-cassa--ordini)
7. [App Cassa — dashboard e storico conti](#7-app-cassa--dashboard-e-storico-conti)
8. [App Sala — mappa e comande](#8-app-sala--mappa-e-comande)
9. [App Cucina — kanban, dettaglio, totali, cronologia](#9-app-cucina--kanban-dettaglio-totali-cronologia)
10. [Stampa comande e preconto](#10-stampa-comande-e-preconto)
11. [Impostazioni](#11-impostazioni)
12. [Autenticazione e blocco schermo](#12-autenticazione-e-blocco-schermo)
13. [Installazione PWA](#13-installazione-pwa)
14. [Offline, sincronizzazione e resilienza dati](#14-offline-sincronizzazione-e-resilienza-dati)
15. [Risoluzione problemi rapida](#15-risoluzione-problemi-rapida)

---

## 1. Panoramica del sistema

Il progetto è composto da **tre app operative** più launcher, con persistenza locale su **IndexedDB** e sincronizzazione tra tab/aperture della stessa installazione.

| App | URL locale | Uso |
|---|---|---|
| Launcher | `/` | Selezione modalità |
| Cassa | `/cassa.html` | Tavoli, incassi, report |
| Sala | `/sala.html` | Presa comande e monitoraggio tavoli |
| Cucina | `/cucina.html` | Preparazione e avanzamento comande |

### Stati ordine principali

`pending → accepted → preparing → ready → delivered → completed`  
Stato alternativo: `rejected`.

- `pending`: in attesa in Cassa
- `accepted`: accettata e inviata in cucina
- `preparing`: in lavorazione
- `ready`: pronta
- `delivered`: consegnata (conto ancora aperto)
- `completed`: conto saldato
- `rejected`: rifiutata

---

## 2. Launcher — selezione modalità

Dalla pagina `/` puoi aprire rapidamente Cassa, Sala o Cucina in tab dedicate.

Suggerimento operativo: tieni Cassa, Sala e Cucina aperte in parallelo su dispositivi/finestre distinti.

---

## 3. App Cassa — mappa sala e tavoli

![Mappa Sala Cassa](screenshots/pos-01-sala.png)

### 3.1 Vista tavoli

Stati visivi disponibili:
- **Libero**
- **In Attesa**
- **Occupato**
- **Conto richiesto**
- **Saldato**

La barra statistiche in alto è anche filtro rapido per stato tavolo.

### 3.2 Multi-sala

Con più sale configurate compaiono tab dedicate (più tab “Tutti”), con conteggio tavoli per sala.

### 3.3 Apertura tavolo

Su tavolo libero:
1. selezioni coperti (adulti e, se abilitato, bambini)
2. confermi
3. il tavolo passa in stato operativo

Se il coperto automatico è attivo, le righe coperto vengono aggiunte al conto in automatico.

### 3.4 Operazioni tavolo

Nel modale tavolo (header):
- **Conto** (flag conto richiesto)
- **Sposta** tavolo
- **Unisci** tavoli
- **Dividi** (quando consentito)
- **Storico**

---

## 4. App Cassa — gestione tavolo e conto

Nel modale tavolo trovi due aree principali:

- **Sinistra:** riepilogo voci/comande
- **Destra:** incasso e pagamento

### 4.1 Riepilogo voci

Modalità principali:
- **Per Voce** (aggregata)
- **Per Ordine**
- **Per Comanda** (selezione ordini da pagare)
- **Analitica** (selezione quantità voce-per-voce)

### 4.2 Voce Diretta (⚡)

Pulsante **Diretto**: aggiunge voci al conto senza passare per la cucina.

- Tab **Dal Menu**
- Tab **Personalizzata** (se abilitata)
- Carrello con quantità e totale

Le voci dirette sono marcate e non entrano nel flusso cucina.

### 4.3 Storni e ripristini

In vista per ordine puoi stornare righe/modificatori e ripristinarli. I netti sono calcolati automaticamente nel totale tavolo.

---

## 5. App Cassa — pagamenti e chiusura

### 5.1 Modalità pagamento

Sono disponibili 4 modalità:

1. **Tutto** (saldo unico)
2. **Alla Romana** (quote)
3. **Per Comanda** (selezione ordini)
4. **Analitica** (qty per singola voce/modificatore)

### 5.2 Funzioni in pagamento

- Metodi configurabili (es. Contanti, POS/Carta)
- Calcolo importo ricevuto
- Gestione **resto**
- Gestione **mancia**
- Sconti (% o €) se abilitati

### 5.3 Chiusura conto

A saldo completo compaiono i pulsanti:
- **Chiudi**
- **Fiscale** (richiesta scontrino fiscale)
- **Fattura** (apre modale dati fattura)

Per conti a importo zero i pulsanti Fiscale/Fattura non sono disponibili.

### 5.4 Dati fattura

Il modale fattura richiede i dati anagrafici/fiscali con validazioni sui campi (CF/P.IVA, CAP, SDI/PEC, ecc.).

---

## 6. App Cassa — ordini

![Gestione Ordini Cassa](screenshots/pos-02-ordini.png)

Tab operative:
- **In Attesa**
- **In Cucina**
- **Chiusi**

### 6.1 In Attesa

Su ordine pending puoi:
- **Inviare/Accettare**
- **Eliminare/Rifiutare**

Il rifiuto è protetto da modale con **causale** (preset + “Altro” con testo).

### 6.2 In Cucina

Visualizza gli ordini accepted/preparing/ready e l’area consegnate.

È disponibile override **Consegnata** in Cassa per casi operativi urgenti.

### 6.3 Dettaglio ordine

Dal pannello dettaglio puoi:
- aprire tavolo in cassa
- gestire nota globale ordine
- modificare note/portate/modificatori delle singole righe

---

## 7. App Cassa — dashboard e storico conti

### 7.1 Dashboard

Include:
- **Fondo cassa** iniziale
- **Movimenti** (versamenti/prelievi)
- **Lettura X** (senza azzeramento)
- **Lettura Z** (chiusura con archiviazione)

Nel riepilogo sono inclusi anche indicatori fiscali/fattura.

### 7.2 Storico conti

Mostra i conti chiusi con:
- dettaglio transazioni
- aggregati (incasso totale, media, numero conti)
- mancia postuma
- emissione fiscale/fattura postuma (se non già emessa)

---

## 8. App Sala — mappa e comande

![Mappa Sala Cameriere](screenshots/waiter-01-sala.png)

### 8.1 Mappa sala

Stati tavolo lato sala:
- Libero
- In Attesa
- Occupato
- (visibilità operativa su saldato nei flussi correlati)

Supporta multi-sala e operazioni tavolo principali (sposta/unisci secondo regole stato).

### 8.2 Lista comande

![Lista Comande Sala](screenshots/waiter-04-comande-list.png)

Tab:
- In Attesa
- In Cucina
- Chiusi

### 8.3 Creazione comanda

![Pannello Menu Sala](screenshots/waiter-06-menu-panel.png)

Flusso:
1. Nuova comanda
2. selezione piatti da menu
3. eventuale dettaglio piatto (info, allergeni, ingredienti)
4. modifiche voce (portata/note/modificatori)
5. invio comanda

### 8.4 Dettaglio comanda

![Dettaglio Comanda Sala](screenshots/waiter-05-order-detail.png)

Nella gestione ordini sala è presente anche il rifiuto con modale e causale (allineato al flusso Cassa).

### 8.5 Consegnata da Sala

![Override Consegnata Sala](screenshots/sala-consegnata-extended.png)

Per stati `accepted/preparing/ready` puoi marcare l’ordine come consegnato (`delivered`).

---

## 9. App Cucina — kanban, dettaglio, totali, cronologia

![Display Cucina](screenshots/cucina-ui.png)

La Cucina ha 4 tab:
1. **Kanban**
2. **Dettaglio**
3. **Totali**
4. **Cronologia**

### 9.1 Kanban

Tre colonne:
- Da Preparare (`accepted`)
- In Cottura (`preparing`)
- Pronte (`ready`)

Transizioni inverse supportate:
- preparing → accepted
- ready → preparing
- accepted → pending (rimanda in sala con conferma)

### 9.2 Consegna protetta (annulla)

Il pulsante **Consegnata** usa countdown di sicurezza (5s):
- primo click: avvia conto alla rovescia “Annulla (Xs)”
- secondo click entro il tempo: annulla
- a fine timer: stato `delivered`

### 9.3 Tab Dettaglio

![Dettaglio Cucina](screenshots/cucina-dettaglio-tab.png)

Lista ordini attivi con:
- righe per portata
- toggle per segnare singoli item come pronti
- pulsante consegnata con stessa logica countdown

### 9.4 Tab Totali

Vista aggregata piatti per quantità totale su ordini attivi, con filtro stato:
- Tutti
- Da Preparare
- In Cottura
- Pronte

### 9.5 Tab Cronologia

Ordini `delivered` in sola consultazione, con azione di ripristino a `ready` se necessario.

---

## 10. Stampa comande e preconto

### 10.1 Cronologia stampe

Da Cassa (Mappa Sala) pulsante **Stampe**:
- elenco job (`order`, `table_move`, `pre_bill`)
- stato job (`pending`, `printing`, `done`, `error`)
- ristampa su stessa o altra stampante configurata

### 10.2 Tipi di stampa

- **Comanda** all’accettazione ordine
- **Sposta tavolo**
- **Preconto**

### 10.3 Stampante preconto

Nelle impostazioni Cassa è selezionabile la stampante predefinita per `pre_bill` (o nessuna).

---

## 11. Impostazioni

### 11.1 Generali

- Avvisi audio
- Schermo sempre acceso (Wake Lock, se supportato)
- Sorgente menu (Directus / URL JSON)
- Sync menu URL manuale (se menuSource JSON)

### 11.2 Tastiera numerica personalizzata (Cassa)

![Anteprima Tastiera Numerica](screenshots/settings-keyboard-preview.png)

Modalità:
- Off
- Centro
- Sinistra
- Destra

### 11.3 Sincronizzazione Directus (admin)

Sezione dedicata con:
- enable/disable sync
- URL, token, venue ID
- toggle WebSocket
- test connessione
- salvataggio configurazione
- Push/Pull manuale
- Log coda sync
- procedura guidata di riapplicazione completa configurazione (con opzione svuota cache locale)

### 11.4 Gestione utenti

![Onboarding Amministratore](screenshots/settings-admin-setup.png)

Quando non esiste alcun amministratore compare CTA dedicata **Aggiungi amministratore**.

Con admin presente compare **Gestione Utenti & Blocco Schermo**.

### 11.5 Reset dati

Reset completo disponibile solo admin, con conferma esplicita.

---

## 12. Autenticazione e blocco schermo

Sistema opzionale a PIN.

- Se non ci sono utenti: accesso libero
- Primo utente creato manualmente: amministratore
- Accesso limitabile per app (`cassa`, `sala`, `cucina`)
- Blocco automatico configurabile
- PIN gestiti in forma hash

La lock screen mostra solo utenti autorizzati per l’app corrente.

---

## 13. Installazione PWA

Supporto installazione mobile/desktop:
- banner installazione Android
- istruzioni iOS (Aggiungi a Home)
- comportamento standalone quando installata

Manifest dedicati per app operative.

---

## 14. Offline, sincronizzazione e resilienza dati

### 14.1 Persistenza locale

Dati operativi su **IndexedDB** (non localStorage):
- ordini
- tavoli/sessioni conto
- transazioni
- movimenti cassa
- chiusure
- log/code di sincronizzazione

### 14.2 Sync locale cross-tab

Le app si aggiornano tra tab aperte sulla stessa installazione/browser.

### 14.3 Sync Directus (quando attivo)

- coda operazioni offline
- push/pull asincrono
- supporto WebSocket con fallback
- log diagnostico da UI

---

## 15. Risoluzione problemi rapida

- **Menu non aggiornato:** controlla sorgente menu nelle impostazioni e rilancia sync manuale.
- **Stampa non parte:** verifica stampanti configurate e stato job in “Stampe”.
- **Utente non visibile in lock screen:** controlla permessi app assegnati all’utente.
- **Dati non allineati tra dispositivi distinti:** attiva/configura sincronizzazione Directus.
- **Wake lock non disponibile:** browser/dispositivo non supportato.

---

*Documento aggiornato il 21 Aprile 2026, con revisione completa delle funzionalità operative e delle sezioni Cassa/Sala/Cucina/Sync/Stampa.*
