/** Smart guides: while an object is dragged, its edges and centre snap to the canvas and to other objects.
 * @typedef {{ x: number, y: number, w: number, h: number }} Box
 * @typedef {{ axis: 'x' | 'y', at: number, from: number, to: number, kind: 'edge' | 'center' }} Guide
 * @typedef {{ axis: 'x' | 'y', from: number, to: number, at: number, length: number }} Gap */

/** @param {Box} b @returns {[number, number, number]} left, centre, right */
const xs = b => [b.x, b.x + b.w / 2, b.x + b.w];
/** @param {Box} b @returns {[number, number, number]} top, middle, bottom */
const ys = b => [b.y, b.y + b.h / 2, b.y + b.h];

/** Best offset along one axis that brings any of `own` lines onto any target line within `threshold`. */
function nearest(own, targets, threshold) {
  let best = null;
  for (const line of own) for (const target of targets) {
    const delta = target - line;
    if (Math.abs(delta) <= threshold && (best === null || Math.abs(delta) < Math.abs(best))) best = delta;
  }
  return best;
}

/** Snaps a dragged box. `others` are boxes to align with; `frame` is the canvas.
 * Returns how far to shift the box and the guide lines to draw (all in document pixels).
 * @param {Box} box @param {Box[]} others @param {Box} frame @param {number} threshold
 * @returns {{ dx: number, dy: number, guides: Guide[], gaps: Gap[] }} */
export function snapBox(box, others, frame, threshold) {
  const targets = [frame, ...others];
  const dx = nearest(xs(box), targets.flatMap(xs), threshold) ?? 0;
  const dy = nearest(ys(box), targets.flatMap(ys), threshold) ?? 0;
  const moved = { ...box, x: box.x + dx, y: box.y + dy };
  /** @type {Guide[]} */ const guides = [];
  const seen = new Set();
  for (const target of targets) {
    xs(moved).forEach((line, i) => xs(target).forEach((t, j) => {
      if (Math.abs(line - t) > 0.5 || seen.has(`x${t}`)) return;
      seen.add(`x${t}`);
      guides.push({ axis: 'x', at: t, from: Math.min(moved.y, target.y), to: Math.max(moved.y + moved.h, target.y + target.h), kind: i === 1 && j === 1 ? 'center' : 'edge' });
    }));
    ys(moved).forEach((line, i) => ys(target).forEach((t, j) => {
      if (Math.abs(line - t) > 0.5 || seen.has(`y${t}`)) return;
      seen.add(`y${t}`);
      guides.push({ axis: 'y', at: t, from: Math.min(moved.x, target.x), to: Math.max(moved.x + moved.w, target.x + target.w), kind: i === 1 && j === 1 ? 'center' : 'edge' });
    }));
  }
  return { dx, dy, guides, gaps: gaps(moved, others, frame) };
}

/** Distances from the box to the nearest object (or the canvas edge) on each side, for the measurement labels.
 * @param {Box} box @param {Box[]} others @param {Box} frame @returns {Gap[]} */
export function gaps(box, others, frame) {
  const overlapsY = o => o.y < box.y + box.h && o.y + o.h > box.y;
  const overlapsX = o => o.x < box.x + box.w && o.x + o.w > box.x;
  const midY = box.y + box.h / 2, midX = box.x + box.w / 2;
  const left = Math.max(frame.x, ...others.filter(o => overlapsY(o) && o.x + o.w <= box.x).map(o => o.x + o.w));
  const right = Math.min(frame.x + frame.w, ...others.filter(o => overlapsY(o) && o.x >= box.x + box.w).map(o => o.x));
  const top = Math.max(frame.y, ...others.filter(o => overlapsX(o) && o.y + o.h <= box.y).map(o => o.y + o.h));
  const bottom = Math.min(frame.y + frame.h, ...others.filter(o => overlapsX(o) && o.y >= box.y + box.h).map(o => o.y));
  /** @type {Gap[]} */ const list = [];
  if (box.x > left) list.push({ axis: 'x', from: left, to: box.x, at: midY, length: Math.round(box.x - left) });
  if (box.x + box.w < right) list.push({ axis: 'x', from: box.x + box.w, to: right, at: midY, length: Math.round(right - box.x - box.w) });
  if (box.y > top) list.push({ axis: 'y', from: top, to: box.y, at: midX, length: Math.round(box.y - top) });
  if (box.y + box.h < bottom) list.push({ axis: 'y', from: box.y + box.h, to: bottom, at: midX, length: Math.round(bottom - box.y - box.h) });
  return list;
}

/** Bounding box of the visible (alpha > 0) pixels of RGBA data, or null when it is empty.
 * @param {Uint8ClampedArray} data @param {number} width @param {number} height @returns {Box | null} */
export function alphaBounds(data, width, height) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
