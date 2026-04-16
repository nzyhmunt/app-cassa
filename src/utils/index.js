/**
 * @file utils/index.js
 * @description Shared utility functions and application configuration.
 *
 * This file is intentionally shared between the Cassa and Sala
 * applications so that any pricing, billing or configuration change is
 * reflected in both UIs automatically.
 *
 * ── Architecture note ──────────────────────────────────────────────────────
 * Shared:   src/utils/index.js (this file), src/store/index.js
 * Shared components:  src/components/shared/
 * Cassa-only:  src/components/TableManager.vue, OrderManager.vue, …
 * Sala-only: src/components/SalaTableManager.vue, SalaOrderManager.vue, …
 * ──────────────────────────────────────────────────────────────────────────
 */

// Default URL for loading the external menu JSON
export const DEFAULT_MENU_URL = 'https://nanawork.it/menu.json';

// Configurazione applicazione centralizzata
export const appConfig = {
  ui: { name: "Osteria del Grillo", primaryColor: "#00846c", primaryColorDark: "#0c7262", currency: "€", allowCustomVariants: true },

  // Timezone used for all locale time formatting across Cassa, Sala and Cucina.
  // Must be a valid IANA timezone identifier (e.g. 'Europe/Rome', 'Europe/Berlin').
  // Defaults to 'Europe/Rome'. Override at build/deploy time to adapt the app to a
  // different timezone without modifying any component code.
  timezone: 'Europe/Rome',

  // BCP 47 locale tag used for all date/time formatting (toLocaleTimeString, toLocaleDateString,
  // toLocaleString) and locale-aware string comparisons (localeCompare) across Cassa, Sala and
  // Cucina. Defaults to 'it-IT'. Override at build/deploy time to adapt the app to a different
  // language/region without modifying any component code.
  locale: 'it-IT',

  // URL used to fetch the remote menu. Override per-build in appConfig or via the Settings modal.
  menuUrl: DEFAULT_MENU_URL,
  // Menu source strategy. `directus` => menu from Directus collections.
  // `json` => menu from remote JSON URL.
  menuSource: 'directus',

  // Instance name used to isolate localStorage keys when multiple app instances run
  // on the same device (same origin). Set a unique value per device/shortcut
  // (e.g. 'cassa1', 'sala2'). This value is configured at build/deploy time.
  // Empty string (default) keeps the original key names for backwards compatibility.
  instanceName: '',

  // URL of a custom logo image used in the PWA manifest (icons array).
  // When set, this image is injected as additional 192×192 and 512×512
  // maskable icons in both the cassa and sala web app manifests during the
  // build/dev process. The URL should be same-origin with the app or come from
  // a host configured with appropriate CORS headers, otherwise install icons
  // may fail to load in some browsers. Override with an empty string to disable
  // custom logo injection.
  pwaLogo: 'https://odg.nanawork.it/media/com_directus/assets/manifest/hr/icon512_maskable.png',

  // CONFIGURAZIONE DINAMICA METODI PAGAMENTO CASSA
  paymentMethods: [
    { id: 'cash', label: 'Contanti', icon: 'banknote', colorClass: 'bg-emerald-600 hover:bg-emerald-700 text-white' },
    { id: 'card', label: 'Pos/Carta', icon: 'credit-card', colorClass: 'theme-bg text-white hover:opacity-90' },
  ],

  // CONFIGURAZIONE SALE — ogni sala raggruppa un sottoinsieme di tavoli.
  // Se è presente una sola sala, la UI non mostra le tab di selezione sala.
  // Se sono presenti più sale, la mappa tavoli (App Cassa e App Sala) mostra
  // una tab per ogni sala; lo switch tra tab filtra i tavoli visualizzati
  // mantenendo le statistiche globali nel banner in cima.
  //
  // Struttura di ogni sala:
  //   id:     identificatore univoco usato internamente (stringa, es. 'sala', 'terrazza')
  //   label:  nome visualizzato nella tab (es. 'Sala Interna', 'Terrazza')
  //   tables: array di tavoli { id, label, covers } — ogni id deve essere globalmente univoco
  //
  // NOTA: `appConfig.tables` è derivato automaticamente da `rooms` e contiene
  //   la lista piatta di tutti i tavoli; non modificare `tables` direttamente.
  rooms: [
    {
      id: 'sala', label: 'Sala', tables: [
        { id: "01", label: "01", covers: 2 }, { id: "02", label: "02", covers: 2 },
        { id: "03", label: "03", covers: 4 }, { id: "04", label: "04", covers: 4 },
        { id: "05", label: "05", covers: 6 }, { id: "06", label: "06", covers: 2 },
      ],
    },
    {
      id: 'terrazza', label: 'Terrazza', tables: [
        { id: "07", label: "07", covers: 2 }, { id: "08", label: "08", covers: 8 },
        { id: "09", label: "09", covers: 4 }, { id: "10", label: "10", covers: 4 },
        { id: "11", label: "11", covers: 2 }, { id: "12", label: "12", covers: 2 },
      ],
    },
  ],
  // Flat list of all tables derived from rooms — used by store internals and backward-compat code.
  // Do not edit manually: it is generated at module load time.
  tables: [],

  // CONFIGURAZIONE COPERTO
  // enabled: abilita/disabilita il coperto automatico
  // autoAdd: aggiunge automaticamente il coperto all'apertura del tavolo
  // priceAdult: prezzo coperto per adulto
  // priceChild: prezzo coperto per bambino (0 = gratuito)
  // Nota: il coperto viene sempre creato come voce diretta (sezione Voce Diretta,
  //   non passa per la coda cucina). Quando enabled è true, le voci "Coperto adulto"
  //   e "Coperto bambino" vengono inserite automaticamente come voci fisse (non rimovibili)
  //   nella tab "Personalizzata" del modal Voce Diretta, per facilitarne l'aggiunta manuale.
  coverCharge: {
    enabled: true,
    autoAdd: true,
    priceAdult: 2.50,
    priceChild: 1.00,
    dishId: 'coperto',
    name: 'Coperto',
  },

  // CONFIGURAZIONE STAMPANTI (coda di stampa comande/ordini)
  // Ciascuna stampante punta a un servizio Node separato che gestisce la
  // comunicazione ESC/POS verso la stampante fisica.
  //
  // Struttura di ogni stampante:
  //   id:         identificatore univoco (stringa, es. 'cucina', 'bar')
  //   name:       nome descrittivo (usato nell'interfaccia e nei log)
  //   url:        URL del servizio di stampa Node (es. 'http://localhost:3001/print')
  //   categories: array di nomi di categorie del menu da instradare su questa
  //               stampante (confronto case-insensitive). Se vuoto o assente,
  //               la stampante è catch-all per le voci (solo per tipo 'order').
  //   printTypes: array di tipi di stampa che questa stampante accetta:
  //               'order'      → comanda cucina/bar
  //               'table_move' → notifica spostamento tavolo
  //               'pre_bill'   → preconto inviato manualmente dalla Cassa
  //               Se vuoto o assente, la stampante accetta tutti i tipi (catch-all).
  //
  // Esempio configurazione multi-stampante:
  //   printers: [
  //     { id: 'cucina', name: 'Cucina', url: 'http://localhost:3001/print',
  //       printTypes: ['order'],
  //       categories: ['Antipasti', 'Primi', 'Secondi', 'Contorni'] },
  //     { id: 'bar',    name: 'Bar',    url: 'http://localhost:3002/print',
  //       printTypes: ['order'],
  //       categories: ['Bevande', 'Digestivi'] },
  //     { id: 'cassa',  name: 'Cassa',  url: 'http://localhost:3003/print',
  //       printTypes: ['pre_bill', 'table_move'] },
  //   ],
  //
  // Stampante di prova (catch-all, riceve tutti i tipi e tutte le voci):
  // Attiva per default — punta al servizio Node ESC/POS locale sulla porta 3001.
  // Rimuovere o sostituire con la configurazione del locale prima del deployment in produzione.
  printers: [
    {
      id: 'demo',
      name: 'Stampante Demo',
      url: 'http://localhost:3001/print',
      // printTypes assente → catch-all (riceve order, table_move, pre_bill)
      // categories assente  → catch-all (riceve tutte le voci del menu)
    },
  ],

  // CONFIGURAZIONE GESTIONE ORDINI
  // rejectionReasons: elenco delle voci predefinite mostrate nel dialog di conferma rifiuto.
  //   Ogni voce ha { value: string, label: string }.
  //   La voce speciale con value 'altro' mostra un campo di testo libero.
  //   L'elenco è sovrascrivibile per personalizzare le causali del locale.
  //   La motivazione è opzionale: il dialog può essere confermato senza selezionarne una.
  orders: {
    rejectionReasons: [
      { value: 'duplicato',         label: 'Ordine duplicato' },
      { value: 'errore_cameriere',  label: 'Errore cameriere' },
      { value: 'altro',             label: 'Altro' },
    ],
  },

  // CONFIGURAZIONE COMPORTAMENTO CONTO
  // enableCashChangeCalculator: mostra il calcolatore del resto per i pagamenti in contanti
  // enableTips: abilita l'inserimento della mancia per ogni pagamento
  // enableDiscounts: abilita l'applicazione di sconti in cassa
  // allowCustomEntry: quando true (default), abilita la tab "Personalizzata" nel modal Voce Diretta
  //   per inserire voci libere (nome + prezzo) non collegate al menu. Impostare a false per
  //   limitare le voci dirette solo alle voci presenti nel menu configurato.
  billing: {
    enableCashChangeCalculator: true,
    enableTips: true,
    enableDiscounts: true,
    allowCustomEntry: true,
  },

  // CONFIGURAZIONE AUTENTICAZIONE
  // Permette di definire utenti statici a livello di build/deploy.
  // Questi utenti sono sola lettura: non possono essere modificati dall'interfaccia.
  // pin: PIN numerico a 4 cifre in plaintext (hashato in memoria, mai persistito)
  // apps: elenco delle app abilitate per l'utente ('cassa', 'sala', 'cucina');
  //        omettere o lasciare vuoto per abilitare tutte e tre le app.
  // Esempio:
  //   users: [
  //     { id: 'mario_cassa', name: 'Mario', pin: '1234', apps: ['cassa', 'sala'] },
  //     { id: 'chef_cucina', name: 'Chef', pin: '5678', apps: ['cucina'] },
  //   ]
  auth: {
    users: [],
  },

  // CONFIGURAZIONE SINCRONIZZAZIONE DIRECTUS
  // Abilita la sincronizzazione bidirezionale con l'istanza Directus (§5.7.2 e §5.7.3).
  //
  // enabled:       imposta a `true` per attivare push + pull.
  //                Se `false` (default) il loop di sync non parte, la sync_queue
  //                continua ad accumularsi offline e viene svuotata non appena
  //                `enabled` torna `true` e il dispositivo è online.
  // url:           URL base dell'istanza Directus senza slash finale
  //                (es. 'https://dev.nanawork.it').
  // staticToken:   token statico Directus con permessi READ/WRITE sulle collection
  //                operative. Generare in Directus → Impostazioni → Token di accesso.
  //                ⚠ Non committare token reali nel sorgente: iniettare a build/deploy.
  // venueId:       ID intero del punto vendita (venues.id) su Directus.
  //                I pull applicano `filter[venue][_eq]={venueId}` sulle collection
  //                che espongono il campo `venue` (con eccezioni schema-specifiche).
  directus: {
    enabled: false,
    url: '',
    staticToken: '',
    venueId: null,
    // wsEnabled: attiva le Directus Subscriptions (WebSocket) come meccanismo di
    // pull real-time. Richiede che l'istanza Directus abbia il modulo WebSocket
    // abilitato. Se false (default), viene usato il polling REST periodico.
    wsEnabled: false,
  },

  // Minimal fallback menu; the full menu is loaded from the external URL at startup
  menu: {
    "Placeholder": [
      { "id": "default_1", "name": "Menu non disponibile", "price": 0, "descrizione": "", "note": "", "ingredienti": [], "allergeni": [], "immagine_url": "" }
    ]
  },

  // DATI DEMO — ordini iniettati al primo avvio (o dopo reset) se lo store è vuoto.
  // Impostare a [] per disabilitare la modalità demo in produzione.
  // Ogni tavolo include: un ordine con le voci del menu (status pending/accepted)
  //   e un ordine coperto corrispondente come voce diretta (isDirectEntry: true).
  demoOrders: [
    // ── Tavolo 04 ────────────────────────────────────────────────────────────
    {
      id: "01960000-0000-7000-8000-000000000001", table: "04", status: "pending", time: "19:30", totalAmount: 26.00, itemCount: 4,
      dietaryPreferences: { diete: ["Vegetariano"] },
      globalNote: '', noteVisibility: { cassa: true, sala: true, cucina: true },
      orderItems: [
        { uid: "r_1", dishId: "ant_2", name: "Bruschetta pomodoro", unitPrice: 3, quantity: 2, voidedQuantity: 0, notes: ["Senza aglio"] },
        { uid: "r_3", dishId: "bev_4", name: "Vino Rosso Casa 1L", unitPrice: 10, quantity: 2, voidedQuantity: 0, notes: [] },
      ],
    },
    {
      id: "01960000-0000-7000-8000-000000000002", table: "04", status: "accepted", time: "19:30", totalAmount: 5.00, itemCount: 2,
      dietaryPreferences: {}, globalNote: '', noteVisibility: { cassa: true, sala: true, cucina: true },
      isDirectEntry: true, isCoverCharge: true,
      orderItems: [
        { uid: "cop_04", dishId: null, name: "Coperto", unitPrice: 2.50, quantity: 2, voidedQuantity: 0, notes: [], modifiers: [] },
      ],
    },
    // ── Tavolo 08 ────────────────────────────────────────────────────────────
    {
      id: "01960000-0000-7000-8000-000000000003", table: "08", status: "accepted", time: "19:15", totalAmount: 33.00, itemCount: 2,
      dietaryPreferences: {},
      globalNote: '', noteVisibility: { cassa: true, sala: true, cucina: true },
      orderItems: [
        { uid: "r_5", dishId: "ant_8", name: "Tagliere x2", unitPrice: 20, quantity: 1, voidedQuantity: 0, notes: [] },
        { uid: "r_6", dishId: "pri_3", name: "Carbonara", unitPrice: 13, quantity: 2, voidedQuantity: 1, notes: ["Ben cotta"] },
      ],
    },
    {
      id: "01960000-0000-7000-8000-000000000004", table: "08", status: "accepted", time: "19:15", totalAmount: 5.00, itemCount: 2,
      dietaryPreferences: {}, globalNote: '', noteVisibility: { cassa: true, sala: true, cucina: true },
      isDirectEntry: true, isCoverCharge: true,
      orderItems: [
        { uid: "cop_08", dishId: null, name: "Coperto", unitPrice: 2.50, quantity: 2, voidedQuantity: 0, notes: [], modifiers: [] },
      ],
    },
  ],
};

