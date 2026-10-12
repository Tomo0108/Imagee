/// <reference lib="webworker" />
import { inpaint } from '../lib/inpaint.mjs';

export interface InpaintRequest { id: number; data: Uint8ClampedArray; width: number; height: number; weights: Float32Array }

self.onmessage = (event: MessageEvent<InpaintRequest>) => {
  const { id, data, width, height, weights } = event.data;
  try {
    const result = inpaint(data, width, height, weights, { onProgress: progress => postMessage({ id, progress }) }) ?? data;
    postMessage({ id, result }, [result.buffer]);
  } catch (e) { postMessage({ id, error: (e as Error).message || String(e) }); }
};
