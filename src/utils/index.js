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
      id: "ord_rX91", table: "04", status: "pending", time: "19:30", totalAmount: 26.00, itemCount: 4,
      dietaryPreferences: { diete: ["Vegetariano"] },
      globalNote: '', noteVisibility: { cassa: true, sala: true, cucina: true },
      orderItems: [
        { uid: "r_1", dishId: "ant_2", name: "Bruschetta pomodoro", unitPrice: 3, quantity: 2, voidedQuantity: 0, notes: ["Senza aglio"] },
        { uid: "r_3", dishId: "bev_4", name: "Vino Rosso Casa 1L", unitPrice: 10, quantity: 2, voidedQuantity: 0, notes: [] },
      ],
    },
    {
      id: "ord_cop04", table: "04", status: "accepted", time: "19:30", totalAmount: 5.00, itemCount: 2,
      dietaryPreferences: {}, globalNote: '', noteVisibility: { cassa: true, sala: true, cucina: true },
      isDirectEntry: true, isCoverCharge: true,
      orderItems: [
        { uid: "cop_a_04", dishId: "coperto_adulto", name: "Coperto", unitPrice: 2.50, quantity: 2, voidedQuantity: 0, notes: [], modifiers: [] },
      ],
    },
    // ── Tavolo 08 ────────────────────────────────────────────────────────────
    {
      id: "ord_mP02", table: "08", status: "accepted", time: "19:15", totalAmount: 33.00, itemCount: 2,
      dietaryPreferences: {},
      globalNote: '', noteVisibility: { cassa: true, sala: true, cucina: true },
      orderItems: [
        { uid: "r_5", dishId: "ant_8", name: "Tagliere x2", unitPrice: 20, quantity: 1, voidedQuantity: 0, notes: [] },
        { uid: "r_6", dishId: "pri_3", name: "Carbonara", unitPrice: 13, quantity: 2, voidedQuantity: 1, notes: ["Ben cotta"] },
      ],
    },
    {
      id: "ord_cop08", table: "08", status: "accepted", time: "19:15", totalAmount: 5.00, itemCount: 2,
      dietaryPreferences: {}, globalNote: '', noteVisibility: { cassa: true, sala: true, cucina: true },
      isDirectEntry: true, isCoverCharge: true,
      orderItems: [
        { uid: "cop_a_08", dishId: "coperto_adulto", name: "Coperto", unitPrice: 2.50, quantity: 2, voidedQuantity: 0, notes: [], modifiers: [] },
      ],
    },
  ],
};

// Derive flat tables list from rooms — kept in sync at module load time.
// All store/component code that needs the full table list reads appConfig.tables.
appConfig.tables = Array.isArray(appConfig.rooms)
  ? appConfig.rooms.flatMap(r => r.tables || [])
  : (Array.isArray(appConfig.tables) ? appConfig.tables : []);

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
