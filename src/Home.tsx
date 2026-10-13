import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, FilePlus2, ImagePlus, Images, Layers3, Lock, Settings, Sparkles, Upload, Wand2, WifiOff, CircleHelp } from 'lucide-react';
import type { Project } from './store';
import { pickImages } from './platform';
import { canvas, toBlob } from './imaging';
import { findPreset } from './lib/sizes.mjs';
import { IconButton, Segmented, mod } from './ui';
import { t } from './i18n/index.mjs';

/** Blank canvases offered on the start screen; any other size is one click away in the size sheet. */
const STARTERS = ['fhd', '4k', 'square', 'story', 'a4', 'youtube-thumb'];

function useObjectUrl(blob?: Blob) {
  const [url, setUrl] = useState<string>();
  useEffect(() => { if (!blob) return; const next = URL.createObjectURL(blob); setUrl(next); return () => URL.revokeObjectURL(next); }, [blob]);
  return url;
}

function Recent({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const url = useObjectUrl(project.thumbnail);
  return <button type="button" className="home-recent" onClick={onOpen} aria-label={t('{0}を開く', project.name)}>
    <span className="home-recent-thumb">{url && <img src={url} alt="" draggable={false}/>}</span>
    <span className="home-recent-name">{project.name}</span>
  </button>;
}

/** The start screen: open or create something, pick up recent work, or go to the library. */
export function Home({ projects, onImport, onOpen, onLibrary, onSettings, onTutorial, onCreate }: {
  projects: Project[] | null; onImport: (files: File[], open?: boolean) => void; onOpen: (project: Project) => void;
  onLibrary: () => void; onSettings: () => void; onTutorial: () => void; onCreate: (file: File) => void;
}) {
  const [background, setBackground] = useState<'white' | 'clear'>('white');
  const [dragging, setDragging] = useState(false);
  const [creating, setCreating] = useState('');
  const depth = useRef(0);
  const recent = useMemo(() => [...(projects || [])].sort((a, b) => Math.max(b.opened || 0, b.edited || 0, b.added) - Math.max(a.opened || 0, a.edited || 0, a.added)).slice(0, 8), [projects]);

  const create = async (id: string) => {
    const preset = findPreset(id)!;
    setCreating(id);
    try {
      const blank = canvas(preset.width, preset.height);
      if (background === 'white') { const c = blank.getContext('2d')!; c.fillStyle = '#ffffff'; c.fillRect(0, 0, blank.width, blank.height); }
      const blob = await toBlob(blank, 'image/png');
      blank.width = blank.height = 0;
      onCreate(new File([blob], `${preset.label} ${preset.width}×${preset.height}.png`, { type: 'image/png', lastModified: Date.now() }));
    } finally { setCreating(''); }
  };
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files || [])];
      if (!files.length) return;
      event.preventDefault();
      onImport(files, files.length === 1);
    };
    addEventListener('paste', paste);
    return () => removeEventListener('paste', paste);
  }, [onImport]);
  const open = () => void pickImages(true).then(files => files.length && onImport(files, files.length === 1));

  return <div className={`app home${dragging ? ' dragging' : ''}`}
    onDragEnter={e => { if (!e.dataTransfer.types.includes('Files')) return; e.preventDefault(); depth.current++; setDragging(true); }}
    onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
    onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); }}
    onDrop={e => { e.preventDefault(); depth.current = 0; setDragging(false); const files = [...e.dataTransfer.files]; onImport(files, files.length === 1); }}>
    <div className="bg-fx" aria-hidden="true"><div className="ambient"><i className="f1"/><i className="f2"/><i className="f3"/></div></div>
    <div className="titlebar"/>
    <header className="home-bar">
      <div className="home-brand"><img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} width="32" height="32" alt=""/><span translate="no">Imagee</span></div>
      <div className="home-bar-actions">
        <button type="button" className="btn ghost" data-tour="home-library" onClick={onLibrary}><Images size={16} aria-hidden="true"/>{t('ライブラリ')}</button>
        <IconButton icon={CircleHelp} label={t('チュートリアル')} onClick={onTutorial}/>
        <IconButton icon={Settings} label={t('設定')} className="settings-btn" onClick={onSettings}/>
      </div>
    </header>
    <main className="home-main">
      <section className="home-hero">
        <div className="home-mark" aria-hidden="true"><img src={`${import.meta.env.BASE_URL}icons/icon-512.png`} width="112" height="112" alt=""/></div>
        <h1>{t('写真の編集を、この端末だけで。')}</h1>
        <p>{t('レイヤー、色調補正、修復、AI による背景削除まで。画像はこの端末の外には送られません。')}</p>
        <div className="home-cta" data-tour="home-open">
          <button type="button" className="btn primary lg" onClick={open}><ImagePlus size={18} aria-hidden="true"/>{t('画像を開く')}</button>
          <button type="button" className="btn lg" onClick={onLibrary}><Images size={18} aria-hidden="true"/>{t('ライブラリを見る')}<ArrowRight size={16} aria-hidden="true"/></button>
        </div>
        <p className="home-drop-hint"><Upload size={14} aria-hidden="true"/>{t('画像をこの画面にドロップするか、{0}+V で貼り付けても始められます', mod)}</p>
      </section>

      <section className="home-section" data-tour="home-new">
        <div className="home-section-head"><h2><FilePlus2 size={18} aria-hidden="true"/>{t('新しいキャンバス')}</h2>
          <Segmented label={t('背景')} value={background} onChange={setBackground} options={[{ value: 'white', label: t('白') }, { value: 'clear', label: t('透明') }]}/></div>
        <div className="home-starters">
          {STARTERS.map((id, index) => { const preset = findPreset(id)!; return <button key={id} type="button" className="home-starter" style={{ '--i': index } as React.CSSProperties} disabled={!!creating} onClick={() => void create(id)}>
            <span className="home-starter-shape"><i style={{ aspectRatio: `${preset.width} / ${preset.height}` }} className={background}/></span>
            <strong>{creating === id ? t('作成中…') : preset.label}</strong><small className="num">{preset.width} × {preset.height}</small>
          </button>; })}
        </div>
        <p className="home-note">{t('ほかのサイズは、開いたあとに「キャンバスサイズを変更」から 30 種類以上のプリセットで選べます。')}</p>
      </section>

      {recent.length > 0 && <section className="home-section">
        <div className="home-section-head"><h2><Images size={18} aria-hidden="true"/>{t('最近の画像')}</h2><button type="button" className="link-btn" onClick={onLibrary}>{t('すべて見る')}</button></div>
        <div className="home-recents">{recent.map(project => <Recent key={project.id} project={project} onOpen={() => onOpen(project)}/>)}</div>
      </section>}

      <section className="home-section">
        <div className="home-features">
          <div className="home-feature"><Sparkles size={20} aria-hidden="true"/><strong>{t('オフラインで動く AI')}</strong><span>{t('被写体の選択、背景の削除、不要物の消去、高解像度化')}</span></div>
          <div className="home-feature"><Wand2 size={20} aria-hidden="true"/><strong>{t('すべて非破壊')}</strong><span>{t('補正はあとから何度でも直せて、500 回分さかのぼれます')}</span></div>
          <div className="home-feature"><Layers3 size={20} aria-hidden="true"/><strong>{t('PSD と一括処理')}</strong><span>{t('レイヤーごとの読み書きと、まとめての書き出し')}</span></div>
          <div className="home-feature"><Lock size={20} aria-hidden="true"/><strong>{t('アップロードしない')}</strong><span>{t('画像は端末の中だけに保存されます')}</span></div>
          <div className="home-feature"><WifiOff size={20} aria-hidden="true"/><strong>{t('オフラインでも')}</strong><span>{t('インストールすればネットがなくても使えます')}</span></div>
        </div>
      </section>
    </main>
    {dragging && <div className="drop-overlay" aria-hidden="true"><div><Upload size={30}/><strong>{t('ドロップして開く')}</strong><span>{t('PNG・JPEG・WebP・AVIF・GIF・BMP・PSD・Imagee プロジェクト')}</span></div></div>}
  </div>;
}
