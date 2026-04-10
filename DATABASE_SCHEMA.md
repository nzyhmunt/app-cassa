# Schema Database — Directus Collections

Questo documento descrive lo schema delle **collection Directus** derivato dal modello dati dell'applicazione.
Le collection rispecchiano le convenzioni standard di Directus (ultima versione stabile) e servono sia come
riferimento per la configurazione del backend Directus sia come guida per la persistenza locale su **IndexedDB**
(offline-first, sync push verso Directus non appena torna la connessione).

**Sorgenti dati correnti** (localStorage):
- `demo_app_state_v1` (eventualmente con suffisso di istanza, da `resolveStorageKeys()` in `src/store/persistence.js`)
- `app-settings`

---

## Campi standard Directus

Ogni collection include un sottoinsieme dei seguenti campi di sistema Directus. Vanno abilitati nelle
*Collection Settings → Fields*. In Directus questi campi vengono valorizzati automaticamente lato applicazione;
se si leggono i DDL SQL come schema puro, l'aggiornamento automatico in modifica richiede trigger DB o logica equivalente.

| Campo           | Tipo Directus        | Note                                                                                          |
|-----------------|----------------------|-----------------------------------------------------------------------------------------------|
| `status`        | `string`             | Stato workflow (`published`, `draft`, `archived`, o valori custom)                            |
| `user_created`  | M2O `directus_users` | Utente che ha creato il record — valorizzato solo alla creazione                              |
| `date_created`  | `dateTime`           | Data/ora di creazione — valorizzata solo alla creazione                                       |
| `user_updated`  | M2O `directus_users` | Ultimo utente che ha modificato il record — aggiornato a ogni modifica da Directus            |
| `date_updated`  | `dateTime`           | Data/ora dell'ultima modifica — aggiornata a ogni modifica da Directus (o via trigger DB)    |

> **Nota sui nomi FK**: le relazioni Many-to-One usano il **nome del campo senza suffisso `_id`**
> (es. `venue`, non `venue_id`; `room`, non `room_id`). Questo è il comportamento predefinito
> di Directus. Nei DDL SQL sottostanti i nomi di colonna riservati come `table` e `order`
> devono essere quotati (`"table"`, `"order"`).

> **UUID v7**: le collection ad alto traffico (`bill_sessions`, `orders`, `transactions`,
> `cash_movements`) usano **UUID v7** come primary key. UUID v7 è time-ordered (ms prefix),
> il che garantisce ordinamento cronologico naturale e minimizza la frammentazione degli indici
> B-tree anche con inserimenti massivi da client offline. Lato Directus: tipo `uuid`; lato
> IndexedDB: stringa da 36 char generata client-side con una libreria compatibile (es. `uuid`
> v9+ con `uuidv7()`). PostgreSQL: richiede l'estensione `pg_uuidv7` oppure generazione
> applicativa.

---

## Indice

