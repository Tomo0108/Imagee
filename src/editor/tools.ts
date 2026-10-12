import { canvas } from '../imaging';
import { dabsAlong, type Sample } from '../lib/brush.mjs';
import { floodMask } from '../lib/flood.mjs';
import { heal } from '../lib/heal.mjs';
import { union, type Box, type PixelStore } from './pixels';
import type { Selection } from './selection';

export interface BrushOptions { size: number; hardness: number; opacity: number; pressureSize: boolean }
/** What a stroke does to its surface. 'hide' / 'reveal' are used on layer masks. */
export type StrokeEffect = 'paint' | 'erase' | 'hide' | 'reveal' | 'clone';
/** Where a clone stroke copies from, drawn at (x, y) in surface pixels. 'original' is the surface as it was when the stroke began. */
export interface CloneSource { image: CanvasImageSource | 'original'; x: number; y: number }

/** A brush or eraser stroke in progress. Dabs go into a stroke buffer at full strength and the buffer is laid
 *  over a copy of the surface taken at the start, so overlapping dabs never build up past the chosen opacity. */
export class Stroke {
  private buffer: HTMLCanvasElement;
  private bufferContext: CanvasRenderingContext2D;
  private original: HTMLCanvasElement;
  private scratch: HTMLCanvasElement;
  private last: Sample | null = null;
  private carry = 0;
  private dirty: Box | null = null;
  private total: Box | null = null;
  private clear: string;

  constructor(private store: PixelStore, private key: string, private options: BrushOptions, private color: string, private effect: StrokeEffect,
    /** Surface position in document pixels (raster layers can be moved). */ private offset: { x: number; y: number }, private selection: Selection | null,
    private source?: CloneSource) {
    const surface = store.get(key)!;
    this.buffer = canvas(surface.width, surface.height);
    this.bufferContext = this.buffer.getContext('2d')!;
    this.original = canvas(surface.width, surface.height);
    this.original.getContext('2d')!.drawImage(surface, 0, 0);
    this.scratch = canvas(surface.width, surface.height);
    this.clear = transparent(effect === 'paint' ? color : '#000');
  }

  /** Adds a pointer sample in document pixels; returns the area that changed, in document pixels. */
  add(point: Sample): Box | null {
    const p = { x: point.x - this.offset.x, y: point.y - this.offset.y, pressure: point.pressure };
    const { size, hardness, pressureSize } = this.options;
    const dabs = this.last ? dabsAlong(this.last, p, size, 0.12, this.carry, pressureSize) : { dabs: [{ ...p, size: size * (pressureSize ? Math.max(0.05, p.pressure) : 1) }], carry: 0 };
    this.carry = dabs.carry; this.last = p;
    const c = this.bufferContext;
    const ink = this.effect === 'paint' ? this.color : '#000';
    for (const dab of dabs.dabs) {
      const r = Math.max(0.5, dab.size / 2);
      const gradient = c.createRadialGradient(dab.x, dab.y, Math.min(r * hardness / 100, r - 0.5), dab.x, dab.y, r);
      gradient.addColorStop(0, ink); gradient.addColorStop(1, this.clear);
      c.fillStyle = hardness >= 100 ? ink : gradient;
      c.beginPath(); c.arc(dab.x, dab.y, r, 0, Math.PI * 2); c.fill();
      this.dirty = union(this.dirty, { x: dab.x - r - 1, y: dab.y - r - 1, w: r * 2 + 2, h: r * 2 + 2 });
    }
    return this.flush();
  }

  private flush(): Box | null {
    const area = this.dirty && clampBox(this.dirty, this.buffer);
    this.dirty = null;
    if (!area) return null;
    this.total = union(this.total, area);
    const target = this.store.context(this.key);
    const s = this.scratch.getContext('2d')!;
    s.clearRect(area.x, area.y, area.w, area.h);
    s.globalCompositeOperation = 'source-over';
    s.drawImage(this.buffer, area.x, area.y, area.w, area.h, area.x, area.y, area.w, area.h);
    if (this.source) {
      // The brush shape becomes a window onto the clone source.
      s.save(); s.beginPath(); s.rect(area.x, area.y, area.w, area.h); s.clip();
      s.globalCompositeOperation = 'source-in';
      s.drawImage(this.source.image === 'original' ? this.original : this.source.image, this.source.x, this.source.y);
      s.restore();
    }
    if (this.selection) { s.globalCompositeOperation = 'destination-in'; s.drawImage(this.selection.mask, -this.offset.x, -this.offset.y); s.globalCompositeOperation = 'source-over'; }
    target.save();
    target.clearRect(area.x, area.y, area.w, area.h);
    target.drawImage(this.original, area.x, area.y, area.w, area.h, area.x, area.y, area.w, area.h);
    target.globalAlpha = this.options.opacity / 100;
    target.globalCompositeOperation = this.effect === 'erase' || this.effect === 'hide' ? 'destination-out' : 'source-over';
    if (this.effect === 'reveal') { s.globalCompositeOperation = 'source-in'; s.fillStyle = '#fff'; s.fillRect(area.x, area.y, area.w, area.h); s.globalCompositeOperation = 'source-over'; }
    target.drawImage(this.scratch, area.x, area.y, area.w, area.h, area.x, area.y, area.w, area.h);
    target.restore();
    return { x: area.x + this.offset.x, y: area.y + this.offset.y, w: area.w, h: area.h };
  }

