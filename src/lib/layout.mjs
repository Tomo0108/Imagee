/** Choose a grid that maximizes image area without cropping. */
export function arrangeImages(items, width, height) {
  if (!items.length) return [];
  const gap = Math.max(1, Math.round(Math.min(width, height) * .025));
  let best = null;
  for (let columns = 1; columns <= items.length; columns++) {
    const rows = Math.ceil(items.length / columns);
    const cellW = Math.max(1, (width - gap * (columns + 1)) / columns);
    const cellH = Math.max(1, (height - gap * (rows + 1)) / rows);
    const sizes = items.map(item => {
      const scale = Math.min(cellW / item.w, cellH / item.h);
      return { w: Math.max(1, Math.floor(item.w * scale)), h: Math.max(1, Math.floor(item.h * scale)) };
    });
    const score = sizes.reduce((total, size) => total + size.w * size.h, 0);
    if (!best || score > best.score) best = { columns, cellW, cellH, sizes, score };
  }
  return best.sizes.map((size, index) => {
    const row = Math.floor(index / best.columns), column = index % best.columns;
    const count = Math.min(best.columns, items.length - row * best.columns);
    const start = (width - (count * best.cellW + (count - 1) * gap)) / 2;
    return { ...size, x: Math.round(start + column * (best.cellW + gap) + (best.cellW - size.w) / 2), y: Math.round(gap + row * (best.cellH + gap) + (best.cellH - size.h) / 2) };
  });
}

