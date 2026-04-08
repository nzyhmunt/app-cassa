'use strict';

/**
 * @file escpos.js
 * @description Generatore di comandi ESC/POS puri (nessuna dipendenza esterna).
 *
 * Costruisce un Buffer con i byte ESC/POS da inviare alla stampante termica.
 * Supporta: allineamento, grassetto, dimensione testo, separatori, taglio carta.
 *
 * Uso:
 *   const b = new EscPosBuilder();
 *   b.init().align('center').bold(true).textLine('RISTORANTE').bold(false);
 *   b.textLine('Tavolo 5').separator().cut();
 *   const buf = b.build();
 */

// ── Costanti ESC/POS ─────────────────────────────────────────────────────────

const ESC = 0x1b;
const GS  = 0x1d;
const NL  = 0x0a;

/** Inizializza la stampante (reset) */
const CMD_INIT       = Buffer.from([ESC, 0x40]);

/** Allineamento: 0 = sinistra, 1 = centro, 2 = destra */
const CMD_ALIGN_LEFT   = Buffer.from([ESC, 0x61, 0x00]);
const CMD_ALIGN_CENTER = Buffer.from([ESC, 0x61, 0x01]);
const CMD_ALIGN_RIGHT  = Buffer.from([ESC, 0x61, 0x02]);

/** Grassetto ON / OFF */
const CMD_BOLD_ON    = Buffer.from([ESC, 0x45, 0x01]);
const CMD_BOLD_OFF   = Buffer.from([ESC, 0x45, 0x00]);

/** Dimensione testo normale (1x) */
const CMD_SIZE_NORMAL = Buffer.from([GS, 0x21, 0x00]);
/** Doppia altezza */
const CMD_SIZE_DOUBLE_HEIGHT = Buffer.from([GS, 0x21, 0x01]);
/** Doppia larghezza */
const CMD_SIZE_DOUBLE_WIDTH  = Buffer.from([GS, 0x21, 0x10]);
/** Doppia larghezza e doppia altezza */
const CMD_SIZE_DOUBLE = Buffer.from([GS, 0x21, 0x11]);

/** Carattere separatore fisso */
const SEPARATOR_CHAR = '-';
/** Larghezza colonna di stampa (caratteri) per una stampante a 80mm standard */
const PRINTER_WIDTH = 42;

/** Taglio carta (full cut) */
const CMD_CUT = Buffer.from([GS, 0x56, 0x00]);

/** Avanza carta di N righe */
function cmdFeed(n) {
  return Buffer.from([ESC, 0x64, n & 0xff]);
}

/** Codifica testo in Latin-1 (ISO-8859-1) — compatibile con la maggior parte
 *  delle stampanti termiche. I caratteri non rappresentabili vengono sostituiti
 *  con '?'. */
function encodeText(text) {
  const str = String(text ?? '');
  const len = str.length;
  const buf = Buffer.alloc(len);
  for (let i = 0; i < len; i++) {
    const code = str.charCodeAt(i);
    buf[i] = code < 256 ? code : 0x3f; // '?'
  }
  return buf;
}

// ── Builder ──────────────────────────────────────────────────────────────────

class EscPosBuilder {
  constructor() {
    this._chunks = [];
  }

  /** Aggiunge un Buffer grezzo */
  _raw(buf) {
    this._chunks.push(buf);
    return this;
  }

  /** Inizializza la stampante */
  init() {
    return this._raw(CMD_INIT);
  }

  /** Imposta l'allineamento: 'left' | 'center' | 'right' */
  align(direction) {
    if (direction === 'center') return this._raw(CMD_ALIGN_CENTER);
    if (direction === 'right')  return this._raw(CMD_ALIGN_RIGHT);
    return this._raw(CMD_ALIGN_LEFT);
  }

  /** Attiva/disattiva grassetto */
  bold(on) {
    return this._raw(on ? CMD_BOLD_ON : CMD_BOLD_OFF);
  }

  /** Imposta la dimensione del testo: 'normal' | 'double-height' | 'double-width' | 'double' */
  size(s) {
    if (s === 'double-height') return this._raw(CMD_SIZE_DOUBLE_HEIGHT);
    if (s === 'double-width')  return this._raw(CMD_SIZE_DOUBLE_WIDTH);
    if (s === 'double')        return this._raw(CMD_SIZE_DOUBLE);
    return this._raw(CMD_SIZE_NORMAL);
  }

  /** Stampa una riga di testo seguita da newline */
  textLine(text) {
    return this._raw(encodeText(text)).nl();
  }

  /** Stampa testo senza newline */
  text(text) {
    return this._raw(encodeText(text));
  }

  /** Newline */
  nl() {
    return this._raw(Buffer.from([NL]));
  }

  /** Avanza di n righe vuote */
  feed(n = 1) {
    return this._raw(cmdFeed(n));
  }

  /** Separatore orizzontale di trattini */
  separator() {
    return this.textLine(SEPARATOR_CHAR.repeat(PRINTER_WIDTH));
  }

  /**
   * Stampa due stringhe sulla stessa riga, allineate a sinistra e destra.
   * La somma non supera PRINTER_WIDTH caratteri.
   */
  twoColumns(left, right) {
    const l = String(left ?? '');
    const r = String(right ?? '');
    const space = Math.max(1, PRINTER_WIDTH - l.length - r.length);
    return this.textLine(l + ' '.repeat(space) + r);
  }

  /** Taglio carta */
  cut() {
    return this._raw(CMD_CUT);
  }

  /** Restituisce il Buffer finale con tutti i comandi concatenati */
  build() {
    return Buffer.concat(this._chunks);
  }
}

module.exports = { EscPosBuilder, PRINTER_WIDTH };
