Piano di Lavoro — Allineamento IndexedDB ↔ Directus


A. UUID/ID malformati (Critico — impedisce qualsiasi sync)

A1. orders.id — tre pattern di generazione diversi e tutti sbagliati

• CassaTableManager.vue:2225 e SalaTableManager.vue:541: 'ord_' + Math.random().toString(36).slice(2,11) → stringa alfanumerica corta, non UUID

• store/index.js:423,462: newUUID('ord') → ord_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (prefisso + UUID = stringa non conforme al tipo uuid di Directus)

Fix: Sostituire tutti e tre con newUUIDv7() senza prefisso (UUID 36 char puro).

A2. bill_sessions.id

• store/index.js:274: newUUID('bill') → bill_xxxxxxxx-... — tipo uuid Directus richiede 36 char

Fix: Sostituire con newUUIDv7() senza prefisso.

A3. transactions.transactionId → Directus id

• store/index.js:401,412 ecc.: newUUID('tip'), newUUID('tip') → tip_xxxxxxxx-...

• Il FIELD_RENAME_MAP rinomina transactionId → id nel payload, ma il valore è ancora prefissato

Fix: Sostituire newUUID('tip') (e varianti) con newUUIDv7() senza prefisso.

A4. cash_movements.id

• store/index.js:446: newUUID('mov') → mov_xxxxxxxx-...

Fix: Sostituire con newUUIDv7() senza prefisso.

A5. venue_users.id

• useAuth.js:314: newUUID('usr') → usr_xxxxxxxx-...

Fix: Sostituire con newUUIDv7() senza prefisso.

A6. order_items.uid overflow VARCHAR(20)

• store/index.js:479: newUUID('cop') → cop_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx = ~40 char, ma il campo Directus è VARCHAR(20)

• tableOps.js:291: newUUID('spl') — stesso problema

Fix: Usare un ID corto per uid (es. r_ + Date.now().toString(36).slice(-6) oppure un contatore progressivo). Non usare UUID completo per uid, che per schema è un codice breve di riga (es. r_1).

A7. Deprecare newUUID() con prefisso per PK operativi

Aggiornare storeUtils.js con una chiara separazione:

• newUUIDv7() senza prefisso per tutti i PK UUID da inviare a Directus

• newShortId(prefix) per identificatori locali non-PK (es. uid, logId, jobId)


B. Disallineamento keyPath IDB ↔ Directus (Critico)

B1. transactions: keyPath IDB transactionId ≠ Directus id

• useIDB.js:66: keyPath: 'transactionId'

• upsertRecordsIntoIDB ha un override hardcoded ma quando Directus restituisce una transazione con campo id, incoming['transactionId'] è undefined → il record non viene salvato

Fix: Migrare il PK locale da transactionId a id in tutta l’app (IDB, store, componenti). È un refactoring pervasivo. Aggiornare useIDB.js (keyPath → id), idbPersistence.js (keyPath overrides), e tutti i riferimenti nel store.

B2. print_jobs: keyPath IDB logId ≠ Directus log_id [RISOLTO]

• useIDB.js:146: keyPath: 'logId'

• Directus setup report §24: PK è log_id

• upsertRecordsIntoIDB override print_jobs: 'logId' non funziona con record Directus che hanno log_id

Fix (implementato): print_jobs è push-only (non nel PULL_CONFIG). Il mapper mapPrintJobToDirectus
converte logId → log_id nel payload Directus. L'IDB continua ad usare logId come keyPath locale.
addPrintLogEntry e updatePrintLogEntry ora chiamano enqueue() per sincronizzare con Directus.


C. PKs auto-increment nascosti in Directus (Impedisce inserimento nuovi dati)

Problema: In Directus, quando un campo PK è integer auto-increment e viene configurato come hidden: true, l’interfaccia amministrativa non mostra il campo. Se il campo è stato creato senza has_auto_increment: true (può accadere via API), Directus rifiuterà i POST senza id.

