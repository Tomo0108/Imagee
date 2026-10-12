import { useEffect, useMemo, useRef, useState } from 'react';
import { Clock3, Heart, ImagePlus, Images, LayoutGrid, List, MoreHorizontal, Pencil, Search, Settings2, Trash2, Upload, X, HardDrive, PackageOpen, Layers3 } from 'lucide-react';
import type { Project } from '../store';
import type { Preferences } from '../lib/preferences.mjs';
import { formatBytes, visibleProjects } from '../lib/files.mjs';
import { pickImages } from '../platform';
import { IconButton, Modal, Segmented, mod } from '../ui';
import { BatchDialog } from './BatchDialog';

type Filter = 'all' | 'recent' | 'favorites';
const FILTERS: { id: Filter; label: string; icon: typeof Images }[] = [
  { id: 'all', label: 'すべての画像', icon: Images },
  { id: 'recent', label: '最近編集', icon: Clock3 },
  { id: 'favorites', label: 'お気に入り', icon: Heart },
];

interface Props {
  projects: Project[] | null; prefs: Preferences; busy: number;
  onPrefs: (prefs: Preferences) => void; onImport: (files: File[]) => void; onOpen: (project: Project) => void;
  onUpdate: (project: Project) => void; onRemove: (ids: string[]) => Promise<void>; onSettings: () => void; onExport: (project: Project) => void; onToast: (message: string) => void;
}