// Derive flat tables list from rooms — kept in sync at module load time.
// All store/component code that needs the full table list reads appConfig.tables.
appConfig.tables = Array.isArray(appConfig.rooms)
  ? appConfig.rooms.flatMap(r => r.tables || [])
  : (Array.isArray(appConfig.tables) ? appConfig.tables : []);

// Immutable runtime snapshot used to restore full local config defaults before
// applying a fresh Directus configuration pull.
const _defaultAppConfigSnapshot = JSON.parse(JSON.stringify(appConfig));

/**
 * Restores appConfig to module defaults.
 *
 * @param {{ keepDirectusConfig?: boolean }} [opts]
 */
export function resetAppConfigFromDefaults({ keepDirectusConfig = true } = {}) {
  const hasDirectusConfig = Object.prototype.hasOwnProperty.call(appConfig, 'directus');
  const directusConfig = (keepDirectusConfig && hasDirectusConfig)
    ? JSON.parse(JSON.stringify(appConfig.directus))
    : null;
  const clonedDefaults = JSON.parse(JSON.stringify(_defaultAppConfigSnapshot));
  Object.assign(appConfig, clonedDefaults);
  if (keepDirectusConfig && hasDirectusConfig) appConfig.directus = directusConfig;
}

/**
 * Applies Directus-sourced configuration (fetched from IndexedDB) onto appConfig.
 *
 * Called after each global pull cycle so that venue settings, rooms, tables,
 * payment methods, printers, and menu are kept in sync with the Directus backend
 * without requiring a full page reload.
 *
 * Priority rules (D4):
 *  - Venue scalar fields: Directus wins if the field is non-null.
 *  - Rooms/tables: replaced wholesale when Directus returns ≥1 room.
 *  - Payment methods / printers: replaced wholesale when ≥1 record is returned.
 *  - Menu: when `menuSource === 'directus'`, Directus menu wins over static/URL-loaded
 *    menu when ≥1 category with ≥1 item is returned.
 *
 * **Empty-array behaviour**: if a collection array is empty (e.g. no rooms were
 * returned from IDB because Directus hasn't populated them yet), the corresponding
 * appConfig field is left unchanged.  This is intentional — an empty result is
 * treated as "no data available" rather than "clear existing data".  The static
 * defaults defined in appConfig remain active until Directus provides actual records.
 *
 * @param {{ venueRecord: object|null, rooms: Array, tables: Array,
 *           paymentMethods: Array, printers: Array,
 *           categories: Array, items: Array, modifiers: Array,
 *           categoryModifierLinks: Array, itemModifierLinks: Array }|null} cfg - Output of loadConfigFromIDB()
 */
