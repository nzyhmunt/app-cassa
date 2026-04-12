/**
 * @file __tests__/printer.env.test.js
 * @description Unit test per loadPrintersFromEnv() — configurazione stampanti
 * tramite variabili d'ambiente PRINTER_<N>_*.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { loadPrintersFromEnv } = require('../printer.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Imposta le variabili d'ambiente per N stampanti e le rimuove dopo il test.
 * @param {object[]} printers — array di oggetti PRINTER_<N>_* (chiavi senza prefisso)
 * @returns {() => void} cleanup function
 */
function withPrinterEnv(printers) {
  const keys = [];
  printers.forEach((p, n) => {
    Object.entries(p).forEach(([key, value]) => {
      const envKey = `PRINTER_${n}_${key}`;
      process.env[envKey] = String(value);
      keys.push(envKey);
    });
  });
  return () => keys.forEach(k => delete process.env[k]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('loadPrintersFromEnv — no env vars', () => {
  it('returns an empty array when no PRINTER_* env vars are set', () => {
    expect(loadPrintersFromEnv()).toEqual([]);
  });
});

describe('loadPrintersFromEnv — TCP printer', () => {
  let cleanup;
  afterEach(() => cleanup?.());

  it('parses a single TCP printer with all fields', () => {
    cleanup = withPrinterEnv([{
      ID: 'cucina', NAME: 'Cucina', TYPE: 'tcp',
      HOST: '192.168.1.100', PORT: '9100', TIMEOUT: '5000',
    }]);
    const printers = loadPrintersFromEnv();
    expect(printers).toHaveLength(1);
    expect(printers[0]).toEqual({
      id: 'cucina', name: 'Cucina', type: 'tcp',
      host: '192.168.1.100', port: 9100, timeout: 5000,
    });
  });

  it('applies TCP defaults when HOST/PORT/TIMEOUT are omitted', () => {
    cleanup = withPrinterEnv([{ ID: 'bar' }]);
    const printers = loadPrintersFromEnv();
    expect(printers).toHaveLength(1);
    expect(printers[0]).toMatchObject({
      id: 'bar', name: 'bar', type: 'tcp',
      host: '127.0.0.1', port: 9100, timeout: 5000,
    });
  });

  it('falls back to default port/timeout when env values are non-numeric', () => {
    cleanup = withPrinterEnv([{ ID: 'test', TYPE: 'tcp', HOST: '10.0.0.1', PORT: 'abc', TIMEOUT: 'xyz' }]);
    const printers = loadPrintersFromEnv();
    expect(printers[0].port).toBe(9100);
    expect(printers[0].timeout).toBe(5000);
  });

  it('converts PORT and TIMEOUT to numbers', () => {
    cleanup = withPrinterEnv([{ ID: 'cassa', TYPE: 'tcp', HOST: '10.0.0.1', PORT: '9200', TIMEOUT: '3000' }]);
    const printers = loadPrintersFromEnv();
    expect(typeof printers[0].port).toBe('number');
    expect(typeof printers[0].timeout).toBe('number');
    expect(printers[0].port).toBe(9200);
    expect(printers[0].timeout).toBe(3000);
  });
});

describe('loadPrintersFromEnv — file printer', () => {
  let cleanup;
  afterEach(() => cleanup?.());

  it('parses a file printer with device path', () => {
    cleanup = withPrinterEnv([{ ID: 'usb', TYPE: 'file', DEVICE: '/dev/usb/lp0' }]);
    const printers = loadPrintersFromEnv();
    expect(printers).toHaveLength(1);
    expect(printers[0]).toEqual({ id: 'usb', name: 'usb', type: 'file', device: '/dev/usb/lp0' });
  });

  it('applies default device path when DEVICE is omitted', () => {
    cleanup = withPrinterEnv([{ ID: 'usb', TYPE: 'file' }]);
    const printers = loadPrintersFromEnv();
    expect(printers[0].device).toBe('/dev/usb/lp0');
  });

  it('file printer does not include tcp fields', () => {
    cleanup = withPrinterEnv([{ ID: 'usb', TYPE: 'file', DEVICE: '/dev/usb/lp1' }]);
    const printers = loadPrintersFromEnv();
    expect(printers[0].host).toBeUndefined();
    expect(printers[0].port).toBeUndefined();
  });
});

describe('loadPrintersFromEnv — multiple printers', () => {
  let cleanup;
  afterEach(() => cleanup?.());

  it('parses multiple printers in order', () => {
    cleanup = withPrinterEnv([
      { ID: 'cucina', TYPE: 'tcp', HOST: '10.0.0.1' },
      { ID: 'bar',    TYPE: 'tcp', HOST: '10.0.0.2' },
      { ID: 'usb',    TYPE: 'file', DEVICE: '/dev/usb/lp0' },
    ]);
    const printers = loadPrintersFromEnv();
    expect(printers).toHaveLength(3);
    expect(printers.map(p => p.id)).toEqual(['cucina', 'bar', 'usb']);
  });

  it('stops at the first gap in the sequence', () => {
    // Set PRINTER_0 and PRINTER_2 but skip PRINTER_1
    process.env.PRINTER_0_ID = 'cucina';
    process.env.PRINTER_2_ID = 'bar';
    try {
      const printers = loadPrintersFromEnv();
      // Should only return the first printer (stops at missing PRINTER_1)
      expect(printers).toHaveLength(1);
      expect(printers[0].id).toBe('cucina');
    } finally {
      delete process.env.PRINTER_0_ID;
      delete process.env.PRINTER_2_ID;
    }
  });
});
