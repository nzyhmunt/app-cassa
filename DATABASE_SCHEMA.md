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
*Collection Settings → Fields*. In Directus questi campi vengono valorizzati automaticamente dal server Directus
(non dal client); se si leggono i DDL SQL come schema puro, l'aggiornamento automatico in modifica richiede
trigger DB o logica equivalente.

| Campo                  | Tipo Directus        | Note                                                                                                       |
|------------------------|----------------------|------------------------------------------------------------------------------------------------------------|
| `status` / `record_status` | `string`         | Stato workflow (`published`, `draft`, `archived`, o valori custom). Usare `status` solo se non è già un campo di dominio; in caso di conflitto usare un campo dedicato come `record_status`. |
| `user_created`         | M2O `directus_users` | Utente che ha creato il record — valorizzato solo alla creazione                                           |
| `date_created`         | `dateTime`           | Data/ora di creazione — valorizzata solo alla creazione                                                    |
| `user_updated`         | M2O `directus_users` | Ultimo utente che ha modificato il record — aggiornato a ogni modifica da Directus                         |
| `date_updated`         | `dateTime`           | Data/ora dell'ultima modifica — aggiornata a ogni modifica da Directus (o via trigger DB)                 |

> **Separazione tra stato di dominio e soft-delete/workflow**: nelle collection che hanno già un
> campo `status` applicativo (per esempio `orders`, `bill_sessions`, `print_jobs`), quel campo resta
> riservato alla semantica di business e **non** deve essere riutilizzato per workflow o archiviazione
> Directus. In questi casi usare un campo dedicato, ad esempio `record_status`, per valori come
> `published`, `draft`, `archived`. Di conseguenza, la strategia di soft-delete deve usare
> `PATCH { "record_status": "archived" }` e non `PATCH { "status": "archived" }`.
> **Nota sui nomi FK**: le relazioni Many-to-One usano il **nome del campo senza suffisso `_id`**
> (es. `venue`, non `venue_id`; `room`, non `room_id`). Questo è il comportamento predefinito
> di Directus. Nei DDL SQL sottostanti i nomi di colonna riservati come `table` e `order`
> devono essere quotati (`"table"`, `"order"`).

