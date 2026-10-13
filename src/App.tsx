import { useCallback, useEffect, useState } from 'react';
import { Library } from './library/Library';
import { Editor } from './editor/Editor';
import { Settings } from './Settings';
import { Home } from './Home';
import { Tour, tourSeen, resetTours, type TourId } from './Tutorial';
import { addLut, addProject, readProjects, removeProjects, updateProject, writePixels, type Project } from './store';
import { createProject } from './imaging';
import { onLaunchImages, platform, saveBlob } from './platform';
import { exportName, fileKind } from './lib/files.mjs';
import { normalizePreferences, type Language, type Preferences } from './lib/preferences.mjs';
import { t } from './i18n/index.mjs';

const PREFS_KEY = 'imagee-preferences';
function loadPreferences(): Preferences {
  try { return normalizePreferences(JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch { return normalizePreferences(null); }
}

export default function App() {
  const [prefs, setPrefs] = useState<Preferences>(loadPreferences);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [view, setView] = useState<'home' | 'library'>('home');
  const [tour, setTour] = useState<TourId | null>(null);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(0);

  useEffect(() => { readProjects().then(setProjects).catch(() => { setProjects([]); setToast(t('ライブラリを読み込めませんでした。')); }); }, []);
  const [toastLeaving, setToastLeaving] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setToastLeaving(false);
    const leave = setTimeout(() => setToastLeaving(true), 3400), timer = setTimeout(() => setToast(''), 3600);
    return () => { clearTimeout(leave); clearTimeout(timer); };
  }, [toast]);

  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* Private mode: preferences last for this session. */ }
    const root = document.documentElement;
    root.dataset.platform = platform;
    root.dataset.motion = prefs.motion ? 'on' : 'off';
    root.dataset.accent = prefs.accent;
    const media = matchMedia('(prefers-color-scheme: light)');
    const apply = () => { root.dataset.theme = prefs.theme === 'system' ? (media.matches ? 'light' : 'dark') : prefs.theme; };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [prefs]);

  const importFiles = useCallback(async (files: File[], open = false) => {
    const images = files.filter(file => fileKind(file));
    if (!images.length) { if (files.length) setToast(t('画像ファイルを選んでください（PNG・JPEG・WebP・AVIF・GIF・BMP・PSD・.imagee）。')); return; }
    setBusy(count => count + images.length);
    const added: Project[] = [];
    let failed = 0, message = '';
    for (const file of images) {
      try {
        const kind = fileKind(file);
        if (kind === 'image') { const { project, source } = await createProject(file); await addProject(project, source); added.push(project); continue; }
        // Photoshop documents and Imagee projects bring layers (and LUTs) with them.
        const { importImagee, importPsd } = await import('./io/projects');
        const imported = await (kind === 'psd' ? importPsd(file) : importImagee(file));
        await addProject(imported.project, imported.source);
        if (imported.pixels.size) await writePixels(imported.project.id, imported.pixels, new Set(imported.pixels.keys()));
        for (const lut of imported.luts) await addLut(lut);
        added.push(imported.project);
      }
      catch (e) { failed++; message = (e as Error).message; }
      finally { setBusy(count => count - 1); }
    }
    if (added.length) setProjects(current => [...added, ...(current || [])]);
    if (failed) setToast(failed === 1 && message ? message : t('{0}件の画像を読み込めませんでした。', failed));
    else if (added.length > 1) setToast(t('{0}件の画像を追加しました。', added.length));
    if (open && added.length === 1) setOpenId(added[0].id);
  }, []);

  useEffect(() => onLaunchImages(files => void importFiles(files, files.length === 1)), [importFiles]);

  const update = useCallback((project: Project) => {
    setProjects(current => current?.map(item => item.id === project.id ? project : item) || null);
    void updateProject(project).catch(() => setToast(t('変更を保存できませんでした。空き容量を確認してください。')));
  }, []);
  const remove = useCallback(async (ids: string[]) => {
    try { await removeProjects(ids); } catch (e) { setToast((e as Error).message || t('削除できませんでした。')); return; }
    setProjects(current => current?.filter(item => !ids.includes(item.id)) || null);
    setToast(ids.length > 1 ? t('{0}件を削除しました。', ids.length) : t('削除しました。'));
  }, []);

  const exportProject = useCallback(async (project: Project) => {
    try {
      const { exportStoredProject } = await import('./io/projects');
      const saved = await saveBlob(await exportStoredProject(project), exportName(project.name, 'imagee'), 'imagee', t('Imagee プロジェクト'));
      if (saved) setToast(t('「{0}」を保存しました。', saved));
    } catch (e) { setToast((e as Error).message || t('保存できませんでした。')); }
  }, []);
  const open = projects?.find(item => item.id === openId);
  useEffect(() => { if (openId && projects && !open) setOpenId(null); }, [openId, projects, open]);

  // First run: each screen introduces itself once. Wait for the screen to settle before the spotlight measures it.
  const screen: TourId | null = open ? 'editor' : view === 'home' && projects ? 'home' : null;
  useEffect(() => {
    if (tour && tour !== screen) { setTour(null); return; }
    if (!screen || tour || tourSeen(screen)) return;
    const timer = window.setTimeout(() => setTour(screen), 600);
    return () => clearTimeout(timer);
  }, [screen, tour]);
  const replayTutorial = useCallback(() => {
    resetTours();
    setSettings(false);
    setTour(null);
    if (!openId) setView('home');
    window.setTimeout(() => setTour(openId ? 'editor' : 'home'), 350);
  }, [openId]);
  const changeLanguage = useCallback((lang: Language) => {
    if (lang === prefs.lang) return;
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs, lang })); } catch { /* ignore */ }
    location.reload();
  }, [prefs]);
  const openProject = useCallback((project: Project) => { update({ ...project, opened: Date.now() }); setOpenId(project.id); }, [update]);

  return <>
    {open
      ? <Editor key={open.id} project={open} prefs={prefs} onClose={() => { setOpenId(null); setView('library'); }} onUpdate={update} onToast={setToast} onSettings={() => setSettings(true)} onAddImage={file => void importFiles([file], true)}/>
      : view === 'home'
        ? <Home projects={projects || []} onImport={importFiles} onOpen={openProject} onLibrary={() => setView('library')} onSettings={() => setSettings(true)} onTutorial={replayTutorial} onCreate={file => void importFiles([file], true)}/>
        : <Library projects={projects} prefs={prefs} busy={busy} onPrefs={setPrefs} onImport={importFiles} onOpen={openProject} onUpdate={update} onRemove={remove} onSettings={() => setSettings(true)} onHome={() => setView('home')} onExport={project => void exportProject(project)} onToast={setToast}/>}
    {settings && <Settings prefs={prefs} onChange={setPrefs} onClose={() => setSettings(false)} onLanguage={changeLanguage} onTutorial={replayTutorial}/>}
    {tour && tour === screen && <Tour key={tour} id={tour} onDone={() => setTour(null)}/>}
    {toast && <div className="toast" role="status" key={toast} data-leaving={toastLeaving ? '' : undefined}>{toast}</div>}
  </>;
}
