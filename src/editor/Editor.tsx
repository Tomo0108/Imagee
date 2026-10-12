import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ArrowLeft, Check, Download, FlipHorizontal2, FlipVertical2, History as HistoryIcon, Info, Layers, Maximize, Minus, Plus, Redo2, RotateCcw, RotateCw, Settings2, SlidersHorizontal, Undo2, SplitSquareHorizontal } from 'lucide-react';
import type { Project } from '../store';
import { writePixels } from '../store';
import { decode, histogram, thumbnail, toBlob, canvas as makeCanvas } from '../imaging';
import type { Preferences } from '../lib/preferences.mjs';
import { centered, fitScale, formatZoom, stepZoom, zoomAt, type View } from '../lib/viewport.mjs';
import { commit, createHistory, jump, redo, undo, type History } from '../lib/history.mjs';
import { autoAdjust, NEUTRAL, type Adjustments } from '../lib/adjust.mjs';
import { ASPECTS, autoCrop, fitAspect, flip, IDENTITY, MAX_ANGLE, orientedSize, outputSize, rotateQuarter, type Rect } from '../lib/geometry.mjs';
import { floodMask } from '../lib/flood.mjs';
import { effectivePressure } from '../lib/brush.mjs';
import { compositeInto, drawGeometry, FONTS, LayerCache, maskKey, newLayerId, renderShape, savedEdits, uniqueName, workCanvas, type Doc, type Layer, type RasterLayer, type ShapeLayer, type TextLayer, type AdjustLayer } from './document';
import { PixelStore, union, type Box } from './pixels';
import { arrayMask, combine, invertSelection, refineSelection, selectAll, shapeMask, type Refine, type SelectMode, type Selection } from './selection';
import { bucketFill, editSurface, gradientFill, healSurface, HealMask, hexToRgb, rgbToHex, Stroke, type CloneSource } from './tools';
import { Adjuster } from './gl';
import { createMask, loadDoc } from './load';
import { contentSize, Stage, type Tool, type ToolPhase, type ToolPointer } from './Stage';
import { ExportSheet } from './ExportSheet';
import { AdjustPanel, HistoryPanel, InfoPanel, LayersPanel, type LayerActions } from './panels';
import { loadSettings, storeSettings, ToolOptions, ToolRail, type ToolSettings } from './toolbar';
import { pickFile, pickImages, saveBlob } from '../platform';
import { NEUTRAL_COLOR, parseCube, type ColorOps } from '../lib/color.mjs';
import { addLut, readLuts, removeLut } from '../store';
import { loadUserPresets, storeUserPresets, type UserPreset } from './color-ui';
import type { Histogram } from '../imaging';
import { exportName, isImageFile } from '../lib/files.mjs';
import { IconButton, Slider, mod } from '../ui';

type Tab = 'adjust' | 'layers' | 'history' | 'info';
type Point = { x: number; y: number };
interface Props { project: Project; prefs: Preferences; onClose: () => void; onUpdate: (project: Project) => void; onToast: (message: string) => void; onSettings: () => void }
/** A pointer action in progress on the canvas. */
type Action =
  | { kind: 'stroke'; stroke: Stroke; layerId: string; mask: boolean; label: string }
  | { kind: 'select'; shape: 'rect' | 'ellipse'; start: Point; end: Point; mode: SelectMode; square: boolean }
  | { kind: 'lasso'; points: Point[]; mode: SelectMode }
  | { kind: 'gradient'; start: Point; end: Point }
  | { kind: 'shape'; start: Point; end: Point; constrain: boolean }
  | { kind: 'move'; id: string; start: Point; origin: Point }
  | { kind: 'heal'; mask: HealMask; key: string; layerId: string };
/** Where painting lands: a raster layer or a layer mask, with its position in the document. */
interface Surface { key: string; layer: Layer; mask: boolean; offset: Point }

