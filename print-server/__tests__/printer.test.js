/**
 * @file __tests__/printer.test.js
 * @description Unit test per le funzioni di routing stampante (funzioni pure, nessun I/O).
 * I test di serializzazione della coda sono in printer.queue.test.js.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { findPrinterConfig, getPrintersList, printBuffer } = require('../printer.js');

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

