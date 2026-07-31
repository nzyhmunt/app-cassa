<template>
  <div class="flex flex-col h-full bg-gray-50">
    <!-- Header -->
    <div class="bg-gradient-to-r from-purple-600 to-purple-700 text-white p-4">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
          <ChefHat class="size-6" />
        </div>
        <div>
          <h2 class="font-bold text-lg leading-tight">{{ t.aiTitolo }}</h2>
          <p class="text-white/80 text-xs">{{ t.aiSottotitolo }}</p>
        </div>
      </div>
    </div>

    <!-- Chat messages -->
    <div ref="chatContainer" class="flex-1 overflow-y-auto p-4 space-y-4 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPjxyZWN0IHdpZHRoPSI4IiBoZWlnaHQ9IjgiIGZpbGw9IiNmOGZhZmMiLz48Y2lyY2xlIGN4PSI0IiBjeT0iNCIgcj0iMSIgZmlsbD0iI2UxZTVlOSIvPjwvc3ZnPg==')]">
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

    <!-- Input area -->
    <div class="p-4 bg-white border-t border-gray-200 shrink-0 shadow-[0_-4px_10px_-2px_rgba(0,0,0,0.05)]">
      <form @submit.prevent="sendMessage" class="relative flex items-center gap-2">
        <input 
          v-model="aiInput" 
          type="text" 
          :placeholder="t.aiPlaceholder" 
          class="flex-1 bg-gray-100 focus:bg-white rounded-full py-4 pl-5 pr-14 text-sm transition-all ring-2 ring-emerald-200 focus:ring-emerald-400 focus:outline-none shadow-inner"
          :disabled="isAiTyping"
        />
        <button 
          type="submit" 
          :disabled="!aiInput.trim() || isAiTyping"
          class="absolute right-1.5 size-11 flex items-center justify-center bg-emerald-600 hover:bg-emerald-700 text-white rounded-full transition-all active:scale-95 disabled:opacity-50"
        >
          <Send class="size-5" />
        </button>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick, computed } from 'vue';
import { useRouter } from 'vue-router';
import { ChefHat, User, Send } from 'lucide-vue-next';
import { useConfigStore } from '../../store/index.js';
import { useSelfOrderCart } from '../../composables/useSelfOrderCart.js';

const router = useRouter();
const configStore = useConfigStore();
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
  },
  en: {
    aiTitolo: 'AI Chef Assistant',
    aiSottotitolo: 'Advice & Info',
    aiPlaceholder: 'Ask for curiosity or tips...',
    aiWelcome: 'Welcome! I\'m your virtual Chef. Ask me to recommend dishes or provide info on our recipes.',
    aiError: 'Sorry, the kitchen is very busy right now. Please try again in a moment! 🙏',
    aggiungi: 'Add',
  }
};

const t = computed(() => i18n[currentLang.value] || i18n.it);

function getMenu() {
  const menu = configStore.menu || {};
  const items = [];
  Object.entries(menu).forEach(([category, categoryItems]) => {
    categoryItems.forEach(item => {
      items.push({
        id: item.id,
        nome: item.name,
        prezzo: item.price || 0,
        categoria: category,
        descrizione: item.description || '',
        ingredienti: item.ingredients || '',
        allergeni: item.allergens || [],
      });
    });
  });
  return items;
}

function getPiatto(id) {
  const menu = getMenu();
  return menu.find(p => p.id === id) || null;
}

