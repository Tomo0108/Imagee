import { NEUTRAL, normalizeAdjustments, type Adjustments } from '../lib/adjust.mjs';
import { effectiveCrop, IDENTITY, orientedSize, type Geometry } from '../lib/geometry.mjs';
import { canvas } from '../imaging';

export type BlendMode = 'source-over' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light' | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';
export const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: 'source-over', label: '通常' }, { value: 'multiply', label: '乗算' }, { value: 'screen', label: 'スクリーン' }, { value: 'overlay', label: 'オーバーレイ' },
  { value: 'darken', label: '比較（暗）' }, { value: 'lighten', label: '比較（明）' }, { value: 'color-dodge', label: '覆い焼きカラー' }, { value: 'color-burn', label: '焼き込みカラー' },
  { value: 'hard-light', label: 'ハードライト' }, { value: 'soft-light', label: 'ソフトライト' }, { value: 'difference', label: '差の絶対値' }, { value: 'exclusion', label: '除外' },
  { value: 'hue', label: '色相' }, { value: 'saturation', label: '彩度' }, { value: 'color', label: 'カラー' }, { value: 'luminosity', label: '輝度' },
];

/** Every edit is plain data so it is a cheap, undoable snapshot and can be saved as JSON. Pixels live in `Bitmaps`.
 *  Pipeline: layers are composited at source size → adjustments → geometry (orientation, straighten, crop) → vignette. */
export interface Layer { id: string; name: string; visible: boolean; opacity: number; blend: BlendMode }
export interface Doc { width: number; height: number; layers: Layer[]; selected: string; adjust: Adjustments; geometry: Geometry }
export type Bitmaps = Map<string, ImageBitmap>;
export type SavedEdits = Pick<Doc, 'layers' | 'adjust' | 'geometry'>;

export function createDoc(width: number, height: number, layerId: string, saved?: Partial<SavedEdits>): Doc {
  const base: Layer = { id: layerId, name: '背景', visible: true, opacity: 100, blend: 'source-over' };
  const layer = saved?.layers?.find(item => item.id === layerId);
  return {
    width, height, selected: layerId,
    layers: [layer ? { ...base, ...layer } : base],
    adjust: normalizeAdjustments(saved?.adjust ?? NEUTRAL),
    geometry: saved?.geometry ? { ...IDENTITY, ...saved.geometry } : IDENTITY,
  };
}
export function savedEdits(doc: Doc): SavedEdits { return { layers: doc.layers, adjust: doc.adjust, geometry: doc.geometry }; }

export function drawLayers(context: CanvasRenderingContext2D, doc: Doc, bitmaps: Bitmaps, x: number, y: number, scale: number) {
  for (const layer of doc.layers) {
    const bitmap = bitmaps.get(layer.id);
    if (!layer.visible || !bitmap || layer.opacity <= 0) continue;
    context.globalAlpha = layer.opacity / 100;
    context.globalCompositeOperation = layer.blend;
    context.drawImage(bitmap, x, y, doc.width * scale, doc.height * scale);
  }
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
}

/** Flattens the layers at up to `maxSize` pixels on the long edge. */
export function composite(doc: Doc, bitmaps: Bitmaps, maxSize: number) {
  const k = Math.min(1, maxSize / Math.max(doc.width, doc.height));
  const target = canvas(Math.max(1, Math.round(doc.width * k)), Math.max(1, Math.round(doc.height * k)));
  const context = target.getContext('2d')!;
  context.imageSmoothingQuality = 'high';
  drawLayers(context, doc, bitmaps, 0, 0, k);
  return target;
}

/** Draws `image` (the adjusted source, any resolution) through the geometry.
 *  'output' draws the cropped result with its top-left at (x, y); 'frame' draws the whole rotated frame (for the crop tool). */
export function drawGeometry(context: CanvasRenderingContext2D, image: CanvasImageSource, doc: Doc, x: number, y: number, scale: number, mode: 'output' | 'frame', vignette = mode === 'output') {
  const g = doc.geometry;
  const frame = orientedSize(doc.width, doc.height, g.quarter);
  const crop = effectiveCrop(g, doc.width, doc.height);
  context.save();
  context.translate(x, y);
  context.scale(scale, scale);
  if (mode === 'output') { context.beginPath(); context.rect(0, 0, crop.w, crop.h); context.clip(); context.translate(-crop.x, -crop.y); }
  context.save();
  context.translate(frame.width / 2, frame.height / 2);
  context.rotate(g.angle * Math.PI / 180);
  context.scale(g.flipH ? -1 : 1, g.flipV ? -1 : 1);
  context.rotate(g.quarter * Math.PI / 2);
  context.drawImage(image, -doc.width / 2, -doc.height / 2, doc.width, doc.height);
  context.restore();
  const amount = doc.adjust.vignette / 100;
  if (vignette && amount) {
    context.translate(crop.x + crop.w / 2, crop.y + crop.h / 2);
    context.scale(crop.w / 2, crop.h / 2);
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
