// On-device AI tools: subject and sky masks, object removal and upscaling. Everything runs locally in workers.
import { canvas } from '../imaging';
import { bleed, canUpscale, guidedFilter, luminance, normalize, resizeMap, skyMask } from '../lib/matte.mjs';
import type { ModelRequest, ModelResponse } from './model.worker';

type Pending = { resolve: (value: never) => void; reject: (error: Error) => void; progress?: (fraction: number) => void };
type Payload<T> = T extends unknown ? Omit<T, 'id'> : never;

/** A worker with request/response ids, progress and cancellation (by restarting the worker). */
class Client<Request extends { id: number }> {
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private next = 1;
  constructor(private create: () => Worker) {}
  call<T>(request: Payload<Request>, transfer: Transferable[], progress?: (fraction: number) => void): Promise<T> {
    const worker = this.worker ??= this.listen(this.create());
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: never) => void, reject, progress });
      worker.postMessage({ ...request, id }, transfer);
    });
  }
  cancel() {
    this.worker?.terminate(); this.worker = null;
    for (const pending of this.pending.values()) pending.reject(new DOMException('中止しました。', 'AbortError'));
    this.pending.clear();
  }
  private listen(worker: Worker) {
    worker.onmessage = (event: MessageEvent<ModelResponse | { id: number; progress: number } | { id: number; result: Uint8ClampedArray } | { id: number; error: string }>) => {
      const message = event.data, pending = this.pending.get(message.id);
      if (!pending) return;
      if ('progress' in message) { pending.progress?.(message.progress); return; }
      this.pending.delete(message.id);
      if ('error' in message) pending.reject(new Error(message.error));
      else pending.resolve(message.result as never);
    };
    worker.onerror = event => { for (const pending of this.pending.values()) pending.reject(new Error(event.message || 'AI の処理に失敗しました。')); this.pending.clear(); this.worker = null; };
    return worker;
  }
}

const models = new Client<ModelRequest>(() => new Worker(new URL('./model.worker.ts', import.meta.url), { type: 'module' }));
const filler = new Client<{ id: number; data: Uint8ClampedArray; width: number; height: number; weights: Float32Array }>(() => new Worker(new URL('./inpaint.worker.ts', import.meta.url), { type: 'module' }));
const modelUrl = (name: string) => new URL(`models/${name}`, document.baseURI).href;

/** Stops whatever the AI workers are doing. */
export function cancelAi() { models.cancel(); filler.cancel(); }

type Source = CanvasImageSource & { width: number; height: number };
const SEGMENT_SIZE = 320;

/** Turns a 0..1 map at the guide's size into a mask canvas (white, visibility in alpha) at the document size. */
function maskCanvas(values: Float32Array, w: number, h: number, width: number, height: number) {
  const small = canvas(w, h), data = new ImageData(w, h);
  for (let i = 0; i < values.length; i++) { data.data[i * 4] = data.data[i * 4 + 1] = data.data[i * 4 + 2] = 255; data.data[i * 4 + 3] = Math.round(values[i] * 255); }
  small.getContext('2d')!.putImageData(data, 0, 0);
  if (w === width && h === height) return small;
  const out = canvas(width, height), c = out.getContext('2d')!;
  c.imageSmoothingQuality = 'high';
  c.drawImage(small, 0, 0, width, height);
  return out;
}
/** Pixels of `source` at most `max` pixels on the long side. */
function pixelsOf(source: Source, max: number) {
  const k = Math.min(1, max / Math.max(source.width, source.height));
  const w = Math.max(1, Math.round(source.width * k)), h = Math.max(1, Math.round(source.height * k));
  const c = canvas(w, h).getContext('2d', { willReadFrequently: true })!;
  c.imageSmoothingQuality = 'high';
  c.drawImage(source, 0, 0, w, h);
  return { data: c.getImageData(0, 0, w, h).data, w, h };
}

