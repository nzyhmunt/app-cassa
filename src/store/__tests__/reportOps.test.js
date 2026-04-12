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
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref } from 'vue';
import { makeReportOps } from '../reportOps.js';

// Minimal stub for getTableStatus (not exercised by these tests).
const helpers = { getTableStatus: () => ({ status: 'free' }) };

// Build a minimal state object to pass into makeReportOps().
function makeState({ dailyClosures = [], fiscalReceipts = [], invoiceRequests = [] } = {}) {
  return {
    orders: ref([]),
    transactions: ref([]),
    cashBalance: ref(0),
    cashMovements: ref([]),
    config: ref({ tables: [] }),
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
