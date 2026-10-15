import test from 'node:test';
import assert from 'node:assert/strict';
import { arrangeImages } from '../src/lib/layout.mjs';

test('mixed image sizes fit the canvas without overlap or cropping', () => {
  const images = [{ w: 900, h: 1200 }, { w: 1600, h: 900 }, { w: 500, h: 500 }, { w: 1200, h: 800 }, { w: 500, h: 800 }];
  for (const [width, height] of [[1920, 1080], [1080, 1920], [512, 512]]) {
    const positions = arrangeImages(images, width, height);
    positions.forEach((box, i) => {
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.w <= width && box.y + box.h <= height);
      assert.ok(Math.abs(box.w / box.h - images[i].w / images[i].h) < .02);
      positions.slice(i + 1).forEach(other => assert.ok(box.x + box.w <= other.x || other.x + other.w <= box.x || box.y + box.h <= other.y || other.y + other.h <= box.y));
    });
  }
});
test('empty layout', () => {
  assert.deepEqual(arrangeImages([], 100, 100), []);
});
test('images fill most of the canvas and keep their order', () => {
  const landscape = Array.from({ length: 4 }, () => ({ w: 1600, h: 900 }));
  const boxes = arrangeImages(landscape, 1920, 1080);
  const area = boxes.reduce((total, box) => total + box.w * box.h, 0);
  assert.ok(area / (1920 * 1080) > .7, `covers ${area / (1920 * 1080)}`);
  // Reading order: each image starts to the right of, or below, the one before it.
  boxes.slice(1).forEach((box, i) => assert.ok(box.y > boxes[i].y + 1 || (Math.abs(box.y - boxes[i].y) <= 1 && box.x > boxes[i].x)));
  const mixed = arrangeImages([{ w: 900, h: 1200 }, { w: 1600, h: 900 }, { w: 1200, h: 1200 }], 1920, 1080);
  const covered = mixed.reduce((total, box) => total + box.w * box.h, 0) / (1920 * 1080);
  assert.ok(covered > .6, `mixed covers ${covered}`);
});
