import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Download, FolderOpen, Hand, Layers, Library, MousePointerClick, Search, Settings, Sparkles, SquarePlus, CircleHelp, X, type LucideIcon } from 'lucide-react';
import { t } from './i18n/index.mjs';

export type TourId = 'home' | 'editor';
type Step = { icon: LucideIcon; title: string; body: string; target?: string };

/** The guided tours. Targets are CSS selectors; a step whose target is missing or hidden is shown centred. */
export const TOURS: Record<TourId, Step[]> = {
  home: [
    { icon: Sparkles, title: t('Imagee へようこそ'), body: t('写真の補正、レタッチ、合成、書き出しまでを、この端末の中だけで行える画像エディタです。主な使い方を順番に紹介します。') },
    { icon: FolderOpen, title: t('画像を開く'), body: t('ここから画像を選ぶか、画面に画像をドラッグ＆ドロップすると、すぐ編集を始められます。PSD や .imagee プロジェクトも読み込めます。'), target: '[data-tour="home-open"]' },
    { icon: SquarePlus, title: t('新しいキャンバス'), body: t('4K、フル HD、スマホ、SNS、A4 などのよく使うサイズから、白または透明の新しいキャンバスを作れます。'), target: '[data-tour="home-new"]' },
    { icon: Library, title: t('ライブラリ'), body: t('読み込んだ画像はライブラリに自動で保存されます。お気に入りや並べ替え、まとめて書き出しもここから行えます。'), target: '[data-tour="home-library"]' },
    { icon: Settings, title: t('設定'), body: t('歯車アイコンから、外観やアクセントカラー、表示言語を変えられます。このチュートリアルもいつでも見直せます。'), target: '.settings-btn' },
  ],
  editor: [
    { icon: Hand, title: t('編集画面へようこそ'), body: t('画像を編集する画面です。各部の役割を簡単に紹介します。') },
    { icon: MousePointerClick, title: t('ツール'), body: t('移動、選択、ブラシ、修復、文字、図形などのツールです。画像を移動すると、ほかのオブジェクトやキャンバスに揃えるガイド線が表示されます。'), target: '.tool-rail' },
    { icon: Layers, title: t('インスペクター'), body: t('レイヤー、色調補正、AI 機能、履歴、画像の情報をタブで切り替えます。'), target: '.inspector' },
    { icon: Search, title: t('機能を検索'), body: t('「キャ」と打つだけで「キャンバスサイズ」などの機能が見つかります。ショートカットはどこからでも使えます。'), target: '.search-btn' },
    { icon: CircleHelp, title: t('ヘルプ'), body: t('操作方法やショートカットはヘルプにまとめてあります。'), target: '.help-btn' },
    { icon: Download, title: t('書き出し'), body: t('完成したら PNG・JPEG・WebP などで書き出せます。レイヤーを残すなら .imagee プロジェクトとして保存できます。'), target: '.editor-bar .btn.primary' },
  ],
};

const SEEN_KEY = 'imagee-tours-seen';
function seenTours(): string[] {
  try { const value = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; }
}
export function tourSeen(id: TourId) { return seenTours().includes(id); }
export function markTour(id: TourId) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...seenTours(), id])])); } catch { /* Private mode: shown again next time. */ }
}
export function resetTours() { try { localStorage.removeItem(SEEN_KEY); } catch { /* ignore */ } }

type Rect = { x: number; y: number; w: number; h: number };
const PAD = 8, CARD_W = 340, MARGIN = 16;

function measure(selector?: string): Rect | null {
  if (!selector) return null;
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  return { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 };
}

/** Puts the card beside the spotlight on whichever side has room, clamped to the window. */
function place(hole: Rect | null, card: { w: number; h: number }) {
  const vw = innerWidth, vh = innerHeight;
  if (!hole) return { left: (vw - card.w) / 2, top: (vh - card.h) / 2, side: 'center' as const };
  const clampX = (x: number) => Math.min(Math.max(x, MARGIN), vw - card.w - MARGIN);
  const clampY = (y: number) => Math.min(Math.max(y, MARGIN), vh - card.h - MARGIN);
  const gap = 14;
  if (hole.y + hole.h + gap + card.h <= vh - MARGIN) return { left: clampX(hole.x + hole.w / 2 - card.w / 2), top: hole.y + hole.h + gap, side: 'bottom' as const };
  if (hole.y - gap - card.h >= MARGIN) return { left: clampX(hole.x + hole.w / 2 - card.w / 2), top: hole.y - gap - card.h, side: 'top' as const };
  if (hole.x + hole.w + gap + card.w <= vw - MARGIN) return { left: hole.x + hole.w + gap, top: clampY(hole.y + hole.h / 2 - card.h / 2), side: 'right' as const };
  if (hole.x - gap - card.w >= MARGIN) return { left: hole.x - gap - card.w, top: clampY(hole.y + hole.h / 2 - card.h / 2), side: 'left' as const };
  return { left: clampX(hole.x + hole.w / 2 - card.w / 2), top: clampY(vh - card.h - MARGIN), side: 'center' as const };
}

