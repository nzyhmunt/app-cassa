# Schema Database Relazionale

Questo documento descrive lo schema relazionale completo derivato dal modello dati dell'applicazione
(stato localStorage — chiavi derivate da `resolveStorageKeys()` in `src/store/persistence.js`,
tipicamente `demo_app_state_v1` (eventualmente con suffisso di istanza); cambiano automaticamente al bump di versione — + `app-settings`).
Può essere utilizzato come riferimento per una futura migrazione verso un backend relazionale
(PostgreSQL, MySQL, SQLite) o un'API Directus.

---

## Indice

1. [Entità principali](#1-entità-principali)
2. [Tabelle SQL](#2-tabelle-sql)
3. [Relazioni](#3-relazioni)
4. [Diagramma ER](#4-diagramma-er)
5. [Note di migrazione](#5-note-di-migrazione)

---

## 1. Entità principali

| Entità               | Descrizione                                              | Fonte localStorage           |
|----------------------|----------------------------------------------------------|------------------------------|
| `venues`             | Ristorante / punto vendita                               | `appConfig.ui`               |
| `tables`             | Tavoli della sala                                        | `appConfig.tables`           |
| `payment_methods`    | Metodi di pagamento configurati                          | `appConfig.paymentMethods`   |
| `menu_categories`    | Categorie del menu (Antipasti, Primi, …)                 | `appConfig.menu` (chiavi)    |
| `menu_items`         | Voci del menu (piatti, bevande, ecc.)                    | `appConfig.menu[categoria]`  |
| `menu_item_modifiers`| Modificatori/varianti disponibili per voce menu          | (configurazione menu)        |
| `bill_sessions`      | Sessione di occupazione tavolo (un'apertura tavolo)      | `tableCurrentBillSession`    |
| `orders`             | Comande inviate dal tavolo                               | `orders`                     |
| `order_items`        | Righe singole di una comanda                             | `order.orderItems`           |
| `order_item_modifiers`| Modificatori applicati a una riga comanda               | `orderItem.modifiers`        |
| `transactions`       | Pagamenti e sconti applicati a un conto                  | `transactions`               |
| `transaction_order_refs` | Collegamento N:M tra pagamenti e comande            | `transaction.orderRefs`      |
| `cash_movements`     | Versamenti e prelievi di cassa                           | `cashMovements`              |
| `daily_closures`     | Chiusure giornaliere (rapporto Z)                        | `dailyClosures`              |
| `app_settings`       | Impostazioni utente (audio, URL menu, ecc.)              | `app-settings` (localStorage)|

---

## 2. Tabelle SQL

### 2.1 `venues` — Punto vendita

```sql
CREATE TABLE venues (
    id              SERIAL          PRIMARY KEY,
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
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
```

---

### 2.2 `tables` — Tavoli

```sql
CREATE TABLE tables (
    id              VARCHAR(10)     PRIMARY KEY,    -- es. '01', '02', ... '12'
    venue_id        INTEGER         NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    label           VARCHAR(80)     NOT NULL,       -- es. 'Tavolo 01'
    covers          SMALLINT        NOT NULL CHECK (covers > 0),  -- posti a sedere
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    sort_order      SMALLINT        NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
```

---

### 2.3 `payment_methods` — Metodi di pagamento

```sql
CREATE TABLE payment_methods (
    id              VARCHAR(30)     PRIMARY KEY,    -- es. 'cash', 'card'
    venue_id        INTEGER         NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    label           VARCHAR(60)     NOT NULL,       -- es. 'Contanti', 'Pos/Carta'
    icon            VARCHAR(50)     NULL,           -- nome icona Lucide
    color_class     VARCHAR(80)     NULL,           -- classe Tailwind CSS
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    sort_order      SMALLINT        NOT NULL DEFAULT 0
);
```

---

### 2.4 `menu_categories` — Categorie menu

```sql
CREATE TABLE menu_categories (
    id              SERIAL          PRIMARY KEY,
    venue_id        INTEGER         NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    name            VARCHAR(80)     NOT NULL,       -- es. 'Antipasti', 'Primi Piatti'
    sort_order      SMALLINT        NOT NULL DEFAULT 0,
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    UNIQUE (venue_id, name)
);
```

---

### 2.5 `menu_items` — Voci menu

```sql
CREATE TABLE menu_items (
    id              VARCHAR(50)     PRIMARY KEY,    -- es. 'ant_2', 'bev_4'
    venue_id        INTEGER         NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    category_id     INTEGER         NOT NULL REFERENCES menu_categories(id) ON DELETE RESTRICT,
    name            VARCHAR(120)    NOT NULL,
    price           NUMERIC(8,2)    NOT NULL CHECK (price >= 0),
    description     TEXT            NULL,
    note            TEXT            NULL,
    image_url       TEXT            NULL,
    ingredients     TEXT[]          NULL,           -- array di stringhe
    allergens       TEXT[]          NULL,
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    sort_order      SMALLINT        NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
```

---

### 2.6 `menu_item_modifiers` — Modificatori disponibili per voce menu

```sql
CREATE TABLE menu_item_modifiers (
    id              SERIAL          PRIMARY KEY,
    menu_item_id    VARCHAR(50)     NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    name            VARCHAR(80)     NOT NULL,       -- es. 'Extra aglio'
    price           NUMERIC(8,2)    NOT NULL DEFAULT 0.00,
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    sort_order      SMALLINT        NOT NULL DEFAULT 0
);
```

---

### 2.7 `bill_sessions` — Sessioni tavolo (apertura/chiusura)

Una riga per ogni volta che un tavolo viene aperto.
Creata al primo ordine accettato; chiusa quando tutti gli ordini sono `completed` o `rejected`.

```sql
CREATE TABLE bill_sessions (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id        VARCHAR(10)     NOT NULL REFERENCES tables(id) ON DELETE RESTRICT,
    venue_id        INTEGER         NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    adults          SMALLINT        NOT NULL DEFAULT 1 CHECK (adults >= 0),
    children        SMALLINT        NOT NULL DEFAULT 0 CHECK (children >= 0),
    opened_at       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    closed_at       TIMESTAMPTZ     NULL,           -- NULL = sessione ancora aperta
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_bill_sessions_table ON bill_sessions(table_id, is_active);
```

---

### 2.8 `orders` — Comande

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
    id                      VARCHAR(20)     PRIMARY KEY,    -- es. 'ord_rX91'
    venue_id                INTEGER         NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    table_id                VARCHAR(10)     NOT NULL REFERENCES tables(id) ON DELETE RESTRICT,
    bill_session_id         UUID            NULL REFERENCES bill_sessions(id) ON DELETE SET NULL,
    status                  order_status    NOT NULL DEFAULT 'pending',
    order_time              TIME            NOT NULL,       -- 'HH:MM'
    total_amount            NUMERIC(10,2)   NOT NULL DEFAULT 0.00,
    item_count              INTEGER         NOT NULL DEFAULT 0,
    is_cover_charge         BOOLEAN         NOT NULL DEFAULT FALSE,
    dietary_diets           TEXT[]          NULL,           -- es. ['Vegetariano']
    dietary_allergens       TEXT[]          NULL,
    global_note             TEXT            NOT NULL DEFAULT '',  -- nota libera sull'intero ordine (order.globalNote)
    note_visibility_cassa   BOOLEAN         NOT NULL DEFAULT TRUE,  -- order.noteVisibility.cassa
    note_visibility_sala    BOOLEAN         NOT NULL DEFAULT TRUE,  -- order.noteVisibility.sala
    note_visibility_cucina  BOOLEAN         NOT NULL DEFAULT TRUE,  -- order.noteVisibility.cucina
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_table      ON orders(table_id, status);
CREATE INDEX idx_orders_session    ON orders(bill_session_id);
CREATE INDEX idx_orders_venue      ON orders(venue_id, status);
```

---

### 2.9 `order_items` — Righe comanda

```sql
CREATE TABLE order_items (
    uid             VARCHAR(20)     NOT NULL,       -- es. 'r_1' (univoco nell'ordine)
    order_id        VARCHAR(20)     NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    dish_id         VARCHAR(50)     NULL REFERENCES menu_items(id) ON DELETE SET NULL,
    name            VARCHAR(120)    NOT NULL,       -- snapshot nome al momento dell'ordine
    unit_price      NUMERIC(8,2)    NOT NULL,
    quantity        SMALLINT        NOT NULL DEFAULT 1 CHECK (quantity >= 0),
    voided_quantity SMALLINT        NOT NULL DEFAULT 0 CHECK (voided_quantity >= 0),
    notes           TEXT[]          NULL,
    course          VARCHAR(10)     NULL CHECK (course IN ('prima', 'insieme', 'dopo')),  -- serving order: first/together/after
    sort_order      SMALLINT        NOT NULL DEFAULT 0,
    kitchen_ready   BOOLEAN         NOT NULL DEFAULT FALSE,  -- flag per toggle per-voce in App Cucina (Dettaglio)
    PRIMARY KEY (uid, order_id),
    CHECK (voided_quantity <= quantity)
);

CREATE INDEX idx_order_items_order ON order_items(order_id);
```

---

### 2.10 `order_item_modifiers` — Modificatori applicati a riga comanda

```sql
CREATE TABLE order_item_modifiers (
    id              SERIAL          PRIMARY KEY,
    order_id        VARCHAR(20)     NOT NULL,
    item_uid        VARCHAR(20)     NOT NULL,
    name            VARCHAR(80)     NOT NULL,       -- snapshot nome modificatore
    price           NUMERIC(8,2)    NOT NULL DEFAULT 0.00,
    voided_quantity SMALLINT        NOT NULL DEFAULT 0 CHECK (voided_quantity >= 0),
    FOREIGN KEY (item_uid, order_id) REFERENCES order_items(uid, order_id) ON DELETE CASCADE
);

CREATE INDEX idx_oi_modifiers_item ON order_item_modifiers(order_id, item_uid);
```

---

### 2.11 `transactions` — Pagamenti e sconti

```sql
CREATE TYPE transaction_operation AS ENUM ('unico', 'romana', 'ordini', 'discount');
CREATE TYPE discount_type AS ENUM ('percent', 'fixed');

CREATE TABLE transactions (
    id                  VARCHAR(30)             PRIMARY KEY,    -- es. 'txn_abc123'
    venue_id            INTEGER                 NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    table_id            VARCHAR(10)             NOT NULL REFERENCES tables(id) ON DELETE RESTRICT,
    bill_session_id     UUID                    NULL REFERENCES bill_sessions(id) ON DELETE SET NULL,
    operation_type      transaction_operation   NOT NULL,
    payment_method_id   VARCHAR(30)             NULL REFERENCES payment_methods(id) ON DELETE SET NULL,
    amount_paid         NUMERIC(10,2)           NOT NULL,   -- importo pagato o sconto
    tip_amount          NUMERIC(8,2)            NOT NULL DEFAULT 0.00,
    -- romana (dividi il conto)
    romana_split_count  SMALLINT                NULL,       -- quote pagate in questa transazione
    split_quota         NUMERIC(10,2)           NULL,       -- valore di ogni quota
    split_ways          SMALLINT                NULL,       -- totale divisori
    -- sconto
    discount_type       discount_type           NULL,
    discount_value      NUMERIC(10,2)           NULL,       -- % o importo fisso
    -- metadati
    created_at          TIMESTAMPTZ             NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transactions_table   ON transactions(table_id);
CREATE INDEX idx_transactions_session ON transactions(bill_session_id);
CREATE INDEX idx_transactions_venue   ON transactions(venue_id, created_at);
```

---

### 2.12 `transaction_order_refs` — Collegamento N:M Pagamento ↔ Comanda

```sql
CREATE TABLE transaction_order_refs (
    transaction_id  VARCHAR(30)     NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    order_id        VARCHAR(20)     NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    PRIMARY KEY (transaction_id, order_id)
);
```

---

### 2.13 `cash_movements` — Movimenti di cassa

```sql
CREATE TYPE cash_movement_type AS ENUM ('deposit', 'withdrawal');

CREATE TABLE cash_movements (
    id          VARCHAR(30)         PRIMARY KEY,    -- es. 'mov_abc123'
    venue_id    INTEGER             NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    type        cash_movement_type  NOT NULL,
    amount      NUMERIC(10,2)       NOT NULL CHECK (amount > 0),
    reason      TEXT                NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cash_movements_venue ON cash_movements(venue_id, created_at);
```

---

### 2.14 `daily_closures` — Chiusure giornaliere (rapporto Z)

```sql
CREATE TABLE daily_closures (
    id                  SERIAL          PRIMARY KEY,
    venue_id            INTEGER         NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
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
    closed_at           TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_daily_closures_venue ON daily_closures(venue_id, closed_at);
```

---

### 2.15 `daily_closure_by_method` — Dettaglio incassi per metodo (riga di daily_closures)

```sql
CREATE TABLE daily_closure_by_method (
    id                  SERIAL          PRIMARY KEY,
    daily_closure_id    INTEGER         NOT NULL REFERENCES daily_closures(id) ON DELETE CASCADE,
    payment_method_id   VARCHAR(30)     NOT NULL REFERENCES payment_methods(id) ON DELETE RESTRICT,
    amount              NUMERIC(10,2)   NOT NULL DEFAULT 0.00
);
```

---

### 2.16 `app_settings` — Impostazioni applicazione per utente/dispositivo

```sql
CREATE TABLE app_settings (
    id          SERIAL          PRIMARY KEY,
    venue_id    INTEGER         NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    device_key  VARCHAR(120)    NOT NULL DEFAULT 'default',  -- es. UUID dispositivo
    sounds      BOOLEAN         NOT NULL DEFAULT TRUE,       -- avvisi audio "ding"
    menu_url    TEXT,                                       -- URL menu digitale (corrisponde a `menuUrl` in app-settings)
    updated_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    UNIQUE (venue_id, device_key)
);
```

---

## 3. Relazioni

```
venues ──< tables
venues ──< payment_methods
venues ──< menu_categories ──< menu_items ──< menu_item_modifiers
venues ──< bill_sessions >── tables
venues ──< orders >── tables
                    >── bill_sessions
orders ──< order_items ──< order_item_modifiers
                 >── menu_items  (snapshot, nullable)
venues ──< transactions >── tables
                        >── bill_sessions
                        >── payment_methods
transactions >──< orders  (via transaction_order_refs)
venues ──< cash_movements
venues ──< daily_closures ──< daily_closure_by_method
venues ──< app_settings
```

Cardinalità:

| Da             | Relazione | A                      |
|----------------|-----------|------------------------|
| venue          | 1 : N     | tables                 |
| venue          | 1 : N     | payment_methods        |
| venue          | 1 : N     | menu_categories        |
| menu_category  | 1 : N     | menu_items             |
| menu_item      | 1 : N     | menu_item_modifiers    |
| table          | 1 : N     | bill_sessions          |
| bill_session   | 1 : N     | orders                 |
| order          | 1 : N     | order_items            |
| order_item     | 1 : N     | order_item_modifiers   |
| bill_session   | 1 : N     | transactions           |
| transaction    | N : M     | orders                 |
| venue          | 1 : N     | cash_movements         |
| venue          | 1 : N     | daily_closures         |
| daily_closure  | 1 : N     | daily_closure_by_method|

---

## 4. Diagramma ER

```
┌─────────────┐     ┌──────────────────┐     ┌───────────────────┐
│   venues    │──1──│ menu_categories  │──1──│   menu_items      │
│─────────────│  N  │──────────────────│  N  │───────────────────│
│ id (PK)     │     │ id (PK)          │     │ id (PK)           │
│ name        │     │ venue_id (FK)    │     │ category_id (FK)  │
│ primary_    │     │ name             │     │ name              │
│  color      │     │ sort_order       │     │ price             │
│ currency    │     └──────────────────┘     │ allergens[]       │
│ menu_url    │                              └────────┬──────────┘
│ cover_      │                                       │ 1
│  charge_*   │                                       │ N
│ billing_*   │                              ┌────────▼──────────┐
└──────┬──────┘                              │menu_item_modifiers│
       │ 1                                   │───────────────────│
       │                                     │ menu_item_id (FK) │
       │ N                                   │ name              │
┌──────▼──────┐     ┌──────────────────┐     │ price             │
│   tables    │──1──│  bill_sessions   │     └───────────────────┘
│─────────────│  N  │──────────────────│
│ id (PK)     │     │ id (PK, UUID)    │
│ venue_id FK │     │ table_id (FK)    │
│ label       │     │ adults           │
│ covers      │     │ children         │
└──────┬──────┘     │ opened_at        │
       │            │ closed_at        │
       │            └────────┬─────────┘
       │                     │ 1
       │                     │ N
       └──────────┬──────────▼──────────────────────────────────────┐
                  │          orders                                  │
                  │──────────────────────────────────────────────── │
                  │ id (PK)                                         │
                  │ table_id (FK) ──────────────────────────────────┘
                  │ bill_session_id (FK)
                  │ status: pending|accepted|preparing|ready|delivered|completed|rejected
                  │ total_amount
                  │ is_cover_charge
                  │ global_note
                  │ note_visibility_cassa/sala/cucina
                  └──────────────────────────────┐
                                                 │ 1
                                                 │ N
                                        ┌────────▼──────────┐
                                        │   order_items     │
                                        │───────────────────│
                                        │ uid + order_id PK │
                                        │ dish_id (FK null) │
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
                                        │ order_id (FK)         │
                                        │ item_uid (FK)         │
                                        │ name (snapshot)       │
                                        │ price                 │
                                        │ voided_quantity       │
                                        └───────────────────────┘

┌──────────────────────────────┐      ┌─────────────────────────────┐
│        transactions          │──N───│   transaction_order_refs    │
│──────────────────────────────│  M   │─────────────────────────────│
│ id (PK)                      │      │ transaction_id (FK)         │
│ table_id (FK)                │      │ order_id (FK)               │
│ bill_session_id (FK)         │      └─────────────────────────────┘
│ operation_type               │
│  unico|romana|ordini|discount│
│ payment_method_id (FK)       │
│ amount_paid                  │
│ tip_amount                   │
│ romana_split_count           │
│ discount_type                │
│ discount_value               │
│ created_at                   │
└──────────────────────────────┘

┌──────────────────────┐     ┌──────────────────────────────────┐
│    cash_movements    │     │        daily_closures            │
│──────────────────────│     │──────────────────────────────────│
│ id (PK)              │     │ id (PK)                          │
│ venue_id (FK)        │     │ venue_id (FK)                    │
│ type: deposit|withdrawal │     │ closure_type: 'Z'                │
│ amount               │     │ total_received                   │
│ reason               │     │ total_discount                   │
│ created_at           │     │ total_tips                       │
└──────────────────────┘     │ cash_balance                     │
                             │ receipt_count                    │
                             │ closed_at                        │
                             └──────────────┬───────────────────┘
                                            │ 1
                                            │ N
                             ┌──────────────▼───────────────────┐
                             │   daily_closure_by_method        │
                             │──────────────────────────────────│
                             │ daily_closure_id (FK)            │
                             │ payment_method_id (FK)           │
                             │ amount                           │
                             └──────────────────────────────────┘
```

---

## 5. Note di migrazione

### 5.1 Corrispondenza localStorage → Database

| localStorage (`demo_app_state_v1`)    | Tabella DB                             |
|---------------------------------------|----------------------------------------|
| `orders[]`                            | `orders` + `order_items` + `order_item_modifiers` |
| `order.globalNote`                    | `orders.global_note`                   |
| `order.noteVisibility.{cassa,sala,cucina}` | `orders.note_visibility_{cassa,sala,cucina}` |
| `transactions[]`                      | `transactions` + `transaction_order_refs` |
| `tableOccupiedAt`                     | `bill_sessions.opened_at`              |
| `billRequestedTables` (Set)           | query: `orders.status = 'pending'` con `bill_session_id` attivo |
| `tableCurrentBillSession`             | `bill_sessions` (righe con `is_active = true`) |
| `cashBalance`                         | somma di `cash_movements` + valore iniziale |
| `cashMovements[]`                     | `cash_movements`                       |
| `dailyClosures[]`                     | `daily_closures` + `daily_closure_by_method` |
| `app-settings` (localStorage)         | `app_settings`                         |
| `appConfig.menu`                      | `menu_categories` + `menu_items`       |
| `appConfig.tables`                    | `tables`                               |
| `appConfig.paymentMethods`            | `payment_methods`                      |
| `appConfig.ui.*`                      | `venues`                               |
| `appConfig.coverCharge.*`             | `venues.cover_charge_*`                |
| `appConfig.billing.*`                 | `venues.billing_*`                     |

### 5.2 Snapshot dei nomi nel DB

`order_items.name` e `order_item_modifiers.name` contengono snapshot del nome al momento
dell'ordine. Questo è intenzionale: permette di conservare la cronologia anche se la voce menu
viene rinominata o rimossa (`dish_id` è nullable per questo motivo).

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
LEFT JOIN order_item_modifiers oim ON oim.order_id = oi.order_id AND oim.item_uid = oi.uid
WHERE oi.order_id = :order_id
GROUP BY oi.uid, oi.order_id;
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
            WHERE o.bill_session_id = bs.id AND o.status = 'pending'
        )                                               THEN 'pending'
        WHEN EXISTS (
            SELECT 1 FROM orders o
            WHERE o.bill_session_id = bs.id
              AND o.status NOT IN ('completed','rejected')
              -- aggiungere condizione "conto richiesto" tramite flag dedicato
        )                                               THEN 'occupied'
        ELSE 'free'
    END AS status
FROM tables t
LEFT JOIN bill_sessions bs ON bs.table_id = t.id AND bs.is_active = TRUE
WHERE t.id = :table_id;
```

### 5.5 Integrazione Directus

Con Directus come backend, ogni tabella SQL corrisponde a una **collection** Directus.
Le relazioni `1:N` usano *Many-to-One fields*, le `N:M` usano *Many-to-Many junction collections*.
I campi `created_at` / `updated_at` possono essere gestiti automaticamente da Directus.

### 5.6 Integrazione IndexedDB (PWA offline-first)

Per uso offline, la struttura `demo_app_state_v1` può essere sostituita da object store
IndexedDB che rispecchiano questo schema:

```
ObjectStore: orders        → keyPath: id, indexes: [table_id, status, bill_session_id]
ObjectStore: transactions  → keyPath: id, indexes: [table_id, bill_session_id]
ObjectStore: cash_movements → keyPath: id
ObjectStore: daily_closures → keyPath: id
```

La sincronizzazione con il backend avviene tramite Service Worker usando `navigator.onLine`
e una coda di operazioni in sospeso.
