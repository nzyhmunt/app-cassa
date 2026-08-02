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
import { ref, onMounted, nextTick, computed, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ChefHat, User, Send } from 'lucide-vue-next';
import { useSelfOrderMenu } from '../../composables/useSelfOrderMenu.js';
import { useSelfOrderCart } from '../../composables/useSelfOrderCart.js';

const router = useRouter();
const route = useRoute();
const { menu, loadMenu } = useSelfOrderMenu();
const { items: cartItems, addItem } = useSelfOrderCart();

const chatContainer = ref(null);
const chatMessages = ref([]);
const aiInput = ref('');
const isAiTyping = ref(false);

const currentLang = ref(localStorage.getItem('selforder_lang') || 'it');

const i18n = {
  it: {
    aiTitolo: 'Chef IA Assistant',
    aiSottotitolo: 'Consigli & Info',
    aiPlaceholder: 'Chiedi curiosità o consigli...',
    aiWelcome: 'Benvenuto! Sono il tuo Chef virtuale. Posso consigliarti ottimi piatti o darti info sulle nostre preparazioni.',
    aiError: 'Scusa, in questo momento la cucina è molto indaffarata. Riprova tra un istante! 🙏',
    aggiungi: 'Aggiungi',
    magicIntro: 'Ecco cosa ti consiglio per questo piatto!',
    infoIntro: 'Ecco le info sul piatto!',
  },
  en: {
    aiTitolo: 'AI Chef Assistant',
    aiSottotitolo: 'Advice & Info',
    aiPlaceholder: 'Ask for curiosity or tips...',
    aiWelcome: 'Welcome! I\'m your virtual Chef. Ask me to recommend dishes or provide info on our recipes.',
    aiError: 'Sorry, the kitchen is very busy right now. Please try again in a moment! 🙏',
    aggiungi: 'Add',
    magicIntro: 'Here\'s what I recommend for this dish!',
    infoIntro: 'Here\'s the info about this dish!',
  }
};

const t = computed(() => i18n[currentLang.value] || i18n.it);

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

function getPiatto(id) {
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
  return text.replace(/\[ADD:([a-z0-9_]+)\]/gi, (match, id) => {
    const piatto = getPiatto(id);
    if (!piatto) return '';
    return `<button type="button" class="ai-add-btn inline font-bold text-purple-600 hover:underline cursor-pointer bg-transparent border-none p-0 m-0 align-baseline" data-id="${id}">${piatto.name}<span class="ml-0.5 font-black">+</span></button>`;
  });
}

