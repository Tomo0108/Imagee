import { t } from '../i18n/index.mjs';
/** Non-destructive geometry: quarter turns and flips give the "oriented" frame (W×H); the image is then
 * rotated by `angle` degrees about the frame centre, and `crop` (in frame coordinates) is the output.
 * @typedef {{ x: number, y: number, w: number, h: number }} Rect
 * @typedef {{ quarter: 0|1|2|3, flipH: boolean, flipV: boolean, angle: number, crop: Rect | null }} Geometry */

/** @type {Geometry} */
export const IDENTITY = { quarter: 0, flipH: false, flipV: false, angle: 0, crop: null };
export const MAX_ANGLE = 45;
export const ASPECTS = [
  { id: 'free', label: t('自由'), ratio: 0 },
  { id: 'original', label: t('元の比率'), ratio: -1 },
  { id: '1:1', label: '1:1', ratio: 1 },
  ...[['5:4', 5 / 4], ['4:3', 4 / 3], ['3:4', 3 / 4], ['5:7', 5 / 7], ['7:5', 7 / 5], ['2:1', 2], ['1:2', .5], ['21:9', 21 / 9], ['A判 縦', 1 / Math.sqrt(2)], ['A判 横', Math.sqrt(2)]].map(([id, ratio]) => ({ id: String(id), label: String(id), ratio: Number(ratio) })),
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '2:3', label: '2:3', ratio: 2 / 3 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
];

/** @param {number} width @param {number} height @param {number} quarter */
export function orientedSize(width, height, quarter) { return quarter % 2 ? { width: height, height: width } : { width, height }; }

/** Scale of the largest rectangle with the frame's own aspect ratio that fits inside the frame rotated by `angle`.
 * @param {number} width @param {number} height @param {number} angle degrees */
export function inscribedScale(width, height, angle) {
  const t = Math.abs(angle) * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  return Math.min(1, width / (width * c + height * s), height / (width * s + height * c));
}

