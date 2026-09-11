/**
 * @file SelfOrderCartDrawer.test.js
 * Component tests for the self-order cart drawer.
 *
 * Covers the menu-not-loaded fallback (Copilot suppressed comment on
 * SelfOrderCartDrawer.vue:184/276/283): before loadMenu() completes,
 * calculateCartTotal()/getItemPrice() return 0, so totals and per-row prices
 * must fall back to the cart-stored prices instead of rendering 0€. Also covers
 * the canonical allergen-key payload (SelfOrderCartDrawer.vue:366): allergen
 * keys are sent to Directus unchanged (no `_` → space conversion).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import SelfOrderCartDrawer from '../selforder/SelfOrderCartDrawer.vue';
import { useSelfOrderCart } from '../../composables/useSelfOrderCart.js';
import { useSelfOrderMenu } from '../../composables/useSelfOrderMenu.js';

// Avoid any network/config coupling from the auth composable and config store.
// Mock functions are hoisted so the vi.mock factory (which is itself hoisted
// above imports by vitest) can reference them without TDZ errors, and so
// individual tests can override createOrder (e.g. to capture the order payload).
const { createOrderMock, fetchSessionOrdersMock, saveLocalOrderMock } = vi.hoisted(() => ({
  createOrderMock: vi.fn().mockResolvedValue({ id: 'ord-1' }),
  fetchSessionOrdersMock: vi.fn().mockResolvedValue([]),
  saveLocalOrderMock: vi.fn(),
}));

vi.mock('../../composables/useSelfOrderAuth.js', () => ({
  useSelfOrderAuth: () => ({
    billSessionId: { value: 'session-1' },
    billSession: { value: { venue: 1, table: '5' } },
    fetchSessionOrders: (...a) => fetchSessionOrdersMock(...a),
    saveLocalOrder: (...a) => saveLocalOrderMock(...a),
    createOrder: (...a) => createOrderMock(...a),
  }),
}));

vi.mock('../../store/index.js', () => ({
  useConfigStore: () => ({ config: { venueId: 1 } }),
}));

enableAutoUnmount(afterEach);

beforeEach(() => {
  setActivePinia(createPinia());
  sessionStorage.clear();
  localStorage.clear();
  const { clearCart } = useSelfOrderCart();
  clearCart();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mountDrawer() {
  return mount(SelfOrderCartDrawer, {
    props: { modelValue: true },
    global: { stubs: { Teleport: true, Transition: false } },
  });
}

describe('SelfOrderCartDrawer — menu-not-loaded price fallback', () => {
  it('renders cart-stored per-row prices (not 0€) before the menu loads', async () => {
    const { addItem } = useSelfOrderCart();
    addItem({ id: 'ant_1', name: 'Bruschetta', price: 3 }, 2);

    const wrapper = mountDrawer();
    await flushPromises();

    // No menu loaded → getItemPrice() would return 0; the row must fall back
    // to the cart-stored price (3 * 2 = 6).
    const row = wrapper.find('.theme-text.font-bold.text-sm');
    expect(row.exists()).toBe(true);
    expect(row.text()).toContain('6');
  });

  it('renders a non-zero cart total before the menu loads', async () => {
    const { addItem } = useSelfOrderCart();
    addItem({ id: 'ant_1', name: 'Bruschetta', price: 3 }, 2); // 6
    addItem({ id: 'ant_2', name: 'Caprese', price: 8 }, 1);    // 8

    const wrapper = mountDrawer();
    await flushPromises();

    const total = wrapper.find('.text-2xl.font-black.theme-text');
    expect(total.exists()).toBe(true);
    expect(total.text()).toContain('14');
  });

  it('switches to menu-trusted prices once the menu loads', async () => {
    // Menu says ant_1 costs 30 (different from the cart-stored 3) to prove the
    // menu price wins once loaded.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ Antipasti: [{ id: 'ant_1', name: 'Bruschetta', price: 30 }] }),
    })));
    const menu = useSelfOrderMenu();
    await menu.loadMenu('https://menu.test/menu.json');

    const { addItem } = useSelfOrderCart();
    // Tamper the cart price to 0; the menu price (30) must be used.
    addItem({ id: 'ant_1', name: 'Bruschetta', price: 0 }, 1);

    const wrapper = mountDrawer();
    await flushPromises();

    const total = wrapper.find('.text-2xl.font-black.theme-text');
    expect(total.exists()).toBe(true);
    expect(total.text()).toContain('30');
  });
});

describe('SelfOrderCartDrawer — canonical allergen keys in payload', () => {
  it('does not convert `_` to spaces when building the order payload', async () => {
    // Stored allergen keys are canonical identifiers (e.g. `frutta_a_guscio`).
    localStorage.setItem('selforder_preferences', JSON.stringify({
      diet: {},
      allergens: { frutta_a_guscio: true, glutine: true },
    }));

    const { addItem } = useSelfOrderCart();
    addItem({ id: 'ant_1', name: 'Bruschetta', price: 3 }, 1);

    createOrderMock.mockClear();
    createOrderMock.mockResolvedValue({ id: 'ord-1' });

    const wrapper = mountDrawer();
    await flushPromises();

    await wrapper.find('button.w-full.py-4.theme-bg').trigger('click');
    await flushPromises();

    expect(createOrderMock).toHaveBeenCalledTimes(1);
    const payload = createOrderMock.mock.calls[0][0];
    expect(payload.dietary_allergens).toEqual(
      expect.arrayContaining(['frutta_a_guscio', 'glutine']),
    );
    // No prettified (space-converted) keys must leak into the payload.
    expect(payload.dietary_allergens).not.toContain('frutta a guscio');
  });
});

describe('SelfOrderCartDrawer — offline order total is persisted for history', () => {
  it('saves total_amount/item_count so the offline history shows a real total', async () => {
    // buildOrderPayload() intentionally omits total_amount (the cassa recomputes
    // server-side), but the local-history copy must carry it — otherwise the
    // offline order history & order-status views render 0€.
    //
    // Load a known menu so the trusted-total calculation is deterministic and
    // not affected by the shared menu singleton left over by earlier tests.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        Antipasti: [
          { id: 'ant_1', name: 'Bruschetta', price: 3 },
          { id: 'ant_2', name: 'Caprese', price: 8 },
        ],
      }),
    })));
    const menu = useSelfOrderMenu();
    await menu.loadMenu('https://menu.test/menu.json');

    const { addItem } = useSelfOrderCart();
    addItem({ id: 'ant_1', name: 'Bruschetta', price: 3 }, 2); // 6
    addItem({ id: 'ant_2', name: 'Caprese', price: 8 }, 1);    // 8

    createOrderMock.mockClear();
    createOrderMock.mockResolvedValue({ id: 'ord-2' });
    saveLocalOrderMock.mockClear();

    const wrapper = mountDrawer();
    await flushPromises();

    await wrapper.find('button.w-full.py-4.theme-bg').trigger('click');
    await flushPromises();

    expect(saveLocalOrderMock).toHaveBeenCalledTimes(1);
    const saved = saveLocalOrderMock.mock.calls[0][0];
    expect(saved.total_amount).toBe(14);
    expect(saved.item_count).toBe(3);
    // The Directus payload must still NOT carry the client-computed total.
    expect(createOrderMock.mock.calls[0][0].total_amount).toBeUndefined();
  });
});
