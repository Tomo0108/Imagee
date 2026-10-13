import test from 'node:test';
import assert from 'node:assert/strict';
import { findPreset, matchPreset, oriented, SIZE_PRESETS } from '../src/lib/sizes.mjs';

test('the usual sizes are there with the right pixels', () => {
  assert.deepEqual([findPreset('4k').width, findPreset('4k').height], [3840, 2160]);
  assert.deepEqual([findPreset('hd').width, findPreset('hd').height], [1280, 720]);
  assert.deepEqual([findPreset('a4').width, findPreset('a4').height], [2480, 3508]);
  const ids = SIZE_PRESETS.flatMap(group => group.items.map(item => item.id));
  assert.equal(ids.length, 52, '18 presets added to the 34 existing sizes');
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
});

test('presets match in either orientation and can be turned', () => {
  assert.equal(matchPreset(2160, 3840).id, '4k');
  assert.equal(matchPreset(1000, 1001), undefined);
  assert.deepEqual(oriented(findPreset('a4'), 'landscape'), { width: 3508, height: 2480 });
  assert.deepEqual(oriented(findPreset('4k'), 'portrait'), { width: 2160, height: 3840 });
});
