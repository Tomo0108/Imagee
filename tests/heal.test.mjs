import test from 'node:test';
import assert from 'node:assert/strict';
import { heal } from '../src/lib/heal.mjs';

function gradient(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; data[i] = x * 3; data[i + 1] = 100 + y; data[i + 2] = 80; data[i + 3] = 255; }
  return data;
}

test('a blemish on a smooth gradient is replaced by the gradient', () => {
  const w = 80, h = 80, data = gradient(w, h), clean = gradient(w, h), mask = new Float32Array(w * h);
  for (let y = 34; y < 46; y++) for (let x = 34; x < 46; x++) { const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0; mask[y * w + x] = 1; }
  const result = heal(data, w, h, mask);
  assert.ok(result && result.offset, 'finds a source');
  let worst = 0;
  for (let y = 34; y < 46; y++) for (let x = 34; x < 46; x++) for (let c = 0; c < 3; c++) { const i = (y * w + x) * 4 + c; worst = Math.max(worst, Math.abs(result.data[i] - clean[i])); }
  assert.ok(worst <= 6, `largest error ${worst}`);
  // Pixels outside the mask are untouched.
  assert.equal(result.data[0], data[0]);
});

test('without room for a source the area is filled smoothly from its border', () => {
  const w = 20, h = 20, data = gradient(w, h), mask = new Float32Array(w * h);
  for (let y = 2; y < 18; y++) for (let x = 2; x < 18; x++) mask[y * w + x] = 1;
  const result = heal(data, w, h, mask);
  assert.equal(result.offset, null);
  const i = (10 * w + 10) * 4;
  assert.ok(Math.abs(result.data[i] - 30) < 8, `red ${result.data[i]}`);
});

test('nothing to heal returns null', () => {
  assert.equal(heal(gradient(4, 4), 4, 4, new Float32Array(16)), null);
});