export function applyDirectusConfigToAppConfig(cfg) {
  if (!cfg) return;
  const {
    venueRecord,
    rooms,
    tables,
    paymentMethods,
    printers,
    categories,
    items,
    modifiers = [],
    categoryModifierLinks = [],
    itemModifierLinks = [],
  } = cfg;
  const relationId = (value) => {
    if (value == null) return null;
    if (typeof value === 'object') return value.id ?? null;
    return value;
  };

  // ── Venue scalar settings ──────────────────────────────────────────────────
  if (venueRecord) {
    if (venueRecord.name != null)                appConfig.ui.name = venueRecord.name;
    if (venueRecord.primary_color != null)       appConfig.ui.primaryColor = venueRecord.primary_color;
    if (venueRecord.primary_color_dark != null)  appConfig.ui.primaryColorDark = venueRecord.primary_color_dark;
    if (venueRecord.currency_symbol != null)     appConfig.ui.currency = venueRecord.currency_symbol;
    if (venueRecord.allow_custom_variants != null)
      appConfig.ui.allowCustomVariants = venueRecord.allow_custom_variants;

    if (venueRecord.cover_charge_enabled != null)
      appConfig.coverCharge.enabled = venueRecord.cover_charge_enabled;
    if (venueRecord.cover_charge_auto_add != null)
      appConfig.coverCharge.autoAdd = venueRecord.cover_charge_auto_add;
    if (venueRecord.cover_charge_price_adult != null)
      appConfig.coverCharge.priceAdult = Number(venueRecord.cover_charge_price_adult);
    if (venueRecord.cover_charge_price_child != null)
      appConfig.coverCharge.priceChild = Number(venueRecord.cover_charge_price_child);

    if (venueRecord.billing_enable_cash_change_calculator != null)
      appConfig.billing.enableCashChangeCalculator = venueRecord.billing_enable_cash_change_calculator;
    if (venueRecord.billing_enable_tips != null)
      appConfig.billing.enableTips = venueRecord.billing_enable_tips;
    if (venueRecord.billing_enable_discounts != null)
      appConfig.billing.enableDiscounts = venueRecord.billing_enable_discounts;
    if (venueRecord.billing_allow_custom_entry != null)
      appConfig.billing.allowCustomEntry = venueRecord.billing_allow_custom_entry;

    if (Array.isArray(venueRecord.orders_rejection_reasons) && venueRecord.orders_rejection_reasons.length > 0)
      appConfig.orders.rejectionReasons = venueRecord.orders_rejection_reasons;
    if (venueRecord.menu_source !== null && venueRecord.menu_source !== undefined) {
      appConfig.menuSource = venueRecord.menu_source;
    }
    if (venueRecord.menu_url != null && String(venueRecord.menu_url).trim() !== '') {
      appConfig.menuUrl = String(venueRecord.menu_url);
    }
  }

  // ── Rooms and tables ───────────────────────────────────────────────────────
  if (rooms.length > 0) {
    const tablesByRoom = new Map();
    const tableById = new Map();
    for (const t of tables) {
      const roomId = relationId(t.room);
      const key = roomId != null ? String(roomId) : '_unassigned';
      if (!tablesByRoom.has(key)) tablesByRoom.set(key, []);
      const tableEntry = { id: t.id, label: t.label, covers: t.covers ?? 2 };
      tablesByRoom.get(key).push(tableEntry);
      tableById.set(String(t.id), tableEntry);
    }
    const configuredRooms = rooms.map(r => ({
      id: r.id,
      label: r.label,
      tables: (() => {
        const roomId = String(r.id);
        const directTables = tablesByRoom.get(roomId) ?? [];
        if (directTables.length > 0 || !Array.isArray(r.tables) || r.tables.length === 0) return directTables;
        return r.tables
          .map((roomTable) => {
          const roomTableId = relationId(roomTable);
          const tableEntry = roomTableId != null ? tableById.get(String(roomTableId)) : null;
          if (tableEntry) return tableEntry;
          if (typeof roomTable === 'object' && roomTableId != null) {
            return {
              id: roomTableId,
              label: roomTable.label ?? String(roomTableId),
              covers: roomTable.covers ?? 2,
            };
          }
          if (roomTableId == null) return null;
          return { id: roomTableId, label: String(roomTableId), covers: 2 };
        })
          .filter(Boolean);
      })(),
    }));
    const unassignedTables = tablesByRoom.get('_unassigned') ?? [];
    appConfig.rooms = unassignedTables.length > 0
      ? [...configuredRooms, { id: '_unassigned', label: 'Unassigned', tables: unassignedTables }]
      : configuredRooms;
    appConfig.tables = appConfig.rooms.flatMap(r => r.tables);
  } else if (tables.length > 0) {
    // No explicit rooms: surface all tables in a generic room so unassigned tables are not lost.
    const genericTables = tables.map(t => ({
      id: t.id,
      label: t.label,
      covers: t.covers ?? 2,
    }));
    appConfig.rooms = [{ id: 'sala', label: 'Sala', tables: genericTables }];
    appConfig.tables = genericTables;
  }

  // ── Payment methods ────────────────────────────────────────────────────────
  if (paymentMethods.length > 0) {
    appConfig.paymentMethods = paymentMethods.map(pm => ({
      id: pm.id,
      label: pm.label,
      icon: pm.icon ?? '',
      colorClass: pm.color_class ?? '',
    }));
  }

  // ── Printers ───────────────────────────────────────────────────────────────
  if (printers.length > 0) {
    appConfig.printers = printers.map(p => {
      const entry = { id: p.id, name: p.name, url: p.url };
      if (p.print_types?.length) entry.printTypes = p.print_types;
      if (p.categories?.length)  entry.categories = p.categories;
      return entry;
    });
  }

  // ── Menu (D4) — Directus wins only when menuSource is set to directus ──────
  if (appConfig.menuSource === 'directus' && categories.length > 0 && items.length > 0) {
    const parseJsonArray = (value) => {
      if (Array.isArray(value)) return value;
      if (typeof value === 'string' && value.trim() !== '') {
        try {
          const parsed = JSON.parse(value);
          return Array.isArray(parsed) ? parsed : [];
        } catch (_) {
          return [];
        }
      }
      return [];
    };
    const normalizeModifier = (modifier) => ({
      id: modifier.id,
      name: modifier.name ?? '',
      price: Number(modifier.price ?? 0),
    });
    const modifiersById = new Map(
      modifiers
        .filter((modifier) => modifier.status !== 'archived')
        .map((modifier) => [String(modifier.id), normalizeModifier(modifier)]),
    );
    const categoryModifierIds = new Map();
    for (const link of categoryModifierLinks) {
      const categoryId = relationId(link.menu_categories_id);
      const modifierId = relationId(link.menu_modifiers_id);
      if (categoryId == null || modifierId == null) continue;
      const key = String(categoryId);
      if (!categoryModifierIds.has(key)) categoryModifierIds.set(key, new Set());
      categoryModifierIds.get(key).add(String(modifierId));
    }
    const itemModifierIds = new Map();
    for (const link of itemModifierLinks) {
      const itemId = relationId(link.menu_items_id);
      const modifierId = relationId(link.menu_modifiers_id);
      if (itemId == null || modifierId == null) continue;
      const key = String(itemId);
      if (!itemModifierIds.has(key)) itemModifierIds.set(key, new Set());
      itemModifierIds.get(key).add(String(modifierId));
    }

    const itemsByCategory = new Map();
    for (const item of items) {
      const categoryId = relationId(item.category);
      if (categoryId == null) continue;
      if (!itemsByCategory.has(categoryId)) itemsByCategory.set(categoryId, []);
      const mergedModifierIds = new Set([
        ...(categoryModifierIds.get(String(categoryId)) ?? []),
        ...(itemModifierIds.get(String(item.id)) ?? []),
      ]);
      const availableModifiers = [...mergedModifierIds]
        .map((modifierId) => modifiersById.get(String(modifierId)))
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name, appConfig.locale));

      itemsByCategory.get(categoryId).push({
        id: item.id,
        name: item.name,
        price: Number(item.price),
        descrizione: item.description ?? '',
        note: item.note ?? '',
        ingredienti: parseJsonArray(item.ingredients),
        allergeni: parseJsonArray(item.allergens),
        immagine_url: item.image_url ?? '',
        modifiers: availableModifiers,
      });
    }
    const menu = {};
    for (const cat of categories) {
      const catItems = itemsByCategory.get(relationId(cat.id) ?? cat.id) ?? [];
      if (catItems.length > 0) menu[cat.name] = catItems;
    }
    if (Object.keys(menu).length > 0) appConfig.menu = menu;
  }
}

