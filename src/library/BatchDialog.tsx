import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Save, Trash2 } from 'lucide-react';
import type { Project } from '../store';
import { readLuts } from '../store';
import { supportsAvif } from '../imaging';
import { saveBlob } from '../platform';
import { Modal, Segmented, Slider, Toggle } from '../ui';
import { EXPORT_FORMATS, type ExportFormat } from '../lib/files.mjs';
import { ASPECTS } from '../lib/geometry.mjs';
import { NEUTRAL } from '../lib/adjust.mjs';
import { NEUTRAL_COLOR, type Cube } from '../lib/color.mjs';
import { PRESETS, presetState } from '../lib/presets.mjs';
import { DEFAULT_RECIPE, normalizeRecipe, type Recipe } from '../lib/recipe.mjs';
import { loadUserPresets } from '../editor/color-ui';
import type { BatchProgress } from '../io/batch';

const RECIPES = 'imagee-recipes';
function loadRecipes(): Recipe[] { try { const v = JSON.parse(localStorage.getItem(RECIPES) || '[]'); return Array.isArray(v) ? v.map(normalizeRecipe) : []; } catch { return []; } }
function storeRecipes(recipes: Recipe[]) { try { localStorage.setItem(RECIPES, JSON.stringify(recipes)); } catch { /* Kept for this session only. */ } }

const RESIZE: { value: Recipe['resize']['mode']; label: string }[] = [
  { value: 'none', label: '変更しない' }, { value: 'long', label: '長辺' }, { value: 'width', label: '幅' }, { value: 'height', label: '高さ' }, { value: 'percent', label: '倍率（%）' },
];
const POSITIONS: { value: Recipe['watermark']['position']; label: string }[] = [
  { value: 'br', label: '右下' }, { value: 'bl', label: '左下' }, { value: 'tr', label: '右上' }, { value: 'tl', label: '左上' }, { value: 'center', label: '中央' },
];

