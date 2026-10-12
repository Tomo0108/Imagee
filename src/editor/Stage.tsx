import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { centered, fitScale, zoomAt, type View } from '../lib/viewport.mjs';
import { apply, clampRect, effectiveCrop, invert, orientedSize, outputSize, resizeCrop, sourceMatrix, type Rect } from '../lib/geometry.mjs';
import { applySourceTransform, drawGeometry, type Doc } from './document';

export type Tool = 'move' | 'marquee' | 'ellipse' | 'lasso' | 'wand' | 'brush' | 'eraser' | 'heal' | 'clone' | 'fill' | 'gradient' | 'eyedropper' | 'text' | 'shape' | 'crop' | 'hand' | 'zoom';
export type ToolPhase = 'down' | 'move' | 'up' | 'hover';
/** Pointer position in document pixels, with pen pressure and modifier keys. */
export interface ToolPointer { x: number; y: number; pressure: number; pointerType: string; shift: boolean; alt: boolean }

interface Props {
  doc: Doc; image: HTMLCanvasElement | null; imageVersion: number; view: View | null; tool: Tool; spaceHeld: boolean; checkerboard: 'light' | 'dark';
  aspect: number; onCrop: (crop: Rect, final: boolean) => void;
  onView: (view: View) => void; onCursor: (point: { x: number; y: number } | null) => void; onSize: (size: { width: number; height: number }) => void;
  /** Drawing tools receive pointer events in document pixels. */
  onTool: (phase: ToolPhase, pointer: ToolPointer | null) => void;
  /** Draws selection outlines, previews and the brush cursor in document pixels; `pixel` is one screen pixel in document units. */
  overlay: (context: CanvasRenderingContext2D, pixel: number) => void;
  overlayVersion: number;
}
type Gesture =
  | { kind: 'pan'; x: number; y: number; view: View }
  | { kind: 'pinch'; distance: number; mid: { x: number; y: number }; view: View }
  | { kind: 'crop'; handle: string; x: number; y: number; start: Rect }
  | { kind: 'tool' };

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_CURSOR: Record<string, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', move: 'move' };
const TOOL_CURSOR: Partial<Record<Tool, string>> = { move: 'move', brush: 'none', eraser: 'none', heal: 'none', clone: 'none', text: 'text', zoom: 'zoom-in', hand: 'grab', crop: 'grab' };
const NAVIGATION: Tool[] = ['hand', 'zoom', 'crop'];

function checkerPattern(context: CanvasRenderingContext2D, tone: 'light' | 'dark', dpr: number) {
  const cell = Math.round(8 * dpr);
  const tile = document.createElement('canvas');
  tile.width = tile.height = cell * 2;
  const t = tile.getContext('2d')!;
  const [a, b] = tone === 'dark' ? ['#2a2a30', '#36363d'] : ['#ffffff', '#e6e6ea'];
  t.fillStyle = a; t.fillRect(0, 0, cell * 2, cell * 2);
  t.fillStyle = b; t.fillRect(0, 0, cell, cell); t.fillRect(cell, cell, cell, cell);
  return context.createPattern(tile, 'repeat')!;
}

/** Size of what the stage shows: the cropped output, or the whole rotated frame while cropping. */
export function contentSize(doc: Doc, tool: Tool) {
  return tool === 'crop' ? orientedSize(doc.width, doc.height, doc.geometry.quarter) : outputSize(doc.geometry, doc.width, doc.height);
}

function handlePoints(r: Rect) {
  const xs = { w: r.x, e: r.x + r.w, '': r.x + r.w / 2 }, ys = { n: r.y, s: r.y + r.h, '': r.y + r.h / 2 };
  return HANDLES.map(handle => ({ handle, x: xs[(handle.match(/[we]/)?.[0] || '') as keyof typeof xs], y: ys[(handle.match(/[ns]/)?.[0] || '') as keyof typeof ys] }));
}