/**
 * Returns a stable, unique string key for a closed bill.
 * Use as :key in v-for lists and as the base for ARIA panel ids.
 * @param {object} bill - Closed bill object
 * @returns {string}
 */
export function billKey(bill) {
  return bill.tableId + '_' + (bill.billSessionId ?? bill.closedAt ?? '');
}

/**
 * Returns the current time as a zero-padded 24-hour "HH:MM" string.
 * Always produces ASCII digits (0–9) and hours in the range 00–23, suitable
 * for the Directus `order_time` TIME field (e.g. "08:05", "14:30", "23:59").
 *
 * Implementation notes:
 *  - Locale is hard-coded to `'en-u-nu-latn'` (English + Latin numbering system)
 *    so non-Latin digits (e.g. Arabic-Indic from an `ar` locale) can never appear
 *    in the output, regardless of `appConfig.locale`.
 *  - `hourCycle: 'h23'` forces the range 00–23; midnight is always "00", never "24"
 *    (which some locales emit with `h24`).
 *  - `appConfig.timezone` is still respected so the time reflects the venue's zone,
 *    not the device clock.
 * @returns {string}
 */
export function formatOrderTime() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-u-nu-latn', {
    timeZone: appConfig.timezone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const hour = parts.find(part => part.type === 'hour')?.value ?? '00';
  const minute = parts.find(part => part.type === 'minute')?.value ?? '00';
  return hour + ':' + minute;
}

