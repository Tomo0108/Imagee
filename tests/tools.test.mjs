import test from 'node:test';
import assert from 'node:assert/strict';
import { floodMask, maskBounds } from '../src/lib/flood.mjs';
import { dabsAlong, effectivePressure } from '../src/lib/brush.mjs';

function image(w, h, fill) { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) d.set(fill(i % w, Math.floor(i / w)), i * 4); return d; }

test('floodMask fills the contiguous region only', () => {
  // Two red squares separated by a blue column.
  const d = image(5, 3, x => x === 2 ? [0, 0, 255, 255] : [255, 0, 0, 255]);
  const m = floodMask(d, 5, 3, 0, 0, 10, true);
  assert.equal([...m].filter(Boolean).length, 6);
  assert.equal(m[3], 0);
  const all = floodMask(d, 5, 3, 0, 0, 10, false);
  assert.equal([...all].filter(Boolean).length, 12);
  assert.deepEqual(maskBounds(m, 5, 3), { x: 0, y: 0, w: 2, h: 3 });
  assert.equal(maskBounds(new Uint8Array(4), 2, 2), null);
});

test('floodMask tolerance and transparency', () => {
  const d = image(4, 1, x => [100 + x * 10, 0, 0, 255]);
  assert.equal([...floodMask(d, 4, 1, 0, 0, 15)].filter(Boolean).length, 2);
  const t = image(3, 1, x => x === 1 ? [9, 9, 9, 0] : [0, 0, 0, 0]);
  assert.equal([...floodMask(t, 3, 1, 0, 0, 0)].filter(Boolean).length, 3);
  assert.equal([...floodMask(t, 3, 1, 9, 9, 0)].filter(Boolean).length, 0);
});

test('dabsAlong spaces dabs evenly and carries the remainder', () => {
  const a = { x: 0, y: 0, pressure: 1 }, b = { x: 10, y: 0, pressure: 1 };
  const first = dabsAlong(a, b, 10, 0.25, 0);
  assert.deepEqual(first.dabs.map(d => d.x), [2.5, 5, 7.5, 10]);
  assert.equal(first.carry, 0);
  const next = dabsAlong(b, { x: 11, y: 0, pressure: 1 }, 10, 0.25, first.carry);
  assert.equal(next.dabs.length, 0);
  assert.equal(next.carry, 1);
  const soft = dabsAlong({ x: 0, y: 0, pressure: 0.2 }, { x: 0, y: 4, pressure: 0.2 }, 10, 0.25, 0);
  assert.equal(soft.dabs[0].size, 2);
  assert.equal(effectivePressure(0.5, 'mouse'), 1);
  assert.equal(effectivePressure(0.3, 'pen'), 0.3);
});
