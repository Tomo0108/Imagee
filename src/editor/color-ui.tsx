import { useEffect, useMemo, useRef, useState } from 'react';
import { FileUp, Plus, Trash2, X } from 'lucide-react';
import { BANDS, curveTable, type ColorOps, type CurvePoint, type Curves, type Levels } from '../lib/color.mjs';
import type { Adjustments } from '../lib/adjust.mjs';
import { PRESETS, presetState } from '../lib/presets.mjs';
import type { Histogram } from '../imaging';
import { canvas as makeCanvas } from '../imaging';
import { colorStage } from './document';
import { IconButton, Segmented, Slider } from '../ui';

type Channel = keyof Curves;
const CHANNEL_COLOR: Record<Channel, string> = { rgb: 'var(--label)', r: '#ff453a', g: '#30d158', b: '#0a84ff' };
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const isLine = (p: CurvePoint[]) => p.length === 2 && p[0][0] === 0 && p[0][1] === 0 && p[1][0] === 1 && p[1][1] === 1;

/** Tone curve: click to add a point, drag to shape, drag a point off the graph or double-click it to remove it. */
export function CurveEditor({ curves, histogram, onChange, onCommit }: { curves: Curves; histogram: Histogram | null; onChange: (curves: Curves, gesture: boolean) => void; onCommit: () => void }) {
  const [channel, setChannel] = useState<Channel>('rgb');
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const points = curves[channel];
  const set = (next: CurvePoint[], gesture = true) => onChange({ ...curves, [channel]: next }, gesture);
  const local = (event: React.PointerEvent | React.MouseEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: (event.clientX - r.left) / r.width, y: 1 - (event.clientY - r.top) / r.height };
  };
  const hit = (p: { x: number; y: number }) => points.findIndex(q => Math.hypot(q[0] - p.x, q[1] - p.y) < 0.05);
  const down = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = local(event);
    let index = hit(p);
    if (index < 0) {
      const next = [...points, [clamp01(p.x), clamp01(p.y)] as CurvePoint].sort((a, b) => a[0] - b[0]);
      index = next.findIndex(q => q[0] === clamp01(p.x) && q[1] === clamp01(p.y));
      set(next);
    }
    drag.current = index;
  };
  const move = (event: React.PointerEvent) => {
    const index = drag.current;
    if (index === null) return;
    const p = local(event);
    const interior = index > 0 && index < points.length - 1;
    if (interior && (p.y < -0.12 || p.y > 1.12 || p.x < -0.12 || p.x > 1.12)) { set(points.filter((_, i) => i !== index)); drag.current = null; return; }
    const lo = index > 0 ? points[index - 1][0] + 0.01 : 0, hi = index < points.length - 1 ? points[index + 1][0] - 0.01 : 1;
    set(points.map((q, i) => i === index ? [Math.min(hi, Math.max(lo, p.x)), clamp01(p.y)] as CurvePoint : q));
  };
  const up = () => { if (drag.current !== null) { drag.current = null; onCommit(); } };
  const path = useMemo(() => {
    const table = curveTable(points, 129);
    return Array.from(table, (v, i) => `${i ? 'L' : 'M'}${(i / 128 * 256).toFixed(1)} ${((1 - v) * 256).toFixed(1)}`).join(' ');
  }, [points]);
  const histo = useMemo(() => {
    if (!histogram) return '';
    const data = channel === 'rgb' ? histogram.l : histogram[channel];
    let d = 'M0 256';
    for (let i = 0; i < 256; i++) d += ` L${i} ${(256 - Math.min(1, data[i] / histogram.max) * 200).toFixed(1)}`;
    return `${d} L256 256 Z`;
  }, [histogram, channel]);
  return <div className="curve-editor">
    <div className="curve-head">
      <Segmented label="チャンネル" value={channel} onChange={setChannel} options={(['rgb', 'r', 'g', 'b'] as Channel[]).map(c => ({ value: c, label: <span style={{ color: c === 'rgb' ? undefined : CHANNEL_COLOR[c] }}>{c === 'rgb' ? 'RGB' : c.toUpperCase()}{!isLine(curves[c]) && '•'}</span> }))}/>
      <button type="button" className="btn ghost small" disabled={isLine(points)} onClick={() => { set([[0, 0], [1, 1]], false); onCommit(); }}>リセット</button>
    </div>
    <svg ref={svg} viewBox="0 0 256 256" className="curve-graph" role="img" aria-label={`トーンカーブ（${channel === 'rgb' ? 'RGB' : channel.toUpperCase()}）`}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onDoubleClick={event => { const i = hit(local(event)); if (i > 0 && i < points.length - 1) { set(points.filter((_, j) => j !== i), false); onCommit(); } }}>
      {histo && <path d={histo} className="curve-histogram"/>}
      {[64, 128, 192].map(v => <g key={v}><line x1={v} y1={0} x2={v} y2={256} className="curve-grid"/><line x1={0} y1={v} x2={256} y2={v} className="curve-grid"/></g>)}
      <line x1={0} y1={256} x2={256} y2={0} className="curve-grid"/>
      <path d={path} className="curve-line" style={{ stroke: CHANNEL_COLOR[channel] }}/>
      {points.map(([x, y], i) => <circle key={i} cx={x * 256} cy={(1 - y) * 256} r={5} className="curve-point" style={{ stroke: CHANNEL_COLOR[channel] }}/>)}
    </svg>
  </div>;
}

