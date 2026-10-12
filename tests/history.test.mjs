import test from 'node:test';
import assert from 'node:assert/strict';
import { commit, createHistory, entries, jump, redo, undo } from '../src/lib/history.mjs';

test('undo and redo walk the history', () => {
  let h = createHistory({ v: 0 });
  h = commit(h, { v: 1 }, 'A');
  h = commit(h, { v: 2 }, 'B');
  h = undo(h); assert.equal(h.present.v, 1);
  h = undo(h); assert.equal(h.present.v, 0);
  assert.equal(undo(h), h);
  h = redo(h); assert.equal(h.present.v, 1); assert.equal(h.label, 'A');
  h = commit(h, { v: 9 }, 'C');
  assert.equal(h.future.length, 0);
  assert.deepEqual(entries(h).map(e => e.label), ['開く', 'A', 'C']);
});

test('merged commits collapse into one step', () => {
  let h = createHistory({ v: 0 });
  h = commit(h, { v: 1 }, '不透明度', true);
  h = commit(h, { v: 2 }, '不透明度', true);
  h = commit(h, { v: 3 }, '不透明度', true);
  assert.equal(h.past.length, 1);
  assert.equal(undo(h).present.v, 0);
});

test('jump moves to any entry', () => {
  let h = createHistory({ v: 0 });
  for (let i = 1; i <= 4; i++) h = commit(h, { v: i }, `S${i}`);
  h = jump(h, 1); assert.equal(h.present.v, 1);
  h = jump(h, 3); assert.equal(h.present.v, 3);
  assert.deepEqual(entries(h).filter(e => e.future).map(e => e.label), ['S4']);
});
