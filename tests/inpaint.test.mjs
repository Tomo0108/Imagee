import test from 'node:test';
import assert from 'node:assert/strict';
import { inpaint } from '../src/lib/inpaint.mjs';

function seeded(seed) { return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32; }
function stripes(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = Math.floor(x / 4) % 2 ? 220 : 40, i = (y * w + x) * 4;
    data[i] = v; data[i + 1] = 255 - v; data[i + 2] = 128; data[i + 3] = 255;
  }
  return data;
}

test('inpaint returns null without a hole', () => {
  assert.equal(inpaint(stripes(16, 16), 16, 16, new Float32Array(256)), null);
});

test('inpaint continues a regular texture through the hole and keeps the rest', () => {
  const w = 80, h = 80, original = stripes(w, h), data = original.slice();
  const weights = new Float32Array(w * h);
  for (let y = 30; y < 46; y++) for (let x = 30; x < 46; x++) { weights[y * w + x] = 1; const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0; }
  const out = inpaint(data, w, h, weights, { random: seeded(7) });
  let error = 0, n = 0;
  for (let y = 30; y < 46; y++) for (let x = 30; x < 46; x++) { const i = (y * w + x) * 4; error += Math.abs(out[i] - original[i]); n++; }
  // A flat grey fill would be off by ~90 on average; the stripes must come back.
  assert.ok(error / n < 25, `mean error ${error / n}`);
  assert.equal(out[(5 * w + 5) * 4], original[(5 * w + 5) * 4], 'pixels far from the hole are untouched');
});

test('inpaint fills a hole in a smooth gradient smoothly', () => {
  const w = 60, h = 60, data = new Uint8ClampedArray(w * h * 4), weights = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; data[i] = x * 4; data[i + 1] = y * 4; data[i + 2] = 100; data[i + 3] = 255; }
  for (let y = 20; y < 40; y++) for (let x = 20; x < 40; x++) weights[y * w + x] = 1;
  const out = inpaint(data, w, h, weights, { random: seeded(3) });
  let error = 0;
  for (let y = 20; y < 40; y++) for (let x = 20; x < 40; x++) { const i = (y * w + x) * 4; error += Math.abs(out[i] - data[i]) + Math.abs(out[i + 1] - data[i + 1]); }
  assert.ok(error / 800 < 20, `mean error ${error / 800}`);
});