/** Mask of the main subject of `source`, refined to the image's edges, at width × height. */
export async function subjectMask(source: Source, width: number, height: number): Promise<HTMLCanvasElement> {
  // The model wants a square: stretch rather than pad, as it was trained.
  const square = canvas(SEGMENT_SIZE, SEGMENT_SIZE).getContext('2d', { willReadFrequently: true })!;
  square.drawImage(source, 0, 0, SEGMENT_SIZE, SEGMENT_SIZE);
  const pixels = square.getImageData(0, 0, SEGMENT_SIZE, SEGMENT_SIZE).data;
  const raw = await models.call<Float32Array>({ type: 'segment', url: modelUrl('segment.onnx'), pixels, size: SEGMENT_SIZE }, [pixels.buffer]);
  const guide = pixelsOf(source, 1024);
  const matte = resizeMap(normalize(raw), SEGMENT_SIZE, SEGMENT_SIZE, guide.w, guide.h);
  const refined = guidedFilter(luminance(guide.data), matte, guide.w, guide.h, Math.max(2, Math.round(Math.min(guide.w, guide.h) / 160)), 1e-4);
  // Firm up the matte so the subject is solid and the background clear, keeping soft edges.
  for (let i = 0; i < refined.length; i++) refined[i] = Math.min(1, Math.max(0, (refined[i] - 0.5) * 1.6 + 0.5));
  return maskCanvas(refined, guide.w, guide.h, width, height);
}

/** Mask of the sky in `source` at width × height (no model: colour and edges). */
export function skyMaskCanvas(source: Source, width: number, height: number): HTMLCanvasElement | null {
  const { data, w, h } = pixelsOf(source, 768);
  const values = skyMask(data, w, h);
  let total = 0;
  for (const v of values) total += v;
  return total < values.length * 0.01 ? null : maskCanvas(values, w, h, width, height);
}

/** Fills the weighted area of `image` with surrounding texture. */
export function removeArea(image: ImageData, weights: Float32Array, progress?: (fraction: number) => void): Promise<Uint8ClampedArray> {
  const data = new Uint8ClampedArray(image.data);
  return filler.call<Uint8ClampedArray>({ data, width: image.width, height: image.height, weights }, [data.buffer, weights.buffer], progress);
}

export { canUpscale };
/** Upscales `source` 2× or 4× with Real-ESRGAN. Transparency is scaled smoothly. */
export async function upscale(source: HTMLCanvasElement, factor: 2 | 4, progress?: (fraction: number) => void): Promise<HTMLCanvasElement> {
  const { width, height } = source;
  if (!canUpscale(width, height)) throw new Error('高解像度化できるのは 300 万画素（約 2000 × 1500 px）までの画像です。先に縮小してください。');
  const c = source.getContext('2d', { willReadFrequently: true })!;
  const pixels = c.getImageData(0, 0, width, height).data;
  let opaque = true;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 255) { opaque = false; break; }
  // Transparent pixels carry no colour; spread the visible colours into them so the edges do not darken.
  const copy = opaque ? new Uint8ClampedArray(pixels) : bleed(pixels, width, height) as Uint8ClampedArray<ArrayBuffer>;
  const result = await models.call<Uint8ClampedArray>({ type: 'upscale', url: modelUrl('upscale-x4.onnx'), pixels: copy, width, height }, [copy.buffer], progress);
  const big = canvas(width * 4, height * 4), bc = big.getContext('2d')!;
  bc.putImageData(new ImageData(result as Uint8ClampedArray<ArrayBuffer>, width * 4, height * 4), 0, 0);
  if (!opaque) {
    // Keep the original transparency, scaled smoothly.
    const alpha = canvas(width * 4, height * 4), ac = alpha.getContext('2d')!;
    ac.imageSmoothingQuality = 'high';
    ac.drawImage(source, 0, 0, width * 4, height * 4);
    bc.globalCompositeOperation = 'destination-in';
    bc.drawImage(alpha, 0, 0);
    alpha.width = alpha.height = 0;
  }
  if (factor === 4) return big;
  const out = canvas(width * 2, height * 2), oc = out.getContext('2d')!;
  oc.imageSmoothingQuality = 'high';
  oc.drawImage(big, 0, 0, width * 2, height * 2);
  big.width = big.height = 0;
  return out;
}
