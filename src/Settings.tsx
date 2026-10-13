import { Check, GraduationCap } from 'lucide-react';
import pkg from '../package.json';
import { Modal, Segmented, Toggle, Kbd, mod } from './ui';
import { ACCENTS, type Accent, type Language, type Preferences } from './lib/preferences.mjs';
import { t } from './i18n/index.mjs';

const ACCENT_NAMES: Record<Accent, string> = { violet: t('バイオレット'), blue: t('ブルー'), pink: t('ピンク'), green: t('グリーン'), orange: t('オレンジ'), graphite: t('グラファイト') };

export function Settings({ prefs, onChange, onClose, onLanguage, onTutorial }: { prefs: Preferences; onChange: (prefs: Preferences) => void; onClose: () => void; onLanguage: (lang: Language) => void; onTutorial: () => void }) {
  return <Modal title={t('設定')} onClose={onClose}>
    <section className="settings-section"><h3>{t('配色')}</h3><div className="settings-group">
      <div className="setting-row"><span>{t('外観')}</span><Segmented label={t('外観')} value={prefs.theme} onChange={theme => onChange({ ...prefs, theme })} options={[{ value: 'system', label: t('自動') }, { value: 'light', label: t('ライト') }, { value: 'dark', label: t('ダーク') }]}/></div>
      <div className="setting-row"><span>{t('アクセントカラー')}<small>{t('ボタンや選択中の項目の色')}</small></span>
        <div className="accent-swatches" role="radiogroup" aria-label={t('アクセントカラー')}>
          {ACCENTS.map(accent => <button key={accent} type="button" role="radio" aria-checked={prefs.accent === accent} aria-label={ACCENT_NAMES[accent]} title={ACCENT_NAMES[accent]} className={`accent-swatch${prefs.accent === accent ? ' on' : ''}`} data-swatch={accent} onClick={() => onChange({ ...prefs, accent })}>{prefs.accent === accent && <Check size={13} strokeWidth={3}/>}</button>)}
        </div>
      </div>
      <div className="setting-row"><span>{t('透明部分の背景')}<small>{t('キャンバスの市松模様の明るさ')}</small></span><Segmented label={t('透明部分の背景')} value={prefs.checkerboard} onChange={checkerboard => onChange({ ...prefs, checkerboard })} options={[{ value: 'dark', label: t('暗い') }, { value: 'light', label: t('明るい') }]}/></div>
      <div className="setting-row"><span>{t('アニメーション')}<small>{t('オフにすると画面の動きを減らします')}</small></span><Toggle label={t('アニメーション')} checked={prefs.motion} onChange={motion => onChange({ ...prefs, motion })}/></div>
    </div></section>
    <section className="settings-section"><h3>{t('言語')}</h3><div className="settings-group">
      <div className="setting-row"><span>{t('表示言語')}<small>{t('切り替えると画面を読み込み直します')}</small></span><Segmented label={t('表示言語')} value={prefs.lang} onChange={onLanguage} options={[{ value: 'ja', label: t('日本語') }, { value: 'en', label: 'English' }]}/></div>
    </div></section>
    <section className="settings-section"><h3>{t('ヘルプ')}</h3><div className="settings-group">
      <div className="setting-row"><span>{t('チュートリアル')}<small>{t('はじめに表示した操作ガイドをもう一度見られます')}</small></span><button type="button" className="btn" onClick={onTutorial}><GraduationCap size={15}/>{t('チュートリアルをもう一度見る')}</button></div>
    </div></section>
    <section className="settings-section"><h3>{t('ショートカット')}</h3><div className="settings-group shortcuts">
      <div className="setting-row"><span>{t('元に戻す / やり直す')}</span><span><Kbd>{mod}</Kbd><Kbd>Z</Kbd> / <Kbd>{mod}</Kbd><Kbd>⇧</Kbd><Kbd>Z</Kbd></span></div>
      <div className="setting-row"><span>{t('拡大 / 縮小')}</span><span><Kbd>{mod}</Kbd><Kbd>+</Kbd> / <Kbd>{mod}</Kbd><Kbd>−</Kbd></span></div>
      <div className="setting-row"><span>{t('画面に合わせる / 100%')}</span><span><Kbd>{mod}</Kbd><Kbd>0</Kbd> / <Kbd>{mod}</Kbd><Kbd>1</Kbd></span></div>
      <div className="setting-row"><span>{t('一時的に手のひらツール')}</span><span><Kbd>Space</Kbd></span></div>
      <div className="setting-row"><span>{t('書き出し')}</span><span><Kbd>{mod}</Kbd><Kbd>⇧</Kbd><Kbd>E</Kbd></span></div>
      <div className="setting-row"><span>{t('画像を貼り付けて追加')}</span><span><Kbd>{mod}</Kbd><Kbd>V</Kbd></span></div>
    </div></section>
    <p className="setting-note">{t('画像はこの端末の中だけに保存されます。アカウントやアップロードは不要です。')}</p>
    <div className="app-about"><img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} width="48" height="48" alt=""/><div><strong translate="no">Imagee</strong><span>{t('バージョン {0}', pkg.version)}</span></div></div>
  </Modal>;
}
