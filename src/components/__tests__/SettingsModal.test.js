/**
 * @file SettingsModal.test.js
 *
 * Component-level integration tests for the shared SettingsModal.
 *
 * These tests verify the role-based access control:
 *  - Menu sync section (URL input + sync button) is only visible to admins
 *  - Reset-to-defaults section is only visible to admins
 *  - Non-admin users cannot see these destructive / privileged actions
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import SettingsModal from '../shared/SettingsModal.vue';
import { useAuth, _resetAuthSingleton } from '../../composables/useAuth.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Mount the settings modal in the open state.
 * Lucide icons and the UserManagementModal sub-component are stubbed.
 */
function mountSettingsModal() {
  return mount(SettingsModal, {
    props: { modelValue: true, title: 'Impostazioni' },
    global: {
      stubs: {
        Settings: { template: '<span />' },
        X: { template: '<span />' },
        RefreshCw: { template: '<span />' },
        RotateCcw: { template: '<span />' },
        Users: { template: '<span />' },
        ShieldCheck: { template: '<span />' },
        ShieldAlert: { template: '<span />' },
        Volume2: { template: '<span />' },
        VolumeX: { template: '<span />' },
        Monitor: { template: '<span />' },
        // Stub the nested UserManagementModal to avoid mounting it in tests
        UserManagementModal: { template: '<div />', props: ['modelValue'] },
      },
    },
  });
}

// ── Test setup ────────────────────────────────────────────────────────────────

enableAutoUnmount(afterEach);

beforeEach(() => {
  localStorage.clear();
  _resetAuthSingleton();
  vi.useFakeTimers();
  setActivePinia(createPinia());
  // Stub fetch so store initialization cannot trigger real network requests.
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({}),
  });
});

afterEach(async () => {
  vi.useRealTimers();
  await flushPromises();
  vi.restoreAllMocks();
});

// ── No users configured (open access) ────────────────────────────────────────

describe('no users configured (open access)', () => {
  it('hides the menu sync section when no users are configured (no admin logged in)', () => {
    const wrapper = mountSettingsModal();
    expect(wrapper.text()).not.toContain('URL Menu JSON');
    expect(wrapper.text()).not.toContain('Sincronizza');
  });

  it('hides the reset button when no users are configured (no admin logged in)', () => {
    const wrapper = mountSettingsModal();
    expect(wrapper.text()).not.toContain('Ripristina dati di default');
  });

  it('still shows the sound toggle when no users are configured', () => {
    const wrapper = mountSettingsModal();
    expect(wrapper.text()).toContain('Avvisi Audio');
  });
});

// ── Admin user logged in ──────────────────────────────────────────────────────

describe('admin user logged in', () => {
  beforeEach(async () => {
    const { addUser, login } = useAuth();
    const admin = await addUser('Admin', '1111');
    await login(admin.id, '1111');
  });

  it('shows the "URL Menu JSON" label to admin', async () => {
    const wrapper = mountSettingsModal();
    await flushPromises(); // let store.menuLoading settle
    expect(wrapper.text()).toContain('URL Menu JSON');
  });

  it('shows the menu sync button to admin', async () => {
    const wrapper = mountSettingsModal();
    await flushPromises(); // let store.menuLoading settle (shows "Sincronizza Menu" when not loading)
    expect(wrapper.text()).toContain('Sincronizza Menu');
  });

  it('shows the "Ripristina dati di default" button to admin', async () => {
    const wrapper = mountSettingsModal();
    await flushPromises();
    expect(wrapper.text()).toContain('Ripristina dati di default');
  });
});

// ── Non-admin user logged in ──────────────────────────────────────────────────

describe('non-admin user logged in', () => {
  beforeEach(async () => {
    const { addUser, login } = useAuth();
    await addUser('Admin', '1111'); // first user = admin
    const staff = await addUser('Staff', '2222'); // second user = non-admin
    await login(staff.id, '2222');
  });

  it('hides the "URL Menu JSON" label from non-admin', async () => {
    const wrapper = mountSettingsModal();
    await flushPromises();
    expect(wrapper.text()).not.toContain('URL Menu JSON');
  });

  it('hides the menu sync button from non-admin', async () => {
    const wrapper = mountSettingsModal();
    await flushPromises();
    expect(wrapper.text()).not.toContain('Sincronizza');
  });

  it('hides the "Ripristina dati di default" button from non-admin', async () => {
    const wrapper = mountSettingsModal();
    await flushPromises();
    expect(wrapper.text()).not.toContain('Ripristina dati di default');
  });

  it('still shows the sound toggle to non-admin', async () => {
    const wrapper = mountSettingsModal();
    await flushPromises();
    expect(wrapper.text()).toContain('Avvisi Audio');
  });

  it('still shows the user management button to non-admin', async () => {
    const wrapper = mountSettingsModal();
    await flushPromises();
    expect(wrapper.text()).toContain('Gestione Utenti');
  });
});

// ── showMenuSync prop (introduced in PR #66) ──────────────────────────────────

describe('showMenuSync prop', () => {
  beforeEach(async () => {
    const { addUser, login } = useAuth();
    const admin = await addUser('Admin', '1111');
    await login(admin.id, '1111');
  });

  it('hides the menu sync section when showMenuSync=false, even for admin', async () => {
    const wrapper = mount(SettingsModal, {
      props: { modelValue: true, title: 'Impostazioni', showMenuSync: false },
      global: {
        stubs: {
          Settings: { template: '<span />' },
          X: { template: '<span />' },
          RefreshCw: { template: '<span />' },
          RotateCcw: { template: '<span />' },
          Users: { template: '<span />' },
          ShieldCheck: { template: '<span />' },
          ShieldAlert: { template: '<span />' },
          UserManagementModal: { template: '<div />', props: ['modelValue'] },
        },
      },
    });
    await flushPromises();
    expect(wrapper.text()).not.toContain('URL Menu JSON');
    expect(wrapper.text()).not.toContain('Sincronizza');
  });

  it('shows the menu sync section when showMenuSync=true and user is admin', async () => {
    const wrapper = mountSettingsModal(); // default showMenuSync=true
    await flushPromises();
    expect(wrapper.text()).toContain('URL Menu JSON');
    expect(wrapper.text()).toContain('Sincronizza Menu');
  });
});
