import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Crop, Download, Eye, EyeOff, FlipHorizontal2, FlipVertical2, Hand, History as HistoryIcon, Info, Layers, Maximize, Minus, Plus, Redo2, RotateCcw, RotateCw, Settings2, SlidersHorizontal, Undo2, Wand2, ZoomIn, SplitSquareHorizontal } from 'lucide-react';
import type { Project } from '../store';
import { readSource } from '../store';
import { decode, histogram, thumbnail, canvas as makeCanvas, type Histogram } from '../imaging';
import type { Preferences } from '../lib/preferences.mjs';
import { centered, fitScale, formatZoom, stepZoom, zoomAt, type View } from '../lib/viewport.mjs';
import { commit, createHistory, entries, jump, redo, undo, type History } from '../lib/history.mjs';
import { formatBytes } from '../lib/files.mjs';
import { autoAdjust, CONTROLS, NEUTRAL, type Adjustments } from '../lib/adjust.mjs';
import { ASPECTS, autoCrop, fitAspect, flip, IDENTITY, MAX_ANGLE, orientedSize, outputSize, rotateQuarter, type Rect } from '../lib/geometry.mjs';
import { BLEND_MODES, composite, createDoc, drawGeometry, savedEdits, type Bitmaps, type Doc, type Layer } from './document';
import { Adjuster } from './gl';
import { contentSize, Stage, type Tool } from './Stage';
import { ExportSheet } from './ExportSheet';
import { IconButton, Kbd, Slider, mod } from '../ui';

type Tab = 'adjust' | 'layers' | 'history' | 'info';
interface Props { project: Project; prefs: Preferences; onClose: () => void; onUpdate: (project: Project) => void; onToast: (message: string) => void; onSettings: () => void }