/** A spotlight tour: dims the screen, cuts out the step's target, and walks through the steps with a floating card. */
export function Tour({ id, onDone }: { id: TourId; onDone: () => void }) {
  const steps = TOURS[id];
  const [index, setIndex] = useState(0);
  const [hole, setHole] = useState<Rect | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; side: string } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const step = steps[index], last = index === steps.length - 1;

  const finish = useCallback(() => {
    markTour(id);
    if (document.documentElement.dataset.motion === 'off') { onDone(); return; }
    setLeaving(true);
    window.setTimeout(onDone, 220);
  }, [id, onDone]);

  const layout = useCallback(() => {
    const target = measure(step.target);
    setHole(target);
    const el = card.current;
    if (el) setPos(place(target, { w: el.offsetWidth || CARD_W, h: el.offsetHeight || 200 }));
  }, [step]);

  useLayoutEffect(() => {
    if (step.target) document.querySelector(step.target)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    layout();
    // Targets can still be animating in: settle the spotlight once they land.
    const timers = [80, 300, 700].map(ms => window.setTimeout(layout, ms));
    addEventListener('resize', layout);
    return () => { timers.forEach(clearTimeout); removeEventListener('resize', layout); };
  }, [layout, step]);
  useEffect(() => { next.current?.focus({ preventScroll: true }); }, [index]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); finish(); }
      else if (event.key === 'ArrowRight' || event.key === 'Enter') { event.preventDefault(); if (last) finish(); else setIndex(i => i + 1); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); setIndex(i => Math.max(0, i - 1)); }
      event.stopPropagation();
    };
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  }, [finish, last]);

  const Icon = step.icon;
  const vw = typeof innerWidth === 'number' ? innerWidth : 0, vh = typeof innerHeight === 'number' ? innerHeight : 0;
  const cut = hole ?? { x: vw / 2, y: vh / 2, w: 0, h: 0 };
  return <div className="tour" role="dialog" aria-modal="true" aria-label={step.title} data-leaving={leaving ? '' : undefined} onClick={event => event.stopPropagation()}>
    <svg className="tour-shade" width="100%" height="100%" aria-hidden="true">
      <defs><mask id="tour-cut">
        <rect width="100%" height="100%" fill="#fff"/>
        <rect className="tour-cut" x={cut.x} y={cut.y} width={cut.w} height={cut.h} rx={hole ? 14 : 0} fill="#000"/>
      </mask></defs>
      <rect width="100%" height="100%" fill="rgba(0,0,0,.62)" mask="url(#tour-cut)"/>
    </svg>
    {hole && <div className="tour-ring" style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }}/>}
    <div ref={card} className="tour-card" data-side={pos?.side} key={index} style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}>
      <div className="tour-head">
        <span className="tour-icon"><Icon size={18} aria-hidden="true"/></span>
        <span className="tour-count num">{index + 1} / {steps.length}</span>
        <button type="button" className="icon-btn tour-close" aria-label={t('チュートリアルを閉じる')} title={t('閉じる')} onClick={finish}><X size={16} aria-hidden="true"/></button>
      </div>
      <h3>{step.title}</h3>
      <p>{step.body}</p>
      <div className="tour-foot">
        <div className="tour-dots" aria-hidden="true">{steps.map((_, i) => <i key={i} className={i === index ? 'on' : i < index ? 'done' : ''}/>)}</div>
        {index === 0
          ? <button type="button" className="btn ghost" onClick={finish}>{t('スキップ')}</button>
          : <button type="button" className="btn ghost" onClick={() => setIndex(i => i - 1)}><ArrowLeft size={15} aria-hidden="true"/>{t('戻る')}</button>}
        <button ref={next} type="button" className="btn primary" onClick={() => last ? finish() : setIndex(i => i + 1)}>{last ? t('はじめる') : <>{t('次へ')}<ArrowRight size={15} aria-hidden="true"/></>}</button>
      </div>
    </div>
  </div>;
}
