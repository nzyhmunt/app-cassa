/**
 * @file __tests__/fiscal_receipt.test.js
 * @description Unit test per i formatter XML fiscali (formatters/fiscal_receipt.js)
 * e per il client fpmate (fpmate-client.js): generazione XML, envelope SOAP,
 * parsing risposte, build URL.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  buildFiscalXml,
  formatFiscalReceipt,
  formatFiscalRefund,
  formatFiscalVoid,
  formatZReport,
  formatXReport,
  formatStatusQuery,
  formatDuplicateReceipt,
  formatOpenDrawer,
  formatRecCash,
  normalizeRefDate,
  formatAmount,
  formatQuantity,
  paymentTypeFromLabel,
  escXml,
} = require('../formatters/fiscal_receipt.js');
const {
  wrapSoapEnvelope,
  buildFpmateUrl,
  parseFiscalResponse,
  extractTagContent,
} = require('../fpmate-client.js');

// ── Helpers ──────────────────────────────────────────────────────────────────

const minimalReceiptJob = {
  printType: 'fiscal_receipt',
  orders: [{ items: [{ name: 'Panino', quantity: 2, unitPrice: 6.5, department: 1 }] }],
  payments: [{ label: 'Contanti', amount: 13 }],
  totalAmount: 13,
};

// ── formatFiscalReceipt ──────────────────────────────────────────────────────

describe('formatFiscalReceipt', () => {
  it('builds a valid printerFiscalReceipt XML for a minimal sale', () => {
    const xml = formatFiscalReceipt(minimalReceiptJob);
    expect(xml).toContain('<printerFiscalReceipt>');
    expect(xml).toContain('</printerFiscalReceipt>');
    expect(xml).toContain('<beginFiscalReceipt operator="1" />');
    expect(xml).toContain('<endFiscalReceipt operator="1" />');
    // printRecItem with comma decimal separators (Italian convention)
    expect(xml).toContain('<printRecItem operator="1" description="Panino" quantity="2,000" unitPrice="6,50" department="1" justification="1" />');
    // printRecTotal cash → paymentType 0
    expect(xml).toContain('<printRecTotal operator="1" description="Contanti" payment="13,00" paymentType="0" justification="2" />');
  });

  it('uses paymentType 2 for card/electronic payments', () => {
    const xml = formatFiscalReceipt({
      orders: [{ items: [{ name: 'Caffè', quantity: 1, unitPrice: 1 }] }],
      payments: [{ label: 'Bancomat', amount: 1 }],
    });
    expect(xml).toContain('paymentType="2"');
  });

  it('emits one printRecTotal per partial payment', () => {
    const xml = formatFiscalReceipt({
      orders: [{ items: [{ name: 'Pizza', quantity: 1, unitPrice: 10 }] }],
      payments: [
        { label: 'Contanti', amount: 6 },
        { label: 'Carta', amount: 4 },
      ],
    });
    const totals = xml.match(/<printRecTotal /g) || [];
    expect(totals.length).toBe(2);
    expect(xml).toContain('payment="6,00"');
    expect(xml).toContain('payment="4,00"');
  });

  it('defaults department to 1 when not specified', () => {
    const xml = formatFiscalReceipt({
      orders: [{ items: [{ name: 'Acqua', quantity: 1, unitPrice: 2 }] }],
      payments: [{ label: 'Contanti', amount: 2 }],
    });
    expect(xml).toContain('department="1"');
  });

  it('escapes XML special characters in item names and payment labels', () => {
    const xml = formatFiscalReceipt({
      orders: [{ items: [{ name: 'Panino <vegano> & "speciale"', quantity: 1, unitPrice: 5 }] }],
      payments: [{ label: "Carta d'acquisto", amount: 5 }],
    });
    expect(xml).not.toContain('<vegano>');
    expect(xml).toContain('&lt;vegano&gt;');
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&quot;');
    expect(xml).toContain('&apos;');
  });

  it('includes header and trailer lines around beginFiscalReceipt', () => {
    const xml = formatFiscalReceipt({
      orders: [{ items: [{ name: 'X', quantity: 1, unitPrice: 1 }] }],
      payments: [{ label: 'Contanti', amount: 1 }],
      headerLines: ['Pizzeria Da Mario'],
      trailerLines: ['Grazie e arrivederci'],
    });
    // header messageType 1 must precede beginFiscalReceipt
    const headerIdx = xml.indexOf('messageType="1"');
    const beginIdx = xml.indexOf('<beginFiscalReceipt');
    expect(headerIdx).toBeGreaterThan(-1);
    expect(beginIdx).toBeGreaterThan(-1);
    expect(headerIdx).toBeLessThan(beginIdx);
    expect(xml).toContain('messageType="3"');
    expect(xml).toContain('Pizzeria Da Mario');
    expect(xml).toContain('Grazie e arrivederci');
  });

  it('throws when there are no sale items', () => {
    expect(() => formatFiscalReceipt({
      orders: [{ items: [] }],
      payments: [{ label: 'Contanti', amount: 1 }],
    })).toThrow(/almeno una voce/i);
  });

  it('throws when there are no payments', () => {
    expect(() => formatFiscalReceipt({
      orders: [{ items: [{ name: 'X', quantity: 1, unitPrice: 1 }] }],
      payments: [],
    })).toThrow(/almeno un pagamento/i);
  });

  it('accepts a custom operator', () => {
    const xml = formatFiscalReceipt({
      operator: 5,
      orders: [{ items: [{ name: 'X', quantity: 1, unitPrice: 1 }] }],
      payments: [{ label: 'Contanti', amount: 1 }],
    });
    expect(xml).toContain('operator="5"');
  });
});

// ── Reports ──────────────────────────────────────────────────────────────────

describe('formatZReport / formatXReport', () => {
  it('builds a Z report with default 30s timeout', () => {
    const xml = formatZReport({});
    expect(xml).toContain('<printerFiscalReport>');
    expect(xml).toContain('<printZReport operator="1" timeout="30000" />');
  });

  it('builds an X report without timeout attribute', () => {
    const xml = formatXReport({});
    expect(xml).toContain('<printXReport operator="1" />');
    expect(xml).not.toContain('timeout');
  });

  it('honours a custom timeout and operator on Z report', () => {
    const xml = formatZReport({ operator: 2, timeout: 60000 });
    expect(xml).toContain('operator="2" timeout="60000"');
  });
});

// ── Status query ─────────────────────────────────────────────────────────────

describe('formatStatusQuery', () => {
  it('defaults to basic status (statusType 0)', () => {
    const xml = formatStatusQuery({});
    expect(xml).toContain('<printerCommand>');
    expect(xml).toContain('statusType="0"');
  });

  it('supports RT status (statusType 1)', () => {
    const xml = formatStatusQuery({ statusType: '1' });
    expect(xml).toContain('statusType="1"');
  });
});

// ── buildFiscalXml dispatch ──────────────────────────────────────────────────

describe('buildFiscalXml dispatch', () => {
  it('routes each fiscal printType to its formatter', () => {
    expect(buildFiscalXml({ printType: 'fiscal_receipt', orders: [{ items: [{ name: 'X', quantity: 1, unitPrice: 1 }] }], payments: [{ label: 'Contanti', amount: 1 }] })).toContain('printerFiscalReceipt');
    expect(buildFiscalXml({ printType: 'fiscal_z_report' })).toContain('printZReport');
    expect(buildFiscalXml({ printType: 'fiscal_x_report' })).toContain('printXReport');
    expect(buildFiscalXml({ printType: 'fiscal_status' })).toContain('queryPrinterStatus');
    expect(buildFiscalXml({ printType: 'fiscal_duplicate' })).toContain('printDuplicateReceipt');
    expect(buildFiscalXml({ printType: 'fiscal_drawer' })).toContain('openDrawer');
    expect(buildFiscalXml({ printType: 'fiscal_cash', direction: 'in', amount: 50 })).toContain('printRecCash');
  });

  it('throws for unsupported printType', () => {
    expect(() => buildFiscalXml({ printType: 'bogus' })).toThrow(/Tipo fiscale non supportato/);
  });
});

// ── formatFiscalVoid (annullo commerciale) ────────────────────────────────────

describe('formatFiscalVoid', () => {
  const ref = { zRepNumber: '0039', fiscalReceiptNumber: '0005', date: '31/01/2024', serialNumber: '99IEB004001' };

  it('emits a VOID printRecMessage with formatted reference line', () => {
    const xml = formatFiscalVoid({ receiptRef: ref });
    expect(xml).toContain('<printerFiscalReceipt>');
    expect(xml).toContain('message="VOID 0039 0005 31012024 99IEB004001"');
    expect(xml).toContain('<endFiscalReceipt operator="1" />');
    expect(xml).toContain('</printerFiscalReceipt>');
  });

  it('pads reference fields to the required widths', () => {
    const xml = formatFiscalVoid({ receiptRef: { zRepNumber: '5', fiscalReceiptNumber: '12', date: '01022024', serialNumber: 'XYZ' } });
    expect(xml).toContain('VOID 0005 0012 01022024 XYZ00000000');
  });

  it('uses default operator 1 when omitted', () => {
    const xml = formatFiscalVoid({ receiptRef: ref });
    expect(xml).toContain('operator="1"');
  });
});

describe('normalizeRefDate', () => {
  it('converts dd/mm/yyyy to ddmmyyyy', () => {
    expect(normalizeRefDate('31/01/2024')).toBe('31012024');
    expect(normalizeRefDate('1/2/24')).toBe('01020224');
  });
  it('passes through already-compact dates padded to 8 digits', () => {
    expect(normalizeRefDate('01022024')).toBe('01022024');
  });
});

// ── formatFiscalRefund (reso merce) ──────────────────────────────────────────

describe('formatFiscalRefund', () => {
  const refundJob = {
    orders: [{ items: [{ name: 'Pasta', quantity: 1, unitPrice: 10, department: 2 }] }],
    payments: [{ label: 'Contanti', amount: 10 }],
    totalAmount: 10,
  };

  it('uses printRecRefund for returned goods', () => {
    const xml = formatFiscalRefund(refundJob);
    expect(xml).toContain('<printRecRefund');
    expect(xml).toContain('description="Pasta"');
    expect(xml).toContain('unitPrice="10,00"');
    expect(xml).toContain('department="2"');
    expect(xml).toContain('<printRecTotal');
  });

  it('prepends a REFUND reference line when receiptRef is provided', () => {
    const xml = formatFiscalRefund({ ...refundJob, receiptRef: { zRepNumber: '39', fiscalReceiptNumber: '5', date: '31/01/2024', serialNumber: '99IEB004001' } });
    expect(xml).toContain('message="REFUND 0039 0005 31012024 99IEB004001"');
  });

  it('throws when no refund items are provided', () => {
    expect(() => formatFiscalRefund({ orders: [], payments: [{ label: 'Contanti', amount: 1 }] })).toThrow();
  });

  it('throws when no payments are provided', () => {
    expect(() => formatFiscalRefund({ orders: refundJob.orders, payments: [] })).toThrow();
  });
});

// ── formatDuplicateReceipt / formatOpenDrawer / formatRecCash ─────────────────

describe('formatDuplicateReceipt', () => {
  it('emits a printerCommand with printDuplicateReceipt', () => {
    const xml = formatDuplicateReceipt({});
    expect(xml).toContain('<printerCommand>');
    expect(xml).toContain('<printDuplicateReceipt operator="1" />');
    expect(xml).toContain('</printerCommand>');
  });
});

describe('formatOpenDrawer', () => {
  it('emits a printerCommand with openDrawer', () => {
    const xml = formatOpenDrawer({ operator: '2' });
    expect(xml).toContain('<openDrawer operator="2" />');
  });
});

describe('formatRecCash', () => {
  it('builds a cash-in movement with default cash form', () => {
    const xml = formatRecCash({ direction: 'in', amount: 100 });
    expect(xml).toContain('<printRecCash operator="1" direction="in" form="cash" amount="100,00" />');
  });
  it('builds a cash-out movement with cheque form', () => {
    const xml = formatRecCash({ direction: 'out', amount: 50, form: 'cheque' });
    expect(xml).toContain('direction="out" form="cheque" amount="50,00"');
  });
  it('defaults direction to in for unknown values', () => {
    const xml = formatRecCash({ direction: 'sideways', amount: 5 });
    expect(xml).toContain('direction="in"');
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────

describe('format helpers', () => {
  it('formatAmount uses Italian comma separator', () => {
    expect(formatAmount(13)).toBe('13,00');
    expect(formatAmount(6.5)).toBe('6,50');
    expect(formatAmount(0)).toBe('0,00');
    expect(formatAmount('12.34')).toBe('12,34');
  });

  it('formatQuantity uses 3 decimals', () => {
    expect(formatQuantity(2)).toBe('2,000');
    expect(formatQuantity(1.5)).toBe('1,500');
    expect(formatQuantity(0)).toBe('1,000'); // zero → fallback 1
    expect(formatQuantity('1.234')).toBe('1,234');
  });

  it('paymentTypeFromLabel detects electronic payments', () => {
    expect(paymentTypeFromLabel('Contanti')).toBe('0');
    expect(paymentTypeFromLabel('Bancomat')).toBe('2');
    expect(paymentTypeFromLabel('Pos/Carta')).toBe('2');
    expect(paymentTypeFromLabel('Visa')).toBe('2');
  });

  it('escXml escapes all required characters', () => {
    expect(escXml('<>&"\'')).toBe('&lt;&gt;&amp;&quot;&apos;');
  });
});

// ── fpmate-client ────────────────────────────────────────────────────────────

describe('wrapSoapEnvelope', () => {
  it('wraps inner XML in a SOAP envelope', () => {
    const out = wrapSoapEnvelope('<printerCommand/>');
    expect(out).toContain('<?xml version="1.0" encoding="utf-8"?>');
    expect(out).toContain('<s:Envelope');
    expect(out).toContain('<s:Body><printerCommand/></s:Body>');
    expect(out.endsWith('</s:Envelope>')).toBe(true);
  });
});

describe('buildFpmateUrl', () => {
  it('builds the base URL without timeout', () => {
    expect(buildFpmateUrl('192.168.1.200')).toBe('http://192.168.1.200/cgi-bin/fpmate.cgi');
  });
  it('appends timeout and port and https', () => {
    expect(buildFpmateUrl('10.0.0.5', { port: 443, https: true, timeout: 12000 }))
      .toBe('https://10.0.0.5:443/cgi-bin/fpmate.cgi?timeout=12000');
  });
});

describe('extractTagContent', () => {
  it('returns the inner text of a tag', () => {
    expect(extractTagContent('<a><b>hello</b></a>', 'b')).toBe('hello');
  });
  it('returns null when the tag is absent', () => {
    expect(extractTagContent('<a></a>', 'b')).toBeNull();
  });
  it('tolerates attributes on the opening tag', () => {
    expect(extractTagContent('<response success="true"><lastCommand>74</lastCommand></response>', 'lastCommand')).toBe('74');
  });
  it('escapes regex metacharacters in the tag name', () => {
    expect(extractTagContent('<a.b+c>dollar.content</a.b+c>', 'a.b+c')).toBe('dollar.content');
    expect(extractTagContent('<a>(x)<value>ok</value></a>(x)', 'value')).toBe('ok');
  });
  it('tolerates a namespace prefix on open and close tags', () => {
    expect(extractTagContent('<ns:foo>bar</ns:foo>', 'foo')).toBe('bar');
    expect(extractTagContent('<x:status code="1">ok</x:status>', 'status')).toBe('ok');
  });
});

describe('parseFiscalResponse', () => {
  it('parses a successful commercial document response', () => {
    const xml = [
      '<response success="true" code="" status="2">',
      '<addInfo>',
      '<elementList>lastCommand,printerStatus,fiscalReceiptNumber,fiscalReceiptAmount,fiscalReceiptDate,fiscalReceiptTime,receiptISODateTime,zRepNumber,serialNumber</elementList>',
      '<lastCommand>74</lastCommand>',
      '<printerStatus>20010</printerStatus>',
      '<fiscalReceiptNumber>5</fiscalReceiptNumber>',
      '<fiscalReceiptAmount>13,00</fiscalReceiptAmount>',
      '<fiscalReceiptDate>21/04/2023</fiscalReceiptDate>',
      '<fiscalReceiptTime>11:35</fiscalReceiptTime>',
      '<receiptISODateTime>20230421T113500</receiptISODateTime>',
      '<zRepNumber>39</zRepNumber>',
      '<serialNumber>99IEB004001</serialNumber>',
      '</addInfo>',
      '</response>',
    ].join('');
    const parsed = parseFiscalResponse(xml);
    expect(parsed.success).toBe(true);
    expect(parsed.code).toBe('');
    expect(parsed.status).toBe('2');
    expect(parsed.addInfo.fiscalReceiptNumber).toBe('5');
    expect(parsed.addInfo.fiscalReceiptAmount).toBe('13,00');
    expect(parsed.addInfo.serialNumber).toBe('99IEB004001');
    expect(parsed.addInfo.zRepNumber).toBe('39');
  });

  it('parses an error response with code', () => {
    const xml = '<response success="false" code="PRINTER ERROR" status="0"><addInfo><elementList>lastCommand,printerStatus</elementList><lastCommand>80</lastCommand><printerStatus>00000</printerStatus></addInfo></response>';
    const parsed = parseFiscalResponse(xml);
    expect(parsed.success).toBe(false);
    expect(parsed.code).toBe('PRINTER ERROR');
    expect(parsed.addInfo.printerStatus).toBe('00000');
  });

  it('parses a Z report response', () => {
    const xml = '<response success="true" code="" status="2"><addInfo><elementList>lastCommand,printerStatus,zRepNumber,dailyAmount,serialNumber</elementList><lastCommand>74</lastCommand><printerStatus>20110</printerStatus><zRepNumber>11</zRepNumber><dailyAmount>332,33</dailyAmount><serialNumber>99IEB004001</serialNumber></addInfo></response>';
    const parsed = parseFiscalResponse(xml);
    expect(parsed.success).toBe(true);
    expect(parsed.addInfo.zRepNumber).toBe('11');
    expect(parsed.addInfo.dailyAmount).toBe('332,33');
  });

  it('returns empty addInfo when no addInfo block is present', () => {
    const parsed = parseFiscalResponse('<response success="true" code="" status="2" />');
    expect(parsed.success).toBe(true);
    expect(parsed.addInfo).toEqual({});
  });
});