export function Editor({ project, prefs, onClose, onUpdate, onToast, onSettings }: Props) {
  const [bitmaps, setBitmaps] = useState<Bitmaps | null>(null);
  const [history, setHistory] = useState<History<Doc> | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [tool, setToolState] = useState<Tool>('hand');
  const [space, setSpace] = useState(false);
  const [before, setBefore] = useState(false);
  const [tab, setTab] = useState<Tab>('adjust');
  const [aspectId, setAspectId] = useState('free');
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const adjuster = useMemo(() => new Adjuster(), []);
  const [flat, setFlat] = useState<HTMLCanvasElement | null>(null);
  const [version, setVersion] = useState(0);
  const merging = useRef<string | null>(null);
  const projectRef = useRef(project); projectRef.current = project;

  useEffect(() => {
    let cancelled = false, loaded: ImageBitmap | undefined;
    (async () => {
      const blob = await readSource(project.id);
      if (!blob) throw new Error('元の画像が見つかりません。ライブラリに追加し直してください。');
      loaded = await decode(blob);
      if (cancelled) return loaded.close();
      const id = 'background';
      setBitmaps(new Map([[id, loaded]]));
      setHistory(createHistory<Doc>(createDoc(loaded.width, loaded.height, id, project.edits)));
    })().catch(e => !cancelled && setError(e.message));
    return () => { cancelled = true; loaded?.close(); };
    // Only reload when a different image is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const doc = history?.present;
  const layersKey = doc?.layers;
  // Layers → flattened source → adjustments. The adjusted canvas is reused; `version` tells the stage to redraw.
  useEffect(() => {
    if (!doc || !bitmaps) return;
    const next = composite(doc, bitmaps, adjuster.maxSize);
    adjuster.setSource(next);
    setFlat(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layersKey, bitmaps, adjuster]);
  useEffect(() => { if (doc && flat) { adjuster.render(doc.adjust); setVersion(v => v + 1); } }, [doc?.adjust, flat, adjuster]); // eslint-disable-line react-hooks/exhaustive-deps

  // Autosave edits with the project so reopening restores them.
  const edits = useMemo(() => doc && savedEdits(doc), [doc?.layers, doc?.adjust, doc?.geometry]); // eslint-disable-line react-hooks/exhaustive-deps
  const firstEdits = useRef(true);
  useEffect(() => {
    if (!edits) return;
    if (firstEdits.current) { firstEdits.current = false; return; }
    const timer = setTimeout(() => onUpdate({ ...projectRef.current, edits, edited: Date.now() }), 400);
    return () => clearTimeout(timer);
  }, [edits, onUpdate]);

  const change = useCallback((recipe: (doc: Doc) => Doc, label: string, gesture = false) => {
    setHistory(h => h && commit(h, recipe(h.present), label, gesture && merging.current === label));
    merging.current = gesture ? label : null;
  }, []);
  const endGesture = useCallback(() => { merging.current = null; }, []);
  const updateLayer = useCallback((id: string, patch: Partial<Layer>, label: string, gesture = false) =>
    change(d => ({ ...d, layers: d.layers.map(layer => layer.id === id ? { ...layer, ...patch } : layer) }), label, gesture), [change]);
  const setAdjust = useCallback((patch: Partial<Adjustments>, label: string, gesture = false) => change(d => ({ ...d, adjust: { ...d.adjust, ...patch } }), label, gesture), [change]);

  const setTool = useCallback((next: Tool) => { setToolState(current => { if ((current === 'crop') !== (next === 'crop')) setView(null); return next; }); }, []);
  const fit = useCallback(() => {
    if (!doc || !viewport.width) return;
    const size = contentSize(doc, tool);
    setView(centered(size.width, size.height, viewport.width, viewport.height, fitScale(size.width, size.height, viewport.width, viewport.height, tool === 'crop' ? 72 : 48)));
  }, [doc, viewport, tool]);
  const zoomTo = useCallback((scale: number) => { if (view) setView(zoomAt(view, scale, viewport.width / 2, viewport.height / 2)); }, [view, viewport]);

  // Refit when the output size changes (crop, rotation) so the result is always framed.
  const output = doc ? outputSize(doc.geometry, doc.width, doc.height) : null;
  useEffect(() => { if (tool !== 'crop') setView(null); }, [output?.width, output?.height]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const auto = () => {
    if (!flat) return;
    const suggestion = autoAdjust(histogram(flat).l);
    setAdjust({ ...NEUTRAL, ...suggestion, temperature: doc!.adjust.temperature, tint: doc!.adjust.tint, vibrance: doc!.adjust.vibrance, saturation: doc!.adjust.saturation, vignette: doc!.adjust.vignette }, '自動補正');
    onToast('明るさを自動で整えました。');
  };

  // Save a thumbnail of the edited result when leaving the editor.
  const latest = useRef<{ doc?: Doc; image?: HTMLCanvasElement }>({});
  latest.current = { doc, image: version ? adjuster.canvas : undefined };
  useEffect(() => () => {
    const { doc: last, image } = latest.current;
    if (!last || !image) return;
    const size = outputSize(last.geometry, last.width, last.height);
    const k = Math.min(1, 960 / Math.max(size.width, size.height));
    const target = makeCanvas(Math.max(1, Math.round(size.width * k)), Math.max(1, Math.round(size.height * k)));
    drawGeometry(target.getContext('2d')!, image, last, 0, 0, k, 'output');
    void createImageBitmap(target).then(bitmap => thumbnail(bitmap).finally(() => bitmap.close())).then(blob => onUpdate({ ...projectRef.current, thumbnail: blob, edits: savedEdits(last), edited: Date.now() })).catch(() => {});
  }, [adjuster, onUpdate]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest('input:not([type=range]), select, textarea, dialog')) return;
      const command = event.metaKey || event.ctrlKey, key = event.key.toLowerCase();
      if (command && key === 'z') { event.preventDefault(); setHistory(h => h && (event.shiftKey ? redo(h) : undo(h))); }
      else if (command && key === 'y') { event.preventDefault(); setHistory(h => h && redo(h)); }
      else if (command && (key === '=' || key === '+')) { event.preventDefault(); if (view) zoomTo(stepZoom(view.scale, 1)); }
      else if (command && key === '-') { event.preventDefault(); if (view) zoomTo(stepZoom(view.scale, -1)); }
      else if (command && key === '0') { event.preventDefault(); fit(); }
      else if (command && key === '1') { event.preventDefault(); zoomTo(1); }
      else if (command && event.shiftKey && key === 'e') { event.preventDefault(); setExporting(true); }
      else if (command) return;
      else if (key === ' ') { event.preventDefault(); setSpace(true); }
      else if (key === '\\') setBefore(true);
      else if (key === 'h') setTool('hand');
      else if (key === 'z') setTool('zoom');
      else if (key === 'c') setTool(tool === 'crop' ? 'hand' : 'crop');
      else if ((key === 'enter' || key === 'escape') && tool === 'crop') setTool('hand');
    };
    const up = (event: KeyboardEvent) => { if (event.key === ' ') setSpace(false); if (event.key === '\\') setBefore(false); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [view, zoomTo, fit, tool, setTool]);

  if (error) return <div className="app editor"><div className="editor-error"><h2>画像を開けませんでした</h2><p>{error}</p><button type="button" className="btn" onClick={onClose}><ArrowLeft size={16}/>ライブラリに戻る</button></div></div>;
  if (!doc || !bitmaps || !history || !output) return <div className="app editor"><div className="editor-loading"><span className="spinner" aria-hidden="true"/>読み込み中…</div></div>;

  const selected = doc.layers.find(layer => layer.id === doc.selected) || doc.layers[0];
  const shown = before ? { ...doc, adjust: { ...doc.adjust, vignette: 0 } } : doc;
  return <div className="app editor" data-tool={tool}>
    <header className="editor-bar">
      <div className="bar-group">
        <IconButton icon={ArrowLeft} label="ライブラリに戻る" onClick={onClose}/>
        <div className="doc-title"><strong>{project.name}</strong><span className="num">{output.width} × {output.height}</span></div>
      </div>
      <div className="bar-group">
        <IconButton icon={Undo2} label="元に戻す" shortcut={`${mod}+Z`} disabled={!history.past.length} onClick={() => setHistory(undo(history))}/>
        <IconButton icon={Redo2} label="やり直す" shortcut={`${mod}+⇧+Z`} disabled={!history.future.length} onClick={() => setHistory(redo(history))}/>
        <span className="bar-sep" aria-hidden="true"/>
        <IconButton icon={Minus} label="縮小" shortcut={`${mod}+−`} onClick={() => view && zoomTo(stepZoom(view.scale, -1))}/>
        <button type="button" className="zoom-readout num" title="画面に合わせる" onClick={fit}>{view ? formatZoom(view.scale) : '—'}</button>
        <IconButton icon={Plus} label="拡大" shortcut={`${mod}+=`} onClick={() => view && zoomTo(stepZoom(view.scale, 1))}/>
        <IconButton icon={Maximize} label="画面に合わせる" shortcut={`${mod}+0`} onClick={fit}/>
      </div>
      <div className="bar-group end">
        <button type="button" className={`btn compare${before ? ' on' : ''}`} title="押している間、補正前を表示（\\ キー）" aria-pressed={before}
          onPointerDown={() => setBefore(true)} onPointerUp={() => setBefore(false)} onPointerLeave={() => setBefore(false)}><SplitSquareHorizontal size={15} aria-hidden="true"/>補正前</button>
        <IconButton icon={Settings2} label="設定" onClick={onSettings}/>
        <button type="button" className="btn primary" title={`書き出し (${mod}+⇧+E)`} onClick={() => setExporting(true)}><Download size={16} aria-hidden="true"/>書き出し</button>
      </div>
    </header>
    <div className="editor-body">
      <nav className="tool-rail" aria-label="ツール">
        <IconButton icon={Hand} label="手のひら" shortcut="H" active={tool === 'hand'} onClick={() => setTool('hand')}/>
        <IconButton icon={ZoomIn} label="ズーム（Alt で縮小）" shortcut="Z" active={tool === 'zoom'} onClick={() => setTool('zoom')}/>
        <IconButton icon={Crop} label="切り抜きと回転" shortcut="C" active={tool === 'crop'} onClick={() => setTool(tool === 'crop' ? 'hand' : 'crop')}/>
      </nav>
      <div className="stage-wrap">
        <Stage doc={shown} image={before ? flat : (version ? adjuster.canvas : null)} imageVersion={version + (before ? 0.5 : 0)} view={view} tool={tool} spaceHeld={space} checkerboard={prefs.checkerboard}
          aspect={aspectRatio(aspectId)} onCrop={onCrop} onView={setView} onCursor={setCursor} onSize={setViewport}/>
        {before && <div className="stage-badge">補正前</div>}
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
        </div>}
      </div>
      <aside className="inspector" aria-label="インスペクター">
        <div className="inspector-tabs" role="tablist">
          {([['adjust', '調整', SlidersHorizontal], ['layers', 'レイヤー', Layers], ['history', '履歴', HistoryIcon], ['info', '情報', Info]] as const).map(([id, label, Icon]) =>
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} title={label} onClick={() => setTab(id)}><Icon size={15} aria-hidden="true"/><span>{label}</span></button>)}
        </div>
        <div className="inspector-body">
          {tab === 'adjust' && <AdjustPanel adjust={doc.adjust} accelerated={adjuster.accelerated} onChange={setAdjust} onCommit={endGesture} onAuto={auto} onReset={() => setAdjust(NEUTRAL, '調整をリセット')}/>}
          {tab === 'layers' && <LayersPanel doc={doc} bitmaps={bitmaps} selected={selected} onSelect={id => change(d => ({ ...d, selected: id }), 'レイヤーを選択')} onUpdate={updateLayer} onCommit={endGesture}/>}
          {tab === 'history' && <HistoryPanel history={history} onJump={index => setHistory(jump(history, index))}/>}
          {tab === 'info' && <InfoPanel project={project} output={output} source={version ? adjuster.canvas : flat} version={version}/>}
        </div>
      </aside>
    </div>
    {exporting && version > 0 && <ExportSheet doc={doc} image={adjuster.canvas} name={project.name} onClose={() => setExporting(false)} onToast={onToast}/>}
  </div>;
}

const GROUPS = [['light', 'ライト'], ['color', 'カラー'], ['effects', '効果']] as const;
function AdjustPanel({ adjust, accelerated, onChange, onCommit, onAuto, onReset }: { adjust: Adjustments; accelerated: boolean; onChange: (patch: Partial<Adjustments>, label: string, gesture?: boolean) => void; onCommit: () => void; onAuto: () => void; onReset: () => void }) {
  const changed = CONTROLS.some(c => adjust[c.key] !== 0);
  return <div className="panel">
    <div className="panel-actions">
      <button type="button" className="btn" onClick={onAuto}><Wand2 size={15} aria-hidden="true"/>自動補正</button>
      <button type="button" className="btn ghost" disabled={!changed} onClick={onReset}>すべてリセット</button>
    </div>
    {GROUPS.map(([group, title]) => <section key={group} className="adjust-group" aria-label={title}>
      <h3>{title}</h3>
      {CONTROLS.filter(c => c.group === group).map(c => <Slider key={c.key} label={c.label} value={adjust[c.key]} min={c.min} max={c.max} step={c.step} centered
        format={c.key === 'exposure' ? v => `${v > 0 ? '+' : ''}${v.toFixed(2)}` : v => `${v > 0 ? '+' : ''}${v}`}
        onChange={value => onChange({ [c.key]: value }, c.label, true)} onCommit={onCommit} onReset={() => onChange({ [c.key]: 0 }, c.label)}/>)}
    </section>)}
    <p className="panel-note">スライダーをダブルクリックで元に戻せます。<Kbd>\</Kbd> を押している間は補正前を表示します。{accelerated ? '' : ' この環境では GPU を使えないため、表示が遅くなることがあります。'}</p>
  </div>;
}

function LayerThumb({ bitmap }: { bitmap?: ImageBitmap }) {
  const ref = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas || !bitmap) return;
    const ratio = Math.min(1, 80 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  }, [bitmap]);
  return <canvas ref={ref} className="layer-thumb" aria-hidden="true"/>;
}

