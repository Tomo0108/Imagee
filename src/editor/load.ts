import { readPixels, readSource, type Project } from '../store';
import { decode } from '../imaging';
import { createDoc, maskKey, type Doc, type Layer, type RasterLayer } from './document';
import type { PixelStore } from './pixels';

/** A new mask surface: `source` if given, otherwise fully visible (white). */
export function createMask(store: PixelStore, key: string, width: number, height: number, source?: CanvasImageSource): number {
  const rev = store.create(key, width, height, source);
  if (!source) { const c = store.context(key); c.fillStyle = '#fff'; c.fillRect(0, 0, width, height); }
  return rev;
}

/** Opens a library project: decodes the original, then restores painted surfaces into `store`.
 *  Revisions are renumbered for this session. Returns null if `cancelled()` turns true on the way.
 *  `original` skips every edit, painting included, for the image as it was imported. */
export async function loadDoc(project: Project, store: PixelStore, cancelled: () => boolean = () => false, original = false): Promise<Doc | null> {
  const blob = await readSource(project.id);
  if (!blob) throw new Error('元の画像が見つかりません。ライブラリに追加し直してください。');
  if (original) project = { ...project, edits: undefined };
  const [bitmap, pixels] = await Promise.all([decode(blob), original ? new Map<string, Blob>() : readPixels(project.id).catch(() => new Map<string, Blob>())]);
  if (cancelled()) { bitmap.close(); return null; }
  const background: RasterLayer = { kind: 'raster', id: 'background', name: '背景', visible: true, opacity: 100, blend: 'source-over', x: 0, y: 0, rev: 0 };
  const initial = createDoc(bitmap.width, bitmap.height, background, project.edits);
  const { width, height } = initial;
  const restore = async (key: string) => { const saved = pixels.get(key); return saved ? decode(saved).catch(() => undefined) : undefined; };
  const layers: Layer[] = [];
  try {
    for (const layer of initial.layers) {
      let next = layer;
      if (layer.kind === 'raster') {
        const saved = await restore(layer.id);
        const rev = store.create(layer.id, width, height, saved || (layer.id === 'background' ? bitmap : undefined));
        saved?.close();
        store.saved.set(layer.id, rev);
        next = { ...layer, rev };
      }
      if (layer.mask) {
        const key = maskKey(layer.id), saved = await restore(key);
        const rev = createMask(store, key, width, height, saved);
        saved?.close();
        store.saved.set(key, rev);
        next = { ...next, mask: { ...layer.mask, rev } };
      }
      layers.push(next);
    }
  } finally { bitmap.close(); }
  if (cancelled()) return null;
  return { ...initial, layers };
}
