/**
 * @file InvoiceModal.test.js
 *
 * Unit tests for the shared InvoiceModal component.
 *
 * Covers:
 *  - Visibility (show/hide via prop)
 *  - Cancel emit from header button and footer "Annulla" button
 *  - Validation errors (required fields, CAP format, SDI format, PEC format)
 *  - Successful confirm emit with normalised payload (trimmed, uppercased fields)
 *  - Form reset when modal is re-opened
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import InvoiceModal from '../shared/InvoiceModal.vue';

// ── Helpers ───────────────────────────────────────────────────────────────────

const ICON_STUBS = {
  FileText:  { template: '<span />' },
  Building2: { template: '<span />' },
  X:         { template: '<span />' },
};

/** A minimal valid form data keyed by input placeholder attribute. */
const VALID_FORM_BY_PLACEHOLDER = {
  'Es. Mario Rossi / Rossi S.r.l.': 'Mario Rossi',
  'RSSMRA80A01H501Z':               'RSSMRA80A01H501Z',
  '01234567890':                    '',
  'Via Roma 1':                     'Via Roma 1',
  '00100':                          '00100',
  'Roma':                           'Roma',
  'RM':                             'RM',
  'IT':                             'IT',
  '0000000':                        '0000000',
  'fatture@pec.it':                 '',
};

function mountModal(show = true) {
  return mount(InvoiceModal, {
    props: { show },
    global: {
      stubs: {
        // Stub Teleport so content renders inline in the test DOM.
        teleport: true,
        ...ICON_STUBS,
      },
    },
  });
}

/**
 * Fill the form with values from VALID_FORM_BY_PLACEHOLDER, overriding specific
 * fields via the `overrides` map (also keyed by placeholder).
 * Then click the "Conferma Fattura" button.
 */