export function Library({ projects, prefs, busy, onPrefs, onImport, onOpen, onUpdate, onRemove, onSettings, onExport, onToast }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [dragging, setDragging] = useState(false);
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [batch, setBatch] = useState(false);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const depth = useRef(0);
  const items = useMemo(() => visibleProjects(projects || [], prefs.sort, query, filter), [projects, prefs.sort, query, filter]);
  const counts = useMemo(() => ({ all: projects?.length || 0, recent: projects?.filter(p => p.opened).length || 0, favorites: projects?.filter(p => p.favorite).length || 0 }), [projects]);

  useEffect(() => { void navigator.storage?.estimate?.().then(({ usage = 0, quota = 0 }) => setStorage({ usage, quota })); }, [projects]);
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if ((event.target as HTMLElement)?.closest('input, textarea')) return;
      const files = [...(event.clipboardData?.files || [])];
      if (files.length) { event.preventDefault(); onImport(files); }
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, [onImport]);

  const title = FILTERS.find(item => item.id === filter)!.label;
  const empty = projects !== null && projects.length === 0;

  return <div className={`app library${dragging ? ' dragging' : ''}`}
    onDragEnter={e => { if (!e.dataTransfer.types.includes('Files')) return; e.preventDefault(); depth.current++; setDragging(true); }}
    onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
    onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); }}
    onDrop={e => { e.preventDefault(); depth.current = 0; setDragging(false); onImport([...e.dataTransfer.files]); }}>
    <Ambient/>
    <div className="titlebar"/>
    <aside className="sidebar">
      <div className="brand"><div className="brand-text"><div className="brand-name" translate="no">Imagee</div><div className="brand-sub">画像エディタ</div></div><IconButton icon={Settings2} label="設定" onClick={onSettings}/></div>
      <nav className="nav" aria-label="ライブラリ">
        <div className="nav-label">ライブラリ</div>
        {FILTERS.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={`nav-item${filter === id ? ' active' : ''}`} aria-current={filter === id ? 'page' : undefined} onClick={() => setFilter(id)}>
          <span className="nav-icon"><Icon size={17} strokeWidth={1.9} aria-hidden="true"/></span><span className="nav-text">{label}</span><span className="badge">{counts[id]}</span>
        </button>)}
      </nav>
      {storage && storage.quota > 0 && <div className="side-status"><div className="side-stat">
        <div className="ss-row"><span><HardDrive size={13} aria-hidden="true"/>保存容量</span><b>{formatBytes(storage.usage)}</b></div>
        <div className="meter" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(1, storage.usage / storage.quota * 100))}%` }}/></div>
        <p className="ss-note">画像はこの端末の中だけに保存されます</p>
      </div></div>}
    </aside>
    <main className="main">
      <div className="page">
        <header className="page-head">
          <div className="page-head-main"><h1>{title}</h1>{!empty && <span className="head-sub num">{items.length}枚</span>}</div>
          <div className="head-actions">
            {!empty && <label className="search"><Search size={14} aria-hidden="true"/><input type="search" value={query} placeholder="名前で検索" aria-label="名前で検索" onChange={e => setQuery(e.target.value)}/>{query && <button type="button" className="search-clear" aria-label="検索をクリア" onClick={() => setQuery('')}><X size={13}/></button>}</label>}
            {!empty && <button type="button" className="btn" onClick={() => setBatch(true)}><Layers3 size={16} aria-hidden="true"/><span className="btn-label">一括処理</span></button>}
            <button type="button" className="btn primary" onClick={() => void pickImages(true).then(files => files.length && onImport(files))}><ImagePlus size={16} aria-hidden="true"/>画像を開く</button>
          </div>
        </header>
        {!empty && <div className="toolbar">
          <label className="select"><span>並べ替え</span><select value={prefs.sort} onChange={e => onPrefs({ ...prefs, sort: e.target.value as Preferences['sort'] })}><option value="recent">最近</option><option value="name">名前</option><option value="size">ファイルサイズ</option></select></label>
          <Segmented label="表示" value={prefs.layout} onChange={layout => onPrefs({ ...prefs, layout })} options={[{ value: 'grid', label: <LayoutGrid size={15} aria-label="グリッド"/>, title: 'グリッド' }, { value: 'list', label: <List size={15} aria-label="リスト"/>, title: 'リスト' }]}/>
        </div>}
        <div className="glass-scroll">
          {projects === null ? null : empty ? <EmptyState onPick={() => void pickImages(true).then(files => files.length && onImport(files))}/>
            : items.length === 0 ? <div className="empty"><div><Search size={30} aria-hidden="true"/><h3>見つかりませんでした</h3><p>{query ? `「${query}」に一致する画像はありません。` : 'まだ画像がありません。'}</p></div></div>
            : <ul className={prefs.layout === 'grid' ? 'project-grid' : 'project-list'}>
              {items.map(project => <ProjectCard key={project.id} project={project} onOpen={() => onOpen(project)} onFavorite={() => onUpdate({ ...project, favorite: !project.favorite })} onRename={() => setRenaming(project)} onDelete={() => setDeleting(project)} onExport={() => onExport(project)}/>)}
            </ul>}
        </div>
      </div>
    </main>
    {busy > 0 && <div className="importing" role="status"><span className="spinner" aria-hidden="true"/><div><strong>読み込み中…</strong><span>残り{busy}枚</span></div></div>}
    {dragging && <div className="drop-overlay" aria-hidden="true"><div><Upload size={30}/><strong>ドロップして追加</strong><span>PNG・JPEG・WebP・AVIF・GIF・BMP・PSD・Imagee プロジェクト</span></div></div>}
    {batch && projects && <BatchDialog projects={items} initial={items.map(p => p.id)} onClose={() => setBatch(false)} onToast={onToast}/>}
    {renaming && <RenameDialog project={renaming} onClose={() => setRenaming(null)} onSave={name => { onUpdate({ ...renaming, name }); setRenaming(null); }}/>}
    {deleting && <Modal title="画像を削除" onClose={() => setDeleting(null)}>
      <p className="modal-text">「{deleting.name}」をライブラリから削除します。元のファイルは削除されません。</p>
      <div className="modal-actions"><button type="button" className="btn" onClick={() => setDeleting(null)}>キャンセル</button><button type="button" className="btn danger" onClick={() => { void onRemove([deleting.id]); setDeleting(null); }}>削除</button></div>
    </Modal>}
  </div>;
}

function Ambient() { return <div className="bg-fx" aria-hidden="true"><div className="ambient"><i className="f1"/><i className="f2"/><i className="f3"/></div></div>; }

function EmptyState({ onPick }: { onPick: () => void }) {
  return <div className="idle">
    <div className="medal" aria-hidden="true"><div className="medal-glass"><ImagePlus size={58} strokeWidth={1.4}/></div></div>
    <h1>画像を追加して編集を始めましょう</h1>
    <p className="tagline">ここに画像をドラッグ＆ドロップするか、{mod}+V で貼り付けてください。画像はこの端末の外には送られません。</p>
    <div className="idle-extra"><button type="button" className="btn primary lg" onClick={onPick}><ImagePlus size={17} aria-hidden="true"/>画像を開く</button></div>
  </div>;
}

function useObjectUrl(blob?: Blob) {
  const [url, setUrl] = useState<string>();
  useEffect(() => { if (!blob) return; const next = URL.createObjectURL(blob); setUrl(next); return () => URL.revokeObjectURL(next); }, [blob]);
  return url;
}

function ProjectCard({ project, onOpen, onFavorite, onRename, onDelete, onExport }: { project: Project; onOpen: () => void; onFavorite: () => void; onRename: () => void; onDelete: () => void; onExport: () => void }) {
  const url = useObjectUrl(project.thumbnail);
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent | KeyboardEvent) => { if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.querySelector('.menu')?.contains(event.target as Node)) setMenu(false); };
    window.addEventListener('pointerdown', close); window.addEventListener('keydown', close);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', close); };
  }, [menu]);
  return <li ref={ref} className={`project${menu ? ' menu-open' : ''}`}>
    <button type="button" className="project-open" onClick={onOpen} aria-label={`${project.name}を開く`}>
      <span className="project-thumb">{url && <img src={url} alt="" draggable={false}/>}</span>
      <span className="project-info"><span className="project-name">{project.name}</span><span className="project-meta num">{project.width} × {project.height} · {formatBytes(project.size)}</span></span>
    </button>
    <div className="project-actions">
      <IconButton icon={Heart} label={project.favorite ? 'お気に入りから外す' : 'お気に入りに追加'} active={project.favorite} className="fav" size={16} onClick={onFavorite}/>
      <IconButton icon={MoreHorizontal} label="その他" size={16} onClick={() => setMenu(!menu)}/>
      {menu && <div className="menu" role="menu">
        <button type="button" role="menuitem" onClick={() => { setMenu(false); onRename(); }}><Pencil size={15} aria-hidden="true"/>名前を変更</button>
        <button type="button" role="menuitem" onClick={() => { setMenu(false); onExport(); }}><PackageOpen size={15} aria-hidden="true"/>プロジェクトとして保存（.imagee）</button>
        <button type="button" role="menuitem" className="danger" onClick={() => { setMenu(false); onDelete(); }}><Trash2 size={15} aria-hidden="true"/>削除</button>
      </div>}
    </div>
  </li>;
}

function RenameDialog({ project, onClose, onSave }: { project: Project; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(project.name);
  return <Modal title="名前を変更" onClose={onClose}>
    <form onSubmit={e => { e.preventDefault(); if (name.trim()) onSave(name.trim()); }}>
      <input className="text-input" value={name} autoFocus aria-label="名前" onChange={e => setName(e.target.value)} onFocus={e => { const dot = e.target.value.lastIndexOf('.'); e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length); }}/>
      <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>キャンセル</button><button type="submit" className="btn primary" disabled={!name.trim()}>保存</button></div>
    </form>
  </Modal>;
}
