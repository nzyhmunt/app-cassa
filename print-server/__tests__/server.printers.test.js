'use strict';

/**
 * @file __tests__/server.printers.test.js
 * @description Unit test per GET /printers: verifica che i dettagli di rete
 * (host/port/device) vengano redatti quando PRINT_SERVER_API_KEY non è
 * configurata (CORS aperto di default), ed esposti solo quando l'endpoint è
 * protetto da API key.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Importa server.js come modulo: con require.main !== module il server non
// si mette in ascolto, e possiamo testare la pure helper buildPrinterSummary.
const { buildPrinterSummary } = require('../server.js');

describe('buildPrinterSummary — GET /printers network-detail redaction', () => {
  it('omits host/port/device when not authenticated (no API key)', () => {
    const tcp = buildPrinterSummary(
      { id: 'cucina', name: 'Cucina', type: 'tcp', host: '192.168.1.50', port: 9100 },
      false
    );
    expect(tcp).toEqual({ id: 'cucina', name: 'Cucina', type: 'tcp' });
    expect(tcp).not.toHaveProperty('host');
    expect(tcp).not.toHaveProperty('port');
  });

  it('omits device for file printers when not authenticated', () => {
    const file = buildPrinterSummary(
      { id: 'lp0', name: 'USB', type: 'file', device: '/dev/usb/lp0' },
      false
    );
    expect(file).toEqual({ id: 'lp0', name: 'USB', type: 'file' });
    expect(file).not.toHaveProperty('device');
  });

  it('omits host/port/https for fpmate printers when not authenticated', () => {
    const fpmate = buildPrinterSummary(
      { id: 'fiscale', name: 'Epson RT', type: 'fpmate', host: '192.168.1.200', port: 443, https: true },
      false
    );
    expect(fpmate).toEqual({ id: 'fiscale', name: 'Epson RT', type: 'fpmate' });
    expect(fpmate).not.toHaveProperty('host');
  });

  it('exposes host/port for tcp printers when authenticated (API key set)', () => {
    const tcp = buildPrinterSummary(
      { id: 'cucina', name: 'Cucina', type: 'tcp', host: '192.168.1.50', port: 9100 },
      true
    );
    expect(tcp.host).toBe('192.168.1.50');
    expect(tcp.port).toBe(9100);
  });

  it('exposes host/port/https for fpmate printers when authenticated', () => {
    const fpmate = buildPrinterSummary(
      { id: 'fiscale', name: 'Epson RT', type: 'fpmate', host: '192.168.1.200', port: 443, https: true },
      true
    );
    expect(fpmate.host).toBe('192.168.1.200');
    expect(fpmate.port).toBe(443);
    expect(fpmate.https).toBe(true);
  });

  it('defaults fpmate port to null when authenticated and port unset', () => {
    const fpmate = buildPrinterSummary(
      { id: 'fiscale', name: 'Epson RT', type: 'fpmate', host: '192.168.1.200', https: false },
      true
    );
    expect(fpmate.port).toBeNull();
    expect(fpmate.https).toBe(false);
  });
});
