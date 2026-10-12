import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { centered, fitScale, toImage, zoomAt, type View } from '../lib/viewport.mjs';
import { drawLayers, type Bitmaps, type Doc } from './document';

export type Tool = 'hand' | 'zoom';
interface Props {
  doc: Doc; bitmaps: Bitmaps; view: View | null; tool: Tool; spaceHeld: boolean; checkerboard: 'light' | 'dark';
  onView: (view: View) => void; onCursor: (point: { x: number; y: number } | null) => void; onSize: (size: { width: number; height: number }) => void;
}

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

export function Stage({ doc, bitmaps, view, tool, spaceHeld, checkerboard, onView, onCursor, onSize }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0, dpr: 1 });
  const viewRef = useRef(view); viewRef.current = view;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: 'pan'; x: number; y: number; view: View } | { kind: 'pinch'; distance: number; mid: { x: number; y: number }; view: View } | null>(null);
  const [panning, setPanning] = useState(false);

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
    if (!viewRef.current) onView(centered(doc.width, doc.height, size.width, size.height, fitScale(doc.width, doc.height, size.width, size.height)));
  }, [size, doc.width, doc.height, onView, onSize]);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !view || !size.width) return;
    const { dpr } = size;
    element.width = Math.round(size.width * dpr); element.height = Math.round(size.height * dpr);
    const context = element.getContext('2d')!;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, element.width, element.height);
    // Draw in device pixels, snapping the image edge so it stays crisp.
    const x = Math.round(view.x * dpr), y = Math.round(view.y * dpr), scale = view.scale * dpr;
    const w = Math.round(doc.width * scale), h = Math.round(doc.height * scale);
    context.shadowColor = 'rgba(0,0,0,.45)'; context.shadowBlur = 28 * dpr; context.shadowOffsetY = 6 * dpr;
    context.fillStyle = checkerPattern(context, checkerboard, dpr);
    context.fillRect(x, y, w, h);
    context.shadowColor = 'transparent';
    context.imageSmoothingEnabled = view.scale < 2;
    context.imageSmoothingQuality = 'high';
    context.save(); context.beginPath(); context.rect(x, y, w, h); context.clip();
    drawLayers(context, doc, bitmaps, x, y, scale);
    if (view.scale >= 12) {
      // Pixel grid, only for the visible part of the image.
      const left = Math.max(0, Math.floor(-x / scale)), top = Math.max(0, Math.floor(-y / scale));
      const right = Math.min(doc.width, Math.ceil((element.width - x) / scale)), bottom = Math.min(doc.height, Math.ceil((element.height - y) / scale));
      context.beginPath();
      for (let i = left; i <= right; i++) { const px = Math.round(x + i * scale) + .5; context.moveTo(px, y + top * scale); context.lineTo(px, y + bottom * scale); }
      for (let j = top; j <= bottom; j++) { const py = Math.round(y + j * scale) + .5; context.moveTo(x + left * scale, py); context.lineTo(x + right * scale, py); }
      context.strokeStyle = 'rgba(128,128,128,.35)'; context.lineWidth = 1; context.stroke();
    }
    context.restore();
  }, [view, size, doc, bitmaps, checkerboard]);

  const local = (event: { clientX: number; clientY: number }) => { const rect = host.current!.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };

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

  const startPinch = () => {
    const [a, b] = [...pointers.current.values()];
    gesture.current = { kind: 'pinch', distance: Math.hypot(b.x - a.x, b.y - a.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view: viewRef.current! };
  };

  const pointerDown = useCallback((event: React.PointerEvent) => {
    const current = viewRef.current;
    if (!current) return;
    const point = local(event);
    pointers.current.set(event.pointerId, point);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointers.current.size === 2) { startPinch(); return; }
    if (tool === 'hand' || spaceHeld || event.button === 1) { gesture.current = { kind: 'pan', x: point.x, y: point.y, view: current }; setPanning(true); return; }
    if (tool === 'zoom' && event.button === 0) onView(zoomAt(current, current.scale * (event.altKey ? 0.5 : 2), point.x, point.y));
  }, [tool, spaceHeld, onView]);

  const pointerMove = useCallback((event: React.PointerEvent) => {
    const point = local(event);
    const current = viewRef.current;
    if (current) { const image = toImage(current, point.x, point.y); onCursor(image.x >= 0 && image.y >= 0 && image.x < doc.width && image.y < doc.height ? { x: Math.floor(image.x), y: Math.floor(image.y) } : null); }
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, point);
    const g = gesture.current;
    if (g?.kind === 'pan') onView({ ...g.view, x: g.view.x + point.x - g.x, y: g.view.y + point.y - g.y });
    else if (g?.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const zoomed = zoomAt(g.view, g.view.scale * (Math.hypot(b.x - a.x, b.y - a.y) / g.distance), g.mid.x, g.mid.y);
      onView({ ...zoomed, x: zoomed.x + mid.x - g.mid.x, y: zoomed.y + mid.y - g.mid.y });
    }
  }, [doc.width, doc.height, onView, onCursor]);

  const pointerUp = useCallback((event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 1 && gesture.current?.kind === 'pinch') { const [p] = [...pointers.current.values()]; gesture.current = { kind: 'pan', x: p.x, y: p.y, view: viewRef.current! }; return; }
    if (!pointers.current.size) { gesture.current = null; setPanning(false); }
  }, []);

  const cursor = panning ? 'grabbing' : tool === 'hand' || spaceHeld ? 'grab' : tool === 'zoom' ? 'zoom-in' : 'default';
  return <div ref={host} className="stage" style={{ cursor }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onPointerLeave={() => onCursor(null)}
    onDoubleClick={() => { if (tool === 'hand') onView(centered(doc.width, doc.height, size.width, size.height, fitScale(doc.width, doc.height, size.width, size.height))); }}>
    <canvas ref={canvas} aria-label="キャンバス" role="img"/>
  </div>;
}
