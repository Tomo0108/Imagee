/** @typedef {{ scale: number, x: number, y: number }} View  x/y: screen position of the image's top-left corner, in CSS px. */

export const MIN_SCALE = 0.01;
export const MAX_SCALE = 64;
/** Preset zoom levels used by the zoom buttons and keyboard shortcuts. */
export const ZOOM_STEPS = [0.01, 0.02, 0.03, 0.05, 0.0625, 0.0833, 0.125, 0.1667, 0.25, 0.333, 0.5, 0.667, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];

/** @param {number} scale */
export function clampScale(scale) { return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)); }

/** Scale that shows the whole image inside the viewport, never enlarging past 100%.
 * @param {number} width @param {number} height @param {number} viewWidth @param {number} viewHeight @param {number} [padding] */
export function fitScale(width, height, viewWidth, viewHeight, padding = 48) {
  if (width <= 0 || height <= 0) return 1;
  const w = Math.max(1, viewWidth - padding * 2), h = Math.max(1, viewHeight - padding * 2);
  return clampScale(Math.min(1, w / width, h / height));
}

/** View that centres the image at the given scale.
 * @param {number} width @param {number} height @param {number} viewWidth @param {number} viewHeight @param {number} scale
 * @returns {View} */
export function centered(width, height, viewWidth, viewHeight, scale) {
  return { scale, x: Math.round((viewWidth - width * scale) / 2), y: Math.round((viewHeight - height * scale) / 2) };
}

/** Next preset zoom level above (1) or below (-1) the current scale.
 * @param {number} current @param {1|-1} direction */
export function stepZoom(current, direction) {
  const epsilon = 1e-6;
  if (direction > 0) return ZOOM_STEPS.find(step => step > current + epsilon) ?? MAX_SCALE;
  return [...ZOOM_STEPS].reverse().find(step => step < current - epsilon) ?? MIN_SCALE;
}

/** Zoom to a new scale keeping the image point under (px, py) fixed on screen.
 * @param {View} view @param {number} scale @param {number} px @param {number} py
 * @returns {View} */
export function zoomAt(view, scale, px, py) {
  const next = clampScale(scale);
  const ratio = next / view.scale;
  return { scale: next, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio };
}

/** Converts a screen point to image pixel coordinates.
 * @param {View} view @param {number} px @param {number} py */
export function toImage(view, px, py) { return { x: (px - view.x) / view.scale, y: (py - view.y) / view.scale }; }

/** @param {number} scale */
export function formatZoom(scale) {
  const percent = scale * 100;
  return `${percent >= 10 ? Math.round(percent) : Number(percent.toFixed(1))}%`;
}
