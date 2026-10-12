import test from 'node:test';
import assert from 'node:assert/strict';
import { applyHsl, applyLevels, bakeLut, bandWeights, colorFunction, curveTable, hslToRgb, isNeutralColor, lookup, normalizeColor, NEUTRAL_COLOR, parseCube, rgbToHsl, sampleBaked, sampleCube } from '../src/lib/color.mjs';

const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('identity curve is a straight line and passes through its points', () => {
  const id = curveTable([[0, 0], [1, 1]]);
  for (const x of [0, 0.25, 0.5, 1]) close(lookup(id, x), x);
  const s = curveTable([[0, 0], [0.25, 0.15], [0.75, 0.85], [1, 1]]);
  close(lookup(s, 0.25), 0.15); close(lookup(s, 0.75), 0.85);
  // Monotone: never goes backwards between increasing points.
  for (let i = 1; i < s.length; i++) assert.ok(s[i] >= s[i - 1] - 1e-6);
});

test('levels map the input range and gamma', () => {
  const l = { inBlack: 50, inWhite: 200, gamma: 1, outBlack: 0, outWhite: 255 };
  close(applyLevels(50 / 255, l), 0); close(applyLevels(200 / 255, l), 1); close(applyLevels(125 / 255, l), 0.5, 0.01);
  assert.ok(applyLevels(0.5, { ...l, inBlack: 0, inWhite: 255, gamma: 2 }) > 0.5);
});

test('hsl conversion round-trips', () => {
  for (const rgb of [[1, 0, 0], [0.2, 0.6, 0.3], [0.9, 0.9, 0.1], [0.5, 0.5, 0.5]]) {
    const back = hslToRgb(...rgbToHsl(...rgb));
    rgb.forEach((v, i) => close(back[i], v));
  }
});

test('band weights sum to one and pick the nearest bands', () => {
  for (const h of [0, 15, 59, 200, 330, 359]) close(bandWeights(h).reduce((a, b) => a + b, 0), 1);
  assert.equal(bandWeights(120)[3], 1);
});

test('hsl shifts only the targeted colours', () => {
  const hsl = structuredClone(NEUTRAL_COLOR.hsl);
  hsl.blue.s = -100;
  const blue = applyHsl([0.1, 0.1, 0.9], hsl);
  assert.ok(Math.max(...blue) - Math.min(...blue) < 0.05, 'blue is desaturated');
  assert.deepEqual(applyHsl([0.9, 0.1, 0.1], hsl), [0.9, 0.1, 0.1]);
  assert.deepEqual(applyHsl([0.4, 0.4, 0.4], hsl), [0.4, 0.4, 0.4]);
});

test('parses a .cube file and samples it', () => {
  const lines = ['TITLE "invert"', 'LUT_3D_SIZE 2'];
  for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) lines.push(`${1 - r} ${1 - g} ${1 - b}`);
  const cube = parseCube(lines.join('\n'));
  assert.equal(cube.size, 2); assert.equal(cube.title, 'invert');
  sampleCube(cube, [0.25, 0.5, 1]).forEach((v, i) => close(v, [0.75, 0.5, 0][i]));
  assert.throws(() => parseCube('LUT_3D_SIZE 2\n0 0 0'));
});

test('neutral operations bake to an identity table', () => {
  const ops = normalizeColor(null);
  assert.ok(isNeutralColor(ops));
  const table = bakeLut(colorFunction(ops, null), 17);
  const out = new Uint8ClampedArray(4);
  sampleBaked(table, 17, 200, 30, 90, out, 0);
  assert.deepEqual([...out.slice(0, 3)], [200, 30, 90]);
});

test('normalizeColor fills gaps and clamps', () => {
  const ops = normalizeColor({ levels: { gamma: 50 }, curves: { rgb: [[0, 0], [0.5, 2], [1, 1]] }, lut: { id: 'x' } });
  assert.equal(ops.levels.gamma, 9.99);
  assert.deepEqual(ops.curves.rgb[1], [0.5, 1]);
  assert.deepEqual(ops.lut, { id: 'x', amount: 100 });
  assert.equal(ops.hsl.red.h, 0);
});

test('cube text round-trips', async () => {
  const { cubeText } = await import('../src/lib/color.mjs');
  const cube = { size: 2, title: 'A "b"', data: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 0.5]) };
  const back = parseCube(cubeText(cube));
  assert.equal(back.size, 2); assert.equal(back.title, "A 'b'");
  assert.deepEqual([...back.data], [...cube.data]);
});
