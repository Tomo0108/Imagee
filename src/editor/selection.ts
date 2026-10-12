import { canvas } from '../imaging';
import { maskBounds } from '../lib/flood.mjs';
import type { Box } from './pixels';

export type SelectMode = 'new' | 'add' | 'subtract' | 'intersect';
export type SelectShape = { kind: 'rect' | 'ellipse'; box: Box } | { kind: 'lasso'; points: { x: number; y: number }[] };

/** A selection is an alpha mask in document pixels plus a precomputed outline for display. */
export interface Selection { mask: HTMLCanvasElement; bounds: Box; edges: HTMLCanvasElement }

export function shapeMask(width: number, height: number, shape: SelectShape): HTMLCanvasElement {
  const target = canvas(width, height);
  const c = target.getContext('2d')!;
  c.fillStyle = '#fff';
  c.beginPath();
  if (shape.kind === 'rect') c.rect(shape.box.x, shape.box.y, shape.box.w, shape.box.h);
  else if (shape.kind === 'ellipse') c.ellipse(shape.box.x + shape.box.w / 2, shape.box.y + shape.box.h / 2, Math.abs(shape.box.w / 2), Math.abs(shape.box.h / 2), 0, 0, Math.PI * 2);
  else if (shape.kind === 'lasso') shape.points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y));
  c.fill();
  return target;
}

/** Mask from a 0/255 array computed at a smaller working size (magic wand on the preview composite). */
export function arrayMask(values: Uint8Array, w: number, h: number, width: number, height: number): HTMLCanvasElement {
  const small = canvas(w, h);
  const data = new ImageData(w, h);
  for (let i = 0; i < values.length; i++) if (values[i]) { data.data[i * 4] = data.data[i * 4 + 1] = data.data[i * 4 + 2] = 255; data.data[i * 4 + 3] = values[i]; }
  small.getContext('2d')!.putImageData(data, 0, 0);
  if (w === width && h === height) return small;
  const target = canvas(width, height);
  const c = target.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  c.drawImage(small, 0, 0, width, height);
  return target;
}

export function combine(previous: Selection | null, next: HTMLCanvasElement, mode: SelectMode): Selection | null {
  if (mode === 'new' || !previous) return mode === 'subtract' || mode === 'intersect' ? previous && finish(previous.mask) : finish(next);
  const target = canvas(next.width, next.height);
  const c = target.getContext('2d')!;
  c.drawImage(previous.mask, 0, 0);
  c.globalCompositeOperation = mode === 'add' ? 'source-over' : mode === 'subtract' ? 'destination-out' : 'destination-in';
  c.drawImage(next, 0, 0);
  return finish(target);
}

export function invertSelection(selection: Selection | null, width: number, height: number): Selection | null {
  const target = canvas(width, height);
  const c = target.getContext('2d')!;
  c.fillStyle = '#fff'; c.fillRect(0, 0, width, height);
  if (selection) { c.globalCompositeOperation = 'destination-out'; c.drawImage(selection.mask, 0, 0); }
  return finish(target);
}

export function selectAll(width: number, height: number) { return finish(shapeMask(width, height, { kind: 'rect', box: { x: 0, y: 0, w: width, h: height } })); }

/** Measures the mask and draws its outline as a dotted black-and-white line at up to 2048 px. */
export function finish(mask: HTMLCanvasElement): Selection | null {
  const k = Math.min(1, 2048 / Math.max(mask.width, mask.height));
  const w = Math.max(1, Math.round(mask.width * k)), h = Math.max(1, Math.round(mask.height * k));
  const small = canvas(w, h);
  const sc = small.getContext('2d', { willReadFrequently: true })!;
  sc.drawImage(mask, 0, 0, w, h);
  const alpha = sc.getImageData(0, 0, w, h).data;
  const box = maskBounds(alpha, w, h, 4);
  if (!box) return null;
  const edges = canvas(w, h);
  const out = new ImageData(w, h);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && alpha[(y * w + x) * 4 + 3] > 127;
  for (let y = Math.max(0, box.y - 1); y < Math.min(h, box.y + box.h + 1); y++) for (let x = Math.max(0, box.x - 1); x < Math.min(w, box.x + box.w + 1); x++) {
    if (!inside(x, y) || (inside(x - 1, y) && inside(x + 1, y) && inside(x, y - 1) && inside(x, y + 1))) continue;
    const i = (y * w + x) * 4, v = ((x + y) >> 2) & 1 ? 255 : 0;
    out.data[i] = out.data[i + 1] = out.data[i + 2] = v; out.data[i + 3] = 255;
  }
  edges.getContext('2d')!.putImageData(out, 0, 0);
  return { mask, edges, bounds: { x: Math.floor(box.x / k), y: Math.floor(box.y / k), w: Math.ceil(box.w / k), h: Math.ceil(box.h / k) } };
}

export type Refine = 'feather' | 'expand' | 'contract';
/** Softens, grows or shrinks a selection by `radius` pixels (blur, then threshold for grow/shrink). */
export function refineSelection(selection: Selection, op: Refine, radius: number): Selection | null {
  const { width, height } = selection.mask;
  const target = canvas(width, height);
  const c = target.getContext('2d', { willReadFrequently: op !== 'feather' })!;
  if (!('filter' in c)) throw new Error('このブラウザは選択範囲のぼかしに対応していません。');
  c.filter = `blur(${op === 'feather' ? radius : radius / 2}px)`;
  c.drawImage(selection.mask, 0, 0);
  c.filter = 'none';
  if (op !== 'feather') {
    // A blurred edge at distance r falls to about 2% (grow) or rises to about 98% (shrink).
    const data = c.getImageData(0, 0, width, height), d = data.data, limit = op === 'expand' ? 6 : 249;
    for (let i = 3; i < d.length; i += 4) { const on = d[i] > limit; d[i - 3] = d[i - 2] = d[i - 1] = 255; d[i] = on ? 255 : 0; }
    c.putImageData(data, 0, 0);
  }
  return finish(target);
}
