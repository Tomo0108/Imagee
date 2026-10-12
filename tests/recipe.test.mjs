import test from 'node:test';
import assert from 'node:assert/strict';
import { centerCrop, normalizeRecipe, outputNames, resizedSize, watermarkOrigin } from '../src/lib/recipe.mjs';

test('resize modes', () => {
  assert.deepEqual(resizedSize(4000, 3000, { mode: 'long', value: 2000 }), { width: 2000, height: 1500 });
  assert.deepEqual(resizedSize(1000, 3000, { mode: 'long', value: 2000 }), { width: 667, height: 2000 });
  assert.deepEqual(resizedSize(800, 600, { mode: 'width', value: 2000 }), { width: 800, height: 600 }, 'never upscales');
  assert.deepEqual(resizedSize(800, 600, { mode: 'percent', value: 50 }), { width: 400, height: 300 });
  assert.deepEqual(resizedSize(800, 600, { mode: 'none', value: 1 }), { width: 800, height: 600 });
});

test('centre crop keeps the ratio inside the image', () => {
  assert.deepEqual(centerCrop(4000, 3000, 1), { x: 500, y: 0, w: 3000, h: 3000 });
  assert.deepEqual(centerCrop(3000, 4000, 16 / 9), { x: 0, y: 1156, w: 3000, h: 1688 });
  assert.deepEqual(centerCrop(10, 10, 0), { x: 0, y: 0, w: 10, h: 10 });
});

test('watermark corners', () => {
  assert.deepEqual(watermarkOrigin('br', 100, 50, 20, 10, 5), { x: 75, y: 35 });
  assert.deepEqual(watermarkOrigin('tl', 100, 50, 20, 10, 5), { x: 5, y: 5 });
  assert.deepEqual(watermarkOrigin('center', 100, 50, 20, 10, 5), { x: 40, y: 20 });
});

test('output names are unique', () => {
  assert.deepEqual(outputNames(['a.png', 'a.jpg', 'b.png'], '_web', 'jpg'), ['a_web.jpg', 'a_web (2).jpg', 'b_web.jpg']);
});

test('normalizeRecipe fills defaults and strips unsafe characters', () => {
  const r = normalizeRecipe({ suffix: 'a/b:c', resize: { mode: 'bogus' }, quality: 500, tone: { basic: { exposure: 9 } } });
  assert.equal(r.suffix, 'abc'); assert.equal(r.resize.mode, 'none'); assert.equal(r.quality, 100);
  assert.equal(r.tone.basic.exposure, 4); assert.equal(r.format, 'jpeg');
});
