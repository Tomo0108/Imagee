import test from 'node:test';
import assert from 'node:assert/strict';
import { bleed, boxMean, canUpscale, guidedFilter, normalize, resizeMap, segmentInput, skyMask, tiles } from '../src/lib/matte.mjs';

test('segmentInput is planar and ImageNet-normalised', () => {
  const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
  const x = segmentInput(rgba, 2);
  assert.equal(x.length, 12);
  assert.ok(Math.abs(x[0] - (1 - 0.485) / 0.229) < 1e-5, 'R plane first');
  assert.ok(Math.abs(x[4 + 1] - (1 - 0.456) / 0.224) < 1e-5, 'G plane second');
});

test('normalize stretches to 0..1', () => {
  assert.deepEqual([...normalize(new Float32Array([2, 4, 6]))], [0, 0.5, 1]);
});

test('boxMean averages a window and clamps at edges', () => {
  const m = boxMean(new Float32Array([0, 0, 9, 0, 0, 0, 0, 0, 0]), 3, 3, 1);
  assert.ok(Math.abs(m[4] - 1) < 1e-6);
  assert.ok(Math.abs(m[2] - 9 / 4) < 1e-6);
});

test('guidedFilter snaps a blurry mask to the guide edge', () => {
  const w = 40, h = 10, guide = new Float32Array(w * h), p = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { guide[y * w + x] = x < 20 ? 0.1 : 0.9; p[y * w + x] = Math.min(1, Math.max(0, (x - 14) / 12)); }
  const q = guidedFilter(guide, p, w, h, 4, 1e-4);
  const jump = q[5 * w + 20] - q[5 * w + 19];
  assert.ok(jump > 0.3, `the transition concentrates on the edge: ${jump}`);
});

test('resizeMap keeps constants and corners', () => {
  const out = resizeMap(new Float32Array([0, 1, 0, 1]), 2, 2, 4, 4);
  assert.equal(out.length, 16);
  assert.equal(out[0], 0); assert.equal(out[3], 1);
});

test('skyMask finds a blue sky above green ground', () => {
  const w = 60, h = 40, rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (y < 20) { rgba[i] = 100 + y; rgba[i + 1] = 150 + y; rgba[i + 2] = 230; } else { rgba[i] = 60; rgba[i + 1] = 130; rgba[i + 2] = 40; }
    rgba[i + 3] = 255;
  }
  const m = skyMask(rgba, w, h);
  assert.ok(m[5 * w + 30] > 0.9 && m[30 * w + 30] < 0.1, `${m[5 * w + 30]} ${m[30 * w + 30]}`);
});

test('tiles cover the image exactly once in their inner parts', () => {
  const list = tiles(300, 200, 128, 8);
  let area = 0;
  for (const t of list) { area += t.inner.w * t.inner.h; assert.ok(t.x >= 0 && t.x + t.w <= 300 && t.y + t.h <= 200); }
  assert.equal(area, 300 * 200);
  assert.deepEqual(list[1].inner, { x: 8, y: 0, w: 128, h: 128 });
});

test('canUpscale limits the 4× intermediate', () => {
  assert.equal(canUpscale(1000, 1000), true);
  assert.equal(canUpscale(4000, 3000), false);
});

test('bleed fills transparent colour from visible pixels and keeps alpha and opaque pixels', () => {
  const w = 8, h = 4, rgba = new Uint8ClampedArray(w * h * 4);
  // Left half opaque red, right half fully transparent black.
  for (let y = 0; y < h; y++) for (let x = 0; x < 4; x++) rgba.set([200, 10, 10, 255], (y * w + x) * 4);
  const out = bleed(rgba, w, h);
  for (let i = 0; i < w * h; i++) {
    assert.equal(out[i * 4 + 3], rgba[i * 4 + 3], 'alpha unchanged');
    assert.ok(Math.abs(out[i * 4] - 200) <= 1 && out[i * 4 + 1] <= 11, `pixel ${i} takes the visible colour`);
  }
  assert.deepEqual([...bleed(new Uint8ClampedArray(16), 2, 2)], new Array(16).fill(0), 'all transparent stays as is');
});
