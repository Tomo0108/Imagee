/** Recipes: a saved set of steps applied to many images at once (batch processing).
 * @typedef {import('./adjust.mjs').Adjustments} Adjustments
 * @typedef {import('./color.mjs').ColorOps} ColorOps
 * @typedef {import('./files.mjs').ExportFormat} ExportFormat
 * @typedef {{ mode: 'none' | 'long' | 'width' | 'height' | 'percent', value: number }} Resize
 * @typedef {{ text: string, position: 'br' | 'bl' | 'tr' | 'tl' | 'center', size: number, opacity: number, color: string }} Watermark
 * @typedef {{ id: string, name: string, useEdits: boolean, tone: { basic: Adjustments, color: ColorOps } | null, aspect: string,
 *   resize: Resize, watermark: Watermark, format: ExportFormat, quality: number, suffix: string }} Recipe */

import { NEUTRAL, normalizeAdjustments } from './adjust.mjs';
import { normalizeColor } from './color.mjs';
import { baseName } from './files.mjs';

/** @type {Recipe} */
export const DEFAULT_RECIPE = {
  id: '', name: '', useEdits: true, tone: null, aspect: 'free',
  resize: { mode: 'none', value: 2048 },
  watermark: { text: '', position: 'br', size: 4, opacity: 70, color: '#ffffff' },
  format: 'jpeg', quality: 88, suffix: '',
};

/** @param {unknown} value @returns {Recipe} */
export function normalizeRecipe(value) {
  const v = /** @type {any} */ (value && typeof value === 'object' ? value : {});
  const num = (/** @type {unknown} */ x, /** @type {number} */ d, /** @type {number} */ lo, /** @type {number} */ hi) => typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d;
  const d = DEFAULT_RECIPE;
  const modes = ['none', 'long', 'width', 'height', 'percent'], positions = ['br', 'bl', 'tr', 'tl', 'center'], formats = ['png', 'jpeg', 'webp', 'avif'];
  return {
    id: typeof v.id === 'string' ? v.id : '', name: typeof v.name === 'string' ? v.name.slice(0, 60) : '',
    useEdits: typeof v.useEdits === 'boolean' ? v.useEdits : d.useEdits,
    tone: v.tone ? { basic: normalizeAdjustments(v.tone.basic ?? NEUTRAL), color: normalizeColor(v.tone.color) } : null,
    aspect: typeof v.aspect === 'string' ? v.aspect : d.aspect,
    resize: { mode: modes.includes(v.resize?.mode) ? v.resize.mode : 'none', value: num(v.resize?.value, d.resize.value, 1, 20000) },
    watermark: {
      text: typeof v.watermark?.text === 'string' ? v.watermark.text.slice(0, 200) : '',
      position: positions.includes(v.watermark?.position) ? v.watermark.position : 'br',
      size: num(v.watermark?.size, d.watermark.size, 1, 30), opacity: num(v.watermark?.opacity, d.watermark.opacity, 0, 100),
      color: typeof v.watermark?.color === 'string' && /^#[0-9a-f]{6}$/i.test(v.watermark.color) ? v.watermark.color : d.watermark.color,
    },
    format: formats.includes(v.format) ? v.format : d.format, quality: num(v.quality, d.quality, 1, 100),
    suffix: typeof v.suffix === 'string' ? v.suffix.replace(/[\\/:*?"<>|]/g, '').slice(0, 40) : '',
  };
}

/** Output size for a resize step; never upscales for 'long' / 'width' / 'height'.
 * @param {number} width @param {number} height @param {Resize} resize @returns {{ width: number, height: number }} */
export function resizedSize(width, height, resize) {
  let k = 1;
  if (resize.mode === 'long') k = Math.min(1, resize.value / Math.max(width, height));
  else if (resize.mode === 'width') k = Math.min(1, resize.value / width);
  else if (resize.mode === 'height') k = Math.min(1, resize.value / height);
  else if (resize.mode === 'percent') k = resize.value / 100;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** Largest centred rectangle with the given ratio (0 keeps the whole image).
 * @param {number} width @param {number} height @param {number} ratio @returns {{ x: number, y: number, w: number, h: number }} */
export function centerCrop(width, height, ratio) {
  if (!ratio || ratio <= 0) return { x: 0, y: 0, w: width, h: height };
  let w = width, h = Math.round(width / ratio);
  if (h > height) { h = height; w = Math.round(height * ratio); }
  return { x: Math.floor((width - w) / 2), y: Math.floor((height - h) / 2), w, h };
}

/** Where to draw a watermark of size (w, h) with a margin. @param {Watermark['position']} position
 * @param {number} width @param {number} height @param {number} w @param {number} h @param {number} margin */
export function watermarkOrigin(position, width, height, w, h, margin) {
  if (position === 'center') return { x: (width - w) / 2, y: (height - h) / 2 };
  return { x: position.endsWith('l') ? margin : width - w - margin, y: position.startsWith('t') ? margin : height - h - margin };
}

/** File names for the results, unique within the batch. @param {string[]} names @param {string} suffix @param {string} extension */
export function outputNames(names, suffix, extension) {
  const used = new Set();
  return names.map(name => {
    const base = `${baseName(name)}${suffix}`;
    let candidate = `${base}.${extension}`;
    for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = `${base} (${i}).${extension}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}
