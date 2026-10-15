import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, FilePlus2, ImagePlus, Images, Pencil, Settings, Upload, CircleHelp } from 'lucide-react';
import type { Project } from './store';
import { pickImages } from './platform';
import { canvas, toBlob } from './imaging';
import { findPreset, SIZE_PRESETS } from './lib/sizes.mjs';
import { IconButton, Segmented } from './ui';
import { t } from './i18n/index.mjs';

/** Blank canvases offered on the start screen; any other size is one click away in the size sheet. */
const STARTERS = ['fhd', '4k', 'square', 'portrait-post', 'story', 'a4', 'a5', 'postcard', 'youtube-thumb', 'ogp', 'photo-3-2', 'icon'];

function useObjectUrl(blob?: Blob) {
  const [url, setUrl] = useState<string>();
  useEffect(() => { if (!blob) return; const next = URL.createObjectURL(blob); setUrl(next); return () => URL.revokeObjectURL(next); }, [blob]);
  return url;
}

/** One library image in the moving reel: its own aspect ratio, name and an edit badge on hover. */
function ReelItem({ project, onOpen, copy }: { project: Project; onOpen: () => void; copy?: boolean }) {
  const url = useObjectUrl(project.thumbnail);
  return <button type="button" className="reel-item" onClick={onOpen} aria-label={t('{0}を開く', project.name)} aria-hidden={copy || undefined} tabIndex={copy ? -1 : undefined}
    style={{ aspectRatio: `${Math.max(0.5, Math.min(2.2, project.width / project.height))}` }}>
    {url && <img src={url} alt="" draggable={false}/>}
    <span className="reel-caption"><span className="reel-name">{project.name}</span><span className="reel-edit"><Pencil size={13} aria-hidden="true"/>{t('編集')}</span></span>
  </button>;
}

/** The library flowing sideways. Two copies make the loop seamless; hovering or focusing pauses it. */
function Reel({ projects, onOpen }: { projects: Project[]; onOpen: (project: Project) => void }) {
  const items = projects.slice(0, 24);
  const copies = items.length < 6 ? 4 : 2;
  return <div className="reel" style={{ '--reel-time': `${Math.max(30, items.length * 7)}s`, '--reel-copies': copies } as React.CSSProperties}>
    <div className="reel-track">
      {Array.from({ length: copies }, (_, copy) => items.map(project => <ReelItem key={`${copy}-${project.id}`} project={project} copy={copy > 0} onOpen={() => onOpen(project)}/>))}
    </div>
  </div>;
}

function Recent({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const url = useObjectUrl(project.thumbnail);
  return <button type="button" className="home-recent" onClick={onOpen} aria-label={t('{0}を開く', project.name)}>
    <span className="home-recent-thumb">{url && <img src={url} alt="" draggable={false}/>}</span>
    <span className="home-recent-name">{project.name}</span>
  </button>;
}

/** The start screen: open or create something, pick up recent work, or go to the library. */
export function Home({ projects, reel, onImport, onOpen, onLibrary, onSettings, onTutorial, onCreate }: {
  projects: Project[] | null; reel: boolean; onImport: (files: File[], open?: boolean) => void; onOpen: (project: Project) => void;
  onLibrary: () => void; onSettings: () => void; onTutorial: () => void; onCreate: (file: File) => void;
}) {
  const [background, setBackground] = useState<'white' | 'clear'>('white');
  const [dragging, setDragging] = useState(false);
  const [creating, setCreating] = useState('');
  const depth = useRef(0);
  const recent = useMemo(() => [...(projects || [])].sort((a, b) => Math.max(b.opened || 0, b.edited || 0, b.added) - Math.max(a.opened || 0, a.edited || 0, a.added)), [projects]);

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
      <div className="home-bar-actions">
        <button type="button" className="btn ghost" data-tour="home-library" onClick={onLibrary}><Images size={16} aria-hidden="true"/>{t('ライブラリ')}</button>
        <IconButton icon={CircleHelp} label={t('チュートリアル')} onClick={onTutorial}/>
        <IconButton icon={Settings} label={t('設定')} className="settings-btn" onClick={onSettings}/>
      </div>
    </header>
    <main className="home-main">
      <section className="home-hero">
        <div className="home-logo" translate="no" role="img" aria-label="Imagee">
          <span className="home-mark" aria-hidden="true"><img src={`${import.meta.env.BASE_URL}icons/icon-512.png`} width="112" height="112" alt=""/></span>
          <span className="home-wordmark">Imagee</span>
        </div>
        <div className="home-cta" data-tour="home-open">
          <button type="button" className="btn primary lg" onClick={open}><ImagePlus size={18} aria-hidden="true"/>{t('画像を開く')}</button>
          <button type="button" className="btn lg" onClick={onLibrary}><Images size={18} aria-hidden="true"/>{t('ライブラリを見る')}<ArrowRight size={16} aria-hidden="true"/></button>
        </div>
      </section>

      {recent.length > 0 && <section className="home-section home-library" aria-label={t('ライブラリ')}>
        <div className="home-section-head"><Images size={18} aria-label={t('ライブラリ')}/><button type="button" className="link-btn" onClick={onLibrary}>{t('すべて見る')}</button></div>
        {reel && recent.length > 1
          ? <Reel projects={recent} onOpen={onOpen}/>
          : <div className="home-recents">{recent.slice(0, 8).map(project => <Recent key={project.id} project={project} onOpen={() => onOpen(project)}/>)}</div>}
      </section>}

      <section className="home-section" data-tour="home-new" aria-label={t('新しいキャンバス')}>
        <div className="home-section-head"><label className="select home-preset-picker"><FilePlus2 size={18} aria-hidden="true"/><select aria-label={t('キャンバスのプリセット')} value="" disabled={!!creating} onChange={e => e.target.value && void create(e.target.value)}><option value="">{t('すべてのサイズ')}</option>{SIZE_PRESETS.map(group => <optgroup key={group.group} label={group.group}>{group.items.map(preset => <option key={preset.id} value={preset.id}>{preset.label} · {preset.width} × {preset.height}</option>)}</optgroup>)}</select></label>
          <Segmented label={t('背景')} value={background} onChange={setBackground} options={[{ value: 'white', label: t('白') }, { value: 'clear', label: t('透明') }]}/></div>
        <div className="home-starters">
          {STARTERS.map((id, index) => { const preset = findPreset(id)!; return <button key={id} type="button" className="home-starter" style={{ '--i': index } as React.CSSProperties} disabled={!!creating} onClick={() => void create(id)}>
            <span className="home-starter-shape"><i style={{ aspectRatio: `${preset.width} / ${preset.height}` }} className={background}/></span>
            <strong>{creating === id ? t('作成中…') : preset.label}</strong><small className="num">{preset.width} × {preset.height}</small>
          </button>; })}
        </div>
      </section>

    </main>
    {dragging && <div className="drop-overlay" aria-hidden="true"><div><Upload size={30}/><strong>{t('ドロップして開く')}</strong><span>{t('PNG・JPEG・WebP・AVIF・GIF・BMP・PSD・Imagee プロジェクト')}</span></div></div>}
  </div>;
}
