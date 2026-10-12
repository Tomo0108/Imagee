import test from 'node:test';
import assert from 'node:assert/strict';
import { baseName, exportName, fileKind, formatBytes, isImageFile, scaledSize, visibleProjects } from '../src/lib/files.mjs';
import { normalizePreferences, defaults } from '../src/lib/preferences.mjs';

test('isImageFile accepts raster images and rejects others', () => {
  assert.ok(isImageFile({ type: 'image/png', name: 'a.png' }));
  assert.ok(isImageFile({ type: '', name: 'photo.JPG' }));
  assert.ok(!isImageFile({ type: 'image/svg+xml', name: 'a.svg' }));
  assert.ok(!isImageFile({ type: 'text/plain', name: 'a.txt' }));
});

test('export names replace the extension', () => {
  assert.equal(baseName('holiday.photo.jpeg'), 'holiday.photo');
  assert.equal(baseName('.hidden'), '.hidden');
  assert.equal(exportName('cat.png', 'webp'), 'cat.webp');
});

test('formatBytes and scaledSize', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(20 * 1024 * 1024), '20 MB');
  assert.deepEqual(scaledSize(1000, 501, 50), { width: 500, height: 251 });
  assert.deepEqual(scaledSize(1, 1, 1), { width: 1, height: 1 });
});

test('visibleProjects filters, searches and sorts', () => {
  const items = [
    { id: 'a', name: 'image10', size: 5, added: 1, opened: 0, favorite: false },
    { id: 'b', name: 'image2', size: 9, added: 2, opened: 10, favorite: true },
    { id: 'c', name: 'sky', size: 1, added: 3, opened: 0, favorite: false },
  ];
  assert.deepEqual(visibleProjects(items, 'recent', '', 'all').map(i => i.id), ['b', 'c', 'a']);
  assert.deepEqual(visibleProjects(items, 'name', 'image', 'all').map(i => i.id), ['b', 'a']);
  assert.deepEqual(visibleProjects(items, 'size', '', 'favorites').map(i => i.id), ['b']);
  assert.deepEqual(visibleProjects(items, 'recent', '', 'recent').map(i => i.id), ['b']);
});

test('normalizePreferences rejects invalid values', () => {
  assert.deepEqual(normalizePreferences(null), defaults);
  assert.deepEqual(normalizePreferences({ theme: 'blue', layout: 'list', motion: false }), { ...defaults, layout: 'list', motion: false });
});

test('fileKind routes projects, Photoshop documents and images', () => {
  assert.equal(fileKind({ name: 'a.imagee', type: '' }), 'imagee');
  assert.equal(fileKind({ name: 'a.psd', type: 'image/vnd.adobe.photoshop' }), 'psd');
  assert.equal(fileKind({ name: 'a.png', type: 'image/png' }), 'image');
  assert.equal(fileKind({ name: 'a.txt', type: 'text/plain' }), null);
  assert.ok(!isImageFile({ name: 'a.psd', type: 'image/vnd.adobe.photoshop' }));
});
