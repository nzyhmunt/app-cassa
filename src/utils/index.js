// Default URL for loading the external menu JSON
export const DEFAULT_MENU_URL = 'https://nanawork.it/menu.json';

// Configurazione applicazione centralizzata
export const appConfig = {
  ui: { name: "Osteria del Grillo", primaryColor: "#00846c", primaryColorDark: "#0c7262", currency: "€" },

  // URL used to fetch the remote menu; can be overridden via ?menuUrl= query parameter
  menuUrl: DEFAULT_MENU_URL,

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
 * Recalculates itemCount and totalAmount of an order based on its items.
 * Includes modifier prices (paid variants).
 * @param {object} ord - Order object to update
 */
export function updateOrderTotals(ord) {
  if (!ord) return;
  let count = 0;
  let total = 0;
  ord.orderItems.forEach(r => {
    const voided = r.voidedQuantity || 0;
    const active = r.quantity - voided;
    count += active;
    // Base price
    let rowPrice = r.unitPrice;
    // Add modifiers price per unit
    if (r.modifiers && r.modifiers.length > 0) {
      rowPrice += r.modifiers.reduce((a, m) => a + (m.price || 0), 0);
    }
    total += rowPrice * active;
  });
  ord.itemCount = count;
  ord.totalAmount = total;
}
