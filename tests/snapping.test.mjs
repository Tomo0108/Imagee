import test from 'node:test';
import assert from 'node:assert/strict';
import { alphaBounds, gaps, snapBox } from '../src/lib/snapping.mjs';

const frame = { x: 0, y: 0, w: 1000, h: 800 };

test('a box near the canvas centre snaps to it and shows centre guides', () => {
  const r = snapBox({ x: 396, y: 303, w: 200, h: 200 }, [], frame, 6);
  assert.deepEqual([r.dx, r.dy], [4, -3]);
  const centre = r.guides.filter(g => g.kind === 'center').map(g => [g.axis, g.at]);
  assert.deepEqual(centre.sort(), [['x', 500], ['y', 400]]);
});

test('edges snap to other objects, but only within the threshold', () => {
  const other = { x: 100, y: 100, w: 100, h: 100 };
  const r = snapBox({ x: 203, y: 600, w: 50, h: 50 }, [other], frame, 6);
  assert.equal(r.dx, -3, 'left edge meets the other box\'s right edge');
  assert.ok(r.guides.some(g => g.axis === 'x' && g.at === 200));
  assert.deepEqual(snapBox({ x: 230, y: 600, w: 50, h: 50 }, [other], frame, 6).dx, 0);
});

test('gaps measure the distance to the nearest neighbour or the canvas edge', () => {
  const list = gaps({ x: 300, y: 100, w: 100, h: 100 }, [{ x: 100, y: 120, w: 50, h: 50 }], frame);
  const left = list.find(g => g.axis === 'x' && g.to === 300);
  assert.equal(left.length, 150);
  assert.equal(list.find(g => g.axis === 'y' && g.from === 0).length, 100);
});

test('alphaBounds finds the visible pixels', () => {
  const data = new Uint8ClampedArray(5 * 4 * 4);
  data[(1 * 5 + 2) * 4 + 3] = 255; data[(3 * 5 + 3) * 4 + 3] = 10;
  assert.deepEqual(alphaBounds(data, 5, 4), { x: 2, y: 1, w: 2, h: 3 });
  assert.equal(alphaBounds(new Uint8ClampedArray(16), 2, 2), null);
});
