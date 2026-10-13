import en from './en.mjs';

/** Read the saved language once at load: switching language reloads the app so module-level labels translate too. */
function savedLanguage() {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem('imagee-preferences') || '{}');
    if (saved && (saved.lang === 'en' || saved.lang === 'ja')) return saved.lang;
  } catch { /* No storage: fall through to the default. */ }
  return 'ja';
}

/** @type {'ja'|'en'} */
export const lang = savedLanguage();

/** @type {Record<string, string>} */
const dictionary = lang === 'en' ? en : {};

/**
 * Translate a Japanese source string. The Japanese text is the key, so untranslated strings fall back to it.
 * `{0}`, `{1}`… are replaced with the arguments.
 * @param {string} text @param {...(string|number)} args @returns {string}
 */
export function t(text, ...args) {
  const out = dictionary[text] ?? text;
  return args.length ? out.replace(/\{(\d+)\}/g, (all, i) => (args[+i] ?? all).toString()) : out;
}
