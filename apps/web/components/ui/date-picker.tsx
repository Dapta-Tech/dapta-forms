'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getMessages } from '@quill/shared';
import { cn } from '@/lib/cn';
import { CalendarGrid } from './calendar';
import {
  clampIso,
  formatIsoDate,
  todayUtcIso,
  weekStartsOn,
  yearMonthOf,
  type YearMonth,
} from '@/lib/calendar-math';

/**
 * DatePicker: a branded, token-styled date field that replaces the OS-native
 * `<input type="date">` in the admin. Same reasoning as `Select`: the native
 * control hands its popup to the OS (unthemed, off-brand, different in every
 * browser), whereas this renders a token-styled trigger (`border-input` /
 * `bg-background`) plus a mini calendar anchored under it (`border-border` /
 * `bg-popover` / `shadow-lg`) that follows the theme with zero CSS changes.
 *
 * Contract mirrors the native input: `value` is a `YYYY-MM-DD` string ('' for
 * none), `onChange` fires with the picked ISO date (or '' from the clear
 * button), `min`/`max` are inclusive ISO bounds. Everything is UTC (see
 * `lib/calendar-math`). `locale` comes from the server as a prop, never from
 * `document.cookie`, so server and client render the same first frame.
 *
 * Not portalled: the panel is `absolute z-50` under a `relative` wrapper, which
 * is safe wherever no ancestor clips overflow (the analytics filter qualifies).
 * A viewport guard flips the panel to `right-0` when it would spill off-screen.
 */
export function DatePicker({
  value,
  onChange,
  min,
  max,
  locale,
  placeholder,
  ariaLabel,
  testId,
  disabled = false,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  min?: string;
  max?: string;
  locale: string;
  placeholder?: string;
  ariaLabel: string;
  testId?: string;
  disabled?: boolean;
  /** Applied to the trigger button (matches the Input/Select convention). */
  className?: string;
}) {
  const m = getMessages(locale).admin.datePicker;
  const weekStart = weekStartsOn(locale);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<YearMonth>(() => yearMonthOf(value || todayUtcIso()));
  const [focused, setFocused] = useState<string>(value || todayUtcIso());
  const [alignEnd, setAlignEnd] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const todayIso = todayUtcIso();

  const openPanel = () => {
    if (disabled) return;
    const start = value || clampIso(todayIso, min, max);
    setView(yearMonthOf(start));
    setFocused(start);
    setAlignEnd(false);
    setOpen(true);
  };

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const pick = (iso: string) => {
    onChange(iso);
    close();
  };

  // Outside click closes without stealing focus back (the user is elsewhere).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Roving focus: whenever the cursor moves (keyboard or open), put DOM focus on
  // that cell so arrows keep working and screen readers announce the day. Not
  // keyed on `view` on purpose: paging with the prev/next buttons must leave
  // focus on the button so a keyboard user can keep pressing it.
  // Layout effect, not effect: crossing a month boundary unmounts the old cell,
  // and a plain effect would let focus fall to <body> for a paint before it
  // lands on the new one.
  useLayoutEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>(`[data-iso="${focused}"]`)?.focus();
  }, [open, focused]);

  // Viewport guard: measure once open and flip to the right edge if the panel
  // would spill past the window.
  useLayoutEffect(() => {
    if (!open || !panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) setAlignEnd(true);
  }, [open]);

  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        // The name carries the value too: an aria-label alone would replace
        // the button's content, and a screen reader would hear "From" with no
        // idea which day is set (the native input it replaces announced its
        // value).
        aria-label={value ? `${ariaLabel}, ${formatIsoDate(value, locale)}` : ariaLabel}
        data-testid={testId}
        onClick={() => (open ? close() : openPanel())}
        className={cn(
          'flex h-9 w-full min-w-[10.5rem] cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-sm text-foreground transition-colors hover:border-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
          value && !disabled && 'pr-14',
          className,
        )}
      >
        {/* Server and browser can carry different ICU data ("sept" vs "sep"
            in es): a formatted date that differs by one letter is not worth a
            hydration warning, and the value itself is the ISO string. */}
        <span className={cn('truncate', !value && 'text-muted-foreground')} suppressHydrationWarning>
          {value ? formatIsoDate(value, locale) : (placeholder ?? m.placeholder)}
        </span>
        <i
          aria-hidden
          className="pi pi-calendar shrink-0 text-muted-foreground"
          style={{ fontSize: 13 }}
        />
      </button>

      {value && !disabled ? (
        <button
          type="button"
          aria-label={`${m.clear}: ${ariaLabel}`}
          data-testid={testId ? `${testId}-clear` : undefined}
          onClick={() => {
            onChange('');
            setOpen(false);
          }}
          className="absolute right-8 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <i aria-hidden className="pi pi-times" style={{ fontSize: 11 }} />
        </button>
      ) : null}

      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-label={m.dialogLabel}
          data-testid={testId ? `${testId}-dialog` : undefined}
          onKeyDown={onPanelKeyDown}
          className={cn(
            'absolute top-full z-50 mt-1 w-[18rem] rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-lg',
            alignEnd ? 'right-0' : 'left-0',
          )}
        >
          <CalendarGrid
            view={view}
            value={value}
            focused={focused}
            todayIso={todayIso}
            min={min}
            max={max}
            locale={locale}
            weekStart={weekStart}
            labels={{ prevMonth: m.prevMonth, nextMonth: m.nextMonth }}
            onPick={pick}
            onFocusChange={setFocused}
            onViewChange={setView}
          />
        </div>
      ) : null}
    </div>
  );
}
