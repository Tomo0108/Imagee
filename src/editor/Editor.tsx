import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Sparkles, ArrowLeft, Check, CircleHelp, ClipboardPaste, Copy, Expand, ImagePlus, Mountain, PaintBucket, Scaling, Scissors, Search, SquareDashed, SquareMinus, Trash2, UserRound, Wand2, ZoomIn, ZoomOut, Eraser, ArrowUp, ArrowDown, Crop, FileDown, Download, FlipHorizontal2, FlipVertical2, History as HistoryIcon, Info, Layers, Maximize, Minus, Plus, Redo2, RotateCcw, RotateCw, Settings, SlidersHorizontal, Undo2, SplitSquareHorizontal, Save } from 'lucide-react';
import type { Project } from '../store';
import { writePixels } from '../store';
import { decode, histogram, thumbnail, toBlob, canvas as makeCanvas } from '../imaging';
import type { Preferences } from '../lib/preferences.mjs';
import { centered, fitScale, formatZoom, stepZoom, zoomAt, type View } from '../lib/viewport.mjs';
import { commit, createHistory, jump, LIMIT, redo, undo, type History } from '../lib/history.mjs';
import { autoAdjust, NEUTRAL, type Adjustments } from '../lib/adjust.mjs';
import { ASPECTS, autoCrop, fitAspect, flip, IDENTITY, MAX_ANGLE, orientedSize, outputSize, rotateQuarter, type Rect } from '../lib/geometry.mjs';
import { floodMask } from '../lib/flood.mjs';
import { alphaBounds, snapBox, type Gap, type Guide } from '../lib/snapping.mjs';
import { effectivePressure } from '../lib/brush.mjs';
import { compositeInto, drawGeometry, FONTS, LayerCache, maskKey, newLayerId, renderShape, savedEdits, uniqueName, workCanvas, type Doc, type Layer, type RasterLayer, type ShapeLayer, type TextLayer, type AdjustLayer } from './document';
import { clip, PixelStore, union, type Box } from './pixels';
import { arrayMask, combine, invertSelection, refineSelection, selectAll, shapeMask, type Refine, type SelectMode, type Selection } from './selection';
import { bucketFill, editSurface, gradientFill, healSurface, HealMask, hexToRgb, rgbToHex, Stroke, type CloneSource } from './tools';
import { Adjuster } from './gl';
import { createMask, loadDoc } from './load';
import { contentSize, Stage, type Tool, type ToolPhase, type ToolPointer } from './Stage';
import { ExportSheet } from './ExportSheet';
import { renderDocument } from './render';
import { AdjustPanel, HistoryPanel, InfoPanel, LayersPanel, type LayerActions } from './panels';
import { hintSeen, loadSettings, storeSettings, ToolOptions, ToolRail, TOOLS, type ToolSettings } from './toolbar';
import { CommandPalette, type Command } from './CommandPalette';
import { HelpSheet } from './HelpSheet';
import { ResizeSheet, type ResizeMode, type ResizeRequest } from './ResizeSheet';
import { arrangeImages } from '../lib/layout.mjs';
import { pickFile, pickImages, platform, saveBlob } from '../platform';
import { NEUTRAL_COLOR, parseCube, type ColorOps } from '../lib/color.mjs';
import { addLut, readLuts, removeLut } from '../store';
import { loadUserPresets, storeUserPresets, type UserPreset } from './color-ui';
import type { Histogram } from '../imaging';
import { baseName, exportName, isImageFile } from '../lib/files.mjs';
import { AiPanel, type AiBusy } from './AiPanel';
import { cancelAi, removeArea, skyMaskCanvas, subjectMask, upscale } from '../ai/ai';
import { IconButton, Modal, Slider, mod } from '../ui';
import { t } from '../i18n/index.mjs';

