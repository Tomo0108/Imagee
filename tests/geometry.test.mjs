import test from 'node:test';
import assert from 'node:assert/strict';
import { autoCrop, clampRect, fitAspect, flip, IDENTITY, inscribedScale, outputSize, resizeCrop, rotateQuarter } from '../src/lib/geometry.mjs';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('inscribed rect fits inside the rotated frame', () => {
  near(inscribedScale(400, 300, 0), 1);
  for (const angle of [5, 17, 45, -30]) {
    const k = inscribedScale(400, 300, angle), t = Math.abs(angle) * Math.PI / 180;
    const w = 400 * k / 2, h = 300 * k / 2;
    // The inner rect's corner, expressed in the rotated image's own axes, stays inside the image.
    assert.ok(w * Math.cos(t) + h * Math.sin(t) <= 200 + 1e-9);
    assert.ok(w * Math.sin(t) + h * Math.cos(t) <= 150 + 1e-9);
  }
  const crop = autoCrop(400, 300, 10);
  near(crop.x * 2 + crop.w, 400); near(crop.w / crop.h, 4 / 3);
});

test('outputSize follows quarter turns and crops', () => {
  assert.deepEqual(outputSize(IDENTITY, 400, 300), { width: 400, height: 300 });
  assert.deepEqual(outputSize({ ...IDENTITY, quarter: 1 }, 400, 300), { width: 300, height: 400 });
  assert.deepEqual(outputSize({ ...IDENTITY, crop: { x: 10, y: 10, w: 100.4, h: 50 } }, 400, 300), { width: 100, height: 50 });
});

test('fitAspect keeps the ratio and stays inside the frame', () => {
  const frame = { width: 400, height: 300 };
  const r = fitAspect({ x: 0, y: 0, w: 400, h: 300 }, 1, frame);
  near(r.w, r.h); assert.ok(r.w <= 300 + 1e-9); near(r.x, 50);
  const tall = fitAspect({ x: 0, y: 0, w: 400, h: 300 }, 9 / 16, frame);
  near(tall.w / tall.h, 9 / 16); assert.ok(tall.y >= 0 && tall.y + tall.h <= 300 + 1e-9);
});

test('resizeCrop moves edges, respects ratio and bounds', () => {
  const frame = { width: 400, height: 300 }, start = { x: 100, y: 100, w: 100, h: 100 };
  assert.deepEqual(resizeCrop(start, 'e', 50, 0, 0, frame), { x: 100, y: 100, w: 150, h: 100 });
  assert.deepEqual(resizeCrop(start, 'nw', -500, -500, 0, frame), { x: 0, y: 0, w: 200, h: 200 });
  const square = resizeCrop(start, 'se', 80, 20, 1, frame);
  near(square.w, square.h); near(square.x, 100); near(square.y, 100);
  const wide = resizeCrop(start, 'e', 1000, 0, 2, frame);
  near(wide.w / wide.h, 2); assert.ok(wide.x + wide.w <= 400 + 1e-9);
  assert.equal(resizeCrop(start, 'w', 500, 0, 0, frame).w, 8);
});

test('quarter turns and flips carry the crop', () => {
  const g = { ...IDENTITY, crop: { x: 10, y: 20, w: 100, h: 50 } };
  const r = rotateQuarter(g, 1, 400, 300);
  assert.equal(r.quarter, 1);
  assert.deepEqual(r.crop, { x: 230, y: 10, w: 50, h: 100 });
  assert.deepEqual(rotateQuarter(r, -1, 400, 300).crop, g.crop);
  const f = flip(g, 'h', 400, 300);
  assert.deepEqual(f.crop, { x: 290, y: 20, w: 100, h: 50 });
  assert.deepEqual(flip(f, 'h', 400, 300), { ...g, angle: 0 });
  assert.deepEqual(clampRect({ x: -5, y: 290, w: 50, h: 50 }, { width: 400, height: 300 }), { x: 0, y: 250, w: 50, h: 50 });
});

import { apply, invert, multiply, sourceMatrix } from '../src/lib/geometry.mjs';
test('sourceMatrix maps source corners to the output and back', () => {
  const g = { ...IDENTITY, quarter: 1 };
  const m = sourceMatrix(g, 400, 300, 'output');
  // A clockwise quarter turn sends the source top-left to the output top-right.
  const p = apply(m, 0, 0); near(p.x, 300); near(p.y, 0);
  const q = apply(invert(m), 300, 0); near(q.x, 0); near(q.y, 0);
  const flipped = sourceMatrix({ ...IDENTITY, flipH: true, crop: { x: 100, y: 0, w: 200, h: 300 } }, 400, 300, 'output');
  const r = apply(flipped, 0, 0); near(r.x, 300); near(r.y, 0);
  const id = multiply(m, invert(m)); [1, 0, 0, 1, 0, 0].forEach((v, i) => near(id[i], v));
});
