# Directus Database Setup Report

Data esecuzione: 2026-04-13  
Istanza Directus: https://dev.nanawork.it  
Riferimento schema: `DATABASE_SCHEMA.md`

---

## Riepilogo operazioni

Sono state create **23 collection** su Directus con tutti i campi e le relazioni definiti in `DATABASE_SCHEMA.md`.

---

## Ordine di creazione (per dipendenze)

Le collection sono state create rispettando le dipendenze tra chiavi esterne (FK). L'ordine seguìto è:

| Layer | Collection | Dipende da |
|-------|-----------|-----------|
| 1 | `venues` | — (indipendente) |
| 2 | `venue_users` | `venues` |
| 2 | `rooms` | `venues` |
| 2 | `payment_methods` | `venues` |
| 2 | `menu_categories` | `venues` |
| 2 | `printers` | `venues` |
| 2 | `cash_movements` | `venues`, `venue_users` |
| 2 | `daily_closures` | `venues`, `venue_users` |
| 3 | `tables` | `venues`, `rooms` |
| 3 | `menu_items` | `venues`, `menu_categories` |
| 3 | `daily_closure_by_method` | `daily_closures`, `payment_methods`, `venue_users` |
| 4 | `menu_item_modifiers` | `menu_items` |
| 4 | `bill_sessions` | `tables`, `venues`, `venue_users` |
| 4 | `app_settings` | `venues`, `printers` |
| 5 | `orders` | `venues`, `tables`, `bill_sessions`, `venue_users` |
| 6 | `order_items` | `orders`, `menu_items`, `venue_users` |
| 6 | `transactions` | `venues`, `tables`, `bill_sessions`, `payment_methods`, `venue_users` |
| 6 | `fiscal_receipts` | `tables`, `bill_sessions` |
| 6 | `invoice_requests` | `tables`, `bill_sessions` |
| 6 | `table_merge_sessions` | `tables` |
| 7 | `order_item_modifiers` | `order_items`, `venue_users` |
| 7 | `transaction_order_refs` | `transactions`, `orders` |
| 7 | `transaction_voce_refs` | `transactions` |
| 7 | `print_jobs` | `printers`, `venues`, `venue_users` |

---

## Dettaglio collection create

### 1. `venues` — Punto vendita
- **PK**: `id` (integer, auto-increment)
- **Campi**: `status`, `name`, `primary_color`, `primary_color_dark`, `currency_symbol`, `menu_url`, `allow_custom_variants`, `cover_charge_enabled`, `cover_charge_auto_add`, `cover_charge_price_adult`, `cover_charge_price_child`, `billing_auto_close_on_full_payment`, `billing_enable_cash_change_calculator`, `billing_enable_tips`, `billing_enable_discounts`, `billing_allow_custom_entry`, `orders_rejection_reasons` (JSON)
- **Campi standard**: `user_created`, `date_created`, `user_updated`, `date_updated`
- **Archive**: `status = archived`
- **URL**: https://dev.nanawork.it/admin/content/venues

### 2. `venue_users` — Operatori locali
- **PK**: `id` (UUID v7)
- **Campi**: `venue` (FK→venues), `display_name`, `role` (admin/cassiere/cameriere/cuoco), `pin_hash` (hash), `status`
- **Campi standard**: `user_created`, `date_created`, `user_updated`, `date_updated`
- **URL**: https://dev.nanawork.it/admin/content/venue_users

### 3. `rooms` — Sale / Aree mappa tavoli
- **PK**: `id` (string, VARCHAR 30, es. 'sala')
- **Campi**: `status`, `venue` (FK→venues), `label`, `sort_order`
- **Campi standard**: `user_created`, `date_created`, `user_updated`, `date_updated`
- **Relazione**: rooms →(N:1)→ venues con `on_delete: CASCADE`; O2M `venues.rooms`
- **URL**: https://dev.nanawork.it/admin/content/rooms

