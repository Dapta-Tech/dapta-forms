/**
 * The column headings' funnels and the chips above the table, as they render:
 * a funnel only on the columns that filter, filled with a count when a filter
 * is on, and a chip per filtered column with the rows left of every response.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getMessages } from '@quill/shared';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }));

import { FilterBar, FilterHost, FilterTh, type FilterLabels } from './column-filter';
import { EMPTY_FILTER, type ViewFilter } from './filters';
import type { FilterColumn } from './filter-columns';

const m = getMessages('en').admin.submissions;
const labels: FilterLabels = { ...m.filters, completed: m.badgeCompleted, partial: m.badgePartial };

const columns: FilterColumn[] = [
  { id: 'date', kind: 'date', label: 'Response' },
  { id: 'status', kind: 'status', label: 'Status' },
  { id: 'score', kind: 'score', label: 'Score' },
  {
    id: 'q:kind',
    kind: 'choice',
    key: 'kind',
    label: 'Company type',
    options: [
      { value: 'llc', label: 'Multi-member LLC', count: 3, percent: 60 },
      { value: 'corp', label: 'Corporation', count: 2, percent: 40 },
    ],
  },
];

function render(filter: ViewFilter, node: React.ReactNode): string {
  return renderToStaticMarkup(
    <FilterHost
      columns={columns}
      filter={filter}
      statusCounts={{ completed: 4, partial: 1 }}
      total={30}
      labels={labels}
      locale="en"
    >
      {node}
    </FilterHost>,
  );
}

const headings = (
  <table>
    <thead>
      <tr>
        <FilterTh columnId="date" className="th">
          Response
        </FilterTh>
        <FilterTh columnId="score" className="th" align="end">
          Score
        </FilterTh>
        <FilterTh columnId="q:kind" className="th">
          Company type
        </FilterTh>
        <FilterTh columnId="q:notes" className="th">
          Notes
        </FilterTh>
      </tr>
    </thead>
  </table>
);

describe('column filters', () => {
  it('puts a funnel on every filterable column, and none on a text column', () => {
    const html = render(EMPTY_FILTER, headings);
    expect(html.match(/data-filter-trigger=/g)).toHaveLength(3);
    expect(html).toContain('aria-label="Filter by Company type"');
    expect(html).not.toContain('Filter by Notes');
    expect(html).toContain('pi-filter"');
    expect(html).not.toContain('pi-filter-fill');
  });

  it('fills the funnel with the count, and shows the sort arrow on the column that orders', () => {
    const html = render(
      { ...EMPTY_FILTER, answers: { kind: ['llc', 'corp'] }, sort: 'score_asc' },
      headings,
    );
    expect(html).toContain('aria-label="Filter by Company type, 2 active"');
    expect(html).toContain('pi-filter-fill');
    expect(html).toContain('pi-sort-amount-up-alt');
  });

  it('names one active filter in the singular, in both languages', () => {
    const one = { ...EMPTY_FILTER, answers: { kind: ['llc'] } };
    expect(render(one, headings)).toContain('aria-label="Filter by Company type, 1 active"');
    const es = getMessages('es').admin.submissions;
    const esHtml = renderToStaticMarkup(
      <FilterHost
        columns={columns}
        filter={one}
        statusCounts={{ completed: 4, partial: 1 }}
        total={30}
        labels={{ ...es.filters, completed: es.badgeCompleted, partial: es.badgePartial }}
        locale="es"
      >
        {headings}
      </FilterHost>,
    );
    expect(esHtml).toContain('aria-label="Filtrar por Company type, 1 activo"');
    expect(esHtml).not.toContain('1 activos');
  });

  it('shows nothing above the plain table', () => {
    expect(render(EMPTY_FILTER, <FilterBar shown={30} total={30} />)).toBe('');
  });

  it('lists a chip per filtered column, the rows left, and Clear all', () => {
    const html = render(
      {
        ...EMPTY_FILTER,
        statuses: ['completed'],
        answers: { kind: ['llc'] },
        scoreMin: 7,
        preset: '7d',
      },
      <FilterBar shown={12} total={30} />,
    );
    expect(html).toContain(
      'Company type: </span><span class="font-semibold text-foreground">Multi-member LLC',
    );
    expect(html).toContain('Status: </span><span class="font-semibold text-foreground">Completed');
    expect(html).toContain('7 or more');
    expect(html).toContain('Last 7 days');
    expect(html).toContain('12 of 30 responses');
    expect(html).toContain('Clear all');
    expect(html).toContain('aria-label="Remove filter: Company type: Multi-member LLC"');
  });

  it('shows the sort alone as a chip, without a count of rows', () => {
    const html = render({ ...EMPTY_FILTER, sort: 'oldest' }, <FilterBar shown={30} total={30} />);
    expect(html).toContain('Oldest first');
    expect(html).not.toContain('of 30 responses');
  });

  it('leaves the sort out where rows are not listed in order (the Summary)', () => {
    expect(
      render(
        { ...EMPTY_FILTER, sort: 'oldest' },
        <FilterBar shown={30} total={30} sorted={false} />,
      ),
    ).toBe('');
    const html = render(
      { ...EMPTY_FILTER, statuses: ['partial'], sort: 'score_desc' },
      <FilterBar shown={5} total={30} sorted={false} />,
    );
    expect(html).toContain('Partial');
    expect(html).not.toContain('Highest first');
  });
});
