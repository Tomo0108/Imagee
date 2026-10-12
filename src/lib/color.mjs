/** Colour operations beyond the basic sliders: levels, tone curves, HSL per colour band and 3D LUTs.
 * They are all per-pixel colour functions, so the editor bakes them (together with the basic adjustments when
 * used as an adjustment layer) into one 3D lookup table that the GPU samples.
 * @typedef {[number, number]} CurvePoint  x, y in 0..1
 * @typedef {{ rgb: CurvePoint[], r: CurvePoint[], g: CurvePoint[], b: CurvePoint[] }} Curves
 * @typedef {{ inBlack: number, inWhite: number, gamma: number, outBlack: number, outWhite: number }} Levels
 * @typedef {{ h: number, s: number, l: number }} HslShift  each -100..100
 * @typedef {Record<string, HslShift>} Hsl
 * @typedef {{ id: string, amount: number }} LutRef
 * @typedef {{ levels: Levels, curves: Curves, hsl: Hsl, lut: LutRef | null }} ColorOps
 * @typedef {{ size: number, data: Float32Array, title: string }} Cube */

/** @type {{ id: string, label: string, hue: number, swatch: string }[]} */
export const BANDS = [
  { id: 'red', label: 'レッド', hue: 0, swatch: '#ff453a' },
  { id: 'orange', label: 'オレンジ', hue: 30, swatch: '#ff9f0a' },
  { id: 'yellow', label: 'イエロー', hue: 60, swatch: '#ffd60a' },
  { id: 'green', label: 'グリーン', hue: 120, swatch: '#30d158' },
  { id: 'aqua', label: 'アクア', hue: 180, swatch: '#64d2ff' },
  { id: 'blue', label: 'ブルー', hue: 240, swatch: '#0a84ff' },
  { id: 'purple', label: 'パープル', hue: 270, swatch: '#bf5af2' },
  { id: 'magenta', label: 'マゼンタ', hue: 300, swatch: '#ff375f' },
];

/** @returns {CurvePoint[]} */
const line = () => [[0, 0], [1, 1]];
/** @type {ColorOps} */
export const NEUTRAL_COLOR = {
  levels: { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 },
  curves: { rgb: line(), r: line(), g: line(), b: line() },
  hsl: Object.fromEntries(BANDS.map(b => [b.id, { h: 0, s: 0, l: 0 }])),
  lut: null,
};

const clamp01 = (/** @type {number} */ v) => v < 0 ? 0 : v > 1 ? 1 : v;
const isLine = (/** @type {CurvePoint[]} */ p) => p.length === 2 && p[0][0] === 0 && p[0][1] === 0 && p[1][0] === 1 && p[1][1] === 1;

/** @param {ColorOps} ops */
export function isNeutralColor(ops) {
  const l = ops.levels;
  return l.inBlack === 0 && l.inWhite === 255 && l.gamma === 1 && l.outBlack === 0 && l.outWhite === 255
    && isLine(ops.curves.rgb) && isLine(ops.curves.r) && isLine(ops.curves.g) && isLine(ops.curves.b)
    && Object.values(ops.hsl).every(s => !s.h && !s.s && !s.l)
    && (!ops.lut || !ops.lut.amount);
}

/** Smooth curve through the points that never overshoots between them (monotone cubic, Fritsch–Carlson).
 * @param {CurvePoint[]} points @param {number} [samples] @returns {Float32Array} values at x = i / (samples - 1) */
export function curveTable(points, samples = 1024) {
  const p = [...points].sort((a, b) => a[0] - b[0]);
  const n = p.length;
  const table = new Float32Array(samples);
  if (n < 2) { for (let i = 0; i < samples; i++) table[i] = i / (samples - 1); return table; }
  const dx = [], slope = [];
  for (let i = 0; i < n - 1; i++) { dx.push(Math.max(1e-6, p[i + 1][0] - p[i][0])); slope.push((p[i + 1][1] - p[i][1]) / dx[i]); }
  const m = new Array(n);
  m[0] = slope[0]; m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / slope[i], b = m[i + 1] / slope[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * slope[i]; m[i + 1] = t * b * slope[i]; }
  }
  let k = 0;
  for (let i = 0; i < samples; i++) {
    const x = i / (samples - 1);
    if (x <= p[0][0]) { table[i] = p[0][1]; continue; }
    if (x >= p[n - 1][0]) { table[i] = p[n - 1][1]; continue; }
    while (k < n - 2 && x > p[k + 1][0]) k++;
    const t = (x - p[k][0]) / dx[k], t2 = t * t, t3 = t2 * t;
    table[i] = clamp01((2 * t3 - 3 * t2 + 1) * p[k][1] + (t3 - 2 * t2 + t) * dx[k] * m[k] + (-2 * t3 + 3 * t2) * p[k + 1][1] + (t3 - t2) * dx[k] * m[k + 1]);
  }
  return table;
}
/** @param {Float32Array} table @param {number} x */
export function lookup(table, x) {
  const f = clamp01(x) * (table.length - 1), i = Math.floor(f), t = f - i;
  return i >= table.length - 1 ? table[table.length - 1] : table[i] + (table[i + 1] - table[i]) * t;
}

