/**
 * @file __tests__/printer.env.test.js
 * @description Unit test per loadPrintersFromEnv() — configurazione stampanti
 * tramite variabili d'ambiente PRINTER_<N>_*.
 * Include anche test di integrazione per la priorità env vars → printers.config.js
 * in getPrintersList() e getPrinterConfig().
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { loadPrintersFromEnv, getPrintersList, getPrinterConfig } = require('../printer.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Imposta le variabili d'ambiente per N stampanti, salva i valori precedenti
 * e restituisce una funzione di cleanup che ripristina lo stato originale.
 * @param {object[]} printers — array di oggetti PRINTER_<N>_* (chiavi senza prefisso)
 * @returns {() => void} cleanup function
 */
function withPrinterEnv(printers) {
  const saved = {};
  printers.forEach((p, n) => {
    Object.entries(p).forEach(([key, value]) => {
      const envKey = `PRINTER_${n}_${key}`;
      saved[envKey] = process.env[envKey]; // undefined se non esisteva
      process.env[envKey] = String(value);
    });
  });
  return () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

/**
 * Rimuove tutte le variabili d'ambiente PRINTER_* attualmente impostate.
 * Usato in beforeEach per garantire un ambiente pulito prima di ogni test.
 */
function clearAllPrinterEnvVars() {
  for (const key of Object.keys(process.env)) {
    if (/^PRINTER_\d+_/.test(key)) delete process.env[key];
  }
}

// ── Setup globale ─────────────────────────────────────────────────────────────

beforeEach(() => {
  clearAllPrinterEnvVars();
});

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
    const printers = loadPrintersFromEnv();
    // Should only return the first printer (stops at missing PRINTER_1)
    expect(printers).toHaveLength(1);
    expect(printers[0].id).toBe('cucina');
  });
});

// ── Integration: _loadPrinters priority (env vars > printers.config.js) ───────

describe('getPrintersList / getPrinterConfig — env vars take priority', () => {
  let cleanup;
  afterEach(() => cleanup?.());

  it('getPrintersList returns env-configured printers when PRINTER_0_ID is set', () => {
    cleanup = withPrinterEnv([{ ID: 'env-cucina', TYPE: 'tcp', HOST: '10.0.0.1' }]);
    const list = getPrintersList();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('env-cucina');
  });

  it('getPrinterConfig resolves a printer from env vars', () => {
    cleanup = withPrinterEnv([
      { ID: 'env-cucina', TYPE: 'tcp', HOST: '10.0.0.1' },
      { ID: 'env-bar',    TYPE: 'tcp', HOST: '10.0.0.2' },
    ]);
    const cfg = getPrinterConfig('env-bar');
    expect(cfg).not.toBeNull();
    expect(cfg.id).toBe('env-bar');
    expect(cfg.host).toBe('10.0.0.2');
  });

  it('getPrinterConfig falls back to first env printer when id is not found', () => {
    cleanup = withPrinterEnv([{ ID: 'env-cucina', TYPE: 'tcp', HOST: '10.0.0.1' }]);
    const cfg = getPrinterConfig('unknown-id');
    expect(cfg.id).toBe('env-cucina');
  });

  it('getPrintersList falls back to printers.config.js when no PRINTER_0_ID is set', () => {
    // No env vars set — should fall back to printers.config.js
    // The default printers.config.js has an empty array
    const list = getPrintersList();
    expect(Array.isArray(list)).toBe(true);
    // The default config has no entries
    expect(list).toHaveLength(0);
  });
});
