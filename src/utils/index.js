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

  // URL used to fetch the remote menu; can be overridden via ?menuUrl= query parameter
  menuUrl: DEFAULT_MENU_URL,

  // Instance name used to isolate localStorage keys when multiple app instances run
  // on the same device (same origin). Set a unique value per device/shortcut
  // (e.g. 'cassa1', 'sala2'). Can also be overridden via ?instance= query param.
  // Empty string (default) keeps the original key names for backwards compatibility.
  instanceName: '',

  // CONFIGURAZIONE DINAMICA METODI PAGAMENTO CASSA
  paymentMethods: [
    { id: 'cash', label: 'Contanti', icon: 'banknote', colorClass: 'border-emerald-500 text-emerald-600 hover:bg-emerald-50' },
    { id: 'card', label: 'Pos/Carta', icon: 'credit-card', colorClass: 'theme-bg text-white border-transparent hover:opacity-90 shadow-md' },
  ],

  tables: [
    { id: "01", label: "01", covers: 2 }, { id: "02", label: "02", covers: 2 },
    { id: "03", label: "03", covers: 4 }, { id: "04", label: "04", covers: 4 },
    { id: "05", label: "05", covers: 6 }, { id: "06", label: "06", covers: 2 },
    { id: "07", label: "07", covers: 2 }, { id: "08", label: "08", covers: 8 },
    { id: "09", label: "09", covers: 4 }, { id: "10", label: "10", covers: 4 },
    { id: "11", label: "11", covers: 2 }, { id: "12", label: "12", covers: 2 },
  ],

  // CONFIGURAZIONE COPERTO
  // enabled: abilita/disabilita il coperto automatico
  // autoAdd: aggiunge automaticamente il coperto all'apertura del tavolo
  // priceAdult: prezzo coperto per adulto
  // priceChild: prezzo coperto per bambino (0 = gratuito)
  coverCharge: {
    enabled: true,
    autoAdd: true,
    priceAdult: 2.50,
    priceChild: 1.00,
    dishId: 'coperto',
    name: 'Coperto',
  },

  // CONFIGURAZIONE COMPORTAMENTO CONTO
  // autoCloseOnFullPayment: quando true, il conto si chiude automaticamente al saldo completo
  // enableCashChangeCalculator: mostra il calcolatore del resto per i pagamenti in contanti
  // enableTips: abilita l'inserimento della mancia per ogni pagamento
  // enableDiscounts: abilita l'applicazione di sconti in cassa
  billing: {
    autoCloseOnFullPayment: true,
    enableCashChangeCalculator: true,
    enableTips: true,
    enableDiscounts: true,
  },

  // Minimal fallback menu; the full menu is loaded from the external URL at startup
  menu: {
    "Placeholder": [
      { "id": "default_1", "name": "Menu non disponibile", "price": 0, "descrizione": "", "note": "", "ingredienti": [], "allergeni": [], "immagine_url": "" }
    ]
  },
};

export const initialOrders = [
  {
    id: "ord_rX91", table: "04", status: "pending", time: "19:30", totalAmount: 26.00, itemCount: 4,
    dietaryPreferences: { diete: ["Vegetariano"] },
    orderItems: [
      { uid: "r_1", dishId: "ant_2", name: "Bruschetta pomodoro", unitPrice: 3, quantity: 2, voidedQuantity: 0, notes: ["Senza aglio"] },
      { uid: "r_3", dishId: "bev_4", name: "Vino Rosso Casa 1L", unitPrice: 10, quantity: 2, voidedQuantity: 0, notes: [] },
    ],
  },
  {
    id: "ord_mP02", table: "08", status: "accepted", time: "19:15", totalAmount: 33.00, itemCount: 2,
    dietaryPreferences: {},
    orderItems: [
      { uid: "r_5", dishId: "ant_8", name: "Tagliere x2", unitPrice: 20, quantity: 1, voidedQuantity: 0, notes: [] },
      { uid: "r_6", dishId: "pri_3", name: "Carbonara", unitPrice: 13, quantity: 2, voidedQuantity: 1, notes: ["Ben cotta"] },
    ],
  },
];

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
