import { ref, computed } from 'vue';
import { useSelfOrderMenu } from './useSelfOrderMenu.js';

// Shared state across all composable instances
const items = ref([]);

// Restore cart on module load
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

// Initialize on module load
restoreCart();

export function useSelfOrderCart() {
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
        // Fully remove the row: removeItem() only decrements when quantity > 1,
        // which would leave a stale item behind when the caller asked for 0.
        const index = items.value.findIndex(i => i.id === itemId);
        if (index >= 0) {
          items.value.splice(index, 1);
        }
        saveCart();
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
   * Build the Directus-shaped order payload from the current cart.
   * Uses the O2M relational field name `order_items` (not `items`) so nested
   * rows are actually created. `unit_price` and modifier `price` are looked
   * up from the loaded (public) menu via getItemPrice()/getModifierPrice() —
   * NOT from the client cart — so a tampered cart cannot influence the prices
   * sent to Directus. The value is only present to satisfy the NOT NULL
   * constraint on order_items.unit_price; the cassa may still recompute/
   * override it when the order is accepted. Venue/table/dietary context is
   * added by the caller, which has the bill session.
   */
  function buildOrderPayload(sessionId) {
    const { getItemPrice, getModifierPrice } = useSelfOrderMenu();
    return {
      bill_session: sessionId,
      status: 'pending',
      order_items: items.value.map((item, idx) => ({
        uid: `r_${idx + 1}`,
        dish: item.menuItemId,
        name: item.name,
        unit_price: getItemPrice(item.menuItemId) || 0,
        quantity: item.quantity,
        notes: item.notes ? [item.notes] : [],
        order_item_modifiers: (item.modifiers || []).map(m => ({
          name: m.name,
          price: m.id != null ? (getModifierPrice(m.id) || 0) : (m.price || 0),
          item_uid: `r_${idx + 1}`,
        })),
      })),
    };
  }

  return {
    items,
    totalPrice,
    addItem,
    removeItem,
    updateQuantity,
    clearCart,
    buildOrderPayload,
  };
}
