<template>
  <div class="flex flex-col h-full bg-gray-50">
    <!-- Chat messages -->
    <div ref="chatContainer" class="flex-1 overflow-y-auto p-4 space-y-4 pb-20 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPjxyZWN0IHdpZHRoPSI4IiBoZWlnaHQ9IjgiIGZpbGw9IiNmOGZhZmMiLz48Y2lyY2xlIGN4PSI0IiBjeT0iNCIgcj0iMSIgZmlsbD0iI2UxZTVlOSIvPjwvc3ZnPg==')]">
      <!-- Welcome message -->
      <div class="flex gap-3">
        <div class="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center shrink-0">
          <ChefHat class="size-4 text-purple-600" />
        </div>
        <div class="bg-white p-4 rounded-2xl rounded-tl-none shadow-sm border border-gray-100 max-w-[85%]">
          <p class="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{{ t.aiWelcome }}</p>
        </div>
      </div>

      <!-- Chat messages -->
      <div v-for="(msg, idx) in chatMessages" :key="idx" class="flex gap-3" :class="msg.role === 'user' ? 'flex-row-reverse' : ''">
        <div 
          v-if="msg.role !== 'user'" 
          class="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center shrink-0"
        >
          <ChefHat class="size-4 text-purple-600" />
        </div>
        <div 
          v-else 
          class="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0"
        >
          <User class="size-4 text-emerald-600" />
        </div>
        
        <div 
          class="max-w-[85%] p-4 rounded-2xl shadow-sm"
          :class="msg.role === 'user' 
            ? 'bg-emerald-600 text-white rounded-tr-none' 
            : 'bg-white border border-gray-100 rounded-tl-none'"
        >
          <!-- Render text with AI add buttons -->
          <div 
            v-if="msg.role !== 'user'" 
            class="text-sm text-gray-700 leading-relaxed prose prose-sm max-w-none"
            v-html="formatMarkdownWithButtons(msg.text)"
            @click="handleContentClick"
          ></div>
          <p v-else class="text-sm leading-relaxed">{{ msg.text }}</p>
        </div>
      </div>

      <!-- AI typing indicator -->
      <div v-if="isAiTyping" class="flex gap-3">
        <div class="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center shrink-0">
          <ChefHat class="size-4 text-purple-600" />
        </div>
        <div class="bg-white p-4 rounded-2xl rounded-tl-none shadow-sm border border-gray-100">
          <div class="flex gap-1">
            <span class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0ms"></span>
            <span class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 150ms"></span>
            <span class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 300ms"></span>
          </div>
        </div>
      </div>
    </div>

    <!-- Input area - FIXED at bottom -->
    <div class="p-4 bg-white border-t border-gray-200 shrink-0 shadow-[0_-4px_10px_-2px_rgba(0,0,0,0.05)] z-30">
      <form @submit.prevent="handleSend" class="relative flex items-center gap-2">
        <input 
          v-model="aiInput" 
          type="text" 
          :placeholder="t.aiPlaceholder" 
          class="w-full bg-gray-100 focus:bg-white rounded-full py-4 pl-5 pr-14 text-sm transition-all theme-ring shadow-inner"
          :disabled="isAiTyping"
        />
        <button 
          type="submit"
          :disabled="!aiInput.trim() || isAiTyping"
          class="absolute right-1.5 size-11 flex items-center justify-center bg-emerald-600 hover:bg-emerald-700 text-white rounded-full transition-all active:scale-95 disabled:opacity-50"
        >
          <Send class="size-4" />
        </button>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick, watch } from 'vue';
import { useSelfOrderI18n } from '../../composables/useSelfOrderI18n.js';
import { useRouter, useRoute } from 'vue-router';
import { ChefHat, User, Send } from 'lucide-vue-next';
import DOMPurify from 'dompurify';
import { useSelfOrderMenu } from '../../composables/useSelfOrderMenu.js';
import { useSelfOrderCart } from '../../composables/useSelfOrderCart.js';
import { chatTranslations, getChatTranslation } from './SelfOrderChatTranslations.js';

const router = useRouter();
const route = useRoute();
const { menu, loadMenu } = useSelfOrderMenu();
const { items: cartItems, addItem } = useSelfOrderCart();

