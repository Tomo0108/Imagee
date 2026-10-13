import { useEffect, useRef, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowUp, Bold, Copy, Eye, EyeOff, ImagePlus, Italic, Plus, SlidersHorizontal, SquareDashed, Trash2, Type, Wand2 } from 'lucide-react';
import type { Project } from '../store';
import { histogram, type Histogram } from '../imaging';
import { entries, type History } from '../lib/history.mjs';
import { formatBytes } from '../lib/files.mjs';
import { CONTROLS, type Adjustments } from '../lib/adjust.mjs';
import { isNeutralColor, type ColorOps } from '../lib/color.mjs';
import { CurveEditor, HslEditor, LevelsEditor, LutPicker, PresetStrip, type UserPreset } from './color-ui';
import { BLEND_MODES, FONTS, maskKey, type Doc, type Layer, type LayerCache, type ShapeProps, type TextProps } from './document';
import type { PixelStore } from './pixels';
import { IconButton, Kbd, Segmented, Slider, Toggle, mod } from '../ui';
import { t, lang } from '../i18n/index.mjs';

const GROUPS = [['light', t('ライト')], ['color', t('カラー')], ['effects', t('効果')]] as const;
interface AdjustProps {
  /** Name of the adjustment layer being edited, or null for the whole image. */
  layerName: string | null;
  basic: Adjustments; color: ColorOps; accelerated: boolean; histogram: Histogram | null;
  cubes: { id: string; name: string }[]; presetSource: HTMLCanvasElement | null; version: number;
  userPresets: UserPreset[];
  onBasic: (patch: Partial<Adjustments>, label: string, gesture?: boolean) => void;
  onColor: (color: ColorOps, label: string, gesture?: boolean) => void;
  onState: (state: { basic: Adjustments; color: ColorOps }, label: string) => void;
  onCommit: () => void; onAuto: () => void; onReset: () => void;
  onImportLut: () => void; onRemoveLut: (id: string) => void;
  onSavePreset: (name: string) => void; onDeletePreset: (id: string) => void;
  onEditImage?: () => void;
}
export function AdjustPanel(p: AdjustProps) {
  const { basic, color } = p;
  const changed = CONTROLS.some(c => basic[c.key] !== 0) || !isNeutralColor(color);
  const hslChanged = Object.values(color.hsl).some(s => s.h || s.s || s.l);
  const curvesChanged = (['rgb', 'r', 'g', 'b'] as const).some(c => color.curves[c].length !== 2 || color.curves[c][0][1] !== 0 || color.curves[c][1][1] !== 1 || color.curves[c][0][0] !== 0 || color.curves[c][1][0] !== 1);
  const l = color.levels, levelsChanged = l.inBlack !== 0 || l.inWhite !== 255 || l.gamma !== 1 || l.outBlack !== 0 || l.outWhite !== 255;
  return <div className="panel">
    {p.layerName && <div className="adjust-scope"><span>{t('調整レイヤー「{0}」を編集中', p.layerName)}</span>{p.onEditImage && <button type="button" className="btn ghost small" onClick={p.onEditImage}>{t('画像全体の調整へ')}</button>}</div>}
    <div className="panel-actions">
      <button type="button" className="btn" onClick={p.onAuto}><Wand2 size={15} aria-hidden="true"/>{t('自動補正')}</button>
      <button type="button" className="btn ghost" disabled={!changed} onClick={p.onReset}>{t('すべてリセット')}</button>
    </div>
    <details className="adjust-section" open>
      <summary>{t('プリセット')}</summary>
      <PresetStrip source={p.presetSource} version={p.version} current={{ basic, color }} onApply={(state, name) => p.onState(state, t('プリセット：{0}', name))} userPresets={p.userPresets} onSave={p.onSavePreset} onDelete={p.onDeletePreset}/>
    </details>
    {GROUPS.filter(([group]) => group !== 'effects' || !p.layerName).map(([group, title]) => <section key={group} className="adjust-group" aria-label={title}>
      <h3>{title}</h3>
      {CONTROLS.filter(c => c.group === group).map(c => <Slider key={c.key} label={c.label} value={basic[c.key]} min={c.min} max={c.max} step={c.step} centered
        format={c.key === 'exposure' ? v => `${v > 0 ? '+' : ''}${v.toFixed(2)}` : v => `${v > 0 ? '+' : ''}${v}`}
        onChange={value => p.onBasic({ [c.key]: value }, c.label, true)} onCommit={p.onCommit} onReset={() => p.onBasic({ [c.key]: 0 }, c.label)}/>)}
    </section>)}
    <details className="adjust-section" open={curvesChanged || undefined}>
      <summary>{t('トーンカーブ')}{curvesChanged && <span className="dot" aria-label={t('変更あり')}/>}</summary>
      <CurveEditor curves={color.curves} histogram={p.histogram} onChange={(curves, gesture) => p.onColor({ ...color, curves }, t('トーンカーブ'), gesture)} onCommit={p.onCommit}/>
    </details>
    <details className="adjust-section" open={levelsChanged || undefined}>
      <summary>{t('レベル補正')}{levelsChanged && <span className="dot" aria-label={t('変更あり')}/>}</summary>
      <LevelsEditor levels={color.levels} onChange={(levels, gesture) => p.onColor({ ...color, levels }, t('レベル補正'), gesture)} onCommit={p.onCommit}/>
    </details>
    <details className="adjust-section" open={hslChanged || undefined}>
      <summary>{t('HSL（色ごとの調整）')}{hslChanged && <span className="dot" aria-label={t('変更あり')}/>}</summary>
      <HslEditor hsl={color.hsl} onChange={(hsl, gesture) => p.onColor({ ...color, hsl }, 'HSL', gesture)} onCommit={p.onCommit}/>
    </details>
    <details className="adjust-section" open={!!color.lut || undefined}>
      <summary>{t('LUT（カラーグレーディング）')}{color.lut && <span className="dot" aria-label={t('変更あり')}/>}</summary>
      <LutPicker lut={color.lut} cubes={p.cubes} onChange={(lut, gesture) => p.onColor({ ...color, lut }, 'LUT', gesture)} onCommit={p.onCommit} onImport={p.onImportLut} onRemove={p.onRemoveLut}/>
    </details>
    <p className="panel-note">{t('スライダーをダブルクリックで元に戻せます。')}<Kbd>\</Kbd> {t('を押している間は補正前を表示します。{0}{1}', p.layerName ? t(' 調整レイヤーは下にあるレイヤーだけに効き、マスクで範囲を絞れます。') : '', p.accelerated ? '' : t(' この環境では GPU を使えないため、表示が遅くなることがあります。'))}</p>
  </div>;
}

