import pkg from '../package.json';
import { Modal, Segmented, Toggle, Kbd, mod } from './ui';
import type { Preferences } from './lib/preferences.mjs';

export function Settings({ prefs, onChange, onClose }: { prefs: Preferences; onChange: (prefs: Preferences) => void; onClose: () => void }) {
  return <Modal title="設定" onClose={onClose}>
    <section className="settings-section"><h3>表示</h3><div className="settings-group">
      <div className="setting-row"><span>外観</span><Segmented label="外観" value={prefs.theme} onChange={theme => onChange({ ...prefs, theme })} options={[{ value: 'system', label: '自動' }, { value: 'light', label: 'ライト' }, { value: 'dark', label: 'ダーク' }]}/></div>
      <div className="setting-row"><span>透明部分の背景<small>キャンバスの市松模様の明るさ</small></span><Segmented label="透明部分の背景" value={prefs.checkerboard} onChange={checkerboard => onChange({ ...prefs, checkerboard })} options={[{ value: 'dark', label: '暗い' }, { value: 'light', label: '明るい' }]}/></div>
      <div className="setting-row"><span>アニメーション<small>オフにすると画面の動きを減らします</small></span><Toggle label="アニメーション" checked={prefs.motion} onChange={motion => onChange({ ...prefs, motion })}/></div>
    </div></section>
    <section className="settings-section"><h3>ショートカット</h3><div className="settings-group shortcuts">
      <div className="setting-row"><span>元に戻す / やり直す</span><span><Kbd>{mod}</Kbd><Kbd>Z</Kbd> / <Kbd>{mod}</Kbd><Kbd>⇧</Kbd><Kbd>Z</Kbd></span></div>
      <div className="setting-row"><span>拡大 / 縮小</span><span><Kbd>{mod}</Kbd><Kbd>+</Kbd> / <Kbd>{mod}</Kbd><Kbd>−</Kbd></span></div>
      <div className="setting-row"><span>画面に合わせる / 100%</span><span><Kbd>{mod}</Kbd><Kbd>0</Kbd> / <Kbd>{mod}</Kbd><Kbd>1</Kbd></span></div>
      <div className="setting-row"><span>一時的に手のひらツール</span><span><Kbd>Space</Kbd></span></div>
      <div className="setting-row"><span>書き出し</span><span><Kbd>{mod}</Kbd><Kbd>⇧</Kbd><Kbd>E</Kbd></span></div>
      <div className="setting-row"><span>画像を貼り付けて追加</span><span><Kbd>{mod}</Kbd><Kbd>V</Kbd></span></div>
    </div></section>
    <p className="setting-note">画像はこの端末の中だけに保存されます。アカウントやアップロードは不要です。</p>
    <div className="app-about"><img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} width="48" height="48" alt=""/><div><strong translate="no">Imagee</strong><span>バージョン {pkg.version}</span></div></div>
  </Modal>;
}