export function LevelsEditor({ levels, onChange, onCommit }: { levels: Levels; onChange: (levels: Levels, gesture: boolean) => void; onCommit: () => void }) {
  const set = (patch: Partial<Levels>) => onChange({ ...levels, ...patch }, true);
  return <div className="levels-editor">
    <div className="levels-ramp" aria-hidden="true"><span style={{ left: `${levels.inBlack / 2.55}%` }}/><span style={{ left: `${levels.inWhite / 2.55}%` }}/></div>
    <Slider label="入力：黒" value={levels.inBlack} min={0} max={Math.min(253, levels.inWhite - 2)} onChange={inBlack => set({ inBlack })} onCommit={onCommit} onReset={() => set({ inBlack: 0 })}/>
    <Slider label="ガンマ" value={levels.gamma} min={0.1} max={9.99} step={0.01} format={v => v.toFixed(2)} onChange={gamma => set({ gamma })} onCommit={onCommit} onReset={() => set({ gamma: 1 })}/>
    <Slider label="入力：白" value={levels.inWhite} min={Math.max(2, levels.inBlack + 2)} max={255} onChange={inWhite => set({ inWhite })} onCommit={onCommit} onReset={() => set({ inWhite: 255 })}/>
    <Slider label="出力：黒" value={levels.outBlack} min={0} max={255} onChange={outBlack => set({ outBlack })} onCommit={onCommit} onReset={() => set({ outBlack: 0 })}/>
    <Slider label="出力：白" value={levels.outWhite} min={0} max={255} onChange={outWhite => set({ outWhite })} onCommit={onCommit} onReset={() => set({ outWhite: 255 })}/>
  </div>;
}

export function HslEditor({ hsl, onChange, onCommit }: { hsl: ColorOps['hsl']; onChange: (hsl: ColorOps['hsl'], gesture: boolean) => void; onCommit: () => void }) {
  const [band, setBand] = useState(BANDS[0].id);
  const shift = hsl[band];
  const set = (patch: Partial<typeof shift>, gesture = true) => onChange({ ...hsl, [band]: { ...shift, ...patch } }, gesture);
  const label = BANDS.find(b => b.id === band)!.label;
  return <div className="hsl-editor">
    <div className="hsl-bands" role="radiogroup" aria-label="色の範囲">
      {BANDS.map(b => { const s = hsl[b.id]; const changed = s.h || s.s || s.l;
        return <button key={b.id} type="button" role="radio" aria-checked={band === b.id} title={b.label} aria-label={b.label} className={`hsl-band${band === b.id ? ' on' : ''}${changed ? ' changed' : ''}`} style={{ background: b.swatch }} onClick={() => setBand(b.id)}/>; })}
    </div>
    <Slider label={`${label}：色相`} value={shift.h} min={-100} max={100} centered onChange={h => set({ h })} onCommit={onCommit} onReset={() => set({ h: 0 }, false)}/>
    <Slider label={`${label}：彩度`} value={shift.s} min={-100} max={100} centered onChange={s => set({ s })} onCommit={onCommit} onReset={() => set({ s: 0 }, false)}/>
    <Slider label={`${label}：輝度`} value={shift.l} min={-100} max={100} centered onChange={l => set({ l })} onCommit={onCommit} onReset={() => set({ l: 0 }, false)}/>
  </div>;
}

