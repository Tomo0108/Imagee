/** Pixels similar to the seed colour, as a 0/255 mask. Used by the magic wand and the paint bucket.
 * @param {Uint8ClampedArray} data RGBA @param {number} width @param {number} height @param {number} sx @param {number} sy
 * @param {number} tolerance 0..255, largest per-channel difference allowed @param {boolean} contiguous
 * @returns {Uint8Array} */
export function floodMask(data, width, height, sx, sy, tolerance, contiguous = true) {
  const mask = new Uint8Array(width * height);
  sx = Math.floor(sx); sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return mask;
  const i0 = (sy * width + sx) * 4;
  const r = data[i0], g = data[i0 + 1], b = data[i0 + 2], a = data[i0 + 3];
  const match = (/** @type {number} */ p) => {
    const i = p * 4;
    // Fully transparent pixels match each other whatever their hidden colour.
    if (a === 0 && data[i + 3] === 0) return true;
    return Math.abs(data[i] - r) <= tolerance && Math.abs(data[i + 1] - g) <= tolerance && Math.abs(data[i + 2] - b) <= tolerance && Math.abs(data[i + 3] - a) <= tolerance;
  };
  if (!contiguous) { for (let p = 0; p < width * height; p++) if (match(p)) mask[p] = 255; return mask; }
  const stack = [sy * width + sx];
  while (stack.length) {
    const p = /** @type {number} */ (stack.pop());
    const y = Math.floor(p / width);
    let x = p - y * width;
    while (x > 0 && !mask[y * width + x - 1] && match(y * width + x - 1)) x--;
    let up = false, down = false;
    for (; x < width; x++) {
      const q = y * width + x;
      if (mask[q] || !match(q)) break;
      mask[q] = 255;
      if (y > 0) { const n = q - width; if (!mask[n] && match(n)) { if (!up) { stack.push(n); up = true; } } else up = false; }
      if (y < height - 1) { const n = q + width; if (!mask[n] && match(n)) { if (!down) { stack.push(n); down = true; } } else down = false; }
    }
  }
  return mask;
}

/** Bounding box of the non-zero entries of a mask, or null. @param {Uint8Array | Uint8ClampedArray} mask @param {number} width @param {number} height @param {number} [stride] */
export function maskBounds(mask, width, height, stride = 1) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (mask[(y * width + x) * stride + stride - 1]) {
    if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y;
  }
  return right < 0 ? null : { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}
