/**
 * @file __tests__/server.fiscal.test.js
 * @description Test isolato per la composizione del messaggio di errore quando
 * la stampante fiscale risponde HTTP 200 ma con success=false (fallimento a
 * livello applicativo). Il server ora espone `buildFiscalErrorMessage`, che
 * ricava un errore leggibile dal code/status fpmate invece di un generico
 * "HTTP 200" senza motivo.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildFiscalErrorMessage } = require('../server.js');

describe('buildFiscalErrorMessage (fiscal application-level failure)', () => {
  it('builds the message from the fpmate code', () => {
    expect(buildFiscalErrorMessage({ code: 'PRINTER ERROR', status: '0' })).toBe(
      'Errore stampante fiscale: PRINTER ERROR'
    );
  });

  it('falls back to status when code is empty/blank', () => {
    expect(buildFiscalErrorMessage({ code: '   ', status: '3' })).toBe(
      'Errore stampante fiscale: status 3'
    );
  });

  it('returns a generic message when neither code nor status is present', () => {
    expect(buildFiscalErrorMessage({ code: '', status: '' })).toBe(
      'Errore stampante fiscale.'
    );
    expect(buildFiscalErrorMessage({})).toBe('Errore stampante fiscale.');
    expect(buildFiscalErrorMessage(null)).toBe('Errore stampante fiscale.');
  });

  it('ignores non-string code/status values', () => {
    expect(buildFiscalErrorMessage({ code: 5, status: 2 })).toBe(
      'Errore stampante fiscale.'
    );
  });
});

