import { ref, computed } from 'vue';

export function useSelfOrderCart() {
  const items = ref([]);
  const submittedOrderId = ref(null);

  const totalItems = computed(() => 
    items.value.reduce((sum, item) => sum + item.quantity, 0)
  );

  const totalPrice = computed(() =>
    items.value.reduce((sum, item) => {
      const itemPrice = item.price * item.quantity;
      const modifiersPrice = item.modifiers?.reduce((mSum, m) => mSum + (m.price || 0) * item.quantity, 0) || 0;
      return sum + itemPrice + modifiersPrice;
    }, 0)
  );

  function addItem(menuItem, quantity = 1, modifiers = [], notes = '') {
    const existingIndex = items.value.findIndex(
      item => item.menuItemId === menuItem.id && 
              JSON.stringify(item.modifiers) === JSON.stringify(modifiers) &&
              item.notes === notes
    );

    if (existingIndex >= 0) {
      items.value[existingIndex].quantity += quantity;
    } else {
      items.value.push({
        id: `sci_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        menuItemId: menuItem.id,
        name: menuItem.name,
        price: menuItem.price || 0,
        quantity,
        modifiers,
        notes,
      });
    }
    
    saveCart();
  }

  function removeItem(itemId) {
    const index = items.value.findIndex(item => item.id === itemId);
    if (index >= 0) {
      if (items.value[index].quantity > 1) {
        items.value[index].quantity -= 1;
      } else {
        items.value.splice(index, 1);
      }
    }
    saveCart();
  }

  function updateQuantity(itemId, quantity) {
    const item = items.value.find(item => item.id === itemId);
    if (item) {
      if (quantity <= 0) {
        removeItem(itemId);
      } else {
        item.quantity = quantity;
        saveCart();
      }
    }
  }

  function clearCart() {
    items.value = [];
    saveCart();
  }

  function saveCart() {
    localStorage.setItem('selforder_cart', JSON.stringify(items.value));
  }

  function restoreCart() {
    const saved = localStorage.getItem('selforder_cart');
    if (saved) {
      try {
        items.value = JSON.parse(saved);
      } catch {
        localStorage.removeItem('selforder_cart');
      }
    }
  }

  /**
   * Build order payload (SECURITY: no prices sent)
   * Prices will be calculated by cassa/sala from menu.json
   */
  function buildOrderPayload(sessionId) {
    return {
      bill_session: sessionId,
      status: 'pending',
      items: items.value.map(item => ({
        dish: item.menuItemId, // FK to menu_items - price from menu.json
        name: item.name, // Snapshot for reference only
        quantity: item.quantity,
        notes: item.notes || null,
        modifiers: item.modifiers?.map(m => m.name) || [], // Names only, prices from menu
      })),
    };
  }

  // Restore cart on init
  restoreCart();

  return {
    items,
    totalItems,
    totalPrice,
    submittedOrderId,
    addItem,
    removeItem,
    updateQuantity,
    clearCart,
    buildOrderPayload,
  };
}
