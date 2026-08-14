/**
 * @file useSelfOrderI18n.test.js
 * Unit tests for the self-order i18n composable.
 *
 * The active language is a module-level singleton ref shared across all
 * components, so each test resets it to 'it' and clears localStorage.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useSelfOrderI18n,
  setSelfOrderLang,
} from '../useSelfOrderI18n.js';

beforeEach(() => {
  localStorage.clear();
  setSelfOrderLang('it');
});

describe('useSelfOrderI18n — language singleton', () => {
  it('defaults to "it" when nothing is stored', () => {
    const { currentLang } = useSelfOrderI18n({ it: {}, en: {} });
    expect(currentLang.value).toBe('it');
  });

  it('reads the initial language from localStorage', () => {
    localStorage.setItem('selforder_lang', 'en');
    vi.resetModules();
    return import('../useSelfOrderI18n.js').then(({ useSelfOrderI18n }) => {
      const { currentLang } = useSelfOrderI18n({ it: {}, en: {} });
      expect(currentLang.value).toBe('en');
    });
  });
});

describe('useSelfOrderI18n — setSelfOrderLang', () => {
  it('updates the shared language ref and persists to localStorage', () => {
    setSelfOrderLang('en');
    expect(localStorage.getItem('selforder_lang')).toBe('en');
  });

  it('propagates the switch to every consumer live', () => {
    const a = useSelfOrderI18n({ it: { hello: 'ciao' }, en: { hello: 'hi' } });
    const b = useSelfOrderI18n({ it: { bye: 'ciao' }, en: { bye: 'bye' } });
    expect(a.t.value.hello).toBe('ciao');
    expect(b.t.value.bye).toBe('ciao');

    setSelfOrderLang('en');
    expect(a.t.value.hello).toBe('hi');
    expect(b.t.value.bye).toBe('bye');
  });

  it('ignores empty / falsy codes', () => {
    setSelfOrderLang('en');
    setSelfOrderLang('');
    const { t, currentLang } = useSelfOrderI18n({ it: { x: 1 }, en: { x: 2 } });
    expect(currentLang.value).toBe('en');
    expect(t.value.x).toBe(2);
  });
});

describe('useSelfOrderI18n — t computed with fallback', () => {
  it('falls back to the "it" dictionary for an unknown language', () => {
    setSelfOrderLang('fr');
    const { t } = useSelfOrderI18n({ it: { hello: 'ciao' }, en: { hello: 'hi' } });
    expect(t.value.hello).toBe('ciao');
  });

  it('falls back to the first dictionary entry when "it" is absent', () => {
    setSelfOrderLang('fr');
    const { t } = useSelfOrderI18n({ en: { hello: 'hi' }, de: { hello: 'hallo' } });
    expect(t.value.hello).toBe('hi');
  });
});