function formatMarkdownWithButtons(text) {
  // Convert [ADD:id] tags to clickable buttons
  return text.replace(/\[ADD:([a-z0-9_]+)\]/gi, (match, id) => {
    const piatto = getPiatto(id);
    if (!piatto) return '';
    return `<button type="button" class="ai-add-btn inline font-bold text-purple-600 hover:underline cursor-pointer bg-transparent border-none p-0 m-0 align-baseline" data-id="${id}">${piatto.nome}<span class="ml-0.5 font-black">+</span></button>`;
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

async function sendMessage() {
  if (!aiInput.value.trim() || isAiTyping.value) return;
  
  const msg = aiInput.value;
  chatMessages.value.push({ role: 'user', text: msg });
  aiInput.value = '';
  isAiTyping.value = true;
  scrollToBottom();

  // Build system prompt with preferences
  const prefs = getPreferences();
  let prefsStr = '';
  if (prefs.diete.length > 0) prefsStr += `L'utente segue la dieta: ${prefs.diete.join(', ')}. `;
  if (prefs.allergeni.length > 0) prefsStr += `L'utente è ALLERGICO A: ${prefs.allergeni.join(', ')}. NON PROPORRE MAI PIATTI CHE CONTENGONO QUESTI ALLERGENI. `;

  const systemPrompt = `Sei l'assistente Chef virtuale del ristorante.
REGOLA 1: Rispondi SEMPRE in lingua: ${currentLang.value.toUpperCase()}.
REGOLA 2: Sii cordiale ma estremamente SINTETICO. 
REGOLA 3: ${prefsStr}
REGOLA 4 (CRITICA): È VIETATO FARE ELENCHI TESTUALI O PUNTATI DI PIATTI. 
Ogni volta che consiglia un piatto, usa il tag [ADD:id_piatto] IN LINEA col testo.
ESEMPIO: "Ottima scelta! Per accompagnarlo ti consiglio [ADD:con_2] oppure [ADD:con_1]."

Menu: ${JSON.stringify(getMenu())}
Carrello: ${cartItems.value.length === 0 ? 'Vuoto' : JSON.stringify(cartItems.value.map(c => ({id: c.menuItemId, nome: c.name, q: c.quantity})))}`;

  try {
    // Simulate AI response (in production, connect to real AI)
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const responseText = generateSimulatedResponse(msg, prefs);
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
  
  const randomItem = menu[Math.floor(Math.random() * menu.length)];
  
  // Simple response based on keywords
  const lowerMsg = msg.toLowerCase();
  
  if (lowerMsg.includes('consiglia') || lowerMsg.includes('suggerisci') || lowerMsg.includes('cosa') || lowerMsg.includes('cosa posso')) {
    return `Che buona scelta! Ti consiglio di provare ${randomItem.nome} - ${randomItem.descrizione || 'Un piatto delizioso della nostra cucina.'} [ADD:${randomItem.id}]`;
  }
  
  if (lowerMsg.includes('vegetariano') || lowerMsg.includes('vegano')) {
    const filteredMenu = menu.filter(item => 
      item.descrizione?.toLowerCase().includes('vegetariano') || 
      item.descrizione?.toLowerCase().includes('vegano') ||
      item.categoria?.toLowerCase().includes('vegetariano')
    );
    if (filteredMenu.length > 0) {
      const item = filteredMenu[0];
      return `Certo! Per te ho selezionato ${item.nome}. [ADD:${item.id}]`;
    }
    return 'Al momento non abbiamo opzioni specifiche per diete vegetariane o vegane, ma posso consigliarti altri piatti!';
  }
  
  if (lowerMsg.includes('allerg') || lowerMsg.includes('intolleran')) {
    return `Capisco! Terrò conto delle tue allergie (${prefs.allergeni.join(', ')}). Vuoi che ti suggerisca piatti sicuri per te?`;
  }
  
  if (lowerMsg.includes('info') || lowerMsg.includes('dettaglio')) {
    return `${randomItem.nome} è uno dei nostri piatti più amati. ${randomItem.descrizione || 'Preparato con ingredienti freschi e di qualità.'} ${randomItem.ingredienti ? 'Ingredienti: ' + randomItem.ingredienti : ''}`;
  }
  
  return `Interessante! Per accompagnare al meglio il tuo pasto, ti suggerisco ${randomItem.nome}. [ADD:${randomItem.id}] Buon appetito!`;
}
</script>
