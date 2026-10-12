import { adjustPixel, isNeutral, NEUTRAL, normalizeAdjustments, type Adjustments } from '../lib/adjust.mjs';
import { bakeLut, colorFunction, isNeutralColor, normalizeColor, type ColorOps, type Cube } from '../lib/color.mjs';
import { effectiveCrop, IDENTITY, sourceMatrix, type Geometry } from '../lib/geometry.mjs';
import { canvas } from '../imaging';
import type { Box, PixelStore } from './pixels';
import { lutPass, type BakedLut } from './lut';

export type BlendMode = 'source-over' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light' | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';
export const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: 'source-over', label: '通常' }, { value: 'multiply', label: '乗算' }, { value: 'screen', label: 'スクリーン' }, { value: 'overlay', label: 'オーバーレイ' },
  { value: 'darken', label: '比較（暗）' }, { value: 'lighten', label: '比較（明）' }, { value: 'color-dodge', label: '覆い焼きカラー' }, { value: 'color-burn', label: '焼き込みカラー' },
  { value: 'hard-light', label: 'ハードライト' }, { value: 'soft-light', label: 'ソフトライト' }, { value: 'difference', label: '差の絶対値' }, { value: 'exclusion', label: '除外' },
  { value: 'hue', label: '色相' }, { value: 'saturation', label: '彩度' }, { value: 'color', label: 'カラー' }, { value: 'luminosity', label: '輝度' },
];

export const FONTS = [
  { value: "'Noto Sans JP Variable', sans-serif", label: 'ゴシック（Noto Sans JP）' },
  { value: "'Inter Variable', 'Noto Sans JP Variable', sans-serif", label: 'Inter' },
  { value: "'Hiragino Mincho ProN', 'Yu Mincho', 'YuMincho', 'Noto Serif JP', serif", label: '明朝' },
  { value: "'Hiragino Maru Gothic ProN', 'BIZ UDGothic', 'Noto Sans JP Variable', sans-serif", label: '丸ゴシック' },
  { value: "ui-monospace, 'SF Mono', Consolas, monospace", label: '等幅' },
];
export interface TextProps { content: string; font: string; size: number; weight: 400 | 700; italic: boolean; color: string; align: 'left' | 'center' | 'right'; vertical: boolean; lineHeight: number }
export interface ShapeProps { type: 'rect' | 'ellipse' | 'line'; w: number; h: number; fill: string | null; stroke: string | null; strokeWidth: number; radius: number }

/** Every edit is plain data, so each step is a cheap snapshot for undo and saves as JSON.
 *  Raster pixels live in the PixelStore; a layer only records which revision it shows.
 *  Pipeline: layers (with masks) are composited at source size → adjustments → geometry → vignette. */
interface LayerBase { id: string; name: string; visible: boolean; opacity: number; blend: BlendMode; x: number; y: number; mask?: { rev: number; enabled: boolean } }
export interface RasterLayer extends LayerBase { kind: 'raster'; rev: number }
export interface TextLayer extends LayerBase { kind: 'text'; text: TextProps }
export interface ShapeLayer extends LayerBase { kind: 'shape'; shape: ShapeProps }
/** Changes the colours of everything below it, through its mask. Nothing is baked into pixels. */
export interface AdjustLayer extends LayerBase { kind: 'adjust'; basic: Adjustments; color: ColorOps }
export type Layer = RasterLayer | TextLayer | ShapeLayer | AdjustLayer;
export interface Doc { width: number; height: number; layers: Layer[]; selected: string; adjust: Adjustments; color: ColorOps; geometry: Geometry }
export type SavedEdits = Pick<Doc, 'layers' | 'adjust' | 'geometry'> & { selected?: string; color?: ColorOps };

export const maskKey = (id: string) => `${id}#mask`;

export function createDoc(width: number, height: number, background: RasterLayer, saved?: Partial<SavedEdits>): Doc {
  // Layers saved before phase 3 have no kind or position: they are raster layers at the origin.
  const layers = saved?.layers?.length ? saved.layers.map(layer => normalizeLayer({ kind: 'raster', rev: 0, x: 0, y: 0, ...(layer as object) } as Layer)) : [background];
  return {
    width, height, layers,
    selected: saved?.selected && layers.some(l => l.id === saved.selected) ? saved.selected : layers[layers.length - 1].id,
    adjust: normalizeAdjustments(saved?.adjust ?? NEUTRAL),
    color: normalizeColor(saved?.color),
    geometry: saved?.geometry ? { ...IDENTITY, ...saved.geometry } : IDENTITY,
  };
}
export function savedEdits(doc: Doc): SavedEdits { return { layers: doc.layers, adjust: doc.adjust, color: doc.color, geometry: doc.geometry, selected: doc.selected }; }
function normalizeLayer(layer: Layer): Layer {
  return layer.kind === 'adjust' ? { ...layer, basic: normalizeAdjustments(layer.basic), color: normalizeColor(layer.color) } : layer;
}

