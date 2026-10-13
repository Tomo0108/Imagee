import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search, type LucideIcon } from 'lucide-react';
import { searchCommands } from '../lib/commands.mjs';
import { t } from '../i18n/index.mjs';

export interface Command {
  id: string; label: string; group: string;
  /** Katakana reading for labels with kanji, so 「へんこう」 finds 「変更」. */
  reading?: string; keywords?: string[];
  icon?: LucideIcon; shortcut?: string;
  /** Why it cannot run right now, if it cannot. */
  disabled?: string;
  run: () => void;
}

const RECENT_KEY = 'imagee-recent-commands';
function loadRecent(): string[] { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } }
function remember(id: string) { try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...loadRecent().filter(item => item !== id)].slice(0, 8))); } catch { /* Recent list is a convenience. */ } }

/** Finds and runs any editor feature by name. A few characters in kana, kanji or romaji are enough. */
export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), list = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const recent = useMemo(loadRecent, []);
  const results = useMemo(() => {
    const found = searchCommands(commands, query, recent);
    // With nothing typed: recently used first, then a few everyday features.
    if (!query.trim()) {
      const shown = new Set(found.map(item => item.command.id));
      for (const command of commands) if (found.length < 12 && !shown.has(command.id) && command.group !== t('ツール')) found.push({ command, score: 0, span: null });
    }
    return found.slice(0, 50);
  }, [commands, query, recent]);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => { const d = dialog.current!; d.showModal(); return () => d.close(); }, []);
  useEffect(() => { list.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const close = (then?: () => void) => {
    if (leaving) return;
    const finish = () => { onClose(); then?.(); };
    if (document.documentElement.dataset.motion === 'off') { finish(); return; }
    setLeaving(true);
    setTimeout(finish, 140);
  };
  const run = (index: number) => {
    const item = results[index]?.command;
    if (!item || item.disabled) return;
    remember(item.id);
    close(item.run);
  };
  const onKey = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(i => Math.min(results.length - 1, i + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(i => Math.max(0, i - 1)); }
    else if (event.key === 'Enter') { event.preventDefault(); run(active); }
  };

  return <dialog ref={dialog} className="palette" data-leaving={leaving ? '' : undefined} aria-label={t('機能を検索')}
    onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="palette-field">
      <Search size={18} aria-hidden="true"/>
      <input autoFocus value={query} placeholder={t('機能を検索（例: キャ、さいず、kya）')} role="combobox" aria-expanded="true" aria-controls="palette-list"
        aria-activedescendant={results[active] ? `palette-${results[active].command.id}` : undefined} onChange={event => setQuery(event.target.value)} onKeyDown={onKey}/>
      <kbd className="kbd">Esc</kbd>
    </div>
    <ul className="palette-list" id="palette-list" role="listbox" ref={list} aria-label={t('候補')}>
      {!query.trim() && results.length > 0 && <li className="palette-heading" role="presentation">{recent.length ? t('最近使った機能とおすすめ') : t('おすすめ')}</li>}
      {results.map(({ command, span }, index) => {
        const Icon = command.icon;
        const label = span ? <>{command.label.slice(0, span[0])}<mark>{command.label.slice(span[0], span[1])}</mark>{command.label.slice(span[1])}</> : command.label;
        return <li key={command.id} id={`palette-${command.id}`} role="option" aria-selected={index === active} aria-disabled={!!command.disabled}
          className={`palette-item${index === active ? ' on' : ''}`} style={{ '--i': Math.min(index, 12) } as React.CSSProperties}
          onPointerMove={() => setActive(index)} onClick={() => run(index)}>
          <span className="palette-icon">{Icon && <Icon size={16} strokeWidth={1.8} aria-hidden="true"/>}</span>
          <span className="palette-label"><span>{label}</span>{command.disabled && <small>{command.disabled}</small>}</span>
          <span className="palette-group">{command.group}</span>
          {command.shortcut && <kbd className="kbd">{command.shortcut}</kbd>}
          {index === active && !command.disabled && <CornerDownLeft className="palette-enter" size={14} aria-hidden="true"/>}
        </li>;
      })}
      {query.trim() && !results.length && <li className="palette-empty" role="presentation">{t('「{0}」に当てはまる機能はありません。別の言い方でも探せます（例: リサイズ、トリミング）。', query)}</li>}
    </ul>
  </dialog>;
}