/**
 * Computes the total price for a single order-item row, accounting for
 * per-modifier voided quantities.
 * @param {object} item - An orderItem object
 * @returns {number}
 */
export function getOrderItemRowTotal(item) {
  const active = item.quantity - (item.voidedQuantity || 0);
  let total = item.unitPrice * active;
  for (const m of (item.modifiers || [])) {
    const modVoided = m.voidedQuantity || 0;
    total += (m.price || 0) * Math.max(0, active - modVoided);
  }
  return total;
}

/**
 * Recalculates itemCount and totalAmount of an order based on its items.
 * Uses getOrderItemRowTotal for per-row pricing so there is a single pricing implementation.
 * @param {object} ord - Order object to update
 */
export function updateOrderTotals(ord) {
  if (!ord) return;
  let count = 0;
  let total = 0;
  ord.orderItems.forEach(r => {
    const active = r.quantity - (r.voidedQuantity || 0);
    count += active;
    total += getOrderItemRowTotal(r);
  });
  ord.itemCount = count;
  ord.totalAmount = total;
}

/**
 * Derives the list of config-pinned (locked) items for the "Personalizzata" tab
 * of the Voce Diretta modal, based on the coverCharge configuration.
 *
 * When coverCharge.enabled is true, a "Coperto" entry is added for every
 * positive priceAdult and a "Coperto bambino" entry for every positive priceChild.
 * These items carry `locked: true` so the UI can render them non-removable.
 * The naming mirrors the cover-charge order logic: adult → `name`, child → `name + ' bambino'`.
 *
 * @param {object|null|undefined} coverCharge - appConfig.coverCharge object
 * @returns {{ name: string, price: number, locked: true }[]}
 */
