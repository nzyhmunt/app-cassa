/**
 * Self-Order Menu Loader
 * 
 * Loads menu from a static public URL (no authentication required)
 * This allows the menu to be hosted on a CDN or static file server.
 * 
 * Expected URL format: /menu.json or configurable via appConfig
 * 
 * Menu structure:
 * {
 *   "categories": ["Antipasti", "Primi", "Secondi", "Dessert", "Bevande"],
 *   "items": {
 *     "Antipasti": [
 *       {
 *         "id": "ant_1",
 *         "name": "Bruschetta",
 *         "description": "Pomodorini freschi...",
 *         "price": 5.50,
 *         "ingredients": "Pane, pomodori, aglio, basilico",
 *         "allergens": ["glutine"],
 *         "note": "Vegetariano",
 *         "available": true,
 *         "image": "https://..."
 *       }
 *     ]
 *   }
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
   */
  function getMenuUrl() {
    const configStore = useConfigStore();
    return configStore.config?.selfOrder?.menuUrl || '/menu.json';
  }

  /**
   * Set menu data and cache it
   */
  function setMenu(data) {
    // Normalize structure
    let normalizedMenu = {};
    let cats = [];

    if (data.categories && data.items) {
      // New format with categories
      cats = data.categories;
      normalizedMenu = data.items;
    } else {
      // Legacy flat format
      Object.entries(data).forEach(([category, items]) => {
        if (Array.isArray(items)) {
          cats.push(category);
          normalizedMenu[category] = items;
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
   * Get demo menu for testing
   */
  function getDemoMenu() {
    return {
      categories: ['Antipasti', 'Primi', 'Secondi', 'Dessert', 'Bevande'],
      items: {
        'Antipasti': [
          {
            id: 'ant_1',
            name: 'Bruschetta al Pomodoro',
            description: 'Pane croccante con pomodorini freschi, aglio e basilico',
            price: 5.50,
            ingredients: 'Pane, pomodori, aglio, basilico, olio EVO',
            allergens: ['glutine'],
            note: 'Vegetariano',
            available: true,
          },
          {
            id: 'ant_2',
            name: 'Tagliere di Salumi',
            description: 'Selezione di salumi tipici locali',
            price: 12.00,
            ingredients: 'Prosciutto crudo, salame, mortadella',
            allergens: ['glutine', 'lattosio'],
            available: true,
          },
        ],
        'Primi': [
          {
            id: 'pri_1',
            name: 'Carbonara',
            description: 'Pasta fresca con guanciale, pecorino e uovo',
            price: 12.00,
            ingredients: 'Rigatoni, guanciale, pecorino romano, uovo, pepe nero',
            allergens: ['glutine', 'uova', 'lattosio'],
            available: true,
          },
          {
            id: 'pri_2',
            name: 'Cacio e Pepe',
            description: 'Classica pasta romana con pecorino e pepe',
            price: 10.00,
            ingredients: 'Tonnarelli, pecorino romano, pepe nero',
            allergens: ['glutine', 'lattosio'],
            note: 'Vegetariano',
            available: true,
          },
        ],
        'Secondi': [
          {
            id: 'sec_1',
            name: 'Saltimbocca alla Romana',
            description: 'Vitello con prosciutto e salvia',
            price: 16.00,
            ingredients: 'Vitello, prosciutto crudo, salvia, burro, vino bianco',
            allergens: ['glutine', 'lattosio'],
            available: true,
          },
        ],
        'Dessert': [
          {
            id: 'des_1',
            name: 'Tiramisù',
            description: 'Classic Italian dessert with mascarpone and espresso',
            price: 7.00,
            ingredients: 'Mascarpone, savoiardi, caffè, uova, zucchero, cacao',
            allergens: ['glutine', 'uova', 'lattosio'],
            note: 'Vegetariano',
            available: true,
          },
        ],
        'Bevande': [
          {
            id: 'bev_1',
            name: 'Acqua Minerale',
            description: 'Acqua naturale o frizzante',
            price: 3.00,
            available: true,
          },
          {
            id: 'bev_2',
            name: 'Vino della Casa',
            description: 'Calice di vino rosso locale',
            price: 5.00,
            ingredients: 'Uve autoctone',
            allergens: ['solfiti'],
            available: true,
          },
        ],
      },
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