/** The crop that removes the empty corners a rotation would leave. @param {number} width @param {number} height @param {number} angle @returns {Rect} */
export function autoCrop(width, height, angle) {
  const k = inscribedScale(width, height, angle), w = width * k, h = height * k;
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

/** Output size in pixels. @param {Geometry} g @param {number} width source width @param {number} height source height */
export function outputSize(g, width, height) {
  const frame = orientedSize(width, height, g.quarter);
  const crop = g.crop || autoCrop(frame.width, frame.height, g.angle);
  return { width: Math.max(1, Math.round(crop.w)), height: Math.max(1, Math.round(crop.h)) };
}

/** Crop rect actually in effect. @param {Geometry} g @param {number} width @param {number} height @returns {Rect} */
export function effectiveCrop(g, width, height) {
  const frame = orientedSize(width, height, g.quarter);
  return g.crop || autoCrop(frame.width, frame.height, g.angle);
}

/** @param {Rect} r @param {{ width: number, height: number }} frame @returns {Rect} */
export function clampRect(r, frame) {
  const w = Math.min(frame.width, Math.max(1, r.w)), h = Math.min(frame.height, Math.max(1, r.h));
  return { x: Math.min(frame.width - w, Math.max(0, r.x)), y: Math.min(frame.height - h, Math.max(0, r.y)), w, h };
}

/** Largest rect of `ratio` (w/h) centred on `around`, inside the frame. @param {Rect} around @param {number} ratio @param {{ width: number, height: number }} frame @returns {Rect} */
export function fitAspect(around, ratio, frame) {
  if (!(ratio > 0)) return clampRect(around, frame);
  const cx = around.x + around.w / 2, cy = around.y + around.h / 2;
  let w = Math.min(around.w, frame.width), h = w / ratio;
  if (h > Math.min(around.h, frame.height)) { h = Math.min(around.h, frame.height); w = h * ratio; }
  // Grow back to the original area where room allows so switching ratios does not shrink the crop each time.
  const grow = Math.min(Math.sqrt((around.w * around.h) / (w * h)), frame.width / w, frame.height / h);
  w *= grow; h *= grow;
  return clampRect({ x: cx - w / 2, y: cy - h / 2, w, h }, frame);
}

/** Resize from a handle ('n','s','e','w','ne','nw','se','sw') by (dx, dy) frame units, keeping `ratio` when > 0.
 * @param {Rect} start @param {string} handle @param {number} dx @param {number} dy @param {number} ratio @param {{ width: number, height: number }} frame @returns {Rect} */
export function resizeCrop(start, handle, dx, dy, ratio, frame) {
  const min = 8;
  let left = start.x, top = start.y, right = start.x + start.w, bottom = start.y + start.h;
  if (handle.includes('w')) left = Math.min(right - min, Math.max(0, left + dx));
  if (handle.includes('e')) right = Math.max(left + min, Math.min(frame.width, right + dx));
  if (handle.includes('n')) top = Math.min(bottom - min, Math.max(0, top + dy));
  if (handle.includes('s')) bottom = Math.max(top + min, Math.min(frame.height, bottom + dy));
  if (ratio > 0) {
    let w = right - left, h = bottom - top;
    const horizontal = handle === 'e' || handle === 'w', vertical = handle === 'n' || handle === 's';
    if (horizontal) h = w / ratio; else if (vertical) w = h * ratio;
    else if (w / h > ratio) w = h * ratio; else h = w / ratio;
    // Shrink to fit the frame from the anchored side.
    const maxW = handle.includes('w') ? right : handle.includes('e') ? frame.width - left : frame.width;
    const maxH = handle.includes('n') ? bottom : handle.includes('s') ? frame.height - top : frame.height;
    const k = Math.min(1, maxW / w, maxH / h); w *= k; h *= k;
    const cx = (left + right) / 2, cy = (top + bottom) / 2;
    left = handle.includes('w') ? right - w : handle.includes('e') ? left : cx - w / 2;
    top = handle.includes('n') ? bottom - h : handle.includes('s') ? top : cy - h / 2;
    return clampRect({ x: left, y: top, w, h }, frame);
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Rotates the geometry a quarter turn clockwise (1) or counter-clockwise (-1), carrying the crop with it.
 * @param {Geometry} g @param {1|-1} direction @param {number} width @param {number} height @returns {Geometry} */
export function rotateQuarter(g, direction, width, height) {
  const frame = orientedSize(width, height, g.quarter);
  const quarter = /** @type {0|1|2|3} */ ((g.quarter + direction + 4) % 4);
  let crop = g.crop;
  if (crop) crop = direction > 0
    ? { x: frame.height - crop.y - crop.h, y: crop.x, w: crop.h, h: crop.w }
    : { x: crop.y, y: frame.width - crop.x - crop.w, w: crop.h, h: crop.w };
  // A quarter turn swaps which screen axis a flip mirrors.
  return { ...g, quarter, flipH: g.flipV, flipV: g.flipH, crop };
}

/** @param {Geometry} g @param {'h'|'v'} axis @param {number} width @param {number} height @returns {Geometry} */
export function flip(g, axis, width, height) {
  const frame = orientedSize(width, height, g.quarter);
  const crop = g.crop && (axis === 'h' ? { ...g.crop, x: frame.width - g.crop.x - g.crop.w } : { ...g.crop, y: frame.height - g.crop.y - g.crop.h });
  return axis === 'h' ? { ...g, flipH: !g.flipH, angle: -g.angle, crop } : { ...g, flipV: !g.flipV, angle: -g.angle, crop };
}

/** @param {Geometry} g */
export function isIdentity(g) { return !g.quarter && !g.flipH && !g.flipV && !g.angle && !g.crop; }

/** 2D affine matrices in canvas order [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f.
 * @typedef {[number, number, number, number, number, number]} Matrix */

/** @param {Matrix} m @param {Matrix} n @returns {Matrix} m·n (apply n first) */
export function multiply(m, n) {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}
/** @param {Matrix} m @returns {Matrix} */
export function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}
/** @param {Matrix} m @param {number} x @param {number} y */
export function apply(m, x, y) { return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }; }
const translate = (/** @type {number} */ x, /** @type {number} */ y) => /** @type {Matrix} */ ([1, 0, 0, 1, x, y]);
const scaleBy = (/** @type {number} */ x, /** @type {number} */ y) => /** @type {Matrix} */ ([x, 0, 0, y, 0, 0]);
const rotate = (/** @type {number} */ r) => /** @type {Matrix} */ ([Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]);

/** Maps source pixels to the output (mode 'output') or to the rotated frame (mode 'frame').
 * @param {Geometry} g @param {number} width @param {number} height @param {'output'|'frame'} mode @returns {Matrix} */
export function sourceMatrix(g, width, height, mode) {
  const frame = orientedSize(width, height, g.quarter);
  const crop = effectiveCrop(g, width, height);
  let m = mode === 'output' ? translate(-crop.x, -crop.y) : translate(0, 0);
  for (const step of [translate(frame.width / 2, frame.height / 2), rotate(g.angle * Math.PI / 180), scaleBy(g.flipH ? -1 : 1, g.flipV ? -1 : 1), rotate(g.quarter * Math.PI / 2), translate(-width / 2, -height / 2)]) m = multiply(m, step);
  return m;
}
