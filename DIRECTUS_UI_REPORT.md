# Directus UI/UX Improvement Report

**Data:** 2026-04-14  
**Istanza:** https://dev.nanawork.it  
**Vincolo:** Solo metadati Directus (nessuna modifica allo schema SQL)

---

## Riepilogo Interventi

Sono stati applicati miglioramenti UI/UX esclusivamente tramite i metadati Directus (MCP PATCH su `directus_fields`, `directus_collections`, `directus_presets`) su **24 collezioni**. Lo schema del database non è stato modificato.

---

## Blocco 1 — Interfacce e Display dei Campi (Status & Enum)

Per ogni campo di tipo enumerazione o stato è stato impostato:
- `interface: "select-dropdown"` con `options.choices` colorati (per il form)
- `display: "labels"` con `display_options.choices` che includono `foreground` e `background` per i badge colorati nelle liste

### Campi Status aggiornati

| Collezione | Campo | Valori | Colori |
|---|---|---|---|
| `venues` | `status` | published / draft / archived | verde / grigio / arancione |
| `venue_users` | `status` | active / archived | verde / arancione |
| `rooms` | `status` | published / archived | verde / arancione |
| `tables` | `status` | published / archived | verde / arancione |
| `payment_methods` | `status` | published / archived | verde / arancione |
| `menu_categories` | `status` | published / archived | verde / arancione |
| `menu_items` | `status` | published / archived | verde / arancione |
| `menu_item_modifiers` | `status` | published / archived | verde / arancione |
| `printers` | `status` | published / archived | verde / arancione |
| `bill_sessions` | `status` | open / closed | verde `#4CAF50` / grigio `#9E9E9E` |
| `orders` | `status` | pending / accepted / preparing / ready / delivered / completed / rejected | `#FF9800` / `#2196F3` / `#FF5722` / `#4CAF50` / `#00BCD4` / `#9E9E9E` / `#F44336` |
| `order_items` | `status` | active / archived | verde / arancione |
| `order_item_modifiers` | `status` | active / archived | verde / arancione |
| `transactions` | `status` | active / archived | verde / arancione |
| `cash_movements` | `status` | active / archived | verde / arancione |
| `daily_closures` | `status` | active / archived | verde / arancione |
| `daily_closure_by_method` | `status` | active / archived | verde / arancione |
| `print_jobs` | `status` | pending / printing / done / error | arancione / blu / verde / rosso |
| `fiscal_receipts` | `status` | pending / sent / ok / error | arancione / blu / verde / rosso |
| `invoice_requests` | `status` | pending / sent / ok / error | arancione / blu / verde / rosso |

### Campi Enum aggiornati

| Collezione | Campo | Valori | Note |
|---|---|---|---|
| `venue_users` | `role` | admin / cassiere / cameriere / cuoco | rosso / blu / verde / arancione |
| `orders` | `status` | 7 stadi workflow | badge senza dot (più leggibile) |
| `order_items` | `course` | prima / insieme / dopo | arancione / blu / viola |
| `transactions` | `operation_type` | unico / romana / ordini / analitica / discount / tip | 6 colori distinti |
| `transactions` | `discount_type` | percent / fixed | arancione / blu |
| `cash_movements` | `type` | deposit / withdrawal | verde `#4CAF50` / rosso `#F44336` |
| `printers` | `connection_type` | http / tcp / file | blu / viola / arancione-scuro |
| `print_jobs` | `print_type` | order / table_move / pre_bill | blu / viola / arancione |
| `fiscal_receipts` | `status` | pending / sent / ok / error | arancione / blu / verde / rosso |
| `invoice_requests` | `status` | pending / sent / ok / error | arancione / blu / verde / rosso |

---

## Blocco 2 — Interfacce Speciali

| Collezione | Campo | Prima | Dopo | Motivazione |
|---|---|---|---|---|
| `venues` | `primary_color` | `input` | `select-color` | Selettore colore visivo per il colore primario brand |
| `venues` | `primary_color_dark` | `input` | `select-color` | Selettore colore visivo per il tema scuro |

