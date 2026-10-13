/// <reference lib="webworker" />
// Runs the ONNX models off the main thread. WebGPU when available, WebAssembly otherwise; nothing leaves the device.
import * as ort from 'onnxruntime-web/webgpu';
import wasm from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url';
import mjs from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url';
import { segmentInput, tiles } from '../lib/matte.mjs';
import { t } from '../i18n/index.mjs';

ort.env.wasm.wasmPaths = { wasm, mjs };
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
ort.env.logLevel = 'error';

export type ModelRequest =
  | { id: number; type: 'segment'; url: string; pixels: Uint8ClampedArray; size: number }
  | { id: number; type: 'upscale'; url: string; pixels: Uint8ClampedArray; width: number; height: number };
export type ModelResponse = { id: number; progress: number } | { id: number; result: Float32Array | Uint8ClampedArray; backend: string } | { id: number; error: string };

const sessions = new Map<string, Promise<{ session: ort.InferenceSession; backend: string }>>();
function session(url: string) {
  let entry = sessions.get(url);
  if (!entry) {
    entry = (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(t('AI モデルを読み込めませんでした。'));
      const model = new Uint8Array(await response.arrayBuffer());
      const gpu = 'gpu' in navigator && !!(await (navigator as Navigator & { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter().catch(() => null));
      if (gpu) {
        try { return { session: await ort.InferenceSession.create(model, { executionProviders: ['webgpu'] }), backend: 'webgpu' }; }
        catch { /* Fall back to the CPU below. */ }
      }
      return { session: await ort.InferenceSession.create(model, { executionProviders: ['wasm'] }), backend: 'wasm' };
    })();
    entry.catch(() => sessions.delete(url));
    sessions.set(url, entry);
  }
  return entry;
}

async function segment(request: Extract<ModelRequest, { type: 'segment' }>) {
  const { session: s, backend } = await session(request.url);
  const input = new ort.Tensor('float32', segmentInput(request.pixels, request.size), [1, 3, request.size, request.size]);
  const output = await s.run({ [s.inputNames[0]]: input });
  const first = output[s.outputNames[0]];
  const result = new Float32Array(first.data as Float32Array);
  for (const name of s.outputNames) output[name].dispose?.();
  return { result, backend };
}

async function upscale(request: Extract<ModelRequest, { type: 'upscale' }>) {
  const { session: s, backend } = await session(request.url);
  const { pixels, width, height } = request;
  const W = width * 4, out = new Uint8ClampedArray(W * height * 4 * 4);
  const list = tiles(width, height, backend === 'webgpu' ? 384 : 192, 12);
  for (let k = 0; k < list.length; k++) {
    const t = list[k], n = t.w * t.h, data = new Float32Array(3 * n);
    for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
      const i = ((t.y + y) * width + t.x + x) * 4, j = y * t.w + x;
      data[j] = pixels[i] / 255; data[n + j] = pixels[i + 1] / 255; data[2 * n + j] = pixels[i + 2] / 255;
    }
    const result = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', data, [1, 3, t.h, t.w]) });
    const tensor = result[s.outputNames[0]], y4 = tensor.data as Float32Array, ow = t.w * 4, on = ow * t.h * 4;
    const { inner } = t;
    for (let y = inner.y * 4; y < (inner.y + inner.h) * 4; y++) for (let x = inner.x * 4; x < (inner.x + inner.w) * 4; x++) {
      const j = y * ow + x, o = ((t.y * 4 + y) * W + t.x * 4 + x) * 4;
      out[o] = y4[j] * 255; out[o + 1] = y4[on + j] * 255; out[o + 2] = y4[2 * on + j] * 255; out[o + 3] = 255;
    }
    tensor.dispose?.();
    postMessage({ id: request.id, progress: (k + 1) / list.length } satisfies ModelResponse);
  }
  return { result: out, backend };
}

self.onmessage = async (event: MessageEvent<ModelRequest>) => {
  const request = event.data;
  try {
    const { result, backend } = request.type === 'segment' ? await segment(request) : await upscale(request);
    postMessage({ id: request.id, result, backend } satisfies ModelResponse, [result.buffer]);
  } catch (e) {
    postMessage({ id: request.id, error: (e as Error).message || String(e) } satisfies ModelResponse);
  }
};