export function Stage({ doc, image, imageVersion, view, tool, spaceHeld, checkerboard, aspect, onCrop, onView, onCursor, onSize, onTool, overlay, overlayVersion }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0, dpr: 1 });
  const viewRef = useRef(view); viewRef.current = view;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);
  const [liveCrop, setLiveCrop] = useState<Rect | null>(null);
  const [hover, setHover] = useState('');
  const [panning, setPanning] = useState(false);
  const content = contentSize(doc, tool);
  const crop = liveCrop || effectiveCrop(doc.geometry, doc.width, doc.height);

  useLayoutEffect(() => {
    const element = host.current!;
    const observer = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height, dpr: window.devicePixelRatio || 1 });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!size.width) return;
    onSize({ width: size.width, height: size.height });
    if (!viewRef.current) onView(centered(content.width, content.height, size.width, size.height, fitScale(content.width, content.height, size.width, size.height, tool === 'crop' ? 72 : 48)));
  }, [size, content.width, content.height, tool, view, onView, onSize]);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !view || !size.width) return;
    const { dpr } = size;
    element.width = Math.round(size.width * dpr); element.height = Math.round(size.height * dpr);
    const context = element.getContext('2d')!;
    context.clearRect(0, 0, element.width, element.height);
    const x = Math.round(view.x * dpr), y = Math.round(view.y * dpr), scale = view.scale * dpr;
    const w = Math.round(content.width * scale), h = Math.round(content.height * scale);
    context.imageSmoothingEnabled = view.scale < 2;
    context.imageSmoothingQuality = 'high';
    if (tool === 'crop') {
      if (image) drawGeometry(context, image, doc, x, y, scale, 'frame', false);
      // Dim everything outside the crop, then draw the frame, thirds and handles.
      const cx = x + crop.x * scale, cy = y + crop.y * scale, cw = crop.w * scale, ch = crop.h * scale;
      context.save();
      context.beginPath(); context.rect(0, 0, element.width, element.height); context.rect(cx, cy, cw, ch);
      context.fillStyle = 'rgba(10,10,14,.62)'; context.fill('evenodd');
      context.lineWidth = dpr;
      context.strokeStyle = 'rgba(255,255,255,.35)';
      context.beginPath();
      for (const t of [1 / 3, 2 / 3]) { context.moveTo(cx + cw * t, cy); context.lineTo(cx + cw * t, cy + ch); context.moveTo(cx, cy + ch * t); context.lineTo(cx + cw, cy + ch * t); }
      context.stroke();
      context.strokeStyle = '#fff'; context.lineWidth = 1.5 * dpr; context.strokeRect(cx, cy, cw, ch);
      context.fillStyle = '#fff'; context.shadowColor = 'rgba(0,0,0,.4)'; context.shadowBlur = 4 * dpr;
      for (const p of handlePoints({ x: cx, y: cy, w: cw, h: ch })) {
        const corner = p.handle.length === 2, len = (corner ? 18 : 22) * dpr, t = 3.5 * dpr;
        if (corner) {
          const sx = p.handle.includes('w') ? 1 : -1, sy = p.handle.includes('n') ? 1 : -1;
          // L-shaped corner: negative sizes draw toward the inside of the crop.
          context.fillRect(p.x - sx * t / 2, p.y - sy * t / 2, sx * len, sy * t);
          context.fillRect(p.x - sx * t / 2, p.y - sy * t / 2, sx * t, sy * len);
        } else if (p.handle === 'n' || p.handle === 's') context.fillRect(p.x - len / 2, p.y - t / 2, len, t);
        else context.fillRect(p.x - t / 2, p.y - len / 2, t, len);
      }
      context.restore();
      return;
    }
    context.save();
    context.shadowColor = 'rgba(0,0,0,.45)'; context.shadowBlur = 28 * dpr; context.shadowOffsetY = 6 * dpr;
    context.fillStyle = checkerPattern(context, checkerboard, dpr);
    context.fillRect(x, y, w, h);
    context.restore();
    if (image) drawGeometry(context, image, doc, x, y, scale, 'output');
    if (view.scale >= 12) {
      // Pixel grid over the visible part of the output.
      const left = Math.max(0, Math.floor(-x / scale)), top = Math.max(0, Math.floor(-y / scale));
      const right = Math.min(content.width, Math.ceil((element.width - x) / scale)), bottom = Math.min(content.height, Math.ceil((element.height - y) / scale));
      context.beginPath();
      for (let i = left; i <= right; i++) { const px = Math.round(x + i * scale) + .5; context.moveTo(px, y + top * scale); context.lineTo(px, y + bottom * scale); }
      for (let j = top; j <= bottom; j++) { const py = Math.round(y + j * scale) + .5; context.moveTo(x + left * scale, py); context.lineTo(x + right * scale, py); }
      context.strokeStyle = 'rgba(128,128,128,.35)'; context.lineWidth = 1; context.stroke();
    }
    context.save();
    context.beginPath(); context.rect(x, y, w, h); context.clip();
    applySourceTransform(context, doc, x, y, scale, 'output');
    overlay(context, 1 / scale * dpr);
    context.restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, size, doc, image, imageVersion, checkerboard, tool, crop.x, crop.y, crop.w, crop.h, content.width, content.height, overlay, overlayVersion]);

  const local = (event: { clientX: number; clientY: number }) => { const rect = host.current!.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
  const toDoc = (point: { x: number; y: number }, event: React.PointerEvent): ToolPointer | null => {
    const v = viewRef.current;
    if (!v) return null;
    const out = { x: (point.x - v.x) / v.scale, y: (point.y - v.y) / v.scale };
    const p = apply(invert(sourceMatrix(doc.geometry, doc.width, doc.height, 'output')), out.x, out.y);
    return { x: p.x, y: p.y, pressure: event.pressure, pointerType: event.pointerType, shift: event.shiftKey, alt: event.altKey };
  };
  const hitCrop = (point: { x: number; y: number }) => {
    const v = viewRef.current;
    if (!v || tool !== 'crop') return '';
    const r = { x: v.x + crop.x * v.scale, y: v.y + crop.y * v.scale, w: crop.w * v.scale, h: crop.h * v.scale };
    const reach = 14;
    for (const p of handlePoints(r)) if (Math.abs(point.x - p.x) <= reach && Math.abs(point.y - p.y) <= reach) return p.handle;
    return point.x > r.x && point.x < r.x + r.w && point.y > r.y && point.y < r.y + r.h ? 'move' : '';
  };

  useEffect(() => {
    const element = host.current!;
    const wheel = (event: WheelEvent) => {
      const current = viewRef.current;
      if (!current) return;
      event.preventDefault();
      const point = local(event);
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      if (event.ctrlKey || event.metaKey) onView(zoomAt(current, current.scale * Math.exp(-event.deltaY * unit * (event.ctrlKey && !event.metaKey && Math.abs(event.deltaY) < 50 ? 0.01 : 0.002)), point.x, point.y));
      else {
        const dx = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX, dy = event.shiftKey && !event.deltaX ? 0 : event.deltaY;
        onView({ ...current, x: current.x - dx * unit, y: current.y - dy * unit });
      }
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [onView]);

  const pointerDown = useCallback((event: React.PointerEvent) => {
    const current = viewRef.current;
    if (!current) return;
    const point = local(event);
    pointers.current.set(event.pointerId, point);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointers.current.size === 2) {
      // A second finger turns any gesture into pinch-zoom; an unfinished tool action is ended first.
      if (gesture.current?.kind === 'crop') setLiveCrop(null);
      if (gesture.current?.kind === 'tool') onTool('up', null);
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: 'pinch', distance: Math.hypot(b.x - a.x, b.y - a.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view: current };
      return;
    }
    const hit = event.button === 0 && !spaceHeld ? hitCrop(point) : '';
    if (hit) { gesture.current = { kind: 'crop', handle: hit, x: point.x, y: point.y, start: crop }; return; }
    if (NAVIGATION.includes(tool) && tool !== 'zoom' || spaceHeld || event.button === 1) { gesture.current = { kind: 'pan', x: point.x, y: point.y, view: current }; setPanning(true); return; }
    if (tool === 'zoom' && event.button === 0) { onView(zoomAt(current, current.scale * (event.altKey ? 0.5 : 2), point.x, point.y)); return; }
    if (event.button === 0) { gesture.current = { kind: 'tool' }; onTool('down', toDoc(point, event)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, spaceHeld, onView, crop, onTool, doc]);

  const pointerMove = useCallback((event: React.PointerEvent) => {
    const point = local(event);
    const current = viewRef.current;
    if (current && tool !== 'crop') {
      const p = { x: (point.x - current.x) / current.scale, y: (point.y - current.y) / current.scale };
      onCursor(p.x >= 0 && p.y >= 0 && p.x < content.width && p.y < content.height ? { x: Math.floor(p.x), y: Math.floor(p.y) } : null);
    }
    if (!pointers.current.has(event.pointerId)) {
      setHover(hitCrop(point));
      if (!NAVIGATION.includes(tool)) onTool('hover', toDoc(point, event));
      return;
    }
    pointers.current.set(event.pointerId, point);
    const g = gesture.current;
    if (g?.kind === 'pan') onView({ ...g.view, x: g.view.x + point.x - g.x, y: g.view.y + point.y - g.y });
    else if (g?.kind === 'tool') {
      // Coalesced events keep fast pen strokes smooth.
      const samples = (event.nativeEvent as PointerEvent).getCoalescedEvents?.() || [];
      if (samples.length > 1) for (const sample of samples) onTool('move', toDoc(local(sample), { ...event, pressure: sample.pressure } as React.PointerEvent));
      else onTool('move', toDoc(point, event));
    } else if (g?.kind === 'crop' && current) {
      const dx = (point.x - g.x) / current.scale, dy = (point.y - g.y) / current.scale;
      const frame = { width: content.width, height: content.height };
      setLiveCrop(g.handle === 'move' ? clampRect({ ...g.start, x: g.start.x + dx, y: g.start.y + dy }, frame) : resizeCrop(g.start, g.handle, dx, dy, aspect, frame));
    } else if (g?.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const zoomed = zoomAt(g.view, g.view.scale * (Math.hypot(b.x - a.x, b.y - a.y) / g.distance), g.mid.x, g.mid.y);
      onView({ ...zoomed, x: zoomed.x + mid.x - g.mid.x, y: zoomed.y + mid.y - g.mid.y });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content.width, content.height, onView, onCursor, tool, aspect, crop, onTool, doc]);

  const pointerUp = useCallback((event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (gesture.current?.kind === 'crop') { if (liveCrop) onCrop(liveCrop, true); setLiveCrop(null); }
    if (gesture.current?.kind === 'tool') onTool('up', toDoc(local(event), event));
    if (pointers.current.size === 1 && gesture.current?.kind === 'pinch') { const [p] = [...pointers.current.values()]; gesture.current = { kind: 'pan', x: p.x, y: p.y, view: viewRef.current! }; return; }
    if (!pointers.current.size) { gesture.current = null; setPanning(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveCrop, onCrop, onTool, doc]);

  const active = gesture.current?.kind === 'crop' ? gesture.current.handle : hover;
  const cursor = panning ? 'grabbing' : spaceHeld ? 'grab' : active ? HANDLE_CURSOR[active] : TOOL_CURSOR[tool] || 'crosshair';
  return <div ref={host} className="stage" style={{ cursor }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}
    onPointerLeave={() => { onCursor(null); setHover(''); if (!pointers.current.size) onTool('hover', null); }}
    onDoubleClick={() => { if (tool === 'hand') onView(centered(content.width, content.height, size.width, size.height, fitScale(content.width, content.height, size.width, size.height))); }}>
    <canvas ref={canvas} aria-label="キャンバス" role="img"/>
  </div>;
}
