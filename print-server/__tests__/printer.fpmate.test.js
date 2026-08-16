/**
 * @file __tests__/printer.fpmate.test.js
 * @description Unit test per il supporto stampanti fiscali fpmate in printer.js:
 * caricamento config da env, dispatch via printFiscal (con sendFiscalRequest
 * mockato), validazione tipo stampante e serializzazione coda.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import http from 'http';

const require = createRequire(import.meta.url);

// vitest's vi.mock does not intercept CJS require() via createRequire in this
// setup, so we exercise printFiscal against a real local HTTP server that
// mimics fpmate.cgi. This keeps the transport code path real (no module mock)
// while remaining hermetic and offline.

const printerModule = require('../printer.js');
const { loadPrintersFromEnv, getPrinterConfig, printFiscal, printViaFpmate, _resetPrinterCache } = printerModule;

// ── Helpers ──────────────────────────────────────────────────────────────────

function clearAllPrinterEnvVars() {
  for (const key of Object.keys(process.env)) {
    if (/^PRINTER_\d+_/.test(key)) delete process.env[key];
  }
}

/**
 * Sets env vars for a single fpmate fiscal printer.
 */
function withFpmateEnv(overrides = {}) {
  const base = {
    ID: 'fiscale',
    NAME: 'Stampante Fiscale',
    TYPE: 'fpmate',
    HOST: '192.168.1.200',
    TIMEOUT: '30000',
    ...overrides,
  };
  clearAllPrinterEnvVars();
  for (const [k, v] of Object.entries(base)) {
    process.env[`PRINTER_0_${k}`] = v;
  }
}

// ── loadPrintersFromEnv ──────────────────────────────────────────────────────

describe('loadPrintersFromEnv — fpmate type', () => {
  beforeEach(() => { clearAllPrinterEnvVars(); _resetPrinterCache(); });
  afterEach(() => { clearAllPrinterEnvVars(); _resetPrinterCache(); });

  it('parses a fpmate printer with sensible defaults', () => {
    withFpmateEnv();
    const [p] = loadPrintersFromEnv();
    expect(p.id).toBe('fiscale');
    expect(p.type).toBe('fpmate');
    expect(p.host).toBe('192.168.1.200');
    expect(p.timeout).toBe(30000);
    expect(p.https).toBe(false);
    expect(p.username).toBe('');
    expect(p.password).toBe('');
    // port defaults to null (→ 80/443)
    expect(p.port).toBeNull();
  });

  it('parses https, port and credentials when provided', () => {
    withFpmateEnv({
      HTTPS: '1',
      PORT: '443',
      USERNAME: 'admin',
      PASSWORD: 'secret',
    });
    const [p] = loadPrintersFromEnv();
    expect(p.https).toBe(true);
    expect(p.port).toBe(443);
    expect(p.username).toBe('admin');
    expect(p.password).toBe('secret');
  });

  it('falls back to default timeout for invalid timeout value', () => {
    withFpmateEnv({ TIMEOUT: 'not-a-number' });
    const [p] = loadPrintersFromEnv();
    expect(p.timeout).toBe(30000);
  });
});

// ── printFiscal dispatch (local fpmate-like HTTP server) ─────────────────────

/**
 * Starts a local HTTP server mimicking fpmate.cgi. Returns the server and a
 * function to set the response body (and status) for the next request.
 */