> **UUID v7**: tutte le collection operative (`bill_sessions`, `orders`, `order_items`,
> `order_item_modifiers`, `transactions`, `transaction_order_refs`, `transaction_voce_refs`,
> `cash_movements`, `daily_closures`, `daily_closure_by_method`) usano **UUID v7** come
> primary key — generato client-side prima dell'invio a Directus. UUID v7 è time-ordered
> (ms prefix), il che garantisce ordinamento cronologico naturale, minimizza la frammentazione
> degli indici B-tree con inserimenti massivi da client offline, e garantisce unicità globale
> tra dispositivi diversi senza coordinamento server. Nessuna collection operativa usa `SERIAL`
> o PK composta. Lato Directus: tipo `uuid`; lato IndexedDB: stringa da 36 char generata
> client-side con una libreria compatibile (es. package `uuid` v9+, tipicamente tramite export `v7`).

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
   - 5.8 [Strategia di purge IndexedDB](#58-strategia-di-purge-indexeddb)
   - 5.9 [Gestione credenziali e autenticazione](#59-gestione-credenziali-e-autenticazione)

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
| `venue_users`            | Operatori locali per venue (PIN personale)               | —                            |

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

Campi Directus standard abilitati: `user_created`, `date_created`, `user_updated`, `date_updated`.

> **Nota `status`**: il campo `status` è un **campo di dominio applicativo** con valori custom
> (`open`/`closed`), non il campo workflow Directus con i valori di default (`published`/`draft`/
> `archived`). In Directus va configurato come campo `select-dropdown` (o `input`) con i valori
> applicativi, **non** come "Status Field" nelle impostazioni collection.

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
    date_created    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    user_updated    UUID            NULL REFERENCES directus_users(id),
    date_updated    TIMESTAMPTZ     NULL            -- aggiornato a ogni modifica da Directus (o trigger DB)
);

CREATE INDEX idx_bill_sessions_table ON bill_sessions("table", status);
```

---

### 2.8 `orders` — Comande

**Primary key**: UUID v7 (time-ordered, generato client-side — sostituisce il vecchio `ord_rX91`).

Campi Directus standard abilitati: `user_created`, `date_created`, `user_updated`, `date_updated`.
Il campo `status` è un **campo di dominio applicativo** (workflow cucina/cassa) con valori custom
(`pending`/`accepted`/`preparing`/`ready`/`delivered`/`completed`/`rejected`) e **non** va
configurato come "Status Field" Directus (che userebbe `published`/`draft`/`archived`). In
Directus questa collection non ha un workflow field nativo; `status` è un normale campo enum.

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
    id              UUID            PRIMARY KEY,    -- UUID v7 generato client-side
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
    status          VARCHAR(20)     NOT NULL DEFAULT 'active', -- 'active' | 'archived' (soft-delete)
    -- Directus standard fields
    date_created    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    UNIQUE (uid, "order"),  -- unicità logica preservata come vincolo, non come PK
    CHECK (voided_quantity <= quantity)
);

CREATE INDEX idx_order_items_order ON order_items("order");
```

---

### 2.10 `order_item_modifiers` — Modificatori applicati a riga comanda

```sql
CREATE TABLE order_item_modifiers (
    id              UUID            PRIMARY KEY,    -- UUID v7 generato client-side
    "order"         UUID            NOT NULL,
    item_uid        VARCHAR(20)     NOT NULL,
    name            VARCHAR(80)     NOT NULL,       -- snapshot nome modificatore
    price           NUMERIC(8,2)    NOT NULL DEFAULT 0.00,
    voided_quantity SMALLINT        NOT NULL DEFAULT 0 CHECK (voided_quantity >= 0),
    status          VARCHAR(20)     NOT NULL DEFAULT 'active', -- 'active' | 'archived' (soft-delete)
    -- Directus standard fields
    date_created    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
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
    status              VARCHAR(20)             NOT NULL DEFAULT 'active', -- 'active' | 'archived' (soft-delete)
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
    id              UUID            PRIMARY KEY,    -- UUID v7 generato client-side
    transaction     UUID            NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    voce_key        VARCHAR(100)    NOT NULL,   -- es. '<uuid>__r_1' o '<uuid>__r_1__mod__1'
    qty             SMALLINT        NOT NULL CHECK (qty > 0),
    UNIQUE (transaction, voce_key)
);
```

---

### 2.13 `transaction_order_refs` — Collegamento N:M Pagamento ↔ Comanda

```sql
CREATE TABLE transaction_order_refs (
    id              UUID            PRIMARY KEY,    -- UUID v7 generato client-side
    transaction     UUID            NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    "order"         UUID            NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    UNIQUE (transaction, "order")
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
    status      VARCHAR(20)         NOT NULL DEFAULT 'active', -- 'active' | 'archived' (soft-delete)
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
    status              VARCHAR(20)     NOT NULL DEFAULT 'active', -- 'active' | 'archived' (soft-delete)
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
    id              UUID            PRIMARY KEY,    -- UUID v7 generato client-side
    daily_closure   UUID            NOT NULL REFERENCES daily_closures(id) ON DELETE CASCADE,
    payment_method  VARCHAR(30)     NOT NULL REFERENCES payment_methods(id) ON DELETE RESTRICT,
    amount          NUMERIC(10,2)   NOT NULL DEFAULT 0.00,
    status          VARCHAR(20)     NOT NULL DEFAULT 'active', -- 'active' | 'archived' (soft-delete)
    -- Directus standard fields
    date_created    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
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
    -- job_timestamp: momento di creazione del job lato app (client-side, impostato offline).
    -- Differisce da date_created (valorizzato da Directus all'inserimento server-side):
    -- in scenari offline-first i due campi possono divergere se il push avviene in ritardo.
    job_timestamp   TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

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
                               │ id (PK)           │
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
  keyPath:  id (UUIDv7)
  indexes:  [order, uid]   -- uid+order usati per lookup logico (vincolo UNIQUE)

ObjectStore: order_item_modifiers
  keyPath:  id (UUIDv7)
  indexes:  [order, item_uid]

ObjectStore: transactions
  keyPath:  id (UUIDv7)
  indexes:  [table, bill_session]

ObjectStore: transaction_order_refs
  keyPath:  id (UUIDv7)
  indexes:  [transaction, order]

ObjectStore: transaction_voce_refs
  keyPath:  id (UUIDv7)
  indexes:  [transaction, voce_key]

ObjectStore: cash_movements
  keyPath:  id (UUIDv7)
  indexes:  [venue, date_created]

ObjectStore: daily_closures
  keyPath:  id (UUIDv7)
  indexes:  [venue]

ObjectStore: daily_closure_by_method
  keyPath:  id (UUIDv7)
  indexes:  [daily_closure]

-- Collections di configurazione (cache locale, aggiornata al primo avvio online)
ObjectStore: venues           keyPath: id
ObjectStore: rooms            keyPath: id
ObjectStore: tables           keyPath: id    indexes: [room, venue]
ObjectStore: payment_methods  keyPath: id
ObjectStore: menu_categories  keyPath: id    indexes: [venue]
ObjectStore: menu_items       keyPath: id    indexes: [category]
ObjectStore: menu_item_modifiers  keyPath: id  indexes: [menu_item]
ObjectStore: printers         keyPath: id
ObjectStore: venue_users      keyPath: id    indexes: [venue, role, status]

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
   -- delete strategy:
   --
   --   (A) Tabelle con status generico/workflow → soft-delete: PATCH { "status": "archived" }
   --       venues, rooms, tables, menu_*, payment_methods, printers
   --       transactions, cash_movements, order_items, order_item_modifiers,
   --       daily_closures, daily_closure_by_method
   --
   --   (B) Tabelle con status di dominio (ENUM applicativo) → NESSUN DELETE
   --       Il ciclo di vita è gestito dalle transizioni di stato: es. bill_sessions
   --       termina con status='closed', orders con status='completed'/'rejected',
   --       print_jobs con status='done'/'error'. Non sono mai cancellate.
   --
   --   (C) Junction tables → hard DELETE /items/{collection}/{record_id}
   --       transaction_order_refs, transaction_voce_refs
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
→ evento 'update'  → upsert in IndexedDB (confronta date_updated); include anche
                     archiviazione (status='archived') per le tabelle (A) e le transizioni
                     di dominio (es. status='closed'/'completed') per le tabelle (B)
→ evento 'delete'  → solo per junction tables (hard DELETE server-side); rimuovi da IndexedDB
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

| App     | Collections pull obbligatorie                                        | Intervallo polling | Real-time |
|---------|----------------------------------------------------------------------|--------------------|-----------|
| Cassa   | `orders`, `bill_sessions`, `tables`                                  | 5 s                | preferito |
| Sala    | `orders`, `bill_sessions`, `tables`, `menu_items`                    | 3 s                | preferito |
| Cucina  | `orders`, `order_items`                                              | 3 s                | preferito |
| Tutti   | `venues`, `rooms`, `payment_methods`, `menu_*`, `printers`, `venue_users` | avvio + 5 min | opzionale |

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

---

### 5.8 Strategia di purge IndexedDB

La persistenza storica è gestita da **Directus**: l'IndexedDB locale è una cache operativa
e non deve crescere indefinitamente. Il composable `useIDBPurge()` implementa la pulizia
automatica dei dati locali secondo la retention definita per ciascuna collection.

#### 5.8.1 Regole generali

- Un record viene rimosso dal proprio ObjectStore locale **solo se**:
  1. Il suo `_sync_status` è `'synced'` (già persistito su Directus), **e**
  2. Il suo `date_updated` (o `date_created` se `date_updated` è assente) è precedente alla
     soglia di retention della collection.
- I record con `_sync_status = 'pending'` o `'error'` **non vengono mai purgati** (non sono
  ancora su Directus).
- Le voci della `sync_queue` con `attempts >= 5` (dead-letter) vengono rimosse dopo
  **7 giorni** dalla loro `date_created`.
- Le collection di **configurazione** (`venues`, `rooms`, `tables`, `menu_*`,
  `payment_methods`, `printers`) non vengono purgate: sono piccole, statiche e gestite
  manualmente tramite Directus; vengono aggiornate solo via PULL.

#### 5.8.2 Soglie di retention per collection

| Collection                  | Soglia di purge                              | Condizione aggiuntiva                        |
|-----------------------------|----------------------------------------------|----------------------------------------------|
| `orders`                    | 7 giorni da `date_updated`                   | Solo se `status` in `completed`, `rejected`  |
| `order_items`               | 7 giorni da `date_updated`                   | Solo se l'order padre è già stato purgato    |
| `order_item_modifiers`      | 7 giorni da `date_updated`                   | Solo se l'order_item padre è già stato purgato |
| `bill_sessions`             | 7 giorni da `date_updated`                   | Solo se `status = 'closed'`                  |
| `transactions`              | 30 giorni da `date_updated`                  | —                                            |
| `transaction_order_refs`    | 30 giorni da `date_created`                  | —                                            |
| `transaction_voce_refs`     | 30 giorni da `date_created`                  | —                                            |
| `cash_movements`            | 30 giorni da `date_updated`                  | —                                            |
| `daily_closures`            | 90 giorni da `date_updated`                  | —                                            |
| `daily_closure_by_method`   | 90 giorni da `date_updated`                  | —                                            |
| `print_jobs`                | 7 giorni da `date_updated`                   | Solo se `status` in `done`, `error`          |
| `sync_queue`                | 7 giorni da `date_created` (solo dead-letter)| Solo se `attempts >= 5`                      |

> Le soglie sono configurabili tramite un oggetto `IDB_PURGE_RETENTION_DAYS` nei settings
> dell'app; i valori sopra rappresentano i default.

#### 5.8.3 Implementazione — `useIDBPurge()`

```js
// composable: src/composables/useIDBPurge.js
// Trigger: chiamato all'avvio dell'app (App.vue onMounted) e ogni 24 ore via setInterval.

async function purgeCollection(
  storeName,
  retentionDays,
  { statusFilter, dateField = 'date_updated', requireMissingParent = null }
) {
  const cutoff = Date.now() - retentionDays * 86_400_000
  // Scansiona per indice su dateField (o full-scan se l'indice non esiste)
  // Rimuove solo record con:
  //   _sync_status === 'synced'
  //   && new Date(record[dateField]).getTime() < cutoff
  //   && (statusFilter == null || statusFilter.includes(record.status))
  //   && (
  //        requireMissingParent == null
  //        || parentRecordDoesNotExist(
  //             requireMissingParent.storeName,
  //             record[requireMissingParent.foreignKey]
  //           )
  //      )
}

async function purgeCollectionIfParentMissing(
  storeName,
  retentionDays,
  { parentStoreName, foreignKey, statusFilter, dateField = 'date_updated' }
) {
  await purgeCollection(storeName, retentionDays, {
    statusFilter,
    dateField,
    requireMissingParent: {
      storeName: parentStoreName,
      foreignKey
    }
  })
}

export async function runIDBPurge() {
  // 1) Pre-cleanup child-first: rimuove solo figli già orfani da purge precedenti.
  await purgeCollectionIfParentMissing('order_item_modifiers', 7, {
    parentStoreName: 'order_items',
    foreignKey: 'order_item',
    dateField: 'date_created'
  })
  await purgeCollectionIfParentMissing('order_items', 7, {
    parentStoreName: 'orders',
    foreignKey: 'order',
    dateField: 'date_created'
  })

  // 2) Purge dei padri/root.
  await purgeCollection('orders',                 7,  { statusFilter: ['completed','rejected'] })
  await purgeCollection('bill_sessions',          7,  { statusFilter: ['closed'] })
  await purgeCollection('transactions',           30, { dateField: 'date_created' })
  await purgeCollection('cash_movements',         30, { dateField: 'date_created' })
  await purgeCollection('daily_closures',         90, { dateField: 'date_created' })
  await purgeCollection('print_jobs',             7,  { statusFilter: ['done','error'], dateField: 'job_timestamp' })

  // 3) Post-cleanup child-first: rimuove i figli diventati orfani in questo run.
  await purgeCollectionIfParentMissing('order_items', 7, {
    parentStoreName: 'orders',
    foreignKey: 'order',
    dateField: 'date_created'
  })
  await purgeCollectionIfParentMissing('order_item_modifiers', 7, {
    parentStoreName: 'order_items',
    foreignKey: 'order_item',
    dateField: 'date_created'
  })
  await purgeCollection('transaction_order_refs', 30, { dateField: 'date_created' })
  await purgeCollection('transaction_voce_refs',  30, { dateField: 'date_created' })
  await purgeCollection('daily_closure_by_method',90, { dateField: 'date_created' })
  // Dead-letter sync_queue
  await purgeSyncQueueDeadLetter(7)
}
```

#### 5.8.4 Ordine di purge e integrità referenziale locale

Il purge deve rispettare l'ordine di dipendenza per evitare record orfani in IndexedDB:

```
1. order_item_modifiers  (dipende da order_items)
2. order_items           (dipende da orders)
3. orders                (dipende da bill_sessions)
4. transaction_order_refs / transaction_voce_refs  (dipendono da transactions)
5. transactions          (dipende da bill_sessions)
6. bill_sessions
7. daily_closure_by_method  (dipende da daily_closures)
8. daily_closures
9. cash_movements
10. print_jobs
11. sync_queue (dead-letter)
```

#### 5.8.5 Interazione con il PULL

Durante il pull periodico, se un record locale è stato purgato ma è ancora presente su
Directus, verrà re-inserito nell'ObjectStore locale solo se rientra nella finestra di
retention del watermark (`filter[date_updated][_gt]={last_pull_ts}`). Per evitare
re-inserimenti indesiderati di dati storici, il composable di pull deve impostare
`last_pull_ts` **prima** di eseguire il purge, garantendo che il watermark non regredisca.

---

### 5.9 Gestione credenziali e autenticazione

#### 5.9.1 Strategia consigliata — due livelli di identità

> **Risposta alla domanda**: la strategia con username/password Directus + TTL lungo è
> funzionante ma richiede gestione del token di refresh (rotazione, scadenza, errori di
> rete al momento del rinnovo). L'approccio consigliato è di usare invece **token statici
> Directus** (senza scadenza) per l'autenticazione dei dispositivi, e di gestire le
> identità personali del personale tramite una collection `venue_users` con PIN locale.

Il sistema di autenticazione si articola su **due livelli separati**:

| Livello          | Identità                  | Meccanismo               | Scope                                       |
|------------------|---------------------------|--------------------------|---------------------------------------------|
| **Dispositivo**  | Service account Directus  | Token statico (no TTL)   | API Directus (sync PUSH/PULL)               |
| **Utente locale**| `venue_users` (PIN)       | Hash PIN client-side     | Audit trail locale (chi ha fatto cosa)      |

---

#### 5.9.2 Livello 1 — Autenticazione dispositivo (token statico Directus)

Ogni ruolo applicativo (cassa / sala / cucina) dispone di un **service account Directus**
dedicato con un **token statico** (generato una volta sola in Directus → Settings → Users
→ Token). Il token non scade e non richiede refresh.

**Vantaggi rispetto a username/password + refresh token:**
- Nessun flusso di rinnovo: il token viene salvato una volta e rimane valido finché
  l'amministratore non lo revoca.
- Nessun rischio di failure durante la sync per token scaduto.
- Semplice da distribuire: l'amministratore inserisce il token nel setup iniziale del
  dispositivo (una-tantum).

**Setup:**

```
Directus → Settings → Users → Crea "cassa-device" / "sala-device" / "cucina-device"
  Role: assegnare un ruolo con permessi minimi (read/write solo sulle collection necessarie)
  Token: generare un token statico → copiarlo nel setup iniziale del dispositivo
         (verrà salvato cifrato in IndexedDB, vedi §5.9.2)
```

**Storage sicuro nel dispositivo:**

Il token **non deve essere salvato in `localStorage`** (accessibile a qualsiasi script
sulla pagina e leggibile dalle DevTools senza autenticazione). La strategia raccomandata
prevede due livelli:

| Livello | Meccanismo | Note |
|---------|-----------|------|
| **Storage** | IndexedDB — ObjectStore `config` (già definito in §5.6) | Stesso processo di sicurezza del browser, isolato per origine |
| **Cifratura** | Web Crypto API — AES-GCM con chiave device-derived | Protezione aggiuntiva a riposo contro dump del DB |

**Generazione della chiave di cifratura (una-tantum per dispositivo):**

```js
// Genera e persiste una chiave AES-256-GCM nell'ObjectStore config (origin-isolated)
async function getOrCreateDeviceKey() {
  const stored = await idb.get('config', '_deviceKey')
  if (stored) {
    // Re-importa la chiave JWK salvata in IDB
    return crypto.subtle.importKey(
      'jwk', stored.jwk,
      { name: 'AES-GCM' },
      false,             // non estraibile una volta importata
      ['encrypt', 'decrypt']
    )
  }

  // Prima generazione: extractable=true solo per poter esportare in JWK e salvare
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,              // extractable=true per poter esportare in JWK e salvare
    ['encrypt', 'decrypt']
  )
  const jwk = await crypto.subtle.exportKey('jwk', key)
  await idb.put('config', { id: '_deviceKey', jwk })
  return key
}
```

**Salvataggio del token (setup iniziale):**

```js
async function saveDeviceToken(token, directusUrl, venueId) {
  const key = await getOrCreateDeviceKey()
  const iv  = crypto.getRandomValues(new Uint8Array(12))
  const enc = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(token)
  )
  await idb.put('config', {
    id: 'device_credentials',
    encryptedToken: Array.from(new Uint8Array(enc)),
    iv:             Array.from(iv),
    directusUrl,
    venueId,
  })
}
```

**Lettura del token (ad ogni avvio dell'app):**

```js
async function loadDeviceToken() {
  const key  = await getOrCreateDeviceKey()
  const cfg  = await idb.get('config', 'device_credentials')
  if (!cfg) throw new Error('Token dispositivo non configurato')

  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(cfg.iv) },
    key,
    new Uint8Array(cfg.encryptedToken)
  )
  return new TextDecoder().decode(plain)   // token in chiaro, solo in memoria
}
```

**Considerazioni di sicurezza:**

- La chiave AES è generata una volta sola per dispositivo e salvata in JWK nell'ObjectStore
  `config`; è protetta dall'isolamento same-origin del browser (un'altra origine non può
  leggere l'IndexedDB dell'app).
- Il token decifrato vive **solo in memoria** (variabile JS) e non viene mai re-scritto
  in localStorage o in una variabile globale persistente.
- Ogni chiamata API usa il token dalla variabile in-memory; al refresh della pagina viene
  riletto da IndexedDB e decifrato di nuovo.
- In caso di revoca del token Directus, l'app riceve `401`; l'amministratore accede
  fisicamente al dispositivo, esegue il re-setup e salva il nuovo token con `saveDeviceToken()`.
- **Rotazione periodica consigliata**: almeno ogni 6–12 mesi o in caso di sospetto
  compromissione; il nuovo token viene sovrascritto con `saveDeviceToken()`.

Ogni richiesta API usa `Authorization: Bearer {token}` (token decifrato in memoria).
Non serve alcun flusso OAuth o refresh.

---

#### 5.9.3 Livello 2 — Utenti locali per venue (PIN personale)

Gli utenti del personale (camerieri, cassieri, cuochi) sono gestiti tramite la collection
**`venue_users`** su Directus, sincronizzata in IndexedDB. L'autenticazione PIN avviene
**interamente lato client** (confronto hash): non si effettua alcuna chiamata API per
verificare il PIN.

##### DDL — `venue_users`

```sql
CREATE TABLE venue_users (
  id           UUID PRIMARY KEY,              -- UUID v7 generato client-side
  venue        INTEGER      NOT NULL REFERENCES venues(id),
  display_name VARCHAR(100) NOT NULL,
  role         VARCHAR(50)  NOT NULL,         -- 'admin' | 'cassiere' | 'cameriere' | 'cuoco'
  pin_hash     VARCHAR(255) NOT NULL,         -- hash bcrypt/argon2 del PIN a 4-6 cifre
  status       VARCHAR(20)  NOT NULL DEFAULT 'active', -- 'active' | 'archived'
  date_created TIMESTAMPTZ  DEFAULT now(),
  date_updated TIMESTAMPTZ  DEFAULT now()
);
```

> **Sicurezza PIN**: il PIN **non** viene mai trasmesso in chiaro. Il client calcola
> `hash = bcrypt(pin, salt)` e lo confronta con `pin_hash` presente in IndexedDB.
> Opzioni di implementazione:
> - **`bcryptjs`**: libreria JS pura (non WebCrypto), più semplice da integrare ma senza accelerazione nativa.
> - **PBKDF2 via SubtleCrypto** (`crypto.subtle.deriveBits`): nativo nel browser, nessuna dipendenza esterna.
> - **Argon2** (es. `argon2-browser`): più resistente agli attacchi brute-force, richiede una libreria dedicata.
> Il salt è incluso nel campo `pin_hash` (bcrypt/argon2 standard).

##### ObjectStore IndexedDB — `venue_users`

```
venue_users
  keyPath:  id (UUIDv7)
  Indexes:
    - venue          (non-unique) — lista utenti per venue
    - status         (non-unique) — filtra solo 'active'
    - role           (non-unique) — filtra per ruolo