### 4. `payment_methods` — Metodi di pagamento
- **PK**: `id` (string, VARCHAR 30, es. 'cash')
- **Campi**: `status`, `venue` (FK→venues), `label`, `icon`, `color_class`, `sort_order`
- **Campi standard**: `user_created`, `date_created`, `user_updated`, `date_updated`
- **Relazione**: →(N:1)→ venues con `on_delete: CASCADE`; O2M `venues.payment_methods`
- **URL**: https://dev.nanawork.it/admin/content/payment_methods

### 5. `menu_categories` — Categorie menu
- **PK**: `id` (integer, auto-increment)
- **Campi**: `status`, `venue` (FK→venues), `name`, `sort_order`
- **Campi standard**: `user_created`, `date_created`, `user_updated`, `date_updated`
- **Relazione**: →(N:1)→ venues con `on_delete: CASCADE`; O2M `venues.menu_categories`
- **URL**: https://dev.nanawork.it/admin/content/menu_categories

### 6. `printers` — Stampanti ESC/POS
- **PK**: `id` (string, VARCHAR 40, es. 'cucina')
- **Campi**: `status`, `venue` (FK→venues), `name`, `url`, `print_types` (JSON array), `categories` (JSON array), `sort_order`
- **Campi standard**: `user_created`, `date_created`, `user_updated`, `date_updated`
- **URL**: https://dev.nanawork.it/admin/content/printers

### 7. `cash_movements` — Movimenti di cassa
- **PK**: `id` (UUID v7)
- **Campi**: `venue` (FK→venues), `type` (deposit/withdrawal), `amount`, `reason`, `status`
- **Campi standard**: `user_created`, `date_created`, `user_updated`, `date_updated`
- **Audit operatori**: `venue_user_created` (FK→venue_users), `venue_user_updated`
- **URL**: https://dev.nanawork.it/admin/content/cash_movements

### 8. `daily_closures` — Chiusure giornaliere (rapporto Z)
- **PK**: `id` (UUID v7)
- **Campi**: `venue` (FK→venues), `closure_type` ('Z'), `cash_balance`, `total_received`, `total_discount`, `total_tips`, `total_covers`, `receipt_count`, `average_receipt`, `total_movements`, `final_balance`, `status`
- **Campi standard + audit**: `user_created`, `date_created`, `user_updated`, `date_updated`, `venue_user_created`, `venue_user_updated`
- **URL**: https://dev.nanawork.it/admin/content/daily_closures

### 9. `tables` — Tavoli
- **PK**: `id` (string, VARCHAR 10, es. '01')
- **Campi**: `status`, `venue` (FK→venues), `room` (FK→rooms, nullable), `label`, `covers`, `sort_order`
- **Campi standard**: `user_created`, `date_created`, `user_updated`, `date_updated`
- **Relazioni**: →(N:1)→ venues `CASCADE`; →(N:1)→ rooms `SET NULL`; O2M `rooms.tables`
- **URL**: https://dev.nanawork.it/admin/content/tables

### 10. `menu_items` — Voci menu
- **PK**: `id` (string, VARCHAR 50, es. 'ant_2')
- **Campi**: `status`, `venue` (FK→venues), `category` (FK→menu_categories), `name`, `price`, `description`, `note`, `image_url`, `ingredients` (JSON), `allergens` (JSON), `sort_order`
- **Campi standard**: `user_created`, `date_created`, `user_updated`, `date_updated`
- **Relazioni**: →(N:1)→ menu_categories `RESTRICT`; O2M `menu_categories.menu_items`
- **URL**: https://dev.nanawork.it/admin/content/menu_items

### 11. `daily_closure_by_method` — Dettaglio incassi per metodo
- **PK**: `id` (UUID v7)
- **Campi**: `daily_closure` (FK→daily_closures), `payment_method` (FK→payment_methods), `amount`, `status`
- **Campi standard + audit**: `user_created`, `date_created`, `user_updated`, `date_updated`, `venue_user_created`, `venue_user_updated`
- **Relazioni**: O2M `daily_closures.daily_closure_by_method` con `CASCADE`
- **URL**: https://dev.nanawork.it/admin/content/daily_closure_by_method