---

## Blocco 3 — Display Template delle Collezioni

Il `display_template` di ogni collezione è stato impostato per mostrare informazioni significative quando un record viene referenziato in campi relazionali.

| Collezione | Display Template |
|---|---|
| `venues` | `{{name}}` |
| `venue_users` | `{{display_name}}` |
| `rooms` | `{{label}}` |
| `tables` | `{{label}} ({{covers}} posti)` |
| `payment_methods` | `{{label}}` |
| `menu_categories` | `{{name}}` |
| `menu_items` | `{{name}} — €{{price}}` |
| `menu_item_modifiers` | `{{name}}` |
| `printers` | `{{name}}` |
| `bill_sessions` | `{{table.label}} — {{status}}` |
| `orders` | `{{table.label}} — {{status}}` |
| `order_items` | `{{name}} ×{{quantity}} @ {{unit_price}}` |
| `order_item_modifiers` | `{{name}}` |
| `transactions` | `{{operation_type}} — {{amount_paid}}€` |
| `cash_movements` | `{{type}} — {{amount}}€` |
| `daily_closures` | `{{closure_type}} — {{total_received}}€` |
| `daily_closure_by_method` | `{{payment_method.label}} — {{amount}}€` |
| `print_jobs` | `[{{status}}] {{print_type}} — {{table_label}}` |
| `fiscal_receipts` | `{{table_label}} — {{total_paid}}€ ({{status}})` |
| `invoice_requests` | `{{table_label}} — {{denominazione}} ({{status}})` |
| `table_merge_sessions` | `{{slave_table.label}} → {{master_table.label}}` |
| `app_settings` | `{{venue.name}} — {{device_key}}` |

---

## Blocco 4 — Bookmark di Default (scope: all)

Sono stati creati **5 bookmark globali** (user=null, role=null → visibili a tutti) tramite un Flow Directus che ha eseguito operazioni `item-create` su `directus_presets` con `permissions: "$full"`.

Il Flow (`Setup Bookmark di Default`, ID: `5b4f2191-850c-4793-8a95-4e48ce8da3f2`) è stato **disattivato** dopo l'esecuzione per evitare duplicati.

| Bookmark | Collezione | Icona | Colore | Filtro | Ordinamento |
|---|---|---|---|---|---|
| **Comande in corso** | `orders` | `restaurant` | `#FF9800` | status ∈ [pending, accepted, preparing, ready, delivered] | `-date_created` |
| **Tavoli aperti** | `bill_sessions` | `table_restaurant` | `#4CAF50` | status = open | `-opened_at` |
| **Chiusure di cassa** | `daily_closures` | `calculate` | `#2196F3` | — | `-date_created` |
| **Movimenti di cassa** | `cash_movements` | `account_balance_wallet` | `#9C27B0` | — | `-date_created` |
| **Log stampe recenti** | `print_jobs` | `print` | `#607D8B` | — | `-job_timestamp` |

---

## Vincoli Rispettati

- ✅ **Nessuna modifica allo schema SQL**: tabelle, colonne, tipi e relazioni invariati
- ✅ **Solo metadati Directus**: modifiche applicate esclusivamente a `directus_fields.meta`, `directus_collections.meta`, e `directus_presets`
- ✅ **Testo UI in italiano**: tutte le label utente sono in italiano
- ✅ **Codice tecnico in inglese**: chiavi, valori e configurazioni tecniche mantenuti in inglese

---

## Flow di Setup

Il Flow creato per la generazione dei bookmark è disponibile in Directus ma è stato disattivato:

- **URL**: https://dev.nanawork.it/admin/settings/flows/5b4f2191-850c-4793-8a95-4e48ce8da3f2
- **Stato**: `inactive`
- **Scopo**: Esecuzione una tantum per creare i 5 preset globali