/** Small preview of a surface; redrawn when `stamp` (the layer or its mask) changes. */
function Thumb({ source, stamp, active, label, onClick }: { source: (CanvasImageSource & { width: number; height: number }) | null | undefined; stamp: unknown; active?: boolean; label?: string; onClick?: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !source) return;
    const ratio = Math.min(1, 80 / Math.max(source.width, source.height));
    canvas.width = Math.max(1, Math.round(source.width * ratio)); canvas.height = Math.max(1, Math.round(source.height * ratio));
    const c = canvas.getContext('2d')!;
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.drawImage(source, 0, 0, canvas.width, canvas.height);
  }, [source, stamp]);
  const element = <canvas ref={ref} className={`layer-thumb${active ? ' target' : ''}`} aria-hidden="true"/>;
  return onClick ? <span role="button" tabIndex={-1} title={label} className="thumb-btn" onClick={event => { event.stopPropagation(); onClick(); }}>{element}</span> : element;
}

export interface LayerActions {
  select: (id: string) => void;
  update: (id: string, patch: Partial<Layer>, label: string, gesture?: boolean) => void;
  commit: () => void;
  add: () => void; importImage: () => void; duplicate: () => void; remove: () => void; move: (direction: 1 | -1) => void;
  addMask: () => void; removeMask: () => void; rasterize: () => void;
  addAdjust: () => void; editAdjust: () => void;
  rename: (id: string, name: string) => void;
}

