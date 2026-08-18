/**
 * @file SelfOrderNavbar.test.js
 * Component tests for the self-order navbar back button.
 *
 * Covers the navigation fix: the navbar declares `@back` but, before the fix,
 * no visible element emitted it, so goBack was unreachable from the UI. Now a
 * back button renders only when `canGoBack` is true and emits `back` on click.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, enableAutoUnmount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import SelfOrderNavbar from '../selforder/SelfOrderNavbar.vue';

enableAutoUnmount(afterEach);

const { cartMock } = vi.hoisted(() => ({
  cartMock: () => ({ items: { value: [] }, addItem: vi.fn(), removeItem: vi.fn(), updateQuantity: vi.fn(), clearCart: vi.fn() }),
}));

vi.mock('../../composables/useSelfOrderCart.js', () => ({ useSelfOrderCart: cartMock }));

function mountNavbar(props = {}) {
  return mount(SelfOrderNavbar, { props: { session: null, ...props } });
}

describe('SelfOrderNavbar — back button', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it('hides the back button when canGoBack is false (root tab)', () => {
    const wrapper = mountNavbar({ canGoBack: false });
    // No element should carry the back aria-label.
    expect(wrapper.find('[aria-label="Indietro"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Back"]').exists()).toBe(false);
  });

  it('shows the back button and emits back when canGoBack is true', async () => {
    const wrapper = mountNavbar({ canGoBack: true });
    // Italian is the default language.
    const backBtn = wrapper.find('[aria-label="Indietro"]');
    expect(backBtn.exists()).toBe(true);

    await backBtn.trigger('click');
    expect(wrapper.emitted('back')).toBeTruthy();
    expect(wrapper.emitted('back')).toHaveLength(1);
  });
});
