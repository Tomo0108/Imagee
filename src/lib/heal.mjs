/** Spot healing: replaces a painted area with texture from a nearby area and blends it in seamlessly.
 * 1. Candidate source offsets around the area are scored by how well their surroundings match the area's border.
 * 2. The best source is copied in, and the colour difference along the border is spread smoothly across the
 *    area (a membrane / Laplace solve), so texture comes from the source and tone from the surroundings.
 * @param {Uint8ClampedArray} data RGBA, width × height @param {number} width @param {number} height
 * @param {Float32Array} mask 0..1 per pixel, how strongly each pixel is replaced
 * @returns {{ data: Uint8ClampedArray, offset: { x: number, y: number } | null } | null} */
export function heal(data, width, height, mask) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (mask[y * width + x] > 0.01) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  const hole = (/** @type {number} */ x, /** @type {number} */ y) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] > 0.01;
  const pad = 3;
  const gx0 = Math.max(0, x0 - pad), gy0 = Math.max(0, y0 - pad), gx1 = Math.min(width - 1, x1 + pad), gy1 = Math.min(height - 1, y1 + pad);
  const gw = gx1 - gx0 + 1, gh = gy1 - gy0 + 1;

  // Border ring: pixels just outside the area.
  /** @type {number[]} */ const ring = [];
  for (let y = gy0; y <= gy1; y++) for (let x = gx0; x <= gx1; x++) {
    if (hole(x, y)) continue;
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2 && !near; dx++) near = hole(x + dx, y + dy);
    if (near) ring.push(y * width + x);
  }

  const extent = Math.max(x1 - x0 + 1, y1 - y0 + 1);
  /** @type {{ x: number, y: number } | null} */ let best = null;
  let bestScore = Infinity;
  for (const k of [1.15, 1.6, 2.3]) for (let a = 0; a < 16; a++) {
    const ox = Math.round(Math.cos(a * Math.PI / 8) * extent * k), oy = Math.round(Math.sin(a * Math.PI / 8) * extent * k);
    if (gx0 + ox < 0 || gy0 + oy < 0 || gx1 + ox >= width || gy1 + oy >= height) continue;
    // The source must not overlap the area itself.
    let overlap = false;
    for (let y = y0; y <= y1 && !overlap; y += 2) for (let x = x0; x <= x1 && !overlap; x += 2) overlap = mask[y * width + x] > 0.01 && hole(x + ox, y + oy);
    if (overlap) continue;
    let score = 0;
    const shift = (oy * width + ox) * 4;
    for (const p of ring) { const i = p * 4; for (let c = 0; c < 4; c++) { const d = data[i + c] - data[i + shift + c]; score += d * d; } }
    score = score / Math.max(1, ring.length) * (1 + k * 0.05);
    if (score < bestScore) { bestScore = score; best = { x: ox, y: oy }; }
  }

  // Patch from the source (zero without one: then the area is filled smoothly from its border).
  const n = gw * gh;
  const patch = new Float32Array(n * 4), diff = new Float32Array(n * 4), inside = new Uint8Array(n);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const x = gx0 + gx, y = gy0 + gy, g = gy * gw + gx, i = (y * width + x) * 4;
    inside[g] = hole(x, y) ? 1 : 0;
    for (let c = 0; c < 4; c++) {
      patch[g * 4 + c] = best ? data[i + (best.y * width + best.x) * 4 + c] : 0;
      diff[g * 4 + c] = data[i + c] - patch[g * 4 + c];
    }
  }
  // Start from an inverse-distance blend of border samples, then relax (Jacobi) towards the smooth membrane.
  const samples = ring.filter((_, i) => i % Math.max(1, Math.ceil(ring.length / 96)) === 0).map(p => {
    const x = p % width, y = (p - x) / width, g = (y - gy0) * gw + (x - gx0);
    return { x, y, d: [diff[g * 4], diff[g * 4 + 1], diff[g * 4 + 2], diff[g * 4 + 3]] };
  });
  for (let g = 0; g < n; g++) {
    if (!inside[g]) continue;
    const x = gx0 + g % gw, y = gy0 + Math.floor(g / gw);
    let total = 0; const acc = [0, 0, 0, 0];
    for (const s of samples) { const w = 1 / ((s.x - x) ** 2 + (s.y - y) ** 2 + 1); total += w; for (let c = 0; c < 4; c++) acc[c] += s.d[c] * w; }
    for (let c = 0; c < 4; c++) diff[g * 4 + c] = total ? acc[c] / total : 0;
  }
  const iterations = Math.min(600, 60 + extent * 3);
  const next = new Float32Array(diff);
  for (let it = 0; it < iterations; it++) {
    for (let gy = 1; gy < gh - 1; gy++) for (let gx = 1; gx < gw - 1; gx++) {
      const g = gy * gw + gx;
      if (!inside[g]) continue;
      for (let c = 0; c < 4; c++) next[g * 4 + c] = (diff[(g - 1) * 4 + c] + diff[(g + 1) * 4 + c] + diff[(g - gw) * 4 + c] + diff[(g + gw) * 4 + c]) / 4;
    }
    diff.set(next);
  }

  const out = new Uint8ClampedArray(data);
  for (let g = 0; g < n; g++) {
    if (!inside[g]) continue;
    const x = gx0 + g % gw, y = gy0 + Math.floor(g / gw), p = y * width + x, m = Math.min(1, mask[p]);
    for (let c = 0; c < 4; c++) out[p * 4 + c] = data[p * 4 + c] * (1 - m) + (patch[g * 4 + c] + diff[g * 4 + c]) * m;
  }
  return { data: out, offset: best };
}
