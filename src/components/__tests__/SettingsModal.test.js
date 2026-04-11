/**
 * @file SettingsModal.test.js
 *
 * Component-level integration tests for the shared SettingsModal.
 *
 * These tests verify the role-based access control:
 *  - Menu sync section (URL input + sync button) is controlled by the showMenuSync prop.
 *    In production, CassaSettingsModal/SalaSettingsModal pass :showMenuSync="isAdmin"
 *    so only admins see the menu sync section.
 *  - Reset-to-defaults section is only visible to admins (isAdmin check in SettingsModal)
 *  - Non-admin users cannot see these destructive / privileged actions
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import SettingsModal from '../shared/SettingsModal.vue';
import { useAuth, _resetAuthSingleton } from '../../composables/useAuth.js';
import { _resetIDBSingleton } from '../../composables/useIDB.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const ICON_STUBS = {
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
  UserManagementModal: { template: '<div />', props: ['modelValue'] },
};

/**
 * Mount the settings modal in the open state.
 * Accepts optional props to override defaults (e.g. showMenuSync).
 * In production the wrapper passes :showMenuSync="isAdmin".
 */
function mountSettingsModal(extraProps = {}) {
  return mount(SettingsModal, {
    props: { modelValue: true, title: 'Impostazioni', ...extraProps },
    global: { stubs: ICON_STUBS },
  });
}

// ── Test setup ────────────────────────────────────────────────────────────────

enableAutoUnmount(afterEach);

beforeEach(async () => {
  // Reset IDB before fake timers are installed so deleteDatabase uses real setImmediate.
  await _resetIDBSingleton();
  localStorage.clear();
  _resetAuthSingleton();
  // Only fake timeout/interval — do NOT fake setImmediate so that fake-indexeddb's
  // scheduling (which relies on setImmediate) still works when addUser is awaited.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
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
  // In open mode (no users), isAdmin=true — full unrestricted access.
  it('hides the menu sync section when showMenuSync=false', () => {
    const wrapper = mountSettingsModal({ showMenuSync: false });
    expect(wrapper.text()).not.toContain('URL Menu JSON');
    expect(wrapper.text()).not.toContain('Sincronizza');
  });

  it('shows the reset button in open mode (isAdmin is true when no users configured)', () => {
    const wrapper = mountSettingsModal();
    expect(wrapper.text()).toContain('Ripristina dati di default');
  });

  it('still shows the sound toggle when no users are configured', () => {
    const wrapper = mountSettingsModal();
    expect(wrapper.text()).toContain('Avvisi Audio');
  });

  it('shows only "Aggiungi amministratore" button and not "Gestione Utenti" when no users configured', () => {
    const wrapper = mountSettingsModal();
    expect(wrapper.text()).toContain('Aggiungi amministratore');
    expect(wrapper.text()).not.toContain('Gestione Utenti');
  });
});

// ── Admin user logged in ──────────────────────────────────────────────────────

describe('admin user logged in', () => {
  beforeEach(async () => {
    const { addUser, login } = useAuth();
    const admin = await addUser('Admin', '1111');
    await login(admin.id, '1111');
  });

  // Admin: wrapper passes showMenuSync=true (isAdmin=true)
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

  it('shows "Gestione Utenti" button and not "Aggiungi amministratore" when admin is logged in', async () => {
    const wrapper = mountSettingsModal();
    await flushPromises();
    expect(wrapper.text()).toContain('Gestione Utenti');
    expect(wrapper.text()).not.toContain('Aggiungi amministratore');
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

  // Non-admin: wrapper passes showMenuSync=false (isAdmin=false)
  it('hides the "URL Menu JSON" label from non-admin', async () => {
    const wrapper = mountSettingsModal({ showMenuSync: false });
    await flushPromises();
    expect(wrapper.text()).not.toContain('URL Menu JSON');
  });

  it('hides the menu sync button from non-admin', async () => {
    const wrapper = mountSettingsModal({ showMenuSync: false });
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

  it('shows "Modifica PIN" button to non-admin instead of full user management', async () => {
    const wrapper = mountSettingsModal();
    await flushPromises();
    expect(wrapper.text()).toContain('Modifica PIN');
    expect(wrapper.text()).not.toContain('Gestione Utenti');
  });

  it('still shows the screen-lock toggle to non-admin', async () => {
    const wrapper = mountSettingsModal();
    await flushPromises();
    expect(wrapper.text()).toContain('Schermo sempre acceso');
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
    const wrapper = mountSettingsModal({ showMenuSync: false });
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