async function fillAndConfirm(wrapper, overrides = {}) {
  const formData = { ...VALID_FORM_BY_PLACEHOLDER, ...overrides };
  for (const [placeholder, value] of Object.entries(formData)) {
    const input = wrapper.find(`input[placeholder="${placeholder}"], textarea[placeholder="${placeholder}"]`);
    if (input.exists()) {
      await input.setValue(value);
    }
  }
  // Click the "Conferma Fattura" submit button (bg-violet-600 in footer)
  const footerButtons = wrapper.findAll('button');
  const confirmBtn = footerButtons.find(b => b.text().includes('Conferma Fattura'));
  if (confirmBtn) {
    await confirmBtn.trigger('click');
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

enableAutoUnmount(afterEach);

// ── Visibility ────────────────────────────────────────────────────────────────

describe('visibility', () => {
  it('renders the modal content when show=true', () => {
    const wrapper = mountModal(true);
    expect(wrapper.text()).toContain('Dati Fattura');
  });

  it('does not render the modal content when show=false', () => {
    const wrapper = mountModal(false);
    expect(wrapper.text()).not.toContain('Dati Fattura');
  });
});

// ── Cancel ────────────────────────────────────────────────────────────────────

describe('cancel', () => {
  it('emits cancel when the header close button (aria-label=Chiudi) is clicked', async () => {
    const wrapper = mountModal();
    await wrapper.find('button[aria-label="Chiudi"]').trigger('click');
    expect(wrapper.emitted('cancel')).toBeTruthy();
  });

  it('emits cancel when the footer "Annulla" button is clicked', async () => {
    const wrapper = mountModal();
    const annullaBtn = wrapper.findAll('button').find(b => b.text() === 'Annulla');
    expect(annullaBtn).toBeTruthy();
    await annullaBtn.trigger('click');
    expect(wrapper.emitted('cancel')).toBeTruthy();
  });
});

// ── Validation ────────────────────────────────────────────────────────────────

describe('validation', () => {
  it('shows error when denominazione is empty', async () => {
    const wrapper = mountModal();
    await fillAndConfirm(wrapper, { 'Es. Mario Rossi / Rossi S.r.l.': '' });
    expect(wrapper.text()).toContain('Denominazione obbligatoria');
    expect(wrapper.emitted('confirm')).toBeFalsy();
  });

  it('shows error when both codiceFiscale and piva are empty', async () => {
    const wrapper = mountModal();
    await fillAndConfirm(wrapper, { 'RSSMRA80A01H501Z': '', '01234567890': '' });
    expect(wrapper.text()).toContain('Codice Fiscale o P.IVA');
    expect(wrapper.emitted('confirm')).toBeFalsy();
  });

  it('passes validation when only piva is provided (no codiceFiscale)', async () => {
    const wrapper = mountModal();
    await fillAndConfirm(wrapper, { 'RSSMRA80A01H501Z': '', '01234567890': '01234567890' });
    expect(wrapper.emitted('confirm')).toBeTruthy();
  });

  it('shows error when indirizzo is empty', async () => {
    const wrapper = mountModal();
    await fillAndConfirm(wrapper, { 'Via Roma 1': '' });
    expect(wrapper.text()).toContain('Indirizzo, CAP e Comune');
    expect(wrapper.emitted('confirm')).toBeFalsy();
  });

  it('shows error when cap is empty', async () => {
    const wrapper = mountModal();
    await fillAndConfirm(wrapper, { '00100': '' });
    expect(wrapper.text()).toContain('Indirizzo, CAP e Comune');
    expect(wrapper.emitted('confirm')).toBeFalsy();
  });

  it('shows error when comune is empty', async () => {
    const wrapper = mountModal();
    await fillAndConfirm(wrapper, { 'Roma': '' });
    expect(wrapper.text()).toContain('Indirizzo, CAP e Comune');
    expect(wrapper.emitted('confirm')).toBeFalsy();
  });

  it('shows error when cap is not 5 digits', async () => {
    const wrapper = mountModal();
    await fillAndConfirm(wrapper, { '00100': '1234' });
    expect(wrapper.text()).toContain('CAP deve essere di 5 cifre');
    expect(wrapper.emitted('confirm')).toBeFalsy();
  });

  it('shows error when cap contains letters', async () => {
    const wrapper = mountModal();
    await fillAndConfirm(wrapper, { '00100': '0010A' });
    expect(wrapper.text()).toContain('CAP deve essere di 5 cifre');
    expect(wrapper.emitted('confirm')).toBeFalsy();
  });

  it('shows error when paese is empty', async () => {
    const wrapper = mountModal();
    await fillAndConfirm(wrapper, { 'IT': '' });
    expect(wrapper.text()).toContain('Paese è obbligatorio');
    expect(wrapper.emitted('confirm')).toBeFalsy();
  });

  it('shows error when neither SDI nor PEC is provided', async () => {
    const wrapper = mountModal();
    await fillAndConfirm(wrapper, { '0000000': '', 'fatture@pec.it': '' });
    expect(wrapper.text()).toContain('Codice SDI o PEC');
    expect(wrapper.emitted('confirm')).toBeFalsy();
  });

  it('shows error when SDI is not 7 alphanumeric characters', async () => {
    const wrapper = mountModal();
    await fillAndConfirm(wrapper, { '0000000': '123', 'fatture@pec.it': '' });
    expect(wrapper.text()).toContain('7 caratteri alfanumerici');
    expect(wrapper.emitted('confirm')).toBeFalsy();
  });

  it('shows error when PEC format is invalid', async () => {
    const wrapper = mountModal();
    await fillAndConfirm(wrapper, { '0000000': '', 'fatture@pec.it': 'not-an-email' });
    expect(wrapper.text()).toContain('PEC non valido');
    expect(wrapper.emitted('confirm')).toBeFalsy();
  });

  it('passes validation with only PEC (no SDI)', async () => {
    const wrapper = mountModal();
    await fillAndConfirm(wrapper, { '0000000': '', 'fatture@pec.it': 'fatture@pec.it' });
    expect(wrapper.emitted('confirm')).toBeTruthy();
  });

  it('passes validation with only SDI (no PEC)', async () => {
    const wrapper = mountModal();
    await fillAndConfirm(wrapper, { '0000000': 'ABC1234', 'fatture@pec.it': '' });
    expect(wrapper.emitted('confirm')).toBeTruthy();
  });
});

// ── Emitted payload ───────────────────────────────────────────────────────────

describe('confirm payload normalisation', () => {
  it('uppercases provincia, paese and codiceDestinatario in the emitted payload', async () => {
    const wrapper = mountModal();
    await fillAndConfirm(wrapper, {
      'RM':      'rm',
      'IT':      'it',
      '0000000': 'abc1234',
    });
    expect(wrapper.emitted('confirm')).toBeTruthy();
    const payload = wrapper.emitted('confirm')[0][0];
    expect(payload.provincia).toBe('RM');
    expect(payload.paese).toBe('IT');
    expect(payload.codiceDestinatario).toBe('ABC1234');
  });

  it('trims whitespace from denominazione and indirizzo', async () => {
    const wrapper = mountModal();
    await fillAndConfirm(wrapper, {
      'Es. Mario Rossi / Rossi S.r.l.': '  Rossi S.r.l.  ',
      'Via Roma 1': '  Via Roma 1  ',
    });
    expect(wrapper.emitted('confirm')).toBeTruthy();
    const payload = wrapper.emitted('confirm')[0][0];
    expect(payload.denominazione).toBe('Rossi S.r.l.');
    expect(payload.indirizzo).toBe('Via Roma 1');
  });

  it('emits confirm with all expected fields present', async () => {
    const wrapper = mountModal();
    await fillAndConfirm(wrapper);
    const payload = wrapper.emitted('confirm')[0][0];
    const expectedKeys = [
      'denominazione', 'codiceFiscale', 'piva',
      'indirizzo', 'cap', 'comune', 'provincia', 'paese',
      'codiceDestinatario', 'pec',
    ];
    for (const key of expectedKeys) {
      expect(payload).toHaveProperty(key);
    }
  });
});

// ── Form reset ────────────────────────────────────────────────────────────────

describe('form reset', () => {
  it('resets the denominazione input when modal is re-opened after being closed', async () => {
    const wrapper = mountModal();
    const input = wrapper.find('input[placeholder="Es. Mario Rossi / Rossi S.r.l."]');
    await input.setValue('Test Company');
    expect(input.element.value).toBe('Test Company');

    // Close and re-open the modal.
    await wrapper.setProps({ show: false });
    await wrapper.setProps({ show: true });
    await flushPromises();

    expect(wrapper.find('input[placeholder="Es. Mario Rossi / Rossi S.r.l."]').element.value).toBe('');
  });

  it('clears validation error when modal is re-opened', async () => {
    const wrapper = mountModal();
    // Trigger a validation error.
    await fillAndConfirm(wrapper, { 'Es. Mario Rossi / Rossi S.r.l.': '' });
    expect(wrapper.text()).toContain('Denominazione obbligatoria');

    // Close and re-open.
    await wrapper.setProps({ show: false });
    await wrapper.setProps({ show: true });
    await flushPromises();

    expect(wrapper.text()).not.toContain('Denominazione obbligatoria');
  });
});