export function LutPicker({ lut, cubes, onChange, onCommit, onImport, onRemove }: { lut: ColorOps['lut']; cubes: { id: string; name: string }[]; onChange: (lut: ColorOps['lut'], gesture: boolean) => void; onCommit: () => void; onImport: () => void; onRemove: (id: string) => void }) {
  const missing = lut && !cubes.some(c => c.id === lut.id);
  return <div className="lut-picker">
    <div className="field"><span>LUT</span><span className="field-row">
      <select value={lut?.id || ''} aria-label="LUT" onChange={e => onChange(e.target.value ? { id: e.target.value, amount: lut?.amount ?? 100 } : null, false)}>
        <option value="">なし</option>
        {cubes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        {missing && <option value={lut.id}>（見つかりません）</option>}
      </select>
      <IconButton icon={FileUp} label=".cube ファイルを読み込む" size={16} onClick={onImport}/>
      {lut && !missing && <IconButton icon={Trash2} label="この LUT をライブラリから削除" size={16} onClick={() => onRemove(lut.id)}/>}
    </span></div>
    {lut && <Slider label="適用量" value={lut.amount} min={0} max={100} unit="%" onChange={amount => onChange({ ...lut, amount }, true)} onCommit={onCommit}/>}
  </div>;
}

export interface UserPreset { id: string; name: string; basic: Adjustments; color: ColorOps }
const USER_PRESETS = 'imagee-presets';
export function loadUserPresets(): UserPreset[] { try { const v = JSON.parse(localStorage.getItem(USER_PRESETS) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
export function storeUserPresets(presets: UserPreset[]) { try { localStorage.setItem(USER_PRESETS, JSON.stringify(presets)); } catch { /* Kept for this session only. */ } }

/** Preset thumbnails are rendered on the CPU from a small copy of the current image. */
function PresetThumb({ preview, basic, color }: { preview: ImageData | null; basic: Adjustments; color: ColorOps }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const target = ref.current;
    if (!target || !preview) return;
    target.width = preview.width; target.height = preview.height;
    const out = new ImageData(new Uint8ClampedArray(preview.data), preview.width, preview.height);
    const fn = colorStage(basic, color, undefined);
    if (fn) for (let i = 0; i < out.data.length; i += 4) {
      if (!out.data[i + 3]) continue;
      const [r, g, b] = fn([out.data[i] / 255, out.data[i + 1] / 255, out.data[i + 2] / 255]);
      out.data[i] = r * 255; out.data[i + 1] = g * 255; out.data[i + 2] = b * 255;
    }
    target.getContext('2d')!.putImageData(out, 0, 0);
  }, [preview, basic, color]);
  return <canvas ref={ref} className="preset-thumb" aria-hidden="true"/>;
}

export function PresetStrip({ source, version, current, onApply, userPresets, onSave, onDelete }: { source: HTMLCanvasElement | null; version: number; current: { basic: Adjustments; color: ColorOps }; onApply: (state: { basic: Adjustments; color: ColorOps }, name: string) => void; userPresets: UserPreset[]; onSave: (name: string) => void; onDelete: (id: string) => void }) {
  const [preview, setPreview] = useState<ImageData | null>(null);
  const [naming, setNaming] = useState(false);
  // Refresh the preview a moment after the image changes, not on every brush frame.
  useEffect(() => {
    if (!source) return;
    const timer = setTimeout(() => {
      const k = 84 / Math.max(source.width, source.height);
      const small = makeCanvas(Math.max(1, Math.round(source.width * k)), Math.max(1, Math.round(source.height * k)));
      const c = small.getContext('2d', { willReadFrequently: true })!;
      c.drawImage(source, 0, 0, small.width, small.height);
      setPreview(c.getImageData(0, 0, small.width, small.height));
    }, 300);
    return () => clearTimeout(timer);
  }, [source, version]);
  const builtIn = useMemo(() => PRESETS.map(p => ({ id: p.id, name: p.name, ...presetState(p) })), []);
  const same = (a: { basic: Adjustments; color: ColorOps }) => JSON.stringify([a.basic, a.color]) === JSON.stringify([current.basic, current.color]);
  return <div className="presets">
    <div className="preset-strip" role="list" aria-label="プリセット">
      {[...userPresets, ...builtIn].map(p => <div key={p.id} role="listitem" className={`preset${same(p) ? ' on' : ''}`}>
        <button type="button" className="preset-main" title={`${p.name}を適用`} onClick={() => onApply({ basic: p.basic, color: p.color }, p.name)}>
          <PresetThumb preview={preview} basic={p.basic} color={p.color}/><span>{p.name}</span>
        </button>
        {userPresets.includes(p as UserPreset) && <button type="button" className="preset-delete" aria-label={`${p.name}を削除`} title="削除" onClick={() => onDelete(p.id)}><X size={11} aria-hidden="true"/></button>}
      </div>)}
    </div>
    {naming
      ? <form className="preset-save" onSubmit={e => { e.preventDefault(); const name = new FormData(e.currentTarget).get('name')?.toString().trim(); if (name) onSave(name); setNaming(false); }}>
          <input name="name" autoFocus placeholder="プリセット名" aria-label="プリセット名" maxLength={40}/>
          <button type="submit" className="btn small primary">保存</button>
          <button type="button" className="btn small ghost" onClick={() => setNaming(false)}>やめる</button>
        </form>
      : <button type="button" className="btn ghost small" onClick={() => setNaming(true)}><Plus size={14} aria-hidden="true"/>現在の設定をプリセットに保存</button>}
  </div>;
}
