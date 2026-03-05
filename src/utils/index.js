// Configurazione applicazione centralizzata
export const appConfig = {
  ui: { name: "Osteria del Grillo", primaryColor: "#00846c", primaryColorDark: "#0c7262", currency: "€" },

  // CONFIGURAZIONE DINAMICA METODI PAGAMENTO CASSA
  paymentMethods: [
    { id: 'cash', label: 'Contanti', icon: 'banknote', colorClass: 'border-emerald-500 text-emerald-600 hover:bg-emerald-50' },
    { id: 'card', label: 'Pos/Carta', icon: 'credit-card', colorClass: 'theme-bg text-white border-transparent hover:opacity-90 shadow-md' },
  ],

  tables: [
    { id: "01", label: "01", coperti: 2 }, { id: "02", label: "02", coperti: 2 },
    { id: "03", label: "03", coperti: 4 }, { id: "04", label: "04", coperti: 4 },
    { id: "05", label: "05", coperti: 6 }, { id: "06", label: "06", coperti: 2 },
    { id: "07", label: "07", coperti: 2 }, { id: "08", label: "08", coperti: 8 },
    { id: "09", label: "09", coperti: 4 }, { id: "10", label: "10", coperti: 4 },
    { id: "11", label: "11", coperti: 2 }, { id: "12", label: "12", coperti: 2 },
  ],

  menu: {
    "Antipasti": [
      { "id": "ant_1", "nome": "Pinzimonio", "prezzo": 3 },
      { "id": "ant_2", "nome": "Bruschetta pomodoro", "prezzo": 3 },
      { "id": "ant_8", "nome": "Tagliere x2", "prezzo": 20 },
    ],
    "Primi Piatti": [
      { "id": "pri_1", "nome": "Rigatoni pomodoro", "prezzo": 9 },
      { "id": "pri_2", "nome": "Amatriciana", "prezzo": 12 },
      { "id": "pri_3", "nome": "Carbonara", "prezzo": 13 },
    ],
    "Secondi Piatti": [
      { "id": "sec_1", "nome": "Polpette pomodoro", "prezzo": 11 },
      { "id": "sec_7", "nome": "Costolette abbacchio", "prezzo": 20 },
    ],
    "Bevande": [
      { id: 'bev_1', nome: 'Acqua Naturale 1L', prezzo: 2.5 },
      { id: 'bev_4', nome: 'Vino Rosso Casa 1L', prezzo: 10 },
    ],
  },
};

export const initialOrders = [
  {
    id: "ord_rX91", tavolo: "04", status: "pending", time: "19:30", totale_importo: 26.00, numero_articoli: 4,
    preferenze_alimentari: { diete: ["Vegetariano"] },
    righe_ordine: [
      { uid: "r_1", id_piatto: "ant_2", nome: "Bruschetta pomodoro", prezzo_unitario: 3, quantita: 2, quantita_stornata: 0, note: ["Senza aglio"] },
      { uid: "r_3", id_piatto: "bev_4", nome: "Vino Rosso Casa 1L", prezzo_unitario: 10, quantita: 2, quantita_stornata: 0, note: [] },
    ],
  },
  {
    id: "ord_mP02", tavolo: "08", status: "accepted", time: "19:15", totale_importo: 33.00, numero_articoli: 2,
    preferenze_alimentari: {},
    righe_ordine: [
      { uid: "r_5", id_piatto: "ant_8", nome: "Tagliere x2", prezzo_unitario: 20, quantita: 1, quantita_stornata: 0, note: [] },
      { uid: "r_6", id_piatto: "pri_3", nome: "Carbonara", prezzo_unitario: 13, quantita: 2, quantita_stornata: 1, note: ["Ben cotta"] },
    ],
  },
];

/**
 * Ricalcola numero_articoli e totale_importo di un ordine in base alle righe.
 * @param {object} ord - Oggetto ordine da aggiornare
 */
export function updateOrderTotals(ord) {
  if (!ord) return;
  let count = 0;
  let total = 0;
  ord.righe_ordine.forEach(r => {
    const stornati = r.quantita_stornata || 0;
    const attivi = r.quantita - stornati;
    count += attivi;
    total += r.prezzo_unitario * attivi;
  });
  ord.numero_articoli = count;
  ord.totale_importo = total;
}