  /** Finishes the stroke as one undoable revision. Returns the new revision, or null if nothing was painted. */
  end(): number | null {
    if (!this.total) return null;
    const before = this.original.getContext('2d')!.getImageData(this.total.x, this.total.y, this.total.w, this.total.h);
    return this.store.commit(this.key, { box: this.total, before });
  }
}

function clampBox(box: Box, bounds: { width: number; height: number }): Box | null {
  const x = Math.max(0, Math.floor(box.x)), y = Math.max(0, Math.floor(box.y));
  const w = Math.min(bounds.width, Math.ceil(box.x + box.w)) - x, h = Math.min(bounds.height, Math.ceil(box.y + box.h)) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}
function transparent(color: string) {
  const c = canvas(1, 1).getContext('2d')!;
  c.fillStyle = color; c.fillRect(0, 0, 1, 1);
  const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
  return `rgba(${r},${g},${b},0)`;
}
export function hexToRgb(hex: string) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function rgbToHex(r: number, g: number, b: number) { return `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`; }

/** Runs `edit` on a surface as one undoable step. `box` is the area (surface pixels) the edit may touch. */
export function editSurface(store: PixelStore, key: string, box: Box, edit: (context: CanvasRenderingContext2D) => void): number | null {
  const snap = store.snapshot(key, box);
  if (!snap) return null;
  const context = store.context(key);
  context.save(); edit(context); context.restore();
  return store.commit(key, snap);
}

/** Paint bucket on the surface itself: fills pixels similar to the clicked one. */
export function bucketFill(store: PixelStore, key: string, point: { x: number; y: number }, color: string, opacity: number, tolerance: number, contiguous: boolean, offset: { x: number; y: number }, selection: Selection | null): Box | null {
  const surface = store.get(key)!;
  const context = store.context(key);
  const data = context.getImageData(0, 0, surface.width, surface.height);
  const mask = floodMask(data.data, surface.width, surface.height, point.x - offset.x, point.y - offset.y, tolerance, contiguous);
  let selected: Uint8ClampedArray | null = null;
  if (selection) {
    const sel = canvas(surface.width, surface.height).getContext('2d', { willReadFrequently: true })!;
    sel.drawImage(selection.mask, -offset.x, -offset.y);
    selected = sel.getImageData(0, 0, surface.width, surface.height).data;
  }
  const [r, g, b] = hexToRgb(color), a = opacity / 100;
  let left = surface.width, top = surface.height, right = -1, bottom = -1;
  const before = new ImageData(new Uint8ClampedArray(data.data), surface.width, surface.height);
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const coverage = a * (selected ? selected[p * 4 + 3] / 255 : 1);
    if (!coverage) continue;
    const i = p * 4, da = data.data[i + 3] / 255, oa = coverage + da * (1 - coverage);
    data.data[i] = (r * coverage + data.data[i] * da * (1 - coverage)) / oa;
    data.data[i + 1] = (g * coverage + data.data[i + 1] * da * (1 - coverage)) / oa;
    data.data[i + 2] = (b * coverage + data.data[i + 2] * da * (1 - coverage)) / oa;
    data.data[i + 3] = oa * 255;
    const x = p % surface.width, y = (p - x) / surface.width;
    if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y;
  }
  if (right < 0) return null;
  const box = { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
  const crop = (image: ImageData) => { const c = canvas(surface.width, surface.height).getContext('2d')!; c.putImageData(image, 0, 0); return c.getImageData(box.x, box.y, box.w, box.h); };
  context.putImageData(data, 0, 0, box.x, box.y, box.w, box.h);
  store.commit(key, { box, before: crop(before) });
  return { x: box.x + offset.x, y: box.y + offset.y, w: box.w, h: box.h };
}