function startFpmateServer() {
  let nextResponse = '<response success="true" code="" status="2"><addInfo><elementList>lastCommand,printerStatus,fiscalReceiptNumber</elementList><lastCommand>74</lastCommand><printerStatus>20010</printerStatus><fiscalReceiptNumber>1</fiscalReceiptNumber></addInfo></response>';
  let nextStatus = 200;
  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({
        method: req.method,
        url: req.url,
        body: Buffer.concat(chunks).toString('utf8'),
        contentType: req.headers['content-type'],
        ifModifiedSince: req.headers['if-modified-since'],
      });
      res.writeHead(nextStatus, { 'Content-Type': 'text/xml; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(nextResponse);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        port,
        received,
        setResponse: (body, status = 200) => { nextResponse = body; nextStatus = status; },
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

describe('printFiscal dispatch', () => {
  let mock;

  beforeEach(async () => {
    clearAllPrinterEnvVars();
    _resetPrinterCache();
    mock = await startFpmateServer();
  });

  afterEach(async () => {
    clearAllPrinterEnvVars();
    _resetPrinterCache();
    if (mock) await mock.close();
  });

  it('rejects when no printers are configured', async () => {
    clearAllPrinterEnvVars();
    _resetPrinterCache();
    await expect(printFiscal('<x/>', 'fiscale')).rejects.toThrow(/No printers configured/);
  });

  it('rejects when the resolved printer is not fpmate type', async () => {
    process.env.PRINTER_0_ID = 'cucina';
    process.env.PRINTER_0_TYPE = 'tcp';
    process.env.PRINTER_0_HOST = '127.0.0.1';
    process.env.PRINTER_0_PORT = '9100';
    _resetPrinterCache();
    await expect(printFiscal('<x/>', 'cucina')).rejects.toThrow(/non è di tipo fpmate/);
  });

  it('routes an fpmate printer to the fpmate endpoint and parses the response', async () => {
    process.env.PRINTER_0_ID = 'fiscale';
    process.env.PRINTER_0_TYPE = 'fpmate';
    process.env.PRINTER_0_HOST = '127.0.0.1';
    process.env.PRINTER_0_PORT = String(mock.port);
    process.env.PRINTER_0_TIMEOUT = '5000';
    _resetPrinterCache();

    mock.setResponse(
      '<response success="true" code="" status="2"><addInfo><elementList>lastCommand,printerStatus,fiscalReceiptNumber,fiscalReceiptAmount,serialNumber</elementList><lastCommand>74</lastCommand><printerStatus>20010</printerStatus><fiscalReceiptNumber>5</fiscalReceiptNumber><fiscalReceiptAmount>13,00</fiscalReceiptAmount><serialNumber>99IEB004001</serialNumber></addInfo></response>'
    );

    const result = await printFiscal('<printerFiscalReceipt/>', 'fiscale');
    expect(result.success).toBe(true);
    expect(result.addInfo.fiscalReceiptNumber).toBe('5');
    expect(result.addInfo.serialNumber).toBe('99IEB004001');

    // Verify the HTTP request shape against the fpmate.cgi spec.
    expect(mock.received).toHaveLength(1);
    const req = mock.received[0];
    expect(req.method).toBe('POST');
    expect(req.url).toContain('/cgi-bin/fpmate.cgi');
    expect(req.url).toContain('timeout=5000');
    expect(req.contentType).toBe('text/xml; charset=utf-8');
    expect(req.body).toContain('<s:Envelope');
    expect(req.body).toContain('<s:Body>');
    expect(req.body).toContain('<printerFiscalReceipt/>');
    expect(req.ifModifiedSince).toBe('Thu, 01 Jan 1970 00:00:00 GMT');
  });

  it('rejects on HTTP error status', async () => {
    process.env.PRINTER_0_ID = 'fiscale';
    process.env.PRINTER_0_TYPE = 'fpmate';
    process.env.PRINTER_0_HOST = '127.0.0.1';
    process.env.PRINTER_0_PORT = String(mock.port);
    _resetPrinterCache();
    mock.setResponse('boom', 500);
    await expect(printFiscal('<x/>', 'fiscale')).rejects.toThrow(/HTTP 500/);
  });

  it('serializes concurrent fiscal jobs for the same printer', async () => {
    process.env.PRINTER_0_ID = 'fiscale';
    process.env.PRINTER_0_TYPE = 'fpmate';
    process.env.PRINTER_0_HOST = '127.0.0.1';
    process.env.PRINTER_0_PORT = String(mock.port);
    _resetPrinterCache();

    // First request stalls until we release it; second must wait.
    const waitFor = (pred) => new Promise((resolve) => {
      const tick = () => { if (pred()) resolve(); else setImmediate(tick); };
      tick();
    });
    let firstResReady;
    const firstResponsePromise = new Promise((r) => { firstResReady = r; });
    let completeFirst;
    const firstCompletion = new Promise((r) => { completeFirst = r; });
    mock.server.removeAllListeners('request');
    let firstHandlerPending = false;
    mock.server.on('request', (req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        mock.received.push({ method: req.method, url: req.url, body: Buffer.concat(chunks).toString('utf8') });
        if (!firstHandlerPending) {
          firstHandlerPending = true;
          firstResReady();
          // Respond only once the test releases the first job.
          firstCompletion.then(() => {
            res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
            res.end('<response success="true" code="" status="2"><addInfo><elementList>lastCommand</elementList><lastCommand>74</lastCommand></addInfo></response>');
          });
        } else {
          res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
          res.end('<response success="true" code="" status="2"><addInfo><elementList>lastCommand</elementList><lastCommand>74</lastCommand></addInfo></response>');
        }
      });
    });

    const p1 = printFiscal('<a/>', 'fiscale');
    await firstResponsePromise;
    await waitFor(() => mock.received.length === 1);
    expect(mock.received).toHaveLength(1);
    const p2 = printFiscal('<b/>', 'fiscale');
    // Give the second job a chance to (incorrectly) dispatch — it must not.
    await new Promise((r) => setTimeout(r, 50));
    expect(mock.received).toHaveLength(1);

    completeFirst();
    await p1;
    await p2;
    await waitFor(() => mock.received.length === 2);
    expect(mock.received).toHaveLength(2);
  });
});
