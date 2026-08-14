import { ref, computed } from 'vue';

// Single source of truth for the self-order UI language. Shared across every
// view/component so that changing the language in one place updates all the
// others live (each component previously held its own non-reactive copy read
// from localStorage at setup time, so language switches never propagated).
const currentLang = ref(typeof localStorage !== 'undefined'
  ? (localStorage.getItem('selforder_lang') || 'it')
  : 'it');

export function setSelfOrderLang(code) {
  if (!code) return;
  currentLang.value = code;
  try {
    localStorage.setItem('selforder_lang', code);
  } catch {
    /* storage unavailable (private mode) — keep in-memory ref only */
  }
}

/**
 * Self-order i18n helper.
 *
 * Each component owns its translation dictionary (the keys differ per view),
 * but the *active language* is shared and reactive: switching language via
 * `setSelfOrderLang` re-evaluates every component's `t` at once.
 *
 * @param {Record<string, object>} dict - e.g. { it: {...}, en: {...} }
 * @returns {{ t: import('vue').ComputedRef<object>, currentLang: import('vue').Ref<string>, setLang: (code: string) => void }}
 */
export function useSelfOrderI18n(dict) {
  const fallback = dict.it || Object.values(dict)[0] || {};
  const t = computed(() => dict[currentLang.value] || fallback);
  return { t, currentLang, setLang: setSelfOrderLang };
}