Collezioni coinvolte:

• venues (integer auto-increment)

• menu_categories (integer auto-increment)

• menu_item_modifiers (integer auto-increment)

• app_settings (integer auto-increment)

C1. Verificare nel panel Directus per ognuna di queste collezioni che id sia configurato con AUTO_INCREMENT = true. Se no, correggerlo via Directus UI (Collection Settings → Fields → id → Schema → Auto-increment).

C2. Per le collezioni con PK stringa inserite manualmente (rooms, tables, payment_methods, printers, menu_items): verificare che il campo id sia visibile nell’editor Directus (non hidden) così che l’admin possa inserire il valore al momento della creazione.


D. Mancanza di idratazione appConfig ↔ Directus (Critico — disallineamento configurazione)

Problema principale: _runGlobalPull() scarica venues, rooms, tables, payment_methods, menu_categories, menu_items, printers, venue_users in IndexedDB, ma non aggiorna appConfig. L’app continua a usare la configurazione vecchia da localStorage/default.

D1. Creare loadConfigFromIDB(venueId) in idbPersistence.js:

• Legge da IDB: venues, rooms, tables, payment_methods, menu_categories, menu_items, printers, venue_users

• Trasforma e restituisce un oggetto compatibile con la struttura appConfig

D2. Creare applyDirectusConfigToAppConfig(cfg) in utils/index.js o composable dedicato:

• Aggiorna appConfig.ui con i dati del venue (colori brand, nome, coverCharge settings, billing settings)

• Aggiorna appConfig.rooms con le sale Directus (filtrando per venueId, escluse archived)

• Aggiorna appConfig.tables (derivato da rooms)

• Aggiorna appConfig.paymentMethods con i metodi Directus

• Aggiorna appConfig.printers con le stampanti Directus

• Aggiorna appConfig.menu con categorie e voci dal Directus (se non viene usato il menuUrl)

D3. Chiamare loadConfigFromIDB + applyDirectusConfigToAppConfig in startSync() dopo _runGlobalPull() (e al ritorno online).

D4. Priorità menu: Quando Directus è abilitato e il pull globale ha restituito menu_items, usare il menu Directus al posto di quello da menuUrl. Aggiornare loadMenu() in store/index.js per gestire questa logica.


E. Mancanza del campo `venue` nei payload di mutazione

E1. addDirectOrder() (store/index.js:420): l’oggetto order non include venue

E2. addCashMovement() (store/index.js:444): l’oggetto mov non include venue

E3. addTipTransaction() (store/index.js:398): la transazione non include venue

E4. Creazioni order nei componenti (CassaTableManager.vue:2224, SalaTableManager.vue:541): nessun campo venue

Fix: Aggiungere venue: appConfig.directus?.venueId in tutti questi punti. La safety-net in _pushEntry() di useSyncQueue.js già inietta venueId se mancante, ma è meglio averlo esplicito nell’oggetto sin dalla creazione (per query locali e per IDB).


F. Ciclo di vita `bill_sessions` incompleto

F1. Mancante enqueue di chiusura sessione:

Quando un tavolo viene liberato (tutti gli ordini completati/rifiutati, changeOrderStatus in store/index.js:300+), il codice elimina tableCurrentBillSession[table] localmente, ma non manda mai enqueue('bill_sessions', 'update', billSessionId, { status: 'closed', closed_at: ... }) a Directus.

Fix: In changeOrderStatus, quando si rimuove la sessione attiva dal tavolo, aggiungere l’enqueue di update con status: 'closed' e closed_at.

F2. Oggetto sessione locale incompleto:

Il local tableCurrentBillSession[tableId] contiene solo { billSessionId, adults, children }. Per il confronto con i record Directus e per la chiusura corretta è utile avere almeno opened_at e table.

Fix: Includere opened_at, table, status nell’oggetto sessione locale in openTableSession().


