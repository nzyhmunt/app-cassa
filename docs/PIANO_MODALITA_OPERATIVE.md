# Bozza piano di lavoro — Modalità operative (Offline / Offline-first / Online)

## Obiettivo
Introdurre una selezione esplicita della modalità operativa dell’app, con tre comportamenti distinti:

1. **Solo offline (`offline_only`)** — usa solo IndexedDB locale (singolo dispositivo)
2. **Offline first (`offline_first`)** — IndexedDB locale + sincronizzazione push/pull con Directus
3. **Online (`online_only`)** — usa solo Directus in tempo reale, senza persistenza operativa su IndexedDB

## Valutazione complessità
**Complessità: ALTA**.

Motivo: l’architettura attuale è progettata come **IDB-first** (bootstrap, store hydration, refresh cross-tab, sync, cache config/menu, queue di push, purge, monitoraggio). La modalità online-only richiede un percorso di esecuzione alternativo coerente in tutti i layer applicativi (UI, store, composables, sync, bootstrap, fallback errori).

## Perimetro da toccare
- Configurazione runtime e persistenza impostazioni modalità
- Bootstrap app (Cassa/Sala/Cucina)
- Store (config + ordine) e persistenza operativa
- Flussi sync Directus (pull/push/realtime)
- UI impostazioni e indicatori di stato
- Strategie fallback/recovery in assenza rete
- Test unitari/integrativi delle tre modalità
- Documentazione tecnica e guida operativa

## Piano di lavoro (bozza)

### Fase 1 — Modellazione modalità operativa
- Definire un campo univoco di modalità operativa con valori: `offline_only`, `offline_first`, `online_only`.
- Stabilire la matrice di comportamento per ogni funzionalità critica (lettura ordini, scrittura ordini, stampa, sessioni tavolo, utenti, menu, config).
- Allineare i default applicativi e le regole di compatibilità con installazioni esistenti.

### Fase 2 — Bootstrap e orchestrazione lifecycle
- Introdurre una strategia di avvio condizionale per modalità in Cassa/Sala/Cucina.
- Separare chiaramente i percorsi di inizializzazione: con IDB, ibrido, e solo rete.
- Definire il comportamento in assenza rete per `online_only` (stato degradato esplicito, blocco operazioni non consentite, messaggi utente).

### Fase 3 — Store e accesso dati
- Isolare l’accesso ai dati operativi dietro un livello coerente con la modalità attiva.
- Mantenere IDB-first solo dove previsto (`offline_only`, `offline_first`).
- Per `online_only`, usare operazioni Directus live senza dipendere da object store operativi locali.

### Fase 4 — Sync e realtime
- Mantenere il motore attuale per `offline_first`.
- Disattivare queue/persistenza operativa locale non necessaria in `online_only`.
- Garantire aggiornamento realtime affidabile (WS + fallback controllato) per `online_only`.

### Fase 5 — UI e UX configurazione
- Estendere le impostazioni con selettore modalità operativo.
- Mostrare stato e limitazioni della modalità corrente in modo chiaro.
- Gestire transizione tra modalità con controlli di sicurezza (conferme, eventuale migrazione/clear dati locali quando necessario).

### Fase 6 — Sicurezza dati e migrazione
- Definire regole di migrazione tra modalità (es. da offline-first a online-only).
- Prevenire incoerenze tra cache locale e stato server.
- Formalizzare policy di conservazione/rimozione dati locali in funzione della modalità.

### Fase 7 — Test e validazione
- Aggiungere test dedicati per:
  - creazione/aggiornamento ordini per ciascuna modalità
  - comportamento offline/online e riconnessione
  - bootstrap multi-app con modalità diverse
  - regressioni su stampa, pagamenti, storico e monitor sync
- Eseguire suite completa repository e validazione funzionale manuale guidata.

### Fase 8 — Documentazione e rollout
- Aggiornare README con la nuova matrice modalità.
- Aggiornare guida utente con scenari operativi consigliati.
- Definire rollout graduale: attivazione iniziale su ambiente pilota, osservabilità, rollback plan.

## Rischi principali
- Regressioni su flussi oggi implicitamente IDB-first
- Incoerenze durante il cambio modalità su installazioni già in uso
- Maggiore sensibilità alla qualità rete in `online_only`
- Incremento complessità manutentiva senza un chiaro confine dei layer

## Criteri di accettazione (bozza)
- Le tre modalità sono selezionabili e persistite correttamente
- Ogni modalità rispetta il proprio contratto funzionale
- Nessuna dipendenza operativa da IDB in `online_only`
- Nessuna regressione funzionale nelle modalità esistenti
- Test automatici verdi + documentazione aggiornata
