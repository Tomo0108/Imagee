import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { X, type LucideIcon } from 'lucide-react';

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
    <div className="modal-head"><h2>{title}</h2><IconButton icon={X} label="閉じる" onClick={dismiss}/></div>
    {children}
  </dialog>;
}

export function IconButton({ icon: Icon, label, onClick, active, disabled, size = 18, className = '', shortcut }: { icon: LucideIcon; label: string; onClick?: () => void; active?: boolean; disabled?: boolean; size?: number; className?: string; shortcut?: string }) {
  return <button type="button" className={`icon-btn${active ? ' active' : ''} ${className}`} aria-label={label} aria-pressed={active} title={shortcut ? `${label} (${shortcut})` : label} disabled={disabled} onClick={onClick}>
    <Icon size={size} strokeWidth={1.8} aria-hidden="true"/>
  </button>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (value: T) => void; label: string }) {
  return <div className="segmented" role="radiogroup" aria-label={label}>
    {options.map(option => <button type="button" key={option.value} role="radio" aria-checked={value === option.value} title={option.title} className={value === option.value ? 'on' : ''} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle${checked ? ' on' : ''}`} onClick={() => onChange(!checked)}/>;
}

export function Slider({ label, value, min, max, step = 1, unit = '', onChange, onCommit }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (value: number) => void; onCommit?: () => void }) {
  const percent = ((value - min) / (max - min)) * 100;
  return <label className="slider">
    <span className="slider-head"><span>{label}</span><output className="num">{value}{unit}</output></span>
    <input type="range" min={min} max={max} step={step} value={value} style={{ '--fill': `${percent}%` } as React.CSSProperties}
      onChange={e => onChange(Number(e.target.value))} onPointerUp={onCommit} onKeyUp={onCommit}/>
  </label>;
}

export function Kbd({ children }: { children: ReactNode }) { return <kbd className="kbd">{children}</kbd>; }

export const mod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl';