export function getLockedDirectItems(coverCharge) {
  if (!coverCharge?.enabled) return [];
  const items = [];
  if ((coverCharge.priceAdult ?? 0) > 0) {
    items.push({ name: coverCharge.name ?? 'Coperto', price: coverCharge.priceAdult, locked: true });
  }
  if ((coverCharge.priceChild ?? 0) > 0) {
    items.push({ name: (coverCharge.name ?? 'Coperto') + ' bambino', price: coverCharge.priceChild, locked: true });
  }
  return items;
}

// ── Kitchen order status constants ─────────────────────────────────────────

/**
 * All order statuses that are considered "active in kitchen" — the order has
 * been accepted and is being tracked by App Cucina (Da Preparare → In Cottura
 * → Pronta → Consegnata). Payment (completed/rejected) happens after this.
 */
export const KITCHEN_ACTIVE_STATUSES = ['accepted', 'preparing', 'ready', 'delivered'];

/**
 * Sort priority for kitchen statuses — lower value = shown first.
 * Used when sorting mixed-status orders in "In Cucina" views.
 */
export const KITCHEN_STATUS_PRIORITY = { accepted: 0, preparing: 1, ready: 2, delivered: 3 };

// ── Course (portata) helpers ────────────────────────────────────────────────

/** Canonical course order for display. */
export const COURSE_ORDER = ['prima', 'insieme', 'dopo'];

