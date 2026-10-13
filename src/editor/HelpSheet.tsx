import { Search } from 'lucide-react';
import { Kbd, Modal, mod } from '../ui';
import { TOOL_HINTS, TOOLS } from './toolbar';
import { t } from '../i18n/index.mjs';

const keys = (text: string) => text.split('+').map(key => <Kbd key={key}>{key}</Kbd>);

const SHORTCUTS: [string, string[]][] = [
  [t('機能を検索'), [`${mod}+K`, `${mod}+F`]],
  [t('元に戻す / やり直す'), [`${mod}+Z`, `${mod}+⇧+Z`]],
  [t('拡大 / 縮小'), [`${mod}+=`, `${mod}+−`]],
  [t('画面に合わせる / 100%'), [`${mod}+0`, `${mod}+1`]],
  [t('一時的に手のひらツール'), ['Space']],
  [t('補正前を表示（押している間）'), ['\\']],
  [t('すべて選択 / 選択を解除'), [`${mod}+A`, `${mod}+D`]],
  [t('選択範囲を反転'), [`${mod}+⇧+I`]],
  [t('コピー / カット / 貼り付け'), [`${mod}+C`, `${mod}+X`, `${mod}+V`]],
  [t('レイヤーを複製（選択範囲はコピーして新規レイヤー）'), [`${mod}+J`]],
  [t('新規レイヤー'), ['⇧+N']],
  [t('選択範囲を消去'), ['Delete']],
  [t('選択範囲を消して周りで埋める（AI）'), ['⇧+Delete']],
  [t('描画色 / 背景色で塗りつぶし'), ['Alt+Delete', `${mod}+Delete`]],
  [t('ブラシのサイズ'), ['[', ']']],
  [t('描画色と背景色を入れ替え / 初期の色に戻す'), ['X', 'D']],
  [t('書き出し'), [`${mod}+⇧+E`]],
  [t('ヘルプ'), ['?']],
];

const TIPS = [
  t('スライダーはダブルクリックで初期値に戻ります。'),
  t('画像をウィンドウにドロップするか貼り付けると、新しいレイヤーとして追加されます。'),
  t('補正はすべて非破壊です。あとから何度でも直せて、履歴から好きな時点に戻れます。'),
  t('調整レイヤーとマスクを使うと、画像の一部だけを補正できます。'),
  t('レイヤーの名前はダブルクリックで変えられます。'),
];

/** Everything the editor used to show as fixed text, in one place: what each tool does, tips and shortcuts. */
export function HelpSheet({ onClose, onSearch }: { onClose: () => void; onSearch: () => void }) {
  return <Modal title={t('ヘルプ')} wide onClose={onClose}>
    <div className="help">
      <button type="button" className="help-search" onClick={onSearch}>
        <Search size={16} aria-hidden="true"/>
        <span><strong>{t('機能を名前で探す')}</strong>{t('「キャ」「さいず」「kya」のように最初の数文字を入力するだけで、キャンバスサイズの変更などの機能が見つかります。')}</span>
        <span className="help-keys">{keys(`${mod}+K`)}</span>
      </button>
      <section className="settings-section"><h3>{t('ツール')}</h3><ul className="help-tools">
        {TOOLS.map(({ id, label, key, icon: Icon }) => <li key={id}>
          <span className="help-tool-icon"><Icon size={16} strokeWidth={1.8} aria-hidden="true"/></span>
          <span><strong>{label.replace(/\s*[（(].*[）)]/, '')}</strong>{TOOL_HINTS[id]}</span>
          <span className="help-keys">{keys(key)}</span>
        </li>)}
      </ul></section>
      <section className="settings-section"><h3>{t('便利な使い方')}</h3><ul className="help-tips">{TIPS.map(tip => <li key={tip}>{tip}</li>)}</ul></section>
      <section className="settings-section"><h3>{t('ショートカット')}</h3><div className="settings-group shortcuts">
        {SHORTCUTS.map(([label, combos]) => <div className="setting-row" key={label}><span>{label}</span><span className="help-keys">{combos.map((combo, i) => <span key={combo}>{i > 0 && ' / '}{keys(combo)}</span>)}</span></div>)}
      </div></section>
    </div>
  </Modal>;
}
