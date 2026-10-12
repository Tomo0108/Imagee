/** Helpers for the on-device AI tools: model input/output conversion, edge-aware mask refinement, sky detection, tiling. */

const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

/** RGBA → NCHW float input for U²-Net style salient-object models (scaled by the brightest value, then ImageNet-normalised).
 * @param {Uint8ClampedArray} rgba @param {number} size side of the square input @returns {Float32Array} */
export function segmentInput(rgba, size) {
  const n = size * size, out = new Float32Array(3 * n);
  let max = 1;
  for (let i = 0; i < n; i++) max = Math.max(max, rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) out[c * n + i] = (rgba[i * 4 + c] / max - MEAN[c]) / STD[c];
  return out;
}

/** Stretches a model's output to 0..1. @param {Float32Array} values @returns {Float32Array} */
export function normalize(values) {
  let lo = Infinity, hi = -Infinity;
  for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const range = hi - lo || 1, out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = (values[i] - lo) / range;
  return out;
}

/** Mean over a (2r+1)² window, clamped at the edges, via a summed-area table.
 * @param {Float32Array} src @param {number} w @param {number} h @param {number} r */
export function boxMean(src, w, h, r) {
  const sat = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += src[y * w + x]; sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1] + row; }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - r), yb = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const xa = Math.max(0, x - r), xb = Math.min(w, x + r + 1);
      const s = sat[yb * (w + 1) + xb] - sat[ya * (w + 1) + xb] - sat[yb * (w + 1) + xa] + sat[ya * (w + 1) + xa];
      out[y * w + x] = s / ((yb - ya) * (xb - xa));
    }
  }
  return out;
}

/** Guided filter (He et al.): smooths `p` while following the edges of the guide image `guide` (both 0..1).
 * Used to snap a low-resolution mask to the real edges of the photo.
 * @param {Float32Array} guide @param {Float32Array} p @param {number} w @param {number} h @param {number} r @param {number} eps */
export function guidedFilter(guide, p, w, h, r, eps) {
  const n = w * h, ip = new Float32Array(n), ii = new Float32Array(n);
  for (let i = 0; i < n; i++) { ip[i] = guide[i] * p[i]; ii[i] = guide[i] * guide[i]; }
  const mI = boxMean(guide, w, h, r), mP = boxMean(p, w, h, r), mIP = boxMean(ip, w, h, r), mII = boxMean(ii, w, h, r);
  const a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const cov = mIP[i] - mI[i] * mP[i], variance = mII[i] - mI[i] * mI[i];
    a[i] = cov / (variance + eps); b[i] = mP[i] - a[i] * mI[i];
  }
  const mA = boxMean(a, w, h, r), mB = boxMean(b, w, h, r), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.min(1, Math.max(0, mA[i] * guide[i] + mB[i]));
  return out;
}

/** Luminance 0..1 of RGBA pixels. @param {Uint8ClampedArray} rgba */
export function luminance(rgba) {
  const n = rgba.length / 4, out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]) / 255;
  return out;
}

/** Bilinear resize of a single-channel map. @param {Float32Array} src @param {number} sw @param {number} sh @param {number} w @param {number} h */
export function resizeMap(src, sw, sh, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * sh / h - 0.5)), y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * sw / w - 0.5)), x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      const top = src[y0 * sw + x0] * (1 - tx) + src[y0 * sw + x1] * tx, bottom = src[y1 * sw + x0] * (1 - tx) + src[y1 * sw + x1] * tx;
      out[y * w + x] = top * (1 - ty) + bottom * ty;
    }
  }
  return out;
}

/** Sky detection without a model: grows a region from the top edge through smooth, sky-coloured pixels
 * (blue, or bright and grey for overcast and clouds), then softens it. Returns 0..1 per pixel.
 * @param {Uint8ClampedArray} rgba @param {number} w @param {number} h */
