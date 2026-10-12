import { ArrowLeftRight, Bandage, Blend, Brush, Circle, Crop, Eraser, Hand, Lasso, Move, PaintBucket, Pipette, Shapes, SquareDashed, Stamp, Type, WandSparkles, ZoomIn, type LucideIcon, BrushCleaning } from 'lucide-react';
import type { BrushOptions } from './tools';
import type { Refine, SelectMode } from './selection';
import { useState } from 'react';
import type { ShapeProps } from './document';
import type { Tool } from './Stage';
import { IconButton, Segmented, Slider, Toggle } from '../ui';

export interface ToolSettings {
  brush: BrushOptions; eraser: BrushOptions; heal: BrushOptions; clone: BrushOptions; cloneAll: boolean;
  selectMode: SelectMode; tolerance: number; contiguous: boolean;
  fillOpacity: number;
  gradient: 'linear' | 'radial'; gradientToTransparent: boolean;
  shape: ShapeProps['type']; shapeFill: boolean; shapeStroke: boolean; strokeWidth: number; radius: number;
}
export const DEFAULT_SETTINGS: ToolSettings = {
  brush: { size: 24, hardness: 80, opacity: 100, pressureSize: true },
  eraser: { size: 40, hardness: 90, opacity: 100, pressureSize: true },
  heal: { size: 30, hardness: 60, opacity: 100, pressureSize: false },
  clone: { size: 40, hardness: 50, opacity: 100, pressureSize: false },
  cloneAll: false,
  selectMode: 'new', tolerance: 32, contiguous: true,
  fillOpacity: 100,
  gradient: 'linear', gradientToTransparent: false,
  shape: 'rect', shapeFill: true, shapeStroke: false, strokeWidth: 6, radius: 0,
};
const SETTINGS_KEY = 'imagee-tool-settings';
export function loadSettings(): ToolSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { ...DEFAULT_SETTINGS, ...saved, brush: { ...DEFAULT_SETTINGS.brush, ...saved.brush }, eraser: { ...DEFAULT_SETTINGS.eraser, ...saved.eraser }, heal: { ...DEFAULT_SETTINGS.heal, ...saved.heal }, clone: { ...DEFAULT_SETTINGS.clone, ...saved.clone } };
  } catch { return DEFAULT_SETTINGS; }
}
export function storeSettings(settings: ToolSettings) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* Settings last for this session. */ } }

export const TOOLS: { id: Tool; label: string; key: string; icon: LucideIcon; gap?: boolean }[] = [
  { id: 'move', label: '移動', key: 'V', icon: Move },
  { id: 'marquee', label: '長方形選択', key: 'M', icon: SquareDashed },
  { id: 'ellipse', label: '楕円形選択', key: '⇧+M', icon: Circle },
  { id: 'lasso', label: 'なげなわ選択', key: 'L', icon: Lasso },
  { id: 'wand', label: '自動選択', key: 'W', icon: WandSparkles },
  { id: 'brush', label: 'ブラシ', key: 'B', icon: Brush, gap: true },
  { id: 'eraser', label: '消しゴム', key: 'E', icon: Eraser },
  { id: 'heal', label: 'スポット修復ブラシ', key: 'J', icon: Bandage },
  { id: 'remove', label: '不要物を消す（AI）', key: 'R', icon: BrushCleaning },
  { id: 'clone', label: 'コピースタンプ（Alt+クリックでコピー元）', key: 'S', icon: Stamp },
  { id: 'fill', label: '塗りつぶし', key: 'G', icon: PaintBucket },
  { id: 'gradient', label: 'グラデーション', key: '⇧+G', icon: Blend },
  { id: 'eyedropper', label: 'スポイト', key: 'I', icon: Pipette },
  { id: 'text', label: 'テキスト', key: 'T', icon: Type, gap: true },
  { id: 'shape', label: '図形', key: 'U', icon: Shapes },
  { id: 'crop', label: '切り抜きと回転', key: 'C', icon: Crop, gap: true },
  { id: 'hand', label: '手のひら', key: 'H', icon: Hand },
  { id: 'zoom', label: 'ズーム（Alt で縮小）', key: 'Z', icon: ZoomIn },
];