/** The colour function of an adjustment layer or of the document's global colour settings. */
export function colorStage(basic: Adjustments | null, color: ColorOps, cube: Cube | undefined): ((rgb: number[]) => number[]) | null {
  const useBasic = basic && !isNeutral(basic), useColor = !isNeutralColor(color);
  if (!useBasic && !useColor) return null;
  const graded = useColor ? colorFunction(color, cube) : null;
  return rgb => { const a = useBasic ? adjustPixel(rgb, basic!) : rgb; return graded ? graded(a) : a; };
}

export function newLayerId() { return `layer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }
export function uniqueName(layers: Layer[], base: string) {
  const names = new Set(layers.map(l => l.name));
  for (let i = 1; ; i++) { const name = `${base} ${i}`; if (!names.has(name)) return name; }
}

const ROTATED = new Set('ー〜～…‥（）「」『』【】〈〉《》［］｛｝()[]{}<>-—―=＝'.split(''));
/** Text drawn into its own canvas. Vertical text flows top-to-bottom in columns from right to left. */
export function renderText(t: TextProps): HTMLCanvasElement {
  const probe = canvas(1, 1).getContext('2d')!;
  const font = `${t.italic ? 'italic ' : ''}${t.weight} ${t.size}px ${t.font}`;
  probe.font = font;
  // Web fonts load on first use; the editor redraws text when loading finishes.
  if (!document.fonts.check(font, t.content || ' ')) void document.fonts.load(font, t.content || ' ').catch(() => {});
  const lines = (t.content || ' ').split('\n');
  const step = t.size * t.lineHeight, pad = Math.ceil(t.size * 0.25);
  if (!t.vertical) {
    const widths = lines.map(line => probe.measureText(line).width);
    const width = Math.max(1, ...widths);
    const target = canvas(Math.ceil(width + pad * 2), Math.ceil(step * lines.length + pad * 2));
    const c = target.getContext('2d')!;
    c.font = font; c.fillStyle = t.color; c.textBaseline = 'middle';
    lines.forEach((line, i) => {
      const x = t.align === 'left' ? 0 : t.align === 'center' ? (width - widths[i]) / 2 : width - widths[i];
      c.fillText(line, pad + x, pad + step * i + step / 2);
    });
    return target;
  }
  const columns = lines.map(line => [...line]);
  const height = Math.max(1, ...columns.map(chars => chars.length)) * t.size;
  const target = canvas(Math.ceil(step * columns.length + pad * 2), Math.ceil(height + pad * 2));
  const c = target.getContext('2d')!;
  c.font = font; c.fillStyle = t.color; c.textAlign = 'center'; c.textBaseline = 'middle';
  columns.forEach((chars, col) => {
    const cx = target.width - pad - step * col - step / 2;
    const offset = t.align === 'left' ? 0 : t.align === 'center' ? (height - chars.length * t.size) / 2 : height - chars.length * t.size;
    chars.forEach((ch, row) => {
      const cy = pad + offset + row * t.size + t.size / 2;
      if (ROTATED.has(ch)) { c.save(); c.translate(cx, cy); c.rotate(Math.PI / 2); c.fillText(ch, 0, 0); c.restore(); }
      else c.fillText(ch, cx, cy);
    });
  });
  return target;
}

/** Shapes drawn into their own canvas; returns the canvas and how far it extends past the layer origin for the stroke. */
export function renderShape(s: ShapeProps): { canvas: HTMLCanvasElement; ox: number; oy: number } {
  const pad = Math.ceil((s.stroke ? s.strokeWidth : 0) / 2 + 2);
  const left = Math.min(0, s.type === 'line' ? s.w : 0), top = Math.min(0, s.type === 'line' ? s.h : 0);
  const w = Math.abs(s.w), h = Math.abs(s.h);
  const target = canvas(Math.max(1, Math.ceil(w + pad * 2)), Math.max(1, Math.ceil(h + pad * 2)));
  const c = target.getContext('2d')!;
  c.translate(pad - left, pad - top);
  c.beginPath();
  if (s.type === 'rect') c.roundRect(0, 0, s.w, s.h, Math.min(s.radius, w / 2, h / 2));
  else if (s.type === 'ellipse') c.ellipse(s.w / 2, s.h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else { c.moveTo(0, 0); c.lineTo(s.w, s.h); }
  if (s.fill && s.type !== 'line') { c.fillStyle = s.fill; c.fill(); }
  if (s.stroke && s.strokeWidth > 0) { c.strokeStyle = s.stroke; c.lineWidth = s.strokeWidth; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke(); }
  return { canvas: target, ox: pad - left, oy: pad - top };
}

/** Vector layers are re-rendered only when their properties change. */
export class LayerCache {
  private entries = new Map<string, { key: string; canvas: HTMLCanvasElement; dx: number; dy: number }>();
  private luts = new Map<string, { key: string; lut: BakedLut | null }>();
  /** Imported LUTs by id, for colour settings that refer to one. */
  cubes = new Map<string, Cube>();
  source(layer: Layer, store: PixelStore): { canvas: CanvasImageSource & { width: number; height: number }; x: number; y: number } | null {
    if (layer.kind === 'adjust') return null;
    if (layer.kind === 'raster') { const c = store.get(layer.id); return c ? { canvas: c, x: layer.x, y: layer.y } : null; }
    const key = JSON.stringify(layer.kind === 'text' ? layer.text : layer.shape);
    let entry = this.entries.get(layer.id);
    if (!entry || entry.key !== key) {
      if (layer.kind === 'text') entry = { key, canvas: renderText(layer.text), dx: -Math.ceil(layer.text.size * 0.25), dy: -Math.ceil(layer.text.size * 0.25) };
      else { const r = renderShape(layer.shape); entry = { key, canvas: r.canvas, dx: -r.ox, dy: -r.oy }; }
      this.entries.set(layer.id, entry);
    }
    return { canvas: entry.canvas, x: layer.x + entry.dx, y: layer.y + entry.dy };
  }
  /** Forgets rendered text and shapes (after fonts finish loading). */
  invalidate() { this.entries.clear(); }
  /** Baked colour table for an adjustment layer (or the global settings under the id ''); null when it changes nothing. */
  lut(id: string, basic: Adjustments | null, color: ColorOps): BakedLut | null {
    const cube = color.lut ? this.cubes.get(color.lut.id) : undefined;
    const key = JSON.stringify([basic, color, !!cube]);
    let entry = this.luts.get(id);
    if (!entry || entry.key !== key) {
      const fn = colorStage(basic, color, cube);
      entry = { key, lut: fn && { table: bakeLut(fn, 33), size: 33 } };
      this.luts.set(id, entry);
    }
    return entry.lut;
  }
  /** Bounds of a layer's visible content in document coordinates. */
  bounds(layer: Layer, store: PixelStore): Box | null {
    const s = this.source(layer, store);
    return s && { x: s.x, y: s.y, w: s.canvas.width, h: s.canvas.height };
  }
}

/** Draws one layer (with its mask) into `context`, whose units are document pixels × k. */
function drawLayer(context: CanvasRenderingContext2D, layer: Layer, store: PixelStore, cache: LayerCache, k: number, scratch: () => CanvasRenderingContext2D, area: Box) {
  if (layer.kind === 'adjust') return drawAdjustment(context, layer, store, cache, k, scratch, area);
  const source = cache.source(layer, store);
  if (!source) return;
  const mask = layer.mask?.enabled ? store.get(maskKey(layer.id)) : undefined;
  let target = context;
  if (mask) { target = scratch(); target.globalCompositeOperation = 'source-over'; target.globalAlpha = 1; }
  if (!mask) { context.globalAlpha = layer.opacity / 100; context.globalCompositeOperation = layer.blend; }
  target.drawImage(source.canvas, source.x * k, source.y * k, source.canvas.width * k, source.canvas.height * k);
  if (mask) {
    target.globalCompositeOperation = 'destination-in';
    target.drawImage(mask, 0, 0, mask.width * k, mask.height * k);
    context.globalAlpha = layer.opacity / 100; context.globalCompositeOperation = layer.blend;
    context.drawImage(target.canvas, 0, 0);
  }
  context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
}

/** Grades what is already in `context` within `area` (target pixels). With a mask or partial opacity the result is
 *  target × (1 − a·m) + graded × a·m, done with destination-out and additive drawing so alpha is preserved exactly. */
function drawAdjustment(context: CanvasRenderingContext2D, layer: AdjustLayer, store: PixelStore, cache: LayerCache, k: number, scratch: () => CanvasRenderingContext2D, area: Box) {
  const lut = cache.lut(layer.id, layer.basic, layer.color);
  if (!lut) return;
  const graded = lutPass().apply(context.canvas, area, lut);
  const mask = layer.mask?.enabled ? store.get(maskKey(layer.id)) : undefined;
  if (!mask && layer.opacity >= 100) { context.clearRect(area.x, area.y, area.w, area.h); context.drawImage(graded, area.x, area.y); return; }
  const s = scratch();
  s.globalCompositeOperation = 'source-over'; s.globalAlpha = 1;
  s.drawImage(graded, area.x, area.y);
  if (mask) { s.globalCompositeOperation = 'destination-in'; s.drawImage(mask, 0, 0, mask.width * k, mask.height * k); }
  context.save();
  context.globalAlpha = layer.opacity / 100;
  context.globalCompositeOperation = 'destination-out';
  if (mask) context.drawImage(mask, 0, 0, mask.width * k, mask.height * k); else { context.fillStyle = '#000'; context.fillRect(area.x, area.y, area.w, area.h); }
  context.globalCompositeOperation = 'lighter';
  context.drawImage(s.canvas, 0, 0);
  context.restore();
}

/** Flattens the visible layers. `region` (document pixels) limits the work to an area that changed. */
export function compositeInto(target: HTMLCanvasElement, doc: Doc, store: PixelStore, cache: LayerCache, region?: Box | null) {
  const k = target.width / doc.width;
  const context = target.getContext('2d')!;
  context.save();
  let area: Box = { x: 0, y: 0, w: target.width, h: target.height };
  if (region) {
    const x = Math.max(0, Math.floor(region.x * k) - 1), y = Math.max(0, Math.floor(region.y * k) - 1);
    area = { x, y, w: Math.min(target.width, Math.ceil((region.x + region.w) * k) + 1) - x, h: Math.min(target.height, Math.ceil((region.y + region.h) * k) + 1) - y };
    if (area.w <= 0 || area.h <= 0) { context.restore(); return; }
    context.beginPath(); context.rect(area.x, area.y, area.w, area.h); context.clip();
  }
  context.clearRect(area.x, area.y, area.w, area.h);
  context.imageSmoothingQuality = 'high';
  let scratchCanvas: HTMLCanvasElement | null = null;
  const scratch = () => {
    scratchCanvas ||= canvas(target.width, target.height);
    const c = scratchCanvas.getContext('2d')!;
    c.clearRect(0, 0, target.width, target.height);
    return c;
  };
  for (const layer of doc.layers) if (layer.visible && layer.opacity > 0) drawLayer(context, layer, store, cache, k, scratch, area);
  context.restore();
}

export function workCanvas(doc: Doc, maxSize: number) {
  const k = Math.min(1, maxSize / Math.max(doc.width, doc.height));
  return canvas(Math.max(1, Math.round(doc.width * k)), Math.max(1, Math.round(doc.height * k)));
}

/** Sets `context` so drawing in document (source) pixels lands where the geometry puts it. */
export function applySourceTransform(context: CanvasRenderingContext2D, doc: Doc, x: number, y: number, scale: number, mode: 'output' | 'frame') {
  context.translate(x, y);
  context.scale(scale, scale);
  context.transform(...sourceMatrix(doc.geometry, doc.width, doc.height, mode));
}

/** Draws `image` (the adjusted composite, any resolution) through the geometry.
 *  'output' draws the cropped result with its top-left at (x, y); 'frame' draws the whole rotated frame (for the crop tool). */
export function drawGeometry(context: CanvasRenderingContext2D, image: CanvasImageSource, doc: Doc, x: number, y: number, scale: number, mode: 'output' | 'frame', vignette = mode === 'output') {
  const crop = effectiveCrop(doc.geometry, doc.width, doc.height);
  context.save();
  if (mode === 'output') { context.beginPath(); context.rect(x, y, crop.w * scale, crop.h * scale); context.clip(); }
  context.save();
  applySourceTransform(context, doc, x, y, scale, mode);
  context.drawImage(image, 0, 0, doc.width, doc.height);
  context.restore();
  const amount = doc.adjust.vignette / 100;
  if (vignette && amount) {
    context.translate(x + crop.w * scale / 2, y + crop.h * scale / 2);
    context.scale(crop.w * scale / 2, crop.h * scale / 2);
    const gradient = context.createRadialGradient(0, 0, 0.3, 0, 0, 1.45);
    const tone = amount < 0 ? '0,0,0' : '255,255,255';
    gradient.addColorStop(0, `rgba(${tone},0)`);
    gradient.addColorStop(1, `rgba(${tone},${Math.abs(amount) * 0.85})`);
    context.globalCompositeOperation = 'source-atop';
    context.fillStyle = gradient;
    context.fillRect(-1, -1, 2, 2);
  }
  context.restore();
}
