export type BlendMode = 'source-over' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light' | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';
export const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: 'source-over', label: '通常' }, { value: 'multiply', label: '乗算' }, { value: 'screen', label: 'スクリーン' }, { value: 'overlay', label: 'オーバーレイ' },
  { value: 'darken', label: '比較（暗）' }, { value: 'lighten', label: '比較（明）' }, { value: 'color-dodge', label: '覆い焼きカラー' }, { value: 'color-burn', label: '焼き込みカラー' },
  { value: 'hard-light', label: 'ハードライト' }, { value: 'soft-light', label: 'ソフトライト' }, { value: 'difference', label: '差の絶対値' }, { value: 'exclusion', label: '除外' },
  { value: 'hue', label: '色相' }, { value: 'saturation', label: '彩度' }, { value: 'color', label: 'カラー' }, { value: 'luminosity', label: '輝度' },
];

/** Layer settings are plain data so every change is a cheap, undoable snapshot. Pixels live in `Bitmaps`. */
export interface Layer { id: string; name: string; visible: boolean; opacity: number; blend: BlendMode }
export interface Doc { width: number; height: number; layers: Layer[]; selected: string }
export type Bitmaps = Map<string, ImageBitmap>;

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
