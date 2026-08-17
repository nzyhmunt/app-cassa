/**
 * @file __tests__/printer.test.js
 * @description Unit test per le funzioni di routing stampante (funzioni pure, nessun I/O).
 * I test di serializzazione della coda sono in printer.queue.test.js.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { findPrinterConfig, getPrintersList, printBuffer, setPrinters, _resetPrinterCache } = require('../printer.js');

// ── Test printer fixtures ─────────────────────────────────────────────────────

const TEST_PRINTERS = [
  { id: 'cucina', name: 'Cucina', type: 'tcp',  host: '10.0.0.1', port: 9100, timeout: 500 },
  { id: 'bar',    name: 'Bar',    type: 'tcp',  host: '10.0.0.2', port: 9100, timeout: 500 },
  { id: 'cassa',  name: 'Cassa',  type: 'file', device: '/dev/null' },
];

// ── findPrinterConfig — pure routing logic ────────────────────────────────────

describe('findPrinterConfig — routing and fallback', () => {
  it('resolves the correct printer by id', () => {
    const config = findPrinterConfig(TEST_PRINTERS, 'cucina');
    expect(config.id).toBe('cucina');
    expect(config.host).toBe('10.0.0.1');
  });

  it('resolves a different printer by id', () => {
    const config = findPrinterConfig(TEST_PRINTERS, 'bar');
    expect(config.id).toBe('bar');
    expect(config.host).toBe('10.0.0.2');
  });

  it('resolves a file-type printer by id', () => {
    const config = findPrinterConfig(TEST_PRINTERS, 'cassa');
    expect(config.id).toBe('cassa');
    expect(config.type).toBe('file');
  });

  it('falls back to first printer for an unknown printerId', () => {
    const config = findPrinterConfig(TEST_PRINTERS, 'unknown-printer');
    expect(config.id).toBe('cucina');
  });

  it('falls back to first printer when printerId is undefined', () => {
    const config = findPrinterConfig(TEST_PRINTERS, undefined);
    expect(config.id).toBe('cucina');
  });

  it('returns null when the printer list is empty', () => {
    expect(findPrinterConfig([], 'cucina')).toBeNull();
  });

  it('returns null when the printer list is null', () => {
    expect(findPrinterConfig(null, 'cucina')).toBeNull();
  });
});

// ── getPrintersList ───────────────────────────────────────────────────────────

describe('getPrintersList', () => {
  it('returns an array (empty by default since printers.config.js has no entries)', () => {
    const list = getPrintersList();
    expect(Array.isArray(list)).toBe(true);
  });
});

// ── printBuffer — rejects when no printers configured ─────────────────────────

describe('printBuffer — no printers configured', () => {
  it('rejects with a descriptive error when the config is empty', async () => {
    // Default printers.config.js has no entries; printBuffer should reject
    const buf = Buffer.from([0x1b, 0x40]);
    await expect(printBuffer(buf, 'cucina')).rejects.toThrow('No printers configured');
  });
});

// ── printBuffer — rejects fpmate printers ─────────────────────────────────────
// printBuffer riceve byte ESC/POS; una stampante fpmate accetta solo XML
// fiscale via SOAP. Inviare ESC/POS a fpmate produrrebbe XML/SOAP non valido:
// printBuffer deve rifiutare esplicitamente le stampanti fpmate e indirizzare i
// chiamanti a printFiscal().

describe('printBuffer — rejects fpmate printers', () => {
  afterEach(() => { setPrinters([]); _resetPrinterCache(); });

  it('rejects a fpmate printer with a message pointing to printFiscal()', async () => {
    setPrinters([{ id: 'fiscale', name: 'Epson RT', type: 'fpmate', host: 'http://printer.local' }]);
    const buf = Buffer.from([0x1b, 0x40]);
    await expect(printBuffer(buf, 'fiscale')).rejects.toThrow(/fpmate.*printFiscal/);
  });

  it('also rejects when printerId falls back to a fpmate printer (unknown id)', async () => {
    // findPrinterConfig falls back to the first printer when printerId is
    // missing/unknown: if that first printer is fpmate, printBuffer must still
    // reject rather than send ESC/POS to the fiscal endpoint.
    setPrinters([{ id: 'fiscale', name: 'Epson RT', type: 'fpmate', host: 'http://printer.local' }]);
    const buf = Buffer.from([0x1b, 0x40]);
    await expect(printBuffer(buf, 'unknown-printer')).rejects.toThrow(/fpmate.*printFiscal/);
  });

  it('still accepts ESC/POS for a file printer', async () => {
    // Sanity check: the fpmate guard must not break legitimate ESC/POS printers.
    // Use a file printer to avoid real network I/O.
    setPrinters([{ id: 'cassa', name: 'Cassa', type: 'file', device: '/dev/null' }]);
    const buf = Buffer.from([0x1b, 0x40]);
    await expect(printBuffer(buf, 'cassa')).resolves.toBeUndefined();
  });
});

