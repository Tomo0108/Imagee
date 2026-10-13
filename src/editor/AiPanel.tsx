import { CloudSun, Eraser, ImageUpscale, ScanFace, ShieldCheck, SquareDashedMousePointer, UserRound, WandSparkles, X } from 'lucide-react';
import { t } from '../i18n/index.mjs';

export interface AiBusy { label: string; progress: number | null }
interface Props {
  busy: AiBusy | null; hasSelection: boolean; layerName: string; canRemoveBackground: boolean; output: { width: number; height: number };
  onSubject: () => void; onSky: () => void; onRemoveBackground: () => void; onRemoveTool: () => void; onFillSelection: () => void;
  onUpscale: (factor: 2 | 4) => void; onCancel: () => void;
}

/** On-device AI: selections, background removal, object removal and upscaling. */
export function AiPanel(p: Props) {
  const off = !!p.busy;
  const tooBig = p.output.width * p.output.height > 3e6;
  return <div className="panel ai-panel">
    {p.busy && <div className="ai-busy" role="status">
      <span className="spinner" aria-hidden="true"/>
      <div><strong>{p.busy.label}</strong>{p.busy.progress !== null && <div className="meter"><i style={{ width: `${Math.round(p.busy.progress * 100)}%` }}/></div>}</div>
      <button type="button" className="btn ghost small" onClick={p.onCancel}><X size={14} aria-hidden="true"/>{t('中止')}</button>
    </div>}
    <section className="ai-group" aria-label={t('選択')}>
      <h3>{t('選択')}</h3>
      <button type="button" className="ai-action" disabled={off} onClick={p.onSubject}><UserRound size={18} aria-hidden="true"/><span><strong>{t('被写体を選択')}</strong><small>{t('人物・動物・商品などを自動で選択')}</small></span></button>
      <button type="button" className="ai-action" disabled={off} onClick={p.onSky}><CloudSun size={18} aria-hidden="true"/><span><strong>{t('空を選択')}</strong><small>{t('空だけを選択して、色や明るさを調整')}</small></span></button>
    </section>
    <section className="ai-group" aria-label={t('消去')}>
      <h3>{t('消去')}</h3>
      <button type="button" className="ai-action" disabled={off || !p.canRemoveBackground} onClick={p.onRemoveBackground}><ScanFace size={18} aria-hidden="true"/><span><strong>{t('背景を削除')}</strong><small>{p.canRemoveBackground ? t('「{0}」にマスクを付けます。ブラシであとから直せます', p.layerName) : t('画像のレイヤーを選んでください')}</small></span></button>
      <button type="button" className="ai-action" disabled={off} onClick={p.onRemoveTool}><Eraser size={18} aria-hidden="true"/><span><strong>{t('不要物を消す')}</strong><small>{t('消したいものをなぞると、周りから自然に埋めます（R）')}</small></span></button>
      <button type="button" className="ai-action" disabled={off || !p.hasSelection} onClick={p.onFillSelection}><SquareDashedMousePointer size={18} aria-hidden="true"/><span><strong>{t('選択範囲を消して埋める')}</strong><small>{p.hasSelection ? t('選択した部分を周りになじませて消します（⇧Delete）') : t('先に消したい範囲を選択してください')}</small></span></button>
    </section>
    <section className="ai-group" aria-label={t('高解像度化')}>
      <h3>{t('高解像度化')}</h3>
      <div className="ai-upscale">
        <ImageUpscale size={18} aria-hidden="true"/>
        <span><strong>{t('くっきり拡大')}</strong><small>{tooBig ? t('300 万画素までの画像に使えます') : t('{0} × {1} または {2} × {3} px の新しい画像を作ります', p.output.width * 2, p.output.height * 2, p.output.width * 4, p.output.height * 4)}</small></span>
        <div className="ai-upscale-buttons">
          <button type="button" className="btn small" disabled={off || tooBig} onClick={() => p.onUpscale(2)}>{t('2倍')}</button>
          <button type="button" className="btn small" disabled={off || tooBig} onClick={() => p.onUpscale(4)}>{t('4倍')}</button>
        </div>
      </div>
    </section>
    <p className="panel-note with-icon"><ShieldCheck size={13} aria-hidden="true"/>{t('すべてこの端末の中で処理します。画像が外部に送られることはありません。')}</p>
    <p className="panel-note"><WandSparkles size={12} aria-hidden="true"/> {t('初回はモデルの準備に数秒かかります。')}</p>
  </div>;
}
