import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, Eye, EyeOff, Hand, History as HistoryIcon, Info, Layers, Maximize, Minus, Plus, Redo2, Settings2, Undo2, ZoomIn } from 'lucide-react';
import type { Project } from '../store';
import { readSource } from '../store';
import { decode, histogram, type Histogram } from '../imaging';
import type { Preferences } from '../lib/preferences.mjs';
import { centered, fitScale, formatZoom, stepZoom, zoomAt, type View } from '../lib/viewport.mjs';
import { commit, createHistory, entries, jump, redo, undo, type History } from '../lib/history.mjs';
import { formatBytes } from '../lib/files.mjs';
import { BLEND_MODES, type Bitmaps, type Doc, type Layer } from './document';
import { Stage, type Tool } from './Stage';
import { ExportSheet } from './ExportSheet';
import { IconButton, Slider, mod } from '../ui';

type Tab = 'layers' | 'history' | 'info';
interface Props { project: Project; prefs: Preferences; onClose: () => void; onUpdate: (project: Project) => void; onToast: (message: string) => void; onSettings: () => void }

export function Editor({ project, prefs, onClose, onToast, onSettings }: Props) {
  const [bitmaps, setBitmaps] = useState<Bitmaps | null>(null);
  const [history, setHistory] = useState<History<Doc> | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [tool, setTool] = useState<Tool>('hand');
  const [space, setSpace] = useState(false);
  const [tab, setTab] = useState<Tab>('layers');
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false, loaded: ImageBitmap | undefined;
    (async () => {
      const blob = await readSource(project.id);
      if (!blob) throw new Error('元の画像が見つかりません。ライブラリに追加し直してください。');
      loaded = await decode(blob);
      if (cancelled) return loaded.close();
      const id = 'background';
      setBitmaps(new Map([[id, loaded]]));
      setHistory(createHistory<Doc>({ width: loaded.width, height: loaded.height, layers: [{ id, name: '背景', visible: true, opacity: 100, blend: 'source-over' }], selected: id }));
    })().catch(e => !cancelled && setError(e.message));
    return () => { cancelled = true; loaded?.close(); };
  }, [project.id]);

  const doc = history?.present;
  const change = useCallback((next: Doc, label: string, merge = false) => setHistory(h => h && commit(h, next, label, merge)), []);
  const updateLayer = useCallback((id: string, patch: Partial<Layer>, label: string, merge = false) => {
    setHistory(h => h && commit(h, { ...h.present, layers: h.present.layers.map(layer => layer.id === id ? { ...layer, ...patch } : layer) }, label, merge));
  }, []);

  const fit = useCallback(() => { if (doc && viewport.width) setView(centered(doc.width, doc.height, viewport.width, viewport.height, fitScale(doc.width, doc.height, viewport.width, viewport.height))); }, [doc, viewport]);
  const zoomTo = useCallback((scale: number) => { if (view) setView(zoomAt(view, scale, viewport.width / 2, viewport.height / 2)); }, [view, viewport]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest('input, select, textarea, dialog')) return;
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
      else if (key === 'h') setTool('hand');
      else if (key === 'z') setTool('zoom');
    };
    const up = (event: KeyboardEvent) => { if (event.key === ' ') setSpace(false); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [view, zoomTo, fit]);

  if (error) return <div className="app editor"><div className="editor-error"><h2>画像を開けませんでした</h2><p>{error}</p><button type="button" className="btn" onClick={onClose}><ArrowLeft size={16}/>ライブラリに戻る</button></div></div>;
  if (!doc || !bitmaps || !history) return <div className="app editor"><div className="editor-loading"><span className="spinner" aria-hidden="true"/>読み込み中…</div></div>;

  const selected = doc.layers.find(layer => layer.id === doc.selected) || doc.layers[0];
  return <div className="app editor" data-tool={tool}>
    <header className="editor-bar">
      <div className="bar-group">
        <IconButton icon={ArrowLeft} label="ライブラリに戻る" onClick={onClose}/>
        <div className="doc-title"><strong>{project.name}</strong><span className="num">{doc.width} × {doc.height}</span></div>
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
        <IconButton icon={Settings2} label="設定" onClick={onSettings}/>
        <button type="button" className="btn primary" title={`書き出し (${mod}+⇧+E)`} onClick={() => setExporting(true)}><Download size={16} aria-hidden="true"/>書き出し</button>
      </div>
    </header>
    <div className="editor-body">
      <nav className="tool-rail" aria-label="ツール">
        <IconButton icon={Hand} label="手のひら" shortcut="H" active={tool === 'hand'} onClick={() => setTool('hand')}/>
        <IconButton icon={ZoomIn} label="ズーム（Alt で縮小）" shortcut="Z" active={tool === 'zoom'} onClick={() => setTool('zoom')}/>
      </nav>
      <div className="stage-wrap">
        <Stage doc={doc} bitmaps={bitmaps} view={view} tool={tool} spaceHeld={space} checkerboard={prefs.checkerboard} onView={setView} onCursor={setCursor} onSize={setViewport}/>
        <div className="status-bar num" aria-live="off">
          <span>{view ? formatZoom(view.scale) : ''}</span>
          <span>{cursor ? `X ${cursor.x}  Y ${cursor.y}` : `${doc.width} × ${doc.height} px`}</span>
        </div>
      </div>
      <aside className="inspector" aria-label="インスペクター">
        <div className="inspector-tabs" role="tablist">
          {([['layers', 'レイヤー', Layers], ['history', '履歴', HistoryIcon], ['info', '情報', Info]] as const).map(([id, label, Icon]) =>
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}><Icon size={15} aria-hidden="true"/>{label}</button>)}
        </div>
        <div className="inspector-body">
          {tab === 'layers' && <LayersPanel doc={doc} bitmaps={bitmaps} selected={selected} onSelect={id => change({ ...doc, selected: id }, 'レイヤーを選択')} onUpdate={updateLayer}/>}
          {tab === 'history' && <HistoryPanel history={history} onJump={index => setHistory(jump(history, index))}/>}
          {tab === 'info' && <InfoPanel project={project} bitmap={bitmaps.get(doc.layers[0].id)!}/>}
        </div>
      </aside>
    </div>
    {exporting && <ExportSheet doc={doc} bitmaps={bitmaps} name={project.name} onClose={() => setExporting(false)} onToast={onToast}/>}
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