const box = (a: Point, b: Point, square = false): Box => {
  let w = b.x - a.x, h = b.y - a.y;
  if (square) { const side = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * side; h = Math.sign(h || 1) * side; }
  return { x: Math.min(a.x, a.x + w), y: Math.min(a.y, a.y + h), w: Math.abs(w), h: Math.abs(h) };
};
/** Snaps a line to 45° steps (Shift). */
const snapLine = (a: Point, b: Point): Point => {
  const angle = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4)) * (Math.PI / 4), length = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: a.x + Math.cos(angle) * length, y: a.y + Math.sin(angle) * length };
};
const BRUSHES: Tool[] = ['brush', 'eraser', 'heal', 'clone'];
const luminance = (hex: string) => { const [r, g, b] = hexToRgb(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const clearColor = (hex: string) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},0)`; };

export function Editor({ project, prefs, onClose, onUpdate, onToast, onSettings }: Props) {
  const [history, setHistory] = useState<History<Doc> | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [tool, setToolState] = useState<Tool>('hand');
  const [space, setSpace] = useState(false);
  const [before, setBefore] = useState(false);
  const [tab, setTab] = useState<Tab>('layers');
  const [aspectId, setAspectId] = useState('free');
  const [cursor, setCursor] = useState<Point | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [overlayVersion, bumpOverlay] = useReducer((n: number) => n + 1, 0);
  const [settings, setSettingsState] = useState<ToolSettings>(loadSettings);
  const [colors, setColors] = useState<[string, string]>(['#000000', '#ffffff']);
  const [selection, setSelectionState] = useState<Selection | null>(null);
  const [target, setTarget] = useState<'layer' | 'mask'>('layer');
  const [editImage, setEditImage] = useState(false);
  const [cubes, setCubes] = useState<{ id: string; name: string }[]>([]);
  const [cubesVersion, setCubesVersion] = useState(0);
  const [userPresets, setUserPresets] = useState<UserPreset[]>(loadUserPresets);
  const [curveHistogram, setCurveHistogram] = useState<Histogram | null>(null);
  const [editText, setEditText] = useState(false);
  const adjuster = useMemo(() => new Adjuster(), []);
  const store = useMemo(() => new PixelStore(), []);
  const cache = useMemo(() => new LayerCache(), []);
  const work = useRef<HTMLCanvasElement | null>(null);
  const historyRef = useRef<History<Doc> | null>(null);
  const selectionRef = useRef<Selection | null>(null);
  const action = useRef<Action | null>(null);
  const hover = useRef<ToolPointer | null>(null);
  const merging = useRef<string | null>(null);
  const composited = useRef<Layer[] | null>(null);
  const cloneSource = useRef<Point | null>(null), cloneOffset = useRef<Point | null>(null);
  const clipboard = useRef<{ canvas: HTMLCanvasElement; bounds: Box } | null>(null);
  /** Size of the PNG we last put on the system clipboard, so pasting it back lands in place. */
  const clipboardStamp = useRef(0);
  const projectRef = useRef(project); projectRef.current = project;

  const apply = useCallback((next: History<Doc>) => { historyRef.current = next; setHistory(next); }, []);
  const setSelection = useCallback((next: Selection | null) => { selectionRef.current = next; setSelectionState(next); }, []);
  const setSettings = useCallback((patch: Partial<ToolSettings>) => setSettingsState(current => { const next = { ...current, ...patch }; storeSettings(next); return next; }), []);

  // Open: decode the original, then restore painted surfaces from storage. Revisions are renumbered for this session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const doc = await loadDoc(project, store, () => cancelled);
      if (!doc) return;
      work.current = workCanvas(doc, adjuster.maxSize);
      apply(createHistory<Doc>(doc));
    })().catch(e => !cancelled && setError(e.message));
    return () => { cancelled = true; };
    // Only reload when a different image is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const doc = history?.present;
  // Layers → composite at working size → adjustments. Surfaces follow the revisions the document points at,
  // so undo and redo of painting are just changes of the document.
  useEffect(() => {
    if (!doc || !work.current || composited.current === doc.layers) return;
    for (const layer of doc.layers) {
      if (layer.kind === 'raster') store.sync(layer.id, layer.rev);
      if (layer.mask) store.sync(maskKey(layer.id), layer.mask.rev);
    }
    compositeInto(work.current, doc, store, cache);
    adjuster.setSource(work.current);
    adjuster.setLut(cache.lut('', null, doc.color));
    adjuster.render(doc.adjust);
    composited.current = doc.layers;
    setVersion(v => v + 1);
  }, [doc?.layers, cubesVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!doc || !composited.current) return;
    adjuster.setLut(cache.lut('', null, doc.color));
    adjuster.render(doc.adjust);
    setVersion(v => v + 1);
  }, [doc?.adjust, doc?.color, cubesVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // While painting, only the touched area is recomposited, once per frame.
  const frame = useRef(0), pending = useRef<Box | null>(null);
  const refresh = useCallback((area: Box | null) => {
    if (!area) return;
    pending.current = union(pending.current, area);
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const region = pending.current, d = historyRef.current?.present, target = work.current;
      pending.current = null;
      if (!region || !d || !target) return;
      compositeInto(target, d, store, cache, region);
      const k = target.width / d.width;
      adjuster.updateRegion(target, { x: region.x * k - 2, y: region.y * k - 2, w: region.w * k + 4, h: region.h * k + 4 });
      adjuster.render(d.adjust);
      setVersion(v => v + 1);
    });
  }, [adjuster, store, cache]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // Autosave: edits as JSON with the project, painted surfaces as PNG in their own store.
  const edits = useMemo(() => doc && savedEdits(doc), [doc?.layers, doc?.adjust, doc?.geometry, doc?.selected]); // eslint-disable-line react-hooks/exhaustive-deps
  const firstEdits = useRef(true);
  useEffect(() => {
    if (!edits) return;
    if (firstEdits.current) { firstEdits.current = false; return; }
    const timer = setTimeout(() => onUpdate({ ...projectRef.current, edits, edited: Date.now() }), 400);
    return () => clearTimeout(timer);
  }, [edits, onUpdate]);
  const saving = useRef(Promise.resolve());
  const savedKeys = useRef('');
  const savePixels = useCallback(() => {
    const d = historyRef.current?.present;
    if (!d) return saving.current;
    const keys: [string, number][] = [];
    for (const layer of d.layers) {
      if (layer.kind === 'raster') keys.push([layer.id, layer.rev]);
      if (layer.mask) keys.push([maskKey(layer.id), layer.mask.rev]);
    }
    const changed = keys.filter(([key, rev]) => store.saved.get(key) !== rev && store.rev(key) === rev);
    const keep = keys.map(([key]) => key).sort().join('\n');
    if (!changed.length && keep === savedKeys.current) return saving.current;
    saving.current = saving.current.then(async () => {
      const blobs = new Map<string, Blob>();
      for (const [key] of changed) blobs.set(key, await toBlob(store.get(key)!, 'image/png'));
      await writePixels(projectRef.current.id, blobs, new Set(keys.map(([key]) => key)));
      for (const [key, rev] of changed) store.saved.set(key, rev);
      savedKeys.current = keep;
    }).catch(() => onToast('描画内容を保存できませんでした。空き容量を確認してください。'));
    return saving.current;
  }, [store, onToast]);
  /** Saves the document with its layers: as a PSD, or as an Imagee project file. */
  const saveProject = useCallback(async (kind: 'psd' | 'imagee') => {
    const d = historyRef.current?.present;
    if (!d) return;
    try {
      const io = await import('../io/projects');
      let blob: Blob;
      if (kind === 'psd') blob = await io.exportPsd(d, store, cache, adjuster.canvas);
      else { await savePixels(); blob = await io.exportStoredProject({ ...projectRef.current, edits: savedEdits(d) }); }
      const saved = await saveBlob(blob, exportName(projectRef.current.name, kind), kind, kind === 'psd' ? 'Photoshop ドキュメント' : 'Imagee プロジェクト');
      if (saved) onToast(`「${saved}」を保存しました。`);
    } catch (e) { onToast((e as Error).message || '保存できませんでした。'); }
  }, [store, cache, adjuster, savePixels, onToast]);
  useEffect(() => {
    if (!doc) return;
    const timer = setTimeout(savePixels, 1000);
    return () => clearTimeout(timer);
  }, [doc?.layers, savePixels]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = useCallback((recipe: (doc: Doc) => Doc, label: string, gesture = false) => {
    const h = historyRef.current;
    if (!h) return null;
    const next = recipe(h.present);
    apply(commit(h, next, label, gesture && merging.current === label));
    merging.current = gesture ? label : null;
    return next;
  }, [apply]);
  const endGesture = useCallback(() => { merging.current = null; }, []);
  const updateLayer = useCallback((id: string, patch: Partial<Layer>, label: string, gesture = false) =>
    change(d => ({ ...d, layers: d.layers.map(layer => layer.id === id ? { ...layer, ...patch } as Layer : layer) }), label, gesture), [change]);
  const setAdjust = useCallback((patch: Partial<Adjustments>, label: string, gesture = false) => change(d => ({ ...d, adjust: { ...d.adjust, ...patch } }), label, gesture), [change]);
  /** Choosing a layer is not an edit, so it changes the present state without a history step. */
  const selectLayer = useCallback((id: string) => {
    const h = historyRef.current;
    if (h && h.present.selected !== id) apply({ ...h, present: { ...h.present, selected: id } });
    setEditText(false); setEditImage(false);
  }, [apply]);
  /** Records that a surface reached a new revision. When the working composite already shows it, skip recompositing. */
  const commitSurface = useCallback((layerId: string, mask: boolean, rev: number, label: string, current: boolean) => {
    const next = change(d => ({ ...d, layers: d.layers.map(layer => layer.id !== layerId ? layer : mask ? { ...layer, mask: { ...layer.mask!, rev } } : { ...layer, rev } as Layer) }), label);
    if (next && current) composited.current = next.layers;
  }, [change]);
  const insertLayer = useCallback((layer: Layer, label: string) => change(d => {
    const index = d.layers.findIndex(l => l.id === d.selected);
    const layers = [...d.layers];
    layers.splice(index + 1, 0, layer);
    return { ...d, layers, selected: layer.id };
  }, label), [change]);
  const newRaster = useCallback((d: Doc, name = uniqueName(d.layers, 'レイヤー'), source?: (context: CanvasRenderingContext2D) => void): RasterLayer => {
    const id = newLayerId();
    store.create(id, d.width, d.height);
    if (source) source(store.context(id));
    return { kind: 'raster', id, name, visible: true, opacity: 100, blend: 'source-over', x: 0, y: 0, rev: store.rev(id)! };
  }, [store]);

  const setTool = useCallback((next: Tool) => {
    action.current = null;
    setToolState(current => { if ((current === 'crop') !== (next === 'crop')) setView(null); return next; });
  }, []);
  const fit = useCallback(() => {
    if (!doc || !viewport.width) return;
    const size = contentSize(doc, tool);
    setView(centered(size.width, size.height, viewport.width, viewport.height, fitScale(size.width, size.height, viewport.width, viewport.height, tool === 'crop' ? 72 : 48)));
  }, [doc, viewport, tool]);
  const zoomTo = useCallback((scale: number) => { if (view) setView(zoomAt(view, scale, viewport.width / 2, viewport.height / 2)); }, [view, viewport]);

  // Refit when the output size changes (crop, rotation) so the result is always framed.
  const output = doc ? outputSize(doc.geometry, doc.width, doc.height) : null;
  useEffect(() => { if (tool !== 'crop') setView(null); }, [output?.width, output?.height]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = doc ? doc.layers.find(layer => layer.id === doc.selected) || doc.layers[doc.layers.length - 1] : null;
  useEffect(() => { if (selected && !selected.mask && target === 'mask') setTarget('layer'); }, [selected, target]);

  /** The surface painting tools work on. Painting on a text or shape layer starts a new layer above it. */
  const surfaceFor = useCallback((paints: boolean, vectorMessage = 'テキストや図形のレイヤーは、ラスタライズすると消去できます。'): Surface | null => {
    const d = historyRef.current?.present;
    const layer = d?.layers.find(l => l.id === d.selected);
    if (!d || !layer) return null;
    if (!layer.visible) { onToast('非表示のレイヤーには描けません。'); return null; }
    if ((target === 'mask' || layer.kind === 'adjust') && layer.mask) return { key: maskKey(layer.id), layer, mask: true, offset: { x: 0, y: 0 } };
    if (layer.kind === 'adjust') { onToast('調整レイヤーに描くにはマスクを追加してください。'); return null; }
    if (layer.kind === 'raster') return { key: layer.id, layer, mask: false, offset: { x: layer.x, y: layer.y } };
    if (!paints) { onToast(vectorMessage); return null; }
    const created = newRaster(d);
    insertLayer(created, '新規レイヤー');
    return { key: created.id, layer: created, mask: false, offset: { x: 0, y: 0 } };
  }, [target, newRaster, insertLayer, onToast]);

  const sample = useCallback((p: Point) => {
    const d = historyRef.current?.present, source = work.current;
    if (!d || !source) return null;
    const k = source.width / d.width;
    const x = Math.floor(p.x * k), y = Math.floor(p.y * k);
    if (x < 0 || y < 0 || x >= source.width || y >= source.height) return null;
    const [r, g, b, a] = source.getContext('2d')!.getImageData(x, y, 1, 1).data;
    return a ? rgbToHex(r, g, b) : null;
  }, []);
  const pickColor = useCallback((p: ToolPointer) => {
    const color = sample(p);
    if (color) setColors(current => p.alt ? [current[0], color] : [color, current[1]]);
  }, [sample]);

  const begin = useCallback((p: ToolPointer, d: Doc) => {
    const mode: SelectMode = p.shift ? 'add' : p.alt ? 'subtract' : settings.selectMode;
    const layer = d.layers.find(l => l.id === d.selected)!;
    switch (tool) {
      case 'move': action.current = { kind: 'move', id: layer.id, start: p, origin: { x: layer.x, y: layer.y } }; break;
      case 'marquee': case 'ellipse': action.current = { kind: 'select', shape: tool === 'marquee' ? 'rect' : 'ellipse', start: p, end: p, mode, square: false }; break;
      case 'lasso': action.current = { kind: 'lasso', points: [p], mode }; break;
      case 'wand': {
        const source = work.current!;
        const k = source.width / d.width;
        const data = source.getContext('2d')!.getImageData(0, 0, source.width, source.height);
        const values = floodMask(data.data, source.width, source.height, p.x * k, p.y * k, settings.tolerance, settings.contiguous);
        setSelection(combine(selectionRef.current, arrayMask(values, source.width, source.height, d.width, d.height), mode));
        break;
      }
      case 'eyedropper': pickColor(p); break;
      case 'brush': case 'eraser': {
        if (tool === 'brush' && p.alt) { pickColor({ ...p, alt: false }); break; }
        const surface = surfaceFor(tool === 'brush');
        if (!surface) break;
        const color = tool === 'brush' ? colors[0] : colors[1];
        const effect = surface.mask ? (luminance(color) < 128 ? 'hide' : 'reveal') : tool === 'brush' ? 'paint' : 'erase';
        const stroke = new Stroke(store, surface.key, settings[tool], color, effect, surface.offset, selectionRef.current);
        action.current = { kind: 'stroke', stroke, layerId: surface.layer.id, mask: surface.mask, label: surface.mask ? 'マスクを編集' : tool === 'brush' ? 'ブラシ' : '消しゴム' };
        refresh(stroke.add({ x: p.x, y: p.y, pressure: effectivePressure(p.pressure, p.pointerType) }));
        break;
      }
      case 'clone': {
        if (p.alt) { cloneSource.current = { x: p.x, y: p.y }; cloneOffset.current = null; break; }
        if (!cloneSource.current) { onToast('Alt（Option）キーを押しながらクリックして、コピー元を指定してください。'); break; }
        const surface = surfaceFor(true);
        if (!surface) break;
        if (surface.mask) { onToast('マスクにはコピースタンプを使えません。'); break; }
        // Aligned: the offset chosen by the first stroke stays until a new source is picked.
        const co = cloneOffset.current ??= { x: cloneSource.current.x - p.x, y: cloneSource.current.y - p.y };
        let source: CloneSource = { image: 'original', x: -co.x, y: -co.y };
        if (settings.cloneAll) {
          const full = makeCanvas(d.width, d.height);
          compositeInto(full, historyRef.current!.present, store, cache);
          source = { image: full, x: -(surface.offset.x + co.x), y: -(surface.offset.y + co.y) };
        }
        const stroke = new Stroke(store, surface.key, settings.clone, '#000', 'clone', surface.offset, selectionRef.current, source);
        action.current = { kind: 'stroke', stroke, layerId: surface.layer.id, mask: false, label: 'コピースタンプ' };
        refresh(stroke.add({ x: p.x, y: p.y, pressure: 1 }));
        break;
      }
      case 'heal': {
        const surface = surfaceFor(false, 'テキストや図形のレイヤーは、ラスタライズすると修復できます。');
        if (!surface) break;
        if (surface.mask) { onToast('マスクには修復ブラシを使えません。'); break; }
        const target = store.get(surface.key)!;
        const mask = new HealMask(target.width, target.height, settings.heal.size, settings.heal.hardness, surface.offset);
        mask.add({ x: p.x, y: p.y, pressure: 1 });
        action.current = { kind: 'heal', mask, key: surface.key, layerId: surface.layer.id };
        break;
      }
      case 'fill': {
        const surface = surfaceFor(true);
        if (!surface) break;
        if (surface.mask) { onToast('マスクにはブラシかグラデーションを使ってください。'); break; }
        const changed = bucketFill(store, surface.key, p, colors[0], settings.fillOpacity, settings.tolerance, settings.contiguous, surface.offset, selectionRef.current);
        if (changed) commitSurface(surface.layer.id, false, store.rev(surface.key)!, '塗りつぶし', false);
        break;
      }
      case 'gradient': action.current = { kind: 'gradient', start: p, end: p }; break;
      case 'shape': action.current = { kind: 'shape', start: p, end: p, constrain: false }; break;
      case 'text': {
        const hit = [...d.layers].reverse().find(l => {
          const b = l.kind === 'text' && l.visible ? cache.bounds(l, store) : null;
          return b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
        });
        if (hit) { selectLayer(hit.id); setEditText(true); setTab('layers'); break; }
        const size = Math.max(12, Math.round(Math.min(d.width, d.height) / 12));
        const text: TextLayer = { kind: 'text', id: newLayerId(), name: uniqueName(d.layers, 'テキスト'), visible: true, opacity: 100, blend: 'source-over', x: Math.round(p.x), y: Math.round(p.y - size * 0.65),
          text: { content: 'テキスト', font: FONTS[0].value, size, weight: 700, italic: false, color: colors[0], align: 'left', vertical: false, lineHeight: 1.3 } };
        insertLayer(text, 'テキストを追加');
        setEditText(true); setTab('layers');
        break;
      }
    }
    bumpOverlay();
  }, [tool, settings, colors, store, cache, surfaceFor, pickColor, refresh, commitSurface, insertLayer, selectLayer, setSelection, onToast]);

  const move = useCallback((p: ToolPointer) => {
    const a = action.current;
    if (!a) return;
    if (a.kind === 'stroke') refresh(a.stroke.add({ x: p.x, y: p.y, pressure: effectivePressure(p.pressure, p.pointerType) }));
    else if (a.kind === 'heal') a.mask.add({ x: p.x, y: p.y, pressure: 1 });
    else if (a.kind === 'select') { a.end = p; a.square = p.shift && a.mode !== 'add'; }
    else if (a.kind === 'lasso') { const last = a.points[a.points.length - 1]; if (Math.hypot(p.x - last.x, p.y - last.y) > 1) a.points.push(p); }
    else if (a.kind === 'gradient') a.end = p.shift ? snapLine(a.start, p) : p;
    else if (a.kind === 'shape') { a.end = p; a.constrain = p.shift; }
    else if (a.kind === 'move') updateLayer(a.id, { x: Math.round(a.origin.x + p.x - a.start.x), y: Math.round(a.origin.y + p.y - a.start.y) }, '移動', true);
    bumpOverlay();
  }, [refresh, updateLayer]);

  const finish = useCallback(() => {
    const a = action.current, d = historyRef.current?.present;
    action.current = null;
    if (!a || !d) return;
    if (a.kind === 'stroke') {
      cancelAnimationFrame(frame.current); frame.current = 0;
      const area = pending.current;
      pending.current = null;
      const rev = a.stroke.end();
      if (rev === null) return;
      // Finish the last frame's region before marking the composite current.
      if (area && work.current) {
        compositeInto(work.current, d, store, cache, area);
        const k = work.current.width / d.width;
        adjuster.updateRegion(work.current, { x: area.x * k - 2, y: area.y * k - 2, w: area.w * k + 4, h: area.h * k + 4 });
        adjuster.render(d.adjust);
      }
      commitSurface(a.layerId, a.mask, rev, a.label, true);
      setVersion(v => v + 1);
    } else if (a.kind === 'select') {
      const area = box(a.start, a.end, a.square);
      if (area.w < 2 && area.h < 2) { if (a.mode === 'new') setSelection(null); }
      else setSelection(combine(selectionRef.current, shapeMask(d.width, d.height, { kind: a.shape, box: area }), a.mode));
    } else if (a.kind === 'lasso') {
      if (a.points.length > 2) setSelection(combine(selectionRef.current, shapeMask(d.width, d.height, { kind: 'lasso', points: a.points }), a.mode));
      else if (a.mode === 'new') setSelection(null);
    } else if (a.kind === 'gradient') {
      if (Math.hypot(a.end.x - a.start.x, a.end.y - a.start.y) < 2) return;
      const surface = surfaceFor(true);
      if (!surface) return;
      if (surface.mask) {
        const g = (context: CanvasRenderingContext2D) => {
          const gradient = settings.gradient === 'linear' ? context.createLinearGradient(a.start.x, a.start.y, a.end.x, a.end.y) : context.createRadialGradient(a.start.x, a.start.y, 0, a.start.x, a.start.y, Math.hypot(a.end.x - a.start.x, a.end.y - a.start.y));
          gradient.addColorStop(0, `rgba(255,255,255,${luminance(colors[0]) / 255})`);
          gradient.addColorStop(1, `rgba(255,255,255,${settings.gradientToTransparent ? 0 : luminance(colors[1]) / 255})`);
          context.globalCompositeOperation = 'copy'; context.fillStyle = gradient; context.fillRect(0, 0, d.width, d.height);
        };
        const rev = editSurface(store, surface.key, { x: 0, y: 0, w: d.width, h: d.height }, g);
        if (rev !== null) commitSurface(surface.layer.id, true, rev, 'マスクのグラデーション', false);
      } else {
        const changed = gradientFill(store, surface.key, a.start, a.end, settings.gradient, [colors[0], settings.gradientToTransparent ? clearColor(colors[0]) : colors[1]], settings.fillOpacity, surface.offset, selectionRef.current);
        if (changed) commitSurface(surface.layer.id, false, store.rev(surface.key)!, 'グラデーション', false);
      }
    } else if (a.kind === 'shape') {
      let start = a.start, end = a.constrain ? (settings.shape === 'line' ? snapLine(a.start, a.end) : a.end) : a.end;
      if (Math.hypot(end.x - start.x, end.y - start.y) < 3) {
        // A click makes a shape of a sensible default size centred on the point.
        const side = Math.round(Math.min(d.width, d.height) / 4);
        start = { x: a.start.x - side / 2, y: a.start.y - (settings.shape === 'line' ? 0 : side / 2) };
        end = { x: a.start.x + side / 2, y: a.start.y + (settings.shape === 'line' ? 0 : side / 2) };
      }
      const line = settings.shape === 'line';
      const area = box(start, end, a.constrain && !line);
      const fill = !line && (settings.shapeFill || !settings.shapeStroke) ? colors[0] : null;
      const shape: ShapeLayer = {
        kind: 'shape', id: newLayerId(), name: uniqueName(d.layers, '図形'), visible: true, opacity: 100, blend: 'source-over',
        x: Math.round(line ? start.x : area.x), y: Math.round(line ? start.y : area.y),
        shape: { type: settings.shape, w: Math.round(line ? end.x - start.x : area.w), h: Math.round(line ? end.y - start.y : area.h), fill, stroke: line ? colors[0] : settings.shapeStroke ? (fill ? colors[1] : colors[0]) : null, strokeWidth: settings.strokeWidth, radius: settings.radius },
      };
      insertLayer(shape, '図形を追加');
    } else if (a.kind === 'heal') {
      const rev = healSurface(store, a.key, a.mask);
      if (rev !== null) commitSurface(a.layerId, false, rev, 'スポット修復', false);
    } else if (a.kind === 'move') endGesture();
    bumpOverlay();
  }, [store, cache, adjuster, settings, colors, surfaceFor, commitSurface, insertLayer, setSelection, endGesture]);

  const onTool = useCallback((phase: ToolPhase, p: ToolPointer | null) => {
    const d = historyRef.current?.present;
    if (!d) return;
    if (phase === 'hover') { hover.current = p; if (BRUSHES.includes(tool)) bumpOverlay(); return; }
    if (phase === 'up') { if (p) move(p); finish(); return; }
    if (!p) return;
    hover.current = p;
    if (phase === 'down') begin(p, d); else move(p);
  }, [tool, begin, move, finish]);

  /** Selection outline, previews of the action in progress and the brush cursor, in document pixels. */
  const overlay = useCallback((c: CanvasRenderingContext2D, px: number) => {
    const d = historyRef.current?.present;
    if (!d) return;
    const dashed = (path: () => void) => {
      c.save(); c.lineWidth = px; c.setLineDash([4 * px, 4 * px]);
      c.beginPath(); path(); c.strokeStyle = '#000'; c.stroke();
      c.lineDashOffset = 4 * px; c.strokeStyle = '#fff'; c.stroke(); c.restore();
    };
    const sel = selectionRef.current;
    if (sel) { c.save(); c.imageSmoothingEnabled = sel.edges.width > d.width / px; c.drawImage(sel.edges, 0, 0, d.width, d.height); c.restore(); }
    const layer = d.layers.find(l => l.id === d.selected);
    if (layer && (tool === 'move' || (tool === 'text' && layer.kind === 'text'))) {
      const b = cache.bounds(layer, store);
      if (b) dashed(() => c.rect(b.x, b.y, b.w, b.h));
    }
    const a = action.current;
    if (a?.kind === 'select') { const b = box(a.start, a.end, a.square); dashed(() => a.shape === 'rect' ? c.rect(b.x, b.y, b.w, b.h) : c.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2)); }
    else if (a?.kind === 'lasso') dashed(() => a.points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    else if (a?.kind === 'gradient') {
      dashed(() => { c.moveTo(a.start.x, a.start.y); c.lineTo(a.end.x, a.end.y); });
      c.save(); c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = px;
      for (const p of [a.start, a.end]) { c.beginPath(); c.arc(p.x, p.y, 4 * px, 0, Math.PI * 2); c.fill(); c.stroke(); }
      c.restore();
    } else if (a?.kind === 'shape') {
      const line = settings.shape === 'line', end = a.constrain && line ? snapLine(a.start, a.end) : a.end;
      const area = box(a.start, end, a.constrain && !line);
      const r = renderShape({ type: settings.shape, w: line ? end.x - a.start.x : area.w, h: line ? end.y - a.start.y : area.h, fill: !line && (settings.shapeFill || !settings.shapeStroke) ? colors[0] : null, stroke: line || settings.shapeStroke ? (line || !settings.shapeFill ? colors[0] : colors[1]) : null, strokeWidth: settings.strokeWidth, radius: settings.radius });
      c.save(); c.globalAlpha = 0.85; c.drawImage(r.canvas, (line ? a.start.x : area.x) - r.ox, (line ? a.start.y : area.y) - r.oy); c.restore();
    }
    const h = hover.current;
    if (a?.kind === 'heal') { c.save(); c.globalAlpha = 0.5; c.drawImage(a.mask.canvas, a.mask.offset.x, a.mask.offset.y); c.restore(); }
    const src = cloneSource.current;
    if (tool === 'clone' && src) {
      // Where the clone stamp copies from: the picked point, or the hover point plus the aligned offset.
      const at = h && cloneOffset.current ? { x: h.x + cloneOffset.current.x, y: h.y + cloneOffset.current.y } : src;
      const r = settings.clone.size / 2;
      c.save(); c.lineWidth = px; c.strokeStyle = '#fff'; c.setLineDash([3 * px, 3 * px]);
      c.beginPath(); c.arc(at.x, at.y, r, 0, Math.PI * 2); c.moveTo(at.x - 6 * px, at.y); c.lineTo(at.x + 6 * px, at.y); c.moveTo(at.x, at.y - 6 * px); c.lineTo(at.x, at.y + 6 * px); c.stroke(); c.restore();
    }
    if (h && (tool === 'brush' || tool === 'eraser' || tool === 'heal' || tool === 'clone')) {
      const options = settings[tool];
      const radius = Math.max(options.size / 2, 2 * px);
      c.save(); c.beginPath(); c.arc(h.x, h.y, radius, 0, Math.PI * 2);
      c.lineWidth = 3 * px; c.strokeStyle = 'rgba(0,0,0,.55)'; c.stroke();
      c.lineWidth = px; c.strokeStyle = '#fff'; c.stroke(); c.restore();
    }
  }, [tool, settings, colors, cache, store]);

  const aspectRatio = useCallback((id: string) => {
    if (!doc) return 0;
    const ratio = ASPECTS.find(a => a.id === id)?.ratio ?? 0;
    if (ratio !== -1) return ratio;
    const frame = orientedSize(doc.width, doc.height, doc.geometry.quarter);
    return frame.width / frame.height;
  }, [doc]);
  const onCrop = useCallback((crop: Rect) => change(d => ({ ...d, geometry: { ...d.geometry, crop } }), '切り抜き'), [change]);
  const chooseAspect = (id: string) => {
    setAspectId(id);
    const ratio = aspectRatio(id);
    if (!doc || !ratio) return;
    const frame = orientedSize(doc.width, doc.height, doc.geometry.quarter);
    const around = doc.geometry.crop || autoCrop(frame.width, frame.height, doc.geometry.angle);
    change(d => ({ ...d, geometry: { ...d.geometry, crop: fitAspect(around, ratio, frame) } }), '切り抜きの比率');
  };
  const straighten = (angle: number) => change(d => {
    const frame = orientedSize(d.width, d.height, d.geometry.quarter);
    const ratio = aspectRatio(aspectId);
    const auto = autoCrop(frame.width, frame.height, angle);
    // Keep the chosen ratio inside the area the rotation leaves free of empty corners.
    const inner = ratio > 0 && aspectId !== 'original' ? fitAspect({ x: 0, y: 0, w: auto.w, h: auto.h }, ratio, { width: auto.w, height: auto.h }) : null;
    return { ...d, geometry: { ...d.geometry, angle, crop: inner && { ...inner, x: inner.x + auto.x, y: inner.y + auto.y } } };
  }, '角度補正', true);
  // The adjust panel edits the selected adjustment layer, or the whole image.
  const adjustLayer = selected?.kind === 'adjust' && !editImage ? selected : null;
  const adjustTarget = adjustLayer ? { basic: adjustLayer.basic, color: adjustLayer.color } : doc ? { basic: doc.adjust, color: doc.color } : null;
  const setBasic = useCallback((patch: Partial<Adjustments>, label: string, gesture = false) => {
    if (adjustLayer) updateLayer(adjustLayer.id, { basic: { ...adjustLayer.basic, ...patch } } as Partial<Layer>, label, gesture);
    else setAdjust(patch, label, gesture);
  }, [adjustLayer, updateLayer, setAdjust]);
  const setColor = useCallback((color: ColorOps, label: string, gesture = false) => {
    if (adjustLayer) updateLayer(adjustLayer.id, { color } as Partial<Layer>, label, gesture);
    else change(d => ({ ...d, color }), label, gesture);
  }, [adjustLayer, updateLayer, change]);
  const setAdjustState = useCallback((state: { basic: Adjustments; color: ColorOps }, label: string) => {
    if (adjustLayer) updateLayer(adjustLayer.id, { basic: { ...state.basic, vignette: 0 }, color: state.color } as Partial<Layer>, label);
    else change(d => ({ ...d, adjust: state.basic, color: state.color }), label);
  }, [adjustLayer, updateLayer, change]);
  const auto = () => {
    if (!work.current || !adjustTarget) return;
    const suggestion = autoAdjust(histogram(work.current).l);
    const b = adjustTarget.basic;
    setBasic({ ...NEUTRAL, ...suggestion, temperature: b.temperature, tint: b.tint, vibrance: b.vibrance, saturation: b.saturation, vignette: b.vignette }, '自動補正');
    onToast('明るさを自動で整えました。');
  };
  useEffect(() => {
    if (tab !== 'adjust' || !work.current) return;
    const timer = setTimeout(() => work.current && setCurveHistogram(histogram(work.current)), 250);
    return () => clearTimeout(timer);
  }, [tab, version]);
  // Text drawn before its font finished loading is redrawn once it has.
  useEffect(() => {
    const done = () => { cache.invalidate(); composited.current = null; setCubesVersion(v => v + 1); };
    document.fonts.addEventListener('loadingdone', done);
    return () => document.fonts.removeEventListener('loadingdone', done);
  }, [cache]);
  // Imported LUTs are shared by every project.
  useEffect(() => {
    void readLuts().then(list => {
      for (const lut of list) cache.cubes.set(lut.id, { size: lut.size, data: lut.data, title: lut.name });
      setCubes(list.map(lut => ({ id: lut.id, name: lut.name })));
      if (list.length) { composited.current = null; setCubesVersion(v => v + 1); }
    }).catch(() => {});
  }, [cache]);
  const importLut = useCallback(async () => {
    const file = await pickFile('.cube');
    if (!file) return;
    try {
      const cube = parseCube(await file.text());
      const lut = { id: `lut-${Date.now().toString(36)}`, name: cube.title || file.name.replace(/\.cube$/i, ''), size: cube.size, data: cube.data };
      await addLut(lut);
      cache.cubes.set(lut.id, cube);
      setCubes(list => [...list, { id: lut.id, name: lut.name }]);
      setCubesVersion(v => v + 1);
      setColor({ ...(adjustTarget?.color || NEUTRAL_COLOR), lut: { id: lut.id, amount: 100 } }, 'LUT');
      onToast(`LUT「${lut.name}」を読み込みました。`);
    } catch (e) { onToast((e as Error).message || 'LUT を読み込めませんでした。'); }
  }, [cache, setColor, adjustTarget, onToast]);
  const deleteLut = useCallback((id: string) => {
    void removeLut(id).then(() => {
      cache.cubes.delete(id);
      setCubes(list => list.filter(c => c.id !== id));
      composited.current = null; setCubesVersion(v => v + 1);
    });
  }, [cache]);
  const savePreset = useCallback((name: string) => {
    if (!adjustTarget) return;
    setUserPresets(list => { const next = [{ id: `preset-${Date.now().toString(36)}`, name, basic: adjustTarget.basic, color: adjustTarget.color }, ...list]; storeUserPresets(next); return next; });
    onToast(`プリセット「${name}」を保存しました。`);
  }, [adjustTarget, onToast]);
  const deletePreset = useCallback((id: string) => setUserPresets(list => { const next = list.filter(p => p.id !== id); storeUserPresets(next); return next; }), []);

  // Selection commands and edits that use it.
  const selectionCommand = useCallback((command: 'all' | 'none' | 'invert') => {
    const d = historyRef.current?.present;
    if (!d) return;
    setSelection(command === 'all' ? selectAll(d.width, d.height) : command === 'none' ? null : invertSelection(selectionRef.current, d.width, d.height));
    bumpOverlay();
  }, [setSelection]);
  const refine = useCallback((op: Refine, radius: number) => {
    const sel = selectionRef.current;
    if (!sel) return;
    try { setSelection(refineSelection(sel, op, radius)); } catch (e) { onToast((e as Error).message); }
    bumpOverlay();
  }, [setSelection, onToast]);
  /** Fills the selection (or the whole surface) with a colour, or clears it when `color` is null. */
  const fillSelection = useCallback((color: string | null, label: string) => {
    const d = historyRef.current?.present;
    const surface = surfaceFor(color !== null);
    if (!d || !surface) return;
    const sel = selectionRef.current;
    const area = sel ? { x: sel.bounds.x - surface.offset.x, y: sel.bounds.y - surface.offset.y, w: sel.bounds.w, h: sel.bounds.h } : { x: 0, y: 0, w: d.width, h: d.height };
    const paint = surface.mask ? (color === null ? null : luminance(color) < 128 ? null : '#ffffff') : color;
    const rev = editSurface(store, surface.key, area, context => {
      const layer = makeCanvas(d.width, d.height), c = layer.getContext('2d')!;
      c.fillStyle = paint || '#000'; c.fillRect(0, 0, d.width, d.height);
      if (sel) { c.globalCompositeOperation = 'destination-in'; c.drawImage(sel.mask, 0, 0); }
      if (!paint) context.globalCompositeOperation = 'destination-out';
      context.drawImage(layer, -surface.offset.x, -surface.offset.y);
    });
    if (rev !== null) commitSurface(surface.layer.id, surface.mask, rev, label, false);
  }, [store, surfaceFor, commitSurface]);
  /** Copies the selected pixels of the current raster layer (the whole layer without a selection). */
  const copy = useCallback(() => {
    const d = historyRef.current?.present;
    const layer = d?.layers.find(l => l.id === d.selected);
    if (!d || !layer) return false;
    const source = cache.source(layer, store);
    if (!source) return false;
    const sel = selectionRef.current;
    const result = makeCanvas(d.width, d.height), c = result.getContext('2d')!;
    c.drawImage(source.canvas, source.x, source.y);
    if (sel) { c.globalCompositeOperation = 'destination-in'; c.drawImage(sel.mask, 0, 0); }
    const bounds = sel ? sel.bounds : { x: Math.max(0, source.x), y: Math.max(0, source.y), w: Math.min(d.width, source.x + source.canvas.width) - Math.max(0, source.x), h: Math.min(d.height, source.y + source.canvas.height) - Math.max(0, source.y) };
    if (bounds.w <= 0 || bounds.h <= 0) return false;
    clipboard.current = { canvas: result, bounds };
    // Also offer the pixels to other apps.
    const out = makeCanvas(bounds.w, bounds.h);
    out.getContext('2d')!.drawImage(result, -bounds.x, -bounds.y);
    void toBlob(out, 'image/png').then(blob => { clipboardStamp.current = blob.size; return navigator.clipboard?.write?.([new ClipboardItem({ 'image/png': blob })]); }).catch(() => {});
    return true;
  }, [cache, store]);
  const pasteInternal = useCallback(() => {
    const d = historyRef.current?.present, clip = clipboard.current;
    if (!d || !clip) return;
    insertLayer(newRaster(d, uniqueName(d.layers, 'ペースト'), c => c.drawImage(clip.canvas, 0, 0)), 'ペースト');
  }, [insertLayer, newRaster]);
  const addImage = useCallback(async (file: File) => {
    const d = historyRef.current?.present;
    if (!d) return;
    try {
      const image = await decode(file);
      const scale = Math.min(1, d.width / image.width, d.height / image.height);
      const w = Math.round(image.width * scale), h = Math.round(image.height * scale);
      insertLayer(newRaster(d, file.name.replace(/\.[^.]+$/, '') || uniqueName(d.layers, '画像'), c => c.drawImage(image, Math.round((d.width - w) / 2), Math.round((d.height - h) / 2), w, h)), '画像を追加');
      image.close();
      setTab('layers');
    } catch (e) { onToast((e as Error).message); }
  }, [insertLayer, newRaster, onToast]);

  const layerActions: LayerActions = useMemo(() => ({
    select: selectLayer,
    update: updateLayer,
    commit: endGesture,
    rename: (id, name) => updateLayer(id, { name }, '名前を変更'),
    add: () => { const d = historyRef.current?.present; if (d) insertLayer(newRaster(d), '新規レイヤー'); },
    importImage: () => void pickImages().then(files => files[0] && addImage(files[0])),
    duplicate: () => {
      const d = historyRef.current?.present;
      const layer = d?.layers.find(l => l.id === d.selected);
      if (!d || !layer) return;
      const id = newLayerId();
      let copyLayer = { ...layer, id, name: `${layer.name} のコピー` } as Layer;
      if (layer.kind === 'raster') copyLayer = { ...copyLayer, rev: store.create(id, d.width, d.height, store.get(layer.id)) } as Layer;
      if (layer.mask) copyLayer = { ...copyLayer, mask: { ...layer.mask, rev: store.create(maskKey(id), d.width, d.height, store.get(maskKey(layer.id))) } };
      insertLayer(copyLayer, 'レイヤーを複製');
    },
    remove: () => change(d => {
      if (d.layers.length < 2) return d;
      const index = d.layers.findIndex(l => l.id === d.selected);
      const layers = d.layers.filter(l => l.id !== d.selected);
      return { ...d, layers, selected: layers[Math.max(0, index - 1)].id };
    }, 'レイヤーを削除'),
    move: direction => change(d => {
      const index = d.layers.findIndex(l => l.id === d.selected), to = index + direction;
      if (to < 0 || to >= d.layers.length) return d;
      const layers = [...d.layers];
      [layers[index], layers[to]] = [layers[to], layers[index]];
      return { ...d, layers };
    }, direction > 0 ? 'レイヤーを上へ' : 'レイヤーを下へ'),
    addMask: () => {
      const d = historyRef.current?.present;
      if (!d) return;
      const key = maskKey(d.selected);
      const sel = selectionRef.current;
      const rev = sel ? store.create(key, d.width, d.height, sel.mask) : createMask(store, key, d.width, d.height);
      updateLayer(d.selected, { mask: { rev, enabled: true } }, sel ? '選択範囲からマスク' : 'マスクを追加');
      setTarget('mask');
    },
    removeMask: () => { const d = historyRef.current?.present; if (d) updateLayer(d.selected, { mask: undefined }, 'マスクを削除'); setTarget('layer'); },
    addAdjust: () => {
      const d = historyRef.current?.present;
      if (!d) return;
      const id = newLayerId();
      const rev = createMask(store, maskKey(id), d.width, d.height, selectionRef.current?.mask);
      const layer: AdjustLayer = { kind: 'adjust', id, name: uniqueName(d.layers, '調整レイヤー'), visible: true, opacity: 100, blend: 'source-over', x: 0, y: 0, basic: NEUTRAL, color: NEUTRAL_COLOR, mask: { rev, enabled: true } };
      insertLayer(layer, '調整レイヤーを追加');
      setEditImage(false); setTarget('mask'); setTab('adjust');
    },
    editAdjust: () => { setEditImage(false); setTab('adjust'); },
    rasterize: () => {
      const d = historyRef.current?.present;
      const layer = d?.layers.find(l => l.id === d.selected);
      const source = layer && cache.source(layer, store);
      if (!d || !layer || !source) return;
      const raster = newRaster(d, layer.name, c => c.drawImage(source.canvas, source.x, source.y));
      const mask = layer.mask && { ...layer.mask, rev: store.create(maskKey(raster.id), d.width, d.height, store.get(maskKey(layer.id))) };
      change(doc => ({ ...doc, selected: raster.id, layers: doc.layers.map(l => l.id === layer.id ? { ...raster, visible: l.visible, opacity: l.opacity, blend: l.blend, mask } : l) }), 'ラスタライズ');
    },
  }), [selectLayer, updateLayer, endGesture, insertLayer, newRaster, addImage, change, store, cache]);

  // Save a thumbnail of the edited result and any unsaved pixels when leaving the editor.
  const latest = useRef<{ doc?: Doc; image?: HTMLCanvasElement }>({});
  latest.current = { doc, image: version ? adjuster.canvas : undefined };
  useEffect(() => () => {
    savePixels();
    const { doc: last, image } = latest.current;
    if (!last || !image) return;
    const size = outputSize(last.geometry, last.width, last.height);
    const k = Math.min(1, 960 / Math.max(size.width, size.height));
    const target = makeCanvas(Math.max(1, Math.round(size.width * k)), Math.max(1, Math.round(size.height * k)));
    drawGeometry(target.getContext('2d')!, image, last, 0, 0, k, 'output');
    void createImageBitmap(target).then(bitmap => thumbnail(bitmap).finally(() => bitmap.close())).then(blob => onUpdate({ ...projectRef.current, thumbnail: blob, edits: savedEdits(last), edited: Date.now() })).catch(() => {});
  }, [adjuster, onUpdate, savePixels]);

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if ((event.target as HTMLElement)?.closest?.('input, textarea')) return;
      const file = [...(event.clipboardData?.files || [])].find(isImageFile);
      const clip = clipboard.current;
      event.preventDefault();
      // Our own copy comes back from the system clipboard too; paste it in place rather than centred.
      if (file && !(clip && file.type === 'image/png' && file.size && clipboardStamp.current === file.size)) void addImage(file);
      else if (clip) pasteInternal();
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, [addImage, pasteInternal]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest('input:not([type=range]):not([type=color]), select, textarea, dialog')) return;
      const command = event.metaKey || event.ctrlKey, key = event.key.toLowerCase();
      const h = historyRef.current;
      if (command && key === 'z') { event.preventDefault(); if (h && !action.current) apply(event.shiftKey ? redo(h) : undo(h)); }
      else if (command && key === 'y') { event.preventDefault(); if (h && !action.current) apply(redo(h)); }
      else if (command && (key === '=' || key === '+')) { event.preventDefault(); if (view) zoomTo(stepZoom(view.scale, 1)); }
      else if (command && key === '-') { event.preventDefault(); if (view) zoomTo(stepZoom(view.scale, -1)); }
      else if (command && key === '0') { event.preventDefault(); fit(); }
      else if (command && key === '1') { event.preventDefault(); zoomTo(1); }
      else if (command && event.shiftKey && key === 'e') { event.preventDefault(); setExporting(true); }
      else if (command && event.shiftKey && key === 'i') { event.preventDefault(); selectionCommand('invert'); }
      else if (command && key === 'a') { event.preventDefault(); selectionCommand('all'); }
      else if (command && key === 'd') { event.preventDefault(); selectionCommand('none'); }
      else if (command && key === 'j') {
        event.preventDefault();
        if (selectionRef.current && copy()) pasteInternal(); else layerActions.duplicate();
      }
      else if (command && key === 'c') { event.preventDefault(); if (copy()) onToast('コピーしました。'); }
      else if (command && key === 'x') { event.preventDefault(); if (copy()) fillSelection(null, 'カット'); }
      else if (command && key === 'backspace') { event.preventDefault(); fillSelection(colors[1], '背景色で塗りつぶし'); }
      else if (command) return;
      else if (event.altKey && key === 'backspace') { event.preventDefault(); fillSelection(colors[0], '描画色で塗りつぶし'); }
      else if (key === 'delete' || key === 'backspace') { event.preventDefault(); if (selectionRef.current) fillSelection(null, '消去'); else onToast('消去する範囲を選択してください。'); }
      else if (key === ' ') { event.preventDefault(); setSpace(true); }
      else if (key === '\\') setBefore(true);
      else if (key === 'escape') { if (tool === 'crop') setTool('hand'); else selectionCommand('none'); }
      else if (key === 'enter' && tool === 'crop') setTool('hand');
      else if (key.startsWith('arrow') && tool === 'move' && h) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1, layer = h.present.layers.find(l => l.id === h.present.selected)!;
        const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0, dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
        updateLayer(layer.id, { x: layer.x + dx, y: layer.y + dy }, '移動', true);
      }
      else if (key === '[' || key === ']') {
        const which = tool === 'eraser' || tool === 'heal' || tool === 'clone' ? tool : 'brush', size = settings[which].size;
        setSettings({ [which]: { ...settings[which], size: Math.max(1, Math.min(500, Math.round(key === ']' ? size * 1.2 + 1 : size / 1.2 - 1))) } });
        bumpOverlay();
      }
      else if (key === 'x') setColors(([a, b]) => [b, a]);
      else if (key === 'd') setColors(['#000000', '#ffffff']);
      else if (event.shiftKey && key === 'n') layerActions.add();
      else {
        const next = ({ v: 'move', l: 'lasso', w: 'wand', b: 'brush', e: 'eraser', j: 'heal', s: 'clone', i: 'eyedropper', t: 'text', u: 'shape', h: 'hand', z: 'zoom' } as Record<string, Tool>)[key]
          ?? (key === 'm' ? (tool === 'marquee' || event.shiftKey ? (tool === 'ellipse' ? 'marquee' : 'ellipse') : 'marquee') : undefined)
          ?? (key === 'g' ? (tool === 'fill' || event.shiftKey ? (tool === 'gradient' ? 'fill' : 'gradient') : 'fill') : undefined)
          ?? (key === 'c' ? (tool === 'crop' ? 'hand' : 'crop') : undefined);
        if (next) setTool(next);
      }
    };
    const up = (event: KeyboardEvent) => { if (event.key === ' ') setSpace(false); if (event.key === '\\') setBefore(false); if (event.key === 'Shift' || event.key === 'Alt') bumpOverlay(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [view, zoomTo, fit, tool, setTool, apply, selectionCommand, copy, pasteInternal, fillSelection, layerActions, colors, settings, setSettings, updateLayer, onToast]);
  if (error) return <div className="app editor"><div className="editor-error"><h2>画像を開けませんでした</h2><p>{error}</p><button type="button" className="btn" onClick={onClose}><ArrowLeft size={16}/>ライブラリに戻る</button></div></div>;
  if (!doc || !history || !output || !selected) return <div className="app editor"><div className="editor-loading"><span className="spinner" aria-hidden="true"/>読み込み中…</div></div>;

  const shown = before ? { ...doc, adjust: { ...doc.adjust, vignette: 0 } } : doc;
  return <div className="app editor" data-tool={tool}>
    <header className="editor-bar">
      <div className="bar-group">
        <IconButton icon={ArrowLeft} label="ライブラリに戻る" onClick={onClose}/>
        <div className="doc-title"><strong>{project.name}</strong><span className="num">{output.width} × {output.height}</span></div>
      </div>
      <div className="bar-group">
        <IconButton icon={Undo2} label="元に戻す" shortcut={`${mod}+Z`} disabled={!history.past.length} onClick={() => apply(undo(history))}/>
        <IconButton icon={Redo2} label="やり直す" shortcut={`${mod}+⇧+Z`} disabled={!history.future.length} onClick={() => apply(redo(history))}/>
        <span className="zoom-group">
        <span className="bar-sep" aria-hidden="true"/>
        <IconButton icon={Minus} label="縮小" shortcut={`${mod}+−`} onClick={() => view && zoomTo(stepZoom(view.scale, -1))}/>
        <button type="button" className="zoom-readout num" title="画面に合わせる" onClick={fit}>{view ? formatZoom(view.scale) : '—'}</button>
        <IconButton icon={Plus} label="拡大" shortcut={`${mod}+=`} onClick={() => view && zoomTo(stepZoom(view.scale, 1))}/>
        <IconButton icon={Maximize} label="画面に合わせる" shortcut={`${mod}+0`} onClick={fit}/>
        </span>
      </div>
      <div className="bar-group end">
        <button type="button" className={`btn compare${before ? ' on' : ''}`} title="押している間、補正前を表示（\\ キー）" aria-pressed={before}
          onPointerDown={() => setBefore(true)} onPointerUp={() => setBefore(false)} onPointerLeave={() => setBefore(false)}><SplitSquareHorizontal size={15} aria-hidden="true"/><span className="btn-label">補正前</span></button>
        <IconButton icon={Settings2} label="設定" onClick={onSettings}/>
        <button type="button" className="btn primary" title={`書き出し (${mod}+⇧+E)`} onClick={() => setExporting(true)}><Download size={16} aria-hidden="true"/>書き出し</button>
      </div>
    </header>
    <div className="editor-body">
      <ToolRail tool={tool} onTool={setTool} colors={colors} onColors={setColors}/>
      <div className="stage-wrap" onDragOver={event => { if ([...event.dataTransfer.items].some(item => item.kind === 'file')) event.preventDefault(); }}
        onDrop={event => { const file = [...event.dataTransfer.files].find(isImageFile); if (file) { event.preventDefault(); void addImage(file); } }}>
        <Stage doc={shown} image={before ? work.current : (version ? adjuster.canvas : null)} imageVersion={version + (before ? 0.5 : 0)} view={view} tool={tool} spaceHeld={space} checkerboard={prefs.checkerboard}
          aspect={aspectRatio(aspectId)} onCrop={onCrop} onView={setView} onCursor={setCursor} onSize={setViewport} onTool={onTool} overlay={overlay} overlayVersion={overlayVersion + (selection ? 0.5 : 0)}/>
        {before && <div className="stage-badge">補正前</div>}
        {!before && <ToolOptions tool={tool} settings={settings} onChange={setSettings} hasSelection={!!selection} onSelectionCommand={selectionCommand} onRefine={refine}/>}
        {tool === 'crop' && <div className="crop-bar" role="toolbar" aria-label="切り抜き">
          <label className="select"><span>比率</span><select value={aspectId} onChange={e => chooseAspect(e.target.value)}>{ASPECTS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
          <div className="crop-angle"><Slider label="角度" value={doc.geometry.angle} min={-MAX_ANGLE} max={MAX_ANGLE} step={0.1} format={v => `${v.toFixed(1)}°`} centered onChange={straighten} onCommit={endGesture} onReset={() => straighten(0)}/></div>
          <IconButton icon={RotateCcw} label="左に90°回転" onClick={() => change(d => ({ ...d, geometry: rotateQuarter(d.geometry, -1, d.width, d.height) }), '左に回転')}/>
          <IconButton icon={RotateCw} label="右に90°回転" onClick={() => change(d => ({ ...d, geometry: rotateQuarter(d.geometry, 1, d.width, d.height) }), '右に回転')}/>
          <IconButton icon={FlipHorizontal2} label="左右反転" onClick={() => change(d => ({ ...d, geometry: flip(d.geometry, 'h', d.width, d.height) }), '左右反転')}/>
          <IconButton icon={FlipVertical2} label="上下反転" onClick={() => change(d => ({ ...d, geometry: flip(d.geometry, 'v', d.width, d.height) }), '上下反転')}/>
          <button type="button" className="btn" onClick={() => { setAspectId('free'); change(d => ({ ...d, geometry: IDENTITY }), '切り抜きをリセット'); }}>リセット</button>
          <button type="button" className="btn primary" onClick={() => setTool('hand')}><Check size={15} aria-hidden="true"/>完了</button>
        </div>}
        {tool !== 'crop' && <div className="status-bar num" aria-live="off">
          <span>{view ? formatZoom(view.scale) : ''}</span>
          <span>{cursor ? `X ${cursor.x}  Y ${cursor.y}` : `${output.width} × ${output.height} px`}</span>
          {selection && <span>選択 {selection.bounds.w} × {selection.bounds.h}</span>}
          <span>{selected.name}{target === 'mask' ? '（マスク）' : ''}</span>
        </div>}
      </div>
      <aside className="inspector" aria-label="インスペクター">
        <div className="inspector-tabs" role="tablist">
          {([['layers', 'レイヤー', Layers], ['adjust', '調整', SlidersHorizontal], ['history', '履歴', HistoryIcon], ['info', '情報', Info]] as const).map(([id, label, Icon]) =>
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} title={label} onClick={() => setTab(id)}><Icon size={15} aria-hidden="true"/><span>{label}</span></button>)}
        </div>
        <div className="inspector-body">
          {tab === 'adjust' && adjustTarget && <AdjustPanel layerName={adjustLayer?.name ?? null} basic={adjustTarget.basic} color={adjustTarget.color} accelerated={adjuster.accelerated} histogram={curveHistogram}
            cubes={cubes} presetSource={work.current} version={version} userPresets={userPresets}
            onBasic={setBasic} onColor={setColor} onState={setAdjustState} onCommit={endGesture} onAuto={auto} onReset={() => setAdjustState({ basic: NEUTRAL, color: NEUTRAL_COLOR }, '調整をリセット')}
            onImportLut={() => void importLut()} onRemoveLut={deleteLut} onSavePreset={savePreset} onDeletePreset={deletePreset} onEditImage={adjustLayer ? () => setEditImage(true) : undefined}/>}
          {tab === 'layers' && <LayersPanel doc={doc} store={store} cache={cache} selected={selected} target={target} onTarget={setTarget} actions={layerActions} editText={editText}/>}
          {tab === 'history' && <HistoryPanel history={history} onJump={index => apply(jump(history, index))}/>}
          {tab === 'info' && <InfoPanel project={project} output={output} source={version ? adjuster.canvas : work.current} version={version}/>}
        </div>
      </aside>
    </div>
    {exporting && version > 0 && <ExportSheet doc={doc} image={adjuster.canvas} name={project.name} onClose={() => setExporting(false)} onToast={onToast} onProject={saveProject}/>}
  </div>;
}

/** A layer mask starts fully white: everything visible. */
