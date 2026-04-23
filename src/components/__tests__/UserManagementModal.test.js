/**
 * @file UserManagementModal.test.js
 *
 * Component-level integration tests for the UserManagementModal.
 *
 * These tests verify the main user-management flows visible to the user:
 *  - Empty state: info banner + "add first admin" form
 *  - Form validation: name required, PIN exactly 4 digits
 *  - Adding the first user (who automatically becomes admin)
 *  - Admin state: existing user list + "add user" form visible
 *  - Non-admin state: form hidden, read-only notice shown
 *
 * Note: `crypto.subtle.digest` (used by hashPin in useAuth) is handled by
 * Node's UV thread pool.  Direct `flushPromises()` polling is not reliable
 * under parallel test file execution.  All tests that trigger async user
 * creation use `vi.waitFor()` to poll for the expected state change, then
 * a final `flushPromises()` to flush Vue's DOM update queue.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import UserManagementModal from '../UserManagementModal.vue';
import { useAuth, _resetAuthSingleton, _waitForAuth } from '../../composables/useAuth.js';
import { _resetIDBSingleton } from '../../composables/useIDB.js';
import { upsertRecordsIntoIDB } from '../../store/persistence/operations.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Mount the modal in the open state.
 * Lucide icons are stubbed to keep test output clean.
 */
function mountModal() {
  return mount(UserManagementModal, {
    props: { modelValue: true },
    global: {
      stubs: {
        Users: { template: '<span data-testid="icon-users" />' },
        X: { template: '<span data-testid="icon-x" />' },
        Pencil: { template: '<span data-testid="icon-pencil" />' },
        Trash2: { template: '<span data-testid="icon-trash" />' },
        Check: { template: '<span data-testid="icon-check" />' },
        Lock: { template: '<span data-testid="icon-lock" />' },
        ShieldCheck: { template: '<span data-testid="icon-shield-check" />' },
        ShieldOff: { template: '<span data-testid="icon-shield-off" />' },
        UserPlus: { template: '<span data-testid="icon-user-plus" />' },
      },
    },
  });
}

/**
 * Click the form's submit button and wait robustly for the async user-creation
 * to complete.
 *
 * `crypto.subtle.digest` (used by hashPin) runs in Node's UV thread pool and
 * resolves outside the normal microtask queue, so a plain flushPromises() is
 * not reliable under parallel test execution.  We therefore:
 *  1. Trigger the click.
 *  2. Poll with vi.waitFor() until the reactive user list reaches the expected
 *     length (default: 1 user for the first-user tests).
 *  3. Flush once more so Vue's reactive DOM update queue is applied.
 *
 * @param {import('@vue/test-utils').VueWrapper} wrapper
 * @param {import('@vue/test-utils').DOMWrapper} submitBtn
 * @param {number} [expectedUserCount=1]
 */
async function clickAndWaitForUser(wrapper, submitBtn, expectedUserCount = 1) {
  await submitBtn.trigger('click');
  const { users } = useAuth();
  await vi.waitFor(
    () => { expect(users.value.length).toBeGreaterThanOrEqual(expectedUserCount); },
    { timeout: 3000, interval: 10 },
  );
  await flushPromises(); // final flush for Vue DOM update queue
}

// ── Test setup ────────────────────────────────────────────────────────────────

// Automatically unmount every wrapper created with mount() after each test.
enableAutoUnmount(afterEach);

beforeEach(async () => {
  await _resetIDBSingleton();
  localStorage.clear();
  _resetAuthSingleton();
});

afterEach(async () => {
  // Drain any lingering promises so they don't pollute the next test's setup.
  await flushPromises();
  vi.restoreAllMocks();
});

// ── Empty state ───────────────────────────────────────────────────────────────

describe('empty state (no users configured)', () => {
  it('shows the "Nessun utente configurato" info banner', () => {
    const wrapper = mountModal();
    expect(wrapper.text()).toContain('Nessun utente configurato');
  });

  it('shows a text input for the username', () => {
    const wrapper = mountModal();
    const input = wrapper.find('input[placeholder="Nome utente"]');
    expect(input.exists()).toBe(true);
  });

  it('shows a PIN input field', () => {
    const wrapper = mountModal();
    const input = wrapper.find('input[placeholder="PIN (4 cifre numeriche)"]');
    expect(input.exists()).toBe(true);
  });

  it('shows the "Crea account amministratore" submit button', () => {
    const wrapper = mountModal();
    expect(wrapper.text()).toContain('Crea account amministratore');
  });
});

// ── AddUserForm validation ────────────────────────────────────────────────────

