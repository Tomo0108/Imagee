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
