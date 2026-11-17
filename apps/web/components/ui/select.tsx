'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getMessages } from '@quill/shared';
import { cn } from '@/lib/cn';
import { placeMenu, sameFit, type AncestorBox, type MenuFit } from './select-fit';

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
 * would leave the visible area AND leftward fits; when neither side holds it,
 * it narrows to the room there is and the options wrap. The width follows the
 * whole option list, never the filtered one: typing in the search box does not
 * change it, options that arrive while it is open do (see `select-fit.ts`).
 */

/**
 * The Select's ancestors as `visibleBand` wants them: plain boxes and computed
 * style values, read off the DOM from the root's parent outward. `clipping` is
 * the subset whose resizing can change where the menu may go.
 *
 * The menu is `absolute` inside the Select's own `relative` root, not portalled,
 * so these ancestors are what can cut it off. What to make of them is decided
 * in `select-fit.ts`, where it can be tested with made-up geometry.
 */
function ancestorsOf(root: HTMLElement): { boxes: AncestorBox[]; clipping: HTMLElement[] } {
  const boxes: AncestorBox[] = [];
  const clipping: HTMLElement[] = [];
  for (let node = root.parentElement; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    const left = node.getBoundingClientRect().left + node.clientLeft;
    boxes.push({
      position: style.position,
      overflowX: style.overflowX,
      transformed: style.transform !== 'none',
      inner: { left, right: left + node.clientWidth },
    });
    if (style.overflowX !== 'visible') clipping.push(node);
  }
  return { boxes, clipping };
}

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
  const labelRef = useRef<HTMLSpanElement>(null);
  /**
   * The width the options ask for on their own, measured with the whole list in
   * the panel; null while it has yet to be measured (see the layout effects).
   */
  const [content, setContent] = useState<number | null>(null);
  /** Side and width of the open panel; null until placed. */
  const [fit, setFit] = useState<MenuFit | null>(null);
  /** The trigger's label does not fit its slot (ellipsis or line clamp). */
  const [clipped, setClipped] = useState(false);

  const filtered = useMemo(() => {
    if (!searchable) return options;
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  }, [options, query, searchable]);

  const selected = options.find((o) => o.value === value);
  const shownLabel = selected ? selected.label : (placeholder ?? '');
  // What the menu's width depends on: the labels of the WHOLE list. The filter
  // is deliberately not part of it.
  const optionsKey = useMemo(() => options.map((o) => o.label).join('\n'), [options]);

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

  // The panel grows to its content, so it can run past the window, or past a
  // dialog or rail that clips it. Left to `w-max` it also re-fit itself to the
  // surviving options on every keystroke in the search box and jumped under the
  // pointer. So its width is measured, then pinned, in two steps.
  //
  // Step one: anything that changes what the options ask for (opening, or the
  // option list itself changing while open) asks for a fresh measurement.
  // Typing in the search box is not on that list.
  useLayoutEffect(() => {
    setContent(null);
    if (!open) setFit(null);
  }, [open, optionsKey]);

  // Step two. While `content` is null the panel renders the whole list with no
  // width of its own, so what is read here is the width the longest option asks
  // for; it is pinned before paint, to that width or to the room there is. Once
  // measured, the placement is kept current: the window, the Select itself or
  // an ancestor that clips it can all change size with the menu open.
  useLayoutEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const panel = panelRef.current;
    if (!root || !panel) return;
    const place = (width: number) =>
      placeMenu(width, root.getBoundingClientRect(), document.documentElement.clientWidth, ancestorsOf(root).boxes);

    if (content === null) {
      // Without the `min-w-full` floor: that floor is the trigger's width, and
      // `placeMenu` applies it from the trigger as it is at each placement.
      panel.style.minWidth = '0';
      const measured = panel.getBoundingClientRect().width;
      panel.style.minWidth = '';
      setContent(measured);
      setFit(place(measured));
      return;
    }

    const replace = () => {
      const next = place(content);
      setFit((prev) => (sameFit(prev, next) ? prev : next));
    };
    window.addEventListener('resize', replace);
    // A side panel that is dragged narrower, a dialog that reflows: no window
    // resize happens, and the menu would be left hanging out of its container.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(replace);
    if (observer) {
      observer.observe(root);
      for (const node of ancestorsOf(root).clipping) observer.observe(node);
    }
    return () => {
      window.removeEventListener('resize', replace);
      observer?.disconnect();
    };
  }, [open, content]);

  // The trigger truncates a label that does not fit its slot. When it does, the
  // full text goes in `title`, so it can still be read; when it does not, there
  // is no tooltip repeating what is already on screen.
  useEffect(() => {
    const label = labelRef.current;
    if (!label) return;
    const check = () =>
      setClipped(label.scrollWidth > label.clientWidth || label.scrollHeight > label.clientHeight + 1);
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(check);
    observer.observe(label);
    return () => observer.disconnect();
  }, [shownLabel, labelClassName]);

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
      // This Escape closed a menu, and that is all it does. Without stopping
      // it here the same keypress went on to whatever hosts the Select: a
      // dialog listening on `window` closed along with the menu, taking the
      // author's place in it. The handler only exists while the menu is open,
      // so a second Escape is the host's again. Both calls are needed. The
      // first ends it for React ancestors and for anything above the root. But
      // React dispatches FROM the root (the document, in the app), so a
      // listener a popover added to `document` sits beside React's own, not
      // above it, and only the second reaches that one.
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
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

  // The measuring pass shows every option whatever the filter says; it is
  // replaced by the filtered list before the browser paints.
  const sizing = open && content === null;
  const shown = sizing ? options : filtered;

  return (
    // `min-w-0`: where a caller lays the Select out as a flex or grid item, its
    // automatic minimum is the whole selected label on one line, so one long
    // option pushed the trigger (and the menu, never narrower than it) out of a
    // dialog. With it the trigger shrinks to its slot and the label truncates,
    // which is what the label's `truncate` was always meant to do.
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        id={id}
        disabled={disabled}
        aria-label={ariaLabel}
        // A description, not a name: the accessible name stays `aria-label`
        // or the label text itself.
        title={clipped && shownLabel ? shownLabel : undefined}
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
        <span ref={labelRef} className={cn(labelClassName ?? 'truncate', !selected && 'text-muted-foreground')}>
          {shownLabel}
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
            fit?.side === 'end' ? 'right-0' : 'left-0',
          )}
          // Inline so it outranks `w-max`; `min-w-full` and the cap still apply.
          // None while measuring: that pass needs the panel at its own width.
          style={fit && !sizing ? { width: fit.width } : undefined}
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
            {shown.map((o, i) => {
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
            {shown.length === 0 ? (
              <li className="px-2 py-3 text-sm text-muted-foreground">{m.noResults}</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