export function ToolRail({ tool, onTool, colors, onColors }: { tool: Tool; onTool: (tool: Tool) => void; colors: [string, string]; onColors: (colors: [string, string]) => void }) {
  return <nav className="tool-rail" aria-label="ツール">
    {TOOLS.map(t => <div key={t.id} className={t.gap ? 'rail-item gap' : 'rail-item'}>
      <IconButton icon={t.icon} label={t.label} shortcut={t.key} active={tool === t.id} onClick={() => onTool(tool === 'crop' && t.id === 'crop' ? 'hand' : t.id)}/>
    </div>)}
    <div className="swatches" role="group" aria-label="カラー">
      <label className="swatch fg" title="描画色" style={{ background: colors[0] }}><input type="color" value={colors[0]} aria-label="描画色" onChange={e => onColors([e.target.value, colors[1]])}/></label>
      <label className="swatch bg" title="背景色" style={{ background: colors[1] }}><input type="color" value={colors[1]} aria-label="背景色" onChange={e => onColors([colors[0], e.target.value])}/></label>
      <button type="button" className="swatch-swap" title="描画色と背景色を入れ替え (X)" aria-label="描画色と背景色を入れ替え" onClick={() => onColors([colors[1], colors[0]])}><ArrowLeftRight size={11} aria-hidden="true"/></button>
    </div>
  </nav>;
}

/** How each tool works. Shown above the canvas the first time a tool is picked, and always in the help. */
export const TOOL_HINTS: Record<Tool, string> = {
  move: 'ドラッグで選択中のレイヤーを移動します。矢印キーで 1px、Shift を押しながらで 10px ずつ動きます。',
  marquee: 'ドラッグで長方形の範囲を選択します。Shift で追加、Alt で除外できます。',
  ellipse: 'ドラッグで楕円形の範囲を選択します。Shift で追加、Alt で除外できます。',
  lasso: 'ドラッグして囲んだ範囲を選択します。',
  wand: 'クリックした場所と近い色の部分をまとめて選択します。許容値で広さを調整できます。',
  brush: 'ドラッグで描画色を塗ります。[ と ] キーでブラシのサイズを変えられます。',
  eraser: 'ドラッグした部分を透明にします。[ と ] キーでサイズを変えられます。',
  heal: '消したい部分をなぞると、周りから自然に補います。',
  remove: '消したいものを覆うようになぞると、周りの景色で埋めます。',
  clone: 'Alt+クリックでコピー元を指定し、ドラッグで描き写します。',
  fill: 'クリックした場所と近い色の部分を描画色で塗りつぶします。',
  gradient: 'ドラッグした向きに、描画色から背景色へのグラデーションを描きます。',
  eyedropper: 'クリックで描画色、Alt+クリックで背景色を取得します。',
  text: 'クリックで文字を追加します。既存のテキストをクリックすると編集できます。',
  shape: 'ドラッグで図形を描きます。色や大きさはあとから変えられます。',
  crop: '枠の角や辺をドラッグして切り抜きます。角度のスライダーで傾きを直せます。',
  hand: 'ドラッグで表示位置を移動します。ダブルクリックで全体を表示します。',
  zoom: 'クリックで拡大、Alt+クリックで縮小します。',
};

/** Tools seen before: their hint is not shown again (it stays in the help). */
const SEEN_KEY = 'imagee-seen-hints';
export function hintSeen(tool: Tool): boolean {
  try {
    const seen: string[] = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
    if (seen.includes(tool)) return true;
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, tool]));
  } catch { /* Without storage the hint shows once per session. */ }
  return false;
}