function LayersPanel({ doc, bitmaps, selected, onSelect, onUpdate, onCommit }: { doc: Doc; bitmaps: Bitmaps; selected: Layer; onSelect: (id: string) => void; onUpdate: (id: string, patch: Partial<Layer>, label: string, gesture?: boolean) => void; onCommit: () => void }) {
  return <div className="panel">
    <div className="panel-section">
      <label className="field"><span>描画モード</span>
        <select value={selected.blend} onChange={e => onUpdate(selected.id, { blend: e.target.value as Layer['blend'] }, '描画モード')}>{BLEND_MODES.map(mode => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select>
      </label>
      <Slider label="不透明度" value={selected.opacity} min={0} max={100} unit="%" onChange={opacity => onUpdate(selected.id, { opacity }, '不透明度', true)} onCommit={onCommit} onReset={() => onUpdate(selected.id, { opacity: 100 }, '不透明度')}/>
    </div>
    <ul className="layer-list" aria-label="レイヤー">
      {[...doc.layers].reverse().map(layer => <li key={layer.id} className={layer.id === selected.id ? 'selected' : ''}>
        <button type="button" className="layer-main" aria-pressed={layer.id === selected.id} onClick={() => layer.id !== selected.id && onSelect(layer.id)}>
          <LayerThumb bitmap={bitmaps.get(layer.id)}/><span className="layer-name">{layer.name}</span>{layer.opacity < 100 && <span className="chip num">{layer.opacity}%</span>}
        </button>
        <IconButton icon={layer.visible ? Eye : EyeOff} label={layer.visible ? '非表示にする' : '表示する'} size={16} className={layer.visible ? '' : 'dim'} onClick={() => onUpdate(layer.id, { visible: !layer.visible }, layer.visible ? 'レイヤーを非表示' : 'レイヤーを表示')}/>
      </li>)}
    </ul>
  </div>;
}

function HistoryPanel({ history, onJump }: { history: History<Doc>; onJump: (index: number) => void }) {
  const list = entries(history);
  return <div className="panel"><ol className="history-list" aria-label="編集履歴">
    {list.map((entry, index) => <li key={index}><button type="button" className={`${entry.current ? 'current' : ''}${entry.future ? ' future' : ''}`} aria-current={entry.current ? 'step' : undefined} onClick={() => onJump(index)}>
      <span className="history-dot" aria-hidden="true"/>{entry.label}
    </button></li>)}
  </ol><p className="panel-note">履歴は回数無制限で、任意の時点に戻れます。編集内容は自動で保存されます。</p></div>;
}

function InfoPanel({ project, output, source, version }: { project: Project; output: { width: number; height: number }; source: HTMLCanvasElement | null; version: number }) {
  const [data, setData] = useState<Histogram | null>(null);
  useEffect(() => { if (!source) return; const timer = setTimeout(() => setData(histogram(source)), 120); return () => clearTimeout(timer); }, [source, version]);
  const megapixels = (output.width * output.height / 1e6).toFixed(1);
  const format = project.type.replace('image/', '').toUpperCase() || '—';
  return <div className="panel">
    {data && <HistogramChart data={data}/>}
    <dl className="info-list">
      <div><dt>出力サイズ</dt><dd className="num">{output.width} × {output.height} px</dd></div>
      <div><dt>画素数</dt><dd className="num">{megapixels} MP</dd></div>
      <div><dt>元のサイズ</dt><dd className="num">{project.width} × {project.height} px</dd></div>
      <div><dt>形式</dt><dd>{format}</dd></div>
      <div><dt>ファイルサイズ</dt><dd className="num">{formatBytes(project.size)}</dd></div>
      <div><dt>追加日</dt><dd className="num">{new Date(project.added).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' })}</dd></div>
    </dl>
  </div>;
}

function HistogramChart({ data }: { data: Histogram }) {
  const path = (channel: Uint32Array) => {
    let d = 'M0 100';
    for (let i = 0; i < 256; i++) d += ` L${(i / 255 * 256).toFixed(1)} ${(100 - Math.min(1, channel[i] / data.max) * 100).toFixed(1)}`;
    return `${d} L256 100 Z`;
  };
  return <figure className="histogram" aria-label="ヒストグラム">
    <svg viewBox="0 0 256 100" preserveAspectRatio="none" aria-hidden="true">
      <path d={path(data.l)} className="h-l"/><path d={path(data.r)} className="h-r"/><path d={path(data.g)} className="h-g"/><path d={path(data.b)} className="h-b"/>
    </svg>
    <figcaption>ヒストグラム（調整後）</figcaption>
  </figure>;
}