/** Applies one recipe to many library images: tone, crop to a ratio, resize, watermark, format. */
export function BatchDialog({ projects, initial, onClose, onToast }: { projects: Project[]; initial: string[]; onClose: () => void; onToast: (message: string) => void }) {
  const [selected, setSelected] = useState(() => new Set(initial));
  const [recipe, setRecipe] = useState<Recipe>(() => loadRecipes()[0] ?? DEFAULT_RECIPE);
  const [recipes, setRecipes] = useState(loadRecipes);
  const [tone, setTone] = useState(() => recipe.tone ? 'recipe' : 'none');
  const [avif, setAvif] = useState(false);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const abort = useRef<AbortController | null>(null);
  const userPresets = useMemo(loadUserPresets, []);
  const edited = useMemo(() => projects.filter(p => p.edits), [projects]);
  useEffect(() => { void supportsAvif().then(setAvif); }, []);
  useEffect(() => () => abort.current?.abort(), []);

  const set = (patch: Partial<Recipe>) => setRecipe(current => ({ ...current, ...patch }));
  const format = EXPORT_FORMATS.find(item => item.id === recipe.format)!;
  const chosen = projects.filter(p => selected.has(p.id));

  const chooseTone = (value: string) => {
    setTone(value);
    const [kind, id] = [value.slice(0, value.indexOf(':')), value.slice(value.indexOf(':') + 1)];
    if (value === 'none') set({ tone: null });
    else if (kind === 'preset') { const p = PRESETS.find(item => item.id === id); if (p) set({ tone: presetState(p) }); }
    else if (kind === 'user') { const p = userPresets.find(item => item.id === id); if (p) set({ tone: { basic: p.basic, color: p.color } }); }
    else if (kind === 'project') { const e = edited.find(item => item.id === id)?.edits; if (e) set({ tone: { basic: e.adjust ?? NEUTRAL, color: e.color ?? NEUTRAL_COLOR } }); }
  };
  const pickRecipe = (id: string) => {
    const next = recipes.find(item => item.id === id);
    if (!next) return;
    setRecipe(next); setTone(next.tone ? 'recipe' : 'none');
  };
  const saveRecipe = () => {
    const name = recipe.name.trim() || `レシピ ${recipes.length + 1}`;
    const existing = recipes.find(item => item.name === name);
    const next = normalizeRecipe({ ...recipe, id: existing?.id || crypto.randomUUID(), name });
    const list = existing ? recipes.map(item => item.id === existing.id ? next : item) : [...recipes, next];
    setRecipes(list); storeRecipes(list); setRecipe(next);
    onToast(`レシピ「${name}」を保存しました。`);
  };
  const deleteRecipe = () => {
    const list = recipes.filter(item => item.id !== recipe.id);
    setRecipes(list); storeRecipes(list); setRecipe({ ...recipe, id: '', name: '' });
  };

  const run = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setProgress({ done: 0, total: chosen.length, current: '', failed: [] });
    try {
      const { runBatch, packOutputs } = await import('../io/batch');
      const cubes = new Map<string, Cube>((await readLuts()).map(lut => [lut.id, { size: lut.size, data: lut.data, title: lut.name }]));
      const { outputs, failed } = await runBatch(chosen, normalizeRecipe(recipe), cubes, setProgress, controller.signal);
      if (controller.signal.aborted) { onToast('一括処理を中止しました。'); setProgress(null); return; }
      if (!outputs.length) throw new Error('書き出せる画像がありませんでした。');
      const saved = outputs.length === 1
        ? await saveBlob(outputs[0].blob, outputs[0].name, format.extension, format.label)
        : await saveBlob(await packOutputs(outputs), `Imagee-${outputs.length}枚.zip`, 'zip', 'ZIP');
      if (saved) { onToast(failed.length ? `「${saved}」を保存しました（${failed.length}件は失敗）。` : `「${saved}」を保存しました。`); onClose(); }
      else setProgress(null);
    } catch (e) { onToast((e as Error).message || '一括処理に失敗しました。'); setProgress(null); }
    finally { abort.current = null; }
  };

  const busy = progress !== null;
  return <Modal title="一括処理" wide onClose={() => { abort.current?.abort(); onClose(); }}>
    <div className="batch">
      <section className="batch-pick" aria-label="対象の画像">
        <div className="batch-pick-head"><strong>対象 <span className="num">{chosen.length}/{projects.length}</span></strong>
          <button type="button" className="link-btn" disabled={busy} onClick={() => setSelected(chosen.length === projects.length ? new Set() : new Set(projects.map(p => p.id)))}>{chosen.length === projects.length ? 'すべて解除' : 'すべて選択'}</button></div>
        <ul className="batch-list">{projects.map(p => <li key={p.id}><label>
          <input type="checkbox" checked={selected.has(p.id)} disabled={busy} onChange={e => setSelected(current => { const next = new Set(current); if (e.target.checked) next.add(p.id); else next.delete(p.id); return next; })}/>
          <Thumb blob={p.thumbnail}/><span className="batch-name">{p.name}</span>
        </label></li>)}</ul>
      </section>
      <section className="batch-recipe" aria-label="レシピ">
        <div className="batch-row batch-recipes">
          <input className="text-input" aria-label="レシピ名" placeholder="レシピ名" value={recipe.name} disabled={busy} onChange={e => set({ name: e.target.value })}/>
          <select className="select-input" aria-label="保存したレシピ" value={recipe.id && recipes.some(r => r.id === recipe.id) ? recipe.id : ''} disabled={busy} onChange={e => pickRecipe(e.target.value)}>
            <option value="">{recipes.length ? '呼び出す…' : '保存済みなし'}</option>
            {recipes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <button type="button" className="btn" disabled={busy} onClick={saveRecipe}><Save size={15} aria-hidden="true"/>保存</button>
          {recipe.id && recipes.some(r => r.id === recipe.id) && <button type="button" className="btn icon-only" aria-label="レシピを削除" title="レシピを削除" disabled={busy} onClick={deleteRecipe}><Trash2 size={15} aria-hidden="true"/></button>}
        </div>
        <div className="batch-row"><span>各画像の編集を反映</span><Toggle label="各画像の編集を反映" checked={recipe.useEdits} onChange={useEdits => set({ useEdits })}/></div>
        <label className="batch-row"><span>色調</span><select className="select-input" value={tone} disabled={busy} onChange={e => chooseTone(e.target.value)}>
          <option value="none">{recipe.useEdits ? '各画像のまま' : '補正しない'}</option>
          {tone === 'recipe' && <option value="recipe">レシピの色調</option>}
          <optgroup label="プリセット">{PRESETS.map(p => <option key={p.id} value={`preset:${p.id}`}>{p.name}</option>)}</optgroup>
          {userPresets.length > 0 && <optgroup label="マイプリセット">{userPresets.map(p => <option key={p.id} value={`user:${p.id}`}>{p.name}</option>)}</optgroup>}
          {edited.length > 0 && <optgroup label="画像の補正をコピー">{edited.map(p => <option key={p.id} value={`project:${p.id}`}>{p.name}</option>)}</optgroup>}
        </select></label>
        <label className="batch-row"><span>縦横比</span><select className="select-input" value={recipe.aspect} disabled={busy} onChange={e => set({ aspect: e.target.value })}>
          {ASPECTS.map(a => <option key={a.id} value={a.id}>{a.id === 'free' ? '変更しない' : a.label}</option>)}
        </select></label>
        <div className="batch-row"><span>サイズ</span><div className="batch-inline">
          <select className="select-input" aria-label="サイズの基準" value={recipe.resize.mode} disabled={busy} onChange={e => set({ resize: { ...recipe.resize, mode: e.target.value as Recipe['resize']['mode'], value: e.target.value === 'percent' ? 50 : recipe.resize.mode === 'percent' ? 2048 : recipe.resize.value } })}>
            {RESIZE.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          {recipe.resize.mode !== 'none' && <input className="text-input num" type="number" aria-label="サイズの値" min={1} max={20000} value={recipe.resize.value} disabled={busy} onChange={e => set({ resize: { ...recipe.resize, value: Math.max(1, Number(e.target.value) || 1) } })}/>}
          {recipe.resize.mode !== 'none' && <span className="unit">{recipe.resize.mode === 'percent' ? '%' : 'px'}</span>}
        </div></div>
        <label className="batch-row"><span>透かし</span><input className="text-input" placeholder="例: © 2026 ToMo（空欄で入れない）" value={recipe.watermark.text} disabled={busy} onChange={e => set({ watermark: { ...recipe.watermark, text: e.target.value } })}/></label>
        {recipe.watermark.text.trim() && <div className="batch-sub">
          <div className="batch-row"><span>位置</span><div className="batch-inline">
            <select className="select-input" aria-label="透かしの位置" value={recipe.watermark.position} disabled={busy} onChange={e => set({ watermark: { ...recipe.watermark, position: e.target.value as Recipe['watermark']['position'] } })}>
              {POSITIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <input type="color" className="color-input" aria-label="透かしの色" value={recipe.watermark.color} disabled={busy} onChange={e => set({ watermark: { ...recipe.watermark, color: e.target.value } })}/>
          </div></div>
          <Slider label="透かしの大きさ" value={recipe.watermark.size} min={1} max={30} unit="%" onChange={size => set({ watermark: { ...recipe.watermark, size } })}/>
          <Slider label="透かしの不透明度" value={recipe.watermark.opacity} min={0} max={100} unit="%" onChange={opacity => set({ watermark: { ...recipe.watermark, opacity } })}/>
        </div>}
        <div className="batch-row"><span>形式</span><Segmented label="形式" value={recipe.format} onChange={(f: ExportFormat) => set({ format: f })} options={EXPORT_FORMATS.filter(f => f.id !== 'avif' || avif).map(f => ({ value: f.id, label: f.label }))}/></div>
        {format.lossy && <Slider label="画質" value={recipe.quality} min={1} max={100} unit="%" onChange={quality => set({ quality })}/>}
        <label className="batch-row"><span>ファイル名の末尾</span><input className="text-input" placeholder="例: _web" value={recipe.suffix} disabled={busy} onChange={e => set({ suffix: e.target.value.replace(/[\\/:*?"<>|]/g, '') })}/></label>
      </section>
    </div>
    {progress && <div className="batch-progress" role="status">
      <div className="meter" aria-hidden="true"><i style={{ width: `${progress.total ? progress.done / progress.total * 100 : 0}%` }}/></div>
      <span className="num">{progress.done < progress.total ? `${progress.done + 1} / ${progress.total} 枚目を処理中… ${progress.current}` : 'ファイルにまとめています…'}</span>
    </div>}
    <div className="modal-actions">
      <button type="button" className="btn" onClick={() => { if (busy) abort.current?.abort(); else onClose(); }}>{busy ? '中止' : 'キャンセル'}</button>
      <button type="button" className="btn primary" disabled={busy || !chosen.length} onClick={() => void run()}><Play size={15} aria-hidden="true"/>{chosen.length ? `${chosen.length}枚を書き出す` : '画像を選んでください'}</button>
    </div>
  </Modal>;
}

function Thumb({ blob }: { blob?: Blob }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => { if (!blob) return; const next = URL.createObjectURL(blob); setUrl(next); return () => URL.revokeObjectURL(next); }, [blob]);
  return <span className="batch-thumb">{url && <img src={url} alt="" draggable={false}/>}</span>;
}