G. Formato `order_time` non robusto

time: new Date().toLocaleTimeString(...) dipende dal locale del browser. Per Directus il campo order_time è di tipo TIME (HH:MM o HH:MM:SS). Con locale it-IT produce formato corretto, ma con altri locale produce “7:30 PM”.

Fix: Usare sempre il formato 24h: new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false }) oppure costruire il valore manualmente con String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0').


H. Problemi aggiuntivi non descritti nella PR

H1. bill_sessions non caricati dall’ObjectStore IDB dedicato

loadStateFromIDB() legge tableCurrentBillSession dall’app_meta blob, non dall’ObjectStore bill_sessions. I record bill_session scritti da upsertRecordsIntoIDB nell’ObjectStore bill_sessions non vengono quindi mai letti all’avvio. Mancanza di una funzione loadBillSessionsFromIDB() che legga dall’ObjectStore e ripristini lo stato.

H2. print_jobs, fiscal_receipts e invoice_requests non sincronizzati con Directus [RISOLTO]

I print_jobs non erano in PULL_CONFIG né GLOBAL_COLLECTIONS e non venivano pushati tramite useSyncQueue.
Analogamente, fiscal_receipts e invoice_requests venivano salvati solo in IDB locale.

Fix (implementato):
- Aggiunti mapper dedicati: mapPrintJobToDirectus, mapFiscalReceiptToDirectus, mapInvoiceRequestToDirectus
- Registrati in _TO_DIRECTUS_MAPPERS; mapPayloadToDirectus passa l'original payload ai mapper per
  recuperare il campo  (rimosso da _PUSH_DROP_FIELDS)
- fiscal_receipts e invoice_requests aggiunti a DOMAIN_STATUS_COLLECTIONS (push-only, no delete)
- enqueue() chiamato in addPrintLogEntry, updatePrintLogEntry, addFiscalReceipt, updateFiscalReceipt,
  addInvoiceRequest

H3. table_merge_sessions solo locale

table_merge_sessions non è in GLOBAL_COLLECTIONS né in PULL_CONFIG. Se due dispositivi usano merge tavoli, lo stato non è condiviso. Aggiungere alla global pull con merge opportuno nel _mergeIntoStore.

H4. Demo/fixture data con ID legacy

src/utils/index.js:235-265 contiene ordini fixture con ID legacy (ord_rX91, ord_cop04, ecc.). Questi non sono UUID validi. Aggiornare con UUID v7 puliti o rimuoverli dalla produzione.

H5. transactions — push usa transactionId come record_id nel queue

enqueue('transactions', 'create', txn.transactionId, txn) → record_id = 'tip_xxxxxxxx-...'. Il _pushEntry recupera record_id per chiamare createItem(collection, payload) dove directusPayload.id = record_id se non già presente. Quindi il valore (malformato) viene usato come PK in Directus. Combinato con fix A3.

H6. venue_users locali vs Directus: coesistenza discriminante _type

loadUsersFromIDB() filtra per _type === 'manual_user'. I record venue_users arrivati da Directus via global pull non hanno _type e vengono salvati in IDB. Nessuna collision ma anche nessuna lettura: i record Directus non vengono mai mostrati nell’UI di gestione utenti. Implementare hydration dei venue_users Directus nell’auth flow.

H7. upsertRecordsIntoIDB fallisce silenziosamente per store inesistenti

Il metodo non valida se storeName è un ObjectStore valido. Per collezioni come table_merge_sessions (con keyPath slave_table) il fallback è id, ma table_merge_sessions ha l’override. Il metodo è fragile per futuri store aggiuntivi.

H8. Mancanza di IDB version bump per nuovi store

Ogni aggiunta di un ObjectStore richiede un increment di DB_VERSION in useIDB.js. Il processo non è documentato né protetto (nessun test che verifichi la versione). Rischio di deployment senza bump di versione → errori silenziosi in produzione.