### 12. `menu_item_modifiers` — Modificatori disponibili per voce menu
- **PK**: `id` (integer, auto-increment)
- **Campi**: `status`, `menu_item` (FK→menu_items), `name`, `price`, `sort_order`
- **Campi standard**: `user_created`, `date_created`, `user_updated`, `date_updated`
- **Relazioni**: O2M `menu_items.menu_item_modifiers` con `CASCADE`
- **URL**: https://dev.nanawork.it/admin/content/menu_item_modifiers

### 13. `bill_sessions` — Sessioni tavolo (apertura/chiusura)
- **PK**: `id` (UUID v7)
- **Campi**: `status` (open/closed — dominio applicativo), `table` (FK→tables), `venue` (FK→venues), `adults`, `children`, `opened_at`, `closed_at`
- **Campi standard + audit**: `user_created`, `date_created`, `user_updated`, `date_updated`, `venue_user_created`, `venue_user_updated`
- **Nota**: `status` è campo di **dominio applicativo** (open/closed), non workflow Directus
- **Relazioni**: O2M `tables.bill_sessions` con `RESTRICT`
- **URL**: https://dev.nanawork.it/admin/content/bill_sessions

### 14. `app_settings` — Impostazioni applicazione per dispositivo
- **PK**: `id` (integer, auto-increment)
- **Campi**: `venue` (FK→venues), `device_key`, `sounds`, `menu_url`, `pre_bill_printer` (FK→printers, nullable)
- **Campi standard**: `user_created`, `date_created`, `user_updated`, `date_updated`
- **URL**: https://dev.nanawork.it/admin/content/app_settings

### 15. `orders` — Comande
- **PK**: `id` (UUID v7)
- **Campi**: `status` (pending/accepted/preparing/ready/delivered/completed/rejected), `venue` (FK→venues), `table` (FK→tables), `bill_session` (FK→bill_sessions), `order_time`, `total_amount`, `item_count`, `is_cover_charge`, `dietary_diets` (JSON), `dietary_allergens` (JSON), `global_note`, `note_visibility_cassa`, `note_visibility_sala`, `note_visibility_cucina`, `is_direct_entry`, `rejection_reason`
- **Campi standard + audit**: `user_created`, `date_created`, `user_updated`, `date_updated`, `venue_user_created`, `venue_user_updated`
- **Nota**: `status` è campo di **dominio applicativo** (workflow cucina/cassa), non workflow Directus
- **Relazioni**: O2M `bill_sessions.orders` con `SET NULL`
- **URL**: https://dev.nanawork.it/admin/content/orders

### 16. `order_items` — Righe comanda
- **PK**: `id` (UUID v7)
- **Campi**: `uid`, `order` (FK→orders), `dish` (FK→menu_items, nullable), `name` (snapshot), `unit_price`, `quantity`, `voided_quantity`, `notes` (JSON), `course` (prima/insieme/dopo), `sort_order`, `kitchen_ready`, `status`
- **Campi standard + audit**: `user_created`, `date_created`, `user_updated`, `date_updated`, `venue_user_created`, `venue_user_updated`
- **Relazioni**: O2M `orders.order_items` con `CASCADE`
- **URL**: https://dev.nanawork.it/admin/content/order_items

### 17. `transactions` — Pagamenti e sconti
- **PK**: `id` (UUID v7)
- **Campi**: `venue` (FK→venues), `table` (FK→tables), `bill_session` (FK→bill_sessions), `operation_type` (unico/romana/ordini/analitica/discount/tip), `payment_method` (FK→payment_methods), `amount_paid`, `tip_amount`, `romana_split_count`, `split_quota`, `split_ways`, `discount_type`, `discount_value`, `status`
- **Campi standard + audit**: `user_created`, `date_created`, `user_updated`, `date_updated`, `venue_user_created`, `venue_user_updated`
- **Relazioni**: O2M `bill_sessions.transactions` con `SET NULL`
- **URL**: https://dev.nanawork.it/admin/content/transactions

