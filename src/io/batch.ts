import { zipSync, type Zippable } from 'fflate';
import type { Project } from '../store';
import { canvas, toBlob } from '../imaging';
import type { Cube } from '../lib/color.mjs';
import { ASPECTS, orientedSize, outputSize } from '../lib/geometry.mjs';
import { EXPORT_FORMATS } from '../lib/files.mjs';
import { centerCrop, outputNames, resizedSize, watermarkOrigin, type Recipe, type Watermark } from '../lib/recipe.mjs';
import { drawGeometry, LayerCache, type Doc } from '../editor/document';
import { PixelStore } from '../editor/pixels';
import { loadDoc } from '../editor/load';
import { renderDocument } from '../editor/render';

export interface BatchOutput { name: string; blob: Blob }
export interface BatchProgress { done: number; total: number; current: string; failed: string[] }

/** The recipe's tone replaces the document's own (edits are dropped earlier, when loading). */
function prepare(doc: Doc, recipe: Recipe): Doc {
  return recipe.tone ? { ...doc, adjust: recipe.tone.basic, color: recipe.tone.color } : doc;
}

function drawWatermark(context: CanvasRenderingContext2D, width: number, height: number, mark: Watermark) {
  const text = mark.text.trim();
  if (!text || !mark.opacity) return;
  const size = Math.max(8, Math.round(Math.min(width, height) * mark.size / 100));
  context.save();
  context.font = `600 ${size}px "Inter Variable", "Noto Sans JP Variable", system-ui, sans-serif`;
  context.textBaseline = 'top';
  const w = context.measureText(text).width, h = size * 1.2;
  const { x, y } = watermarkOrigin(mark.position, width, height, w, h, Math.round(size * 0.8));
  context.globalAlpha = mark.opacity / 100;
  context.shadowColor = 'rgba(0,0,0,.35)'; context.shadowBlur = size * 0.15; context.shadowOffsetY = size * 0.04;
  context.fillStyle = mark.color;
  context.fillText(text, x, y + size * 0.1);
  context.restore();
}

/** Renders one document through a recipe: layers → adjustments → geometry → aspect crop → resize → watermark → encode. */
async function render(doc: Doc, store: PixelStore, cache: LayerCache, recipe: Recipe): Promise<Blob> {
  const format = EXPORT_FORMATS.find(item => item.id === recipe.format)!;
  const adjusted = renderDocument(doc, store, cache);
  const out = outputSize(doc.geometry, doc.width, doc.height);
  const full = canvas(out.width, out.height);
  const fc = full.getContext('2d')!;
  fc.imageSmoothingQuality = 'high';
  drawGeometry(fc, adjusted, doc, 0, 0, 1, 'output');
  const aspect = ASPECTS.find(item => item.id === recipe.aspect);
  // "Original" follows the photo's orientation after quarter turns.
  const original = orientedSize(doc.width, doc.height, doc.geometry.quarter);
  const ratio = !aspect ? 0 : aspect.ratio < 0 ? original.width / original.height : aspect.ratio;
  const crop = centerCrop(out.width, out.height, ratio);
  const size = resizedSize(crop.w, crop.h, recipe.resize);
  const target = canvas(size.width, size.height);
  const context = target.getContext('2d')!;
  if (!format.alpha) { context.fillStyle = '#ffffff'; context.fillRect(0, 0, size.width, size.height); }
  context.imageSmoothingQuality = 'high';
  context.drawImage(full, crop.x, crop.y, crop.w, crop.h, 0, 0, size.width, size.height);
  drawWatermark(context, size.width, size.height, recipe.watermark);
  const blob = await toBlob(target, format.mime, format.lossy ? recipe.quality / 100 : undefined);
  adjusted.width = adjusted.height = full.width = full.height = target.width = target.height = 0;
  if (blob.type !== format.mime) throw new Error(`このブラウザは${format.label}の書き出しに対応していません。`);
  return blob;
}

/** Applies a recipe to each project in turn. One failure does not stop the rest; it is reported in `failed`. */
export async function runBatch(projects: Project[], recipe: Recipe, cubes: Map<string, Cube>, onProgress: (progress: BatchProgress) => void, signal: AbortSignal): Promise<{ outputs: BatchOutput[]; failed: string[]; error: string }> {
  const format = EXPORT_FORMATS.find(item => item.id === recipe.format)!;
  const names = outputNames(projects.map(project => project.name), recipe.suffix, format.extension);
  const outputs: BatchOutput[] = [], failed: string[] = [];
  let error = '';
  for (let i = 0; i < projects.length; i++) {
    if (signal.aborted) break;
    onProgress({ done: i, total: projects.length, current: projects[i].name, failed });
    try {
      const store = new PixelStore(), cache = new LayerCache();
      for (const [id, cube] of cubes) cache.cubes.set(id, cube);
      const doc = await loadDoc(projects[i], store, () => signal.aborted, !recipe.useEdits);
      if (!doc) break;
      outputs.push({ name: names[i], blob: await render(prepare(doc, recipe), store, cache, recipe) });
    } catch (e) { failed.push(projects[i].name); error ||= (e as Error).message; }
    // Let the progress paint between images.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  onProgress({ done: projects.length, total: projects.length, current: '', failed });
  return { outputs, failed, error };
}

/** Several results go in one zip (already-compressed images are stored, not deflated again). */
export async function packOutputs(outputs: BatchOutput[]): Promise<Blob> {
  const files: Zippable = {};
  for (const output of outputs) files[output.name] = [new Uint8Array(await output.blob.arrayBuffer()), { level: 0 }];
  return new Blob([zipSync(files) as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}
