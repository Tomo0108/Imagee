import { RevChain, nextRev } from '../lib/revchain.mjs';
import { canvas } from '../imaging';

export interface Box { x: number; y: number; w: number; h: number }
interface Patch { x: number; y: number; before: ImageData; after: ImageData }
interface Surface { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; rev: number; chain: RevChain<Patch> }

/** Pixel surfaces (raster layers and masks) with undo by dirty-rectangle patches.
 *  The document only stores each surface's revision number; `sync` moves the pixels to match. */
export class PixelStore {
  private surfaces = new Map<string, Surface>();
  /** Revisions written to storage, so autosave only uploads what changed. */
  readonly saved = new Map<string, number>();

  create(key: string, width: number, height: number, source?: CanvasImageSource, rev = nextRev()): number {
    const element = canvas(width, height);
    const context = element.getContext('2d', { willReadFrequently: true })!;
    if (source) context.drawImage(source, 0, 0);
    this.surfaces.set(key, { canvas: element, context, rev, chain: new RevChain<Patch>(rev) });
    return rev;
  }
  has(key: string) { return this.surfaces.has(key); }
  get(key: string): HTMLCanvasElement | undefined { return this.surfaces.get(key)?.canvas; }
  context(key: string) { return this.surfaces.get(key)!.context; }
  rev(key: string) { return this.surfaces.get(key)?.rev; }

  /** Copies the area an edit is about to touch. Call before changing pixels, then `commit`. */
  snapshot(key: string, box: Box): { box: Box; before: ImageData } | null {
    const surface = this.surfaces.get(key);
    const clipped = surface && clip(box, surface.canvas);
    if (!surface || !clipped) return null;
    return { box: clipped, before: surface.context.getImageData(clipped.x, clipped.y, clipped.w, clipped.h) };
  }
  /** Records the change since `snapshot` as a new revision and returns it. */
  commit(key: string, snap: { box: Box; before: ImageData }): number {
    const surface = this.surfaces.get(key)!;
    const { box, before } = snap;
    const after = surface.context.getImageData(box.x, box.y, box.w, box.h);
    const rev = nextRev();
    surface.chain.push(surface.rev, rev, { x: box.x, y: box.y, before, after });
    surface.rev = rev;
    return rev;
  }
  /** Moves a surface to the revision the document points at (undo, redo, history jumps). Returns the area that changed. */
  sync(key: string, rev: number): Box | null {
    const surface = this.surfaces.get(key);
    if (!surface || surface.rev === rev || !surface.chain.has(rev)) return null;
    let dirty: Box | null = null;
    for (const { patch, forward } of surface.chain.path(surface.rev, rev)) {
      surface.context.putImageData(forward ? patch.after : patch.before, patch.x, patch.y);
      dirty = union(dirty, { x: patch.x, y: patch.y, w: patch.after.width, h: patch.after.height });
    }
    surface.rev = rev;
    return dirty;
  }
}

export function clip(box: Box, bounds: { width: number; height: number }): Box | null {
  const x = Math.max(0, Math.floor(box.x)), y = Math.max(0, Math.floor(box.y));
  const right = Math.min(bounds.width, Math.ceil(box.x + box.w)), bottom = Math.min(bounds.height, Math.ceil(box.y + box.h));
  return right > x && bottom > y ? { x, y, w: right - x, h: bottom - y } : null;
}
export function union(a: Box | null, b: Box | null): Box | null {
  if (!a) return b; if (!b) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
