/** @typedef {'violet'|'blue'|'pink'|'green'|'orange'|'graphite'} Accent */
/** @typedef {'ja'|'en'} Language */
/** @typedef {{ theme: 'system'|'light'|'dark', layout: 'grid'|'list', sort: 'recent'|'name'|'size', motion: boolean, checkerboard: 'light'|'dark', accent: Accent, lang: Language }} Preferences */
export const ACCENTS = /** @type {const} */ (['violet', 'blue', 'pink', 'green', 'orange', 'graphite']);
export const LANGUAGES = /** @type {const} */ (['ja', 'en']);
/** @type {Preferences} */
export const defaults = { theme: 'dark', layout: 'grid', sort: 'recent', motion: true, checkerboard: 'dark', accent: 'violet', lang: 'ja' };

/** Validate persisted settings. @param {unknown} value @returns {Preferences} */
export function normalizePreferences(value) {
  const result = { ...defaults };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  const data = /** @type {Record<string, unknown>} */ (value);
  if (data.theme === 'system' || data.theme === 'light' || data.theme === 'dark') result.theme = data.theme;
  if (data.layout === 'grid' || data.layout === 'list') result.layout = data.layout;
  if (data.sort === 'recent' || data.sort === 'name' || data.sort === 'size') result.sort = data.sort;
  if (typeof data.motion === 'boolean') result.motion = data.motion;
  if (data.checkerboard === 'light' || data.checkerboard === 'dark') result.checkerboard = data.checkerboard;
  if (ACCENTS.includes(/** @type {Accent} */ (data.accent))) result.accent = /** @type {Accent} */ (data.accent);
  if (LANGUAGES.includes(/** @type {Language} */ (data.lang))) result.lang = /** @type {Language} */ (data.lang);
  return result;
}
