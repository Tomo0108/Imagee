/** @typedef {{ theme: 'system'|'light'|'dark', layout: 'grid'|'list', sort: 'recent'|'name'|'size', motion: boolean, checkerboard: 'light'|'dark' }} Preferences */
/** @type {Preferences} */
export const defaults = { theme: 'dark', layout: 'grid', sort: 'recent', motion: true, checkerboard: 'dark' };

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
  return result;
}