describe('AddUserForm validation (first user)', () => {
  it('shows an error when submitting with an empty name', async () => {
    const wrapper = mountModal();
    // Leave name empty, fill a valid PIN
    await wrapper.find('input[placeholder="PIN (4 cifre numeriche)"]').setValue('1234');
    const submitBtn = wrapper.findAll('button').find(b => b.text().trim().includes('Crea account'));
    await submitBtn.trigger('click');
    await flushPromises(); // validation is synchronous, one round is enough
    expect(wrapper.text()).toContain('Inserisci un nome utente.');
  });

  it('shows an error when the PIN is less than 4 digits', async () => {
    const wrapper = mountModal();
    await wrapper.find('input[placeholder="Nome utente"]').setValue('Mario');
    await wrapper.find('input[placeholder="PIN (4 cifre numeriche)"]').setValue('12');
    const submitBtn = wrapper.findAll('button').find(b => b.text().trim().includes('Crea account'));
    await submitBtn.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Il PIN deve essere esattamente 4 cifre numeriche.');
  });

  it('shows an error when the PIN contains non-numeric characters', async () => {
    const wrapper = mountModal();
    await wrapper.find('input[placeholder="Nome utente"]').setValue('Mario');
    await wrapper.find('input[placeholder="PIN (4 cifre numeriche)"]').setValue('ab12');
    const submitBtn = wrapper.findAll('button').find(b => b.text().trim().includes('Crea account'));
    await submitBtn.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Il PIN deve essere esattamente 4 cifre numeriche.');
  });

  it('shows an error when the PIN is more than 4 digits', async () => {
    const wrapper = mountModal();
    await wrapper.find('input[placeholder="Nome utente"]').setValue('Mario');
    await wrapper.find('input[placeholder="PIN (4 cifre numeriche)"]').setValue('12345');
    const submitBtn = wrapper.findAll('button').find(b => b.text().trim().includes('Crea account'));
    await submitBtn.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Il PIN deve essere esattamente 4 cifre numeriche.');
  });
});

// ── Adding the first user ─────────────────────────────────────────────────────

describe('adding the first user', () => {
  it('creates the user and switches from the empty-state view', async () => {
    const wrapper = mountModal();
    await wrapper.find('input[placeholder="Nome utente"]').setValue('Admin');
    await wrapper.find('input[placeholder="PIN (4 cifre numeriche)"]').setValue('1234');
    const submitBtn = wrapper.findAll('button').find(b => b.text().trim().includes('Crea account'));
    await clickAndWaitForUser(wrapper, submitBtn);

    expect(wrapper.text()).not.toContain('Nessun utente configurato');
    expect(wrapper.text()).toContain('Admin');
  });

  it('saves the new admin user to in-memory auth state', async () => {
    const wrapper = mountModal();
    await wrapper.find('input[placeholder="Nome utente"]').setValue('Admin');
    await wrapper.find('input[placeholder="PIN (4 cifre numeriche)"]').setValue('1234');
    const submitBtn = wrapper.findAll('button').find(b => b.text().trim().includes('Crea account'));
    await clickAndWaitForUser(wrapper, submitBtn);

    const { users } = useAuth();
    expect(users.value).toHaveLength(1);
    expect(users.value[0].name).toBe('Admin');
  });

  it('makes the first added user an admin', async () => {
    const wrapper = mountModal();
    await wrapper.find('input[placeholder="Nome utente"]').setValue('Admin');
    await wrapper.find('input[placeholder="PIN (4 cifre numeriche)"]').setValue('1234');
    const submitBtn = wrapper.findAll('button').find(b => b.text().trim().includes('Crea account'));
    await clickAndWaitForUser(wrapper, submitBtn);

    const { users } = useAuth();
    expect(users.value[0].isAdmin).toBe(true);
  });

  it('shows the user in the list after a successful submission', async () => {
    const wrapper = mountModal();
    await wrapper.find('input[placeholder="Nome utente"]').setValue('Admin');
    await wrapper.find('input[placeholder="PIN (4 cifre numeriche)"]').setValue('1234');
    const submitBtn = wrapper.findAll('button').find(b => b.text().trim().includes('Crea account'));
    await clickAndWaitForUser(wrapper, submitBtn);

    expect(wrapper.text()).toContain('Utenti configurati');
    expect(wrapper.text()).toContain('Admin');
  });
});

// ── Non-empty state (admin logged in) ─────────────────────────────────────────

describe('non-empty state with admin logged in', () => {
  let adminUser;

  beforeEach(async () => {
    const { addUser, login } = useAuth();
    adminUser = await addUser('Admin', '1111');
    await login(adminUser.id, '1111');
  });

  it('shows the user list', () => {
    const wrapper = mountModal();
    expect(wrapper.text()).toContain('Utenti configurati');
    expect(wrapper.text()).toContain('Admin');
  });

  it('shows the "Aggiungi utente" section', () => {
    const wrapper = mountModal();
    expect(wrapper.text()).toContain('Aggiungi utente');
  });

  it('shows the "Aggiungi utente" submit button', () => {
    const wrapper = mountModal();
    const btn = wrapper.findAll('button').find(b => b.text().trim().includes('Aggiungi utente'));
    expect(btn).toBeDefined();
  });

  it('shows the auto-lock section for admin', () => {
    const wrapper = mountModal();
    expect(wrapper.text()).toContain('Blocco automatico');
  });

  it('can add a second user', async () => {
    const wrapper = mountModal();
    await wrapper.find('input[placeholder="Nome utente"]').setValue('Staff');
    await wrapper.find('input[placeholder="PIN (4 cifre numeriche)"]').setValue('2222');
    const submitBtn = wrapper.findAll('button').find(b => b.text().trim().includes('Aggiungi utente'));
    expect(submitBtn).toBeDefined();
    await clickAndWaitForUser(wrapper, submitBtn, 2); // now expect admin + staff

    const { users } = useAuth();
    expect(users.value.map(u => u.name)).toContain('Staff');
  });
});