### 18. `fiscal_receipts` — Comandi stampante fiscale
- **PK**: `id` (string, es. 'fis_' + UUID v7)
- **Campi**: `table_id` (FK→tables), `bill_session_id` (FK→bill_sessions), `table_label`, `closed_at`, `total_amount`, `total_paid`, `payment_methods` (JSON text), `orders` (JSON text), `xml_request`, `xml_response`, `status` (pending/sent/ok/error), `timestamp`
- **Campi standard**: `date_updated`
- **URL**: https://dev.nanawork.it/admin/content/fiscal_receipts

### 19. `invoice_requests` — Richieste fattura elettronica
- **PK**: `id` (string, es. 'inv_' + UUID v7)
- **Campi**: `table_id` (FK→tables), `bill_session_id` (FK→bill_sessions), `table_label`, `closed_at`, `total_amount`, `total_paid`, `payment_methods` (JSON text), `orders` (JSON text), `denominazione`, `codice_fiscale`, `piva`, `indirizzo`, `cap`, `comune`, `provincia`, `paese`, `codice_destinatario`, `pec`, `status`, `timestamp`
- **Campi standard**: `date_updated`
- **URL**: https://dev.nanawork.it/admin/content/invoice_requests

### 20. `table_merge_sessions` — Tavoli uniti attivi
- **PK**: `slave_table` (string, FK→tables)
- **Campi**: `master_table` (FK→tables), `merged_at`
- **Nota**: riga eliminata quando il merge viene annullato (split)
- **URL**: https://dev.nanawork.it/admin/content/table_merge_sessions

### 21. `order_item_modifiers` — Modificatori applicati a riga comanda
- **PK**: `id` (UUID v7)
- **Campi**: `order_item` (FK→order_items), `order` (denormalizzato, UUID ordine), `item_uid`, `name` (snapshot), `price`, `voided_quantity`, `status`
- **Campi standard + audit**: `user_created`, `date_created`, `user_updated`, `date_updated`, `venue_user_created`, `venue_user_updated`
- **Relazioni**: O2M `order_items.order_item_modifiers` con `CASCADE`
- **URL**: https://dev.nanawork.it/admin/content/order_item_modifiers

### 22. `transaction_order_refs` — Collegamento N:M pagamenti ↔ comande
- **PK**: `id` (UUID v7)
- **Campi**: `transaction` (FK→transactions), `order` (FK→orders)
- **Relazioni**: O2M `transactions.transaction_order_refs` con `CASCADE`
- **URL**: https://dev.nanawork.it/admin/content/transaction_order_refs

### 23. `transaction_voce_refs` — Righe analitica (voce + quantità)
- **PK**: `id` (UUID v7)
- **Campi**: `transaction` (FK→transactions), `voce_key`, `qty`
- **Nota**: Usata solo per transazioni con `operation_type = 'analitica'`
- **Relazioni**: O2M `transactions.transaction_voce_refs` con `CASCADE`
- **URL**: https://dev.nanawork.it/admin/content/transaction_voce_refs

### 24. `print_jobs` — Log lavori di stampa
- **PK**: `log_id` (string, 'plog_' + UUID)
- **Campi**: `job_id`, `printer` (FK→printers), `venue` (FK→venues), `print_type`, `status` (pending/printing/done/error), `error_message`, `table_label`, `job_timestamp`, `is_reprint`, `original_job_id`, `payload` (JSON)
- **Campi standard + audit**: `date_created`, `user_updated`, `date_updated`, `venue_user_created`, `venue_user_updated`
- **URL**: https://dev.nanawork.it/admin/content/print_jobs

---

## Relazioni configurate (M2O con on_delete)

