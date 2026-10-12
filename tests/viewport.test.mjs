import test from 'node:test';
import assert from 'node:assert/strict';
import { centered, clampScale, fitScale, formatZoom, stepZoom, toImage, zoomAt, MAX_SCALE, MIN_SCALE } from '../src/lib/viewport.mjs';

test('fitScale shrinks large images and never enlarges small ones', () => {
  assert.equal(fitScale(4000, 2000, 1048, 596, 24), 0.25);
  assert.equal(fitScale(100, 100, 1000, 1000), 1);
  assert.equal(fitScale(0, 100, 1000, 1000), 1);
});

test('centered places the image in the middle', () => {
  assert.deepEqual(centered(200, 100, 1000, 500, 1), { scale: 1, x: 400, y: 200 });
});

test('stepZoom walks preset levels and stops at the limits', () => {
  assert.equal(stepZoom(1, 1), 1.5);
  assert.equal(stepZoom(1, -1), 0.667);
  assert.equal(stepZoom(0.7, -1), 0.667);
  assert.equal(stepZoom(MAX_SCALE, 1), MAX_SCALE);
  assert.equal(stepZoom(MIN_SCALE, -1), MIN_SCALE);
});

test('zoomAt keeps the point under the cursor fixed', () => {
  const view = { scale: 1, x: 100, y: 50 };
  const before = toImage(view, 300, 250);
  const next = zoomAt(view, 4, 300, 250);
  const after = toImage(next, 300, 250);
  assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9);
  assert.equal(zoomAt(view, 1000, 0, 0).scale, MAX_SCALE);
});

test('clampScale and formatZoom', () => {
  assert.equal(clampScale(0), MIN_SCALE);
  assert.equal(formatZoom(1), '100%');
  assert.equal(formatZoom(0.0625), '6.3%');
});