/** Linear or radial gradient from the foreground colour to the background colour (or to transparent). */
export function gradientFill(store: PixelStore, key: string, from: { x: number; y: number }, to: { x: number; y: number }, type: 'linear' | 'radial', colors: [string, string], opacity: number, offset: { x: number; y: number }, selection: Selection | null): Box | null {
  const surface = store.get(key)!;
  const box = selection ? { x: selection.bounds.x - offset.x, y: selection.bounds.y - offset.y, w: selection.bounds.w, h: selection.bounds.h } : { x: 0, y: 0, w: surface.width, h: surface.height };
  const layer = canvas(surface.width, surface.height);
  const c = layer.getContext('2d')!;
  const a = { x: from.x - offset.x, y: from.y - offset.y }, b = { x: to.x - offset.x, y: to.y - offset.y };
  const gradient = type === 'linear' ? c.createLinearGradient(a.x, a.y, b.x, b.y) : c.createRadialGradient(a.x, a.y, 0, a.x, a.y, Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)));
  gradient.addColorStop(0, colors[0]); gradient.addColorStop(1, colors[1]);
  c.fillStyle = gradient; c.fillRect(0, 0, surface.width, surface.height);
  if (selection) { c.globalCompositeOperation = 'destination-in'; c.drawImage(selection.mask, -offset.x, -offset.y); }
  const rev = editSurface(store, key, box, target => { target.globalAlpha = opacity / 100; target.drawImage(layer, 0, 0); });
  return rev === null ? null : { x: box.x + offset.x, y: box.y + offset.y, w: box.w, h: box.h };
}

/** The area painted with the spot healing brush, kept as a soft mask in surface pixels until the stroke ends. */
export class HealMask {
  readonly canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private last: Sample | null = null;
  private carry = 0;
  bounds: Box | null = null;
  constructor(width: number, height: number, private size: number, private hardness: number, readonly offset: { x: number; y: number }) {
    this.canvas = canvas(width, height);
    this.context = this.canvas.getContext('2d', { willReadFrequently: true })!;
  }
  add(point: Sample) {
    const p = { x: point.x - this.offset.x, y: point.y - this.offset.y, pressure: 1 };
    const dabs = this.last ? dabsAlong(this.last, p, this.size, 0.15, this.carry, false) : { dabs: [{ ...p, size: this.size }], carry: 0 };
    this.carry = dabs.carry; this.last = p;
    const c = this.context;
    for (const dab of dabs.dabs) {
      const r = Math.max(1, dab.size / 2);
      const gradient = c.createRadialGradient(dab.x, dab.y, Math.min(r * this.hardness / 100, r - 0.5), dab.x, dab.y, r);
      gradient.addColorStop(0, '#fff'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = gradient; c.beginPath(); c.arc(dab.x, dab.y, r, 0, Math.PI * 2); c.fill();
      this.bounds = union(this.bounds, { x: dab.x - r - 1, y: dab.y - r - 1, w: r * 2 + 2, h: r * 2 + 2 });
    }
  }
}

/** Heals the masked area of a surface as one undoable step. Returns the new revision, or null. */
export function healSurface(store: PixelStore, key: string, mask: HealMask): number | null {
  const surface = store.get(key)!;
  if (!mask.bounds) return null;
  const b = mask.bounds, extent = Math.max(b.w, b.h);
  // Leave room around the area for source candidates up to ~2.3 × its size away.
  const x = Math.max(0, Math.floor(b.x - extent * 2.6)), y = Math.max(0, Math.floor(b.y - extent * 2.6));
  const box = { x, y, w: Math.min(surface.width, Math.ceil(b.x + b.w + extent * 2.6)) - x, h: Math.min(surface.height, Math.ceil(b.y + b.h + extent * 2.6)) - y };
  if (box.w <= 0 || box.h <= 0) return null;
  const image = store.context(key).getImageData(box.x, box.y, box.w, box.h);
  const alpha = mask.canvas.getContext('2d')!.getImageData(box.x, box.y, box.w, box.h).data;
  const weights = new Float32Array(box.w * box.h);
  for (let i = 0; i < weights.length; i++) weights[i] = alpha[i * 4 + 3] / 255;
  const result = heal(image.data, box.w, box.h, weights);
  if (!result) return null;
  return editSurface(store, key, box, context => context.putImageData(new ImageData(result.data as Uint8ClampedArray<ArrayBuffer>, box.w, box.h), box.x, box.y));
}