| Collection (many) | Campo FK | Collection (one) | on_delete |
|---|---|---|---|
| `rooms` | `venue` | `venues` | CASCADE |
| `tables` | `venue` | `venues` | CASCADE |
| `tables` | `room` | `rooms` | SET NULL |
| `payment_methods` | `venue` | `venues` | CASCADE |
| `menu_categories` | `venue` | `venues` | CASCADE |
| `menu_items` | `category` | `menu_categories` | RESTRICT |
| `menu_item_modifiers` | `menu_item` | `menu_items` | CASCADE |
| `bill_sessions` | `table` | `tables` | RESTRICT |
| `orders` | `bill_session` | `bill_sessions` | SET NULL |
| `order_items` | `order` | `orders` | CASCADE |
| `order_item_modifiers` | `order_item` | `order_items` | CASCADE |
| `transactions` | `bill_session` | `bill_sessions` | SET NULL |
| `transaction_order_refs` | `transaction` | `transactions` | CASCADE |
| `transaction_voce_refs` | `transaction` | `transactions` | CASCADE |
| `daily_closure_by_method` | `daily_closure` | `daily_closures` | CASCADE |

---

## Note tecniche

### Primary Key strategy
- **SERIAL (integer)**: `venues`, `menu_categories`, `menu_item_modifiers`, `app_settings`
- **String (VARCHAR)**: `rooms`, `tables`, `payment_methods`, `menu_items`, `printers`, `print_jobs`, `fiscal_receipts`, `invoice_requests`, `table_merge_sessions`
- **UUID v7** (time-ordered, generato client-side): tutte le collection operative (`bill_sessions`, `orders`, `order_items`, `order_item_modifiers`, `transactions`, `transaction_order_refs`, `transaction_voce_refs`, `cash_movements`, `daily_closures`, `daily_closure_by_method`, `venue_users`)

### Status fields
Le collection con `status` di **dominio applicativo** (non workflow Directus) sono:
- `bill_sessions`: `open` / `closed`
- `orders`: `pending` / `accepted` / `preparing` / `ready` / `delivered` / `completed` / `rejected`
- `transactions`, `order_items`, `order_item_modifiers`, `cash_movements`, `daily_closures`, `daily_closure_by_method`: `active` / `archived`
- `fiscal_receipts`, `invoice_requests`: `pending` / `sent` / `ok` / `error`
- `print_jobs`: `pending` / `printing` / `done` / `error`

Le collection con `status` di **workflow Directus** standard (`published`/`draft`/`archived`) sono:
- `venues`, `rooms`, `tables`, `payment_methods`, `menu_categories`, `menu_items`, `menu_item_modifiers`, `printers`, `venue_users`

### Soft-delete strategy
- Tabelle workflow: `PATCH { "status": "archived" }` (non `"record_status"`)
- Tabelle dominio attive: `PATCH { "status": "archived" }` per le tabelle con status active/archived
- Tabelle dominio applicativo puro (bill_sessions, orders): nessun soft-delete — usare le transizioni di stato
- Junction tables: hard `DELETE`

### Campo `venue_user_created` / `venue_user_updated`
Presente in tutte le collection operative per tracciamento audit degli operatori locali con PIN (non sono utenti Directus).

---

## Fix relazioni (2026-04-13 — patch)

A seguito dell'errore **"The relationship is not configured properly"** riscontrato nell'interfaccia Directus, sono state create le **41 relazioni `directus_relations` mancanti**.

### Causa

Quando le collection vengono create specificando `schema.foreign_key_table` nei campi, Directus crea il vincolo FK nel database ma **non** aggiunge automaticamente il record corrispondente in `directus_relations`. Questo fa sì che i campi M2O abbiano l'interfaccia `select-dropdown-m2o` senza una relazione configurata, generando l'errore nell'UI.

### Relazioni aggiunte

