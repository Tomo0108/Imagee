import { canvas } from '../imaging';
import { compositeInto, type Doc, type LayerCache } from './document';
import { Adjuster } from './gl';
import type { PixelStore } from './pixels';

/** The adjusted document at full resolution, for export. The editor works on a downscaled copy of large images;
 *  this composites at the document's own size and adjusts it in tiles (the adjustments are per pixel, so tiles join seamlessly). */
export function renderDocument(doc: Doc, store: PixelStore, cache: LayerCache): HTMLCanvasElement {
  const full = canvas(doc.width, doc.height);
  compositeInto(full, doc, store, cache);
  const adjuster = new Adjuster();
  try {
    const lut = cache.lut('', null, doc.color);
    const size = Math.min(adjuster.maxSize, 2048);
    const context = full.getContext('2d')!;
    const piece = canvas(Math.min(size, doc.width), Math.min(size, doc.height));
    const pc = piece.getContext('2d')!;
    for (let y = 0; y < doc.height; y += size) for (let x = 0; x < doc.width; x += size) {
      const w = Math.min(size, doc.width - x), h = Math.min(size, doc.height - y);
      if (piece.width !== w || piece.height !== h) { piece.width = w; piece.height = h; } else pc.clearRect(0, 0, w, h);
      pc.drawImage(full, x, y, w, h, 0, 0, w, h);
      adjuster.setSource(piece);
      adjuster.setLut(lut);
      const adjusted = adjuster.render(doc.adjust);
      context.clearRect(x, y, w, h);
      context.drawImage(adjusted, 0, 0, w, h, x, y, w, h);
    }
    piece.width = piece.height = 0;
  } finally { adjuster.dispose(); }
  return full;
}
