import test from 'node:test';
import assert from 'node:assert/strict';
import { adjustPixel, autoAdjust, isNeutral, NEUTRAL, normalizeAdjustments } from '../src/lib/adjust.mjs';

const close = (a, b, eps = 1e-6) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < eps, `${a} ≈ ${b}`));
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

test('neutral settings leave pixels unchanged', () => {
  for (const px of [[0, 0, 0], [1, 1, 1], [0.2, 0.5, 0.8], [0.9, 0.1, 0.3]]) close(adjustPixel(px, NEUTRAL), px);
  assert.ok(isNeutral(NEUTRAL));
  assert.ok(isNeutral({ ...NEUTRAL, vignette: 50 }));
  assert.ok(!isNeutral({ ...NEUTRAL, exposure: 0.5 }));
});

test('exposure brightens and darkens', () => {
  const px = [0.4, 0.4, 0.4];
  assert.ok(lum(adjustPixel(px, { ...NEUTRAL, exposure: 1 })) > 0.5);
  assert.ok(lum(adjustPixel(px, { ...NEUTRAL, exposure: -1 })) < 0.3);
});

test('temperature warms and cools', () => {
  const [r, , b] = adjustPixel([0.5, 0.5, 0.5], { ...NEUTRAL, temperature: 50 });
  assert.ok(r > b);
  const [r2, , b2] = adjustPixel([0.5, 0.5, 0.5], { ...NEUTRAL, temperature: -50 });
  assert.ok(b2 > r2);
});

test('saturation -100 makes grey, contrast spreads tones', () => {
  const [r, g, b] = adjustPixel([0.8, 0.3, 0.2], { ...NEUTRAL, saturation: -100 });
  assert.ok(Math.abs(r - g) < 1e-9 && Math.abs(g - b) < 1e-9);
  const dark = adjustPixel([0.3, 0.3, 0.3], { ...NEUTRAL, contrast: 100 })[0], light = adjustPixel([0.7, 0.7, 0.7], { ...NEUTRAL, contrast: 100 })[0];
  assert.ok(dark < 0.3 && light > 0.7);
});

test('shadows lift dark tones more than bright ones', () => {
  const dark = adjustPixel([0.1, 0.1, 0.1], { ...NEUTRAL, shadows: 100 })[0] - 0.1;
  const bright = adjustPixel([0.9, 0.9, 0.9], { ...NEUTRAL, shadows: 100 })[0] - 0.9;
  assert.ok(dark > 0.1 && bright < 0.01);
});

test('autoAdjust brightens a dark image and stretches a flat one', () => {
  const dark = new Array(256).fill(0); for (let i = 10; i < 70; i++) dark[i] = 100;
  const a = autoAdjust(dark);
  assert.ok(a.exposure > 0 && a.whites > 0);
  const flat = new Array(256).fill(0); for (let i = 100; i < 160; i++) flat[i] = 100;
  const f = autoAdjust(flat);
  assert.ok(f.blacks < 0 && f.whites > 0);
  assert.deepEqual(autoAdjust(new Array(256).fill(0)), {});
});

test('normalizeAdjustments clamps and fills missing values', () => {
  assert.deepEqual(normalizeAdjustments({ exposure: 9, contrast: 'x', tint: 20 }), { ...NEUTRAL, exposure: 4, tint: 20 });
});