function LayersPanel({ doc, bitmaps, selected, onSelect, onUpdate }: { doc: Doc; bitmaps: Bitmaps; selected: Layer; onSelect: (id: string) => void; onUpdate: (id: string, patch: Partial<Layer>, label: string, merge?: boolean) => void }) {
  return <div className="panel">
    <div className="panel-section">
      <label className="field"><span>描画モード</span>
        <select value={selected.blend} onChange={e => onUpdate(selected.id, { blend: e.target.value as Layer['blend'] }, '描画モード')}>{BLEND_MODES.map(mode => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select>
      </label>
      <Slider label="不透明度" value={selected.opacity} min={0} max={100} unit="%" onChange={opacity => onUpdate(selected.id, { opacity }, '不透明度', true)}/>
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
  </ol><p className="panel-note">履歴は回数無制限で、任意の時点に戻れます。</p></div>;
}

function InfoPanel({ project, bitmap }: { project: Project; bitmap: ImageBitmap }) {
  const data = useMemo(() => histogram(bitmap), [bitmap]);
  const megapixels = (project.width * project.height / 1e6).toFixed(1);
  const format = project.type.replace('image/', '').toUpperCase() || '—';
  return <div className="panel">
    <HistogramChart data={data}/>
    <dl className="info-list">
      <div><dt>サイズ</dt><dd className="num">{project.width} × {project.height} px</dd></div>
      <div><dt>画素数</dt><dd className="num">{megapixels} MP</dd></div>
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
    <figcaption>ヒストグラム</figcaption>
  </figure>;
}