export function ToolOptions({ tool, settings, onChange, hasSelection, onSelectionCommand, onRefine, hint, onHelp }: { tool: Tool; settings: ToolSettings; onChange: (patch: Partial<ToolSettings>) => void; hasSelection: boolean; onSelectionCommand: (command: 'all' | 'none' | 'invert') => void; onRefine: (op: Refine, radius: number) => void; hint: boolean; onHelp: () => void }) {
  const [radius, setRadius] = useState(8);
  if (tool === 'crop') return null;
  const brushKey = tool === 'remove' ? 'heal' : tool === 'eraser' || tool === 'heal' || tool === 'clone' ? tool : 'brush';
  const brush = settings[brushKey];
  const setBrush = (patch: Partial<BrushOptions>) => onChange({ [brushKey]: { ...brush, ...patch } });
  let body: React.ReactNode = null;
  if (tool === 'brush' || tool === 'eraser' || tool === 'heal' || tool === 'remove' || tool === 'clone') body = <>
    <div className="opt-slider"><Slider label="サイズ" value={brush.size} min={1} max={500} unit="px" onChange={size => setBrush({ size })}/></div>
    <div className="opt-slider"><Slider label="硬さ" value={brush.hardness} min={0} max={100} unit="%" onChange={hardness => setBrush({ hardness })}/></div>
    {tool !== 'heal' && tool !== 'remove' && <div className="opt-slider"><Slider label="不透明度" value={brush.opacity} min={1} max={100} unit="%" onChange={opacity => setBrush({ opacity })}/></div>}
    {(tool === 'brush' || tool === 'eraser') && <label className="opt-toggle" title="ペンの筆圧でサイズを変える"><span>筆圧</span><Toggle label="筆圧でサイズを変える" checked={brush.pressureSize} onChange={pressureSize => setBrush({ pressureSize })}/></label>}
    {tool === 'clone' && <label className="opt-toggle" title="オフにすると選択中のレイヤーだけからコピー"><span>全レイヤーから</span><Toggle label="全レイヤーからコピー" checked={settings.cloneAll} onChange={cloneAll => onChange({ cloneAll })}/></label>}
  </>;
  else if (tool === 'marquee' || tool === 'ellipse' || tool === 'lasso' || tool === 'wand') body = <>
    <Segmented label="選択の方法" value={settings.selectMode} onChange={selectMode => onChange({ selectMode })} options={[
      { value: 'new', label: '新規' }, { value: 'add', label: '追加', title: 'Shift を押しながらでも追加' }, { value: 'subtract', label: '除外', title: 'Alt を押しながらでも除外' }, { value: 'intersect', label: '共通' }]}/>
    {tool === 'wand' && <div className="opt-slider"><Slider label="許容値" value={settings.tolerance} min={0} max={255} onChange={tolerance => onChange({ tolerance })}/></div>}
    {tool === 'wand' && <label className="opt-toggle"><span>隣接</span><Toggle label="隣接した部分のみ" checked={settings.contiguous} onChange={contiguous => onChange({ contiguous })}/></label>}
    <button type="button" className="btn ghost" onClick={() => onSelectionCommand('all')}>すべて選択</button>
    <button type="button" className="btn ghost" disabled={!hasSelection} onClick={() => onSelectionCommand('invert')}>反転</button>
    <button type="button" className="btn ghost" disabled={!hasSelection} onClick={() => onSelectionCommand('none')}>解除</button>
    {hasSelection && <span className="refine" role="group" aria-label="選択範囲を調整">
      <input type="number" className="num-input" min={1} max={500} value={radius} aria-label="調整する幅（px）" onChange={e => setRadius(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}/><span className="options-hint">px</span>
      <button type="button" className="btn ghost" onClick={() => onRefine('feather', radius)}>ぼかし</button>
      <button type="button" className="btn ghost" onClick={() => onRefine('expand', radius)}>拡張</button>
      <button type="button" className="btn ghost" onClick={() => onRefine('contract', radius)}>縮小</button>
    </span>}
  </>;
  else if (tool === 'fill') body = <>
    <div className="opt-slider"><Slider label="許容値" value={settings.tolerance} min={0} max={255} onChange={tolerance => onChange({ tolerance })}/></div>
    <div className="opt-slider"><Slider label="不透明度" value={settings.fillOpacity} min={1} max={100} unit="%" onChange={fillOpacity => onChange({ fillOpacity })}/></div>
    <label className="opt-toggle"><span>隣接</span><Toggle label="隣接した部分のみ" checked={settings.contiguous} onChange={contiguous => onChange({ contiguous })}/></label>
  </>;
  else if (tool === 'gradient') body = <>
    <Segmented label="グラデーションの形" value={settings.gradient} onChange={gradient => onChange({ gradient })} options={[{ value: 'linear', label: '線形' }, { value: 'radial', label: '円形' }]}/>
    <label className="opt-toggle"><span>透明へ</span><Toggle label="描画色から透明へ" checked={settings.gradientToTransparent} onChange={gradientToTransparent => onChange({ gradientToTransparent })}/></label>
    <div className="opt-slider"><Slider label="不透明度" value={settings.fillOpacity} min={1} max={100} unit="%" onChange={fillOpacity => onChange({ fillOpacity })}/></div>
  </>;
  else if (tool === 'shape') body = <>
    <Segmented label="図形の種類" value={settings.shape} onChange={shape => onChange({ shape })} options={[{ value: 'rect', label: '四角形' }, { value: 'ellipse', label: '楕円' }, { value: 'line', label: '線' }]}/>
    {settings.shape !== 'line' && <label className="opt-toggle"><span>塗り</span><Toggle label="塗り" checked={settings.shapeFill} onChange={shapeFill => onChange({ shapeFill })}/></label>}
    <label className="opt-toggle"><span>線</span><Toggle label="線" checked={settings.shapeStroke || settings.shape === 'line'} onChange={shapeStroke => onChange({ shapeStroke })}/></label>
    <div className="opt-slider"><Slider label="線の太さ" value={settings.strokeWidth} min={1} max={200} unit="px" onChange={strokeWidth => onChange({ strokeWidth })}/></div>
    {settings.shape === 'rect' && <div className="opt-slider"><Slider label="角の丸み" value={settings.radius} min={0} max={500} unit="px" onChange={radius => onChange({ radius })}/></div>}
  </>;
  const tip = hint && <span className="options-hint first-hint" key={`hint-${tool}`}>{TOOL_HINTS[tool]}<button type="button" className="link-btn" onClick={onHelp}>ヘルプ</button></span>;
  if (!body && !tip) return null;
  return <div className="tool-options" role="toolbar" aria-label="ツールの設定" key={tool}>{body}{tip}</div>;
}
