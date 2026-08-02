// AI Chat Translations - Add new languages here
export const chatTranslations = {
  it: {
    // General
    menuNotAvailable: 'Il menu non è disponibile in questo momento. Prova più tardi!',
    emptyCart: 'Il tuo carrello è vuoto! Inizia aggiungendo qualcosa dal menu.',
    cartComplete: 'Il tuo carrello sembra completo! 🎉',
    kitchenBusy: 'Scusa, in questo momento la cucina è molto indaffarata. Riprova tra un istante! 🙏',

    // Pairing suggestions
    pairWith: 'abbinalo con',
    perfectWith: 'perfetto con',
    somethingFresh: 'qualcosa di fresco',
    aSideDish: 'un contorno',
    anyDish: 'si accompagna perfettamente con qualsiasi piatto del nostro menu',
    perfectEnd: 'un fine pasto perfetto',

    // Magic/Recommendation
    greatChoice: 'Ottima scelta!',
    forItemSuggest: 'ti suggerisco di provare',
    recommend: 'Ti consiglio',
    greatIdea: 'Che buona scelta!',
    howAbout: 'Che ne dici di',
    itsDelicious: 'È delizioso!',
    suggestItem: 'Ti suggerisco',
    enjoyMeal: 'Buon appetito! 🍽️',

    // Categories
    forBreakfast: 'Per la colazione ti consiglio',
    forLunch: 'Per pranzo, un bel',
    forDinner: 'Per cena, ti consiglio',
    veganOptions: 'Ecco le opzioni vegane',
    vegetarianOptions: 'Ecco le opzioni vegetariane',
    sweetTreat: 'Un dolce per terminare',
    toDrink: 'Da bere',

    // Cart
    toCompleteOrder: 'Per completare il tuo ordine, ti suggerisco',

    // Info
    ingredients: 'Ingredienti:',
    allergens: 'Allergeni:',
    delicious: 'Un piatto delizioso.',

    // Allergies
    understandAllergy: 'Capisco! Terrò conto delle tue allergie',
    suggestSafe: 'Vuoi che ti suggerisca piatti sicuri per te?',

    // Add to cart button
    addToCart: 'Aggiungi',
  },

  en: {
    // General
    menuNotAvailable: 'The menu is not available right now. Please try again later!',
    emptyCart: 'Your cart is empty! Start by adding something from the menu.',
    cartComplete: 'Your cart looks complete! 🎉',
    kitchenBusy: 'Sorry, the kitchen is very busy right now. Please try again in a moment! 🙏',

    // Pairing suggestions
    pairWith: 'pair it with',
    perfectWith: 'perfect with',
    somethingFresh: 'something fresh',
    aSideDish: 'a side dish',
    anyDish: 'goes perfectly with any dish on our menu',
    perfectEnd: 'a perfect end to your meal',

    // Magic/Recommendation
    greatChoice: 'Great choice!',
    forItemSuggest: 'I suggest trying',
    recommend: 'I recommend',
    greatIdea: 'Great idea!',
    howAbout: 'How about',
    itsDelicious: "It's delicious!",
    suggestItem: 'I suggest',
    enjoyMeal: 'Enjoy your meal! 🍽️',

    // Categories
    forBreakfast: 'For breakfast, I recommend',
    forLunch: 'For lunch, how about',
    forDinner: 'For dinner, I recommend',
    veganOptions: 'Here are our vegan options',
    vegetarianOptions: 'Here are our vegetarian options',
    sweetTreat: 'A sweet treat to end your meal',
    toDrink: 'To drink',

    // Cart
    toCompleteOrder: 'To complete your order, I suggest',

    // Info
    ingredients: 'Ingredients:',
    allergens: 'Allergens:',
    delicious: 'A delicious dish.',

    // Allergies
    understandAllergy: "I understand! I'll keep your allergies",
    suggestSafe: 'Would you like me to suggest safe dishes?',

    // Add to cart button
    addToCart: 'Add',
  },

  // Add more languages here:
  // Template for new language:
  // fr: {
  //   menuNotAvailable: '...',
  //   emptyCart: '...',
  //   ...
  // },
};

// Get translation for a key
export function getChatTranslation(key, lang = 'it') {
  return chatTranslations[lang]?.[key] || chatTranslations['it'][key] || key;
}

// Get all available languages
export function getAvailableChatLanguages() {
  return Object.keys(chatTranslations);
}