type Tab = 'adjust' | 'layers' | 'ai' | 'history' | 'info';
const TABS: Tab[] = ['layers', 'adjust', 'ai', 'history', 'info'];
/** Readings and other names for each tool, for the feature search. */
const TOOL_SEARCH: Record<Tool, { reading?: string; keywords: string[] }> = {
  move: { reading: 'イドウ', keywords: ['move', 'ドラッグ'] },
  marquee: { reading: 'チョウホウケイセンタク', keywords: ['marquee', 'rectangle select', 'シカク'] },
  ellipse: { reading: 'ダエンケイセンタク', keywords: ['ellipse', 'エン', 'マル'] },
  lasso: { reading: 'ナゲナワセンタク', keywords: ['lasso', 'ラッソ', 'フリーハンド'] },
  wand: { reading: 'ジドウセンタク', keywords: ['magic wand', 'マジックワンド', 'イロデセンタク'] },
  brush: { keywords: ['brush', 'pen', 'ペン', 'エガク', 'カク', 'ヌル'] },
  eraser: { reading: 'ケシゴム', keywords: ['eraser', 'ケス'] },
  heal: { reading: 'スポットシュウフクブラシ', keywords: ['heal', 'シミ', 'ゴミ', 'ヒール'] },
  remove: { reading: 'フヨウブツヲケス', keywords: ['remove', 'object removal', 'ショウキョ', 'ケス', 'AI'] },
  clone: { keywords: ['clone stamp', 'スタンプ', 'クローン'] },
  fill: { reading: 'ヌリツブシ', keywords: ['bucket', 'fill', 'バケツ'] },
  gradient: { keywords: ['gradient', 'グラデ'] },
  eyedropper: { keywords: ['eyedropper', 'picker', 'イロヲトル', 'カラーピッカー'] },
  text: { keywords: ['text', 'type', 'モジ', 'ジ'] },
  shape: { reading: 'ズケイ', keywords: ['shape', 'rectangle', 'シカク', 'マル', 'セン'] },
  crop: { reading: 'キリヌキトカイテン', keywords: ['crop', 'トリミング', 'カイテン', 'カタムキ', 'straighten'] },
  hand: { reading: 'テノヒラ', keywords: ['hand', 'pan', 'スクロール'] },
  zoom: { keywords: ['zoom', 'カクダイ', 'シュクショウ'] },
};
type Point = { x: number; y: number };
interface Props { project: Project; prefs: Preferences; onClose: () => void; onUpdate: (project: Project) => void; onToast: (message: string) => void; onSettings: () => void; onAddImage: (file: File) => void }
/** A pointer action in progress on the canvas. */
type Action =
  | { kind: 'stroke'; stroke: Stroke; layerId: string; mask: boolean; label: string }
  | { kind: 'select'; shape: 'rect' | 'ellipse'; start: Point; end: Point; mode: SelectMode; square: boolean }
  | { kind: 'lasso'; points: Point[]; mode: SelectMode }
  | { kind: 'gradient'; start: Point; end: Point }
  | { kind: 'shape'; start: Point; end: Point; constrain: boolean }
  | { kind: 'move'; id: string; start: Point; origin: Point; box: Box | null; others: Box[]; snap: Snap | null }
  | { kind: 'heal'; mask: HealMask; key: string; layerId: string; remove: boolean };
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
type Snap = { guides: Guide[]; gaps: Gap[]; box: Box };
const BRUSHES: Tool[] = ['brush', 'eraser', 'heal', 'remove', 'clone'];
const luminance = (hex: string) => { const [r, g, b] = hexToRgb(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const clearColor = (hex: string) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},0)`; };

/** Images edited earlier in this session keep their undo history (and its pixels) until the app closes,
 *  so edits that were not saved can still be brought back with redo. The few most recent are kept. */
type Session = { history: History<Doc>; store: PixelStore; saved: Doc };
const sessions = new Map<string, Session>();
const SESSIONS = 3;
/** The history moved to the saved state; unsaved steps stay ahead of it as redo. */
function rewind(history: History<Doc>, saved: Doc): History<Doc> {
  const states = [...history.past.map(entry => entry.state), history.present, ...history.future.map(entry => entry.state)];
  const index = states.indexOf(saved);
  if (index >= 0) return jump(history, index);
  return { past: [], present: saved, label: t('開く'), future: [{ state: history.present, label: history.label }] };
}

export function Editor({ project, prefs, onClose, onUpdate, onToast, onSettings, onAddImage }: Props) {
  const [history, setHistory] = useState<History<Doc> | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [tool, setToolState] = useState<Tool>('move');
  const [space, setSpace] = useState(false);
  const [before, setBefore] = useState(false);
  const [tab, setTabState] = useState<Tab>('layers');
  const tabRef = useRef<Tab>('layers');
  /** Panels slide in from the side of the tab that was picked. */
  const setTab = useCallback((next: Tab) => {
    if (next === tabRef.current) return;
    setTabDir(TABS.indexOf(next) > TABS.indexOf(tabRef.current) ? 'fwd' : 'back');
    tabRef.current = next; setTabState(next);
  }, []);
  const [aspectId, setAspectId] = useState('free');
  const [cursor, setCursor] = useState<Point | null>(null);
  const [exporting, setExporting] = useState(false);
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [resizing, setResizing] = useState<ResizeMode | null>(null);
  /** The first time a tool is picked, its hint shows above the canvas; after that it lives in the help. */
  const [hint, setHint] = useState(false);
  const [tabDir, setTabDir] = useState<'fwd' | 'back'>('fwd');
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
  const [multiIds, setMultiIds] = useState<string[]>([]);
  const [editText, setEditText] = useState(false);
  const [aiBusy, setAiBusy] = useState<AiBusy | null>(null);
  const aiBusyRef = useRef(false);
  /** The area being filled by object removal, shown until the result arrives. */
  const removing = useRef<{ canvas: HTMLCanvasElement; offset: Point } | null>(null);
  const adjuster = useMemo(() => new Adjuster(), []);
  const session = useMemo(() => sessions.get(project.id), []); // eslint-disable-line react-hooks/exhaustive-deps
  const store = useMemo(() => session?.store ?? new PixelStore(), [session]);
  /** The document as last saved to the library; anything else is an unsaved change. */
  const [savedDoc, setSavedDocState] = useState<Doc | null>(null);
  const savedRef = useRef<Doc | null>(null);
  const setSavedDoc = useCallback((d: Doc) => { savedRef.current = d; setSavedDocState(d); }, []);
  const [closing, setClosing] = useState(false);
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
  // Free the GPU context when the editor closes (React's development double-mount runs the cleanup and re-mounts at once).
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; setTimeout(() => { if (!mounted.current) adjuster.dispose(); }, 0); };
  }, [adjuster]);
  /** The adjusted image at the document's full size; large images are edited on a smaller copy. */
  const fullImage = useCallback((): HTMLCanvasElement | null => {
    const d = historyRef.current?.present, source = work.current;
    if (!d || !source) return null;
    return source.width === d.width && source.height === d.height ? adjuster.canvas : renderDocument(d, store, cache);
  }, [adjuster, store, cache]);

  const pruned = useRef(0);
  const apply = useCallback((next: History<Doc>) => {
    historyRef.current = next; setHistory(next);
    // Once the history is full, every so often drop pixels that no undo step can reach any more.
    if (next.past.length >= LIMIT && ++pruned.current % 25 === 0) store.prune(surfaceRevisions(next));
  }, [store]);
  const setSelection = useCallback((next: Selection | null) => { selectionRef.current = next; setSelectionState(next); }, []);
  const setSettings = useCallback((patch: Partial<ToolSettings>) => setSettingsState(current => { const next = { ...current, ...patch }; storeSettings(next); return next; }), []);

  // Open: decode the original, then restore painted surfaces from storage. Revisions are renumbered for this session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (session) {
        const restored = rewind(session.history, session.saved);
        work.current = workCanvas(restored.present, adjuster.maxSize);
        setSavedDoc(session.saved);
        apply(restored);
        return;
      }
      const doc = await loadDoc(project, store, () => cancelled);
      if (!doc) return;
      work.current = workCanvas(doc, adjuster.maxSize);
      setSavedDoc(doc);
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
    if (!doc || !work.current) return;
    // The image or canvas size changed (or was undone): a working canvas of the new size.
    const fresh = workCanvas(doc, adjuster.maxSize);
    if (fresh.width !== work.current.width || fresh.height !== work.current.height) { work.current = fresh; composited.current = null; }
    else fresh.width = fresh.height = 0;
    if (composited.current === doc.layers) return;
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
  useEffect(() => { setHint(!hintSeen('move')); }, []);
  useEffect(() => { if (!hint) return; const timer = setTimeout(() => setHint(false), 12000); return () => clearTimeout(timer); }, [hint, tool]);
  // Leaving the editor stops AI work, so a late result cannot change or open anything.
  useEffect(() => () => cancelAi(), []);

  // Saving is explicit: edits as JSON with the project, painted surfaces as PNG in their own store.
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
      const kept = new Set(keys.map(([key]) => key));
      await writePixels(projectRef.current.id, blobs, kept);
      for (const [key, rev] of changed) store.saved.set(key, rev);
      // Surfaces dropped from storage must be written again if an undo brings them back.
      for (const key of [...store.saved.keys()]) if (!kept.has(key)) store.saved.delete(key);
      savedKeys.current = keep;
    }).catch(() => onToast(t('描画内容を保存できませんでした。空き容量を確認してください。')));
    return saving.current;
  }, [store, onToast]);
  /** The document's painted surfaces as PNGs, straight from memory (they may not be saved yet). */
  const currentPixels = useCallback(async (d: Doc) => {
    const pixels = new Map<string, Blob>();
    for (const layer of d.layers) {
      if (layer.kind === 'raster') { store.sync(layer.id, layer.rev); const surface = store.get(layer.id); if (surface) pixels.set(layer.id, await toBlob(surface, 'image/png')); }
      if (layer.mask) { const key = maskKey(layer.id); store.sync(key, layer.mask.rev); const surface = store.get(key); if (surface) pixels.set(key, await toBlob(surface, 'image/png')); }
    }
    return pixels;
  }, [store]);
  /** Saves the document with its layers: as a PSD, or as an Imagee project file. */
  const saveProject = useCallback(async (kind: 'psd' | 'imagee') => {
    const d = historyRef.current?.present;
    if (!d) return;
    try {
      const io = await import('../io/projects');
      let blob: Blob;
      if (kind === 'psd') blob = await io.exportPsd(d, store, cache, fullImage() ?? adjuster.canvas);
      else blob = await io.exportStoredProject({ ...projectRef.current, edits: savedEdits(d) }, await currentPixels(d));
      const saved = await saveBlob(blob, exportName(projectRef.current.name, kind), kind, kind === 'psd' ? t('Photoshop ドキュメント') : t('Imagee プロジェクト'));
      if (saved) onToast(t('「{0}」を保存しました。', saved));
    } catch (e) { onToast((e as Error).message || t('保存できませんでした。')); }
  }, [store, cache, adjuster, fullImage, currentPixels, onToast]);

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
  const selectLayer = useCallback((id: string, multiple = false) => {
    const h = historyRef.current;
    if (!h) return;
    const existing = multiIds.filter(item => h.present.layers.some(layer => layer.id === item));
    const ids = existing.length ? existing : [h.present.selected];
    const next = multiple ? (ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id]) : [id];
    if (!next.length) return;
    setMultiIds(next);
    const primary = next.includes(id) ? id : next[next.length - 1];
    if (h.present.selected !== primary) apply({ ...h, present: { ...h.present, selected: primary } });
    merging.current = null;
    setEditText(false); setEditImage(false);
  }, [apply, multiIds]);
  /** Records that a surface reached a new revision. When the working composite already shows it, skip recompositing. */
  const commitSurface = useCallback((layerId: string, mask: boolean, rev: number, label: string, current: boolean) => {
    const next = change(d => ({ ...d, layers: d.layers.map(layer => layer.id !== layerId ? layer : mask ? { ...layer, mask: { ...layer.mask!, rev } } : { ...layer, rev } as Layer) }), label);
    if (next && current) composited.current = next.layers;
  }, [change]);
  const insertLayer = useCallback((layer: Layer, label: string) => { setMultiIds([layer.id]); return change(d => {
    const index = d.layers.findIndex(l => l.id === d.selected);
    const layers = [...d.layers];
    layers.splice(index + 1, 0, layer);
    return { ...d, layers, selected: layer.id };
  }, label); }, [change]);
  const newRaster = useCallback((d: Doc, name = uniqueName(d.layers, t('レイヤー')), source?: (context: CanvasRenderingContext2D) => void): RasterLayer => {
    const id = newLayerId();
    store.create(id, d.width, d.height);
    if (source) source(store.context(id));
    return { kind: 'raster', id, name, visible: true, opacity: 100, blend: 'source-over', x: 0, y: 0, rev: store.rev(id)! };
  }, [store]);

  const setTool = useCallback((next: Tool) => {
    action.current = null;
    setHint(!hintSeen(next));
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
  const existingIds = doc ? multiIds.filter(id => doc.layers.some(layer => layer.id === id)) : [];
  const selectedIds = doc ? (existingIds.length ? existingIds : [doc.selected]) : [];
  useEffect(() => { if (selected && !selected.mask && target === 'mask') setTarget('layer'); }, [selected, target]);

  /** The surface painting tools work on. Painting on a text or shape layer starts a new layer above it. */
  const surfaceFor = useCallback((paints: boolean, vectorMessage = t('テキストや図形のレイヤーは、ラスタライズすると消去できます。')): Surface | null => {
    const d = historyRef.current?.present;
    const layer = d?.layers.find(l => l.id === d.selected);
    if (!d || !layer) return null;
    if (!layer.visible) { onToast(t('非表示のレイヤーには描けません。')); return null; }
    if ((target === 'mask' || layer.kind === 'adjust') && layer.mask) return { key: maskKey(layer.id), layer, mask: true, offset: { x: 0, y: 0 } };
    if (layer.kind === 'adjust') { onToast(t('調整レイヤーに描くにはマスクを追加してください。')); return null; }
    if (layer.kind === 'raster') return { key: layer.id, layer, mask: false, offset: { x: layer.x, y: layer.y } };
    if (!paints) { onToast(vectorMessage); return null; }
    const created = newRaster(d);
    insertLayer(created, t('新規レイヤー'));
    return { key: created.id, layer: created, mask: false, offset: { x: 0, y: 0 } };
  }, [target, newRaster, insertLayer, onToast]);

  // On-device AI: one task at a time, with progress and cancel in the AI panel.
  const runAi = useCallback(async (label: string, task: (progress: (fraction: number) => void) => Promise<void>, withProgress = false) => {
    aiBusyRef.current = true;
    setAiBusy({ label, progress: withProgress ? 0 : null });
    try { await task(fraction => setAiBusy({ label, progress: fraction })); }
    catch (e) { if ((e as DOMException).name !== 'AbortError') onToast((e as Error).message || t('AI の処理に失敗しました。')); }
    finally { aiBusyRef.current = false; setAiBusy(null); removing.current = null; bumpOverlay(); }
  }, [onToast]);
  /** Object removal: fills the masked area of a surface (surface coordinates) with surrounding texture, as one undo step. */
  const fillArea = useCallback((key: string, layerId: string, mask: HTMLCanvasElement, bounds: Box, label: string) => {
    const surface = store.get(key);
    if (!surface) return;
    const margin = Math.max(24, Math.round(Math.max(bounds.w, bounds.h) * 1.3));
    const area = clip({ x: bounds.x - margin, y: bounds.y - margin, w: bounds.w + margin * 2, h: bounds.h + margin * 2 }, surface);
    if (!area) return;
    const image = store.context(key).getImageData(area.x, area.y, area.w, area.h);
    const alpha = mask.getContext('2d')!.getImageData(area.x, area.y, area.w, area.h).data;
    const weights = new Float32Array(area.w * area.h);
    for (let i = 0; i < weights.length; i++) weights[i] = alpha[i * 4 + 3] / 255;
    const rev = store.rev(key);
    removing.current = { canvas: mask, offset: historyRef.current?.present.layers.find(l => l.id === layerId) ?? { x: 0, y: 0 } };
    void runAi(t('不要物を消しています…'), async progress => {
      const result = await removeArea(image, weights, progress);
      if (store.rev(key) !== rev) throw new Error(t('処理中に画像が変更されたため、消去を取り消しました。'));
      const next = editSurface(store, key, area, c => c.putImageData(new ImageData(result as Uint8ClampedArray<ArrayBuffer>, area.w, area.h), area.x, area.y));
      if (next !== null) commitSurface(layerId, false, next, label, false);
    }, true);
  }, [store, runAi, commitSurface]);

  const sample = useCallback((p: Point) => {
    const d = historyRef.current?.present, source = work.current;
    if (!d || !source) return null;
    const k = source.width / d.width;
    const x = Math.floor(p.x * k), y = Math.floor(p.y * k);
    if (x < 0 || y < 0 || x >= source.width || y >= source.height) return null;
    // Pick what is on screen: the colour after adjustments, curves and LUTs.
    const pixel = makeCanvas(1, 1), pc = pixel.getContext('2d', { willReadFrequently: true })!;
    pc.drawImage(adjuster.canvas.width === source.width ? adjuster.canvas : source, x, y, 1, 1, 0, 0, 1, 1);
    const [r, g, b, a] = pc.getImageData(0, 0, 1, 1).data;
    return a ? rgbToHex(r, g, b) : null;
  }, [adjuster]);
  const pickColor = useCallback((p: ToolPointer) => {
    const color = sample(p);
    if (color) setColors(current => p.alt ? [current[0], color] : [color, current[1]]);
  }, [sample]);

  /** Where a layer's visible content is, in document pixels. Raster layers are measured from their pixels
   *  (on a small copy, cached per revision), so an image placed on a large layer is found by its content. */
  const boundsCache = useRef(new Map<string, Box | null>());
  const contentBounds = useCallback((layer: Layer): Box | null => {
    if (layer.kind === 'adjust') return null;
    if (layer.kind !== 'raster') return cache.bounds(layer, store);
    const key = `${layer.id}:${layer.rev}`;
    let local = boundsCache.current.get(key);
    if (local === undefined) {
      const surface = store.get(layer.id);
      local = null;
      if (surface) {
        const k = Math.min(1, 512 / Math.max(surface.width, surface.height));
        const small = makeCanvas(Math.max(1, Math.round(surface.width * k)), Math.max(1, Math.round(surface.height * k)));
        const sc = small.getContext('2d', { willReadFrequently: true })!;
        sc.drawImage(surface, 0, 0, small.width, small.height);
        const b = alphaBounds(sc.getImageData(0, 0, small.width, small.height).data, small.width, small.height);
        small.width = small.height = 0;
        if (b) {
          const x0 = Math.max(0, Math.floor(b.x / k)), y0 = Math.max(0, Math.floor(b.y / k));
          local = { x: x0, y: y0, w: Math.min(surface.width, Math.ceil((b.x + b.w) / k)) - x0, h: Math.min(surface.height, Math.ceil((b.y + b.h) / k)) - y0 };
        }
      }
      boundsCache.current.set(key, local);
    }
    return local && { ...local, x: local.x + layer.x, y: local.y + layer.y };
  }, [cache, store]);
  const scaleRef = useRef(1);
  scaleRef.current = view?.scale ?? 1;

  /** The topmost visible image, text or shape under a point: its own pixels (and mask) decide, not its box. */
  const hitLayer = useCallback((d: Doc, p: Point): Layer | null => {
    for (let i = d.layers.length - 1; i >= 0; i--) {
      const layer = d.layers[i];
      if (!layer.visible || layer.kind === 'adjust' || layer.opacity === 0) continue;
      const box = contentBounds(layer);
      if (!box || p.x < box.x || p.y < box.y || p.x >= box.x + box.w || p.y >= box.y + box.h) continue;
      const opaque = (surface: CanvasImageSource | undefined | null, x: number, y: number) => {
        if (!(surface instanceof HTMLCanvasElement || (typeof OffscreenCanvas !== 'undefined' && surface instanceof OffscreenCanvas))) return true;
        if (x < 0 || y < 0 || x >= surface.width || y >= surface.height) return false;
        const c = surface.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
        return !c || c.getImageData(Math.floor(x), Math.floor(y), 1, 1).data[3] > 24;
      };
      if (layer.kind === 'raster' && !opaque(store.get(layer.id), p.x - layer.x, p.y - layer.y)) continue;
      if (layer.mask?.enabled) {
        const mask = store.get(maskKey(layer.id));
        if (mask instanceof HTMLCanvasElement) {
          const c = mask.getContext('2d');
          if (c && c.getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data[0] < 24) continue;
        }
      }
      return layer;
    }
    return null;
  }, [contentBounds, store]);

  const begin = useCallback((p: ToolPointer, d: Doc) => {
    const mode: SelectMode = p.shift ? 'add' : p.alt ? 'subtract' : settings.selectMode;
    const layer = d.layers.find(l => l.id === d.selected)!;
    switch (tool) {
      case 'move': {
        // Clicking an image, text or shape picks its layer (Shift keeps the current one).
        const hit = p.shift ? null : hitLayer(d, p);
        const target = hit ?? layer;
        if (hit && hit.id !== layer.id) selectLayer(hit.id);
        // Smart guides: what the object can line up with (the canvas, and every other visible object).
        const others = d.layers.filter(l => l.id !== target.id && l.visible).map(contentBounds).filter((b): b is Box => !!b);
        action.current = { kind: 'move', id: target.id, start: p, origin: { x: target.x, y: target.y }, box: contentBounds(target), others, snap: null };
        break;
      }
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
        action.current = { kind: 'stroke', stroke, layerId: surface.layer.id, mask: surface.mask, label: surface.mask ? t('マスクを編集') : tool === 'brush' ? t('ブラシ') : t('消しゴム') };
        refresh(stroke.add({ x: p.x, y: p.y, pressure: effectivePressure(p.pressure, p.pointerType) }));
        break;
      }
      case 'clone': {
        if (p.alt) { cloneSource.current = { x: p.x, y: p.y }; cloneOffset.current = null; break; }
        if (!cloneSource.current) { onToast(t('Alt（Option）キーを押しながらクリックして、コピー元を指定してください。')); break; }
        const surface = surfaceFor(true);
        if (!surface) break;
        if (surface.mask) { onToast(t('マスクにはコピースタンプを使えません。')); break; }
        // Aligned: the offset chosen by the first stroke stays until a new source is picked.
        const co = cloneOffset.current ??= { x: cloneSource.current.x - p.x, y: cloneSource.current.y - p.y };
        let source: CloneSource = { image: 'original', x: -co.x, y: -co.y };
        if (settings.cloneAll) {
          const full = makeCanvas(d.width, d.height);
          compositeInto(full, historyRef.current!.present, store, cache);
          source = { image: full, x: -(surface.offset.x + co.x), y: -(surface.offset.y + co.y) };
        }
        const stroke = new Stroke(store, surface.key, settings.clone, '#000', 'clone', surface.offset, selectionRef.current, source);
        action.current = { kind: 'stroke', stroke, layerId: surface.layer.id, mask: false, label: t('コピースタンプ') };
        refresh(stroke.add({ x: p.x, y: p.y, pressure: 1 }));
        break;
      }
      case 'heal': case 'remove': {
        if (tool === 'remove' && aiBusyRef.current) { onToast(t('前の処理が終わるまでお待ちください。')); break; }
        const surface = surfaceFor(false, t('テキストや図形のレイヤーは、ラスタライズすると{0}できます。', tool === 'remove' ? t('消去') : t('修復')));
        if (!surface) break;
        if (surface.mask) { onToast(tool === 'remove' ? t('マスクでは不要物を消せません。画像のレイヤーを選んでください。') : t('マスクには修復ブラシを使えません。')); break; }
        const target = store.get(surface.key)!;
        const mask = new HealMask(target.width, target.height, settings.heal.size, settings.heal.hardness, surface.offset);
        mask.add({ x: p.x, y: p.y, pressure: 1 });
        action.current = { kind: 'heal', mask, key: surface.key, layerId: surface.layer.id, remove: tool === 'remove' };
        break;
      }
      case 'fill': {
        const surface = surfaceFor(true);
        if (!surface) break;
        if (surface.mask) { onToast(t('マスクにはブラシかグラデーションを使ってください。')); break; }
        const changed = bucketFill(store, surface.key, p, colors[0], settings.fillOpacity, settings.tolerance, settings.contiguous, surface.offset, selectionRef.current);
        if (changed) commitSurface(surface.layer.id, false, store.rev(surface.key)!, t('塗りつぶし'), false);
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
        const text: TextLayer = { kind: 'text', id: newLayerId(), name: uniqueName(d.layers, t('テキスト')), visible: true, opacity: 100, blend: 'source-over', x: Math.round(p.x), y: Math.round(p.y - size * 0.65),
          text: { content: t('テキスト'), font: FONTS[0].value, size, weight: 700, italic: false, color: colors[0], align: 'left', vertical: false, lineHeight: 1.3 } };
        insertLayer(text, t('テキストを追加'));
        setEditText(true); setTab('layers');
        break;
      }
    }
    bumpOverlay();
  }, [tool, settings, colors, store, cache, surfaceFor, pickColor, refresh, commitSurface, insertLayer, selectLayer, setSelection, onToast, hitLayer, contentBounds]);

  const move = useCallback((p: ToolPointer) => {
    const a = action.current;
    if (!a) return;
    if (a.kind === 'stroke') refresh(a.stroke.add({ x: p.x, y: p.y, pressure: effectivePressure(p.pressure, p.pointerType) }));
    else if (a.kind === 'heal') a.mask.add({ x: p.x, y: p.y, pressure: 1 });
    else if (a.kind === 'select') { a.end = p; a.square = p.shift && a.mode !== 'add'; }
    else if (a.kind === 'lasso') { const last = a.points[a.points.length - 1]; if (Math.hypot(p.x - last.x, p.y - last.y) > 1) a.points.push(p); }
    else if (a.kind === 'gradient') a.end = p.shift ? snapLine(a.start, p) : p;
    else if (a.kind === 'shape') { a.end = p; a.constrain = p.shift; }
    else if (a.kind === 'move') {
      let dx = Math.round(p.x - a.start.x), dy = Math.round(p.y - a.start.y);
      const d = historyRef.current?.present;
      if (a.box && d) {
        const moved = { ...a.box, x: a.box.x + dx, y: a.box.y + dy };
        // Ctrl / ⌘ moves freely; otherwise edges and centres within a few screen pixels snap.
        const result = snapBox(moved, a.others, { x: 0, y: 0, w: d.width, h: d.height }, p.mod ? 0 : 6 / scaleRef.current);
        dx += Math.round(result.dx); dy += Math.round(result.dy);
        a.snap = { guides: p.mod ? [] : result.guides, gaps: result.gaps, box: { ...a.box, x: a.box.x + dx, y: a.box.y + dy } };
      }
      updateLayer(a.id, { x: a.origin.x + dx, y: a.origin.y + dy }, t('移動'), true);
    }
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
          const sel = selectionRef.current, layer = makeCanvas(d.width, d.height), lc = layer.getContext('2d')!;
          lc.fillStyle = gradient; lc.fillRect(0, 0, d.width, d.height);
          if (sel) { lc.globalCompositeOperation = 'destination-in'; lc.drawImage(sel.mask, 0, 0); }
          // Like the image gradient: blend over the mask by the fill opacity, only inside the selection.
          const opacity = settings.fillOpacity / 100;
          context.globalAlpha = opacity;
          context.globalCompositeOperation = 'destination-out';
          if (sel) context.drawImage(sel.mask, 0, 0); else { context.fillStyle = '#fff'; context.fillRect(0, 0, d.width, d.height); }
          context.globalCompositeOperation = 'lighter'; context.drawImage(layer, 0, 0);
        };
        const area = selectionRef.current?.bounds ?? { x: 0, y: 0, w: d.width, h: d.height };
        const rev = editSurface(store, surface.key, area, g);
        if (rev !== null) commitSurface(surface.layer.id, true, rev, t('マスクのグラデーション'), false);
      } else {
        const changed = gradientFill(store, surface.key, a.start, a.end, settings.gradient, [colors[0], settings.gradientToTransparent ? clearColor(colors[0]) : colors[1]], settings.fillOpacity, surface.offset, selectionRef.current);
        if (changed) commitSurface(surface.layer.id, false, store.rev(surface.key)!, t('グラデーション'), false);
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
        kind: 'shape', id: newLayerId(), name: uniqueName(d.layers, t('図形')), visible: true, opacity: 100, blend: 'source-over',
        x: Math.round(line ? start.x : area.x), y: Math.round(line ? start.y : area.y),
        shape: { type: settings.shape, w: Math.round(line ? end.x - start.x : area.w), h: Math.round(line ? end.y - start.y : area.h), fill, stroke: line ? colors[0] : settings.shapeStroke ? (fill ? colors[1] : colors[0]) : null, strokeWidth: settings.strokeWidth, radius: settings.radius },
      };
      insertLayer(shape, t('図形を追加'));
    } else if (a.kind === 'heal' && a.remove) {
      if (a.mask.bounds) fillArea(a.key, a.layerId, a.mask.canvas, a.mask.bounds, t('不要物を消去'));
    } else if (a.kind === 'heal') {
      const rev = healSurface(store, a.key, a.mask);
      if (rev !== null) commitSurface(a.layerId, false, rev, t('スポット修復'), false);
    } else if (a.kind === 'move') { a.snap = null; endGesture(); }
    bumpOverlay();
  }, [store, cache, adjuster, settings, colors, surfaceFor, commitSurface, insertLayer, setSelection, endGesture, fillArea]);

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
    if (a?.kind === 'move' && a.snap) drawGuides(c, a.snap, px);
    const h = hover.current;
    if (a?.kind === 'heal') { c.save(); c.globalAlpha = 0.5; c.drawImage(a.mask.canvas, a.mask.offset.x, a.mask.offset.y); c.restore(); }
    const pending = removing.current;
    if (pending) { c.save(); c.globalAlpha = 0.4; c.drawImage(pending.canvas, pending.offset.x, pending.offset.y); c.restore(); }
    const src = cloneSource.current;
    if (tool === 'clone' && src) {
      // Where the clone stamp copies from: the picked point, or the hover point plus the aligned offset.
      const at = h && cloneOffset.current ? { x: h.x + cloneOffset.current.x, y: h.y + cloneOffset.current.y } : src;
      const r = settings.clone.size / 2;
      c.save(); c.lineWidth = px; c.strokeStyle = '#fff'; c.setLineDash([3 * px, 3 * px]);
      c.beginPath(); c.arc(at.x, at.y, r, 0, Math.PI * 2); c.moveTo(at.x - 6 * px, at.y); c.lineTo(at.x + 6 * px, at.y); c.moveTo(at.x, at.y - 6 * px); c.lineTo(at.x, at.y + 6 * px); c.stroke(); c.restore();
    }
    if (h && (tool === 'brush' || tool === 'eraser' || tool === 'heal' || tool === 'remove' || tool === 'clone')) {
      const options = settings[tool === 'remove' ? 'heal' : tool];
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
  const onCrop = useCallback((crop: Rect) => change(d => ({ ...d, geometry: { ...d.geometry, crop } }), t('切り抜き')), [change]);
  const chooseAspect = (id: string) => {
    setAspectId(id);
    const ratio = aspectRatio(id);
    if (!doc || !ratio) return;
    const frame = orientedSize(doc.width, doc.height, doc.geometry.quarter);
    const around = doc.geometry.crop || autoCrop(frame.width, frame.height, doc.geometry.angle);
    change(d => ({ ...d, geometry: { ...d.geometry, crop: fitAspect(around, ratio, frame) } }), t('切り抜きの比率'));
  };
  const straighten = (angle: number) => change(d => {
    const frame = orientedSize(d.width, d.height, d.geometry.quarter);
    const ratio = aspectRatio(aspectId);
    const auto = autoCrop(frame.width, frame.height, angle);
    // Keep the chosen ratio inside the area the rotation leaves free of empty corners.
    const inner = ratio > 0 && aspectId !== 'original' ? fitAspect({ x: 0, y: 0, w: auto.w, h: auto.h }, ratio, { width: auto.w, height: auto.h }) : null;
    return { ...d, geometry: { ...d.geometry, angle, crop: inner && { ...inner, x: inner.x + auto.x, y: inner.y + auto.y } } };
  }, t('角度補正'), true);
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
    setBasic({ ...NEUTRAL, ...suggestion, temperature: b.temperature, tint: b.tint, vibrance: b.vibrance, saturation: b.saturation, vignette: b.vignette }, t('自動補正'));
    onToast(t('明るさを自動で整えました。'));
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
      onToast(t('LUT「{0}」を読み込みました。', lut.name));
    } catch (e) { onToast((e as Error).message || t('LUT を読み込めませんでした。')); }
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
    onToast(t('プリセット「{0}」を保存しました。', name));
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
    insertLayer(newRaster(d, uniqueName(d.layers, t('ペースト')), c => c.drawImage(clip.canvas, 0, 0)), t('ペースト'));
  }, [insertLayer, newRaster]);
  const addImages = useCallback(async (files: File[]) => {
    const layers: RasterLayer[] = [];
    for (const file of files.filter(isImageFile)) {
      try {
        const image = await decode(file);
        try {
          const d = historyRef.current?.present;
          if (!d || !mounted.current) return;
          const scale = Math.min(1, d.width / image.width, d.height / image.height);
          const w = Math.max(1, Math.round(image.width * scale)), h = Math.max(1, Math.round(image.height * scale));
          const layer = newRaster(d, baseName(file.name), c => c.drawImage(image, Math.round((d.width - w) / 2), Math.round((d.height - h) / 2), w, h));
          layers.push(layer);
        } finally { image.close(); }
      } catch (e) { onToast((e as Error).message); }
    }
    if (!layers.length || !mounted.current) return;
    change(d => { const next = [...d.layers]; next.splice(next.findIndex(l => l.id === d.selected) + 1, 0, ...layers); return { ...d, layers: next, selected: layers[layers.length - 1].id }; }, t('画像を追加'));
    setMultiIds(layers.map(layer => layer.id)); setTab('layers'); setTool('move');
  }, [newRaster, change, onToast, setTab, setTool]);
  const addImage = useCallback((file: File) => addImages([file]), [addImages]);

  const arrange = () => {
    const d = historyRef.current?.present;
    if (!d) return;
    // The chosen layers, or every image layer when fewer than two are chosen (except a background filling the
    // whole canvas). They are laid out in the order the layer list shows them, top first.
    const candidates = d.layers.filter(layer => layer.kind === 'raster' && layer.visible);
    const chosen = candidates.filter(layer => selectedIds.includes(layer.id));
    const images = (chosen.length >= 2 ? chosen : candidates.filter((layer, index) => !(index === 0 && d.layers[0] === layer && coversCanvas(layer as RasterLayer, d, store)))).reverse();
    if (images.length < 2) { onToast(t('配置する画像レイヤーが2枚以上必要です')); return; }
    const sources = images.map(layer => {
      const source = store.get(layer.id)!;
      const data = source.getContext('2d')!.getImageData(0, 0, source.width, source.height).data;
      let left = source.width, top = source.height, right = -1, bottom = -1;
      for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) if (data[(y * source.width + x) * 4 + 3]) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
      return { source, x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
    });
    if (sources.some(source => source.w <= 0 || source.h <= 0)) { onToast(t('空の画像レイヤーは配置できません')); return; }
    const positions = arrangeImages(sources, d.width, d.height) as Box[];
    const replacements = new Map<string, RasterLayer>();
    images.forEach((layer, i) => {
      const source = sources[i], position = positions[i];
      const next = newRaster(d, layer.name, c => c.drawImage(source.source, source.x, source.y, source.w, source.h, position.x, position.y, position.w, position.h));
      if (layer.mask) {
        const mask = store.get(maskKey(layer.id));
        const rev = store.create(maskKey(next.id), d.width, d.height);
        if (mask) store.context(maskKey(next.id)).drawImage(mask, source.x, source.y, source.w, source.h, position.x, position.y, position.w, position.h);
        next.mask = { ...layer.mask, rev };
      }
      replacements.set(layer.id, { ...next, opacity: layer.opacity, blend: layer.blend });
    });
    change(doc => ({ ...doc, layers: doc.layers.map(layer => replacements.get(layer.id) || layer), selected: replacements.get(doc.selected)?.id || doc.selected }), t('画像を自動配置'));
    setMultiIds(images.map(layer => replacements.get(layer.id)!.id));
  };

  const aiSubject = useCallback(() => {
    const d = historyRef.current?.present, source = work.current;
    if (!d || !source) return;
    void runAi(t('被写体を探しています…'), async () => {
      const next = combine(null, await subjectMask(source, d.width, d.height), 'new');
      if (!next) throw new Error(t('被写体が見つかりませんでした。'));
      setSelection(next);
    });
  }, [runAi, setSelection]);
  const aiSky = useCallback(() => {
    const d = historyRef.current?.present, source = work.current;
    if (!d || !source) return;
    const mask = skyMaskCanvas(source, d.width, d.height);
    const next = mask && combine(null, mask, 'new');
    if (!next) { onToast(t('空が見つかりませんでした。')); return; }
    setSelection(next);
    bumpOverlay();
  }, [setSelection, onToast]);
  const aiRemoveBackground = useCallback(() => {
    const d = historyRef.current?.present;
    const layer = d?.layers.find(l => l.id === d.selected);
    const source = layer && cache.source(layer, store);
    if (!d || !layer || !source) return;
    const full = makeCanvas(d.width, d.height);
    full.getContext('2d')!.drawImage(source.canvas, source.x, source.y);
    void runAi(t('背景を見分けています…'), async () => {
      const matte = await subjectMask(full, d.width, d.height);
      // The document may have changed while the model ran: use the layer as it is now.
      const now = historyRef.current?.present.layers.find(l => l.id === layer.id);
      if (!now) throw new Error(t('レイヤーが削除されたため、背景の削除を取り消しました。'));
      if (now.x !== layer.x || now.y !== layer.y) throw new Error(t('処理中にレイヤーが移動されたため、背景の削除を取り消しました。'));
      const key = maskKey(layer.id);
      if (now.mask && store.has(key)) {
        // Keep the existing mask and hide the background on top of it, as one undoable change.
        const rev = editSurface(store, key, { x: 0, y: 0, w: d.width, h: d.height }, c => { c.globalCompositeOperation = 'destination-in'; c.drawImage(matte, 0, 0); });
        if (rev !== null) updateLayer(layer.id, { mask: { rev, enabled: true } }, t('背景を削除'));
      } else {
        const rev = replaceMask(store, key, d.width, d.height, matte);
        if (rev !== null) updateLayer(layer.id, { mask: { rev, enabled: true } }, t('背景を削除'));
      }
      setTarget('mask');
      onToast(t('背景を隠すマスクを付けました。白のブラシで表示、黒のブラシで非表示に直せます。'));
    });
  }, [cache, store, runAi, updateLayer, onToast]);
  const aiFillSelection = useCallback(() => {
    const sel = selectionRef.current;
    if (!sel) { onToast(t('消したい範囲を選択してください。')); return; }
    if (aiBusyRef.current) { onToast(t('前の処理が終わるまでお待ちください。')); return; }
    const surface = surfaceFor(false, t('テキストや図形のレイヤーは、ラスタライズすると消去できます。'));
    if (!surface) return;
    if (surface.mask) { onToast(t('マスクでは不要物を消せません。画像のレイヤーを選んでください。')); return; }
    const target = store.get(surface.key)!;
    const mask = makeCanvas(target.width, target.height);
    mask.getContext('2d')!.drawImage(sel.mask, -surface.offset.x, -surface.offset.y);
    fillArea(surface.key, surface.layer.id, mask, { x: sel.bounds.x - surface.offset.x, y: sel.bounds.y - surface.offset.y, w: sel.bounds.w, h: sel.bounds.h }, t('選択範囲を消して埋める'));
  }, [store, surfaceFor, fillArea, onToast]);
  const aiUpscale = useCallback((factor: 2 | 4) => {
    const d = historyRef.current?.present;
    if (!d || !version) return;
    const image = fullImage();
    if (!image) return;
    void runAi(t('{0}倍に拡大しています…', factor), async progress => {
      const out = outputSize(d.geometry, d.width, d.height);
      const flat = makeCanvas(out.width, out.height);
      flat.getContext('2d')!.imageSmoothingQuality = 'high';
      drawGeometry(flat.getContext('2d')!, image, d, 0, 0, 1, 'output');
      const big = await upscale(flat, factor, progress);
      const blob = await toBlob(big, 'image/png');
      big.width = big.height = flat.width = flat.height = 0;
      onToast(t('{0}倍に拡大した画像を新しく追加しました。元の画像はそのまま残っています。', factor));
      onAddImage(new File([blob], `${baseName(project.name)} ×${factor}.png`, { type: 'image/png', lastModified: Date.now() }));
    }, true);
  }, [fullImage, version, runAi, onToast, onAddImage, project.name]);

  /** Image size scales every layer; canvas size adds or trims space around them. Every layer gets new surfaces
   *  (under new ids), so undo simply returns to the old ones. */
  const resizeDoc = useCallback(({ mode, width, height, anchor, fill }: ResizeRequest) => {
    const d = historyRef.current?.present;
    if (!d || (width === d.width && height === d.height)) return;
    const sx = width / d.width, sy = height / d.height, k = Math.sqrt(sx * sy);
    const dx = mode === 'canvas' ? Math.round((width - d.width) * anchor[0]) : 0, dy = mode === 'canvas' ? Math.round((height - d.height) * anchor[1]) : 0;
    const bottom = d.layers.find(layer => layer.kind === 'raster')?.id;
    const ids = new Map<string, string>();
    const redraw = (from: HTMLCanvasElement, key: string, before?: (c: CanvasRenderingContext2D) => void) => {
      const rev = store.create(key, width, height), c = store.context(key);
      before?.(c);
      if (mode === 'image') { c.imageSmoothingQuality = 'high'; c.drawImage(from, 0, 0, width, height); }
      else c.drawImage(from, dx, dy);
      return rev;
    };
    // New space: the bottom layer may be painted in the background colour; masks show it (white).
    const around = (color: string) => (c: CanvasRenderingContext2D) => { c.fillStyle = color; c.fillRect(0, 0, width, height); c.clearRect(dx, dy, d.width, d.height); };
    const layers = d.layers.map(layer => {
      const id = newLayerId();
      ids.set(layer.id, id);
      let next = { ...layer, id } as Layer;
      if (mode === 'image') next = { ...next, x: Math.round(layer.x * sx), y: Math.round(layer.y * sy) };
      else if (layer.kind !== 'raster') next = { ...next, x: layer.x + dx, y: layer.y + dy };
      if (mode === 'image' && next.kind === 'text') next = { ...next, text: { ...next.text, size: Math.max(1, Math.round(next.text.size * k)) } };
      if (mode === 'image' && next.kind === 'shape') next = { ...next, shape: { ...next.shape, w: Math.max(1, Math.round(next.shape.w * sx)), h: Math.max(1, Math.round(next.shape.h * sy)), strokeWidth: Math.max(1, Math.round(next.shape.strokeWidth * k)), radius: Math.round(next.shape.radius * k) } };
      if (layer.kind === 'raster') next = { ...next, rev: redraw(store.get(layer.id)!, id, mode === 'canvas' && fill && layer.id === bottom ? around(fill) : undefined) } as Layer;
      if (layer.mask) next = { ...next, mask: { ...layer.mask, rev: redraw(store.get(maskKey(layer.id))!, maskKey(id), mode === 'canvas' ? around('#fff') : undefined) } };
      return next;
    });
    const g = d.geometry, [fx, fy] = g.quarter % 2 ? [sy, sx] : [sx, sy];
    const geometry = mode === 'image' && g.crop ? { ...g, crop: { x: g.crop.x * fx, y: g.crop.y * fy, w: g.crop.w * fx, h: g.crop.h * fy } } : { ...g, crop: null };
    setSelection(null); cloneSource.current = null; cloneOffset.current = null;
    change(doc => ({ ...doc, width, height, layers, geometry, selected: ids.get(doc.selected) ?? layers[layers.length - 1].id }), mode === 'image' ? t('画像サイズを変更') : t('キャンバスサイズを変更'));
    onToast(t('{0}のサイズを {1} × {2} px にしました。', mode === 'image' ? t('画像') : t('キャンバス'), width, height));
  }, [store, change, setSelection, onToast]);

  const layerActions: LayerActions = useMemo(() => ({
    select: selectLayer,
    update: updateLayer,
    commit: endGesture,
    rename: (id, name) => updateLayer(id, { name }, t('名前を変更')),
    add: () => { const d = historyRef.current?.present; if (d) insertLayer(newRaster(d), t('新規レイヤー')); },
    importImage: () => void pickImages().then(addImages),
    arrange,
    duplicate: () => {
      const d = historyRef.current?.present;
      const layer = d?.layers.find(l => l.id === d.selected);
      if (!d || !layer) return;
      const id = newLayerId();
      let copyLayer = { ...layer, id, name: t('{0} のコピー', layer.name) } as Layer;
      if (layer.kind === 'raster') copyLayer = { ...copyLayer, rev: store.create(id, d.width, d.height, store.get(layer.id)) } as Layer;
      if (layer.mask) copyLayer = { ...copyLayer, mask: { ...layer.mask, rev: store.create(maskKey(id), d.width, d.height, store.get(maskKey(layer.id))) } };
      insertLayer(copyLayer, t('レイヤーを複製'));
    },
    remove: () => change(d => {
      if (d.layers.length < 2) return d;
      const index = d.layers.findIndex(l => l.id === d.selected);
      const layers = d.layers.filter(l => l.id !== d.selected);
      return { ...d, layers, selected: layers[Math.max(0, index - 1)].id };
    }, t('レイヤーを削除')),
    move: direction => change(d => {
      const index = d.layers.findIndex(l => l.id === d.selected), to = index + direction;
      if (to < 0 || to >= d.layers.length) return d;
      const layers = [...d.layers];
      [layers[index], layers[to]] = [layers[to], layers[index]];
      return { ...d, layers };
    }, direction > 0 ? t('レイヤーを上へ') : t('レイヤーを下へ')),
    reorder: (id, to) => change(d => {
      const from = d.layers.findIndex(l => l.id === id);
      if (from < 0 || to === from || to < 0 || to >= d.layers.length) return d;
      const layers = [...d.layers];
      layers.splice(to, 0, ...layers.splice(from, 1));
      return { ...d, layers };
    }, t('レイヤーを並び替え')),
    addMask: () => {
      const d = historyRef.current?.present;
      if (!d) return;
      const key = maskKey(d.selected);
      const sel = selectionRef.current;
      const rev = replaceMask(store, key, d.width, d.height, sel?.mask);
      if (rev === null) return;
      updateLayer(d.selected, { mask: { rev, enabled: true } }, sel ? t('選択範囲からマスク') : t('マスクを追加'));
      setTarget('mask');
    },
    removeMask: () => { const d = historyRef.current?.present; if (d) updateLayer(d.selected, { mask: undefined }, t('マスクを削除')); setTarget('layer'); },
    addAdjust: () => {
      const d = historyRef.current?.present;
      if (!d) return;
      const id = newLayerId();
      const rev = createMask(store, maskKey(id), d.width, d.height, selectionRef.current?.mask);
      const layer: AdjustLayer = { kind: 'adjust', id, name: uniqueName(d.layers, t('調整レイヤー')), visible: true, opacity: 100, blend: 'source-over', x: 0, y: 0, basic: NEUTRAL, color: NEUTRAL_COLOR, mask: { rev, enabled: true } };
      insertLayer(layer, t('調整レイヤーを追加'));
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
      change(doc => ({ ...doc, selected: raster.id, layers: doc.layers.map(l => l.id === layer.id ? { ...raster, visible: l.visible, opacity: l.opacity, blend: l.blend, mask } : l) }), t('ラスタライズ'));
    },
  }), [selectLayer, updateLayer, endGesture, insertLayer, newRaster, addImages, change, store, cache, multiIds, doc]);

  /** Everything the feature search can find and run. */
  // Rendered once when the sheet opens (at full size, which can take a moment for large images).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const exportImage = useMemo(() => exporting && version ? fullImage() : null, [exporting, version, fullImage]);
  const latest = useRef<{ doc?: Doc; image?: HTMLCanvasElement }>({});
  latest.current = { doc, image: version ? adjuster.canvas : undefined };
  const dirty = !!doc && !!savedDoc && doc !== savedDoc;
  /** Saves the current edits, painted surfaces and a fresh thumbnail to the library. */
  const saveToLibrary = useCallback(async () => {
    const { doc: last, image } = latest.current;
    if (!last) return;
    await savePixels();
    let thumb: Blob | undefined;
    if (image) {
      const size = outputSize(last.geometry, last.width, last.height);
      const k = Math.min(1, 960 / Math.max(size.width, size.height));
      const target = makeCanvas(Math.max(1, Math.round(size.width * k)), Math.max(1, Math.round(size.height * k)));
      drawGeometry(target.getContext('2d')!, image, last, 0, 0, k, 'output');
      const bitmap = await createImageBitmap(target);
      thumb = await thumbnail(bitmap).catch(() => undefined).finally(() => bitmap.close());
    }
    onUpdate({ ...projectRef.current, ...(thumb ? { thumbnail: thumb } : {}), edits: savedEdits(last), edited: Date.now() });
    setSavedDoc(last);
  }, [savePixels, onUpdate, setSavedDoc]);
  const save = useCallback(() => { void saveToLibrary().then(() => onToast(t('保存しました。'))); }, [saveToLibrary, onToast]);
  /** Going back asks first when there are unsaved changes. */
  const requestClose = useCallback(() => { if (dirty) setClosing(true); else onClose(); }, [dirty, onClose]);

  const commands = useMemo((): Command[] => {
    if (!history || !palette) return [];
    const d = history.present;
    const layer = d.layers.find(l => l.id === d.selected);
    const noSelection = selection ? undefined : t('選択範囲がありません');
    const geometry = (recipe: (doc: Doc) => Doc['geometry'], label: string) => () => change(doc => ({ ...doc, geometry: recipe(doc) }), label);
    const list: Command[] = [
      // Image
      { id: 'image-size', group: t('画像'), label: t('画像サイズを変更'), reading: 'ガゾウサイズヲヘンコウ', keywords: ['resize', 'image size', 'リサイズ', 'カクダイシュクショウ', 'カイゾウド', 'ピクセルスウ'], icon: Scaling, run: () => setResizing('image') },
      { id: 'canvas-size', group: t('画像'), label: t('キャンバスサイズを変更'), reading: 'キャンバスサイズヲヘンコウ', keywords: ['canvas size', 'ヨハク', 'ワク', 'ヒロゲル'], icon: Expand, run: () => setResizing('canvas') },
      { id: 'crop', group: t('画像'), label: t('切り抜きと回転'), reading: 'キリヌキトカイテン', keywords: ['crop', 'トリミング', 'カタムキ', 'straighten'], icon: Crop, shortcut: 'C', run: () => setTool('crop') },
      { id: 'rotate-left', group: t('画像'), label: t('左に90°回転'), reading: 'ヒダリニカイテン', keywords: ['rotate', 'カイテン'], icon: RotateCcw, run: geometry(doc => rotateQuarter(doc.geometry, -1, doc.width, doc.height), t('左に回転')) },
      { id: 'rotate-right', group: t('画像'), label: t('右に90°回転'), reading: 'ミギニカイテン', keywords: ['rotate', 'カイテン'], icon: RotateCw, run: geometry(doc => rotateQuarter(doc.geometry, 1, doc.width, doc.height), t('右に回転')) },
      { id: 'flip-h', group: t('画像'), label: t('左右反転'), reading: 'サユウハンテン', keywords: ['flip horizontal', 'mirror', 'ミラー', 'ハンテン'], icon: FlipHorizontal2, run: geometry(doc => flip(doc.geometry, 'h', doc.width, doc.height), t('左右反転')) },
      { id: 'flip-v', group: t('画像'), label: t('上下反転'), reading: 'ジョウゲハンテン', keywords: ['flip vertical', 'ハンテン'], icon: FlipVertical2, run: geometry(doc => flip(doc.geometry, 'v', doc.width, doc.height), t('上下反転')) },
      { id: 'auto', group: t('調整'), label: t('自動補正'), reading: 'ジドウホセイ', keywords: ['auto', 'オート', 'アカルサ'], icon: Wand2, run: () => { setTab('adjust'); auto(); } },
      { id: 'adjust', group: t('調整'), label: t('色と明るさを調整'), reading: 'イロトアカルサヲチョウセイ', keywords: ['adjust', 'ロウコウ', 'コントラスト', 'カーブ', 'トーンカーブ', 'レベル', 'HSL', 'LUT', 'ホワイトバランス', 'サイド', 'プリセット'], icon: SlidersHorizontal, run: () => setTab('adjust') },
      { id: 'adjust-reset', group: t('調整'), label: t('調整をリセット'), reading: 'チョウセイヲリセット', keywords: ['reset'], icon: RotateCcw, run: () => setAdjustState({ basic: NEUTRAL, color: NEUTRAL_COLOR }, t('調整をリセット')) },
      // AI
      { id: 'ai-subject', group: 'AI', label: t('被写体を選択'), reading: 'ヒシャタイヲセンタク', keywords: ['select subject', 'ジンブツ', 'ヒト'], icon: UserRound, run: aiSubject },
      { id: 'ai-sky', group: 'AI', label: t('空を選択'), reading: 'ソラヲセンタク', keywords: ['select sky'], icon: Mountain, run: aiSky },
      { id: 'ai-background', group: 'AI', label: t('背景を削除'), reading: 'ハイケイヲサクジョ', keywords: ['remove background', 'ハイケイトウカ', 'キリヌキ', 'トウメイ'], icon: Eraser, disabled: layer?.kind === 'adjust' ? t('画像のレイヤーを選んでください') : undefined, run: aiRemoveBackground },
      { id: 'ai-fill', group: 'AI', label: t('選択範囲を消して周りで埋める'), reading: 'センタクハンイヲケシテマワリデウメル', keywords: ['content aware fill', 'remove', 'フヨウブツ', 'ショウキョ'], icon: Wand2, shortcut: '⇧+Delete', disabled: noSelection, run: aiFillSelection },
      { id: 'ai-upscale-2', group: 'AI', label: t('2倍に高解像度化'), reading: 'ニバイニコウカイゾウドカ', keywords: ['upscale', 'super resolution', 'カクダイ', 'クッキリ'], icon: Sparkles, run: () => aiUpscale(2) },
      { id: 'ai-upscale-4', group: 'AI', label: t('4倍に高解像度化'), reading: 'ヨンバイニコウカイゾウドカ', keywords: ['upscale', 'super resolution', 'カクダイ', 'クッキリ'], icon: Sparkles, run: () => aiUpscale(4) },
      // Selection
      { id: 'select-all', group: t('選択'), label: t('すべて選択'), reading: 'スベテセンタク', keywords: ['select all', 'ゼンタイ'], icon: SquareDashed, shortcut: `${mod}+A`, run: () => selectionCommand('all') },
      { id: 'select-none', group: t('選択'), label: t('選択を解除'), reading: 'センタクヲカイジョ', keywords: ['deselect'], icon: SquareMinus, shortcut: `${mod}+D`, disabled: noSelection, run: () => selectionCommand('none') },
      { id: 'select-invert', group: t('選択'), label: t('選択範囲を反転'), reading: 'センタクハンイヲハンテン', keywords: ['invert selection'], icon: SquareDashed, shortcut: `${mod}+⇧+I`, disabled: noSelection, run: () => selectionCommand('invert') },
      { id: 'select-feather', group: t('選択'), label: t('選択範囲をぼかす（8px）'), reading: 'センタクハンイヲボカス', keywords: ['feather', 'ボカシ', 'フェザー'], icon: SquareDashed, disabled: noSelection, run: () => refine('feather', 8) },
      { id: 'select-expand', group: t('選択'), label: t('選択範囲を拡張（8px）'), reading: 'センタクハンイヲカクチョウ', keywords: ['expand', 'ヒロゲル'], icon: SquareDashed, disabled: noSelection, run: () => refine('expand', 8) },
      { id: 'select-contract', group: t('選択'), label: t('選択範囲を縮小（8px）'), reading: 'センタクハンイヲシュクショウ', keywords: ['contract', 'セバメル'], icon: SquareDashed, disabled: noSelection, run: () => refine('contract', 8) },
      // Edit
      { id: 'undo', group: t('編集'), label: t('元に戻す'), reading: 'モトニモドス', keywords: ['undo', 'トリケシ'], icon: Undo2, shortcut: `${mod}+Z`, disabled: history.past.length ? undefined : t('戻せる操作がありません'), run: () => apply(undo(historyRef.current!)) },
      { id: 'redo', group: t('編集'), label: t('やり直す'), reading: 'ヤリナオス', keywords: ['redo'], icon: Redo2, shortcut: `${mod}+⇧+Z`, disabled: history.future.length ? undefined : t('やり直せる操作がありません'), run: () => apply(redo(historyRef.current!)) },
      { id: 'copy', group: t('編集'), label: t('コピー'), keywords: ['copy'], icon: Copy, shortcut: `${mod}+C`, run: () => { if (copy()) onToast(t('コピーしました。')); } },
      { id: 'cut', group: t('編集'), label: t('カット'), keywords: ['cut', 'キリトリ'], icon: Scissors, shortcut: `${mod}+X`, disabled: noSelection, run: () => { if (copy()) fillSelection(null, t('カット')); } },
      { id: 'paste', group: t('編集'), label: t('貼り付け'), reading: 'ハリツケ', keywords: ['paste', 'ペースト'], icon: ClipboardPaste, shortcut: `${mod}+V`, disabled: clipboard.current ? undefined : t('コピーした内容がありません'), run: pasteInternal },
      { id: 'fill-fg', group: t('編集'), label: t('描画色で塗りつぶし'), reading: 'ビョウガショクデヌリツブシ', keywords: ['fill'], icon: PaintBucket, shortcut: 'Alt+Delete', run: () => fillSelection(colors[0], t('描画色で塗りつぶし')) },
      { id: 'fill-bg', group: t('編集'), label: t('背景色で塗りつぶし'), reading: 'ハイケイショクデヌリツブシ', keywords: ['fill'], icon: PaintBucket, shortcut: `${mod}+Delete`, run: () => fillSelection(colors[1], t('背景色で塗りつぶし')) },
      { id: 'clear', group: t('編集'), label: t('選択範囲を消去'), reading: 'センタクハンイヲショウキョ', keywords: ['delete', 'clear', 'ケス'], icon: Trash2, shortcut: 'Delete', disabled: noSelection, run: () => fillSelection(null, t('消去')) },
      { id: 'swap-colors', group: t('編集'), label: t('描画色と背景色を入れ替え'), reading: 'ビョウガショクトハイケイショクヲイレカエ', keywords: ['swap colors', 'イロ'], icon: PaintBucket, shortcut: 'X', run: () => setColors(([a, b]) => [b, a]) },
      // Layers
      { id: 'layer-new', group: t('レイヤー'), label: t('新規レイヤー'), reading: 'シンキレイヤー', keywords: ['new layer', 'ツイカ'], icon: Plus, shortcut: '⇧+N', run: layerActions.add },
      { id: 'layer-image', group: t('レイヤー'), label: t('画像をレイヤーとして追加'), reading: 'ガゾウヲレイヤートシテツイカ', keywords: ['place image', 'import', 'ヨミコミ', 'ハメコミ'], icon: ImagePlus, run: layerActions.importImage },
      { id: 'layer-duplicate', group: t('レイヤー'), label: t('レイヤーを複製'), reading: 'レイヤーヲフクセイ', keywords: ['duplicate', 'コピー'], icon: Copy, shortcut: `${mod}+J`, run: layerActions.duplicate },
      { id: 'layer-delete', group: t('レイヤー'), label: t('レイヤーを削除'), reading: 'レイヤーヲサクジョ', keywords: ['delete layer'], icon: Trash2, disabled: d.layers.length < 2 ? t('最後のレイヤーは削除できません') : undefined, run: layerActions.remove },
      { id: 'layer-up', group: t('レイヤー'), label: t('レイヤーを上へ'), reading: 'レイヤーヲウエヘ', keywords: ['bring forward', 'ジュンバン'], icon: ArrowUp, run: () => layerActions.move(1) },
      { id: 'layer-down', group: t('レイヤー'), label: t('レイヤーを下へ'), reading: 'レイヤーヲシタヘ', keywords: ['send backward', 'ジュンバン'], icon: ArrowDown, run: () => layerActions.move(-1) },
      { id: 'mask-add', group: t('レイヤー'), label: selection ? t('選択範囲からマスクを追加') : t('マスクを追加'), reading: 'マスクヲツイカ', keywords: ['layer mask'], icon: Layers, disabled: layer?.mask ? t('すでにマスクがあります') : undefined, run: layerActions.addMask },
      { id: 'mask-remove', group: t('レイヤー'), label: t('マスクを削除'), reading: 'マスクヲサクジョ', keywords: ['delete mask'], icon: Layers, disabled: layer?.mask ? undefined : t('マスクがありません'), run: layerActions.removeMask },
      { id: 'adjust-layer', group: t('レイヤー'), label: t('調整レイヤーを追加'), reading: 'チョウセイレイヤーヲツイカ', keywords: ['adjustment layer', 'ブブンホセイ'], icon: SlidersHorizontal, run: layerActions.addAdjust },
      { id: 'rasterize', group: t('レイヤー'), label: t('ラスタライズ'), keywords: ['rasterize', 'ガゾウカ'], icon: Layers, disabled: layer?.kind === 'text' || layer?.kind === 'shape' ? undefined : t('テキストか図形のレイヤーを選んでください'), run: layerActions.rasterize },
      // View
      { id: 'zoom-in', group: t('表示'), label: t('ズームイン'), keywords: ['zoom in', 'カクダイ'], icon: ZoomIn, shortcut: `${mod}+=`, run: () => view && zoomTo(stepZoom(view.scale, 1)) },
      { id: 'zoom-out', group: t('表示'), label: t('ズームアウト'), keywords: ['zoom out', 'シュクショウ'], icon: ZoomOut, shortcut: `${mod}+−`, run: () => view && zoomTo(stepZoom(view.scale, -1)) },
      { id: 'zoom-fit', group: t('表示'), label: t('画面に合わせる'), reading: 'ガメンニアワセル', keywords: ['fit', 'ゼンタイ'], icon: Maximize, shortcut: `${mod}+0`, run: fit },
      { id: 'zoom-100', group: t('表示'), label: t('100% で表示'), reading: 'ヒャクパーセントデヒョウジ', keywords: ['actual size', 'ジッサイノサイズ', 'トウバイ'], icon: Search, shortcut: `${mod}+1`, run: () => zoomTo(1) },
      { id: 'panel-layers', group: t('表示'), label: t('レイヤーパネル'), keywords: ['layers'], icon: Layers, run: () => setTab('layers') },
      { id: 'panel-history', group: t('表示'), label: t('履歴'), reading: 'リレキ', keywords: ['history'], icon: HistoryIcon, run: () => setTab('history') },
      { id: 'panel-info', group: t('表示'), label: t('画像の情報'), reading: 'ガゾウノジョウホウ', keywords: ['info', 'ヒストグラム', 'サイズ'], icon: Info, run: () => setTab('info') },
      { id: 'panel-ai', group: t('表示'), label: t('AI パネル'), keywords: ['ai'], icon: Sparkles, run: () => setTab('ai') },
      // File
      { id: 'export', group: t('ファイル'), label: t('書き出し'), reading: 'カキダシ', keywords: ['export', 'save', 'ホゾン', 'PNG', 'JPEG', 'WebP', 'ダウンロード'], icon: Download, shortcut: `${mod}+⇧+E`, run: () => setExporting(true) },
      { id: 'save-psd', group: t('ファイル'), label: t('PSD として保存'), reading: 'ピーエスディートシテホゾン', keywords: ['psd', 'photoshop', 'フォトショップ'], icon: FileDown, run: () => void saveProject('psd') },
      { id: 'save-imagee', group: t('ファイル'), label: t('.imagee として保存'), reading: 'イメージートシテホゾン', keywords: ['project', 'プロジェクト'], icon: FileDown, run: () => void saveProject('imagee') },
      { id: 'library', group: t('ファイル'), label: t('ライブラリに戻る'), reading: 'ライブラリニモドル', keywords: ['back', 'close', 'トジル'], icon: ArrowLeft, run: requestClose },
      { id: 'save', group: t('ファイル'), label: t('保存'), reading: 'ホゾン', keywords: ['save', 'ホゾン'], icon: Save, shortcut: `${mod}+S`, run: save },
      { id: 'settings', group: t('ファイル'), label: t('設定'), reading: 'セッテイ', keywords: ['settings', 'preferences', 'テーマ', 'ダークモード'], icon: Settings, run: onSettings },
      { id: 'help', group: t('ヘルプ'), label: t('ヘルプとショートカット'), keywords: ['help', 'ツカイカタ', 'ショートカット', 'キー'], icon: CircleHelp, shortcut: '?', run: () => setHelp(true) },
    ];
    for (const tool of TOOLS) list.push({ id: `tool-${tool.id}`, group: t('ツール'), label: tool.label.replace(/\s*[（(].*[）)]/, ''), ...TOOL_SEARCH[tool.id], icon: tool.icon, shortcut: tool.key, run: () => setTool(tool.id) });
    return list;
  }, [palette, history, selection, view, colors, change, apply, setTool, setTab, auto, setAdjustState, aiSubject, aiSky, aiRemoveBackground, aiFillSelection, aiUpscale, selectionCommand, refine, copy, fillSelection, pasteInternal, layerActions, zoomTo, fit, saveProject, requestClose, save, onSettings, onToast]);

  // Keep this image's history for the rest of the session, saved or not.
  useEffect(() => () => {
    const history = historyRef.current, saved = savedRef.current;
    if (!history || !saved) return;
    sessions.delete(project.id);
    sessions.set(project.id, { history, store, saved });
    for (const id of sessions.keys()) if (sessions.size > SESSIONS) sessions.delete(id);
  }, [store]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    if (platform === 'web') addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if ((event.target as HTMLElement)?.closest?.('input, textarea')) return;
      const files = [...(event.clipboardData?.files || [])].filter(isImageFile);
      const file = files[0];
      const clip = clipboard.current;
      event.preventDefault();
      // Our own copy comes back from the system clipboard too; paste it in place rather than centred.
      if (file && !(clip && file.type === 'image/png' && file.size && clipboardStamp.current === file.size)) void addImage(file);
      else if (clip) pasteInternal();
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, [addImages, pasteInternal]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest('input:not([type=range]):not([type=color]), select, textarea, dialog')) return;
      // A focused slider keeps its own arrow, Home/End and Page keys; Delete must not erase the image either.
      if ((event.target as HTMLElement)?.matches?.('input[type=range]') && /^(arrow|home|end|page|delete|backspace)/i.test(event.key)) return;
      const command = event.metaKey || event.ctrlKey, key = event.key.toLowerCase();
      const h = historyRef.current;
      if ((command && (key === 'k' || key === 'f')) || key === 'f1') { event.preventDefault(); if (key === 'f1') setHelp(true); else setPalette(true); return; }
      if (!command && event.key === '?') { event.preventDefault(); setHelp(true); return; }
      if (command && key === 'z') { event.preventDefault(); if (h && !action.current) apply(event.shiftKey ? redo(h) : undo(h)); }
      else if (command && key === 'y') { event.preventDefault(); if (h && !action.current) apply(redo(h)); }
      else if (command && (key === '=' || key === '+')) { event.preventDefault(); if (view) zoomTo(stepZoom(view.scale, 1)); }
      else if (command && key === '-') { event.preventDefault(); if (view) zoomTo(stepZoom(view.scale, -1)); }
      else if (command && key === '0') { event.preventDefault(); fit(); }
      else if (command && key === '1') { event.preventDefault(); zoomTo(1); }
      else if (command && event.shiftKey && key === 'e') { event.preventDefault(); setExporting(true); }
      else if (command && !event.shiftKey && key === 's') { event.preventDefault(); save(); }
      else if (command && event.shiftKey && key === 'i') { event.preventDefault(); selectionCommand('invert'); }
      else if (command && key === 'a') { event.preventDefault(); selectionCommand('all'); }
      else if (command && key === 'd') { event.preventDefault(); selectionCommand('none'); }
      else if (command && key === 'j') {
        event.preventDefault();
        if (selectionRef.current && copy()) pasteInternal(); else layerActions.duplicate();
      }
      else if (command && key === 'c') { event.preventDefault(); if (copy()) onToast(t('コピーしました。')); }
      else if (command && key === 'x') { event.preventDefault(); if (copy()) fillSelection(null, t('カット')); }
      else if (command && key === 'backspace') { event.preventDefault(); fillSelection(colors[1], t('背景色で塗りつぶし')); }
      else if (command) return;
      else if (event.altKey && key === 'backspace') { event.preventDefault(); fillSelection(colors[0], t('描画色で塗りつぶし')); }
      else if (event.shiftKey && (key === 'delete' || key === 'backspace')) { event.preventDefault(); aiFillSelection(); }
      else if (key === 'delete' || key === 'backspace') { event.preventDefault(); if (selectionRef.current) fillSelection(null, t('消去')); else onToast(t('消去する範囲を選択してください。')); }
      else if (key === ' ') { event.preventDefault(); setSpace(true); }
      else if (key === '\\') setBefore(true);
      else if (key === 'escape') { if (tool === 'crop') setTool('hand'); else selectionCommand('none'); }
      else if (key === 'enter' && tool === 'crop') setTool('hand');
      else if (key.startsWith('arrow') && tool === 'move' && h) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1, layer = h.present.layers.find(l => l.id === h.present.selected)!;
        const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0, dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
        updateLayer(layer.id, { x: layer.x + dx, y: layer.y + dy }, t('移動'), true);
      }
      else if (key === '[' || key === ']') {
        const which = tool === 'remove' ? 'heal' : tool === 'eraser' || tool === 'heal' || tool === 'clone' ? tool : 'brush', size = settings[which].size;
        setSettings({ [which]: { ...settings[which], size: Math.max(1, Math.min(500, Math.round(key === ']' ? size * 1.2 + 1 : size / 1.2 - 1))) } });
        bumpOverlay();
      }
      else if (key === 'x') setColors(([a, b]) => [b, a]);
      else if (key === 'd') setColors(['#000000', '#ffffff']);
      else if (event.shiftKey && key === 'n') layerActions.add();
      else {
        const next = ({ v: 'move', l: 'lasso', w: 'wand', b: 'brush', e: 'eraser', j: 'heal', r: 'remove', s: 'clone', i: 'eyedropper', t: 'text', u: 'shape', h: 'hand', z: 'zoom' } as Record<string, Tool>)[key]
          ?? (key === 'm' ? (tool === 'marquee' || event.shiftKey ? (tool === 'ellipse' ? 'marquee' : 'ellipse') : 'marquee') : undefined)
          ?? (key === 'g' ? (tool === 'fill' || event.shiftKey ? (tool === 'gradient' ? 'fill' : 'gradient') : 'fill') : undefined)
          ?? (key === 'c' ? (tool === 'crop' ? 'hand' : 'crop') : undefined);
        if (next) setTool(next);
      }
    };
    const up = (event: KeyboardEvent) => { if (event.key.startsWith('Arrow')) endGesture(); if (event.key === ' ') setSpace(false); if (event.key === '\\') setBefore(false); if (event.key === 'Shift' || event.key === 'Alt') bumpOverlay(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [view, zoomTo, fit, tool, setTool, apply, selectionCommand, copy, pasteInternal, fillSelection, layerActions, colors, settings, setSettings, updateLayer, onToast, aiFillSelection, endGesture, save]);
  if (error) return <div className="app editor"><div className="editor-error"><h2>{t('画像を開けませんでした')}</h2><p>{error}</p><button type="button" className="btn" onClick={onClose}><ArrowLeft size={16}/>{t('ライブラリに戻る')}</button></div></div>;
  if (!doc || !history || !output || !selected) return <div className="app editor"><div className="editor-loading"><span className="spinner" aria-hidden="true"/>{t('読み込み中…')}</div></div>;

  const shown = before ? { ...doc, adjust: { ...doc.adjust, vignette: 0 } } : doc;
  return <div className="app editor" data-tool={tool}>
    <header className="editor-bar">
      <div className="bar-group">
        <IconButton icon={ArrowLeft} label={t('ライブラリに戻る')} onClick={requestClose}/>
        <div className="doc-title"><strong>{project.name}</strong><span className="num">{output.width} × {output.height}</span></div>
      </div>
      <div className="bar-group">
        <IconButton icon={Undo2} label={t('元に戻す')} shortcut={`${mod}+Z`} disabled={!history.past.length} onClick={() => apply(undo(history))}/>
        <IconButton icon={Redo2} label={t('やり直す')} shortcut={`${mod}+⇧+Z`} disabled={!history.future.length} onClick={() => apply(redo(history))}/>
        <span className="zoom-group">
        <span className="bar-sep" aria-hidden="true"/>
        <IconButton icon={Minus} label={t('縮小')} shortcut={`${mod}+−`} onClick={() => view && zoomTo(stepZoom(view.scale, -1))}/>
        <button type="button" className="zoom-readout num" title={t('画面に合わせる')} onClick={fit}>{view ? formatZoom(view.scale) : '—'}</button>
        <IconButton icon={Plus} label={t('拡大')} shortcut={`${mod}+=`} onClick={() => view && zoomTo(stepZoom(view.scale, 1))}/>
        <IconButton icon={Maximize} label={t('画面に合わせる')} shortcut={`${mod}+0`} onClick={fit}/>
        </span>
      </div>
      <div className="bar-group end">
        <button type="button" className={`btn compare${before ? ' on' : ''}`} title={t('押している間、補正前を表示（\\\\ キー）')} aria-pressed={before}
          onPointerDown={() => setBefore(true)} onPointerUp={() => setBefore(false)} onPointerLeave={() => setBefore(false)}><SplitSquareHorizontal size={15} aria-hidden="true"/><span className="btn-label">{t('補正前')}</span></button>
        <button type="button" className="btn search-btn" title={t('機能を検索 ({0}+K)', mod)} onClick={() => setPalette(true)}><Search size={15} aria-hidden="true"/><span className="btn-label">{t('機能を検索')}</span><kbd className="kbd">{mod}+K</kbd></button>
        <IconButton icon={CircleHelp} label={t('ヘルプ')} shortcut="?" className="help-btn" onClick={() => setHelp(true)}/>
        <IconButton icon={Settings} label={t('設定')} className="settings-btn" onClick={onSettings}/>
        <button type="button" className="btn save-btn" title={t('ライブラリに保存 ({0}+S)', mod)} disabled={!dirty} onClick={save}><Save size={15} aria-hidden="true"/><span className="btn-label">{dirty ? t('保存') : t('保存済み')}</span></button>
        <button type="button" className="btn primary" title={t('書き出し ({0}+⇧+E)', mod)} onClick={() => setExporting(true)}><Download size={16} aria-hidden="true"/>{t('書き出し')}</button>
      </div>
    </header>
    <div className="editor-body">
      <ToolRail tool={tool} onTool={setTool} colors={colors} onColors={setColors}/>
      <div className="stage-wrap" onDragOver={event => { if ([...event.dataTransfer.items].some(item => item.kind === 'file')) event.preventDefault(); }}
        onDrop={event => { const files = [...event.dataTransfer.files].filter(isImageFile); if (files.length) { event.preventDefault(); void addImages(files); } }}>
        <Stage doc={shown} image={before ? work.current : (version ? adjuster.canvas : null)} imageVersion={version + (before ? 0.5 : 0)} view={view} tool={tool} spaceHeld={space} checkerboard={prefs.checkerboard}
          aspect={aspectRatio(aspectId)} onCrop={onCrop} onView={setView} onCursor={setCursor} onSize={setViewport} onTool={onTool} overlay={overlay} overlayVersion={overlayVersion + (selection ? 0.5 : 0)}/>
        {before && <div className="stage-badge">{t('補正前')}</div>}
        {aiBusy && tab !== 'ai' && <div className="ai-chip" role="status"><span className="spinner" aria-hidden="true"/><span>{aiBusy.label}{aiBusy.progress !== null && ` ${Math.round(aiBusy.progress * 100)}%`}</span><button type="button" className="btn ghost small" onClick={cancelAi}>{t('中止')}</button></div>}
        {!before && <ToolOptions tool={tool} settings={settings} onChange={setSettings} hasSelection={!!selection} onSelectionCommand={selectionCommand} onRefine={refine} hint={hint} onHelp={() => setHelp(true)}/>}
        {tool === 'crop' && <div className="crop-bar" role="toolbar" aria-label={t('切り抜き')}>
          <label className="select"><span>{t('比率')}</span><select value={aspectId} onChange={e => chooseAspect(e.target.value)}>{ASPECTS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
          <div className="crop-angle"><Slider label={t('角度')} value={doc.geometry.angle} min={-MAX_ANGLE} max={MAX_ANGLE} step={0.1} format={v => `${v.toFixed(1)}°`} centered onChange={straighten} onCommit={endGesture} onReset={() => straighten(0)}/></div>
          <IconButton icon={RotateCcw} label={t('左に90°回転')} onClick={() => change(d => ({ ...d, geometry: rotateQuarter(d.geometry, -1, d.width, d.height) }), t('左に回転'))}/>
          <IconButton icon={RotateCw} label={t('右に90°回転')} onClick={() => change(d => ({ ...d, geometry: rotateQuarter(d.geometry, 1, d.width, d.height) }), t('右に回転'))}/>
          <IconButton icon={FlipHorizontal2} label={t('左右反転')} onClick={() => change(d => ({ ...d, geometry: flip(d.geometry, 'h', d.width, d.height) }), t('左右反転'))}/>
          <IconButton icon={FlipVertical2} label={t('上下反転')} onClick={() => change(d => ({ ...d, geometry: flip(d.geometry, 'v', d.width, d.height) }), t('上下反転'))}/>
          <button type="button" className="btn" onClick={() => { setAspectId('free'); change(d => ({ ...d, geometry: IDENTITY }), t('切り抜きをリセット')); }}>{t('リセット')}</button>
          <button type="button" className="btn primary" onClick={() => setTool('hand')}><Check size={15} aria-hidden="true"/>{t('完了')}</button>
        </div>}
        {tool !== 'crop' && <div className="status-bar num" aria-live="off">
          <span>{view ? formatZoom(view.scale) : ''}</span>
          <span>{cursor ? `X ${cursor.x}  Y ${cursor.y}` : `${output.width} × ${output.height} px`}</span>
          {selection && <span>{t('選択 {0} × {1}', selection.bounds.w, selection.bounds.h)}</span>}
          <span>{selected.name}{target === 'mask' ? t('（マスク）') : ''}</span>
        </div>}
      </div>
      <aside className="inspector" aria-label={t('インスペクター')}>
        <div className="inspector-tabs" role="tablist">
          {([['layers', t('レイヤー'), Layers], ['adjust', t('調整'), SlidersHorizontal], ['ai', 'AI', Sparkles], ['history', t('履歴'), HistoryIcon], ['info', t('情報'), Info]] as const).map(([id, label, Icon]) =>
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} title={label} onClick={() => setTab(id)}><Icon size={15} aria-hidden="true"/><span>{label}</span></button>)}
        </div>
        <div className="inspector-body" data-dir={tabDir} key={tab}>
          {tab === 'adjust' && adjustTarget && <AdjustPanel layerName={adjustLayer?.name ?? null} basic={adjustTarget.basic} color={adjustTarget.color} accelerated={adjuster.accelerated} histogram={curveHistogram}
            cubes={cubes} presetSource={work.current} version={version} userPresets={userPresets}
            onBasic={setBasic} onColor={setColor} onState={setAdjustState} onCommit={endGesture} onAuto={auto} onReset={() => setAdjustState({ basic: NEUTRAL, color: NEUTRAL_COLOR }, t('調整をリセット'))}
            onImportLut={() => void importLut()} onRemoveLut={deleteLut} onSavePreset={savePreset} onDeletePreset={deletePreset} onEditImage={adjustLayer ? () => setEditImage(true) : undefined}/>}
          {tab === 'layers' && <LayersPanel doc={doc} store={store} cache={cache} selected={selected} target={target} onTarget={setTarget} actions={layerActions} editText={editText} selectedIds={selectedIds}/>}
          {tab === 'ai' && <AiPanel busy={aiBusy} hasSelection={!!selection} layerName={selected.name} canRemoveBackground={selected.kind !== 'adjust'} output={output}
            onSubject={aiSubject} onSky={aiSky} onRemoveBackground={aiRemoveBackground} onRemoveTool={() => setTool('remove')} onFillSelection={aiFillSelection} onUpscale={aiUpscale} onCancel={cancelAi}/>}
          {tab === 'history' && <HistoryPanel history={history} onJump={index => apply(jump(history, index))}/>}
          {tab === 'info' && <InfoPanel project={project} output={output} source={version ? adjuster.canvas : work.current} version={version}/>}
        </div>
      </aside>
    </div>
    {closing && <Modal title={t('変更を保存しますか？')} onClose={() => setClosing(false)}>
      <p className="modal-text">{t('「{0}」の変更は保存されていません。保存しなくても、アプリを閉じるまでは開き直して「やり直す」で戻せます。', project.name)}</p>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={() => setClosing(false)}>{t('キャンセル')}</button>
        <button type="button" className="btn" onClick={onClose}>{t('保存しない')}</button>
        <button type="button" className="btn primary" autoFocus onClick={() => void saveToLibrary().then(onClose)}>{t('保存')}</button>
      </div>
    </Modal>}
    {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)}/>}
    {help && <HelpSheet onClose={() => setHelp(false)} onSearch={() => { setHelp(false); setPalette(true); }}/>}
    {resizing && <ResizeSheet initial={resizing} width={doc.width} height={doc.height} background={colors[1]} onApply={resizeDoc} onClose={() => setResizing(null)}/>}
    {exporting && exportImage && <ExportSheet doc={doc} image={exportImage} name={project.name} onClose={() => setExporting(false)} onToast={onToast} onProject={saveProject}/>}
  </div>;
}

/** A layer mask starts fully white: everything visible. */

/** Sets a layer's mask surface to `source` (or all white). An existing surface is edited rather than replaced,
 *  so undo can still reach its earlier revisions. */
/** A raster layer that is opaque over the whole canvas, like a background. */
function coversCanvas(layer: RasterLayer, d: Doc, store: PixelStore): boolean {
  const surface = store.get(layer.id);
  if (!surface || layer.x !== 0 || layer.y !== 0 || surface.width < d.width || surface.height < d.height) return false;
  const c = surface.getContext('2d')!, w = d.width - 1, h = d.height - 1;
  return [[0, 0], [w, 0], [0, h], [w, h], [w >> 1, h >> 1]].every(([x, y]) => c.getImageData(x, y, 1, 1).data[3] === 255);
}

function replaceMask(store: PixelStore, key: string, width: number, height: number, source?: CanvasImageSource): number | null {
  if (!store.has(key)) return createMask(store, key, width, height, source);
  return editSurface(store, key, { x: 0, y: 0, w: width, h: height }, c => {
    c.globalCompositeOperation = 'copy';
    if (source) c.drawImage(source, 0, 0);
    else { c.fillStyle = '#fff'; c.fillRect(0, 0, width, height); }
  });
}

/** Every surface revision any state in the history points at, by surface key. */
function surfaceRevisions(history: History<Doc>): Map<string, Set<number>> {
  const refs = new Map<string, Set<number>>();
  const add = (key: string, rev: number) => { let set = refs.get(key); if (!set) refs.set(key, set = new Set()); set.add(rev); };
  for (const state of [...history.past.map(entry => entry.state), history.present, ...history.future.map(entry => entry.state)])
    for (const layer of state.layers) {
      if (layer.kind === 'raster') add(layer.id, layer.rev);
      if (layer.mask) add(maskKey(layer.id), layer.mask.rev);
    }
  return refs;
}

const GUIDE = '#ff3bd4';
/** Smart guides while moving: alignment lines, distances to neighbours, and the object's position and size. */
function drawGuides(c: CanvasRenderingContext2D, snap: Snap, px: number) {
  c.save();
  c.lineWidth = px; c.strokeStyle = GUIDE; c.fillStyle = GUIDE;
  for (const g of snap.guides) {
    c.setLineDash(g.kind === 'center' ? [6 * px, 4 * px] : []);
    c.beginPath();
    if (g.axis === 'x') { c.moveTo(g.at, g.from); c.lineTo(g.at, g.to); } else { c.moveTo(g.from, g.at); c.lineTo(g.to, g.at); }
    c.stroke();
  }
  c.setLineDash([]);
  const label = (text: string, x: number, y: number, fill = GUIDE) => {
    c.font = `600 ${11 * px}px Inter, system-ui, sans-serif`;
    const w = c.measureText(text).width + 10 * px, h = 16 * px;
    c.fillStyle = fill; c.beginPath(); c.roundRect(x - w / 2, y - h / 2, w, h, 5 * px); c.fill();
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, x, y + 0.5 * px);
  };
  for (const gap of snap.gaps) {
    if (gap.length < 1) continue;
    c.strokeStyle = GUIDE; c.globalAlpha = 0.85; c.beginPath();
    const tick = 4 * px;
    if (gap.axis === 'x') { c.moveTo(gap.from, gap.at); c.lineTo(gap.to, gap.at); c.moveTo(gap.from, gap.at - tick); c.lineTo(gap.from, gap.at + tick); c.moveTo(gap.to, gap.at - tick); c.lineTo(gap.to, gap.at + tick); }
    else { c.moveTo(gap.at, gap.from); c.lineTo(gap.at, gap.to); c.moveTo(gap.at - tick, gap.from); c.lineTo(gap.at + tick, gap.from); c.moveTo(gap.at - tick, gap.to); c.lineTo(gap.at + tick, gap.to); }
    c.stroke(); c.globalAlpha = 1;
    if ((gap.to - gap.from) / px > 28) label(`${gap.length}`, gap.axis === 'x' ? (gap.from + gap.to) / 2 : gap.at, gap.axis === 'x' ? gap.at : (gap.from + gap.to) / 2);
  }
  const b = snap.box;
  c.strokeStyle = GUIDE; c.lineWidth = 1.5 * px; c.strokeRect(b.x, b.y, b.w, b.h);
  label(`X ${Math.round(b.x)}  Y ${Math.round(b.y)}  ·  ${Math.round(b.w)} × ${Math.round(b.h)}`, b.x + b.w / 2, b.y + b.h + 16 * px, 'rgba(20,16,32,.88)');
  c.restore();
}