export function LayersPanel({ doc, store, cache, selected, target, onTarget, actions, editText }: { doc: Doc; store: PixelStore; cache: LayerCache; selected: Layer; target: 'layer' | 'mask'; onTarget: (target: 'layer' | 'mask') => void; actions: LayerActions; editText: boolean }) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const index = doc.layers.indexOf(selected);
  return <div className="panel">
    <div className="layer-toolbar" role="toolbar" aria-label={t('レイヤー操作')}>
      <IconButton icon={Plus} label={t('新規レイヤー')} shortcut="⇧+N" size={16} onClick={actions.add}/>
      <IconButton icon={ImagePlus} label={t('画像をレイヤーとして追加')} size={16} onClick={actions.importImage}/>
      <IconButton icon={SlidersHorizontal} label={t('調整レイヤーを追加')} size={16} onClick={actions.addAdjust}/>
      <IconButton icon={Copy} label={t('レイヤーを複製')} shortcut={`${mod}+J`} size={16} onClick={actions.duplicate}/>
      <IconButton icon={SquareDashed} label={selected.mask ? t('マスクを削除') : t('マスクを追加（選択範囲があればその形）')} active={!!selected.mask} size={16} onClick={selected.mask ? actions.removeMask : actions.addMask}/>
      <IconButton icon={ArrowUp} label={t('上へ')} size={16} disabled={index === doc.layers.length - 1} onClick={() => actions.move(1)}/>
      <IconButton icon={ArrowDown} label={t('下へ')} size={16} disabled={index === 0} onClick={() => actions.move(-1)}/>
      <IconButton icon={Trash2} label={t('レイヤーを削除')} size={16} disabled={doc.layers.length < 2} onClick={actions.remove}/>
    </div>
    <ul className="layer-list" aria-label={t('レイヤー')}>
      {[...doc.layers].reverse().map(layer => <li key={layer.id} className={layer.id === selected.id ? 'selected' : ''}>
        <div className="layer-main" role="button" tabIndex={0} aria-pressed={layer.id === selected.id} onClick={() => layer.id !== selected.id && actions.select(layer.id)}
          onKeyDown={event => { if (event.key === 'Enter' && layer.id !== selected.id) actions.select(layer.id); }}
          onDoubleClick={() => setRenaming(layer.id)}>
          {layer.kind === 'adjust' ? <span className="layer-thumb adjust-thumb" aria-hidden="true"><SlidersHorizontal size={15}/></span> : <Thumb source={cache.source(layer, store)?.canvas} stamp={layer} active={layer.id === selected.id && !!layer.mask && target === 'layer'} label={t('レイヤーを編集')} onClick={layer.mask ? () => { actions.select(layer.id); onTarget('layer'); } : undefined}/>}
          {layer.mask && <Thumb source={store.get(maskKey(layer.id))} stamp={layer.mask} active={layer.id === selected.id && target === 'mask'} label={t('マスクを編集')} onClick={() => { actions.select(layer.id); onTarget('mask'); }}/>}
          {renaming === layer.id
            ? <input className="layer-rename" defaultValue={layer.name} autoFocus aria-label={t('レイヤー名')} onClick={e => e.stopPropagation()}
              onBlur={e => { setRenaming(null); if (e.target.value.trim() && e.target.value !== layer.name) actions.rename(layer.id, e.target.value.trim()); }}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = layer.name; e.currentTarget.blur(); } }}/>
            : <span className="layer-name">{layer.name}</span>}
          {layer.kind !== 'raster' && <span className="chip">{{ text: t('テキスト'), shape: t('図形'), adjust: t('調整') }[layer.kind]}</span>}
          {layer.mask && !layer.mask.enabled && <span className="chip">{t('マスク無効')}</span>}
          {layer.opacity < 100 && <span className="chip num">{layer.opacity}%</span>}
        </div>
        <IconButton icon={layer.visible ? Eye : EyeOff} label={layer.visible ? t('非表示にする') : t('表示する')} size={16} className={layer.visible ? '' : 'dim'} onClick={() => actions.update(layer.id, { visible: !layer.visible }, layer.visible ? t('レイヤーを非表示') : t('レイヤーを表示'))}/>
      </li>)}
    </ul>
    <div className="panel-section layer-props">
      <label className="field"><span>{t('描画モード')}</span>
        <select value={selected.blend} onChange={e => actions.update(selected.id, { blend: e.target.value as Layer['blend'] }, t('描画モード'))}>{BLEND_MODES.map(mode => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select>
      </label>
      <Slider label={t('不透明度')} value={selected.opacity} min={0} max={100} unit="%" onChange={opacity => actions.update(selected.id, { opacity }, t('不透明度'), true)} onCommit={actions.commit} onReset={() => actions.update(selected.id, { opacity: 100 }, t('不透明度'))}/>
      {selected.mask && <div className="field"><span>{t('マスクを使う')}</span><Toggle label={t('マスクを使う')} checked={selected.mask.enabled} onChange={enabled => actions.update(selected.id, { mask: { ...selected.mask!, enabled } }, enabled ? t('マスクを有効化') : t('マスクを無効化'))}/></div>}
      {selected.mask && <p className="panel-note tight">{target === 'mask' ? t('マスクを編集中：黒で塗ると隠れ、白で塗ると見えます。') : t('マスクのサムネールを押すとマスクを編集できます。')}</p>}
    </div>
    {selected.kind === 'text' && <TextEditor key={selected.id} text={selected.text} autoFocus={editText} onChange={(patch, label, gesture) => actions.update(selected.id, { text: { ...selected.text, ...patch } } as Partial<Layer>, label, gesture)} onCommit={actions.commit}/>}
    {selected.kind === 'shape' && <ShapeEditor shape={selected.shape} onChange={(patch, label, gesture) => actions.update(selected.id, { shape: { ...selected.shape, ...patch } } as Partial<Layer>, label, gesture)} onCommit={actions.commit}/>}
    {selected.kind === 'adjust' && <button type="button" className="btn wide" onClick={actions.editAdjust}><SlidersHorizontal size={15} aria-hidden="true"/>{t('調整を編集')}</button>}
    {(selected.kind === 'text' || selected.kind === 'shape') && <button type="button" className="btn wide" onClick={actions.rasterize}>{t('ラスタライズ（ピクセルに変換）')}</button>}
    <p className="panel-note">{t('名前はダブルクリックで変更できます。テキストと図形はあとから何度でも編集できます。')}</p>
  </div>;
}

/** Fonts installed on the device (Local Font Access; Chromium and the desktop app). Asked for only on request. */
const canQueryFonts = typeof window !== 'undefined' && 'queryLocalFonts' in window;
let localFamilies: Promise<string[]> | null = null;
function loadLocalFonts() {
  return localFamilies ??= (window as unknown as { queryLocalFonts: () => Promise<{ family: string }[]> }).queryLocalFonts()
    .then(list => [...new Set(list.map(font => font.family))].sort((a, b) => a.localeCompare(b, 'ja')))
    .catch(error => { localFamilies = null; throw error; });
}
const localFont = (family: string) => `'${family.replace(/'/g, '')}', 'Noto Sans JP Variable', sans-serif`;

function TextEditor({ text, autoFocus, onChange, onCommit }: { text: TextProps; autoFocus: boolean; onChange: (patch: Partial<TextProps>, label: string, gesture?: boolean) => void; onCommit: () => void }) {
  const [families, setFamilies] = useState<string[] | null>(null);
  useEffect(() => { if (localFamilies) void localFamilies.then(setFamilies, () => {}); }, []);
  const known = FONTS.some(font => font.value === text.font) || !!families?.some(family => localFont(family) === text.font);
  return <section className="panel-section" aria-label={t('テキスト')}>
    <textarea className="text-input" value={text.content} rows={3} autoFocus={autoFocus} aria-label={t('テキスト')} onFocus={e => autoFocus && e.target.select()}
      onChange={e => onChange({ content: e.target.value }, t('テキストを編集'), true)} onBlur={onCommit}/>
    <div className="field"><span>{t('フォント')}</span><span className="field-row">
      <select value={text.font} aria-label={t('フォント')} onChange={e => onChange({ font: e.target.value }, t('フォント'))}>
        {FONTS.map(font => <option key={font.value} value={font.value}>{font.label}</option>)}
        {families && <optgroup label={t('この端末のフォント')}>{families.map(family => <option key={family} value={localFont(family)}>{family}</option>)}</optgroup>}
        {!known && <option value={text.font}>{text.font.split(',')[0].replace(/'/g, '')}</option>}
      </select>
      {canQueryFonts && !families && <IconButton icon={Type} label={t('この端末にインストールされたフォントを使う')} size={16} onClick={() => void loadLocalFonts().then(setFamilies, () => {})}/>}
    </span></div>
    <Slider label={t('サイズ')} value={text.size} min={6} max={600} unit="px" onChange={size => onChange({ size }, t('文字サイズ'), true)} onCommit={onCommit}/>
    <div className="field"><span>{t('スタイル')}</span><span className="field-row">
      <IconButton icon={Bold} label={t('太字')} active={text.weight === 700} size={16} onClick={() => onChange({ weight: text.weight === 700 ? 400 : 700 }, t('太字'))}/>
      <IconButton icon={Italic} label={t('斜体')} active={text.italic} size={16} onClick={() => onChange({ italic: !text.italic }, t('斜体'))}/>
      <input type="color" className="color-input" value={text.color} aria-label={t('文字の色')} onChange={e => onChange({ color: e.target.value }, t('文字の色'), true)} onBlur={onCommit}/>
    </span></div>
    <div className="field"><span>{t('揃え')}</span><Segmented label={t('揃え')} value={text.align} onChange={align => onChange({ align }, t('文字揃え'))} options={[
      { value: 'left', label: <AlignLeft size={15} aria-hidden="true"/>, title: text.vertical ? t('上揃え') : t('左揃え') },
      { value: 'center', label: <AlignCenter size={15} aria-hidden="true"/>, title: t('中央揃え') },
      { value: 'right', label: <AlignRight size={15} aria-hidden="true"/>, title: text.vertical ? t('下揃え') : t('右揃え') }]}/></div>
    <div className="field"><span>{t('縦書き')}</span><Toggle label={t('縦書き')} checked={text.vertical} onChange={vertical => onChange({ vertical }, vertical ? t('縦書き') : t('横書き'))}/></div>
    <Slider label={t('行間')} value={text.lineHeight} min={0.8} max={3} step={0.05} format={v => v.toFixed(2)} onChange={lineHeight => onChange({ lineHeight }, t('行間'), true)} onCommit={onCommit}/>
  </section>;
}

function ShapeEditor({ shape, onChange, onCommit }: { shape: ShapeProps; onChange: (patch: Partial<ShapeProps>, label: string, gesture?: boolean) => void; onCommit: () => void }) {
  return <section className="panel-section" aria-label={t('図形')}>
    <div className="field"><span>{t('種類')}</span><Segmented label={t('図形の種類')} value={shape.type} onChange={type => onChange({ type }, t('図形の種類'))} options={[{ value: 'rect', label: t('四角形') }, { value: 'ellipse', label: t('楕円') }, { value: 'line', label: t('線') }]}/></div>
    <div className="field"><span>{t('サイズ')}</span><span className="field-row num">
      <input type="number" className="num-input" value={Math.round(shape.w)} aria-label={t('幅')} onChange={e => onChange({ w: Number(e.target.value) || 1 }, t('図形のサイズ'), true)} onBlur={onCommit}/>×
      <input type="number" className="num-input" value={Math.round(shape.h)} aria-label={t('高さ')} onChange={e => onChange({ h: Number(e.target.value) || 1 }, t('図形のサイズ'), true)} onBlur={onCommit}/>
    </span></div>
    {shape.type !== 'line' && <div className="field"><span>{t('塗り')}</span><span className="field-row">
      <Toggle label={t('塗り')} checked={!!shape.fill} onChange={on => onChange({ fill: on ? '#7c5cff' : null }, t('塗り'))}/>
      {shape.fill && <input type="color" className="color-input" value={shape.fill} aria-label={t('塗りの色')} onChange={e => onChange({ fill: e.target.value }, t('塗りの色'), true)} onBlur={onCommit}/>}
    </span></div>}
    <div className="field"><span>{t('線')}</span><span className="field-row">
      <Toggle label={t('線')} checked={!!shape.stroke} onChange={on => onChange({ stroke: on ? '#ffffff' : null }, t('線'))}/>
      {shape.stroke && <input type="color" className="color-input" value={shape.stroke} aria-label={t('線の色')} onChange={e => onChange({ stroke: e.target.value }, t('線の色'), true)} onBlur={onCommit}/>}
    </span></div>
    {shape.stroke && <Slider label={t('線の太さ')} value={shape.strokeWidth} min={1} max={200} unit="px" onChange={strokeWidth => onChange({ strokeWidth }, t('線の太さ'), true)} onCommit={onCommit}/>}
    {shape.type === 'rect' && <Slider label={t('角の丸み')} value={shape.radius} min={0} max={500} unit="px" onChange={radius => onChange({ radius }, t('角の丸み'), true)} onCommit={onCommit}/>}
  </section>;
}

export function HistoryPanel({ history, onJump }: { history: History<Doc>; onJump: (index: number) => void }) {
  const list = entries(history);
  return <div className="panel"><ol className="history-list" aria-label={t('編集履歴')}>
    {list.map((entry, index) => <li key={index}><button type="button" className={`${entry.current ? 'current' : ''}${entry.future ? ' future' : ''}`} aria-current={entry.current ? 'step' : undefined} onClick={() => onJump(index)}>
      <span className="history-dot" aria-hidden="true"/>{entry.label}
    </button></li>)}
  </ol><p className="panel-note">{t('履歴は直近 500 回分を残し、任意の時点に戻れます。描画も含め、編集内容は自動で保存されます。')}</p></div>;
}

export function InfoPanel({ project, output, source, version }: { project: Project; output: { width: number; height: number }; source: HTMLCanvasElement | null; version: number }) {
  const [data, setData] = useState<Histogram | null>(null);
  useEffect(() => { if (!source) return; const timer = setTimeout(() => setData(histogram(source)), 120); return () => clearTimeout(timer); }, [source, version]);
  const megapixels = (output.width * output.height / 1e6).toFixed(1);
  const format = project.type.replace('image/', '').toUpperCase() || '—';
  return <div className="panel">
    {data && <HistogramChart data={data}/>}
    <dl className="info-list">
      <div><dt>{t('出力サイズ')}</dt><dd className="num">{output.width} × {output.height} px</dd></div>
      <div><dt>{t('画素数')}</dt><dd className="num">{megapixels} MP</dd></div>
      <div><dt>{t('元のサイズ')}</dt><dd className="num">{project.width} × {project.height} px</dd></div>
      <div><dt>{t('形式')}</dt><dd>{format}</dd></div>
      <div><dt>{t('ファイルサイズ')}</dt><dd className="num">{formatBytes(project.size)}</dd></div>
      <div><dt>{t('追加日')}</dt><dd className="num">{new Date(project.added).toLocaleString(lang === 'en' ? 'en-US' : 'ja-JP', { dateStyle: 'medium', timeStyle: 'short' })}</dd></div>
    </dl>
  </div>;
}

function HistogramChart({ data }: { data: Histogram }) {
  const path = (channel: Uint32Array) => {
    let d = 'M0 100';
    for (let i = 0; i < 256; i++) d += ` L${(i / 255 * 256).toFixed(1)} ${(100 - Math.min(1, channel[i] / data.max) * 100).toFixed(1)}`;
    return `${d} L256 100 Z`;
  };
  return <figure className="histogram" aria-label={t('ヒストグラム')}>
    <svg viewBox="0 0 256 100" preserveAspectRatio="none" aria-hidden="true">
      <path d={path(data.l)} className="h-l"/><path d={path(data.r)} className="h-r"/><path d={path(data.g)} className="h-g"/><path d={path(data.b)} className="h-b"/>
    </svg>
    <figcaption>{t('ヒストグラム（調整後）')}</figcaption>
  </figure>;
}

