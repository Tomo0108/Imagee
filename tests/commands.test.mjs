import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, labelSpan, romajiToKana, searchCommands } from '../src/lib/commands.mjs';

const COMMANDS = [
  { id: 'canvas', label: 'キャンバスサイズを変更', reading: 'キャンバスサイズヲヘンコウ', keywords: ['canvas size'] },
  { id: 'image', label: '画像サイズを変更', reading: 'ガゾウサイズヲヘンコウ', keywords: ['resize', 'リサイズ'] },
  { id: 'invert', label: '選択範囲を反転', reading: 'センタクハンイヲハンテン', keywords: ['invert'] },
  { id: 'brush', label: 'ブラシ', keywords: ['brush', 'ペン'] },
];
const ids = query => searchCommands(COMMANDS, query).map(result => result.command.id);

test('fold unifies hiragana, width and case', () => {
  assert.equal(fold('きゃんばす ＡＢ'), 'キャンバスab');
});

test('romaji converts as typed, dropping an unfinished syllable', () => {
  assert.equal(romajiToKana('kyanbasu'), 'キャンバス');
  assert.equal(romajiToKana('kakko'), 'カッコ');
  assert.equal(romajiToKana('ky'), '');
  assert.equal(romajiToKana('sentak'), 'セnタ'.replace('n', 'ン'));
  assert.equal(romajiToKana('キャ'), '');
});

test('the first few characters find the feature, in katakana, hiragana or romaji', () => {
  for (const query of ['キャ', 'きゃ', 'kya', 'きゃんば']) assert.equal(ids(query)[0], 'canvas', query);
});

test('readings and keywords match too', () => {
  assert.deepEqual(ids('はんてん'), ['invert']);
  assert.equal(ids('resize')[0], 'image');
  assert.equal(ids('ぺん')[0], 'brush');
  assert.ok(ids('さいず').includes('canvas') && ids('さいず').includes('image'));
});

test('letters in order with gaps still match, below direct matches', () => {
  assert.deepEqual(ids('きゃさ'), ['canvas']);
  assert.deepEqual(ids('zzz'), []);
});

test('recent commands come first for an empty query and get a lift otherwise', () => {
  assert.deepEqual(searchCommands(COMMANDS, '', ['brush', 'image']).map(r => r.command.id), ['brush', 'image']);
  assert.equal(searchCommands(COMMANDS, 'さいず', ['canvas'])[0].command.id, 'canvas');
});

test('the matched part of the label is reported for highlighting', () => {
  assert.deepEqual(searchCommands(COMMANDS, 'さいず')[0].span, [2, 5]);
  assert.deepEqual(labelSpan('a b', 1, 2), [2, 3]);
});