/** @param {number} v 0..1 @param {Levels} l */
export function applyLevels(v, l) {
  const x = clamp01((v * 255 - l.inBlack) / Math.max(1, l.inWhite - l.inBlack));
  return clamp01((l.outBlack + Math.pow(x, 1 / Math.max(0.01, l.gamma)) * (l.outWhite - l.outBlack)) / 255);
}

/** @param {number} r @param {number} g @param {number} b @returns {[number, number, number]} h in degrees, s and l 0..1 */
export function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60; if (h < 0) h += 360;
  return [h, Math.min(1, s), l];
}
/** @param {number} h @param {number} s @param {number} l @returns {[number, number, number]} */
export function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, hp = ((h % 360) + 360) % 360 / 60, x = c * (1 - Math.abs((hp % 2) - 1)), m = l - c / 2;
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  return [clamp01(r + m), clamp01(g + m), clamp01(b + m)];
}

/** How much each colour band applies to a hue: linear between neighbouring band centres, summing to 1.
 * @param {number} hue degrees @returns {number[]} weight per entry of BANDS */
export function bandWeights(hue) {
  const weights = new Array(BANDS.length).fill(0);
  const h = ((hue % 360) + 360) % 360;
  for (let i = 0; i < BANDS.length; i++) {
    const a = BANDS[i].hue, b = i === BANDS.length - 1 ? 360 : BANDS[i + 1].hue;
    if (h >= a && h < b) { const t = (h - a) / (b - a); weights[i] += 1 - t; weights[(i + 1) % BANDS.length] += t; break; }
  }
  return weights;
}

/** @param {number[]} rgb @param {Hsl} hsl @returns {number[]} */
export function applyHsl(rgb, hsl) {
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  if (!s) return rgb;
  const w = bandWeights(h);
  let dh = 0, ds = 0, dl = 0;
  BANDS.forEach((band, i) => { if (w[i]) { const shift = hsl[band.id]; if (shift) { dh += w[i] * shift.h; ds += w[i] * shift.s; dl += w[i] * shift.l; } } });
  if (!dh && !ds && !dl) return rgb;
  // Greys have no hue, so the effect fades in with saturation.
  const presence = Math.min(1, s / 0.12);
  const nh = h + dh / 100 * 30 * presence;
  const ns = clamp01(s * (1 + ds / 100 * presence));
  const nl = clamp01(l + dl / 100 * 0.35 * s * presence * (dl > 0 ? 1 - l : l));
  return hslToRgb(nh, ns, nl);
}

/** Parses an Adobe/Resolve `.cube` 3D LUT. @param {string} text @returns {Cube} */
export function parseCube(text) {
  let size = 0, title = '';
  /** @type {number[]} */ const values = [];
  for (const raw of text.split(/\r?\n/)) {
    const lineText = raw.replace(/#.*/, '').trim();
    if (!lineText) continue;
    const [key, ...rest] = lineText.split(/\s+/);
    if (key === 'TITLE') title = lineText.slice(5).trim().replace(/^"|"$/g, '');
    else if (key === 'LUT_3D_SIZE') size = Number(rest[0]);
    else if (key === 'LUT_1D_SIZE') throw new Error('1D LUT には対応していません。3D LUT（.cube）を選んでください。');
    // DOMAIN_MIN / DOMAIN_MAX other than 0..1 are rare for display LUTs and are treated as 0..1.
    else if (/^[-+.\d]/.test(key)) values.push(Number(key), Number(rest[0]), Number(rest[1]));
  }
  if (!size || size < 2 || size > 128) throw new Error('LUT のサイズを読み取れませんでした。');
  if (values.length !== size * size * size * 3 || values.some(v => !Number.isFinite(v))) throw new Error('LUT のデータ数が正しくありません。');
  return { size, data: new Float32Array(values.map(clamp01)), title };
}

/** Trilinear sample of a cube (red fastest, then green, then blue). @param {Cube} cube @param {number[]} rgb @returns {number[]} */
export function sampleCube(cube, rgb) {
  const n = cube.size, d = cube.data;
  const pos = rgb.map(v => clamp01(v) * (n - 1));
  const i0 = pos.map(p => Math.min(n - 2, Math.floor(p))), t = pos.map((p, k) => p - i0[k]);
  /** @param {number} r @param {number} g @param {number} b @param {number} c */
  const at = (r, g, b, c) => d[((b * n + g) * n + r) * 3 + c];
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const [r, g, b] = i0, [tr, tg, tb] = t;
    const c00 = at(r, g, b, c) * (1 - tr) + at(r + 1, g, b, c) * tr;
    const c10 = at(r, g + 1, b, c) * (1 - tr) + at(r + 1, g + 1, b, c) * tr;
    const c01 = at(r, g, b + 1, c) * (1 - tr) + at(r + 1, g, b + 1, c) * tr;
    const c11 = at(r, g + 1, b + 1, c) * (1 - tr) + at(r + 1, g + 1, b + 1, c) * tr;
    out[c] = (c00 * (1 - tg) + c10 * tg) * (1 - tb) + (c01 * (1 - tg) + c11 * tg) * tb;
  }
  return out;
}