| Collection | Campo | Related collection | on_delete |
|-----------|-------|-------------------|-----------|
| `venue_users` | `venue` | `venues` | CASCADE |
| `printers` | `venue` | `venues` | CASCADE |
| `cash_movements` | `venue` | `venues` | CASCADE |
| `cash_movements` | `venue_user_created` | `venue_users` | SET NULL |
| `cash_movements` | `venue_user_updated` | `venue_users` | SET NULL |
| `daily_closures` | `venue` | `venues` | CASCADE |
| `daily_closures` | `venue_user_created` | `venue_users` | SET NULL |
| `daily_closures` | `venue_user_updated` | `venue_users` | SET NULL |
| `menu_items` | `venue` | `venues` | CASCADE |
| `daily_closure_by_method` | `payment_method` | `payment_methods` | RESTRICT |
| `daily_closure_by_method` | `venue_user_created` | `venue_users` | SET NULL |
| `daily_closure_by_method` | `venue_user_updated` | `venue_users` | SET NULL |
| `bill_sessions` | `venue` | `venues` | CASCADE |
| `bill_sessions` | `venue_user_created` | `venue_users` | SET NULL |
| `bill_sessions` | `venue_user_updated` | `venue_users` | SET NULL |
| `app_settings` | `venue` | `venues` | CASCADE |
| `app_settings` | `pre_bill_printer` | `printers` | SET NULL |
| `orders` | `venue` | `venues` | CASCADE |
| `orders` | `table` | `tables` | RESTRICT |
| `orders` | `venue_user_created` | `venue_users` | SET NULL |
| `orders` | `venue_user_updated` | `venue_users` | SET NULL |
| `order_items` | `dish` | `menu_items` | SET NULL |
| `order_items` | `venue_user_created` | `venue_users` | SET NULL |
| `order_items` | `venue_user_updated` | `venue_users` | SET NULL |
| `transactions` | `venue` | `venues` | CASCADE |
| `transactions` | `table` | `tables` | RESTRICT |
| `transactions` | `payment_method` | `payment_methods` | RESTRICT |
| `transactions` | `venue_user_created` | `venue_users` | SET NULL |
| `transactions` | `venue_user_updated` | `venue_users` | SET NULL |
| `order_item_modifiers` | `venue_user_created` | `venue_users` | SET NULL |
| `order_item_modifiers` | `venue_user_updated` | `venue_users` | SET NULL |
| `transaction_order_refs` | `order` | `orders` | CASCADE |
| `print_jobs` | `printer` | `printers` | RESTRICT |
| `print_jobs` | `venue` | `venues` | CASCADE |
| `print_jobs` | `venue_user_created` | `venue_users` | SET NULL |
| `print_jobs` | `venue_user_updated` | `venue_users` | SET NULL |
| `fiscal_receipts` | `table_id` | `tables` | RESTRICT |
| `fiscal_receipts` | `bill_session_id` | `bill_sessions` | SET NULL |
| `invoice_requests` | `table_id` | `tables` | RESTRICT |
| `invoice_requests` | `bill_session_id` | `bill_sessions` | SET NULL |
| `table_merge_sessions` | `slave_table` | `tables` | CASCADE |
| `table_merge_sessions` | `master_table` | `tables` | CASCADE |

### Ristrutturazione `table_merge_sessions`

La collection `table_merge_sessions` era originariamente definita con `slave_table` come PRIMARY KEY e FK verso `tables`. Directus non permette di creare relazioni su campi PK. La collection è stata **ricreata** con:
- Nuovo campo `id` UUID come PK
- `slave_table` come campo stringa UNIQUE con vincolo FK verso `tables`
- `master_table` come campo stringa con vincolo FK verso `tables`

Questo mantiene la semantica invariante (una sola riga per tavolo slave) tramite il vincolo UNIQUE su `slave_table`.

---

## Fix #2 — Relazioni non funzionanti (Interface "select-dropdown-m2o" not found / Reset Interface)

**Data:** 2026-04-13

**Problema:** Le relazioni M2O mostravano ancora l'errore "The relationship is not configured properly". La causa radice era l'uso dell'interfaccia `select-dropdown-m2o` senza la corretta configurazione meta (creata via API `directus_relations` ma senza i campi O2M alias sul lato "one"). Directus non trovava il campo alias corrispondente e resettava l'interfaccia.