function handleContentClick(e) {
  const btn = e.target.closest('.ai-add-btn');
  if (btn) {
    const id = btn.getAttribute('data-id');
    if (id) {
      const piatto = getPiatto(id);
      if (piatto) {
        addItem(piatto, 1, [], '');
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
  if (prefs.diete.length > 0) prefsStr += `L'utente segue la dieta: ${prefs.diete.join(', ')}. `;
  if (prefs.allergeni.length > 0) prefsStr += `L'utente è ALLERGICO A: ${prefs.allergeni.join(', ')}. NON PROPORRE MAI PIATTI CHE CONTENGONO QUESTI ALLERGENI. `;

  try {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const responseText = generateSimulatedResponse(messageText, prefs);
    chatMessages.value.push({ role: 'model', text: responseText });
  } catch (e) {
    chatMessages.value.push({ role: 'model', text: t.value.aiError });
  }

  isAiTyping.value = false;
  scrollToBottom();
}

function getPreferences() {
  const savedPrefs = localStorage.getItem('selforder_preferences');
  if (savedPrefs) {
    try {
      const prefs = JSON.parse(savedPrefs);
      const diete = Object.entries(prefs.diet || {})
        .filter(([_, v]) => v)
        .map(([k]) => k);
      const allergeni = Object.entries(prefs.allergens || {})
        .filter(([_, v]) => v)
        .map(([k]) => k.replace(/_/g, ' '));
      return { diete, allergeni };
    } catch {
      return { diete: [], allergeni: [] };
    }
  }
  return { diete: [], allergeni: [] };
}

function generateSimulatedResponse(msg, prefs) {
  const menu = getMenu();
  if (menu.length === 0) {
    return 'Il menu non è disponibile in questo momento. Prova più tardi!';
  }
  
  const lowerMsg = msg.toLowerCase();
  
  // Magic recommendation for a specific item
  if (lowerMsg.includes('consigliato') || lowerMsg.includes('magic') || lowerMsg.includes('chef consiglia')) {
    // Extract item name from message
    const item = menu[Math.floor(Math.random() * menu.length)];
    const pairings = getPairingSuggestions(item, menu);
    return `${t.value.magicIntro} Per ${item.nome}, ti suggerisco di provare ${pairings}. [ADD:${item.id}]`;
  }
  
  // Info about a specific item
  if (lowerMsg.includes('info') || lowerMsg.includes('dettaglio') || lowerMsg.includes('ingredienti')) {
    const item = menu[Math.floor(Math.random() * menu.length)];
    return `${item.nome}: ${item.descrizione || 'Un piatto delizioso.'} ${item.ingredienti ? 'Ingredienti: ' + item.ingredienti : ''} ${item.allergeni?.length ? '⚠️ Allergeni: ' + item.allergeni.join(', ') : ''}`;
  }
  
  // Quick suggestions
  if (lowerMsg.includes('colazione') || lowerMsg.includes('breakfast')) {
    const breakfast = menu.filter(m => m.categoria?.toLowerCase().includes('colazione') || m.categoria?.toLowerCase().includes('bevande'));
    if (breakfast.length) return `Per la colazione ti consiglio ${breakfast[0].nome}! [ADD:${breakfast[0].id}]`;
  }
  if (lowerMsg.includes('pranzo') || lowerMsg.includes('lunch')) {
    const primo = menu.filter(m => m.categoria === 'Primi Piatti');
    if (primo.length) return `Per pranzo, un bel ${primo[0].nome}? [ADD:${primo[0].id}]`;
  }
  if (lowerMsg.includes('cena') || lowerMsg.includes('dinner')) {
    const secondo = menu.filter(m => m.categoria === 'Secondi Piatti');
    if (secondo.length) return `Per cena, ti consiglio ${secondo[0].nome}. [ADD:${secondo[0].id}]`;
  }
  if (lowerMsg.includes('vegano') || lowerMsg.includes('vegan')) {
    const vegano = menu.filter(m => m.descrizione?.toLowerCase().includes('vegano') || m.nome?.toLowerCase().includes('vegano'));
    if (vegano.length) return `Ecco le opzioni vegane: ${vegano[0].nome}. [ADD:${vegano[0].id}]`;
  }
  if (lowerMsg.includes('vegetariano') || lowerMsg.includes('vegetarian')) {
    const veggie = menu.filter(m => m.descrizione?.toLowerCase().includes('vegetariano') || m.nome?.toLowerCase().includes('vegetariano'));
    if (veggie.length) return `Ecco le opzioni vegetariane: ${veggie[0].nome}. [ADD:${veggie[0].id}]`;
  }
  
  // Cart completion advice
  if (lowerMsg.includes('consiglio') || lowerMsg.includes('completa') || lowerMsg.includes('cosa manca')) {
    if (cartItems.value.length === 0) {
      return 'Il tuo carrello è vuoto! Inizia aggiungendo qualcosa dal menu.';
    }
    const suggestions = getCartSuggestions();
    if (suggestions.length) {
      return `Per completare il tuo ordine, ti suggerisco: ${suggestions[0].nome}. [ADD:${suggestions[0].id}]`;
    }
    return 'Il tuo carrello sembra completo! 🎉';
  }
  
  // Generic suggestions
  const randomItem = menu[Math.floor(Math.random() * menu.length)];
  if (lowerMsg.includes('consiglia') || lowerMsg.includes('suggerisci') || lowerMsg.includes('cosa') || lowerMsg.includes('prenderei')) {
    return `Che buona scelta! Ti consiglio ${randomItem.nome}. [ADD:${randomItem.id}]`;
  }
  
  if (lowerMsg.includes('allerg') || lowerMsg.includes('intolleran')) {
    return `Capisco! Terrò conto delle tue allergie (${prefs.allergeni.join(', ')}). Vuoi che ti suggerisca piatti sicuri per te?`;
  }
  
  return `Ottima idea! Ti suggerisco ${randomItem.nome}. [ADD:${randomItem.id}] Buon appetito!`;
}

function getPairingSuggestions(item, menu) {
  const category = item.categoria;
  
  if (category === 'Primi Piatti') {
    const secondo = menu.find(m => m.categoria === 'Secondi Piatti');
    const contorno = menu.find(m => m.categoria === 'Contorni');
    const suggestions = [];
    if (secondo) suggestions.push(secondo.nome);
    if (contorno) suggestions.push(contorno.nome);
    return suggestions.slice(0, 2).join(' oppure ') || 'qualcosa di fresco';
  }
  if (category === 'Secondi Piatti') {
    const contorno = menu.find(m => m.categoria === 'Contorni');
    const bevanda = menu.find(m => m.categoria === 'Bevande');
    const suggestions = [];
    if (contorno) suggestions.push(contorno.nome);
    if (bevanda) suggestions.push(bevanda.nome);
    return suggestions.slice(0, 2).join(' e ') || 'un contorno';
  }
  if (category === 'Bevande') {
    return 'lo accompagna perfettamente con qualsiasi piatto del nostro menu';
  }
  return 'qualcosa di fresco dal nostro menu';
}

function getCartSuggestions() {
  const menu = getMenu();
  const cartIds = new Set(cartItems.value.map(c => c.menuItemId));
  const suggestions = [];
  
  // Check what's missing
  const hasPrimo = cartItems.value.some(c => {
    const item = getItemById(c.menuItemId);
    return item?.categoria === 'Primi Piatti';
  });
  const hasSecondo = cartItems.value.some(c => {
    const item = getItemById(c.menuItemId);
    return item?.categoria === 'Secondi Piatti';
  });
  const hasBevanda = cartItems.value.some(c => {
    const item = getItemById(c.menuItemId);
    return item?.categoria === 'Bevande';
  });
  
  if (!hasBevanda) {
    const bevanda = menu.find(m => m.categoria === 'Bevande' && !cartIds.has(m.id));
    if (bevanda) suggestions.push(bevanda);
  }
  if ((hasPrimo || hasSecondo) && !cartIds.has('dolce')) {
    const dolce = menu.find(m => m.categoria === 'Dolci' && !cartIds.has(m.id));
    if (dolce) suggestions.push(dolce);
  }
  
  return suggestions;
}

// Handle query params for magic/info/quick actions
watch(() => route.query, (query) => {
  if (query.action === 'magic' && query.item) {
    const item = getItemById(query.item);
    if (item) {
      sendMessage(`Chef, per ${item.name} cosa consiglia di abbinare?`);
    }
  } else if (query.action === 'info' && query.item) {
    const item = getItemById(query.item);
    if (item) {
      sendMessage(`Chef, info su ${item.name}?`);
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
    sendMessage(`Chef, ${prompt}?`);
  }
}, { immediate: true });

onMounted(async () => {
  // Check for query params on mount
  // Ensure menu is loaded
  await loadMenu();
  const query = route.query;
  if (query.action === 'magic' && query.item) {
    const item = getItemById(query.item);
    if (item) {
      setTimeout(() => sendMessage(`Chef, per ${item.name} cosa consiglia di abbinare?`), 500);
    }
  } else if (query.action === 'info' && query.item) {
    const item = getItemById(query.item);
    if (item) {
      setTimeout(() => sendMessage(`Chef, info su ${item.name}?`), 500);
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
    setTimeout(() => sendMessage(`Chef, ${prompt}?`), 500);
  }
});
</script>
