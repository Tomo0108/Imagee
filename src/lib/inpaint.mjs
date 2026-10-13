import { t } from '../i18n/index.mjs';
/** Object removal: fills a hole with texture from the rest of the image (exemplar-based image completion).
 *
 * Multi-scale, after Wexler et al. "Space-Time Completion" with PatchMatch (Barnes et al.) for the nearest-neighbour search:
 * 1. Build a pyramid until the hole is only a few patches wide, and fill it there by diffusion.
 * 2. At each level, find for every patch touching the hole the most similar patch fully outside it (PatchMatch),
 *    then set each hole pixel to the similarity-weighted average of what those patches say it should be. Repeat.
 * 3. Upsample the result as the starting point of the next finer level.
 * Runs on a crop around the hole, so the cost follows the size of the hole, not of the image.
 */

const P = 3; // patch radius: 7 × 7 patches

/** @param {Uint8ClampedArray} data RGBA @param {number} width @param {number} height
 * @param {Float32Array} weights 0..1 per pixel; > 0.05 is filled, partial values blend at the edge
 * @param {{ random?: () => number, onProgress?: (fraction: number) => void }} [options]
 * @returns {Uint8ClampedArray | null} the filled image (same size), or null when there is nothing to fill */
export function inpaint(data, width, height, weights, options = {}) {
  const random = options.random || Math.random;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (weights[y * width + x] > 0.05) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  // Work on a crop with enough surroundings to borrow texture from.
  const extent = Math.max(x1 - x0 + 1, y1 - y0 + 1);
  const margin = Math.max(24, Math.round(extent * 1.2));
  const cx0 = Math.max(0, x0 - margin), cy0 = Math.max(0, y0 - margin);
  const cw = Math.min(width, x1 + margin + 1) - cx0, ch = Math.min(height, y1 + margin + 1) - cy0;
  const image = new Float32Array(cw * ch * 4), hole = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const s = (y + cy0) * width + x + cx0, t = y * cw + x;
    for (let c = 0; c < 4; c++) image[t * 4 + c] = data[s * 4 + c];
    // Grow the hole by a pixel so soft brush edges and anti-aliasing are replaced too.
    hole[t] = weights[s] > 0.05 ? 1 : 0;
  }
  dilate(hole, cw, ch);
  let known = 0;
  for (let i = 0; i < hole.length; i++) if (!hole[i]) known++;
  if (known < (2 * P + 1) ** 2) throw new Error(t('周りに参照できる部分がないため、埋められません。消したい部分だけを選んでください。'));

  // Pyramid: halve until the hole is at most a few patches across.
  /** @type {{ image: Float32Array, hole: Uint8Array, w: number, h: number }[]} */
  const levels = [{ image, hole, w: cw, h: ch }];
  let holeExtent = extent + 2;
  while (holeExtent > P * 6 && Math.min(levels[levels.length - 1].w, levels[levels.length - 1].h) > P * 8) {
    levels.push(downsample(levels[levels.length - 1]));
    holeExtent /= 2;
  }
  const coarsest = levels[levels.length - 1];
  diffuse(coarsest.image, coarsest.hole, coarsest.w, coarsest.h);

  const total = levels.length;
  for (let l = levels.length - 1; l >= 0; l--) {
    const level = levels[l];
    if (l < levels.length - 1) upsampleInto(levels[l + 1], level);
    const passes = l === 0 ? 3 : 5;
    complete(level, passes, random);
    options.onProgress?.((total - l) / total);
  }

  const out = new Uint8ClampedArray(data);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const t = y * cw + x;
    if (!hole[t]) continue;
    const s = (y + cy0) * width + x + cx0;
    // Inside the painted area replace fully; on the grown rim blend by the brush weight.
    const a = Math.max(Math.min(1, weights[s] * 1.5), weights[s] > 0.05 ? 1 : 0.5);
    for (let c = 0; c < 4; c++) out[s * 4 + c] = data[s * 4 + c] * (1 - a) + image[t * 4 + c] * a;
  }
  return out;
}

/** @param {Uint8Array} hole @param {number} w @param {number} h */
function dilate(hole, w, h) {
  const copy = hole.slice();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (copy[y * w + x]) continue;
    if ((x > 0 && copy[y * w + x - 1]) || (x < w - 1 && copy[y * w + x + 1]) || (y > 0 && copy[(y - 1) * w + x]) || (y < h - 1 && copy[(y + 1) * w + x])) hole[y * w + x] = 1;
  }
}

