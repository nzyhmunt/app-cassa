import { ref, computed } from 'vue';

const ORDER_HISTORY_KEY = 'selforder_order_history';

// Shared state across all composable instances
const items = ref([]);
const submittedOrderId = ref(null);
const orderHistory = ref([]);

// Restore cart and history on module load
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

function restoreHistory() {
  const saved = localStorage.getItem(ORDER_HISTORY_KEY);
  if (saved) {
    try {
      orderHistory.value = JSON.parse(saved);
    } catch {
      localStorage.removeItem(ORDER_HISTORY_KEY);
    }
  }
}

// Initialize on module load
restoreCart();
restoreHistory();

export function useSelfOrderCart() {
  const totalItems = computed(() => 
    items.value.reduce((sum, item) => sum + item.quantity, 0)
  );

  const totalPrice = computed(() =>
    items.value.reduce((sum, item) => {
      const itemPrice = item.price * item.quantity;
      const modifiersPrice = item.modifiers?.reduce((mSum, m) => mSum + (m.price || 0), 0) || 0;
      return sum + itemPrice + (modifiersPrice * item.quantity);
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

  /**
   * Add current cart to order history (called after successful submission)
   */
  function addToHistory() {
    if (items.value.length === 0) return;
    
    const order = {
      id: `ord_${Date.now()}`,
      time: new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
      items: JSON.parse(JSON.stringify(items.value)),
      total: totalPrice.value,
      totalItems: totalItems.value,
    };
    
    orderHistory.value.unshift(order);
    saveHistory();
    clearCart();
  }

  function saveHistory() {
    localStorage.setItem(ORDER_HISTORY_KEY, JSON.stringify(orderHistory.value));
  }

  function clearHistory() {
    orderHistory.value = [];
    localStorage.removeItem(ORDER_HISTORY_KEY);
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
        dish: item.menuItemId,
        name: item.name,
        quantity: item.quantity,
        notes: item.notes || null,
        modifiers: item.modifiers?.map(m => m.name) || [],
      })),
    };
  }

  return {
    items,
    totalItems,
    totalPrice,
    orderHistory,
    submittedOrderId,
    addItem,
    removeItem,
    updateQuantity,
    clearCart,
    clearHistory,
    buildOrderPayload,
    addToHistory,
    saveHistory,
    restoreHistory,
  };
}