// ── Non-empty state (non-admin logged in) ────────────────────────────────────

describe('non-empty state with non-admin user logged in', () => {
  let staffUser;

  beforeEach(async () => {
    const { addUser, login } = useAuth();
    await addUser('Admin', '1111'); // first user = admin
    staffUser = await addUser('Staff', '2222'); // second user = non-admin
    await login(staffUser.id, '2222');
  });

  it('shows the limited-access notice for non-admins', () => {
    const wrapper = mountModal();
    expect(wrapper.text()).toContain('Accesso limitato');
  });

  it('does not show the "Aggiungi utente" add-user form to non-admins', () => {
    const wrapper = mountModal();
    const btn = wrapper.findAll('button').find(b => b.text().trim().includes('Aggiungi utente'));
    expect(btn).toBeUndefined();
  });

  it('still shows the existing user list', () => {
    const wrapper = mountModal();
    expect(wrapper.text()).toContain('Utenti configurati');
  });

  it('shows an edit button for the non-admin user on their own row', () => {
    const wrapper = mountModal();
    // The edit ("Modifica") button should be rendered for the non-admin's own account
    const editBtn = wrapper.find('button[title="Modifica"]');
    expect(editBtn.exists()).toBe(true);
  });

  it('does not show an edit button for the admin user row when non-admin is logged in', async () => {
    const wrapper = mountModal();
    await flushPromises();
    // There should be exactly one "Modifica" button (for own account only, not for admin row)
    const editBtns = wrapper.findAll('button[title="Modifica"]');
    expect(editBtns.length).toBe(1);
  });

  it('does not show the name input when non-admin edits their own account', async () => {
    const wrapper = mountModal();
    const editBtn = wrapper.find('button[title="Modifica"]');
    await editBtn.trigger('click');
    await flushPromises();

    // Only PIN input should appear; name input must NOT be present
    const nameInput = wrapper.find('input[placeholder="Nome"]');
    const pinInput = wrapper.find('input[placeholder="Nuovo PIN (4 cifre, lascia vuoto per non cambiare)"]');
    expect(nameInput.exists()).toBe(false);
    expect(pinInput.exists()).toBe(true);
  });

  it('allows a non-admin user to change their own PIN', async () => {
    const wrapper = mountModal();
    const editBtn = wrapper.find('button[title="Modifica"]');
    await editBtn.trigger('click');
    await flushPromises();

    const pinInput = wrapper.find('input[placeholder="Nuovo PIN (4 cifre, lascia vuoto per non cambiare)"]');
    await pinInput.setValue('9999');

    const saveBtn = wrapper.find('button[title="Salva"]');
    await saveBtn.trigger('click');

    // updateUser calls hashPin (async via UV thread pool); poll until the edit form closes
    await vi.waitFor(
      () => expect(wrapper.find('input[placeholder="Nuovo PIN (4 cifre, lascia vuoto per non cambiare)"]').exists()).toBe(false),
      { timeout: 3000, interval: 10 },
    );
    await flushPromises();

    // User should still exist after PIN update
    const { users } = useAuth();
    expect(users.value.find(u => u.id === staffUser.id)).toBeDefined();
  });

  it('does not show the delete button for any user when non-admin is logged in', () => {
    const wrapper = mountModal();
    const deleteBtns = wrapper.findAll('button[title="Elimina"]');
    expect(deleteBtns.length).toBe(0);
  });

  it('does not show auto-lock controls for non-admin manual users', () => {
    const wrapper = mountModal();
    expect(wrapper.text()).not.toContain('Blocco automatico');
  });
});

describe('directus-managed venue users', () => {
  beforeEach(async () => {
    // Plaintext PIN here intentionally exercises the sync-normalization path:
    // upsertRecordsIntoIDB hashes venue_users PINs before auth checks run.
    await upsertRecordsIntoIDB('venue_users', [{
      id: 'vu_directus_admin',
      name: 'Direttore',
      display_name: 'Direttore',
      pin: '1234',
      apps: ['admin'],
      status: 'active',
    }]);
    const { login } = useAuth();
    await _waitForAuth();
    await login('vu_directus_admin', '1234');
  });

  it('shows directus read-only notice and hides add/edit controls', async () => {
    const wrapper = mountModal();
    await flushPromises();

    expect(wrapper.text()).toContain('Utenti sincronizzati da Directus');
    expect(wrapper.text()).toContain('Blocco automatico');
    expect(wrapper.text()).not.toContain('Aggiungi utente');
    expect(wrapper.find('button[title="Modifica"]').exists()).toBe(false);
  });
});