/** Half size. Known pixels average only known children; a pixel is in the hole if any child is.
 * @param {{ image: Float32Array, hole: Uint8Array, w: number, h: number }} level */
function downsample({ image, hole, w, h }) {
  const nw = Math.ceil(w / 2), nh = Math.ceil(h / 2);
  const out = new Float32Array(nw * nh * 4), outHole = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    let n = 0, any = 0;
    const sum = [0, 0, 0, 0];
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const sx = Math.min(w - 1, x * 2 + dx), sy = Math.min(h - 1, y * 2 + dy), s = sy * w + sx;
      if (hole[s]) { any = 1; continue; }
      for (let c = 0; c < 4; c++) sum[c] += image[s * 4 + c];
      n++;
    }
    const t = y * nw + x;
    outHole[t] = any;
    if (n) for (let c = 0; c < 4; c++) out[t * 4 + c] = sum[c] / n;
  }
  return { image: out, hole: outHole, w: nw, h: nh };
}

/** Fills the hole from its edge inwards with the average of known neighbours (the coarsest starting guess).
 * @param {Float32Array} image @param {Uint8Array} hole @param {number} w @param {number} h */
function diffuse(image, hole, w, h) {
  const known = new Uint8Array(w * h);
  let left = 0;
  for (let i = 0; i < known.length; i++) { known[i] = hole[i] ? 0 : 1; if (hole[i]) left++; }
  if (left === known.length) { image.fill(128); return; }
  while (left > 0) {
    /** @type {number[]} */ const ready = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (known[i]) continue;
      if ((x > 0 && known[i - 1]) || (x < w - 1 && known[i + 1]) || (y > 0 && known[i - w]) || (y < h - 1 && known[i + w])) ready.push(i);
    }
    for (const i of ready) {
      const x = i % w, y = (i - x) / w;
      let n = 0;
      const sum = [0, 0, 0, 0];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || !known[ny * w + nx]) continue;
        for (let c = 0; c < 4; c++) sum[c] += image[(ny * w + nx) * 4 + c];
        n++;
      }
      for (let c = 0; c < 4; c++) image[i * 4 + c] = sum[c] / n;
    }
    for (const i of ready) known[i] = 1;
    left -= ready.length;
  }
}

/** The finer level's hole starts from the coarser result (nearest sample). */
function upsampleInto(/** @type {{ image: Float32Array, w: number, h: number }} */ coarse, /** @type {{ image: Float32Array, hole: Uint8Array, w: number, h: number }} */ fine) {
  for (let y = 0; y < fine.h; y++) for (let x = 0; x < fine.w; x++) {
    const t = y * fine.w + x;
    if (!fine.hole[t]) continue;
    const s = Math.min(coarse.h - 1, y >> 1) * coarse.w + Math.min(coarse.w - 1, x >> 1);
    for (let c = 0; c < 4; c++) fine.image[t * 4 + c] = coarse.image[s * 4 + c];
  }
}

/** EM passes of PatchMatch search + weighted voting at one level.
 * @param {{ image: Float32Array, hole: Uint8Array, w: number, h: number }} level @param {number} passes @param {() => number} random */
