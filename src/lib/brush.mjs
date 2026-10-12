/** Brush dab placement. A stroke is a series of dabs spaced a fraction of the brush diameter apart;
 * pressure scales the dab size and is interpolated between pointer samples.
 * @typedef {{ x: number, y: number, pressure: number }} Sample */

/** @param {Sample} from @param {Sample} to @param {number} size diameter at full pressure @param {number} spacing fraction of the diameter
 * @param {number} carry distance travelled since the last dab @param {boolean} pressureSize
 * @returns {{ dabs: { x: number, y: number, size: number, pressure: number }[], carry: number }} */
export function dabsAlong(from, to, size, spacing, carry, pressureSize = true) {
  const dabs = [];
  const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
  let travelled = -carry;
  for (;;) {
    const t0 = Math.max(0, travelled) / (length || 1);
    const pressure = from.pressure + (to.pressure - from.pressure) * Math.min(1, t0);
    const step = Math.max(0.5, size * (pressureSize ? Math.max(0.05, pressure) : 1) * spacing);
    travelled += step;
    if (travelled > length) { travelled -= step; break; }
    const t = travelled / (length || 1);
    const p = from.pressure + (to.pressure - from.pressure) * t;
    dabs.push({ x: from.x + dx * t, y: from.y + dy * t, size: size * (pressureSize ? Math.max(0.05, p) : 1), pressure: p });
  }
  return { dabs, carry: length - travelled };
}

/** Normalises pointer pressure: mice report 0.5 while pressed, which should mean full pressure. @param {number} pressure @param {string} type */
export function effectivePressure(pressure, type) { return type === 'pen' ? Math.max(0.01, Math.min(1, pressure || 0)) : 1; }