/** Default course assigned to items without an explicit course value. */
export const DEFAULT_COURSE = 'insieme';

/**
 * Returns the Tailwind border-left color class for a course string.
 * @param {string} course - 'prima' | 'insieme' | 'dopo'
 */
export function getCourseBorderClass(course) {
  if (course === 'prima') return 'border-orange-400';
  if (course === 'dopo') return 'border-purple-500';
  return 'border-[var(--brand-primary)]'; // insieme / default
}

/**
 * Returns the Tailwind text color class for a course quantity badge.
 * @param {string} course - 'prima' | 'insieme' | 'dopo'
 */
export function getCourseQtyClass(course) {
  if (course === 'prima') return 'text-orange-600';
  if (course === 'dopo') return 'text-purple-600';
  return 'text-[var(--brand-primary)]'; // insieme / default
}

/**
 * Groups an array of order items by course and returns a flat list of rows
 * suitable for v-for rendering.  Each row is either:
 *   { type: 'header', course }            — section header (only when >1 course present)
 *   { type: 'item', item, index, course } — item row
 *
 * @param {Array}   items      - orderItem objects (already filtered if needed)
 * @param {boolean} [includeIndex=true] - whether to include the original index
 * @returns {Array}
 */
export function groupOrderItemsByCourse(items, includeIndex = true) {
  const groups = { prima: [], insieme: [], dopo: [] };
  items.forEach((item, rawIndex) => {
    const course = item.course && COURSE_ORDER.includes(item.course) ? item.course : DEFAULT_COURSE;
    groups[course].push(includeIndex ? { item, index: rawIndex, course } : { item, course });
  });
  const nonEmpty = COURSE_ORDER.filter(c => groups[c].length > 0);
  const showHeaders = nonEmpty.length > 1;
  const result = [];
  COURSE_ORDER.forEach(course => {
    if (groups[course].length > 0) {
      if (showHeaders) result.push({ type: 'header', course });
      groups[course].forEach(entry => result.push({ type: 'item', ...entry }));
    }
  });
  return result;
}