/** Prepares a fast per-pixel function for a set of colour operations.
 * @param {ColorOps} ops @param {Cube | null | undefined} cube the LUT `ops.lut` refers to, if loaded
 * @returns {(rgb: number[]) => number[]} */
export function colorFunction(ops, cube) {
  const master = curveTable(ops.curves.rgb), tables = [curveTable(ops.curves.r), curveTable(ops.curves.g), curveTable(ops.curves.b)];
  const amount = ops.lut && cube ? clamp01(ops.lut.amount / 100) : 0;
  return rgb => {
    let out = rgb.map((v, c) => lookup(tables[c], lookup(master, applyLevels(v, ops.levels))));
    out = applyHsl(out, ops.hsl);
    if (amount && cube) { const graded = sampleCube(cube, out); out = out.map((v, c) => v + (graded[c] - v) * amount); }
    return out;
  };
}

/** Bakes any colour function into an RGBA8 3D table (red fastest) for a WebGL 3D texture.
 * @param {(rgb: number[]) => number[]} fn @param {number} [size] @returns {Uint8Array} */
export function bakeLut(fn, size = 33) {
  const out = new Uint8Array(size * size * size * 4);
  let i = 0;
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    const [x, y, z] = fn([r / (size - 1), g / (size - 1), b / (size - 1)]);
    out[i++] = Math.round(clamp01(x) * 255); out[i++] = Math.round(clamp01(y) * 255); out[i++] = Math.round(clamp01(z) * 255); out[i++] = 255;
  }
  return out;
}
/** Trilinear lookup into a baked RGBA8 table (CPU fallback). @param {Uint8Array} table @param {number} size @param {number} r @param {number} g @param {number} b 0..255 @param {Uint8ClampedArray} out @param {number} o */
export function sampleBaked(table, size, r, g, b, out, o) {
  const s = (size - 1) / 255;
  const pr = r * s, pg = g * s, pb = b * s;
  const ir = Math.min(size - 2, pr | 0), ig = Math.min(size - 2, pg | 0), ib = Math.min(size - 2, pb | 0);
  const tr = pr - ir, tg = pg - ig, tb = pb - ib;
  const row = size * 4, plane = size * row, base = ib * plane + ig * row + ir * 4;
  for (let c = 0; c < 3; c++) {
    const i = base + c;
    const c00 = table[i] + (table[i + 4] - table[i]) * tr, c10 = table[i + row] + (table[i + row + 4] - table[i + row]) * tr;
    const c01 = table[i + plane] + (table[i + plane + 4] - table[i + plane]) * tr, c11 = table[i + plane + row] + (table[i + plane + row + 4] - table[i + plane + row]) * tr;
    out[o + c] = (c00 + (c10 - c00) * tg) * (1 - tb) + (c01 + (c11 - c01) * tg) * tb;
  }
}

/** @param {unknown} value @returns {ColorOps} */
export function normalizeColor(value) {
  const v = /** @type {any} */ (value);
  if (!v || typeof v !== 'object') return structuredClone(NEUTRAL_COLOR);
  const num = (/** @type {unknown} */ x, /** @type {number} */ d, /** @type {number} */ lo, /** @type {number} */ hi) => typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d;
  const points = (/** @type {unknown} */ p) => Array.isArray(p) && p.length >= 2 && p.every(q => Array.isArray(q) && q.length === 2) ? /** @type {CurvePoint[]} */ (p.map(q => [num(q[0], 0, 0, 1), num(q[1], 0, 0, 1)])) : line();
  const l = v.levels || {};
  return {
    levels: { inBlack: num(l.inBlack, 0, 0, 253), inWhite: num(l.inWhite, 255, 2, 255), gamma: num(l.gamma, 1, 0.1, 9.99), outBlack: num(l.outBlack, 0, 0, 255), outWhite: num(l.outWhite, 255, 0, 255) },
    curves: { rgb: points(v.curves?.rgb), r: points(v.curves?.r), g: points(v.curves?.g), b: points(v.curves?.b) },
    hsl: Object.fromEntries(BANDS.map(b => { const s = v.hsl?.[b.id] || {}; return [b.id, { h: num(s.h, 0, -100, 100), s: num(s.s, 0, -100, 100), l: num(s.l, 0, -100, 100) }]; })),
    lut: v.lut && typeof v.lut.id === 'string' ? { id: v.lut.id, amount: num(v.lut.amount, 100, 0, 100) } : null,
  };
}
