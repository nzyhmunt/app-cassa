/**
 * @file reportOps.test.js
 * @description Unit tests for the fiscal/invoice session-filtering logic
 * inside _buildDailySummary() (exposed via generateXReport()).
 *
 * The suite verifies:
 *  - No session boundary → all entries included.
 *  - Entries strictly before the Z-close are excluded.
 *  - Entries strictly after the Z-close are included.
 *  - Boundary case: entry whose timestamp equals the Z-close is included (>=).
 *  - Counts and totals are summed correctly.
 *  - fiscalReceipts/invoiceRequests absent/empty → counts/totals default to 0.
 *  - byMethod contains only amountPaid (tips excluded from scontrino).
 *  - tipsByMethod correctly splits embedded tips and standalone tip transactions.
 *  - totalReceived excludes tips; totalTips matches tipsByMethod totals.
 *  - finalBalance = cashBalance + totalReceived + totalTips + totalMovements.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref } from 'vue';
import { makeReportOps } from '../reportOps.js';

// Minimal stub for getTableStatus (not exercised by these tests).
const helpers = { getTableStatus: () => ({ status: 'free' }) };

// Build a minimal state object to pass into makeReportOps().
function makeState({
  orders = [],
  dailyClosures = [],
  fiscalReceipts = [],
  invoiceRequests = [],
  transactions = [],
  cashBalance = 0,
  cashMovements = [],
  config = { tables: [] },
} = {}) {
  return {
    orders: ref(orders),
    transactions: ref(transactions),
    cashBalance: ref(cashBalance),
    cashMovements: ref(cashMovements),
    config: ref(config),
    dailyClosures: ref(dailyClosures),
    fiscalReceipts: ref(fiscalReceipts),
    invoiceRequests: ref(invoiceRequests),
  };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const TS_BEFORE = '2024-01-15T10:00:00.000Z'; // before Z-close
const TS_CLOSE  = '2024-01-15T12:00:00.000Z'; // exact Z-close timestamp
const TS_AFTER  = '2024-01-15T14:00:00.000Z'; // after Z-close

function fiscal(timestamp, totalAmount) {
  return { id: `fr_${timestamp}`, timestamp, totalAmount };
}
function invoice(timestamp, totalAmount) {
  return { id: `inv_${timestamp}`, timestamp, totalAmount };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateXReport() – fiscal/invoice session filtering', () => {

  it('includes all entries when there are no previous Z-closures', () => {
    const state = makeState({
      fiscalReceipts:  [fiscal(TS_BEFORE, 10), fiscal(TS_AFTER, 20)],
      invoiceRequests: [invoice(TS_BEFORE, 5)],
    });
    const { generateXReport } = makeReportOps(state, helpers);
    const report = generateXReport();

    expect(report.fiscalCount).toBe(2);
    expect(report.fiscalTotal).toBeCloseTo(30);
    expect(report.invoiceCount).toBe(1);
    expect(report.invoiceTotal).toBeCloseTo(5);
  });

  it('excludes entries that were created before the last Z-close', () => {
    const state = makeState({
      dailyClosures:   [{ timestamp: TS_CLOSE, type: 'Z' }],
      fiscalReceipts:  [fiscal(TS_BEFORE, 10)],
      invoiceRequests: [invoice(TS_BEFORE, 7)],
    });
    const { generateXReport } = makeReportOps(state, helpers);
    const report = generateXReport();

    expect(report.fiscalCount).toBe(0);
    expect(report.fiscalTotal).toBe(0);
    expect(report.invoiceCount).toBe(0);
    expect(report.invoiceTotal).toBe(0);
  });

  it('includes entries created after the last Z-close', () => {
    const state = makeState({
      dailyClosures:   [{ timestamp: TS_CLOSE, type: 'Z' }],
      fiscalReceipts:  [fiscal(TS_AFTER, 30)],
      invoiceRequests: [invoice(TS_AFTER, 15)],
    });
    const { generateXReport } = makeReportOps(state, helpers);
    const report = generateXReport();

    expect(report.fiscalCount).toBe(1);
    expect(report.fiscalTotal).toBeCloseTo(30);
    expect(report.invoiceCount).toBe(1);
    expect(report.invoiceTotal).toBeCloseTo(15);
  });

  it('includes an entry whose timestamp equals the Z-close timestamp (boundary >=)', () => {
    const state = makeState({
      dailyClosures:   [{ timestamp: TS_CLOSE, type: 'Z' }],
      fiscalReceipts:  [fiscal(TS_CLOSE, 50)],
      invoiceRequests: [invoice(TS_CLOSE, 25)],
    });
    const { generateXReport } = makeReportOps(state, helpers);
    const report = generateXReport();

    expect(report.fiscalCount).toBe(1);
    expect(report.fiscalTotal).toBeCloseTo(50);
    expect(report.invoiceCount).toBe(1);
    expect(report.invoiceTotal).toBeCloseTo(25);
  });

  it('uses only the last Z-closure as the session boundary (ignores earlier closures)', () => {
    const TS_OLD_CLOSE = '2024-01-15T08:00:00.000Z';
    // entry_mid is between the two closures → excluded because it is before TS_CLOSE
    const TS_MID = '2024-01-15T09:00:00.000Z';
    const state = makeState({
      dailyClosures:  [
        { timestamp: TS_OLD_CLOSE, type: 'Z' },
        { timestamp: TS_CLOSE,     type: 'Z' },
      ],
      fiscalReceipts:  [fiscal(TS_MID, 99), fiscal(TS_AFTER, 40)],
      invoiceRequests: [],
    });
    const { generateXReport } = makeReportOps(state, helpers);
    const report = generateXReport();

    // Only TS_AFTER (>= TS_CLOSE) should be included
    expect(report.fiscalCount).toBe(1);
    expect(report.fiscalTotal).toBeCloseTo(40);
  });

  it('sums totals across multiple session entries correctly', () => {
    const state = makeState({
      dailyClosures:  [{ timestamp: TS_CLOSE, type: 'Z' }],
      fiscalReceipts: [
        fiscal(TS_AFTER, 10.5),
        fiscal(TS_AFTER, 20.25),
        fiscal(TS_BEFORE, 999), // excluded
      ],
      invoiceRequests: [
        invoice(TS_AFTER, 5),
        invoice(TS_AFTER, 7.75),
      ],
    });
    const { generateXReport } = makeReportOps(state, helpers);
    const report = generateXReport();

    expect(report.fiscalCount).toBe(2);
    expect(report.fiscalTotal).toBeCloseTo(30.75);
    expect(report.invoiceCount).toBe(2);
    expect(report.invoiceTotal).toBeCloseTo(12.75);
  });

  it('returns zero counts/totals when fiscalReceipts and invoiceRequests are empty', () => {
    const state = makeState({
      dailyClosures: [{ timestamp: TS_CLOSE, type: 'Z' }],
    });
    const { generateXReport } = makeReportOps(state, helpers);
    const report = generateXReport();

    expect(report.fiscalCount).toBe(0);
    expect(report.fiscalTotal).toBe(0);
    expect(report.invoiceCount).toBe(0);
    expect(report.invoiceTotal).toBe(0);
  });

  it('handles entries with missing totalAmount gracefully (defaults to 0)', () => {
    const state = makeState({
      dailyClosures:  [{ timestamp: TS_CLOSE, type: 'Z' }],
      fiscalReceipts: [{ id: 'fr_no_amount', timestamp: TS_AFTER }],
      invoiceRequests: [{ id: 'inv_no_amount', timestamp: TS_AFTER }],
    });
    const { generateXReport } = makeReportOps(state, helpers);
    const report = generateXReport();

    expect(report.fiscalCount).toBe(1);
    expect(report.fiscalTotal).toBe(0);
    expect(report.invoiceCount).toBe(1);
    expect(report.invoiceTotal).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// byMethod / tipsByMethod scorporo tests
// ---------------------------------------------------------------------------
describe('generateXReport() – scorporo mance da scontrino', () => {

  let _txnCounter = 0;
  function txn(overrides) {
    return {
      id: `txn_test_${++_txnCounter}`,
      tableId: 't1',
      billSessionId: 'bill_1',
      paymentMethod: 'Contanti',
      operationType: 'unico',
      amountPaid: 0,
      timestamp: TS_AFTER,
      ...overrides,
    };
  }

  it('byMethod includes only amountPaid, not tipAmount', () => {
    const state = makeState({
      transactions: [
        txn({ paymentMethod: 'Contanti', amountPaid: 50, tipAmount: 5 }),
      ],
    });
    const { generateXReport } = makeReportOps(state, helpers);
    const report = generateXReport();

    expect(report.byMethod['Contanti']).toBeCloseTo(50);
    expect(report.totalReceived).toBeCloseTo(50);
  });

  it('tipsByMethod captures embedded tip on the correct payment method', () => {
    const state = makeState({
      transactions: [
        txn({ paymentMethod: 'Contanti', amountPaid: 40, tipAmount: 3 }),
        txn({ paymentMethod: 'POS', amountPaid: 60, tipAmount: 2 }),
      ],
    });
    const { generateXReport } = makeReportOps(state, helpers);
    const report = generateXReport();

    expect(report.tipsByMethod['Contanti']).toBeCloseTo(3);
    expect(report.tipsByMethod['POS']).toBeCloseTo(2);
    expect(report.totalTips).toBeCloseTo(5);
    expect(report.totalReceived).toBeCloseTo(100);
  });

  it('standalone tip transaction (operationType=tip) goes into tipsByMethod, not byMethod', () => {
    const state = makeState({
      transactions: [
        txn({ paymentMethod: 'Contanti', amountPaid: 80 }),
        txn({ paymentMethod: 'Mancia', operationType: 'tip', amountPaid: 0, tipAmount: 10 }),
      ],
    });
    const { generateXReport } = makeReportOps(state, helpers);
    const report = generateXReport();

    expect(report.byMethod['Contanti']).toBeCloseTo(80);
    expect(report.byMethod['Mancia']).toBeUndefined();
    expect(report.tipsByMethod['Mancia']).toBeCloseTo(10);
    expect(report.totalTips).toBeCloseTo(10);
    expect(report.totalReceived).toBeCloseTo(80);
  });

  it('finalBalance = cashBalance + totalReceived + totalTips + totalMovements', () => {
    const state = makeState({
      cashBalance: 100,
      cashMovements: [{ id: 'm1', type: 'deposit', amount: 20, timestamp: TS_AFTER, reason: '' }],
      transactions: [
        txn({ paymentMethod: 'Contanti', amountPaid: 50, tipAmount: 5 }),
        txn({ paymentMethod: 'POS', amountPaid: 30 }),
      ],
    });
    const { generateXReport } = makeReportOps(state, helpers);
    const report = generateXReport();

    // finalBalance = 100 (fondo) + 80 (scontrini) + 5 (mance) + 20 (movimenti) = 205
    expect(report.finalBalance).toBeCloseTo(205);
    expect(report.totalReceived).toBeCloseTo(80);
    expect(report.totalTips).toBeCloseTo(5);
  });

  it('discount transactions do not appear in byMethod or tipsByMethod', () => {
    const state = makeState({
      transactions: [
        txn({ paymentMethod: 'Contanti', amountPaid: 100 }),
        txn({ paymentMethod: 'Sconto', operationType: 'discount', amountPaid: 10 }),
      ],
    });
    const { generateXReport } = makeReportOps(state, helpers);
    const report = generateXReport();

    expect(report.byMethod['Sconto']).toBeUndefined();
    expect(report.tipsByMethod['Sconto']).toBeUndefined();
    expect(report.totalDiscount).toBeCloseTo(10);
    expect(report.totalReceived).toBeCloseTo(100);
  });

  it('averageReceipt is based on totalReceived without tips', () => {
    // Two bill sessions paying 50 each with 5 tip each
    const state = makeState({
      transactions: [
        txn({ tableId: 't1', billSessionId: 'b1', paymentMethod: 'Contanti', amountPaid: 50, tipAmount: 5 }),
        txn({ tableId: 't2', billSessionId: 'b2', paymentMethod: 'Contanti', amountPaid: 50, tipAmount: 5 }),
      ],
    });
    const { generateXReport } = makeReportOps(state, helpers);
    const report = generateXReport();

    // receiptCount = 2, totalReceived = 100, averageReceipt = 50 (not 55)
    expect(report.receiptCount).toBe(2);
    expect(report.averageReceipt).toBeCloseTo(50);
  });
});

describe('closedBills', () => {
  it('includes a closed bill session with no transactions (importo 0)', () => {
    const state = makeState({
      orders: [
        {
          id: 'ord_zero_1',
          table: 'T1',
          billSessionId: 'bill_zero_1',
          status: 'completed',
          orderItems: [{ uid: 'it1', name: 'Acqua', quantity: 1, voidedQuantity: 1, unitPrice: 2 }],
        },
      ],
      transactions: [],
      config: { tables: [{ id: 'T1', label: '01', covers: 2 }] },
    });
    const { closedBills } = makeReportOps(state, {
      getTableStatus: () => ({ status: 'free' }),
    });

    expect(closedBills.value).toHaveLength(1);
    expect(closedBills.value[0]).toMatchObject({
      tableId: 'T1',
      billSessionId: 'bill_zero_1',
      totalPaid: 0,
      totalDiscount: 0,
    });
    expect(closedBills.value[0].transactions).toEqual([]);
    expect(closedBills.value[0].orders).toHaveLength(1);
  });

  it('keeps transaction-based totals and groups orders by bill session', () => {
    const state = makeState({
      orders: [
        {
          id: 'ord_paid_1',
          table: 'T1',
          billSessionId: 'bill_paid_1',
          status: 'completed',
          orderItems: [{ uid: 'it2', name: 'Pasta', quantity: 1, voidedQuantity: 0, unitPrice: 10 }],
        },
      ],
      transactions: [
        {
          id: 'txn_paid_1',
          tableId: 'T1',
          billSessionId: 'bill_paid_1',
          operationType: 'unico',
          amountPaid: 10,
          tipAmount: 0,
          timestamp: TS_AFTER,
        },
        {
          id: 'txn_disc_1',
          tableId: 'T1',
          billSessionId: 'bill_paid_1',
          operationType: 'discount',
          amountPaid: 2,
          tipAmount: 0,
          timestamp: TS_AFTER,
        },
      ],
      config: { tables: [{ id: 'T1', label: '01', covers: 2 }] },
    });
    const { closedBills } = makeReportOps(state, {
      getTableStatus: () => ({ status: 'free' }),
    });

    expect(closedBills.value).toHaveLength(1);
    expect(closedBills.value[0]).toMatchObject({
      tableId: 'T1',
      billSessionId: 'bill_paid_1',
      totalPaid: 10,
      totalDiscount: 2,
      totalTips: 0,
    });
    expect(closedBills.value[0].orders).toHaveLength(1);
  });
});

describe('performDailyClose() – persistenza IDB e sync queue', () => {
  it('persists daily closure and by-method rows before resetting in-memory counters', async () => {
    const upsertRecordsIntoIDB = vi.fn(async () => {});
    const enqueue = vi.fn();
    const state = makeState({
      cashBalance: 100,
      cashMovements: [{ id: 'mov_1', type: 'deposit', amount: 20, timestamp: TS_AFTER, reason: '' }],
      transactions: [
        {
          id: 'txn_close_1',
          tableId: 'T1',
          billSessionId: 'bill_close_1',
          paymentMethodId: 'cash',
          paymentMethod: 'Contanti',
          operationType: 'unico',
          amountPaid: 50,
          tipAmount: 5,
          timestamp: TS_AFTER,
        },
      ],
      config: {
        directus: { venueId: 77 },
        tables: [{ id: 'T1', covers: 2 }],
        paymentMethods: [{ id: 'cash', label: 'Contanti' }],
      },
    });

    const { performDailyClose } = makeReportOps(state, {
      getTableStatus: () => ({ status: 'free' }),
      upsertRecordsIntoIDB,
      enqueue,
    });
    const closure = await performDailyClose();

    expect(state.dailyClosures.value).toHaveLength(1);
    expect(state.transactions.value).toEqual([]);
    expect(state.cashMovements.value).toEqual([]);
    expect(state.cashBalance.value).toBeCloseTo(175);

    const [firstUpsertCall, secondUpsertCall] = upsertRecordsIntoIDB.mock.calls;
    expect(firstUpsertCall[0]).toBe('daily_closures');
    expect(firstUpsertCall[1]).toHaveLength(1);
    expect(firstUpsertCall[1][0]).toMatchObject({
      id: closure.id,
      closure_type: 'Z',
      venue: 77,
      totalReceived: 50,
      totalTips: 5,
      totalMovements: 20,
      finalBalance: 175,
    });
    expect(secondUpsertCall[0]).toBe('daily_closure_by_method');
    expect(secondUpsertCall[1]).toHaveLength(1);
    expect(secondUpsertCall[1][0]).toMatchObject({
      daily_closure: closure.id,
      payment_method: 'cash',
      amount: 50,
      venue: 77,
    });

    expect(enqueue).toHaveBeenCalledWith(
      'daily_closures',
      'create',
      closure.id,
      expect.objectContaining({ id: closure.id, closure_type: 'Z' }),
    );
    expect(enqueue).toHaveBeenCalledWith(
      'daily_closure_by_method',
      'create',
      secondUpsertCall[1][0].id,
      expect.objectContaining({
        id: secondUpsertCall[1][0].id,
        daily_closure: closure.id,
        payment_method: 'cash',
      }),
    );
  });
});
