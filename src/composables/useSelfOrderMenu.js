import { ref } from 'vue';
import { useConfigStore } from '../store/index.js';

/**
 * Self-Order Menu Loader
 * 
 * Loads menu from a static public URL (no authentication required)
 * Menu structure matches cassa/sala (nanawork.it/menu.json):
 * {
 *   "Antipasti": [
 *     {
 *       "id": "ant_1",
 *       "name": "Bruschetta al pomodoro",
 *       "price": 3,
 *       "descrizione": "Tomato bruschetta, basil and olive oil",
 *       "note": "Vegano",
 *       "ingredienti": ["Pane", "Pomodoro", "Basilico"],
 *       "allergeni": ["glutine"],
 *       "immagine_url": "https://..."
 *     }
 *   ],
 *   "Primi Piatti": [...],
 *   ...
 * }
 */

const MENU_CACHE_KEY = 'selforder_menu_cache';
const MENU_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Shared state across all composable instances
const menu = ref({});
const categories = ref([]);
const loading = ref(false);

export function useSelfOrderMenu() {
  /**
   * Load menu from static URL
   * Falls back to demo menu if no URL configured
   */
  async function loadMenu(menuUrl = null) {
    loading.value = true;

    try {
      // Check cache first
      const cached = getCachedMenu();
      if (cached) {
        menu.value = cached.menu;
        categories.value = cached.categories;
        return cached.menu;
      }

      // Determine URL
      const url = menuUrl || getMenuUrl();

      if (!url) {
        // Use demo menu
        const demoMenu = getDemoMenu();
        setMenu(demoMenu);
        return demoMenu;
      }

      // Fetch from static URL
      const response = await fetch(url, {
        cache: 'default', // Let browser handle caching
      });

      if (!response.ok) {
        throw new Error(`Menu load failed: ${response.status}`);
      }

      const data = await response.json();
      setMenu(data);

      return data;
    } catch (e) {
      console.error('[SelfOrderMenu] Load failed:', e);

      // Fallback to demo menu
      const demoMenu = getDemoMenu();
      setMenu(demoMenu);
      return demoMenu;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Get menu URL from config or use default
   * Default: nanawork.it/menu.json (same as cassa/sala)
   */
  function getMenuUrl() {
    const configStore = useConfigStore();
    return configStore.config?.selfOrder?.menuUrl || 'https://nanawork.it/menu.json';
  }

  /**
   * Set menu data and cache it
   * Handles both flat format (nanawork) and wrapped format
   */
  function setMenu(data) {
    let normalizedMenu = {};
    let cats = [];

    // Detect the menu shape robustly instead of hard-coding a few category
    // names. The previous check (data.Antipasti || data['Primi Piatti'] ||
    // data['Secondi Piatti']) only recognized the nanawork demo menu: a venue
    // whose top-level categories don't include those exact three keys (e.g. a
    // bar with only Bevande/Dolci/Pinse) would fall through to an empty menu.
    //
    // Wrapped format: { categories: [...], items: { Cat: [...] } }
    // Flat format (nanawork): { "Cat A": [...], "Cat B": [...] } — every
    // top-level value is an array.
    const isWrapped = !!(data && data.categories && data.items);
    const isFlat = !isWrapped && data && typeof data === 'object'
      && Object.keys(data).length > 0
      && Object.values(data).every(v => Array.isArray(v));

    if (isFlat) {
      // Flat format - categories are the keys
      Object.entries(data).forEach(([category, items]) => {
        if (Array.isArray(items)) {
          cats.push(category);
          // Normalize items to have consistent property names
          normalizedMenu[category] = items.map(item => normalizeItem(item));
        }
      });
    } else if (isWrapped) {
      // Wrapped format
      cats = data.categories;
      Object.entries(data.items).forEach(([category, items]) => {
        if (Array.isArray(items)) {
          normalizedMenu[category] = items.map(item => normalizeItem(item));
        }
      });
    }

    menu.value = normalizedMenu;
    categories.value = cats;

    // Cache for offline
    cacheMenu({
      menu: normalizedMenu,
      categories: cats,
      timestamp: Date.now(),
    });
  }

  /**
   * Normalize item fields to match expected interface
   * nanawork uses: descrizione, ingredienti, allergeni, immagine_url
   * We normalize to: description, ingredients, allergens, image
   */
  function normalizeItem(item) {
    return {
      id: item.id,
      name: item.name,
      price: item.price || 0,
      description: item.descrizione || item.description || '',
      note: item.note || '',
      ingredients: Array.isArray(item.ingredienti)
        ? item.ingredienti.join(', ')
        : (item.ingredienti || item.ingredients || ''),
      allergens: item.allergeni || item.allergens || [],
      image: item.immagine_url || item.image || '',
      modifiers: Array.isArray(item.modifiers) ? item.modifiers.map(normalizeModifier) : [],
      available: item.available !== false,
    };
  }

  function normalizeModifier(modifier) {
    return {
      id: modifier.id,
      name: modifier.name,
      price: modifier.price || 0,
    };
  }

  /**
   * Get all items as flat array
   */
  function getAllItems() {
    const items = [];
    Object.entries(menu.value).forEach(([category, categoryItems]) => {
      categoryItems.forEach(item => {
        items.push({ ...item, category });
      });
    });
    return items;
  }

  /**
   * Get item by ID
   */
  function getItemById(id) {
    const items = getAllItems();
    return items.find(item => item.id === id) || null;
  }

  /**
   * Get item price from menu (trusted source)
   * Prices come from menu.json, not from client calculation
   */
  function getItemPrice(itemId) {
    const item = getItemById(itemId);
    return item?.price || 0;
  }

  /**
   * Get modifier price from menu (trusted source)
   */
  function getModifierPrice(modifierId) {
    const allItems = getAllItems();
    for (const item of allItems) {
      if (item.modifiers) {
        const mod = item.modifiers.find(m => m.id === modifierId);
        if (mod) return mod.price || 0;
      }
    }
    return 0;
  }

  /**
   * Calculate cart total from menu prices (NOT from client-side prices)
   * This is the trusted calculation based on menu.json
   */
  function calculateCartTotal(cartItems) {
    let total = 0;
    let itemCount = 0;

    for (const cartItem of cartItems) {
      const itemPrice = getItemPrice(cartItem.menuItemId);
      total += itemPrice * cartItem.quantity;
      itemCount += cartItem.quantity;

      // Add modifier prices — look up from the loaded menu (trusted source),
      // not from cartItem.modifiers[].price which is client-controlled and
      // persisted in localStorage. Fall back to the cart value only when the
      // modifier has no id to resolve against the menu.
      if (cartItem.modifiers) {
        for (const mod of cartItem.modifiers) {
          const modPrice = mod.id != null ? getModifierPrice(mod.id) : (mod.price || 0);
          total += modPrice * cartItem.quantity;
        }
      }
    }

    return { total, itemCount };
  }

  /**
   * Cache menu to sessionStorage
   */
  function cacheMenu(data) {
    try {
      sessionStorage.setItem(MENU_CACHE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('[SelfOrderMenu] Cache failed:', e);
    }
  }

  /**
   * Get cached menu if still valid
   */
  function getCachedMenu() {
    try {
      const cached = sessionStorage.getItem(MENU_CACHE_KEY);
      if (!cached) return null;

      const data = JSON.parse(cached);

      // Check if cache is expired
      if (Date.now() - data.timestamp > MENU_CACHE_TTL) {
        sessionStorage.removeItem(MENU_CACHE_KEY);
        return null;
      }

      return data;
    } catch {
      return null;
    }
  }

  /**
   * Get demo menu for testing (matches nanawork format)
   */
  function getDemoMenu() {
    return {
      'Antipasti': [
        {
          id: 'ant_1',
          name: 'Bruschetta al pomodoro',
          price: 3,
          descrizione: 'Pane croccante con pomodorini freschi, aglio e basilico',
          note: 'Vegano',
          ingredienti: ['Pane', 'Pomodoro', 'Basilico', 'Olio EVO'],
          allergeni: ['glutine'],
          immagine_url: '',
        },
        {
          id: 'ant_2',
          name: 'Caprese',
          price: 8,
          descrizione: 'Pomodoro, mozzarella, basilico e olio EVO',
          note: 'Vegetariano',
          ingredienti: ['Pomodoro', 'Mozzarella', 'Basilico'],
          allergeni: ['lattosio'],
          immagine_url: '',
        },
      ],
      'Primi Piatti': [
        {
          id: 'pri_1',
          name: 'Rigatoni all\'Amatriciana',
          price: 12,
          descrizione: 'Pasta con pomodoro, guanciale e pecorino romano',
          ingredienti: ['Pasta', 'Pomodoro', 'Guanciale', 'Pecorino Romano'],
          allergeni: ['glutine', 'lattosio'],
          immagine_url: '',
        },
        {
          id: 'pri_2',
          name: 'Tonnarelli cacio e pepe',
          price: 10,
          descrizione: 'Pasta con pecorino romano e pepe nero',
          note: 'Vegetariano',
          ingredienti: ['Pasta fresca', 'Pecorino Romano', 'Pepe'],
          allergeni: ['glutine', 'lattosio'],
          immagine_url: '',
        },
      ],
      'Secondi Piatti': [
        {
          id: 'sec_1',
          name: 'Polpette al pomodoro',
          price: 11,
          descrizione: 'Polpette di carne in salsa di pomodoro',
          ingredienti: ['Carne di manzo', 'Pomodoro', 'Pane', 'Uova'],
          allergeni: ['glutine', 'uova'],
          immagine_url: '',
        },
      ],
      'Dolci': [
        {
          id: 'dol_1',
          name: 'Tiramisù',
          price: 6,
          descrizione: 'Dolce al mascarpone e caffè',
          note: 'Vegetariano',
          ingredienti: ['Mascarpone', 'Savoiardi', 'Caffè'],
          allergeni: ['glutine', 'lattosio', 'uova'],
          immagine_url: '',
        },
      ],
      'Bevande': [
        {
          id: 'bev_1',
          name: 'Acqua Naturale 1L',
          price: 2.5,
          descrizione: 'Acqua minerale naturale',
          ingredienti: ['Acqua'],
          allergeni: [],
          immagine_url: '',
        },
        {
          id: 'bev_2',
          name: 'Vino della Casa - Rosso 1L',
          price: 10,
          descrizione: 'Vino rosso della casa',
          ingredienti: ['Uva'],
          allergeni: ['solfiti'],
          immagine_url: '',
        },
      ],
    };
  }

  return {
    menu,
    categories,
    loading,
    loadMenu,
    getItemById,
    getItemPrice,
    getModifierPrice,
    calculateCartTotal,
    getAllItems,
  };
}