**Soluzione applicata:**

1. **Eliminazione di tutte le 57 relazioni esistenti** (create nel Fix #1 senza i campi O2M).
2. **Creazione di 19 campi O2M alias** (`type: alias`, `special: ["o2m"]`, `interface: "list-o2m"`) sui lati "one" di ogni relazione strutturale.
3. **Aggiornamento di tutti i campi M2O** a `display: "related-values"` (standard Directus per campi relazionali).
4. **Ricreazione di tutte le 57 relazioni** con:
   - `meta.one_field` valorizzato con il nome del campo O2M alias (dove applicabile)
   - `schema: null` (Directus auto-crea il FK constraint corretto senza forzare `SET NULL` su colonne NOT NULL)

**Esempio della relazione corretta** (presa dalla correzione manuale `venue_users.venue → venues`):
- Campo M2O: `venue_users.venue` — `interface: select-dropdown-m2o`, `display: related-values`
- Campo O2M alias: `venues.users` — `type: alias`, `interface: list-o2m`, `special: ["o2m"]`
- Relazione: `many_collection: venue_users`, `many_field: venue`, `one_collection: venues`, `one_field: users`

---

## Refactoring UI Directus — Cartelle, Icone, Traduzioni, Ordinamento

**Data:** 2026-04-13

### Cartelle (Folder Collections)

Sono state create **6 cartelle** per organizzare le 24 collezioni nel pannello admin:

| Cartella | Colore | Icona | Collezioni |
|----------|--------|-------|-----------|
| `folder_configurazione_sede` | `#4CAF50` | `store` | `venues`, `venue_users`, `app_settings` |
| `folder_gestione_menu` | `#FF9800` | `restaurant_menu` | `menu_categories`, `menu_items`, `menu_item_modifiers` |
| `folder_sala_infrastruttura` | `#2196F3` | `table_restaurant` | `rooms`, `tables`, `table_merge_sessions`, `printers` |
| `folder_operativita` | `#9C27B0` | `point_of_sale` | `bill_sessions`, `orders`, `order_items`, `order_item_modifiers`, `payment_methods` |
| `folder_amministrazione` | `#F44336` | `receipt_long` | `transactions`, `cash_movements`, `daily_closures`, `daily_closure_by_method`, `transaction_order_refs`, `transaction_voce_refs` |
| `folder_log_integrazioni` | `#607D8B` | `integration_instructions` | `print_jobs`, `fiscal_receipts`, `invoice_requests` |

### Icone e Display per Collezione

Ogni collezione è stata aggiornata con:
- Icona Material Design appropriata (es. `store` per venues, `restaurant` per orders)
- `display_template` per mostrare nomi leggibili nei campi relazionali
- Colore del gruppo (ereditato dalla cartella padre)

### Traduzioni (it-IT / en-US)

Sono state applicate le traduzioni **it-IT** e **en-US** a:
- Tutti i 24 nomi di collezioni (con forme singolare/plurale)
- I campi principali di tutte le collezioni chiave
- Campi di sistema (`date_created`, `date_updated`, ecc.)

Esempi principali:
- `venues` → "Punti Vendita" / "Venues"
- `bill_sessions` → "Sessioni Tavolo" / "Table Sessions"
- `order_items.course` → "Portata" / "Course"
- `orders.course` → "Portata (Prima/Dopo)" / "Course (First/Later)"
- `date_created` → "Data Creazione" / "Date Created"

### Ordinamento Campi

Per tutte le collezioni è stato applicato il seguente schema di ordinamento:
- **sort 1**: ID (hidden)
- **sort 2-10**: Campi principali (name, status, price, M2O references)
- **sort 90-95**: Campi operatore (venue_user_created, venue_user_updated)
- **sort 100**: `date_created` (hidden)
- **sort 101**: `date_updated` (hidden)

I campi di sistema (`date_created`, `date_updated`) sono stati impostati come `hidden: true` per non ingombrare il form.
