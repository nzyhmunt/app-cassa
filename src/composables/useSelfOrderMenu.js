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

export function useSelfOrderMenu() {
  const menu = ref({});
  const categories = ref([]);
  const loading = ref(false);
  const error = ref(null);
  const lastFetch = ref(null);

  /**
   * Load menu from static URL
   * Falls back to demo menu if no URL configured
   */
  async function loadMenu(menuUrl = null) {
    loading.value = true;
    error.value = null;

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
      error.value = e.message;
      
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

    // Check if data is already in flat format (nanawork format)
    // Flat format: { "Antipasti": [...], "Primi Piatti": [...] }
    // Wrapped format: { categories: [...], items: {...} }
    const isFlatFormat = data.Antipasti || data['Primi Piatti'] || data['Secondi Piatti'];
    
    if (isFlatFormat) {
      // Flat format - categories are the keys
      Object.entries(data).forEach(([category, items]) => {
        if (Array.isArray(items)) {
          cats.push(category);
          // Normalize items to have consistent property names
          normalizedMenu[category] = items.map(item => normalizeItem(item));
        }
      });
    } else if (data.categories && data.items) {
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
      available: item.available !== false,
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

      // Add modifier prices
      if (cartItem.modifiers) {
        for (const mod of cartItem.modifiers) {
          total += (mod.price || 0) * cartItem.quantity;
        }
      }
    }

    return { total, itemCount };
  }

  /**
   * Get item with verified price from menu
   */
  function getItemWithVerifiedPrice(cartItem) {
    const menuItem = getItemById(cartItem.menuItemId);
    if (!menuItem) return null;

    return {
      ...menuItem,
      verifiedPrice: menuItem.price, // Price from menu, not from cart
    };
  }

  /**
   * Get items by category
   */
  function getItemsByCategory(category) {
    return menu.value[category] || [];
  }

  /**
   * Filter available items only
   */
  function getAvailableItems() {
    const available = [];
    Object.entries(menu.value).forEach(([category, items]) => {
      items.forEach(item => {
        if (item.available !== false) {
          available.push({ ...item, category });
        }
      });
    });
    return available;
  }

  /**
   * Filter items by allergens (exclude items containing allergens)
   */
  function filterByAllergens(items, excludeAllergens) {
    if (!excludeAllergens || excludeAllergens.length === 0) {
      return items;
    }

    return items.filter(item => {
      const itemAllergens = item.allergens || [];
      return !excludeAllergens.some(allergen => 
        itemAllergens.includes(allergen)
      );
    });
  }

  /**
   * Search items by name/description
   */
  function searchItems(query) {
    if (!query || query.trim().length < 2) {
      return getAllItems();
    }

    const q = query.toLowerCase();
    return getAllItems().filter(item => 
      item.name?.toLowerCase().includes(q) ||
      item.description?.toLowerCase().includes(q)
    );
  }

  /**
   * Cache menu to sessionStorage
   */
  function cacheMenu(data) {
    try {
      sessionStorage.setItem(MENU_CACHE_KEY, JSON.stringify(data));
      lastFetch.value = Date.now();
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
   * Clear menu cache
   */
  function clearCache() {
    sessionStorage.removeItem(MENU_CACHE_KEY);
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
    error,
    lastFetch,
    loadMenu,
    getItemById,
    getItemPrice,
    getModifierPrice,
    calculateCartTotal,
    getItemWithVerifiedPrice,
    getItemsByCategory,
    getAllItems,
    getAvailableItems,
    filterByAllergens,
    searchItems,
    clearCache,
  };
}

import { ref } from 'vue';
import { useConfigStore } from '../store/index.js';
