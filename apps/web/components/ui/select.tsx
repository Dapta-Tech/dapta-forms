'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getMessages } from '@quill/shared';
import { cn } from '@/lib/cn';

/**
 * Select — a branded, token-styled combobox that replaces the OS-native
 * `<select>` across the Dapta Forms admin. A native control hands its popup to
 * the operating system: unthemed, off-brand, and inconsistent with the rest of
 * the builder in both light and dark. This renders a token-styled trigger
 * (`border-input`/`bg-background`) plus a panel anchored under the field
 * (`border-border`/`bg-popover`/`shadow-lg`), so the dropdown looks identical to
 * every other admin surface and follows the theme with zero CSS changes.
 *
 * Generalized from Calendars' `TimeZoneSelect`: the same interaction shell
 * (optional search filter, ↑/↓/Enter/Esc, click-outside, scroll-into-view, full
 * listbox ARIA) but options-array-driven and domain-agnostic.
 *
 * Contract mirrors a `<select>`: `value` is the selected option's value and
 * `onChange` fires with the picked value. `searchable` (default false) reveals a
 * filter input for long lists. The search / no-results copy resolves from
 * `locale` like the reference (defaults to English so a bare fork renders).
 *
 * `className` styles the trigger button (matching the `Input`/`TextField`
 * convention in this app); control width is set by the parent container. The
 * panel is at least as wide as the trigger and grows to fit its longest option
 * (up to a cap, past which an option WRAPS): an option is never ellipsized,
 * because a list of five that all read "Where should we send the..." gives the
 * person nothing to choose between. It opens leftward when growing rightward
 * would leave the window.
 */

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
  searchable = false,
  disabled = false,
  id,
  ariaLabel,
  className,
  labelClassName,
  locale = 'en',
}: {
  /** The selected option's value. */
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Shown on the trigger when no option matches `value`. */
  placeholder?: string;
  /** Reveal a filter input for long option lists. Default false. */
  searchable?: boolean;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  /** Applied to the trigger button (matches the Input/TextField convention). */
  className?: string;
  /**
   * Replaces the trigger label's default `truncate`, for a caller whose labels
   * must stay readable in a narrow slot (e.g. `line-clamp-2 break-words`).
   */
  labelClassName?: string;
  /** 'en' | 'es' — resolves the search / no-results copy. */
  locale?: string;
}) {
  const m = getMessages(locale).admin.select;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** Which edge of the trigger the panel hangs from (see the layout effect). */
  const [alignEnd, setAlignEnd] = useState(false);

  const filtered = useMemo(() => {
    if (!searchable) return options;
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  }, [options, query, searchable]);

  const selected = options.find((o) => o.value === value);

  // Next selectable index from `from` in `dir` — clamps (no wrap) and skips
  // disabled rows so keyboard nav never lands on an unpickable option.
  const stepActive = (from: number, dir: 1 | -1): number => {
    let i = from;
    for (let n = 0; n < filtered.length; n++) {
      i += dir;
      if (i < 0 || i >= filtered.length) return from;
      if (!filtered[i]?.disabled) return i;
    }
    return from;
  };
  const firstEnabled = (): number => {
    const i = filtered.findIndex((o) => !o.disabled);
    return i === -1 ? 0 : i;
  };

  // Close on outside click; focus the search input (searchable) or the list
  // itself so ↑/↓/Enter/Esc reach the panel handler even without a search box.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    if (searchable) searchRef.current?.focus();
    else listRef.current?.focus();
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, searchable]);

  // The panel grows to its content, so it can run past the window's right edge
  // when the trigger sits near it. Measured before paint and flipped to hang
  // from the trigger's right edge instead, so it never opens half off-screen.
  useLayoutEffect(() => {
    if (!open) {
      setAlignEnd(false);
      return;
    }
    const rect = panelRef.current?.getBoundingClientRect();
    if (rect && rect.right > window.innerWidth - 8) setAlignEnd(true);
  }, [open]);

  // Keep the active option scrolled into view while arrowing through the list.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const openPanel = () => {
    if (disabled) return;
    setQuery('');
    const sel = options.findIndex((o) => o.value === value && !o.disabled);
    setActive(sel === -1 ? firstEnabled() : sel);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const pick = (opt: SelectOption) => {
    if (opt.disabled) return;
    onChange(opt.value);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => stepActive(a, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => stepActive(a, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = filtered[active];
      if (opt) pick(opt);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        id={id}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        // Inline, like the panel's own `outline: none`: the app-wide focus
        // outline in globals.css is unlayered and outranks any utility.
        style={open ? { outline: '2px solid var(--focus)', outlineOffset: 2 } : undefined}
        onClick={() => (open ? setOpen(false) : openPanel())}
        className={cn(
          // Focus is the app-wide green outline from globals.css, the same one
          // every input gets; an open select wears it too, so the control the
          // menu belongs to is never ambiguous.
          'flex w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-left text-sm transition-[border-color,background-color] hover:border-muted-foreground/60 disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
      >
        <span className={cn(labelClassName ?? 'truncate', !selected && 'text-muted-foreground')}>
          {selected ? selected.label : (placeholder ?? '')}
        </span>
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div
          ref={panelRef}
          className={cn(
            'absolute top-full z-50 mt-1 flex w-max min-w-full max-w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-md border border-border bg-popover shadow-lg',
            alignEnd ? 'right-0' : 'left-0',
          )}
          onKeyDown={onKeyDown}
        >
          {searchable ? (
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              placeholder={m.search}
              aria-label={m.search}
              // Inline, because the global `:focus-visible` outline is unlayered
              // and beats any utility. Inside an open menu the active option is
              // the one indicator; a second ring on the filter read as two.
              style={{ outline: 'none' }}
              className="border-b border-border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground"
            />
          ) : null}
          <ul
            ref={listRef}
            role="listbox"
            aria-label={ariaLabel}
            tabIndex={-1}
            style={{ outline: 'none' }}
            className="max-h-64 overflow-y-auto p-1"
          >
            {filtered.map((o, i) => {
              const isSelected = o.value === value;
              return (
                <li
                  key={`${o.value}-${i}`}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={o.disabled || undefined}
                  data-index={i}
                >
                  <button
                    type="button"
                    disabled={o.disabled}
                    onClick={() => pick(o)}
                    onMouseEnter={() => {
                      if (!o.disabled) setActive(i);
                    }}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-sm px-2 py-1.5 text-left text-sm',
                      o.disabled
                        ? 'cursor-not-allowed opacity-40'
                        : isSelected
                          ? 'bg-primary text-primary-foreground'
                          : // The keyboard cursor — the row Enter commits. A bare
                            // `bg-muted` wash is 1.14:1 on dark and 1.17:1 on light
                            // against the popover, so the one thing telling you what
                            // you are about to choose was the least visible thing in
                            // the list. Same accent rim every other selected state
                            // in the app uses.
                            i === active
                            ? 'bg-muted shadow-[inset_0_0_0_1px_var(--primary-edge)]'
                            : 'hover:bg-muted',
                    )}
                  >
                    <span className="min-w-0 whitespace-normal break-words">{o.label}</span>
                  </button>
                </li>
              );
            })}
            {filtered.length === 0 ? (
              <li className="px-2 py-3 text-sm text-muted-foreground">{m.noResults}</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