export function skyMask(rgba, w, h) {
  const n = w * h, lum = luminance(rgba), sky = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4] / 255, g = rgba[i * 4 + 1] / 255, b = rgba[i * 4 + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), sat = max ? (max - min) / max : 0;
    const blue = b >= r && b >= g * 0.9 && lum[i] > 0.25;
    const overcast = sat < 0.18 && lum[i] > 0.55;
    const dusk = r > b && lum[i] > 0.45 && sat < 0.6 && b > 0.25;
    sky[i] = blue || overcast || dusk ? 1 : 0;
  }
  // Edges stop the growth so buildings and trees against the sky are left out.
  const edge = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = lum[i + 1] - lum[i - 1], gy = lum[i + w] - lum[i - w];
    edge[i] = Math.hypot(gx, gy);
  }
  const grown = new Uint8Array(n), queue = new Int32Array(n);
  let head = 0, tail = 0;
  for (let x = 0; x < w; x++) if (sky[x] && edge[x] < 0.12) { grown[x] = 1; queue[tail++] = x; }
  while (head < tail) {
    const i = queue[head++], x = i % w, y = (i - x) / w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j < 0 || grown[j] || !sky[j] || edge[j] > 0.12) continue;
      const dr = rgba[i * 4] - rgba[j * 4], dg = rgba[i * 4 + 1] - rgba[j * 4 + 1], db = rgba[i * 4 + 2] - rgba[j * 4 + 2];
      if (dr * dr + dg * dg + db * db > 18 * 18 * 3) continue;
      grown[j] = 1; queue[tail++] = j;
    }
  }
  const p = new Float32Array(n);
  for (let i = 0; i < n; i++) p[i] = grown[i];
  if (tail < n * 0.01) return p;
  return guidedFilter(lum, p, w, h, Math.max(2, Math.round(Math.min(w, h) / 120)), 1e-3);
}

/** Overlapping tiles covering an image, for models run piece by piece.
 * Each tile is `size` (or smaller at the edges) and reads `overlap` extra pixels on each side that are cropped away.
 * @param {number} width @param {number} height @param {number} size @param {number} overlap
 * @returns {{ x: number, y: number, w: number, h: number, inner: { x: number, y: number, w: number, h: number } }[]} */
export function tiles(width, height, size, overlap) {
  const out = [];
  for (let y = 0; y < height; y += size) for (let x = 0; x < width; x += size) {
    const iw = Math.min(size, width - x), ih = Math.min(size, height - y);
    const tx = Math.max(0, x - overlap), ty = Math.max(0, y - overlap);
    const tw = Math.min(width, x + iw + overlap) - tx, th = Math.min(height, y + ih + overlap) - ty;
    out.push({ x: tx, y: ty, w: tw, h: th, inner: { x: x - tx, y: y - ty, w: iw, h: ih } });
  }
  return out;
}

/** Largest upscale the device can hold: the 4× intermediate is capped at `maxPixels`. @param {number} w @param {number} h */
export function canUpscale(w, h, maxPixels = 48e6) { return w * h * 16 <= maxPixels && w * 4 <= 32767 && h * 4 <= 32767; }

/** Fills the colour of transparent pixels with that of their nearest visible neighbours (pull-push), keeping alpha.
 *  Models that ignore alpha then see no black halo around cut-outs.
 * @param {Uint8ClampedArray} rgba @param {number} w @param {number} h @returns {Uint8ClampedArray} */
export function bleed(rgba, w, h) {
  // Pull: a pyramid of coverage-weighted average colours; each level's coverage is capped at 1.
  const levels = [];
  let width = w, height = h;
  let color = new Float32Array(w * h * 3), cover = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = rgba[i * 4 + 3] / 255;
    cover[i] = a;
    for (let k = 0; k < 3; k++) color[i * 3 + k] = rgba[i * 4 + k];
  }
  levels.push({ width, height, color, cover });
  while (width > 1 || height > 1) {
    const nw = Math.ceil(width / 2), nh = Math.ceil(height / 2);
    const sum = new Float32Array(nw * nh * 3), weight = new Float32Array(nw * nh);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x, j = (y >> 1) * nw + (x >> 1), a = cover[i];
      if (!a) continue;
      weight[j] += a;
      for (let k = 0; k < 3; k++) sum[j * 3 + k] += color[i * 3 + k] * a;
    }
    for (let j = 0; j < nw * nh; j++) {
      if (weight[j]) for (let k = 0; k < 3; k++) sum[j * 3 + k] /= weight[j];
      weight[j] = Math.min(1, weight[j]);
    }
    width = nw; height = nh; color = sum; cover = weight;
    levels.push({ width, height, color, cover });
  }
  // Push: each level blends its own colour over its parent's by coverage.
  for (let l = levels.length - 2; l >= 0; l--) {
    const level = levels[l], parent = levels[l + 1];
    for (let y = 0; y < level.height; y++) for (let x = 0; x < level.width; x++) {
      const i = y * level.width + x, j = (y >> 1) * parent.width + (x >> 1), a = level.cover[i];
      if (a >= 1) continue;
      for (let k = 0; k < 3; k++) level.color[i * 3 + k] = level.color[i * 3 + k] * a + parent.color[j * 3 + k] * (1 - a);
    }
  }
  const out = new Uint8ClampedArray(rgba);
  const top = levels[0].color;
  for (let i = 0; i < w * h; i++) if (rgba[i * 4 + 3] < 255) for (let k = 0; k < 3; k++) out[i * 4 + k] = Math.round(top[i * 3 + k]);
  return out;
}