const chatContainer = ref(null);
const chatMessages = ref([]);
const aiInput = ref('');
const isAiTyping = ref(false);


const i18n = {
  it: {
    aiTitle: 'Chef IA Assistant',
    aiSubtitle: 'Consigli & Info',
    aiPlaceholder: 'Chiedi curiosità o consigli...',
    aiWelcome: 'Benvenuto! Sono il tuo Chef virtuale. Posso consigliarti ottimi piatti o darti info sulle nostre preparazioni.',
    aiError: 'Scusa, in questo momento la cucina è molto indaffarata. Riprova tra un istante! 🙏',
    add: 'Aggiungi',
    magicIntro: 'Ecco cosa ti consiglio per questo piatto!',
    infoIntro: 'Ecco le info sul piatto!',
    aiNotConfigured: 'L\'assistente IA non è configurato. Usa le traduzioni esistenti.',
  },
  en: {
    aiTitle: 'AI Chef Assistant',
    aiSubtitle: 'Advice & Info',
    aiPlaceholder: 'Ask for curiosity or tips...',
    aiWelcome: 'Welcome! I\'m your virtual Chef. Ask me to recommend dishes or provide info on our recipes.',
    aiError: 'Sorry, the kitchen is very busy right now. Please try again in a moment! 🙏',
    add: 'Add',
    magicIntro: 'Here\'s what I recommend for this dish!',
    infoIntro: 'Here\'s the info about this dish!',
    aiNotConfigured: 'AI assistant is not configured. Using fallback responses.',
  }
};


// Gemini AI Configuration
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL || 'gemini-2.0-flash';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';
const GEMINI_MAX_RETRIES = 3;
const GEMINI_DELAYS = [1000, 2000, 4000];

const { t, currentLang } = useSelfOrderI18n(i18n);

function getMenu() {
  const menuData = menu.value || {};
  const items = [];
  Object.entries(menuData).forEach(([category, categoryItems]) => {
    categoryItems.forEach(item => {
      items.push({
        id: item.id,
        name: item.name,
        price: item.price || 0,
        categoria: category,
        description: item.description || '',
        ingredients: item.ingredients || '',
        allergens: item.allergens || [],
      });
    });
  });
  return items;
}

function getDish(id) {
  const allItems = getMenu();
  return allItems.find(p => p.id === id) || null;
}

function getItemById(id) {
  const menuData = menu.value || {};
  for (const [category, items] of Object.entries(menuData)) {
    const item = items.find(i => i.id === id);
    if (item) {
      return { ...item, categoria: category };
    }
  }
  return null;
}

function formatMarkdownWithButtons(text) {
  const withButtons = text.replace(/\[ADD:([a-z0-9_]+)\]/gi, (match, id) => {
    const dish = getDish(id);
    if (!dish) return '';
    return `<button type="button" class="ai-add-btn inline font-bold text-purple-600 hover:underline cursor-pointer bg-transparent border-none p-0 m-0 align-baseline" data-id="${id}">${dish.name}<span class="ml-0.5 font-black">+</span></button>`;
  });
  // Sanitize to prevent XSS from AI/menu-injected HTML while keeping our button.
  return DOMPurify.sanitize(withButtons, { ADD_ATTR: ['data-id', 'type'] });
}

function handleContentClick(e) {
  const btn = e.target.closest('.ai-add-btn');
  if (btn) {
    const id = btn.getAttribute('data-id');
    if (id) {
      const dish = getDish(id);
      if (dish) {
        addItem(dish, 1, [], '');
      }
    }
  }
}

function scrollToBottom() {
  nextTick(() => {
    if (chatContainer.value) {
      chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
    }
  });
}

// Handle form submit
function handleSend() {
  sendMessage();
}

