import { Children, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';

type Item = { value: string; label: ReactNode; text: string; group?: string; disabled?: boolean };
type OptionProps = { value?: string | number; children?: ReactNode; disabled?: boolean };
type GroupProps = { label?: string; children?: ReactNode };

const textOf = (node: ReactNode): string => typeof node === 'string' || typeof node === 'number' ? String(node)
  : Array.isArray(node) ? node.map(textOf).join('') : isValidElement(node) ? textOf((node.props as { children?: ReactNode }).children) : '';

/** Reads <option> and <optgroup> children the way a native <select> would. */
function readItems(children: ReactNode, group?: string): Item[] {
  const items: Item[] = [];
  Children.forEach(children, child => {
    if (!isValidElement(child)) return;
    if (child.type === 'optgroup') { const props = child.props as GroupProps; items.push(...readItems(props.children, props.label)); return; }
    if (child.type !== 'option') return;
    const props = (child as ReactElement<OptionProps>).props;
    const value = String(props.value ?? textOf(props.children));
    items.push({ value, label: props.children, text: textOf(props.children), group, disabled: props.disabled });
  });
  return items;
}

const popoverSupported = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;

/** A drop-down list that replaces the native <select>: the same <option>/<optgroup> children and an
 *  `onChange({ target: { value } })`, drawn in the app's own style with a gliding open animation. */
export function Select({ value, onChange, children, disabled, className = '', ...aria }: {
  value: string; onChange: (event: { target: { value: string } }) => void; children: ReactNode; disabled?: boolean; className?: string;
  'aria-label'?: string; title?: string;
}) {
  const items = useMemo(() => readItems(children), [children]);
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [active, setActive] = useState(-1);
  const [place, setPlace] = useState<{ left: number; top: number; width: number; maxHeight: number; up: boolean } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null), list = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const id = useId();
  const current = items.find(item => item.value === value);

  const close = useCallback((focus = true) => {
    if (!open || leaving) return;
    if (document.documentElement.dataset.motion === 'off') { setOpen(false); }
    else { setLeaving(true); window.setTimeout(() => { setOpen(false); setLeaving(false); }, 140); }
    if (focus) trigger.current?.focus({ preventScroll: true });
  }, [open, leaving]);
  const show = useCallback(() => {
    if (disabled || !items.length) return;
    setActive(Math.max(0, items.findIndex(item => item.value === value)));
    setLeaving(false); setOpen(true);
  }, [disabled, items, value]);
  const pick = useCallback((index: number) => {
    const item = items[index];
    if (!item || item.disabled) return;
    if (item.value !== value) onChange({ target: { value: item.value } });
    close();
  }, [items, value, onChange, close]);

  // Below the button (above it when there is no room), at least as wide, inside the window.
  const measure = useCallback(() => {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    const below = innerHeight - r.bottom - 12, above = r.top - 12, up = below < 220 && above > below;
    const width = Math.max(r.width, 180);
    setPlace({ left: Math.max(8, Math.min(r.left, innerWidth - width - 8)), top: up ? r.top - 6 : r.bottom + 6, width, maxHeight: Math.min(360, up ? above : below), up });
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    measure();
    const el = list.current;
    if (el && popoverSupported && !el.matches(':popover-open')) el.showPopover();
    const outside = (event: PointerEvent) => { if (!trigger.current?.contains(event.target as Node) && !list.current?.contains(event.target as Node)) close(false); };
    const scroll = (event: Event) => { if (!list.current?.contains(event.target as Node)) close(false); };
    addEventListener('pointerdown', outside, true); addEventListener('scroll', scroll, true); addEventListener('resize', measure);
    return () => { removeEventListener('pointerdown', outside, true); removeEventListener('scroll', scroll, true); removeEventListener('resize', measure); };
  }, [open, measure, close]);
  // Keep the active option in view.
  useEffect(() => { if (open) list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [open, active, place]);

  const step = (from: number, by: number) => {
    for (let i = 1; i <= items.length; i++) { const next = (from + by * i + items.length * 4) % items.length; if (!items[next].disabled) return next; }
    return from;
  };
  const key = (event: React.KeyboardEvent) => {
    const k = event.key;
    if (open || ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(k)) event.stopPropagation();
    if (!open) {
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') { event.preventDefault(); show(); }
      return;
    }
    if (k === 'Escape' || k === 'Tab') { if (k === 'Escape') event.preventDefault(); close(k === 'Escape'); }
    else if (k === 'ArrowDown') { event.preventDefault(); setActive(i => step(i, 1)); }
    else if (k === 'ArrowUp') { event.preventDefault(); setActive(i => step(i, -1)); }
    else if (k === 'Home') { event.preventDefault(); setActive(step(-1, 1)); }
    else if (k === 'End') { event.preventDefault(); setActive(step(items.length, -1)); }
    else if (k === 'Enter' || k === ' ') { event.preventDefault(); pick(active); }
    else if (k.length === 1) {
      // Type to jump to an option starting with those letters.
      const now = Date.now(), state = typed.current;
      state.text = (now - state.at > 700 ? '' : state.text) + k.toLowerCase(); state.at = now;
      const found = items.findIndex(item => !item.disabled && item.text.toLowerCase().startsWith(state.text));
      if (found >= 0) setActive(found);
    }
  };

  let lastGroup: string | undefined;
  return <>
    <button ref={trigger} type="button" className={`select-trigger ${className}`} role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined}
      aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined} disabled={disabled} {...aria}
      onClick={() => open ? close() : show()} onKeyDown={key}>
      {/* Like a native select, the button is as wide as its longest option: every label sits in the same cell, only the current one visible. */}
      <span className="select-value">
        {items.slice(0, 60).map((item, index) => item !== current && <span key={index} className="select-sizer" aria-hidden="true">{item.label}</span>)}
        <span className="select-current">{current?.label ?? ''}</span>
      </span>
      <ChevronDown className="select-chevron" size={14} strokeWidth={2} aria-hidden="true"/>
    </button>
    {open && <div ref={list} id={id} role="listbox" className="select-list" popover={popoverSupported ? 'manual' : undefined} aria-label={aria['aria-label']}
      data-up={place?.up ? '' : undefined} data-leaving={leaving ? '' : undefined}
      style={place ? { left: place.left, top: place.top, minWidth: place.width, maxHeight: place.maxHeight } : { visibility: 'hidden' }}
      onPointerDown={event => event.preventDefault()}>
      {items.map((item, index) => {
        const head = item.group && item.group !== lastGroup ? <div className="select-group" role="presentation">{item.group}</div> : null;
        lastGroup = item.group;
        const selected = item.value === value;
        return <div key={`${index}-${item.value}`} role="presentation" className="select-row">
          {head}
          <div id={`${id}-${index}`} data-index={index} role="option" aria-selected={selected} aria-disabled={item.disabled || undefined}
            className={`select-option${index === active ? ' active' : ''}${selected ? ' selected' : ''}`} style={{ '--i': Math.min(index, 12) } as React.CSSProperties}
            onPointerMove={() => index !== active && setActive(index)} onClick={() => pick(index)}>
            <Check className="select-check" size={14} strokeWidth={2.4} aria-hidden="true"/>
            <span>{item.label}</span>
          </div>
        </div>;
      })}
    </div>}
  </>;
}
