/**
 * @file __tests__/printer.queue.test.js
 * @description Test di serializzazione della coda per-stampante.
 *
 * Verifica direttamente l'helper esportato _enqueue (bypassando il registro
 * stampanti) e _dispatch con /dev/null come dispositivo file — nessun mock necessario.
 *
 * Questo evita problemi di interoperabilità CJS/ESM nel module mocking, testando
 * comunque in modo concreto la serializzazione della coda e l'isolamento degli errori.
 *
 * Nota: questi test DEVONO essere in un file separato da printer.test.js perché
 * la Map _queues è un singleton a livello di modulo e potrebbe accumulare stato.
 * Ogni file di test gira nel proprio processo Node.js figlio in Vitest.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const { _enqueue, _dispatch } = require('../printer.js');

// ── Queue serialization ────────────────────────────────────────────────────────

describe('_enqueue — per-printer queue', () => {
  it('dispatches two jobs for the same printer in submission order', async () => {
    const order = [];

    // Each job has a small async delay; the queue must serialize them.
    const makeJob = (label) => () =>
      new Promise((resolve) => setImmediate(() => { order.push(label); resolve(); }));

    await Promise.all([
      _enqueue('q-order-test', makeJob('job-1')),
      _enqueue('q-order-test', makeJob('job-2')),
    ]);

    expect(order).toEqual(['job-1', 'job-2']);
  });

  it('second job still runs after the first job rejects', async () => {
    let count = 0;

    const makeJob = () => () =>
      new Promise((resolve, reject) =>
        setImmediate(() => {
          count++;
          if (count === 1) reject(new Error('first job error'));
          else resolve();
        }),
      );

    const [r1, r2] = await Promise.allSettled([
      _enqueue('q-error-test', makeJob()),
      _enqueue('q-error-test', makeJob()),
    ]);

    expect(r1.status).toBe('rejected');
    expect(r1.reason.message).toMatch('first job error');
    expect(r2.status).toBe('fulfilled');
    expect(count).toBe(2);
  });

  it('jobs for different printers have independent queues', async () => {
    const order = [];

    const makeJob = (label) => () =>
      new Promise((resolve) => setImmediate(() => { order.push(label); resolve(); }));

    await Promise.all([
      _enqueue('q-printer-a', makeJob('a-1')),
      _enqueue('q-printer-b', makeJob('b-1')),
    ]);

    // Both jobs must complete; relative order between queues is not guaranteed
    expect(order).toHaveLength(2);
    expect(order).toContain('a-1');
    expect(order).toContain('b-1');
  });
});

// ── _dispatch — file transport ────────────────────────────────────────────────

describe('_dispatch — file transport', () => {
  let tmpFile;

  afterEach(() => {
    // Rimuovi il file temporaneo dopo ogni test (se esiste)
    if (tmpFile) {
      try { fs.unlinkSync(tmpFile); } catch (_) { /* ignora */ }
      tmpFile = null;
    }
  });

  it('writes to a temp file without error', async () => {
    tmpFile = path.join(os.tmpdir(), `print-server-test-${process.pid}.bin`);
    const config = { id: 'test', type: 'file', device: tmpFile };
    const buf = Buffer.from([0x1b, 0x40, 0x0a]); // ESC @ LF
    await expect(_dispatch(buf, config)).resolves.toBeUndefined();
    // Verifica che il file sia stato scritto con il contenuto corretto
    expect(fs.readFileSync(tmpFile)).toEqual(buf);
  });
});
