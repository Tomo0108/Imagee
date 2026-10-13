import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { readLuts, readPixels, readSource, type Project, type StoredLut } from '../store';
import { canvas, decode, thumbnail, toBlob } from '../imaging';
import { NEUTRAL } from '../lib/adjust.mjs';
import { IDENTITY } from '../lib/geometry.mjs';
import { cubeText, NEUTRAL_COLOR, parseCube } from '../lib/color.mjs';
import { baseName } from '../lib/files.mjs';
import { maskKey, newLayerId, type BlendMode, type Doc, type Layer, type LayerCache, type RasterLayer, type SavedEdits } from '../editor/document';
import type { PixelStore } from '../editor/pixels';
import { t } from '../i18n/index.mjs';

/** What importing a file produces: a project, its original image, painted surfaces and any LUTs it uses. */
export interface ImportedProject { project: Project; source: Blob; pixels: Map<string, Blob>; luts: StoredLut[] }

const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif', 'image/bmp': 'bmp' };

/* ---------- .imagee: a zip of JSON, the original image and PNG surfaces ---------- */

/** Packs a project as an `.imagee` file. The format is an ordinary zip, so its contents stay readable:
 *  imagee.json (metadata and edits), source.<ext>, pixels/<surface>.png, luts/<id>.cube, thumbnail.webp. */
export async function exportImagee(project: Project, source: Blob, pixels: Map<string, Blob>, luts: StoredLut[]): Promise<Blob> {
  const files: Zippable = {};
  const sourceName = `source.${EXTENSIONS[source.type] || 'bin'}`;
  files['imagee.json'] = strToU8(JSON.stringify({ format: 'imagee', version: 1, name: project.name, type: project.type, width: project.width, height: project.height, added: project.added, source: sourceName, edits: project.edits ?? null }, null, 2));
  // Images are already compressed: store them without deflating again.
  files[sourceName] = [await bytes(source), { level: 0 }];
  for (const [key, blob] of pixels) files[`pixels/${encodeURIComponent(key)}.png`] = [await bytes(blob), { level: 0 }];
  for (const lut of luts) files[`luts/${encodeURIComponent(lut.id)}.cube`] = strToU8(cubeText({ size: lut.size, data: lut.data, title: lut.name }));
  if (project.thumbnail) files['thumbnail.webp'] = [await bytes(project.thumbnail), { level: 0 }];
  return new Blob([zipSync(files) as Uint8Array<ArrayBuffer>], { type: 'application/x-imagee' });
}

/** Packs a project from the library (its stored image, surfaces and the LUTs its edits use). */
export async function exportStoredProject(project: Project): Promise<Blob> {
  const source = await readSource(project.id);
  if (!source) throw new Error(t('元の画像が見つかりません。'));
  const pixels = await readPixels(project.id);
  const used = new Set<string>();
  const e = project.edits;
  if (e?.color?.lut) used.add(e.color.lut.id);
  for (const layer of e?.layers || []) if (layer.kind === 'adjust' && layer.color.lut) used.add(layer.color.lut.id);
  const luts = used.size ? (await readLuts()).filter(lut => used.has(lut.id)) : [];
  return exportImagee(project, source, pixels, luts);
}

