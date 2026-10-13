import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { X, type LucideIcon } from 'lucide-react';
import { t } from './i18n/index.mjs';

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closed = useRef(false);
  const dismiss = useCallback(() => {
    const dialog = ref.current;
    if (closed.current || !dialog || dialog.hasAttribute('data-leaving')) return;
    if (document.documentElement.dataset.motion === 'off') { closed.current = true; onClose(); return; }
    dialog.setAttribute('data-leaving', '');
    const finish = (event?: AnimationEvent) => {
      if (event && (event.target !== dialog || event.animationName !== 'sheet-out')) return;
      if (closed.current) return;
      closed.current = true;
      window.clearTimeout(timer);
      dialog.removeEventListener('animationend', finish);
      onClose();
    };
    const timer = window.setTimeout(() => finish(), 500);
    dialog.addEventListener('animationend', finish);
  }, [onClose]);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className={`modal${wide ? ' wide' : ''}`} aria-label={title}
    onCancel={e => { e.preventDefault(); dismiss(); }}
    onClick={e => { if (e.target !== e.currentTarget) return; const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dismiss(); }}>
    <div className="modal-head"><h2>{title}</h2><IconButton icon={X} label={t('閉じる')} onClick={dismiss}/></div>
    {children}
  </dialog>;
}

export function IconButton({ icon: Icon, label, onClick, active, disabled, size = 18, className = '', shortcut }: { icon: LucideIcon; label: string; onClick?: () => void; active?: boolean; disabled?: boolean; size?: number; className?: string; shortcut?: string }) {
  return <button type="button" className={`icon-btn${active ? ' active' : ''} ${className}`} aria-label={label} aria-pressed={active} title={shortcut ? `${label} (${shortcut})` : label} disabled={disabled} onClick={onClick}>
    <Icon size={size} strokeWidth={1.8} aria-hidden="true"/>
  </button>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (value: T) => void; label: string }) {
  // The selected pill is drawn behind the buttons and glides to the chosen one.
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const group = ref.current, on = group?.querySelector<HTMLElement>('button.on');
    if (!group || !on) { group?.removeAttribute('data-glide'); return; }
    const place = () => { group.style.setProperty('--seg-x', `${on.offsetLeft}px`); group.style.setProperty('--seg-w', `${on.offsetWidth}px`); };
    place();
    group.setAttribute('data-glide', '');
    const observer = new ResizeObserver(place);
    observer.observe(group);
    return () => observer.disconnect();
  }, [value, options.length]);
  return <div className="segmented" role="radiogroup" aria-label={label} ref={ref}>
    {options.map(option => <button type="button" key={option.value} role="radio" aria-checked={value === option.value} title={option.title} className={value === option.value ? 'on' : ''} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle${checked ? ' on' : ''}`} onClick={() => onChange(!checked)}/>;
}

export function Slider({ label, value, min, max, step = 1, unit = '', onChange, onCommit, onReset, format, centered }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (value: number) => void; onCommit?: () => void; onReset?: () => void; format?: (value: number) => string; centered?: boolean }) {
  const percent = ((value - min) / (max - min)) * 100;
  // Bipolar sliders fill from the centre so the neutral point is obvious.
  const from = centered ? Math.min(50, percent) : 0, to = centered ? Math.max(50, percent) : percent;
  return <label className={`slider${centered && value !== 0 ? ' changed' : ''}`} onDoubleClick={onReset ? () => { onReset(); onCommit?.(); } : undefined} title={onReset ? t('ダブルクリックでリセット') : undefined}>
    <span className="slider-head"><span>{label}</span><output className="num">{format ? format(value) : `${value}${unit}`}</output></span>
    <input type="range" min={min} max={max} step={step} value={value} aria-label={label} style={{ '--from': `${from}%`, '--to': `${to}%` } as React.CSSProperties}
      onChange={e => onChange(Number(e.target.value))} onPointerUp={onCommit} onKeyUp={onCommit}/>
  </label>;
}

export function Kbd({ children }: { children: ReactNode }) { return <kbd className="kbd">{children}</kbd>; }

export const mod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl';
