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
  		{ "id": "ant_1", "nome": "Pinzimonio di verdure", "descrizione": "Seasonal raw vegetables with olive oil", "prezzo": 3, "note": "Vegano", "ingredienti": ["Verdure di stagione", "Olio d'oliva"], "allergeni": [], "immagine_url": "https://app.odg.nanawork.it/assets/0d4d1df7-41ec-4f6c-ade8-af96abec0c6f?key=512x512" },
  		{ "id": "ant_2", "nome": "Bruschetta al pomodoro", "descrizione": "Tomato bruschetta, basil and olive oil", "prezzo": 3, "note": "Vegano", "ingredienti": ["Pane", "Pomodoro", "Basilico", "Olio d'oliva"], "allergeni": ["glutine"], "immagine_url": "" },
  		{ "id": "ant_3", "nome": "Polpette di melanzane", "descrizione": "Homemade eggplant meatballs", "prezzo": 8, "note": "Vegetariano", "ingredienti": ["Melanzane", "Pane", "Uova", "Formaggio"], "allergeni": ["glutine", "uova", "lattosio"], "immagine_url": "" },
  		{ "id": "ant_4", "nome": "Bruschetta cacio e pepe con cicoria", "descrizione": "Cacio e pepe bruschetta with chicory", "prezzo": 5, "note": "Vegetariano", "ingredienti": ["Pane", "Pecorino Romano", "Pepe", "Cicoria"], "allergeni": ["glutine", "lattosio"], "immagine_url": "https://app.odg.nanawork.it/assets/67cd6443-1620-4185-8f3f-c8899b2d0f54?key=512x512" },
  		{ "id": "ant_5", "nome": "Porchetta di Ariccia con patate", "descrizione": "Homemade Ariccia-style porchetta served with roasted potato skewer", "prezzo": 7, "note": "", "ingredienti": ["Porchetta di Ariccia", "Patate al forno"], "allergeni": [], "immagine_url": "https://app.odg.nanawork.it/assets/d74cc6fc-90ef-4d50-9bb3-10cc55b469f8?key=512x512" },
  		{ "id": "ant_6", "nome": "Panzanella e baccalÃ ", "descrizione": "Soaked bread with fresh tomato juice and codfish on top", "prezzo": 8, "note": "", "ingredienti": ["Pane", "Pomodoro", "BaccalÃ "], "allergeni": ["glutine", "pesce"], "immagine_url": "" },
  		{ "id": "ant_7", "nome": "Caprese", "descrizione": "Tomato, mozzarella, basil and olive oil", "prezzo": 8, "note": "Vegetariano", "ingredienti": ["Pomodoro", "Mozzarella", "Basilico", "Olio d'oliva"], "allergeni": ["lattosio"], "immagine_url": "https://app.odg.nanawork.it/assets/864cdd97-346b-492c-a358-309486074856?key=512x512" },
  		{ "id": "ant_8", "nome": "Gran tagliere di antipasti (x2)", "descrizione": "Mixed Appetizer Platter for two people", "prezzo": 20, "note": "Per due persone", "ingredienti": ["Salumi misti", "Formaggi", "Sott'oli"], "allergeni": ["lattosio"], "immagine_url": "https://app.odg.nanawork.it/assets/c4873590-4c2b-4625-adb5-402f7625a1d3?key=512x512" }
  	],
  	"Primi Piatti": [
  		{ "id": "pri_1", "nome": "Rigatoni pomodoro e basilico", "descrizione": "With tomato and basil", "prezzo": 9, "note": "Vegano", "ingredienti": ["Pasta", "Pomodoro", "Basilico"], "allergeni": ["glutine"], "immagine_url": "https://app.odg.nanawork.it/assets/a824d827-be4d-4f23-a2be-74b036c82167?key=512x512" },
  		{ "id": "pri_2", "nome": "Rigatoni all'Amatriciana", "descrizione": "With tomatoes, pecorino cheese and jowl bacon", "prezzo": 12, "note": "", "ingredienti": ["Pasta", "Pomodoro", "Guanciale", "Pecorino Romano"], "allergeni": ["glutine", "lattosio"], "immagine_url": "https://app.odg.nanawork.it/assets/41f03fc3-14c8-499e-8bc4-0fa2cfca98db?key=512x512" },
  		{ "id": "pri_3", "nome": "Rigatoni alla carbonara", "descrizione": "With organic eggs, pecorino cheese and jowl bacon", "prezzo": 13, "note": "", "ingredienti": ["Pasta", "Uova bio", "Guanciale", "Pecorino Romano", "Pepe"], "allergeni": ["glutine", "uova", "lattosio"], "immagine_url": "https://app.odg.nanawork.it/assets/fc324b02-a956-4065-9010-8abaa8ff2a5c?key=512x512" },
  		{ "id": "pri_4", "nome": "Tonnarello cacio e pepe", "descrizione": "With pecorino cheese and black pepper", "prezzo": 12, "note": "Vegetariano", "ingredienti": ["Pasta fresca", "Pecorino Romano", "Pepe"], "allergeni": ["glutine", "lattosio", "uova"], "immagine_url": "" },
  		{ "id": "pri_5", "nome": "Tonnarello alla gricia", "descrizione": "With pecorino cheese, black pepper and jowl bacon", "prezzo": 13, "note": "", "ingredienti": ["Pasta fresca", "Guanciale", "Pecorino Romano", "Pepe"], "allergeni": ["glutine", "lattosio", "uova"], "immagine_url": "https://app.odg.nanawork.it/assets/e0578b96-815e-4287-92df-0b8a04800ba8?key=512x512" },
  		{ "id": "pri_6", "nome": "Tonnarello allo scoglio", "descrizione": "With clams, mussels, and shrimp", "prezzo": 16, "note": "", "ingredienti": ["Pasta fresca", "Vongole", "Cozze", "Gamberi"], "allergeni": ["glutine", "uova", "molluschi", "crostacei"], "immagine_url": "" },
  		{ "id": "pri_7", "nome": "Ravioli ripieni di brasato", "descrizione": "Braised beef ravioli with sage butter and parmesan", "prezzo": 14, "note": "", "ingredienti": ["Ravioli freschi", "Carne brasata", "Burro", "Salvia", "Parmigiano"], "allergeni": ["glutine", "uova", "lattosio"], "immagine_url": "" },
  		{ "id": "pri_8", "nome": "Ravioli ricotta e spinaci", "descrizione": "Ricotta and spinach ravioli with tomato and basil", "prezzo": 14, "note": "Vegetariano", "ingredienti": ["Ravioli freschi", "Ricotta", "Spinaci", "Pomodoro"], "allergeni": ["glutine", "uova", "lattosio"], "immagine_url": "https://app.odg.nanawork.it/assets/93a8a25b-84cf-42c3-bdbf-c751693b519a?key=512x512" }
  	],
  	"Secondi Piatti": [
  		{ "id": "sec_1", "nome": "Polpette al pomodoro", "descrizione": "Meatballs in tomato sauce", "prezzo": 11, "note": "", "ingredienti": ["Carne di manzo", "Pomodoro", "Pane", "Uova"], "allergeni": ["glutine", "uova"], "immagine_url": "" },
  		{ "id": "sec_2", "nome": "Petto di pollo alle erbe", "descrizione": "Herb-crusted chicken breast", "prezzo": 10, "note": "", "ingredienti": ["Pollo", "Erbe aromatiche"], "allergeni": [], "immagine_url": "" },
  		{ "id": "sec_3", "nome": "Trippa alla romana con pecorino", "descrizione": "Roman-style tripe with pecorino", "prezzo": 13, "note": "", "ingredienti": ["Trippa", "Pomodoro", "Menta", "Pecorino Romano"], "allergeni": ["lattosio"], "immagine_url": "https://app.odg.nanawork.it/assets/b1259ee7-2b3e-4528-99e1-f6d191b8bac0?key=512x512" },
  		{ "id": "sec_4", "nome": "BaccalÃ  in umido con crostone", "descrizione": "Stewed salt cod served with toasted bread", "prezzo": 13, "note": "", "ingredienti": ["BaccalÃ ", "Pomodoro", "Pane"], "allergeni": ["glutine", "pesce"], "immagine_url": "" },
  		{ "id": "sec_5", "nome": "Filetto di maiale senape e rosmarino", "descrizione": "Pork tenderloin with mustard and rosemary with roasted potatoes", "prezzo": 15, "note": "Servito con patate", "ingredienti": ["Maiale", "Senape", "Rosmarino", "Patate"], "allergeni": ["senape"], "immagine_url": "" },
  		{ "id": "sec_6", "nome": "Petto di vitello alla fornara", "descrizione": "Oven-roasted veal breast with roasted potatoes", "prezzo": 18, "note": "Servito con patate", "ingredienti": ["Vitello", "Aglio", "Rosmarino", "Patate"], "allergeni": [], "immagine_url": "https://app.odg.nanawork.it/assets/1b60bb1f-8fcf-4abd-9bc3-541cfbc05c16?key=512x512" },
  		{ "id": "sec_7", "nome": "Costolette di abbacchio al timo", "descrizione": "Lamb chops with thyme with roasted potatoes", "prezzo": 20, "note": "Servito con patate", "ingredienti": ["Abbacchio", "Timo", "Patate"], "allergeni": [], "immagine_url": "https://app.odg.nanawork.it/assets/aac42e70-f749-4ed0-8967-e2dce550086b?key=512x512" }
  	],
  	"Pinse": [
  		{ "id": "pin_1", "nome": "Pinsa Margherita", "descrizione": "With tomato sauce, mozzarella and basil", "prezzo": 10, "note": "Vegetariano", "ingredienti": ["Impasto pinsa", "Pomodoro", "Mozzarella"], "allergeni": ["glutine", "lattosio"], "immagine_url": "" },
  		{ "id": "pin_2", "nome": "Pinsa vegetariana", "descrizione": "With grilled eggplants, roasted cherry tomatoes, zucchini sauce and mozzarella", "prezzo": 10, "note": "Vegetariano", "ingredienti": ["Zucchine", "Melanzane", "Pomodorini", "Mozzarella"], "allergeni": ["glutine", "lattosio"], "immagine_url": "" },
  		{ "id": "pin_3", "nome": "Pinsa Margherita Regina", "descrizione": "With burrata stracciatella and basil", "prezzo": 13, "note": "Vegetariano", "ingredienti": ["Pomodoro", "Stracciatella di burrata", "Basilico"], "allergeni": ["glutine", "lattosio"], "immagine_url": "https://app.odg.nanawork.it/assets/d1f6704f-c563-40e6-ba02-5c1ed265976b?key=512x512" },
  		{ "id": "pin_4", "nome": "Pinsa alla Gricia", "descrizione": "With mozzarella, jowl bacon, and pecorino", "prezzo": 12, "note": "", "ingredienti": ["Mozzarella", "Guanciale", "Pecorino Romano"], "allergeni": ["glutine", "lattosio"], "immagine_url": "" },
  		{ "id": "pin_5", "nome": "Pinsa con porchetta e cipolla caramellata", "descrizione": "With ariccia porchetta and caramelized red onion", "prezzo": 15, "note": "", "ingredienti": ["Mozzarella", "Porchetta", "Cipolla rossa"], "allergeni": ["glutine", "lattosio"], "immagine_url": "https://app.odg.nanawork.it/assets/65b9f53f-efd6-4e32-8a11-eeb6bac6431e?key=512x512" }
  	],
  	"Contorni": [
  		{ "id": "con_1", "nome": "Verdure di mercato grigliate", "descrizione": "Seasonal market vegetables grilled", "prezzo": 6, "note": "Vegano", "ingredienti": ["Verdure miste"], "allergeni": [], "immagine_url": "" },
  		{ "id": "con_2", "nome": "Verdura di stagione ripassata", "descrizione": "SautÃ©ed seasonal greens", "prezzo": 6, "note": "Vegano", "ingredienti": ["Verdura di stagione", "Aglio", "Peperoncino"], "allergeni": [], "immagine_url": "" },
  		{ "id": "con_3", "nome": "Patate al forno", "descrizione": "Roasted potatoes", "prezzo": 5, "note": "Vegano", "ingredienti": ["Patate", "Rosmarino"], "allergeni": [], "immagine_url": "" }
  	],
  	"Dolci": [
  		{ "id": "dol_1", "nome": "TiramisÃ¹ scomposto", "descrizione": "Deconstructed tiramisÃ¹", "prezzo": 6, "note": "Vegetariano", "ingredienti": ["Mascarpone", "Savoiardi", "CaffÃ¨"], "allergeni": ["glutine", "lattosio", "uova"], "immagine_url": "" },
  		{ "id": "dol_2", "nome": "Cremoso al limone", "descrizione": "Lemon mousse with wild fruit coulis", "prezzo": 5, "note": "Vegetariano", "ingredienti": ["Limone", "Frutti di bosco"], "allergeni": ["lattosio"], "immagine_url": "" },
  		{ "id": "dol_3", "nome": "Crema leggera al cacao", "descrizione": "Light cocoa cream with chocolate drops and puff pastry", "prezzo": 5, "note": "Vegetariano", "ingredienti": ["Cacao", "Sfoglia", "Cioccolato"], "allergeni": ["glutine", "lattosio"], "immagine_url": "https://app.odg.nanawork.it/assets/2a6ddfb0-c96c-4f28-920c-0db2ca61b005?key=512x512" },
  		{ "id": "dol_4", "nome": "Tortino di mele caldo", "descrizione": "Warm apple cake with vanilla ice cream", "prezzo": 6, "note": "Vegetariano", "ingredienti": ["Mele", "Gelato alla crema"], "allergeni": ["glutine", "lattosio", "uova"], "immagine_url": "" },
  		{ "id": "dol_5", "nome": "Tortino al cioccolato cuore fondente", "descrizione": "Chocolate fondant cake", "prezzo": 6, "note": "Vegetariano", "ingredienti": ["Cioccolato fondente"], "allergeni": ["glutine", "lattosio", "uova"], "immagine_url": "" }
  	],
  	"Bevande": [
  		{ "id": "bev_1", "nome": "Acqua Naturale 1L", "descrizione": "Still mineral water (1 Liter)", "prezzo": 2.5, "note": "", "ingredienti": ["Acqua"], "allergeni": [], "immagine_url": "" },
  		{ "id": "bev_2", "nome": "Acqua Frizzante 1L", "descrizione": "Sparkling mineral water (1 Liter)", "prezzo": 2.5, "note": "", "ingredienti": ["Acqua"], "allergeni": [], "immagine_url": "" },
  		{ "id": "bev_3", "nome": "Coca Cola 33cl", "descrizione": "Classic Coca Cola glass bottle", "prezzo": 3, "note": "", "ingredienti": ["Acqua", "Zucchero", "Aromi"], "allergeni": [], "immagine_url": "" },
  		{ "id": "bev_4", "nome": "Vino della Casa - Rosso 1L", "descrizione": "House red wine (1 Liter jug)", "prezzo": 10, "note": "", "ingredienti": ["Uva"], "allergeni": ["solfiti"], "immagine_url": "" },
  		{ "id": "bev_5", "nome": "Vino Frascati Superiore DOCG 75cl", "descrizione": "Local dry white wine bottle", "prezzo": 18, "note": "", "ingredienti": ["Uva"], "allergeni": ["solfiti"], "immagine_url": "" },
  		{ "id": "bev_6", "nome": "CaffÃ¨ Espresso", "descrizione": "Italian espresso shot", "prezzo": 1.5, "note": "", "ingredienti": ["CaffÃ¨"], "allergeni": [], "immagine_url": "" }
  	]
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
 * Include i prezzi dei modificatori (varianti a pagamento).
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
    // Base price
    let rowPrice = r.prezzo_unitario;
    // Add modifiers price per unit
    if (r.modificatori && r.modificatori.length > 0) {
      rowPrice += r.modificatori.reduce((a, m) => a + (m.prezzo || 0), 0);
    }
    total += rowPrice * attivi;
  });
  ord.numero_articoli = count;
  ord.totale_importo = total;
}
