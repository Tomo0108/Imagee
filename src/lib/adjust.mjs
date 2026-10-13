import { t } from '../i18n/index.mjs';
/** Global tone and colour adjustments. The same maths runs in the WebGL shader (src/editor/gl.ts);
 * this JS version is the reference, the CPU fallback, and what the tests check.
 * @typedef {{ exposure: number, contrast: number, highlights: number, shadows: number, whites: number, blacks: number, temperature: number, tint: number, vibrance: number, saturation: number, vignette: number }} Adjustments */

/** @type {{ key: keyof Adjustments, label: string, min: number, max: number, step: number, group: 'light'|'color'|'effects' }[]} */
export const CONTROLS = [
  { key: 'exposure', label: t('露光量'), min: -4, max: 4, step: 0.05, group: 'light' },
  { key: 'contrast', label: t('コントラスト'), min: -100, max: 100, step: 1, group: 'light' },
  { key: 'highlights', label: t('ハイライト'), min: -100, max: 100, step: 1, group: 'light' },
  { key: 'shadows', label: t('シャドウ'), min: -100, max: 100, step: 1, group: 'light' },
  { key: 'whites', label: t('白レベル'), min: -100, max: 100, step: 1, group: 'light' },
  { key: 'blacks', label: t('黒レベル'), min: -100, max: 100, step: 1, group: 'light' },
  { key: 'temperature', label: t('色温度'), min: -100, max: 100, step: 1, group: 'color' },
  { key: 'tint', label: t('色かぶり補正'), min: -100, max: 100, step: 1, group: 'color' },
  { key: 'vibrance', label: t('自然な彩度'), min: -100, max: 100, step: 1, group: 'color' },
  { key: 'saturation', label: t('彩度'), min: -100, max: 100, step: 1, group: 'color' },
  { key: 'vignette', label: t('周辺光量'), min: -100, max: 100, step: 1, group: 'effects' },
];

/** @type {Adjustments} */
export const NEUTRAL = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, temperature: 0, tint: 0, vibrance: 0, saturation: 0, vignette: 0 };

/** Adjustments that change pixel colours (vignette is drawn after cropping instead). @param {Adjustments} a */
export function isNeutral(a) { return CONTROLS.every(c => c.key === 'vignette' || a[c.key] === 0); }

const clamp01 = (/** @type {number} */ v) => v < 0 ? 0 : v > 1 ? 1 : v;
const smoothstep = (/** @type {number} */ e0, /** @type {number} */ e1, /** @type {number} */ x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const mix = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ t) => a + (b - a) * t;

/** Applies adjustments to one sRGB pixel with channels in 0..1. @param {number[]} rgb @param {Adjustments} a @returns {number[]} */
export function adjustPixel(rgb, a) {
  let [r, g, b] = rgb;
  // White balance and exposure in (approximately) linear light.
  r = Math.pow(r, 2.2); g = Math.pow(g, 2.2); b = Math.pow(b, 2.2);
  const t = a.temperature / 100, n = a.tint / 100, gain = Math.pow(2, a.exposure);
  r *= (1 + 0.3 * t) * gain; g *= (1 - 0.25 * n) * gain; b *= (1 - 0.3 * t) * gain;
  r = Math.pow(Math.max(0, r), 1 / 2.2); g = Math.pow(Math.max(0, g), 1 / 2.2); b = Math.pow(Math.max(0, b), 1 / 2.2);
  // Tone: highlights / shadows act on luminance bands, whites / blacks move the end points.
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const tone = (a.highlights / 100) * 0.35 * smoothstep(0.45, 1, lum) + (a.shadows / 100) * 0.35 * (1 - smoothstep(0, 0.55, lum));
  const black = -a.blacks / 100 * 0.12, white = 1 - a.whites / 100 * 0.12;
  const k = a.contrast / 100;
  const out = [r, g, b].map(v => {
    let x = (v + tone - black) / (white - black);
    x = clamp01(x);
    x = k >= 0 ? mix(x, x * x * (3 - 2 * x), k) : mix(x, 0.5 + (x - 0.5) * 0.5, -k);
    return x;
  });
  // Colour: vibrance favours muted colours, saturation is uniform.
  const l2 = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
  const chroma = Math.max(...out) - Math.min(...out);
  const amount = 1 + a.saturation / 100 + (a.vibrance / 100) * (1 - chroma);
  return out.map(v => clamp01(mix(l2, v, Math.max(0, amount))));
}

/** Suggests exposure, whites and blacks from a luminance histogram (256 bins).
 * @param {ArrayLike<number>} lum @returns {Partial<Adjustments>} */
export function autoAdjust(lum) {
  let total = 0;
  for (let i = 0; i < 256; i++) total += lum[i];
  if (!total) return {};
  const percentile = (/** @type {number} */ p) => { let acc = 0; for (let i = 0; i < 256; i++) { acc += lum[i]; if (acc >= total * p) return i / 255; } return 1; };
  const low = percentile(0.005), mid = percentile(0.5), high = percentile(0.995);
  const round = (/** @type {number} */ v, /** @type {number} */ step) => Math.round(v / step) * step;
  // Aim the median at mid-grey (0.46 in sRGB) and stretch the ends toward 0 and 1.
  const exposure = Math.max(-2, Math.min(2, round(Math.log2(Math.pow(0.46, 2.2) / Math.max(1e-4, Math.pow(Math.max(mid, 0.02), 2.2))) * 0.6, 0.05)));
  const whites = Math.max(-60, Math.min(60, Math.round((1 - high) * 100 / 0.12 * 0.5)));
  const blacks = Math.max(-60, Math.min(60, Math.round(-low * 100 / 0.12 * 0.5)));
  return { exposure: Number(exposure.toFixed(2)), whites, blacks };
}

/** @param {unknown} value @returns {Adjustments} */
export function normalizeAdjustments(value) {
  const result = { ...NEUTRAL };
  if (!value || typeof value !== 'object') return result;
  const data = /** @type {Record<string, unknown>} */ (value);
  for (const c of CONTROLS) { const v = data[c.key]; if (typeof v === 'number' && Number.isFinite(v)) result[c.key] = Math.min(c.max, Math.max(c.min, v)); }
  return result;
}