```

##### Flusso di accesso con PIN

```
Avvio app
  └─ carica venue_users da IndexedDB (filtro: venue = venueId, status = 'active')

Operatore inserisce PIN
  └─ bcrypt.compare(pin, user.pin_hash) → local boolean
       ├─ OK → imposta currentPinUser in memoria (non in localStorage)
       └─ KO → mostra errore, incrementa contatore tentativi

Timeout inattività (es. 5 min)
  └─ currentPinUser = null → torna alla schermata di scelta utente
```

---

#### 5.9.4 Campi audit — `venue_user_created` / `venue_user_updated`

Per tracciare quale operatore locale ha creato o modificato un record, le collection
operative aggiungono due campi **facoltativi** (nullable):

| Campo               | Tipo   | Note                                                                 |
|---------------------|--------|----------------------------------------------------------------------|
| `venue_user_created`  | UUID   | FK → `venue_users.id` — chi ha creato il record (operatore locale)  |
| `venue_user_updated`  | UUID   | FK → `venue_users.id` — ultimo operatore locale che ha modificato   |

> Questi campi sono **distinti** da `user_created` / `user_updated` di Directus, che
> riferiscono all'utente Directus del service account del dispositivo. I campi `venue_user_*`
> tracciano la persona fisica (cameriere, cassiere, ecc.), non il dispositivo.

**Esempio DDL aggiuntivo** (da aggiungere alle collection operative):

```sql
ALTER TABLE orders
  ADD COLUMN venue_user_created UUID REFERENCES venue_users(id),
  ADD COLUMN venue_user_updated UUID REFERENCES venue_users(id);

