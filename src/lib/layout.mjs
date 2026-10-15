/** Splits `aspects` (in order) into `rows` runs whose aspect sums are as even as possible. */
function partition(aspects, rows) {
  const n = aspects.length, prefix = [0];
  for (const a of aspects) prefix.push(prefix.at(-1) + a);
  const target = prefix[n] / rows, cost = (i, j) => (prefix[j] - prefix[i] - target) ** 2;
  // best[k][j]: lowest cost of the first j items in k rows.
  const best = Array.from({ length: rows + 1 }, () => new Array(n + 1).fill(Infinity)), from = best.map(row => row.map(() => 0));
  best[0][0] = 0;
  for (let k = 1; k <= rows; k++) for (let j = k; j <= n - (rows - k); j++) for (let i = k - 1; i < j; i++) {
    const value = best[k - 1][i] + cost(i, j);
    if (value < best[k][j]) { best[k][j] = value; from[k][j] = i; }
  }
  const cuts = [];
  for (let k = rows, j = n; k > 0; k--) { cuts.unshift([from[k][j], j]); j = from[k][j]; }
  return cuts;
}

/** Rows of equal height that fill the width (like a photo wall), shrunk to fit the height. */
function rowsLayout(items, width, height, gap, rows) {
  const aspects = items.map(item => item.w / item.h);
  const runs = partition(aspects, rows);
  const lines = runs.map(([i, j]) => {
    const sum = aspects.slice(i, j).reduce((a, b) => a + b, 0);
    return { i, j, sum, h: (width - gap * (j - i + 1)) / sum };
  });
  const free = height - gap * (rows + 1), natural = lines.reduce((total, line) => total + line.h, 0);
  if (free <= 0 || lines.some(line => line.h <= 0)) return null;
  const k = Math.min(1, free / natural);
  const used = natural * k + gap * (rows - 1);
  let y = (height - used) / 2;
  const boxes = [];
  for (const line of lines) {
    const h = line.h * k, rowWidth = line.sum * h + gap * (line.j - line.i - 1);
    let x = (width - rowWidth) / 2;
    for (let index = line.i; index < line.j; index++) {
      const w = aspects[index] * h;
      boxes.push({ x, y, w, h });
      x += w + gap;
    }
    y += h + gap;
  }
  const area = boxes.reduce((total, box) => total + box.w * box.h, 0);
  // Prefer images of similar size: an arrangement where one image dwarfs another loses a little.
  const sizes = boxes.map(box => Math.sqrt(box.w * box.h)), balance = Math.min(...sizes) / Math.max(...sizes);
  return { boxes, score: area * (0.7 + 0.3 * balance) };
}

/** Arranges images on the canvas in their order, without cropping or overlap: rows of equal height
 *  (or columns of equal width on tall canvases), as large as fits with an even gap around them. */
export function arrangeImages(items, width, height) {
  if (!items.length) return [];
  const gap = Math.max(1, Math.round(Math.min(width, height) * .025));
  let best = null;
  for (let rows = 1; rows <= items.length; rows++) {
    const across = rowsLayout(items, width, height, gap, rows);
    if (across && (!best || across.score > best.score)) best = across;
    // The same in columns: transpose the problem and the result.
    const down = rowsLayout(items.map(item => ({ w: item.h, h: item.w })), height, width, gap, rows);
    if (down && (!best || down.score > best.score)) best = { ...down, boxes: down.boxes.map(box => ({ x: box.y, y: box.x, w: box.h, h: box.w })) };
  }
  if (!best) return items.map(() => ({ x: 0, y: 0, w: 1, h: 1 }));
  return best.boxes.map(box => {
    const x = Math.max(0, Math.floor(box.x)), y = Math.max(0, Math.floor(box.y));
    return { x, y, w: Math.max(1, Math.min(width - x, Math.floor(box.w))), h: Math.max(1, Math.min(height - y, Math.floor(box.h))) };
  });
}
