import type { Project } from './store';

export async function decode(blob: Blob): Promise<ImageBitmap> {
  try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
  catch { throw new Error('この画像は読み込めませんでした。ファイルが壊れているか、未対応の形式です。'); }
}

export function canvas(width: number, height: number) {
  const element = document.createElement('canvas');
  element.width = width; element.height = height;
  return element;
}

export function toBlob(source: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => source.toBlob(blob => blob ? resolve(blob) : reject(new Error('書き出しに失敗しました。')), type, quality));
}

export async function thumbnail(bitmap: ImageBitmap, max = 480): Promise<Blob> {
  const ratio = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const target = canvas(Math.max(1, Math.round(bitmap.width * ratio)), Math.max(1, Math.round(bitmap.height * ratio)));
  const context = target.getContext('2d')!;
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, target.width, target.height);
  return toBlob(target, 'image/webp', 0.82);
}

export async function createProject(file: File): Promise<{ project: Project; source: Blob }> {
  const bitmap = await decode(file);
  try {
    const now = Date.now();
    const project: Project = { id: crypto.randomUUID(), name: file.name || '貼り付けた画像.png', type: file.type || 'image/png', size: file.size, width: bitmap.width, height: bitmap.height, added: now, opened: 0, favorite: false, thumbnail: await thumbnail(bitmap) };
    return { project, source: file };
  } finally { bitmap.close(); }
}

const avifSupport = (async () => {
  try { const blob = await toBlob(canvas(2, 2), 'image/avif', 0.5); return blob.type === 'image/avif'; } catch { return false; }
})();
export function supportsAvif() { return avifSupport; }

export interface Histogram { r: Uint32Array; g: Uint32Array; b: Uint32Array; l: Uint32Array; max: number }
export function histogram(bitmap: ImageBitmap): Histogram {
  const ratio = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
  const target = canvas(Math.max(1, Math.round(bitmap.width * ratio)), Math.max(1, Math.round(bitmap.height * ratio)));
  const context = target.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0, target.width, target.height);
  const data = context.getImageData(0, 0, target.width, target.height).data;
  const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    r[data[i]]++; g[data[i + 1]]++; b[data[i + 2]]++;
    l[Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2])]++;
  }
  // Ignore the clipped end bins when scaling so a burnt-out sky does not flatten the curve.
  let max = 1;
  for (const channel of [r, g, b, l]) for (let i = 1; i < 255; i++) max = Math.max(max, channel[i]);
  return { r, g, b, l, max };
}
