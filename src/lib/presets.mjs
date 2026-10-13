import { NEUTRAL } from './adjust.mjs';
import { normalizeColor } from './color.mjs';
import { t } from '../i18n/index.mjs';
/** Built-in looks. Each sets the basic sliders and colour operations from neutral, so applying one is predictable.
 * @typedef {import('./adjust.mjs').Adjustments} Adjustments
 * @typedef {import('./color.mjs').ColorOps} ColorOps
 * @typedef {{ id: string, name: string, basic: Partial<Adjustments>, color?: { curves?: Partial<ColorOps['curves']>, hsl?: Record<string, Partial<import('./color.mjs').HslShift>>, levels?: Partial<ColorOps['levels']> } }} Preset */

/** @type {Preset[]} */
export const PRESETS = [
  { id: 'vivid', name: t('ビビッド'), basic: { contrast: 18, vibrance: 38, saturation: 6, shadows: 10 } },
  { id: 'natural', name: t('ナチュラル'), basic: { highlights: -25, shadows: 20, vibrance: 15 } },
  { id: 'film', name: t('フィルム'), basic: { temperature: 8, saturation: -12 }, color: { curves: { rgb: [[0, 0.07], [0.25, 0.23], [0.75, 0.8], [1, 0.94]] } } },
  { id: 'matte', name: t('マット'), basic: { saturation: -15, contrast: -5 }, color: { curves: { rgb: [[0, 0.13], [0.5, 0.5], [1, 0.92]] } } },
  { id: 'teal-orange', name: t('ティール＆オレンジ'), basic: { contrast: 12, vibrance: 15 },
    color: { hsl: { orange: { s: 20, l: 6 }, aqua: { h: 25 }, blue: { h: -15, s: 10 }, green: { h: 40, s: -30 } }, curves: { b: [[0, 0.08], [0.5, 0.5], [1, 0.9]], r: [[0, 0], [0.5, 0.5], [1, 1]] } } },
  { id: 'sunset', name: t('夕暮れ'), basic: { temperature: 35, tint: 12, highlights: -15, vibrance: 10 } },
  { id: 'cool', name: t('クール'), basic: { temperature: -30, tint: -4, vibrance: 10, contrast: 6 } },
  { id: 'high-key', name: t('ハイキー'), basic: { exposure: 0.6, contrast: -15, highlights: -25, shadows: 35, saturation: -8 } },
  { id: 'low-key', name: t('ローキー'), basic: { exposure: -0.5, contrast: 30, blacks: -20, highlights: -10 } },
  { id: 'mono', name: t('モノクロ'), basic: { saturation: -100, contrast: 22 } },
  { id: 'mono-soft', name: t('ソフトモノクロ'), basic: { saturation: -100, contrast: -10, shadows: 20 }, color: { curves: { rgb: [[0, 0.08], [1, 0.95]] } } },
  { id: 'sepia', name: t('セピア'), basic: { saturation: -100, contrast: 8 }, color: { curves: { r: [[0, 0.06], [1, 1]], g: [[0, 0.02], [1, 0.94]], b: [[0, 0], [1, 0.8]] } } },
];

/** Full slider and colour state for a preset. @param {Preset} preset @returns {{ basic: Adjustments, color: ColorOps }} */
export function presetState(preset) {
  return { basic: { ...NEUTRAL, ...preset.basic }, color: normalizeColor(preset.color || {}) };
}
