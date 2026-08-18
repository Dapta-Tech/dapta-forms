/**
 * CalendarGrid markup contract: the WAI-ARIA grid shape the DatePicker and its
 * e2e rely on (42 gridcells, one selected, disabled past `max`, a single roving
 * tabindex, locale-driven week start). Rendered with react-dom/server since the
 * web vitest env has no DOM.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CalendarGrid } from './calendar';

const noop = () => {};

function render(over: Partial<Parameters<typeof CalendarGrid>[0]> = {}) {
  return renderToStaticMarkup(
    <CalendarGrid
      view={{ year: 2026, month: 7 }}
      value="2026-08-10"
      focused="2026-08-10"
      todayIso="2026-08-18"
      max="2026-08-18"
      locale="en"
      weekStart={0}
      labels={{ prevMonth: 'Previous month', nextMonth: 'Next month' }}
      onPick={noop}
      onFocusChange={noop}
      onViewChange={noop}
      {...over}
    />,
  );
}

const count = (html: string, needle: string): number => html.split(needle).length - 1;

describe('CalendarGrid', () => {
  it('renders 42 gridcells with exactly one selected and one tab stop', () => {
    const html = render();
    expect(count(html, 'role="gridcell"')).toBe(42);
    expect(count(html, 'aria-selected="true"')).toBe(1);
    expect(count(html, 'tabindex="0"')).toBe(1);
    expect(html).toContain('role="grid"');
    expect(html).toContain('aria-label="August 2026"');
    expect(html).toContain('aria-label="Previous month"');
    expect(html).toContain('aria-label="Next month"');
  });

  it('disables every cell after max, and only those', () => {
    const html = render();
    // Grid runs 2026-07-26 .. 2026-09-05; days after 08-18 are 13 in Aug + 5 in Sep.
    expect(count(html, 'aria-disabled="true"')).toBe(13 + 5);
    expect(html).toContain('data-iso="2026-08-19" data-testid="calendar-day"');
    const idx = html.indexOf('data-iso="2026-08-19"');
    const cellStart = html.lastIndexOf('<td', idx);
    const cellOpen = html.slice(cellStart, html.indexOf('>', idx));
    expect(cellOpen).toContain('aria-disabled="true"');
  });

  it('marks today with the accent rim and the selected day with the accent fill', () => {
    const html = render();
    const cellFor = (iso: string) => {
      const idx = html.indexOf(`data-iso="${iso}"`);
      const end = html.indexOf('</td>', idx);
      return html.slice(idx, end);
    };
    expect(cellFor('2026-08-18')).toContain('shadow-[inset_0_0_0_1px_var(--primary-edge)]');
    expect(cellFor('2026-08-10')).toContain('bg-primary');
    expect(cellFor('2026-08-10')).toContain('text-primary-foreground');
    expect(cellFor('2026-08-03')).not.toContain('bg-primary');
  });

  it('starts the week on Monday for Spanish', () => {
    const html = render({ locale: 'es', weekStart: 1 });
    const thead = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'));
    const firstTh = thead.slice(thead.indexOf('<th'), thead.indexOf('</th>'));
    expect(firstTh.toLowerCase()).toMatch(/lun/);
    expect(html.indexOf('data-iso="2026-07-27"')).toBeLessThan(
      html.indexOf('data-iso="2026-08-01"'),
    );
    expect(html).not.toContain('data-iso="2026-07-26"');
  });

  it('keeps a tab stop when the cursor is outside the visible month', () => {
    const html = render({ focused: '2026-05-01' });
    expect(count(html, 'tabindex="0"')).toBe(1);
    const idx = html.indexOf('tabindex="0"');
    const cellOpen = html.slice(html.lastIndexOf('<td', idx), html.indexOf('>', idx));
    expect(cellOpen).toContain('data-iso="2026-08-10"');
  });
});
