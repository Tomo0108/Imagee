import { useState } from 'react';
import { Check } from 'lucide-react';
import { Modal, Segmented, Toggle } from '../ui';
import { findPreset, matchPreset, oriented, SIZE_PRESETS } from '../lib/sizes.mjs';
import { t } from '../i18n/index.mjs';
import { Select } from '../Select';

/** Quick picks shown as chips; every preset is in the list next to them. */
const QUICK = ['4k', 'fhd', 'hd', 'iphone', 'square', 'story', 'a4', 'ogp'];

export type ResizeMode = 'image' | 'canvas';
export interface ResizeRequest { mode: ResizeMode; width: number; height: number; anchor: [number, number]; fill: string | null }
export const MAX_SIDE = 16384;
const MAX_PIXELS = 120e6;

/** Image size scales every layer; canvas size adds or trims space around them, from the chosen anchor. */
const ANCHOR_NAMES = [[t('左上'), t('上'), t('右上')], [t('左'), t('中央'), t('右')], [t('左下'), t('下'), t('右下')]];

export function ResizeSheet({ initial, width: w0, height: h0, background, onApply, onClose }: { initial: ResizeMode; width: number; height: number; background: string; onApply: (request: ResizeRequest) => void; onClose: () => void }) {
  const [mode, setMode] = useState<ResizeMode>(initial);
  const [unit, setUnit] = useState<'px' | '%'>('px');
  const [size, setSize] = useState({ width: w0, height: h0 });
  const [locked, setLocked] = useState(true);
  const [anchor, setAnchor] = useState<[number, number]>([0.5, 0.5]);
  const [fill, setFill] = useState<'clear' | 'background'>('clear');
  const shown = (value: number, base: number) => unit === 'px' ? value : Math.round(value / base * 1000) / 10;
  const set = (axis: 'width' | 'height', raw: number) => {
    const base = axis === 'width' ? w0 : h0;
    const value = Math.max(1, Math.round(unit === 'px' ? raw : base * raw / 100)) || 1;
    if (mode === 'image' && locked) {
      const k = value / base;
      setSize(axis === 'width' ? { width: value, height: Math.max(1, Math.round(h0 * k)) } : { width: Math.max(1, Math.round(w0 * k)), height: value });
    } else setSize(current => ({ ...current, [axis]: value }));
  };
  const preset = matchPreset(size.width, size.height);
  const orientation: 'portrait' | 'landscape' = size.width > size.height ? 'landscape' : 'portrait';
  const choose = (id: string, turn: 'portrait' | 'landscape' | null = null) => {
    const item = findPreset(id);
    if (!item) return;
    setLocked(false); setUnit('px');
    setSize(turn ? oriented(item, turn) : { width: item.width, height: item.height });
  };
  const scale = (k: number) => setSize({ width: Math.max(1, Math.round(w0 * k)), height: Math.max(1, Math.round(h0 * k)) });
  const tooBig = size.width > MAX_SIDE || size.height > MAX_SIDE || size.width * size.height > MAX_PIXELS;
  const same = size.width === w0 && size.height === h0;
  const apply = () => { onApply({ mode, width: size.width, height: size.height, anchor, fill: mode === 'canvas' && fill === 'background' ? background : null }); onClose(); };

  return <Modal title={mode === 'image' ? t('画像サイズ') : t('キャンバスサイズ')} onClose={onClose}>
    <div className="resize">
      <Segmented label={t('変更する対象')} value={mode} onChange={setMode} options={[{ value: 'image', label: t('画像サイズ') }, { value: 'canvas', label: t('キャンバスサイズ') }]}/>
      <p className="setting-note">{mode === 'image' ? t('すべてのレイヤーを拡大・縮小します。') : t('画像の大きさはそのままで、周りに余白を足したり、はみ出す部分を切り落としたりします。')}</p>
      <div className="size-presets">
        <div className="size-chips" role="group" aria-label={t('よく使うサイズ')}>
          {QUICK.map(id => { const item = findPreset(id)!; const on = preset?.id === id; return <button key={id} type="button" className={`size-chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => choose(id)}>
            <i className="size-shape" style={{ aspectRatio: `${item.width} / ${item.height}` }} aria-hidden="true"/><span>{item.label}</span><small className="num">{item.width}×{item.height}</small>
          </button>; })}
        </div>
        <div className="size-preset-row">
          <label className="select"><span>{t('プリセット')}</span><Select value={preset?.id ?? ''} onChange={e => e.target.value && choose(e.target.value)}>
            <option value="">{t('カスタム')}</option>
            {SIZE_PRESETS.map(group => <optgroup key={group.group} label={group.group}>{group.items.map(item => <option key={item.id} value={item.id}>{t('{0}（{1} × {2}）', item.label, item.width, item.height)}</option>)}</optgroup>)}
          </Select></label>
          <Segmented label={t('向き')} value={orientation} onChange={turn => preset ? choose(preset.id, turn) : setSize({ width: size.height, height: size.width })} options={[{ value: 'portrait', label: t('縦') }, { value: 'landscape', label: t('横') }]}/>
        </div>
      </div>
      <div className="resize-fields">
        <label className="resize-field"><span>{t('幅')}</span><input type="number" className="num-input" min={1} value={shown(size.width, w0)} onChange={e => set('width', Number(e.target.value))}/></label>
        <label className="resize-field"><span>{t('高さ')}</span><input type="number" className="num-input" min={1} value={shown(size.height, h0)} onChange={e => set('height', Number(e.target.value))}/></label>
        <Segmented label={t('単位')} value={unit} onChange={setUnit} options={[{ value: 'px', label: 'px' }, { value: '%', label: '%' }]}/>
      </div>
      {mode === 'image' && <>
        <div className="setting-row"><span>{t('縦横比を固定')}</span><Toggle label={t('縦横比を固定')} checked={locked} onChange={value => { setLocked(value); if (value) scale(size.width / w0); }}/></div>
        <div className="resize-quick">{[0.25, 0.5, 2].map(k => <button key={k} type="button" className="btn ghost" onClick={() => scale(k)}>{k * 100}%</button>)}<button type="button" className="btn ghost" onClick={() => scale(1)}>{t('元に戻す')}</button></div>
      </>}
      {mode === 'canvas' && <div className="resize-canvas">
        <div className="anchor-grid" role="radiogroup" aria-label={t('基準の位置')}>
          {[0, 0.5, 1].flatMap(y => [0, 0.5, 1].map(x => {
            const on = anchor[0] === x && anchor[1] === y;
            return <button key={`${x}-${y}`} type="button" role="radio" aria-checked={on} aria-label={ANCHOR_NAMES[y * 2][x * 2]} className={on ? 'on' : ''} onClick={() => setAnchor([x, y])}/>;
          }))}
        </div>
        <div className="resize-canvas-options">
          <span className="setting-note">{t('基準の位置を選ぶと、反対側に広がります。')}</span>
          <div className="setting-row"><span>{t('広げた部分')}</span><Segmented label={t('広げた部分')} value={fill} onChange={setFill} options={[{ value: 'clear', label: t('透明') }, { value: 'background', label: <span className="fill-option"><i style={{ background }}/>{t('背景色')}</span> }]}/></div>
        </div>
      </div>}
      <div className="export-summary">
        <div><span>{t('変更前')}</span><b className="num">{w0} × {h0} px</b></div>
        <div><span>{t('変更後')}</span><b className="num">{size.width} × {size.height} px</b></div>
      </div>
      {tooBig && <p className="notice">{t('大きすぎます。1 辺 {0} px、合計 1 億 2000 万画素までにしてください。', MAX_SIDE.toLocaleString())}</p>}
    </div>
    <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>{t('キャンセル')}</button><button type="button" className="btn primary" disabled={tooBig || same} onClick={apply}><Check size={16} aria-hidden="true"/>{t('変更する')}</button></div>
  </Modal>;
}
