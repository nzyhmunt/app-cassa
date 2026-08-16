/**
 * @file __tests__/CassaDashboard.void.test.js
 * @description Focused tests for the fiscal VOID flow in CassaDashboard:
 * after a successful void dispatch the original fiscalReceipts entry must be
 * marked as voided in the store (status 'void') so it drops out of
 * voidableReceipts, preventing repeated void attempts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

// Mock useFiscalPrint so we can drive dispatchFiscalVoid to ok/err without
// touching the network, and force resolveFiscalPrinter to return a configured
// printer so the fiscal tab + VOID UI render.
const dispatchFiscalVoidMock = vi.fn();
vi.mock('../../composables/useFiscalPrint.js', () => ({
  dispatchFiscalZReport: vi.fn(),
  dispatchFiscalXReport: vi.fn(),
  dispatchFiscalStatus: vi.fn(),
  dispatchFiscalDuplicate: vi.fn(),
  dispatchFiscalOpenDrawer: vi.fn(),
  dispatchFiscalCash: vi.fn(),
  dispatchFiscalVoid: (...args) => dispatchFiscalVoidMock(...args),
  resolveFiscalPrinter: () => ({ id: 'fiscale', name: 'Epson RT', type: 'fpmate', url: 'http://localhost:3001' }),
}));

// Mock useAuth so isAdmin is true (the fiscal tab is admin-gated in places).
vi.mock('../../composables/useAuth.js', () => ({
  useAuth: () => ({ isAdmin: true, currentUser: { id: 'u1', name: 'Op' } }),
}));

// Mock the IDB persistence layer so the store's auto-hydration resolves
// instantly with an empty array instead of racing fake-indexeddb cursors.
// We only need the fiscal-receipt load/save stubs; the rest are no-ops.
vi.mock('../../store/persistence/audit.js', async () => {
  const actual = await vi.importActual('../../store/persistence/audit.js');
  return {
    ...actual,
    loadFiscalReceiptsFromIDB: async () => [],
    saveFiscalReceiptToIDB: async () => {},
    pruneFiscalReceiptsInIDB: async () => {},
  };
});

// Stub all lucide icons as <span /> to keep the DOM light.
const ICONS = [
  'X', 'Landmark', 'Wallet', 'ArrowLeftRight', 'ArrowDownCircle', 'ArrowUpCircle',
  'Plus', 'Eye', 'AlertTriangle', 'Lock', 'RefreshCw', 'Save', 'TrendingUp',
  'CreditCard', 'Users', 'Receipt', 'History', 'ClipboardList', 'Tag', 'Gift',
  'FileText', 'Printer', 'Copy', 'RotateCcw', 'Coins', 'Info', 'CheckCircle2',
  'XCircle', 'Banknote',
];
const ICON_STUBS = Object.fromEntries(ICONS.map((n) => [n, { template: '<span />' }]));
const NumericInput = { template: '<input />' };

enableAutoUnmount(afterEach);

const VOIDABLE_RECEIPT = {
  id: 'fr-1',
  status: 'done',
  fiscalReceiptNumber: '5',
  zRepNumber: '39',
  fiscalReceiptDate: '31/01/2024',
  serialNumber: '99IEB004001',
  totalAmount: 12.5,
  tableLabel: 'Tavolo 2',
};

async function mountDashboard() {
  const CassaDashboard = (await import('../CassaDashboard.vue')).default;
  return mount(CassaDashboard, {
    props: { modelValue: true },
    global: {
      stubs: { teleport: true, NumericInput, ...ICON_STUBS },
    },
  });
}

describe('CassaDashboard — fiscal VOID marks original receipt as voided', () => {
  let orderStore;

  beforeEach(async () => {
    setActivePinia(createPinia());
    const { useOrderStore } = await import('../../store/index.js');
    orderStore = useOrderStore();
    dispatchFiscalVoidMock.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The store auto-hydrates fiscalReceipts from IDB on init; that async load
  // overwrites fiscalReceipts with the (empty) IDB result. Keep re-seeding
  // until hydration has completed AND the entry is still present afterwards.
  async function seedVoidableReceipt() {
    for (let i = 0; i < 50; i++) {
      if (orderStore.fiscalInvoiceHydrated && orderStore.fiscalReceipts.some((r) => r.id === 'fr-1')) return;
      if (!orderStore.fiscalReceipts.some((r) => r.id === 'fr-1')) {
        orderStore.addFiscalReceipt({ ...VOIDABLE_RECEIPT });
      }
      await flushPromises();
    }
    throw new Error('fiscal receipt fr-1 never persisted into store');
  }

  it('marks the original receipt as void after a successful void dispatch', async () => {
    dispatchFiscalVoidMock.mockResolvedValue({ ok: true, fiscal: { success: true } });
    const wrapper = await mountDashboard();
    await seedVoidableReceipt();

    // Switch to the fiscal tab where the VOID UI lives.
    const fiscalTab = wrapper.findAll('button').find((b) => b.text().includes('Fiscale RT'));
    await fiscalTab.trigger('click');
    await flushPromises();

    // Select the voidable receipt.
    const select = wrapper.find('select');
    expect(select.exists()).toBe(true);
    await select.setValue('fr-1');

    // Click "Emetti Annullo".
    const voidBtn = wrapper.findAll('button').find((b) => b.text().includes('Emetti Annullo'));
    expect(voidBtn.exists()).toBe(true);
    await voidBtn.trigger('click');
    await flushPromises();

    expect(dispatchFiscalVoidMock).toHaveBeenCalledTimes(1);
    const arg = dispatchFiscalVoidMock.mock.calls[0][0];
    expect(arg.receiptRef).toMatchObject({
      zRepNumber: '39',
      fiscalReceiptNumber: '5',
      date: '31/01/2024',
      serialNumber: '99IEB004001',
    });
    // The original store entry is now voided.
    const updated = orderStore.fiscalReceipts.find((r) => r.id === 'fr-1');
    expect(updated.status).toBe('void');
    expect(updated.voidedAt).toBeTruthy();
  });

  it('does NOT mark the receipt voided when the void dispatch fails', async () => {
    dispatchFiscalVoidMock.mockResolvedValue({ ok: false, error: 'Stampante offline' });
    const wrapper = await mountDashboard();
    await seedVoidableReceipt();

    const fiscalTab = wrapper.findAll('button').find((b) => b.text().includes('Fiscale RT'));
    await fiscalTab.trigger('click');
    await flushPromises();

    const select = wrapper.find('select');
    expect(select.exists()).toBe(true);
    await select.setValue('fr-1');

    const voidBtn = wrapper.findAll('button').find((b) => b.text().includes('Emetti Annullo'));
    await voidBtn.trigger('click');
    await flushPromises();

    expect(dispatchFiscalVoidMock).toHaveBeenCalledTimes(1);
    // On failure the entry stays done and remains voidable.
    const entry = orderStore.fiscalReceipts.find((r) => r.id === 'fr-1');
    expect(entry.status).toBe('done');
  });
});