// ── Numeric keyboard positions ──────────────────────────────────────────────
/** Valid values for the `customKeyboard` setting. */
export const KEYBOARD_POSITIONS = /** @type {const} */ (['disabled', 'center', 'left', 'right']);

// ── Fiscal receipt XML builder ──────────────────────────────────────────────

/**
 * Builds the RT-printer XML payload for a fiscal receipt.
 *
 * This is the single, shared implementation used by both the live-cassa close
 * flow (CassaTableManager) and the post-close fiscal emission from the bill
 * history (CassaBillCard). Keeping it here ensures any future protocol tweaks
 * (e.g. per official RT-printer documentation) are applied in one place only.
 *
 * @param {object} base - Bill summary produced by `_buildBillSummaryBase()`.
 * @param {Array}  base.orders          - Orders with items (name, quantity, unitPrice).
 * @param {Array}  base.paymentMethods  - List of payment method labels.
 * @param {number} base.totalAmount     - Gross order total used as fiscal total.
 * @returns {string} XML string for the RT printer.
 */
export function buildFiscalXmlRequest(base) {
  const escXml = s => String(s).replace(/[<>&"']/g, c => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]
  ));
  const lines = base.orders.flatMap(o => o.items).map(item => {
    const qty = item.quantity.toFixed(3);
    const price = item.unitPrice.toFixed(2);
    return `  <printRecItem description="${escXml(item.name)}" quantity="${qty}" unitPrice="${price}" department="1" />`;
  });
  const paymentType = base.paymentMethods.some(m => /cart|bancomat|pos|visa|master|carta/i.test(m)) ? '2' : '0';
  const paymentLabel = escXml(base.paymentMethods.join(' + ') || 'CONTANTI');
  const total = base.totalAmount.toFixed(2);
  return [
    '<printerFiscalReceipt>',
    '  <beginFiscalReceipt operator="1" />',
    ...lines,
    `  <printRecTotal payment="${total}" paymentType="${paymentType}" description="${paymentLabel}" />`,
    '  <endFiscalReceipt />',
    '</printerFiscalReceipt>',
  ].join('\n');
}