async function sendMessage(msg = null) {
  const messageText = msg || aiInput.value;
  if (!messageText.trim() || isAiTyping.value) return;
  
  chatMessages.value.push({ role: 'user', text: messageText });
  aiInput.value = '';
  isAiTyping.value = true;
  scrollToBottom();

  const prefs = getPreferences();
  let prefsStr = '';
  if (prefs.diets.length > 0) prefsStr += `L'utente segue la dieta: ${prefs.diets.join(', ')}. `;
  if (prefs.allergens.length > 0) prefsStr += `L'utente è ALLERGICO A: ${prefs.allergens.join(', ')}. NON PROPORRE MAI PIATTI CHE CONTENGONO QUESTI ALLERGENI. `;

  let responseText = '';
  
  // Try Gemini API first
  if (GEMINI_API_KEY) {
    const menu = getMenu();
    const cart = cartItems.value.map(c => ({ id: c.menuItemId, name: c.name, q: c.quantity }));
    
    const systemPrompt = `Sei l'assistente Chef virtuale del ristorante.
REGOLA 1: Rispondi SEMPRE in lingua: ${currentLang.value.toUpperCase()}.
REGOLA 2: Sii cordiale ma SINTETICO. 
REGOLA 3: ${prefsStr}
REGOLA 4 (CRITICA): È VIETATO FARE ELENCHI TESTUALI DI PIATTI. 
Ogni volta che consiglia un piatto, sostituisci il suo nome con il tag [ADD:id_piatto].
ESEMPIO: "Ti consiglio [ADD:primo_1] oppure [ADD:primo_2]."

Menu (id e nome):
${menu.map(m => `${m.id}: ${m.name}`).join('\n')}

Carrello attuale: ${cart.length === 0 ? 'Vuoto' : cart.map(c => `${c.name} (x${c.q})`).join(', ')}`;

    const userPrompt = messageText;

    try {
      for (let attempt = 0; attempt < GEMINI_MAX_RETRIES; attempt++) {
        try {
          const response = await fetch(
            `${GEMINI_ENDPOINT}${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: userPrompt }] }],
                systemInstruction: { parts: [{ text: systemPrompt }] }
              })
            }
          );
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = await response.json();
          const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (candidateText) {
            responseText = candidateText;
            break;
          }
          // 200 OK but no text (e.g. blocked content) — retry, don't loop forever.
          throw new Error('Empty response');
        } catch (err) {
          if (attempt < GEMINI_MAX_RETRIES - 1) {
            await new Promise(res => setTimeout(res, GEMINI_DELAYS[attempt]));
          } else {
            console.warn('Gemini API failed, using fallback:', err);
            responseText = '';
          }
        }
      }
    } catch (e) {
      console.warn('Gemini API error:', e);
    }
  }

  // Fallback to simulated response if no API key or API failed
  if (!responseText) {
    responseText = generateSimulatedResponse(messageText, prefs);
  }

  chatMessages.value.push({ role: 'model', text: responseText });

  isAiTyping.value = false;
  scrollToBottom();
}

function getPreferences() {
  const savedPrefs = localStorage.getItem('selforder_preferences');
  if (savedPrefs) {
    try {
      const prefs = JSON.parse(savedPrefs);
      const diets = Object.entries(prefs.diet || {})
        .filter(([_, v]) => v)
        .map(([k]) => k);
      const allergens = Object.entries(prefs.allergens || {})
        .filter(([_, v]) => v)
        .map(([k]) => k.replace(/_/g, ' '));
      return { diets, allergens };
    } catch {
      return { diets: [], allergens: [] };
    }
  }
  return { diets: [], allergens: [] };
}

function generateSimulatedResponse(msg, prefs) {
  const lang = currentLang.value || 'it';
  const isEn = lang === 'en';
  const tr = chatTranslations[lang] || chatTranslations['it'];
  const menu = getMenu();
  if (menu.length === 0) {
    return isEn ? 'The menu is not available right now. Please try again later!' : 'Il menu non è disponibile in questo momento. Prova più tardi!';
  }
  
  const lowerMsg = msg.toLowerCase();
  
  // Magic recommendation for a specific item
  if (lowerMsg.includes('consigliato') || lowerMsg.includes('magic') || lowerMsg.includes('chef consiglia')) {
    // Extract item name from message
    const item = menu[Math.floor(Math.random() * menu.length)];
    const pairings = getPairingSuggestions(item, menu, lang);
    return `${tr.greatChoice} ${tr.forItemSuggest} ${pairings}. [ADD:${item.id}]`;
  }
  
  // Info about a specific item
  if (lowerMsg.includes('info') || lowerMsg.includes('dettaglio') || lowerMsg.includes('ingredienti')) {
    const item = menu[Math.floor(Math.random() * menu.length)];
    const desc = item.description || tr.delicious;
    const ingredients = item.ingredients ? `${tr.ingredients} ${item.ingredients}` : '';
    const allergens = item.allergens?.length ? `⚠️ ${tr.allergens} ${item.allergens.map(a => a.replace(/_/g, ' ')).join(', ')}` : '';
    return `${item.name}: ${desc} ${ingredients} ${allergens}`;
  }
  
  // Quick suggestions
  if (lowerMsg.includes('colazione') || lowerMsg.includes('breakfast')) {
    const breakfast = menu.filter(m => {
      const c = (m.category || m.categoria || '').toLowerCase();
      return c.includes('colazione') || c.includes('bevande');
    });
    if (breakfast.length) return `${tr.forBreakfast} ${breakfast[0].name}! [ADD:${breakfast[0].id}]`;
  }
  if (lowerMsg.includes('pranzo') || lowerMsg.includes('lunch')) {
    const firstCourse = menu.filter(m => (m.category || m.categoria) === 'Primi Piatti');
    if (firstCourse.length) return `${tr.forLunch} ${firstCourse[0].name}? [ADD:${firstCourse[0].id}]`;
  }
  if (lowerMsg.includes('cena') || lowerMsg.includes('dinner')) {
    const secondCourse = menu.filter(m => (m.category || m.categoria) === 'Secondi Piatti');
    if (secondCourse.length) return `${tr.forDinner} ${secondCourse[0].name}. [ADD:${secondCourse[0].id}]`;
  }
  if (lowerMsg.includes('vegano') || lowerMsg.includes('vegan')) {
    const veganItems = menu.filter(m => m.description?.toLowerCase().includes('vegano') || m.name?.toLowerCase().includes('vegano'));
    if (veganItems.length) return `${tr.veganOptions}: ${veganItems[0].name}. [ADD:${veganItems[0].id}]`;
  }
  if (lowerMsg.includes('vegetariano') || lowerMsg.includes('vegetarian')) {
    const vegetarianItems = menu.filter(m => m.description?.toLowerCase().includes('vegetariano') || m.name?.toLowerCase().includes('vegetariano'));
    if (vegetarianItems.length) return isEn ? `Here are our vegetarian options: ${vegetarianItems[0].name}. [ADD:${vegetarianItems[0].id}]` : `Ecco le opzioni vegetariane: ${vegetarianItems[0].name}. [ADD:${vegetarianItems[0].id}]`;
  }
  
  // Cart completion advice
  if (lowerMsg.includes('consiglio') || lowerMsg.includes('completa') || lowerMsg.includes('cosa manca')) {
    if (cartItems.value.length === 0) {
      return tr.emptyCart;
    }
    const suggestions = getCartSuggestions();
    if (suggestions.length) {
      return `${tr.toCompleteOrder}: ${suggestions[0].name}. [ADD:${suggestions[0].id}]`;
    }
    return tr.cartComplete;
  }
  
  // Generic suggestions
  const randomItem = menu[Math.floor(Math.random() * menu.length)];
  if (lowerMsg.includes('consiglia') || lowerMsg.includes('suggerisci') || lowerMsg.includes('cosa') || lowerMsg.includes('prenderei')) {
    return `${tr.greatIdea} ${tr.recommend} ${randomItem.name}. [ADD:${randomItem.id}]`;
  }
  
  if (lowerMsg.includes('allerg') || lowerMsg.includes('intolleran')) {
    const allergenList = prefs.allergens.map(a => a.replace(/_/g, ' ')).join(', ');
    return isEn 
      ? `I understand! I'll keep your allergies (${allergenList}) in mind. Would you like me to suggest safe dishes?`
      : `Capisco! Terrò conto delle tue allergie (${allergenList}). Vuoi che ti suggerisca piatti sicuri per te?`;
  }
  
  const responses = [
    `${tr.greatChoice} ${tr.recommend} ${randomItem.name}. [ADD:${randomItem.id}] ${tr.enjoyMeal}`,
    `${tr.howAbout} ${randomItem.name}? [ADD:${randomItem.id}] ${tr.itsDelicious}`,
    `${tr.suggestItem} ${randomItem.name}. [ADD:${randomItem.id}] ${tr.enjoyMeal}`,
  ];
  
  return responses[Math.floor(Math.random() * responses.length)];
}

function getPairingSuggestions(item, menu, lang = 'it') {
  const isEn = lang === 'en';
  const tr = chatTranslations[lang] || chatTranslations['it'];
  // getAllItems() exposes the category under the `category` key (the menu's
  // category name); fall back to `categoria` for raw menu items.
  const category = item.category || item.categoria;

  if (category === 'Primi Piatti') {
    const secondCourse = menu.find(m => (m.category || m.categoria) === 'Secondi Piatti');
    const sideDish = menu.find(m => (m.category || m.categoria) === 'Contorni');
    const suggestions = [];
    if (secondCourse) suggestions.push(secondCourse.name);
    if (sideDish) suggestions.push(sideDish.name);
    const result = suggestions.slice(0, 2).join(isEn ? ' or ' : ' oppure ') || tr.somethingFresh;
    return `${tr.pairWith} ${result}`;
  }
  if (category === 'Secondi Piatti' || category === 'Carne' || category === 'Pesce') {
    const sideDish = menu.find(m => (m.category || m.categoria) === 'Contorni');
    const beverage = menu.find(m => (m.category || m.categoria) === 'Bevande');
    const suggestions = [];
    if (sideDish) suggestions.push(sideDish.name);
    if (beverage) suggestions.push(beverage.name);
    const result = suggestions.slice(0, 2).join(isEn ? ' and ' : ' e ') || (isEn ? 'a side dish' : 'un contorno');
    return isEn ? `perfect with ${result}` : `perfetto con ${result}`;
  }
  if (category === 'Bevande') {
    return tr.anyDish;
  }
  return tr.somethingFresh;
}

function getCartSuggestions() {
  const menu = getMenu();
  const cartIds = new Set(cartItems.value.map(c => c.menuItemId));
  const suggestions = [];
  const cat = (item) => item?.category || item?.categoria;

  // Check what's missing
  const hasFirstCourse = cartItems.value.some(c => cat(getItemById(c.menuItemId)) === 'Primi Piatti');
  const hasSecondCourse = cartItems.value.some(c => cat(getItemById(c.menuItemId)) === 'Secondi Piatti');
  const hasBeverage = cartItems.value.some(c => cat(getItemById(c.menuItemId)) === 'Bevande');

  if (!hasBeverage) {
    const beverage = menu.find(m => cat(m) === 'Bevande' && !cartIds.has(m.id));
    if (beverage) suggestions.push(beverage);
  }
  if ((hasFirstCourse || hasSecondCourse) && !cartIds.has('dolce')) {
    const dessert = menu.find(m => cat(m) === 'Dolci' && !cartIds.has(m.id));
    if (dessert) suggestions.push(dessert);
  }

  return suggestions;
}

// Handle query params for magic/info/quick actions (covers both initial load
// and subsequent in-app navigations). A single source of truth avoids the
// duplicate-send that happened when both onMounted and this watcher ran.
watch(() => route.query, (query) => {
  handleActionQuery(query, false);
}, { immediate: true });

onMounted(async () => {
  // Ensure menu is loaded for the chat to reference items.
  await loadMenu();
});

function handleActionQuery(query, deferred) {
  if (query.action === 'magic' && query.item) {
    const item = getItemById(query.item);
    if (item) {
      const text = `Chef, per ${item.name} cosa consiglia di abbinare?`;
      deferred ? setTimeout(() => sendMessage(text), 500) : sendMessage(text);
    }
  } else if (query.action === 'info' && query.item) {
    const item = getItemById(query.item);
    if (item) {
      const text = `Chef, info su ${item.name}?`;
      deferred ? setTimeout(() => sendMessage(text), 500) : sendMessage(text);
    }
  } else if (query.action === 'quick' && query.suggestion) {
    const suggestionMap = {
      colazione: 'cosa consiglia per colazione',
      pranzo: 'cosa consiglia per pranzo',
      cena: 'cosa consiglia per cena',
      vegano: 'opzioni vegane',
      veggie: 'opzioni vegetariane'
    };
    const prompt = suggestionMap[query.suggestion] || 'cosa consiglia di buono';
    const text = `Chef, ${prompt}?`;
    deferred ? setTimeout(() => sendMessage(text), 500) : sendMessage(text);
  }
}
</script>