1. [Entità principali](#1-entità-principali)
2. [Collection (DDL)](#2-collection-ddl)
3. [Relazioni](#3-relazioni)
4. [Diagramma ER](#4-diagramma-er)
5. [Note di migrazione](#5-note-di-migrazione)
   - 5.5 [Integrazione Directus](#55-integrazione-directus)
   - 5.6 [IndexedDB offline-first](#56-integrazione-indexeddb-pwa-offline-first)
   - 5.7 [Architettura sync multi-dispositivo](#57-architettura-di-sincronizzazione-multi-dispositivo)

---

## 1. Entità principali

| Collection               | Descrizione                                              | Fonte localStorage           |
|--------------------------|----------------------------------------------------------|------------------------------|
| `venues`                 | Ristorante / punto vendita                               | `appConfig.ui`               |
| `rooms`                  | Sale / aree della mappa tavoli                           | `appConfig.rooms`            |
| `tables`                 | Tavoli della sala                                        | `appConfig.tables` (derivato da `appConfig.rooms`) |
| `payment_methods`        | Metodi di pagamento configurati                          | `appConfig.paymentMethods`   |
| `menu_categories`        | Categorie del menu (Antipasti, Primi, …)                 | `appConfig.menu` (chiavi)    |
| `menu_items`             | Voci del menu (piatti, bevande, ecc.)                    | `appConfig.menu[categoria]`  |
| `menu_item_modifiers`    | Modificatori/varianti disponibili per voce menu          | (configurazione menu)        |
| `bill_sessions`          | Sessione di occupazione tavolo (un'apertura tavolo)      | `tableCurrentBillSession`    |
| `orders`                 | Comande inviate dal tavolo                               | `orders`                     |
| `order_items`            | Righe singole di una comanda                             | `order.orderItems`           |
| `order_item_modifiers`   | Modificatori applicati a una riga comanda                | `orderItem.modifiers`        |
| `transactions`           | Pagamenti e sconti applicati a un conto                  | `transactions`               |
| `transaction_order_refs` | Collegamento N:M tra pagamenti e comande                 | `transaction.orderRefs`      |
| `cash_movements`         | Versamenti e prelievi di cassa                           | `cashMovements`              |
| `daily_closures`         | Chiusure giornaliere (rapporto Z)                        | `dailyClosures`              |
| `printers`               | Stampanti ESC/POS configurate                            | `appConfig.printers`         |
| `print_jobs`             | Log dei lavori di stampa inviati (cronologia stampe)     | `printLog` (localStorage)    |
| `app_settings`           | Impostazioni utente (audio, URL menu, ecc.)              | `app-settings` (localStorage)|

---

## 2. Collection (DDL)

### 2.1 `venues` — Punto vendita

Campi Directus standard abilitati: `status`, `user_created`, `date_created`, `user_updated`, `date_updated`.

```sql
CREATE TABLE venues (
    id              SERIAL          PRIMARY KEY,
    status          VARCHAR(20)     NOT NULL DEFAULT 'published', -- 'published' | 'draft' | 'archived'
    name            VARCHAR(120)    NOT NULL,               -- appConfig.ui.name
    primary_color   CHAR(7)         NOT NULL DEFAULT '#00846c', -- hex CSS
    primary_color_dark CHAR(7)      NOT NULL DEFAULT '#0c7262',
    currency_symbol VARCHAR(5)      NOT NULL DEFAULT '€',
    menu_url        TEXT            NULL,                   -- URL sorgente menu JSON
    allow_custom_variants BOOLEAN   NOT NULL DEFAULT TRUE,  -- appConfig.ui.allowCustomVariants
    -- billing flags
    cover_charge_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
    cover_charge_auto_add       BOOLEAN NOT NULL DEFAULT TRUE,
    cover_charge_price_adult    NUMERIC(8,2) NOT NULL DEFAULT 2.50,
    cover_charge_price_child    NUMERIC(8,2) NOT NULL DEFAULT 1.00,
    billing_auto_close_on_full_payment    BOOLEAN NOT NULL DEFAULT TRUE,
    billing_enable_cash_change_calculator BOOLEAN NOT NULL DEFAULT TRUE,
    billing_enable_tips                   BOOLEAN NOT NULL DEFAULT TRUE,
    billing_enable_discounts              BOOLEAN NOT NULL DEFAULT TRUE,
    billing_allow_custom_entry            BOOLEAN NOT NULL DEFAULT TRUE,  -- abilita voci libere nel modal Voce Diretta
    -- orders configuration
    orders_rejection_reasons  JSONB    NULL,           -- appConfig.orders.rejectionReasons — array [{value,label}]; NULL = usa i predefiniti dell'applicazione
    -- Directus standard fields
    user_created    UUID            NULL REFERENCES directus_users(id),
    date_created    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    user_updated    UUID            NULL REFERENCES directus_users(id),
    date_updated    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
```

---

### 2.1b `rooms` — Sale / Aree mappa tavoli

Campi Directus standard abilitati: `status`, `user_created`, `date_created`.

```sql
CREATE TABLE rooms (
    id              VARCHAR(30)     PRIMARY KEY,    -- es. 'sala', 'terrazza'
    status          VARCHAR(20)     NOT NULL DEFAULT 'published', -- 'published' | 'archived'
    venue           INTEGER         NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    label           VARCHAR(80)     NOT NULL,       -- es. 'Sala Interna', 'Terrazza'
    sort_order      SMALLINT        NOT NULL DEFAULT 0,
    -- Directus standard fields
    user_created    UUID            NULL REFERENCES directus_users(id),
    date_created    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
```

Ogni tavolo appartiene a una sala tramite `room`:

### 2.2 `tables` — Tavoli

Campi Directus standard abilitati: `status`, `user_created`, `date_created`.

```sql
CREATE TABLE tables (
    id              VARCHAR(10)     PRIMARY KEY,    -- es. '01', '02', ... '12'
    status          VARCHAR(20)     NOT NULL DEFAULT 'published', -- 'published' | 'archived'
    venue           INTEGER         NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    -- `room` è nullable per retrocompatibilità (tavoli esistenti prima dell'introduzione delle
    -- sale) e per CASCADE di eliminazione: se una sala viene eliminata, i tavoli rimangono ma
    -- non sono più associati a una sala (room = NULL). La UI li tratta come tavoli non
    -- raggruppati, visibili solo quando non ci sono sale configurate.
    room            VARCHAR(30)     NULL REFERENCES rooms(id) ON DELETE SET NULL,
    label           VARCHAR(80)     NOT NULL,       -- es. 'Tavolo 01'
    covers          SMALLINT        NOT NULL CHECK (covers > 0),  -- posti a sedere
    sort_order      SMALLINT        NOT NULL DEFAULT 0,
    -- Directus standard fields
    user_created    UUID            NULL REFERENCES directus_users(id),
    date_created    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
```

---

### 2.3 `payment_methods` — Metodi di pagamento

Campi Directus standard abilitati: `status`, `user_created`, `date_created`.

```sql
CREATE TABLE payment_methods (
    id              VARCHAR(30)     PRIMARY KEY,    -- es. 'cash', 'card'
    status          VARCHAR(20)     NOT NULL DEFAULT 'published', -- 'published' | 'archived'
    venue           INTEGER         NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    label           VARCHAR(60)     NOT NULL,       -- es. 'Contanti', 'Pos/Carta'
    icon            VARCHAR(50)     NULL,           -- nome icona Lucide
    color_class     VARCHAR(80)     NULL,           -- classe Tailwind CSS
    sort_order      SMALLINT        NOT NULL DEFAULT 0,
    -- Directus standard fields
    user_created    UUID            NULL REFERENCES directus_users(id),
    date_created    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
```

---

### 2.4 `menu_categories` — Categorie menu

Campi Directus standard abilitati: `status`, `user_created`, `date_created`.

```sql
CREATE TABLE menu_categories (
    id              SERIAL          PRIMARY KEY,
    status          VARCHAR(20)     NOT NULL DEFAULT 'published', -- 'published' | 'archived'
    venue           INTEGER         NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    name            VARCHAR(80)     NOT NULL,       -- es. 'Antipasti', 'Primi Piatti'
    sort_order      SMALLINT        NOT NULL DEFAULT 0,
    -- Directus standard fields
    user_created    UUID            NULL REFERENCES directus_users(id),
    date_created    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    UNIQUE (venue, name)
);
```

---

### 2.5 `menu_items` — Voci menu

Campi Directus standard abilitati: `status`, `user_created`, `date_created`, `user_updated`, `date_updated`.

```sql
CREATE TABLE menu_items (
    id              VARCHAR(50)     PRIMARY KEY,    -- es. 'ant_2', 'bev_4'
    status          VARCHAR(20)     NOT NULL DEFAULT 'published', -- 'published' | 'archived'
    venue           INTEGER         NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    category        INTEGER         NOT NULL REFERENCES menu_categories(id) ON DELETE RESTRICT,
    name            VARCHAR(120)    NOT NULL,
    price           NUMERIC(8,2)    NOT NULL CHECK (price >= 0),
    description     TEXT            NULL,
    note            TEXT            NULL,
    image_url       TEXT            NULL,
    ingredients     TEXT[]          NULL,           -- array di stringhe
    allergens       TEXT[]          NULL,
    sort_order      SMALLINT        NOT NULL DEFAULT 0,
    -- Directus standard fields
    user_created    UUID            NULL REFERENCES directus_users(id),
    date_created    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    user_updated    UUID            NULL REFERENCES directus_users(id),
    date_updated    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
```

---

### 2.6 `menu_item_modifiers` — Modificatori disponibili per voce menu

Campi Directus standard abilitati: `status`.

```sql
CREATE TABLE menu_item_modifiers (
    id              SERIAL          PRIMARY KEY,
    status          VARCHAR(20)     NOT NULL DEFAULT 'published', -- 'published' | 'archived'
    menu_item       VARCHAR(50)     NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    name            VARCHAR(80)     NOT NULL,       -- es. 'Extra aglio'
    price           NUMERIC(8,2)    NOT NULL DEFAULT 0.00,
    sort_order      SMALLINT        NOT NULL DEFAULT 0
);
```

---

### 2.7 `bill_sessions` — Sessioni tavolo (apertura/chiusura)

Una riga per ogni volta che un tavolo viene aperto.
Creata al primo ordine accettato; chiusa quando tutti gli ordini sono `completed` o `rejected`.

**Primary key**: UUID v7 (time-ordered, generato client-side prima dell'invio a Directus).

Campi Directus standard abilitati: `status`, `user_created`, `date_created`.

```sql
CREATE TABLE bill_sessions (
    id              UUID            PRIMARY KEY,    -- UUID v7 generato client-side
    -- status: 'open' = tavolo occupato; 'closed' = conto chiuso/pagato
    status          VARCHAR(20)     NOT NULL DEFAULT 'open',
    "table"         VARCHAR(10)     NOT NULL REFERENCES tables(id) ON DELETE RESTRICT,
    venue           INTEGER         NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    adults          SMALLINT        NOT NULL DEFAULT 1 CHECK (adults >= 0),
    children        SMALLINT        NOT NULL DEFAULT 0 CHECK (children >= 0),
    opened_at       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    closed_at       TIMESTAMPTZ     NULL,           -- NULL = sessione ancora aperta
    -- Directus standard fields
    user_created    UUID            NULL REFERENCES directus_users(id),
    date_created    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bill_sessions_table ON bill_sessions("table", status);
```

---

### 2.8 `orders` — Comande

**Primary key**: UUID v7 (time-ordered, generato client-side — sostituisce il vecchio `ord_rX91`).

Campi Directus standard abilitati: `user_created`, `date_created`, `user_updated`, `date_updated`.
Il campo `status` è il campo di dominio applicativo (workflow cucina/cassa), non il campo
workflow Directus.

```sql
CREATE TYPE order_status AS ENUM (
    'pending',      -- comanda inviata dalla Sala, in attesa di accettazione Cassa
    'accepted',     -- accettata dalla Cassa → appare in Cucina (Da Preparare)
    'preparing',    -- cucina ha iniziato la preparazione (In Cottura)
    'ready',        -- cucina ha terminato (Pronte) — in attesa consegna
    'delivered',    -- consegnata al tavolo dal personale di sala (conto ancora aperto)
    'completed',    -- saldo avvenuto (solo pagamento)
    'rejected'      -- rifiutata dalla Cassa
);

CREATE TABLE orders (
    id                      UUID            PRIMARY KEY,    -- UUID v7 generato client-side
    status                  order_status    NOT NULL DEFAULT 'pending',
    venue                   INTEGER         NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    "table"                 VARCHAR(10)     NOT NULL REFERENCES tables(id) ON DELETE RESTRICT,
    bill_session            UUID            NULL REFERENCES bill_sessions(id) ON DELETE SET NULL,
    order_time              TIME            NOT NULL,       -- 'HH:MM'
    total_amount            NUMERIC(10,2)   NOT NULL DEFAULT 0.00,
    item_count              INTEGER         NOT NULL DEFAULT 0,
    is_cover_charge         BOOLEAN         NOT NULL DEFAULT FALSE,  -- TRUE = riga coperto (aggiunta automatica all'apertura tavolo)
    dietary_diets           TEXT[]          NULL,           -- es. ['Vegetariano']
    dietary_allergens       TEXT[]          NULL,
    global_note             TEXT            NOT NULL DEFAULT '',  -- nota libera sull'intero ordine (order.globalNote)
    note_visibility_cassa   BOOLEAN         NOT NULL DEFAULT TRUE,  -- order.noteVisibility.cassa
    note_visibility_sala    BOOLEAN         NOT NULL DEFAULT TRUE,  -- order.noteVisibility.sala
    note_visibility_cucina  BOOLEAN         NOT NULL DEFAULT TRUE,  -- order.noteVisibility.cucina
    is_direct_entry         BOOLEAN         NOT NULL DEFAULT FALSE,  -- TRUE = voce diretta (bypassa workflow cucina, status subito 'accepted'); vale anche per is_cover_charge = TRUE
    rejection_reason        TEXT            NULL,           -- causale rifiuto compilata dal cassiere/sala (opzionale); valorizzata solo quando status = 'rejected'
    -- Directus standard fields
    user_created            UUID            NULL REFERENCES directus_users(id),
    date_created            TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    user_updated            UUID            NULL REFERENCES directus_users(id),
    date_updated            TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_table      ON orders("table", status);
CREATE INDEX idx_orders_session    ON orders(bill_session);
CREATE INDEX idx_orders_venue      ON orders(venue, status);
```

---

### 2.9 `order_items` — Righe comanda

```sql
CREATE TABLE order_items (
    uid             VARCHAR(20)     NOT NULL,       -- es. 'r_1' (univoco nell'ordine)
    "order"         UUID            NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    dish            VARCHAR(50)     NULL REFERENCES menu_items(id) ON DELETE SET NULL,
    name            VARCHAR(120)    NOT NULL,       -- snapshot nome al momento dell'ordine
    unit_price      NUMERIC(8,2)    NOT NULL,
    quantity        SMALLINT        NOT NULL DEFAULT 1 CHECK (quantity >= 0),
    voided_quantity SMALLINT        NOT NULL DEFAULT 0 CHECK (voided_quantity >= 0),
    notes           TEXT[]          NULL,
    course          VARCHAR(10)     NULL CHECK (course IN ('prima', 'insieme', 'dopo')),  -- serving order: first/together/after
    sort_order      SMALLINT        NOT NULL DEFAULT 0,
    kitchen_ready   BOOLEAN         NOT NULL DEFAULT FALSE,  -- flag per toggle per-voce in App Cucina (Dettaglio)
    PRIMARY KEY (uid, "order"),
    CHECK (voided_quantity <= quantity)
);

CREATE INDEX idx_order_items_order ON order_items("order");
```

---

### 2.10 `order_item_modifiers` — Modificatori applicati a riga comanda

```sql
CREATE TABLE order_item_modifiers (
    id              SERIAL          PRIMARY KEY,
    "order"         UUID            NOT NULL,
    item_uid        VARCHAR(20)     NOT NULL,
    name            VARCHAR(80)     NOT NULL,       -- snapshot nome modificatore
    price           NUMERIC(8,2)    NOT NULL DEFAULT 0.00,
    voided_quantity SMALLINT        NOT NULL DEFAULT 0 CHECK (voided_quantity >= 0),
    FOREIGN KEY (item_uid, "order") REFERENCES order_items(uid, "order") ON DELETE CASCADE
);

CREATE INDEX idx_oi_modifiers_item ON order_item_modifiers("order", item_uid);
```

---

### 2.11 `transactions` — Pagamenti e sconti

**Primary key**: UUID v7 (time-ordered, generato client-side — sostituisce il vecchio `txn_abc123`).

Campi Directus standard abilitati: `user_created`, `date_created`.

```sql
CREATE TYPE transaction_operation AS ENUM ('unico', 'romana', 'ordini', 'analitica', 'discount', 'tip');
CREATE TYPE discount_type AS ENUM ('percent', 'fixed');

CREATE TABLE transactions (
    id                  UUID                    PRIMARY KEY,    -- UUID v7 generato client-side
    venue               INTEGER                 NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    "table"             VARCHAR(10)             NOT NULL REFERENCES tables(id) ON DELETE RESTRICT,
    bill_session        UUID                    NULL REFERENCES bill_sessions(id) ON DELETE SET NULL,
    operation_type      transaction_operation   NOT NULL,
    payment_method      VARCHAR(30)             NULL REFERENCES payment_methods(id) ON DELETE SET NULL,
    amount_paid         NUMERIC(10,2)           NOT NULL,   -- importo pagato o sconto
    tip_amount          NUMERIC(8,2)            NOT NULL DEFAULT 0.00,
    -- romana (dividi il conto)
    romana_split_count  SMALLINT                NULL,       -- quote pagate in questa transazione
    split_quota         NUMERIC(10,2)           NULL,       -- valore di ogni quota
    split_ways          SMALLINT                NULL,       -- totale divisori
    -- sconto
    discount_type       discount_type           NULL,
    discount_value      NUMERIC(10,2)           NULL,       -- % o importo fisso
    -- Directus standard fields
    user_created        UUID                    NULL REFERENCES directus_users(id),
    date_created        TIMESTAMPTZ             NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transactions_table   ON transactions("table");
CREATE INDEX idx_transactions_session ON transactions(bill_session);
CREATE INDEX idx_transactions_venue   ON transactions(venue, date_created);
```

---

### 2.12 `transaction_voce_refs` — Righe Analitica (Voce + Quantità)

Usata solo per le transazioni con `operation_type = 'analitica'`.
Registra quale voce di comanda (o variazione a pagamento) è stata incassata e in che quantità,
consentendo pagamenti parziali su singole voci (es. 1 su 2 coperti).

La chiave (`voce_key`) segue il formato prodotto da `buildFlatAnaliticaItems`:
- voce base: `{orderId}__{itemUid}`
- variazione a pagamento: `{orderId}__{itemUid}__mod__{modIdx}`

```sql
CREATE TABLE transaction_voce_refs (
    transaction     UUID            NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    voce_key        VARCHAR(100)    NOT NULL,   -- es. '<uuid>__r_1' o '<uuid>__r_1__mod__1'
    qty             SMALLINT        NOT NULL CHECK (qty > 0),
    PRIMARY KEY (transaction, voce_key)
);
```

---

### 2.13 `transaction_order_refs` — Collegamento N:M Pagamento ↔ Comanda

```sql
CREATE TABLE transaction_order_refs (
    transaction     UUID            NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    "order"         UUID            NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    PRIMARY KEY (transaction, "order")
);
```

---

### 2.14 `cash_movements` — Movimenti di cassa

**Primary key**: UUID v7 (time-ordered, generato client-side — sostituisce il vecchio `mov_abc123`).

Campi Directus standard abilitati: `user_created`, `date_created`.

```sql
CREATE TYPE cash_movement_type AS ENUM ('deposit', 'withdrawal');

CREATE TABLE cash_movements (
    id          UUID                PRIMARY KEY,    -- UUID v7 generato client-side
    venue       INTEGER             NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    type        cash_movement_type  NOT NULL,
    amount      NUMERIC(10,2)       NOT NULL CHECK (amount > 0),
    reason      TEXT                NOT NULL DEFAULT '',
    -- Directus standard fields
    user_created UUID               NULL REFERENCES directus_users(id),
    date_created TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cash_movements_venue ON cash_movements(venue, date_created);
```

---

### 2.15 `daily_closures` — Chiusure giornaliere (rapporto Z)

Campi Directus standard abilitati: `user_created`, `date_created`.

```sql
CREATE TABLE daily_closures (
    id                  UUID            PRIMARY KEY,    -- UUID v7 generato client-side
    venue               INTEGER         NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    closure_type        CHAR(1)         NOT NULL DEFAULT 'Z', -- 'Z' = chiusura giornaliera
    cash_balance        NUMERIC(10,2)   NOT NULL DEFAULT 0.00,
    total_received      NUMERIC(10,2)   NOT NULL DEFAULT 0.00,
    total_discount      NUMERIC(10,2)   NOT NULL DEFAULT 0.00,
    total_tips          NUMERIC(10,2)   NOT NULL DEFAULT 0.00,
    total_covers        INTEGER         NOT NULL DEFAULT 0,
    receipt_count       INTEGER         NOT NULL DEFAULT 0,
    average_receipt     NUMERIC(10,2)   NOT NULL DEFAULT 0.00,
    total_movements     NUMERIC(10,2)   NOT NULL DEFAULT 0.00,  -- netto movimenti cassa
    final_balance       NUMERIC(10,2)   NOT NULL DEFAULT 0.00,
    -- Directus standard fields
    user_created        UUID            NULL REFERENCES directus_users(id),
    date_created        TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_daily_closures_venue ON daily_closures(venue, date_created);
```

---

### 2.16 `daily_closure_by_method` — Dettaglio incassi per metodo (riga di daily_closures)

```sql
CREATE TABLE daily_closure_by_method (
    id              SERIAL          PRIMARY KEY,
    daily_closure   UUID            NOT NULL REFERENCES daily_closures(id) ON DELETE CASCADE,
    payment_method  VARCHAR(30)     NOT NULL REFERENCES payment_methods(id) ON DELETE RESTRICT,
    amount          NUMERIC(10,2)   NOT NULL DEFAULT 0.00
);
```

---

### 2.17 `app_settings` — Impostazioni applicazione per utente/dispositivo

Campi Directus standard abilitati: `date_updated`.

```sql
CREATE TABLE app_settings (
    id              SERIAL          PRIMARY KEY,
    venue           INTEGER         NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    device_key      VARCHAR(120)    NOT NULL DEFAULT 'default',  -- es. UUID dispositivo
    sounds          BOOLEAN         NOT NULL DEFAULT TRUE,       -- avvisi audio "ding"
    menu_url        TEXT,                                        -- URL menu digitale (corrisponde a `menuUrl` in app-settings)
    pre_bill_printer VARCHAR(40)    NULL REFERENCES printers(id) ON DELETE SET NULL, -- default printer for pre-bill dispatch
    -- Directus standard fields
    date_updated    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    UNIQUE (venue, device_key)
);
```

---

### 2.18 `printers` — Stampanti ESC/POS configurate

I dati delle stampanti sono configurati staticamente in `appConfig.printers` e non sono persistiti
in localStorage. Con Directus si tradurrebbero nella seguente collection.

Campi Directus standard abilitati: `status`, `user_created`, `date_created`, `user_updated`, `date_updated`.

```sql
CREATE TABLE printers (
    id              VARCHAR(40)     PRIMARY KEY,            -- es. 'cucina', 'bar', 'cassa'
    status          VARCHAR(20)     NOT NULL DEFAULT 'published', -- 'published' | 'archived'
    venue           INTEGER         NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    name            VARCHAR(80)     NOT NULL,               -- nome visualizzato nella UI
    url             TEXT            NOT NULL,               -- URL servizio Node ESC/POS
    -- print_types: quali tipi di lavoro riceve questa stampante.
    -- Valori ammessi: 'order', 'table_move', 'pre_bill', oppure un tipo custom.
    -- Array vuoto / NULL = catch-all (riceve tutti i tipi).
    print_types     TEXT[]          NOT NULL DEFAULT '{}',
    -- categories: filtro menu per i lavori di tipo 'order'.
    -- Se vuoto, riceve tutte le voci del menu (catch-all).
    categories      TEXT[]          NOT NULL DEFAULT '{}',
    sort_order      SMALLINT        NOT NULL DEFAULT 0,
    -- Directus standard fields
    user_created    UUID            NULL REFERENCES directus_users(id),
    date_created    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    user_updated    UUID            NULL REFERENCES directus_users(id),
    date_updated    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
```

---

### 2.19 `print_jobs` — Log dei lavori di stampa (cronologia stampe)

Struttura dati unificata e flessibile per tutti i tipi di lavoro di stampa.
Il campo `payload` (JSONB) contiene i dati specifici per ogni tipo.

Campi Directus standard abilitati: `date_created`.

```sql
-- Enum dei possibili stati del lavoro di stampa
CREATE TYPE print_job_status AS ENUM ('pending', 'printing', 'done', 'error');

CREATE TABLE print_jobs (
    -- Identificatori
    log_id          VARCHAR(40)     PRIMARY KEY,            -- plog_<uuid> — chiave del log entry
    job_id          VARCHAR(40)     NOT NULL,               -- job_<uuid>  — inviato nella richiesta al servizio ESC/POS
    printer         VARCHAR(40)     NOT NULL REFERENCES printers(id) ON DELETE RESTRICT,
    venue           INTEGER         NOT NULL REFERENCES venues(id) ON DELETE CASCADE,

    -- Tipo di stampa (estensibile: aggiungere nuovi valori senza modificare lo schema)
    -- Valori correnti: 'order', 'table_move', 'pre_bill'
    print_type      VARCHAR(40)     NOT NULL,

    -- Stato avanzamento
    status          print_job_status NOT NULL DEFAULT 'pending',
    error_message   TEXT            NULL,                   -- popolato solo se status = 'error'

    -- Riepilogo human-readable (indipendente dal tipo)
    table_label     VARCHAR(120)    NOT NULL DEFAULT '',    -- e.g. '05', '01 → 02'
    job_timestamp   TIMESTAMPTZ     NOT NULL DEFAULT NOW(), -- job creation time (rinominato da 'timestamp' per evitare conflitti con parole riservate)

    -- Ristampa
    is_reprint      BOOLEAN         NOT NULL DEFAULT FALSE,
    original_job_id VARCHAR(40)     NULL,                   -- solo per ristampe: contiene il job_id originale, non il log_id

    -- Payload completo inviato al servizio ESC/POS (struttura libera per tipo)
    -- Campi comuni a tutti i tipi:
    --   jobId, printType, printerId, table, timestamp
    -- Campi per 'order':
    --   orderId, time, globalNote, items[] (name, quantity, unitPrice, notes, course, modifiers)
    -- Campi per 'table_move':
    --   fromTableId, fromTableLabel, toTableId, toTableLabel
    -- Campi per 'pre_bill':
    --   tableId, tableLabel, grossAmount, paymentsRecorded, amountDue, items[]
    -- Campi opzionali per ristampe:
    --   reprinted: true
    payload         JSONB           NOT NULL DEFAULT '{}',

    -- Directus standard fields
    date_created    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Indici per le query più frequenti (cronologia per punto vendita, stampante, tipo, stato)
CREATE INDEX idx_print_jobs_venue_ts    ON print_jobs (venue, job_timestamp DESC);
CREATE INDEX idx_print_jobs_printer     ON print_jobs (printer, job_timestamp DESC);
CREATE INDEX idx_print_jobs_type_status ON print_jobs (print_type, status);
```

---

## 3. Relazioni

```
venues ──< rooms ──< tables
venues ──< payment_methods
venues ──< menu_categories ──< menu_items ──< menu_item_modifiers
venues ──< bill_sessions >── tables
venues ──< orders >── tables
                    >── bill_sessions
orders ──< order_items ──< order_item_modifiers
                 >── menu_items  (snapshot, nullable, campo `dish`)
venues ──< transactions >── tables
                        >── bill_sessions
                        >── payment_methods
transactions >──< orders  (via transaction_order_refs)
transactions ──< transaction_voce_refs  (only when operation_type = 'analitica')
venues ──< cash_movements
venues ──< daily_closures ──< daily_closure_by_method
venues ──< printers
venues ──< print_jobs >── printers
Nota: `print_jobs.original_job_id` conserva il `job_id` originale per ristampe, ma non è una FK
venues ──< app_settings
```

Cardinalità:

| Da             | Relazione | A                        |
|----------------|-----------|--------------------------|
| venue          | 1 : N     | rooms                    |
| room           | 1 : N     | tables                   |
| venue          | 1 : N     | payment_methods          |
| venue          | 1 : N     | menu_categories          |
| menu_category  | 1 : N     | menu_items               |
| menu_item      | 1 : N     | menu_item_modifiers      |
| table          | 1 : N     | bill_sessions            |
| bill_session   | 1 : N     | orders                   |
| order          | 1 : N     | order_items              |
| order_item     | 1 : N     | order_item_modifiers     |
| bill_session   | 1 : N     | transactions             |
| transaction    | N : M     | orders                   |
| transaction    | 1 : N     | transaction_voce_refs    |
| venue          | 1 : N     | cash_movements           |
| venue          | 1 : N     | daily_closures           |
| daily_closure  | 1 : N     | daily_closure_by_method  |

---

## 4. Diagramma ER

```
┌─────────────┐     ┌──────────────────┐     ┌───────────────────┐
│   venues    │──1──│ menu_categories  │──1──│   menu_items      │
│─────────────│  N  │──────────────────│  N  │───────────────────│
│ id (PK)     │     │ id (PK)          │     │ id (PK)           │
│ status      │     │ venue (FK)       │     │ category (FK)     │
│ name        │     │ name             │     │ name              │
│ primary_    │     │ sort_order       │     │ price             │
│  color      │     │ status           │     │ allergens[]       │
│ currency    │     │ date_created     │     │ status            │
│ menu_url    │     └──────────────────┘     │ date_created      │
│ cover_      │                              │ date_updated      │
│  charge_*   │                              └────────┬──────────┘
│ billing_*   │                                       │ 1
│ date_created│                                       │ N
│ date_updated│                              ┌────────▼──────────┐
└──────┬──────┘                              │menu_item_modifiers│
       │ 1                                   │───────────────────│
       │                                     │ menu_item (FK)    │
       │ N                                   │ name              │
┌──────▼──────┐     ┌──────────────────┐     │ price             │
│   rooms     │──1──│     tables       │     │ status            │
│─────────────│  N  │──────────────────│     └───────────────────┘
│ id (PK)     │     │ id (PK)          │
│ venue (FK)  │     │ venue (FK)       │
│ label       │     │ room (FK, null)  │
│ status      │     │ label            │
│ sort_order  │     │ covers           │
└─────────────┘     │ status           │
                    │ sort_order       │
                    └────────┬─────────┘
                             │ 1
                             │ N
                    ┌────────▼──────────┐
                    │  bill_sessions    │
                    │──────────────────│
                    │ id (PK, UUIDv7)  │
                    │ table (FK)       │
                    │ venue (FK)       │
                    │ adults           │
                    │ children         │
                    │ status: open|closed │
                    │ opened_at        │
                    │ closed_at        │
                    │ date_created     │
                    └────────┬─────────┘
                             │ 1
                             │ N
             ┌───────────────▼─────────────────────────────┐
             │                 orders                       │
             │─────────────────────────────────────────────│
             │ id (PK, UUIDv7)                             │
             │ status: pending|accepted|...|rejected        │
             │ table (FK)                                   │
             │ bill_session (FK)                            │
             │ total_amount                                 │
             │ is_cover_charge / is_direct_entry            │
             │ global_note / note_visibility_*              │
             │ date_created / date_updated                  │
             └──────────────────────────┐──────────────────┘
                                        │ 1
                                        │ N
                               ┌────────▼──────────┐
                               │   order_items     │
                               │───────────────────│
                               │ uid + order PK    │
                               │ dish (FK null)    │
                               │ name (snapshot)   │
                               │ unit_price        │
                               │ quantity          │
                               │ voided_quantity   │
                               │ notes[]           │
                               │ course            │
                               │ kitchen_ready     │
                               └────────┬──────────┘
                                        │ 1
                                        │ N
                               ┌────────▼──────────────┐
                               │ order_item_modifiers  │
                               │───────────────────────│
                               │ id (PK)               │
                               │ order (FK)            │
                               │ item_uid (FK)         │
                               │ name (snapshot)       │
                               │ price                 │
                               │ voided_quantity       │
                               └───────────────────────┘

┌──────────────────────────────┐      ┌─────────────────────────────┐
│        transactions          │──N───│   transaction_order_refs    │
│──────────────────────────────│  M   │─────────────────────────────│
│ id (PK, UUIDv7)              │      │ transaction (FK)            │
│ table (FK)                   │      │ order (FK)                  │
│ bill_session (FK)            │      └─────────────────────────────┘
│ operation_type               │
│  unico|romana|ordini         │      ┌─────────────────────────────┐
│  analitica|discount          │──1───│   transaction_voce_refs     │
│ payment_method (FK)          │  N   │─────────────────────────────│
│ amount_paid                  │      │ transaction (FK)            │
│ tip_amount                   │      │ voce_key (<uuid>__uid[__mod__n]) │
│ romana_split_count           │      │ qty                         │
│ discount_type                │      └─────────────────────────────┘
│ discount_value               │
│ date_created                 │
└──────────────────────────────┘

┌──────────────────────┐     ┌──────────────────────────────────┐
│    cash_movements    │     │        daily_closures            │
│──────────────────────│     │──────────────────────────────────│
│ id (PK, UUIDv7)      │     │ id (PK)                          │
│ venue (FK)           │     │ venue (FK)                       │
│ type: deposit|withdrawal │     │ closure_type: 'Z'                │
│ amount               │     │ total_received                   │
│ reason               │     │ total_discount                   │
│ date_created         │     │ total_tips                       │
└──────────────────────┘     │ cash_balance                     │
                             │ receipt_count                    │
                             │ date_created                     │
                             └──────────────┬───────────────────┘
                                            │ 1
                                            │ N
                             ┌──────────────▼───────────────────┐
                             │   daily_closure_by_method        │
                             │──────────────────────────────────│
                             │ daily_closure (FK)               │
                             │ payment_method (FK)              │
                             │ amount                           │
                             └──────────────────────────────────┘
```

---

## 5. Note di migrazione

### 5.1 Corrispondenza localStorage → Collection Directus

| localStorage (`demo_app_state_v1`)    | Collection Directus                             |
|---------------------------------------|----------------------------------------|
| `orders[]`                            | `orders` + `order_items` + `order_item_modifiers` |
| `order.globalNote`                    | `orders.global_note`                   |
| `order.noteVisibility.{cassa,sala,cucina}` | `orders.note_visibility_{cassa,sala,cucina}` |
| `order.isDirectEntry`                 | `orders.is_direct_entry`               |
| `order.rejectionReason`               | `orders.rejection_reason`              |
| `transactions[]`                      | `transactions` + `transaction_order_refs` + `transaction_voce_refs` |
| `tableOccupiedAt`                     | `bill_sessions.opened_at`              |
| `billRequestedTables` (Set)           | query: `orders.status = 'pending'` con `bill_session` attiva |
| `tableCurrentBillSession`             | `bill_sessions` (righe con `status = 'open'`) |
| `tableMergedInto` (Object `{slaveId: masterId}`) | `table_merge_sessions` (slave_table, master_table); solo per unioni attive |
| `cashBalance`                         | somma di `cash_movements` + valore iniziale |
| `cashMovements[]`                     | `cash_movements`                       |
| `dailyClosures[]`                     | `daily_closures` + `daily_closure_by_method` |
| `printLog[]` (localStorage)           | `print_jobs`                           |
| `appConfig.printers`                  | `printers`                             |
| `app-settings` (localStorage)         | `app_settings`                         |
| `appConfig.menu`                      | `menu_categories` + `menu_items`       |
| `appConfig.rooms`                     | `rooms`                                |
| `appConfig.tables` (derivato)         | `tables`                               |
| `appConfig.paymentMethods`            | `payment_methods`                      |
| `appConfig.ui.*`                      | `venues`                               |
| `appConfig.coverCharge.*`             | `venues.cover_charge_*`                |
| `appConfig.billing.*`                 | `venues.billing_*`                     |
| `appConfig.billing.allowCustomEntry`  | `venues.billing_allow_custom_entry`    |
| `appConfig.orders.rejectionReasons`   | `venues.orders_rejection_reasons` (JSONB) |

### 5.2 Snapshot dei nomi nel DB

`order_items.name` e `order_item_modifiers.name` contengono snapshot del nome al momento
dell'ordine. Questo è intenzionale: permette di conservare la cronologia anche se la voce menu
viene rinominata o rimossa (`dish` è nullable per questo motivo).

### 5.2b Voci dirette (`is_direct_entry`)

Le comande create tramite "⚡ Diretto" in Cassa hanno `is_direct_entry = TRUE`.
Queste comande:
- saltano il workflow cucina (status subito `accepted`);
- non compaiono nella coda "In Cucina" della App Cucina;
- vengono incluse nel totale conto e nella fattura finale come qualsiasi altra comanda `accepted`;
- possono contenere sia voci dal menu standard (`dish` valorizzato) sia voci personalizzate
  (`dish` NULL, nome e prezzo liberi);
- includono anche il **coperto** (`is_cover_charge = TRUE`): quando l'auto-aggiunta del coperto è
  attiva, esso viene creato tramite `addDirectOrder()` e riceve anch'esso `is_direct_entry = TRUE`,
  bypassando il workflow cucina e mostrando il badge ⚡ Diretta nel pannello cassa.

> **Nota**: i due flag non si escludono a vicenda. Una riga con `is_cover_charge = TRUE` può
> avere contemporaneamente `is_direct_entry = TRUE`.

```sql
-- Recupera tutte le voci dirette attive per un tavolo (incluso coperto)
SELECT o.id, o.is_cover_charge, oi.name, oi.unit_price, oi.quantity
FROM orders o
JOIN order_items oi ON oi."order" = o.id
WHERE o."table" = :table_id
  AND o.is_direct_entry = TRUE
  AND o.status NOT IN ('completed', 'rejected');
```

### 5.2c Tavoli uniti (`tableMergedInto`)

La funzione **Unisci** in App Cassa permette di accorpare il conto di due tavoli occupati.
L'unione è rappresentata nel localStorage da `tableMergedInto`, un oggetto `{ slaveTableId: masterTableId }`.

Semantica:
- Al momento dell'unione (`mergeTableOrders`), vengono fisicamente spostate sul tavolo master **solo le comande appartenenti alla sessione di conto attiva dello slave** (`orders[]."table" = masterTableId` per gli ordini della current bill session). Il conto del master assorbe immediatamente queste voci attive.
- Il tavolo **slave** non ha più una sessione attiva propria (`tableCurrentBillSession[slaveId]` = undefined) né comande residue nella sessione corrente. Eventuali comande storiche / di sessioni precedenti restano invece associate al tavolo e alla `bill_session` originari, così da preservare l'isolamento per sessione. Il tavolo appare comunque **occupato** nella piantina grazie alla voce `tableMergedInto[slaveId] = masterId`: `getTableStatus(slaveId)` delega direttamente a `getTableStatus(masterId)`.
- In un database relazionale questa relazione è modellata con una collection dedicata per rappresentare il merge attivo:

```sql
-- Active table merges; row is deleted when the merge is undone (split)
CREATE TABLE table_merge_sessions (
    slave_table   VARCHAR(10) NOT NULL REFERENCES tables(id),
    master_table  VARCHAR(10) NOT NULL REFERENCES tables(id),
    merged_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (slave_table)
);
```

La funzione **Dividi** richiede la sequenza opposta: prima `splitTableOrders` rimuove la voce da `tableMergedInto` e rende di nuovo indipendente il tavolo slave (aprendo una nuova sessione se necessario), poi `splitItemsToTable` può spostare sullo slave le voci selezionate. Il master mantiene le voci rimaste.

### 5.3 Calcolo totale riga

```sql
-- Totale attivo per una riga order_item (equivale a getOrderItemRowTotal)
SELECT
    oi.unit_price * (oi.quantity - oi.voided_quantity) AS base_total,
    COALESCE(SUM(
        oim.price * GREATEST(0, (oi.quantity - oi.voided_quantity) - oim.voided_quantity)
    ), 0) AS modifiers_total,
    oi.unit_price * (oi.quantity - oi.voided_quantity)
        + COALESCE(SUM(
              oim.price * GREATEST(0, (oi.quantity - oi.voided_quantity) - oim.voided_quantity)
          ), 0) AS row_total
FROM order_items oi
LEFT JOIN order_item_modifiers oim ON oim."order" = oi."order" AND oim.item_uid = oi.uid
WHERE oi."order" = :order_id
GROUP BY oi.uid, oi."order";
```

### 5.4 Stato tavolo

```sql
-- Equivalente di store.getTableStatus(tableId)
SELECT
    t.id AS table_id,
    bs.id AS bill_session_id,
    CASE
        WHEN bs.id IS NULL                              THEN 'free'
        WHEN EXISTS (
            SELECT 1 FROM orders o
            WHERE o.bill_session = bs.id AND o.status = 'pending'
        )                                               THEN 'pending'
        WHEN EXISTS (
            SELECT 1 FROM orders o
            WHERE o.bill_session = bs.id
              AND o.status NOT IN ('completed','rejected')
        )                                               THEN 'occupied'
        ELSE 'free'
    END AS status
FROM tables t
LEFT JOIN bill_sessions bs ON bs."table" = t.id AND bs.status = 'open'
WHERE t.id = :table_id;
```

### 5.5 Integrazione Directus

Con Directus come backend, ogni collection è configurata tramite la Data Studio UI o via API.
Le relazioni `1:N` usano il tipo di campo *Many-to-One* di Directus; le `N:M` usano *junction
collections* (Many-to-Many). I campi `date_created` / `date_updated` / `user_created` /
`user_updated` sono abilitati nelle *Collection Settings → Fields* e vengono valorizzati
automaticamente dal server Directus.

Flusso di integrazione previsto:
1. **Config** (venues, rooms, tables, menu_*, printers, payment_methods): caricati all'avvio
   dell'app tramite GET e memorizzati in IndexedDB per uso offline.
2. **Operazioni** (orders, transactions, cash_movements): creati localmente con UUID v7 e
   sincronizzati verso Directus in modalità **push** non appena `navigator.onLine` torna `true`.
3. **Sessioni tavolo** (bill_sessions): create localmente e sincronizzate come gli ordini.
4. **Reportistica** (daily_closures, print_jobs): push-only, mai modificati dopo la creazione.

### 5.6 Integrazione IndexedDB (PWA offline-first)

Per uso offline, la struttura `demo_app_state_v1` (localStorage) verrà sostituita da **object
store IndexedDB** che rispecchiano le collection Directus. Le tabelle di configurazione vengono
mantenute in cache mentre le tabelle operative gestiscono una coda di sync.

```
-- Collections operative (UUID v7 come keyPath, generate client-side)
ObjectStore: bill_sessions
  keyPath:  id (UUIDv7)
  indexes:  [table, status]

ObjectStore: orders
  keyPath:  id (UUIDv7)
  indexes:  [table, status, bill_session]

ObjectStore: order_items
  keyPath:  [uid, order]   -- chiave composta
  indexes:  [order]

ObjectStore: order_item_modifiers
  keyPath:  id (auto-increment locale)
  indexes:  [order, item_uid]

ObjectStore: transactions
  keyPath:  id (UUIDv7)
  indexes:  [table, bill_session]

ObjectStore: transaction_order_refs
  keyPath:  [transaction, order]
  indexes:  [transaction]

ObjectStore: transaction_voce_refs
  keyPath:  [transaction, voce_key]
  indexes:  [transaction]

ObjectStore: cash_movements
  keyPath:  id (UUIDv7)
  indexes:  [venue, date_created]

ObjectStore: daily_closures
  keyPath:  id (UUIDv7 generato lato client per i nuovi record)
  indexes:  [venue]

-- Collections di configurazione (cache locale, aggiornata al primo avvio online)
ObjectStore: venues           keyPath: id
ObjectStore: rooms            keyPath: id
ObjectStore: tables           keyPath: id    indexes: [room, venue]
ObjectStore: payment_methods  keyPath: id
ObjectStore: menu_categories  keyPath: id    indexes: [venue]
ObjectStore: menu_items       keyPath: id    indexes: [category]
ObjectStore: menu_item_modifiers  keyPath: id  indexes: [menu_item]
ObjectStore: printers         keyPath: id

-- Coda di sincronizzazione (operazioni in attesa di push verso Directus)
-- Questo store è locale-only: non viene mai inviato a Directus.
ObjectStore: sync_queue
  keyPath:  id (UUIDv7)
  indexes:  [collection, date_created]
  -- record: { id, collection, operation: 'create'|'update'|'delete',
  --           record_id, payload, date_created, attempts }
```

La sincronizzazione avviene tramite un **Service Worker** (o un loop `online` nel composable
dedicato) che:
1. Quando `navigator.onLine` è `true` o scatta l'evento `online`, legge la `sync_queue`
   ordinata per `date_created` ASC.
2. Per ogni record tenta un `POST /items/{collection}` (create) o `PATCH /items/{collection}/{record_id}`
   (update) verso l'API Directus. L'`id` del record della coda identifica solo l'entry in
   `sync_queue` e **non** va usato nella URL Directus: per gli update `{record_id}` è l'id del
   record applicativo target su Directus; per i create l'id del record target è tipicamente nel
   `payload` (se generato lato client) oppure viene restituito dal server.
3. In caso di successo rimuove il record dalla coda; in caso di errore incrementa `attempts`
   (max 5) e pianifica un retry con back-off esponenziale.
4. I conflitti di merge (es. lo stesso ordine modificato su due dispositivi offline) vengono
   risolti con strategia **last-write-wins** su `date_updated`.

---

### 5.7 Architettura di sincronizzazione multi-dispositivo

Questa sezione descrive il modello completo di sincronizzazione dati tra i dispositivi
(cassa, sala, cucina) — ciascuno con il proprio IndexedDB locale — e l'istanza centralizzata
Directus, in entrambe le direzioni.

#### 5.7.1 Topologia e ruoli dei dispositivi

```
┌───────────────────────────────────────────────────────────────────┐
│                    Istanza Directus (backend)                     │
│              API REST /items/{collection}                         │
│              WebSocket / SSE per notifiche real-time              │
└────────┬──────────────┬──────────────────┬────────────────────────┘
         │              │                  │
   ┌─────▼──────┐  ┌────▼───────┐   ┌──────▼──────┐
   │   Cassa    │  │   Sala     │   │   Cucina    │
   │ IndexedDB  │  │ IndexedDB  │   │ IndexedDB   │
   │            │  │            │   │             │
   │ sync_queue │  │ sync_queue │   │ sync_queue  │
   └────────────┘  └────────────┘   └─────────────┘
```

- **Cassa**: legge configurazione completa; scrive `bill_sessions`, `orders` (accepted/rejected),
  `transactions`, `cash_movements`, `daily_closures`, `print_jobs`.
- **Sala**: legge `tables`, `bill_sessions`, `orders`; scrive `orders` (pending/delivered).
- **Cucina**: legge `orders` (accepted → ready); scrive aggiornamenti di stato (`preparing`,
  `ready`) su `orders` e `order_items.kitchen_ready`.

#### 5.7.2 Direzione PUSH — da IndexedDB a Directus

Ogni operazione locale (create / update) viene prima applicata al proprio IndexedDB, così da
rendere immediata la persistenza locale in modalità offline-first; solo dopo, e solo se la
scrittura locale è riuscita, viene registrata una voce nella `sync_queue` per la sincronizzazione
verso Directus. Non appena `navigator.onLine` è `true` (o scatta l'evento `online`), il
composable `useSyncQueue` (o il Service Worker dedicato) svuota la coda in ordine `date_created`
ASC:

```
Operazione locale
      │
      ▼
1. Scrivi in IndexedDB (immediato, ottimistico)
2. Aggiungi voce in sync_queue
      │
      ▼  (quando online)
3. POST /items/{collection}        ← create  → payload contiene id UUIDv7 già assegnato
   PATCH /items/{collection}/{record_id}  ← update
   PATCH /items/{collection}/{record_id}  ← delete (soft: imposta `status = 'archived'`)
      │
      ├── 200/201 OK → rimuovi da sync_queue
      └── errore    → incrementa attempts (max 5, back-off esponenziale: 2^n secondi)
                       dopo 5 tentativi → rimuovi dal retry automatico e invia a revisione manuale
```

**Nota**: poiché gli ID sono UUIDv7 generati client-side, non si verificano collisioni tra
dispositivi diversi anche in assenza di coordinamento server.

#### 5.7.3 Direzione PULL — da Directus a IndexedDB (aggiornamento remoto)

I dispositivi ricevono aggiornamenti prodotti dagli altri dispositivi in due modi:

**A) Polling periodico (fallback compatibile)**
```
Ogni N secondi (es. 5s cassa, 3s sala/cucina):
  GET /items/orders?filter[date_updated][_gt]={last_pull_ts}&sort=date_updated
  GET /items/bill_sessions?filter[date_updated][_gt]={last_pull_ts}
  ...
  → merge in IndexedDB (upsert per id, last-write-wins su date_updated)
  → aggiorna last_pull_ts = max(date_updated) tra i record ricevuti
```

**B) Real-time via Directus Subscriptions (WebSocket)**
```
client.subscribe('orders', {
  query: { filter: { venue: { _eq: venueId } } }
})
→ evento 'create'  → insert in IndexedDB
→ evento 'update'  → upsert in IndexedDB (confronta date_updated)
→ evento 'delete'  → rimuovi da IndexedDB (o aggiorna status = 'archived')
```

La modalità B è preferita quando disponibile; la A è il fallback per ambienti senza WebSocket.

#### 5.7.4 Risoluzione conflitti

| Tipo di conflitto | Strategia |
|---|---|
| Stesso record modificato su due dispositivi offline | **Last-write-wins** su `date_updated` |
| `order.status` divergente tra dispositivi | Priorità al valore con rank più alto: `pending < accepted < preparing < ready < delivered < completed` (e `rejected` finale) |
| `bill_session.status` divergente | `closed` è terminale: non può tornare a `open` |
| `order_items.kitchen_ready` | OR logico: se un dispositivo ha messo `true`, rimane `true` |
| Doppio create stesso `id` (UUIDv7) | Impossibile con UUID v7 correttamente generati; in caso di conflitto Directus restituisce 409 → il client tratta come update |

#### 5.7.5 Sequenza completa — esempio flusso comanda

```
[Sala — offline]               [Cassa]              [Cucina]         [Directus]

1. Sala crea order (pending)
   → IndexedDB + sync_queue

2. Sala torna online
   → POST /items/orders        ──────────────────────────────────→  salva order
   → rimuove da sync_queue

3. Cassa riceve order
   ← polling / WebSocket ←──────────────────────────────────────── GET orders

4. Cassa accetta order
   → IndexedDB status=accepted                                    PATCH /items/orders/{id}
   → sync_queue push                                        ──────→ aggiorna status

5. Cucina riceve order
   ← polling / WS ←──────────────────────────────────────────────  GET orders (accepted)

6. Cucina mette in preparazione
   → IndexedDB status=preparing                                   PATCH /items/orders/{id}
   → sync_queue push                                       ──────→ aggiorna status

7. Sala riceve aggiornamento
   ← polling / WS ←────────────────────────────────────────────── GET orders

8. Cucina mette ready
   → IndexedDB status=ready + kitchen_ready=true                  PATCH /items/orders/{id}
   → sync_queue push                                       ──────→ aggiorna status

9. Cassa / Sala vedono ready
   ← polling / WS ←──────────────────────────────────────────────

10. Cassa incassa (transaction)
    → IndexedDB transaction + bill_session.status=closed
    → sync_queue: POST /items/transactions
                  PATCH /items/bill_sessions/{id} (status=closed)
    → aggiorna orders: status=completed                    ──────→ Directus aggiorna tutto
```

#### 5.7.6 Configurazione pull per app

| App     | Collections pull obbligatorie                         | Intervallo polling | Real-time |
|---------|-------------------------------------------------------|--------------------|-----------|
| Cassa   | `orders`, `bill_sessions`, `tables`                   | 5 s                | preferito |
| Sala    | `orders`, `bill_sessions`, `tables`, `menu_items`     | 3 s                | preferito |
| Cucina  | `orders`, `order_items`                               | 3 s                | preferito |
| Tutti   | `venues`, `rooms`, `payment_methods`, `menu_*`, `printers` | avvio + 5 min | opzionale |

#### 5.7.7 Gestione della coda offline — stato del record locale

Ogni record in IndexedDB ha un campo aggiuntivo `_sync_status` (locale-only, mai inviato a
Directus) che indica lo stato di allineamento:

| `_sync_status` | Significato |
|---|---|
| `'synced'`    | Allineato con Directus |
| `'pending'`   | In coda per push (operazione in `sync_queue`) |
| `'error'`     | Ultimo tentativo di push fallito (vedi `sync_queue.attempts`) |
| `'conflict'`  | Conflitto rilevato durante pull (richiede risoluzione) |

La UI può usare `_sync_status` per mostrare indicatori visivi (es. icona nuvola con X per `error`).

#### 5.7.8 Piano di migrazione (sviluppo attivo)

L'applicazione è in fase di sviluppo: il passaggio avviene in **due step sequenziali** senza
necessità di un periodo di coesistenza (non ci sono sessioni in produzione da preservare).

**Step 1 — da localStorage a IndexedDB (prossimo step)**

Obiettivo: sostituire `demo_app_state_v1` (e `app-settings`) con IndexedDB come unica sorgente
dati locale, implementando la `sync_queue` per le operazioni offline.

```
Attività:
  1. Definire e aprire il database IndexedDB (con versioning e schema degli ObjectStore).
  2. Sostituire ogni lettura/scrittura su localStorage con le API IndexedDB
     (es. wrappate in composables come useIDBStore()).
  3. Implementare useSyncQueue: ogni mutazione scrive prima in IndexedDB, poi aggiunge
     una voce in sync_queue.
  4. Rimuovere la logica localStorage dalle app una volta validato il funzionamento.

Risultato: stato applicativo interamente su IndexedDB, sync verso Directus in coda ma
ancora non attivo (Directus può essere non configurato in questa fase).
```

**Step 2 — da IndexedDB a Directus (step successivo)**

Obiettivo: abilitare la sincronizzazione bidirezionale con l'istanza Directus (push + pull)
come descritto nei §5.7.2 e §5.7.3.

```
Attività:
  1. Configurare l'istanza Directus con le collection e i permessi necessari.
  2. Attivare il loop di push: useSyncQueue drena la sync_queue verso l'API Directus.
  3. Attivare il loop di pull: polling periodico o Directus Subscriptions (WebSocket)
     per ricevere aggiornamenti dagli altri dispositivi.
  4. Validare la risoluzione conflitti (last-write-wins su date_updated) su scenari
     multi-dispositivo (cassa + sala + cucina contemporaneamente offline).

Risultato: architettura completa offline-first con Directus come backend autoritativo.
```