ALTER TABLE transactions
  ADD COLUMN venue_user_created UUID REFERENCES venue_users(id),
  ADD COLUMN venue_user_updated UUID REFERENCES venue_users(id);

-- Stessa logica per: bill_sessions, cash_movements, order_items, print_jobs
```

**Valorizzazione client-side:**

```js
// All'apertura di un record
record.venue_user_created = currentPinUser?.id ?? null

// Ad ogni modifica
record.venue_user_updated = currentPinUser?.id ?? null
```

---

#### 5.9.5 Sincronizzazione `venue_users` e sicurezza

- **PULL-only**: `venue_users` viene sincronizzata solo in direzione Directus → IndexedDB.
  Le modifiche agli utenti (creazione, cambio PIN, disattivazione) avvengono esclusivamente
  tramite l'interfaccia Directus (o un pannello admin dedicato), mai dal dispositivo POS.
- **Permessi Directus**: i service account di cassa/sala/cucina hanno permesso **read-only**
  sulla collection `venue_users`. Non possono creare, modificare o cancellare utenti.
- **PIN hash**: il campo `pin_hash` viene incluso nella risposta API (il dispositivo ne ha
  bisogno per il confronto locale). Assicurarsi che il ruolo Directus del dispositivo
  esponga solo i campi necessari (`id`, `display_name`, `role`, `pin_hash`, `status`).
- **Revoca accesso**: per disattivare un operatore è sufficiente impostare
  `status = 'archived'` su Directus; il PULL successivo aggiornerà IndexedDB e il PIN
  non funzionerà più.
- **Rate limiting PIN**: il client implementa un contatore locale di tentativi falliti
  (es. blocco dopo 5 tentativi per 30 secondi) per mitigare attacchi brute-force offline.

---

#### 5.9.6 Riepilogo flussi

```
┌─────────────────────────────────────────────────────────────────────┐
│  Setup iniziale (una-tantum, admin)                                 │
│                                                                     │
│  Admin → Directus → crea service account → genera token statico    │
│  Admin → Directus → crea venue_users con PIN hash                  │
│  Admin → configura token + URL Directus nelle app-settings          │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Runtime — ogni dispositivo                                         │
│                                                                     │
│  [Avvio]                                                            │
│    1. Legge directusToken da app-settings                           │
│    2. Carica venue_users da IndexedDB                               │
│    3. Mostra schermata selezione utente (PIN)                       │
│                                                                     │
│  [Operazione]                                                       │
│    4. Operatore inserisce PIN → currentPinUser impostato in memoria │
│    5. Ogni record creato/modificato riceve venue_user_created/updated │
│    6. Record scritto in IndexedDB + aggiunto a sync_queue           │
│                                                                     │
│  [Sync]                                                             │
│    7. useSyncQueue drena la coda verso Directus API                 │
│       (Authorization: Bearer {directusToken})                       │
│    8. PULL aggiorna venue_users + dati operativi da Directus        │
└─────────────────────────────────────────────────────────────────────┘
```