export async function importImagee(file: File): Promise<ImportedProject> {
  let entries: Record<string, Uint8Array>;
  try { entries = unzipSync(await bytes(file)); } catch { throw new Error(t('「{0}」は Imagee プロジェクトとして読み込めませんでした。', file.name)); }
  const meta = entries['imagee.json'] && JSON.parse(strFromU8(entries['imagee.json']));
  if (meta?.format !== 'imagee' || !entries[meta.source]) throw new Error(t('「{0}」は Imagee プロジェクトではないか、壊れています。', file.name));
  if (meta.version > 1) throw new Error(t('この Imagee プロジェクトは新しいバージョンで作られています。アプリを更新してください。'));
  const type = Object.entries(EXTENSIONS).find(([, ext]) => meta.source.endsWith(`.${ext}`))?.[0] || 'image/png';
  const source = new Blob([entries[meta.source] as Uint8Array<ArrayBuffer>], { type });
  const pixels = new Map<string, Blob>(), luts: StoredLut[] = [];
  for (const [path, data] of Object.entries(entries)) {
    const pixel = path.match(/^pixels\/(.+)\.png$/), lut = path.match(/^luts\/(.+)\.cube$/);
    if (pixel) pixels.set(decodeURIComponent(pixel[1]), new Blob([data as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
    if (lut) { const cube = parseCube(strFromU8(data)); luts.push({ id: decodeURIComponent(lut[1]), name: cube.title || 'LUT', size: cube.size, data: cube.data }); }
  }
  const thumb = entries['thumbnail.webp'] ? new Blob([entries['thumbnail.webp'] as Uint8Array<ArrayBuffer>], { type: 'image/webp' }) : await thumbFrom(source);
  const now = Date.now();
  const project: Project = { id: crypto.randomUUID(), name: meta.name || baseName(file.name), type: meta.type || type, size: source.size, width: meta.width, height: meta.height, added: now, opened: 0, favorite: false, thumbnail: thumb, edits: meta.edits || undefined, edited: meta.edits ? now : undefined };
  return { project, source, pixels, luts };
}

async function thumbFrom(blob: Blob) { const bitmap = await decode(blob); try { return await thumbnail(bitmap); } finally { bitmap.close(); } }

/* ---------- PSD (via ag-psd, loaded on demand) ---------- */

const PSD_BLEND: Record<string, BlendMode> = {
  normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten',
  'color dodge': 'color-dodge', 'color burn': 'color-burn', 'hard light': 'hard-light', 'soft light': 'soft-light',
  difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity',
};
const BLEND_PSD = Object.fromEntries(Object.entries(PSD_BLEND).map(([psd, mode]) => [mode, psd])) as Record<BlendMode, string>;

/** PSD masks are greyscale; ours keep visibility in alpha. */
function greyToAlpha(target: HTMLCanvasElement) {
  const c = target.getContext('2d', { willReadFrequently: true })!;
  const data = c.getImageData(0, 0, target.width, target.height), d = data.data;
  for (let i = 0; i < d.length; i += 4) { const v = d[i]; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = d[i + 3] ? v : 0; }
  c.putImageData(data, 0, 0);
}
function alphaToGrey(source: HTMLCanvasElement) {
  const out = canvas(source.width, source.height);
  const c = out.getContext('2d', { willReadFrequently: true })!;
  c.drawImage(source, 0, 0);
  const data = c.getImageData(0, 0, out.width, out.height), d = data.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = d[i + 3]; d[i + 3] = 255; }
  c.putImageData(data, 0, 0);
  return out;
}

interface PsdMask { canvas?: HTMLCanvasElement; left?: number; top?: number; defaultColor?: number; disabled?: boolean }
interface PsdLayerLike {
  name?: string; hidden?: boolean; opacity?: number; blendMode?: string; left?: number; top?: number; canvas?: HTMLCanvasElement;
  clipping?: boolean; children?: PsdLayerLike[]; mask?: PsdMask;
}

/** Reads a PSD into a project: each pixel layer becomes a raster layer (text is kept as pixels).
 *  Groups are flattened; a group's mask and a clipping mask carry over into each affected layer's own mask. */
export async function importPsd(file: File): Promise<ImportedProject> {
  const { readPsd } = await import('ag-psd');
  let psd;
  try { psd = readPsd(await file.arrayBuffer(), { skipThumbnail: true }); } catch { throw new Error(t('「{0}」は PSD として読み込めませんでした。', file.name)); }
  const { width, height } = psd;
  const pixels = new Map<string, Blob>(), layers: RasterLayer[] = [];
  /** A PSD mask as one of ours: full size, visibility in alpha. */
  const maskOf = (m: PsdMask) => {
    const mask = canvas(width, height), c = mask.getContext('2d')!;
    const base = m.defaultColor ?? 0;
    c.fillStyle = `rgb(${base},${base},${base})`; c.fillRect(0, 0, width, height);
    c.drawImage(m.canvas!, m.left ?? 0, m.top ?? 0);
    greyToAlpha(mask);
    return mask;
  };
  /** The visible part common to every shape given (by alpha), as a new white mask. */
  const intersect = (...shapes: (HTMLCanvasElement | null)[]) => {
    const list = shapes.filter((shape): shape is HTMLCanvasElement => !!shape);
    if (!list.length) return null;
    const mask = canvas(width, height), c = mask.getContext('2d')!;
    c.fillStyle = '#fff'; c.fillRect(0, 0, width, height);
    c.globalCompositeOperation = 'destination-in';
    for (const shape of list) c.drawImage(shape, 0, 0);
    return mask;
  };
  const visit = async (items: PsdLayerLike[], visible: boolean, opacity: number, inherited: HTMLCanvasElement | null) => {
    // The layer that following clipped layers are clipped to: its pixels and mask.
    let base: { surface: HTMLCanvasElement; mask: HTMLCanvasElement | null } | null = null;
    for (const item of items) {
      const shown = visible && !item.hidden, alpha = opacity * (item.opacity ?? 1);
      const own = item.mask?.canvas && !item.mask.disabled ? maskOf(item.mask) : null;
      if (item.children) { await visit(item.children, shown, alpha, own ? intersect(inherited, own) : inherited); base = null; continue; }
      if (!item.canvas) continue;
      const id = newLayerId();
      const surface = canvas(width, height);
      surface.getContext('2d')!.drawImage(item.canvas, item.left ?? 0, item.top ?? 0);
      pixels.set(id, await toBlob(surface, 'image/png'));
      const layer: RasterLayer = { kind: 'raster', id, name: item.name || t('レイヤー {0}', layers.length + 1), visible: shown, opacity: Math.round(alpha * 100), blend: PSD_BLEND[item.blendMode || 'normal'] || 'source-over', x: 0, y: 0, rev: 0 };
      const clip = item.clipping && base ? [base.surface, base.mask] : [];
      const mask = intersect(own, inherited, ...clip);
      if (mask) {
        pixels.set(maskKey(id), await toBlob(mask, 'image/png'));
        layer.mask = { rev: 0, enabled: true };
      } else if (item.mask?.canvas) {
        // A switched-off mask is kept, still switched off.
        pixels.set(maskKey(id), await toBlob(maskOf(item.mask), 'image/png'));
        layer.mask = { rev: 0, enabled: false };
      }
      if (!item.clipping) base = { surface, mask: intersect(own, inherited) };
      layers.push(layer);
    }
  };
  await visit((psd.children || []) as PsdLayerLike[], true, 1, null);
  let composite = psd.canvas as HTMLCanvasElement | undefined;
  if (!composite) {
    composite = canvas(width, height);
    const c = composite.getContext('2d')!;
    for (const layer of layers) if (layer.visible) { const bitmap = await decode(pixels.get(layer.id)!); c.globalAlpha = layer.opacity / 100; c.globalCompositeOperation = layer.blend; c.drawImage(bitmap, 0, 0); bitmap.close(); }
  }
  const source = await toBlob(composite, 'image/png');
  const now = Date.now();
  const edits: SavedEdits | undefined = layers.length ? { layers, adjust: NEUTRAL, color: NEUTRAL_COLOR, geometry: IDENTITY, selected: layers[layers.length - 1].id } : undefined;
  const project: Project = { id: crypto.randomUUID(), name: file.name, type: 'image/psd', size: file.size, width, height, added: now, opened: 0, favorite: false, thumbnail: await thumbFrom(source), edits, edited: edits ? now : undefined };
  return { project, source, pixels, luts: [] };
}

/** Writes the document's layers as a PSD at full size. Text and shapes become pixel layers; adjustment layers
 *  and global adjustments are only part of the composite image, since PSD stores them differently. */
export async function exportPsd(doc: Doc, store: PixelStore, cache: LayerCache, composite: HTMLCanvasElement): Promise<Blob> {
  const { writePsd } = await import('ag-psd');
  const children = doc.layers.flatMap((layer: Layer) => {
    if (layer.kind === 'adjust') return [];
    const source = cache.source(layer, store);
    if (!source) return [];
    let image = source.canvas as HTMLCanvasElement;
    if (!(image instanceof HTMLCanvasElement)) { image = canvas(source.canvas.width, source.canvas.height); image.getContext('2d')!.drawImage(source.canvas, 0, 0); }
    const mask = layer.mask && store.get(maskKey(layer.id));
    return [{
      name: layer.name, canvas: image, left: Math.round(source.x), top: Math.round(source.y), hidden: !layer.visible, opacity: layer.opacity / 100, blendMode: BLEND_PSD[layer.blend] as never,
      ...(mask ? { mask: { canvas: alphaToGrey(mask), left: 0, top: 0, defaultColor: 0, disabled: !layer.mask!.enabled } } : {}),
    }];
  });
  const flat = canvas(doc.width, doc.height);
  flat.getContext('2d')!.drawImage(composite, 0, 0, doc.width, doc.height);
  const buffer = writePsd({ width: doc.width, height: doc.height, children, canvas: flat }, { generateThumbnail: false });
  return new Blob([buffer], { type: 'image/vnd.adobe.photoshop' });
}
