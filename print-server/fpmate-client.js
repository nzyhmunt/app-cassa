'use strict';

/**
 * @file fpmate-client.js
 * @description Transport HTTP/SOAP per la stampante fiscale Epson RT (fpmate.cgi).
 *
 * Il servizio fpmate.cgi risiede nel web server integrato della stampante fiscale
 * e accetta richieste SOAP/HTTP POST con body XML (Fiscal ePOS-Print XML).
 *
 * Endpoint: http(s)://<host>/cgi-bin/fpmate.cgi?timeout=<ms>
 *
 * La busta SOAP viene aggiunta qui attorno all'XML prodotto dai formatter
 * (formatters/fiscal_receipt.js), così i formatter rimangono agnostici al transport.
 *
 * Esporta:
 *   sendFiscalRequest({ xml, host, timeout?, port?, https?, username?, password? })
 *     → Promise<FiscalResponse>
 *
 *   wrapSoapEnvelope(xml)
 *   parseFiscalResponse(xmlString)
 *   buildFpmateUrl(host, opts)
 *
 * FiscalResponse:
 *   { success: boolean, code: string, status: string,
 *     addInfo: object,    // mappa dei campi <addInfo> (fiscalReceiptNumber, …)
 *     raw: string }       // XML risposta completo
 */

const http = require('http');
const https = require('https');

const SOAP_ENVELOPE_PREFIX = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>`;

const SOAP_ENVELOPE_SUFFIX = `</s:Body></s:Envelope>`;

/**
 * Incapsula un XML fiscale in una busta SOAP, come richiesto da fpmate.cgi.
 * @param {string} xml
 * @returns {string}
 */
function wrapSoapEnvelope(xml) {
  return SOAP_ENVELOPE_PREFIX + xml + SOAP_ENVELOPE_SUFFIX;
}

/**
 * Costruisce l'URL del servizio fpmate.cgi.
 * @param {string} host
 * @param {{ port?: number|string, https?: boolean, timeout?: number|string }} opts
 * @returns {string}
 */
function buildFpmateUrl(host, opts = {}) {
  const useHttps = opts.https === true;
  const port = opts.port != null && opts.port !== '' ? `:${opts.port}` : '';
  const base = `${useHttps ? 'https' : 'http'}://${host}${port}/cgi-bin/fpmate.cgi`;
  if (opts.timeout != null && opts.timeout !== '') {
    return `${base}?timeout=${encodeURIComponent(String(opts.timeout))}`;
  }
  return base;
}

/**
 * Estrae il testo contenuto in un tag XML, gestendo i namespace e gli
 * attributi del tag di apertura. Restituisce null se il tag non è presente.
 * @param {string} xml
 * @param {string} tagName
 * @returns {string|null}
 */
function extractTagContent(xml, tagName) {
  // Match <tagName ...>content</tagName> (anche su più righe), tollerando
  // attributi e prefissi namespace. Non usa dipendenze esterne per parsing XML.
  const re = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)</${tagName}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

/**
 * Parsa la risposta XML di fpmate.cgi estraendo gli attributi di <response>
 * e i campi di <addInfo>.
 *
 * Struttura tipica:
 *   <response success="true" code="" status="2">
 *     <addInfo>
 *       <elementList>a,b,c</elementList>
 *       <a>..</a><b>..</b><c>..</c>
 *     </addInfo>
 *   </response>
 *
 * In caso di errore, <response> ha success="false" e code valorizzato
 * (es. PRINTER ERROR, INCOMPLETE FILE, …).
 *
 * @param {string} xmlString
 * @returns {{ success: boolean, code: string, status: string, addInfo: Record<string,string>, raw: string }}
 */
function parseFiscalResponse(xmlString) {
  const raw = typeof xmlString === 'string' ? xmlString : '';
  const success = /\ssuccess="true"/i.test(raw);
  const codeMatch = raw.match(/\scode="([^"]*)"/i);
  const statusMatch = raw.match(/\sstatus="([^"]*)"/i);
  const code = codeMatch ? codeMatch[1] : '';
  const status = statusMatch ? statusMatch[1] : '';

  const addInfo = {};
  const elementList = extractTagContent(raw, 'elementList');
  if (elementList) {
    const names = elementList.split(',').map((s) => s.trim()).filter(Boolean);
    for (const name of names) {
      const value = extractTagContent(raw, name);
      if (value != null) addInfo[name] = value;
    }
  }

  return { success, code, status, addInfo, raw };
}

/**
 * Invia una richiesta XML fiscale alla stampante tramite fpmate.cgi.
 *
 * @param {object} options
 * @param {string} options.xml        XML fiscale (senza envelope SOAP)
 * @param {string} options.host       IP/hostname della stampante fiscale
 * @param {number|string} [options.timeout]  Timeout query-string in ms (default 30000)
 * @param {number|string} [options.port]     Porta HTTP (default: nessuna → 80/443)
 * @param {boolean} [options.https]   Usa HTTPS (default false)
 * @param {string} [options.username] Credenziali (autenticazione web opzionale)
 * @param {string} [options.password]
 * @param {number} [options.requestTimeoutMs] Timeout socket lato client (default timeout+10000)
 * @returns {Promise<{ success: boolean, code: string, status: string, addInfo: object, raw: string }>}
 */
function sendFiscalRequest(options) {
  const {
    xml,
    host,
    timeout = 30000,
    port,
    https: useHttps = false,
    username,
    password,
  } = options;

  if (!xml || typeof xml !== 'string') {
    return Promise.reject(new Error('fpmate: xml payload mancante'));
  }
  if (!host) {
    return Promise.reject(new Error('fpmate: host stampante fiscale mancante'));
  }

  const body = wrapSoapEnvelope(xml);
  const url = buildFpmateUrl(host, { port, https: useHttps, timeout });
  const requestTimeoutMs = Number(options.requestTimeoutMs) > 0
    ? Number(options.requestTimeoutMs)
    : Number(timeout) + 10000;

  const lib = useHttps ? https : http;
  const parsedUrl = new URL(url);
  const requestOptions = {
    method: 'POST',
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (useHttps ? 443 : 80),
    path: parsedUrl.pathname + parsedUrl.search,
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'Content-Length': Buffer.byteLength(body, 'utf8'),
      'If-Modified-Since': 'Thu, 01 Jan 1970 00:00:00 GMT',
    },
    timeout: requestTimeoutMs,
  };

  if (username) {
    const auth = Buffer.from(`${username}:${password ?? ''}`).toString('base64');
    requestOptions.headers.Authorization = `Basic ${auth}`;
  }

  return new Promise((resolve, reject) => {
    const req = lib.request(requestOptions, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const responseText = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode == null || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(
            `fpmate: HTTP ${res.statusCode} da ${host}. Body: ${responseText.slice(0, 200)}`
          ));
          return;
        }
        try {
          resolve(parseFiscalResponse(responseText));
        } catch (err) {
          reject(new Error(`fpmate: risposta XML non valida da ${host}: ${err.message}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`fpmate: timeout (${requestTimeoutMs}ms) comunicando con ${host}`));
    });
    req.on('error', (err) => {
      reject(err);
    });

    req.write(body);
    req.end();
  });
}

module.exports = {
  sendFiscalRequest,
  wrapSoapEnvelope,
  buildFpmateUrl,
  parseFiscalResponse,
  extractTagContent,
};
