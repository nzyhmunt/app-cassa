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
const DEFAULT_UI_PRIMARY_COLOR = '#00846c';
const DEFAULT_UI_PRIMARY_COLOR_DARK = '#0c7262';
const DEFAULT_UI_CURRENCY = '€';

// Configurazione applicazione centralizzata (static defaults, immutable fallback)
export const DEFAULT_SETTINGS = {
  ui: {
    name: "Ristorante",
    primaryColor: DEFAULT_UI_PRIMARY_COLOR,
    primaryColorDark: DEFAULT_UI_PRIMARY_COLOR_DARK,
    currency: DEFAULT_UI_CURRENCY,
    allowCustomVariants: true,
  },

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

  // Instance name used to isolate IndexedDB namespace when multiple app instances run
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
  // autoCloseOnFullPayment: quando true chiude automaticamente il conto al saldo completo
  // (default false, to keep manual Close/Fiscal/Invoice choice available)
  // allowCustomEntry: quando true (default), abilita la tab "Personalizzata" nel modal Voce Diretta
  //   per inserire voci libere (nome + prezzo) non collegate al menu. Impostare a false per
  //   limitare le voci dirette solo alle voci presenti nel menu configurato.
  billing: {
    enableCashChangeCalculator: true,
    enableTips: true,
    enableDiscounts: true,
    autoCloseOnFullPayment: false,
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

function _deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function _withDerivedTables(settings) {
  const next = _deepClone(settings);
  next.tables = Array.isArray(next.rooms)
    ? next.rooms.flatMap(r => r.tables || [])
    : (Array.isArray(next.tables) ? next.tables : []);
  return next;
}

export const appConfig = _withDerivedTables(DEFAULT_SETTINGS);

export function createRuntimeConfig(overrides = null) {
  const base = _withDerivedTables(DEFAULT_SETTINGS);
  if (!overrides || typeof overrides !== 'object') return base;
  return _withDerivedTables({ ...base, ..._deepClone(overrides) });
}

/**
 * Applies Directus runtime settings to `appConfig` through a single normalized
 * entry-point.
 * This is the only allowed write path for `appConfig.directus` outside
 * `useDirectusSync`: callers should never assign `appConfig.directus = ...`
 * directly to keep normalization/shape guarantees centralized.
 *
 * @param {object} next
 * @returns {{enabled:boolean,url:string,staticToken:string,venueId:number|string|null,wsEnabled:boolean}}
 */
export function applyDirectusConfigToAppConfig(next = {}) {
  const normalized = {
    enabled: typeof next?.enabled === 'boolean' ? next.enabled : false,
    url: typeof next?.url === 'string' ? next.url : '',
    staticToken: typeof next?.staticToken === 'string' ? next.staticToken : '',
    venueId: next?.venueId != null ? next.venueId : null,
    wsEnabled: typeof next?.wsEnabled === 'boolean' ? next.wsEnabled : false,
  };
  appConfig.directus = normalized;
  return normalized;
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
 * Formats a long order id for compact UI labels while preserving uniqueness.
 * UUIDv7 values often share the same prefix, so we keep both head and tail.
 *
 * @param {string|number|null|undefined} id
 * @param {number} [head=8]
 * @param {number} [tail=4]
 * @returns {string}
 */
export function formatOrderIdShort(id, head = 8, tail = 4) {
  const raw = id == null ? '' : String(id);
  const safeHead = Math.max(1, Number(head) || 8);
  const safeTail = Math.max(1, Number(tail) || 4);
  if (raw.length <= safeHead + safeTail + 1) return raw;
  return `${raw.slice(0, safeHead)}…${raw.slice(-safeTail)}`;
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

/**
 * Returns `true` when two order-item rows can be merged (incremented) into
 * a single row.  Two rows are mergeable when they share the same dish, course,
 * notes (order-insensitive), and modifiers (order-insensitive by name + price).
 *
 * For direct-entry rows (dishId is falsy, e.g. cover charge), `name` and
 * `unitPrice` are also compared so that distinct direct items are never
 * incorrectly merged into one.
 *
 * Used by `orderStore.addItemsToOrder()`, `CassaOrderManager`, and
 * `SalaOrderManager` — keeping the logic in one place prevents drift.
 *
 * @param {object} a
 * @param {object} b
 * @returns {boolean}
 */
export function itemsAreMergeable(a, b) {
  if (a.dishId !== b.dishId) return false;
  // For direct-entry rows (no dishId), also require identical name and price.
  if (!a.dishId && (a.name !== b.name || Number(a.unitPrice) !== Number(b.unitPrice))) return false;
  if ((a.course || DEFAULT_COURSE) !== (b.course || DEFAULT_COURSE)) return false;
  const notesA = [...(a.notes || [])].sort();
  const notesB = [...(b.notes || [])].sort();
  if (notesA.length !== notesB.length || notesA.some((n, i) => n !== notesB[i])) return false;
  const normMod = m => ({ name: String(m.name), price: Number(m.price) || 0 });
  const modComparator = (x, y) => x.name < y.name ? -1 : x.name > y.name ? 1 : x.price - y.price;
  const modsA = [...(a.modifiers || [])].map(normMod).sort(modComparator);
  const modsB = [...(b.modifiers || [])].map(normMod).sort(modComparator);
  if (modsA.length !== modsB.length) return false;
  return modsA.every((m, i) => m.name === modsB[i].name && m.price === modsB[i].price);
}


// ── Numeric keyboard positions ──────────────────────────────────────────────
/** Valid values for the `customKeyboard` setting. */
export const KEYBOARD_POSITIONS = /** @type {const} */ (['disabled', 'center', 'left', 'right']);

// ── Deep equality ───────────────────────────────────────────────────────────

/**
 * Structural deep equality for plain values, arrays, and objects.
 * Does not handle special objects (Date, Map, Set, etc.).
 * Property order is irrelevant for objects: `{a:1, b:2}` equals `{b:2, a:1}`.
 *
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
export function deepEqual(left, right) {
  if (left === right) return true;
  if (left == null || right == null) return left === right;
  if (typeof left !== typeof right) return false;
  if (typeof left !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;

  if (Array.isArray(left)) {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
      if (!deepEqual(left[i], right[i])) return false;
    }
    return true;
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    if (!deepEqual(left[key], right[key])) return false;
  }
  return true;
}



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