function complete({ image, hole, w, h }, passes, random) {
  // Valid sources: patch centres whose whole patch is inside the image and outside the hole.
  const valid = new Uint8Array(w * h);
  /** @type {number[]} */ const sources = [];
  for (let y = P; y < h - P; y++) for (let x = P; x < w - P; x++) {
    let ok = 1;
    for (let dy = -P; dy <= P && ok; dy++) for (let dx = -P; dx <= P; dx++) if (hole[(y + dy) * w + x + dx]) { ok = 0; break; }
    if (ok) { valid[y * w + x] = 1; sources.push(y * w + x); }
  }
  if (!sources.length) return;
  // Targets: every patch centre whose patch touches the hole.
  const near = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!hole[y * w + x]) continue;
    for (let dy = -P; dy <= P; dy++) for (let dx = -P; dx <= P; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) near[ny * w + nx] = 1;
    }
  }
  /** @type {number[]} */ const targets = [];
  for (let i = 0; i < near.length; i++) if (near[i]) targets.push(i);
  const nn = new Int32Array(w * h).fill(-1), cost = new Float32Array(w * h);

  const distance = (/** @type {number} */ t, /** @type {number} */ s) => {
    const tx = t % w, ty = (t - tx) / w, sx = s % w, sy = (s - sx) / w;
    let d = 0, n = 0;
    for (let dy = -P; dy <= P; dy++) {
      const py = ty + dy;
      if (py < 0 || py >= h) continue;
      for (let dx = -P; dx <= P; dx++) {
        const px = tx + dx;
        if (px < 0 || px >= w) continue;
        const a = (py * w + px) * 4, b = ((sy + dy) * w + sx + dx) * 4;
        const e0 = image[a] - image[b], e1 = image[a + 1] - image[b + 1], e2 = image[a + 2] - image[b + 2], e3 = image[a + 3] - image[b + 3];
        d += e0 * e0 + e1 * e1 + e2 * e2 + e3 * e3;
        n++;
      }
    }
    return d / n;
  };
  const tryCandidate = (/** @type {number} */ t, /** @type {number} */ s) => {
    if (s < 0 || !valid[s] || s === nn[t]) return;
    const d = distance(t, s);
    if (d < cost[t]) { cost[t] = d; nn[t] = s; }
  };

  for (const t of targets) { nn[t] = sources[Math.floor(random() * sources.length)]; cost[t] = distance(t, nn[t]); }

  for (let pass = 0; pass < passes; pass++) {
    // Costs change as the hole is refilled, so refresh them first.
    for (const t of targets) cost[t] = distance(t, nn[t]);
    for (let iteration = 0; iteration < 2; iteration++) {
      const forward = (pass + iteration) % 2 === 0, step = forward ? 1 : -1;
      for (let k = forward ? 0 : targets.length - 1; k >= 0 && k < targets.length; k += step) {
        const t = targets[k], x = t % w, y = (t - x) / w;
        // Propagation: a neighbour's match, shifted by one.
        const nx = x - step, ny = y - step;
        if (nx >= 0 && nx < w && near[y * w + nx] && nn[y * w + nx] >= 0) { const s = nn[y * w + nx], sx = s % w + step; if (sx >= 0 && sx < w) tryCandidate(t, s + step); }
        if (ny >= 0 && ny < h && near[ny * w + x] && nn[ny * w + x] >= 0) { const s = nn[ny * w + x] + step * w; if (s >= 0 && s < w * h) tryCandidate(t, s); }
        // Random search in shrinking windows around the current match.
        const bx = nn[t] % w, by = (nn[t] - bx) / w;
        for (let r = Math.max(w, h); r >= 1; r >>= 1) {
          const rx = Math.round(bx + (random() * 2 - 1) * r), ry = Math.round(by + (random() * 2 - 1) * r);
          if (rx >= P && ry >= P && rx < w - P && ry < h - P) tryCandidate(t, ry * w + rx);
        }
      }
    }
    // Voting: each hole pixel takes the weighted average of the pixels its overlapping patches propose.
    let mean = 0;
    for (const t of targets) mean += cost[t];
    mean = mean / targets.length + 1e-3;
    const sum = new Float32Array(w * h * 4), weight = new Float32Array(w * h);
    for (const t of targets) {
      const tx = t % w, ty = (t - tx) / w, s = nn[t], sx = s % w, sy = (s - sx) / w;
      const wt = Math.exp(-cost[t] / (2 * mean));
      for (let dy = -P; dy <= P; dy++) {
        const py = ty + dy;
        if (py < 0 || py >= h) continue;
        for (let dx = -P; dx <= P; dx++) {
          const px = tx + dx;
          if (px < 0 || px >= w) continue;
          const p = py * w + px;
          if (!hole[p]) continue;
          const q = ((sy + dy) * w + sx + dx) * 4;
          sum[p * 4] += image[q] * wt; sum[p * 4 + 1] += image[q + 1] * wt; sum[p * 4 + 2] += image[q + 2] * wt; sum[p * 4 + 3] += image[q + 3] * wt;
          weight[p] += wt;
        }
      }
    }
    for (let p = 0; p < w * h; p++) if (hole[p] && weight[p] > 0) for (let c = 0; c < 4; c++) image[p * 4 + c] = sum[p * 4 + c] / weight[p];
  }
}
