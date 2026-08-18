'use client';

import type { KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';
import {
  addDays,
  addMonths,
  daysInMonth,
  formatMonthTitle,
  isOutOfRange,
  monthGrid,
  parseIsoDate,
  toIsoDate,
  weekdayLabels,
  yearMonthOf,
  type YearMonth,
} from '@/lib/calendar-math';

/**
 * CalendarGrid: the stateless month view behind `DatePicker`. It owns no state:
 * the parent passes the visible month (`view`), the committed `value`, the
 * keyboard cursor (`focused`) and gets every change back through callbacks, so
 * the same grid can later back a range picker without a rewrite.
 *
 * Markup follows the WAI-ARIA grid pattern: a `<table role="grid">` whose cells
 * are the days, a single roving `tabIndex=0` on the focused cell, arrows move by
 * day/week, Home/End jump to the week's ends, PageUp/PageDown page months (Shift
 * pages years), Enter/Space pick. Styling is tokens only: the accent fill is
 * `bg-primary`, and the "today"/cursor rims use `--primary-edge` like every other
 * selected state in the admin (see globals.css).
 */

export interface CalendarGridProps {
  view: YearMonth;
  /** Committed value (`YYYY-MM-DD`) or '' for none. */
  value: string;
  /** The roving keyboard cursor (`YYYY-MM-DD`). */
  focused: string;
  todayIso: string;
  min?: string;
  max?: string;
  locale: string;
  weekStart: 0 | 1;
  labels: { prevMonth: string; nextMonth: string };
  onPick: (iso: string) => void;
  onFocusChange: (iso: string) => void;
  onViewChange: (ym: YearMonth) => void;
  testId?: string;
}

export function CalendarGrid({
  view,
  value,
  focused,
  todayIso,
  min,
  max,
  locale,
  weekStart,
  labels,
  onPick,
  onFocusChange,
  onViewChange,
  testId,
}: CalendarGridProps) {
  const cells = monthGrid(view, weekStart);
  const weekdays = weekdayLabels(locale, weekStart);
  const monthTitle = formatMonthTitle(view, locale);

  // Exactly one cell carries tabIndex=0 (roving tabindex). Normally the cursor;
  // when the view was paged away from it with the prev/next buttons, fall back
  // to the selected day if visible in this month, else the month's first day,
  // so Tab can always reach the grid.
  const inView = cells.some((c) => c.iso === focused);
  const tabTarget = inView
    ? focused
    : (cells.find((c) => c.inMonth && c.iso === value)?.iso ??
      cells.find((c) => c.inMonth)?.iso ??
      focused);

  const moveFocus = (nextIso: string) => {
    onFocusChange(nextIso);
    const cur = yearMonthOf(focused);
    const next = yearMonthOf(nextIso);
    if (cur.year !== next.year || cur.month !== next.month) onViewChange(next);
  };

  const pageMonth = (n: number) => {
    const p = parseIsoDate(focused);
    if (!p) return;
    const target = addMonths({ year: p.year, month: p.month }, n);
    // Keep the day when the target month has it, else land on its last day.
    const last = daysInMonth(target.year, target.month);
    moveFocus(toIsoDate(target.year, target.month, Math.min(p.day, last)));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    const p = parseIsoDate(focused);
    if (!p) return;
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        moveFocus(addDays(focused, -1));
        return;
      case 'ArrowRight':
        e.preventDefault();
        moveFocus(addDays(focused, 1));
        return;
      case 'ArrowUp':
        e.preventDefault();
        moveFocus(addDays(focused, -7));
        return;
      case 'ArrowDown':
        e.preventDefault();
        moveFocus(addDays(focused, 7));
        return;
      case 'Home': {
        e.preventDefault();
        const dow = new Date(Date.UTC(p.year, p.month, p.day)).getUTCDay();
        moveFocus(addDays(focused, -((dow - weekStart + 7) % 7)));
        return;
      }
      case 'End': {
        e.preventDefault();
        const dow = new Date(Date.UTC(p.year, p.month, p.day)).getUTCDay();
        moveFocus(addDays(focused, 6 - ((dow - weekStart + 7) % 7)));
        return;
      }
      case 'PageUp':
        e.preventDefault();
        pageMonth(e.shiftKey ? -12 : -1);
        return;
      case 'PageDown':
        e.preventDefault();
        pageMonth(e.shiftKey ? 12 : 1);
        return;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (!isOutOfRange(focused, min, max)) onPick(focused);
        return;
      default:
        return;
    }
  };

  const navBtn =
    'inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div data-testid={testId} className="flex flex-col gap-1">
      <div className="flex items-center justify-between px-1">
        <button
          type="button"
          aria-label={labels.prevMonth}
          onClick={() => onViewChange(addMonths(view, -1))}
          className={navBtn}
        >
          <i aria-hidden className="pi pi-chevron-left" style={{ fontSize: 12 }} />
        </button>
        <span aria-live="polite" className="text-sm font-semibold">
          {monthTitle}
        </span>
        <button
          type="button"
          aria-label={labels.nextMonth}
          onClick={() => onViewChange(addMonths(view, 1))}
          className={navBtn}
        >
          <i aria-hidden className="pi pi-chevron-right" style={{ fontSize: 12 }} />
        </button>
      </div>

      <table
        role="grid"
        aria-label={monthTitle}
        className="w-full border-collapse"
        onKeyDown={onKeyDown}
      >
        <thead>
          <tr>
            {weekdays.map((w) => (
              <th
                key={w.long}
                scope="col"
                abbr={w.long}
                className="h-8 text-center text-2xs font-semibold uppercase text-muted-foreground"
              >
                {w.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 6 }, (_, row) => (
            <tr key={row}>
              {cells.slice(row * 7, row * 7 + 7).map((cell) => {
                const disabled = isOutOfRange(cell.iso, min, max);
                const selected = cell.iso === value;
                const isToday = cell.iso === todayIso;
                const isFocused = cell.iso === focused;
                return (
                  <td
                    key={cell.iso}
                    role="gridcell"
                    aria-selected={selected}
                    aria-disabled={disabled || undefined}
                    tabIndex={cell.iso === tabTarget ? 0 : -1}
                    data-iso={cell.iso}
                    data-testid="calendar-day"
                    onClick={() => {
                      if (disabled) return;
                      onPick(cell.iso);
                    }}
                    onFocus={() => {
                      if (!isFocused) onFocusChange(cell.iso);
                    }}
                    className="p-0 focus-visible:outline-none"
                  >
                    <span
                      className={cn(
                        'mx-auto flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-sm hover:bg-muted',
                        !cell.inMonth && 'text-muted-foreground/50',
                        isToday && 'shadow-[inset_0_0_0_1px_var(--primary-edge)]',
                        isFocused && 'bg-muted shadow-[inset_0_0_0_1px_var(--primary-edge)]',
                        selected &&
                          'bg-primary font-semibold text-primary-foreground hover:bg-primary',
                        disabled &&
                          'cursor-not-allowed text-muted-foreground/40 hover:bg-transparent',
                      )}
                    >
                      {Number(cell.iso.slice(8, 10))}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
