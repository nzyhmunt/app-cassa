import { ref, computed } from 'vue';
import { useSelfOrderMenu } from './useSelfOrderMenu.js';

// Guard rails for client input. These prevent accidental/malicious payload
// bloat (e.g. a tampered cart with quantity 1e9 or a multi-MB note) from
// reaching Directus. They are a defense-in-depth UX layer only — the
// authoritative price/availability check must still happen server-side.
const MAX_ITEM_QUANTITY = 99;
const MAX_CART_ROWS = 50;
const MAX_NOTE_LENGTH = 280;

function clampQuantity(q) {
  const n = Math.floor(Number(q) || 0);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(n, MAX_ITEM_QUANTITY);
}

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
  const { calculateCartTotal, getAllItems, getItemById, getItemPrice, getModifierPrice } = useSelfOrderMenu();

  // Trusted total: resolve prices from the loaded menu via calculateCartTotal
  // (not from the client-controlled cart-stored item.price/modifier.price,
  // which is persisted in localStorage and can be tampered with). Fall back
  // to the cart-stored prices only when the menu is unavailable so the UI
  // still shows a number before the menu has loaded.
  const totalPrice = computed(() => {
    if (getAllItems().length > 0) {
      return calculateCartTotal(items.value).total;
    }
    return items.value.reduce((sum, item) => {
      const itemPrice = item.price * item.quantity;
      const modifiersPrice = item.modifiers?.reduce((mSum, m) => mSum + (m.price || 0), 0) || 0;
      return sum + itemPrice + (modifiersPrice * item.quantity);
    }, 0);
  });

  function addItem(menuItem, quantity = 1, modifiers = [], notes = '') {
    if (!menuItem || menuItem.id == null) return;

    // Don't let customers add unavailable items (menu items set
    // available:false are hidden in the UI but a tampered call could still
    // reach here).
    if (menuItem.available === false) return;

    const qty = clampQuantity(quantity);
    const cleanNotes = typeof notes === 'string' ? notes.slice(0, MAX_NOTE_LENGTH) : '';
    // Keep only modifiers that belong to the menu item (matched by id when
    // present, or by reference equality), so a tampered cart can't smuggle in
    // arbitrary modifiers. buildOrderPayload is the final price-trust barrier
    // and skips modifiers without a resolvable id.
    const validModIds = new Set(
      (menuItem.modifiers || []).map(m => m.id).filter(id => id != null)
    );
    const cleanModifiers = (Array.isArray(modifiers) ? modifiers : [])
      .filter(m => m && (m.id == null || validModIds.size === 0 || validModIds.has(m.id)));

    const existingIndex = items.value.findIndex(
      item => item.menuItemId === menuItem.id &&
              JSON.stringify(item.modifiers) === JSON.stringify(cleanModifiers) &&
              item.notes === cleanNotes
    );

    if (existingIndex >= 0) {
      items.value[existingIndex].quantity = clampQuantity(
        items.value[existingIndex].quantity + qty
      );
    } else {
      // Cap the number of distinct rows so a script can't balloon the cart.
      if (items.value.length >= MAX_CART_ROWS) return;
      items.value.push({
        id: `sci_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        menuItemId: menuItem.id,
        name: menuItem.name,
        price: menuItem.price || 0,
        quantity: qty,
        modifiers: cleanModifiers,
        notes: cleanNotes,
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
      // A non-positive requested quantity removes the row entirely. Clamp the
      // value first only for positive quantities (0/negative → remove), so a
      // caller asking for 0 isn't bumped to 1 by the lower bound.
      const raw = Number(quantity);
      if (!Number.isFinite(raw) || raw <= 0) {
        const index = items.value.findIndex(i => i.id === itemId);
        if (index >= 0) {
          items.value.splice(index, 1);
        }
        saveCart();
      } else {
        item.quantity = clampQuantity(raw);
        saveCart();
      }
    }
  }

  function clearCart() {
    items.value = [];
    saveCart();
  }

  /**
   * Reset the cart when a different/new bill session is loaded.
   *
   * The cart is persisted in localStorage under a single key shared across all
   * sessions, so without this a customer who scans table A, adds items, then
   * scans table B would carry table A's items into table B's order. Call this
   * from the auth flow whenever the session id changes (incl. a re-scan of the
   * same table after a closeSession).
   */
  function resetCartForNewSession() {
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
    return {
      bill_session: sessionId,
      status: 'pending',
      // Drop cart rows whose dish is no longer in the loaded menu (e.g. the
      // menu was rotated while the customer had a stale cart, or a tampered
      // cart row with a fake id). Such rows resolve to price 0 server-side and
      // must never be sent. Modifiers without a resolvable id are skipped too,
      // so a tampered cart can't emit a client-priced modifier.
      order_items: items.value
        .filter(item => getItemById(item.menuItemId) != null)
        .map((item, idx) => ({
          uid: `r_${idx + 1}`,
          dish: item.menuItemId,
          name: item.name,
          unit_price: getItemPrice(item.menuItemId) || 0,
          quantity: item.quantity,
          notes: item.notes ? [String(item.notes).slice(0, MAX_NOTE_LENGTH)] : [],
          order_item_modifiers: (item.modifiers || [])
            .filter(m => m.id != null)
            .map(m => ({
              name: m.name,
              price: getModifierPrice(m.id) || 0,
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
    resetCartForNewSession,
    buildOrderPayload,
  };
}
