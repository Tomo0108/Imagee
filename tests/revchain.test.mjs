import test from 'node:test';
import assert from 'node:assert/strict';
import { RevChain } from '../src/lib/revchain.mjs';

test('path walks forward and backward', () => {
  const c = new RevChain(0);
  c.push(0, 1, 'a'); c.push(1, 2, 'b'); c.push(2, 3, 'c');
  assert.deepEqual(c.path(0, 3).map(s => s.patch), ['a', 'b', 'c']);
  assert.deepEqual(c.path(3, 1), [{ patch: 'c', forward: false }, { patch: 'b', forward: false }]);
  assert.deepEqual(c.path(2, 2), []);
});

test('pushing from an older revision drops the undone future', () => {
  const c = new RevChain(0);
  c.push(0, 1, 'a'); c.push(1, 2, 'b');
  assert.deepEqual(c.push(1, 5, 'x'), ['b']);
  assert.deepEqual(c.revs, [0, 1, 5]);
  assert.ok(!c.has(2));
  assert.throws(() => c.path(2, 0));
  assert.equal(c.head, 5);
});

test('prune drops only the steps before the oldest kept revision', () => {
  const c = new RevChain(0);
  c.push(0, 1, 'a'); c.push(1, 2, 'b'); c.push(2, 3, 'c');
  assert.equal(c.prune(new Set([2, 3])), 2);
  assert.deepEqual(c.revs, [2, 3]);
  assert.deepEqual(c.path(3, 2), [{ patch: 'c', forward: false }]);
  assert.equal(c.has(1), false);
  assert.equal(c.prune(new Set([2])), 0, 'nothing older to drop');
});
